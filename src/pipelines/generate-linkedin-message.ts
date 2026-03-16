/**
 * LinkedIn Message Generation Pipeline
 *
 * Generates personalized LinkedIn connection requests and messages.
 * Uses the same context assembly as email outreach — contact profile,
 * company signals, governance rules — but formats for LinkedIn's constraints.
 *
 * Rules (from Outreach Playbook governance):
 *   - Connection request ONLY after Email 1 (not simultaneously)
 *   - Connection note max 300 characters
 *   - Reference a specific fact about the person or company
 *   - One CTA — never two asks
 */

import { client, aiOptions } from '../config.js';
import { LINKEDIN_CONFIG, ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { assembleContext } from './generate-outreach.js';
import { accountPreflight } from './account-preflight.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { LINKEDIN_MESSAGE_SCHEMA, LINKEDIN_MESSAGE_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';
import type { GeneratedLinkedInMessage } from '../types.js';

const log = logger.child({ pipeline: 'generate-linkedin' });

/** Check if we've already sent a LinkedIn action to this contact. */
async function getLinkedInState(email: string): Promise<{
  connectionSent: boolean;
  messagesSent: number;
}> {
  const history = await client.memory.recall({
    message: `LinkedIn connection request message sent to ${email}`,
    limit: 10,
  });

  let connectionSent = false;
  let messagesSent = 0;

  for (const item of history.data || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('[LINKEDIN CONNECTION REQUEST')) connectionSent = true;
    if (content.includes('[LINKEDIN MESSAGE')) messagesSent++;
  }

  return { connectionSent, messagesSent };
}

/** Check if Email 1 has been sent (LinkedIn only goes out AFTER Email 1). */
async function hasEmail1BeenSent(email: string): Promise<boolean> {
  const history = await client.memory.recall({
    message: `outreach sent email 1 to ${email}`,
    limit: 5,
  });

  for (const item of history.data || []) {
    const content = item.content || '';
    if (/\[OUTREACH SENT\s*[-\u2014\u2013]+\s*Email 1\]/.test(content)) return true;
  }

  return false;
}

/**
 * Generate a LinkedIn message for a contact.
 *
 * @param email - Contact email
 * @param linkedinUrl - Contact's LinkedIn profile URL
 * @param step - Sequence step number (1 = connection request, 2+ = follow-up message)
 * @param dryRun - If true, don't record to memory
 */
export async function generateLinkedInMessage(
  email: string,
  linkedinUrl: string,
  step = 1,
  dryRun = true,
): Promise<GeneratedLinkedInMessage | null> {
  if (!LINKEDIN_CONFIG.enabled) {
    log.info('LinkedIn disabled, skipping', { email });
    return null;
  }

  if (!linkedinUrl) {
    log.info('No LinkedIn URL, skipping', { email });
    return null;
  }

  // Gate: LinkedIn only after Email 1
  const email1Sent = await hasEmail1BeenSent(email);
  if (!email1Sent) {
    log.info('Email 1 not sent yet, skipping LinkedIn', { email });
    return null;
  }

  // Check existing LinkedIn state
  const linkedInState = await getLinkedInState(email);

  // Determine message type
  let type: 'connection_request' | 'inmail' | 'message';
  if (!linkedInState.connectionSent) {
    type = 'connection_request';
  } else if (linkedInState.messagesSent === 0) {
    type = 'message'; // First follow-up after connection
  } else {
    log.info('LinkedIn sequence complete', { email, messagesSent: linkedInState.messagesSent });
    return null; // Don't spam on LinkedIn — 1 connection + 1 message max
  }

  // Account preflight
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const preflight = await accountPreflight(email);
    if (preflight.decision === 'block' || preflight.decision === 'delay') {
      log.info('Account preflight blocked LinkedIn', { email, decision: preflight.decision });
      return null;
    }
  }

  const context = await assembleContext(email);

  const maxChars = type === 'connection_request'
    ? LINKEDIN_CONFIG.connectionNoteMaxChars
    : 500;

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this contact for a LinkedIn ${type === 'connection_request' ? 'connection request' : 'direct message'}. Identify: their role, what they care about, and the strongest reason to connect.`,
        maxSteps: 2,
      },
      {
        prompt: `Generate a LinkedIn ${type === 'connection_request' ? 'connection request note' : 'message'} for this prospect.

${type === 'connection_request' ? `This is a CONNECTION REQUEST NOTE:
- MUST be under ${maxChars} characters (this is a hard LinkedIn limit)
- Be concise — no fluff, no "I came across your profile"
- Reference ONE specific fact about them or their company
- End with a soft reason to connect (shared interest, relevant insight)
- Do NOT include a meeting ask — save that for the follow-up message
- No salutation needed — LinkedIn shows your name` : `This is a LinkedIn MESSAGE (they already accepted your connection):
- Max ${maxChars} characters
- Reference the connection or previous email touch
- Include ONE clear CTA (e.g., "open to a quick call?")
- Keep it conversational — LinkedIn is not email`}

${buildJsonInstruction(LINKEDIN_MESSAGE_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
    evaluate: true,
    evaluationCriteria: `Message must: (1) be under ${maxChars} characters, (2) reference a specific fact, (3) follow brand voice, (4) not repeat angles from previous emails, (5) be appropriate for LinkedIn tone.`,
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, LINKEDIN_MESSAGE_SCHEMA, LINKEDIN_MESSAGE_DEFAULTS);

  if (usedFallback) {
    log.warn('LLM returned non-JSON, used regex fallback', { email });
  }
  if (errors.length > 0) {
    log.warn('Parse warnings', { email, warnings: errors.join(', ') });
  }

  if (!parsed.message) {
    log.error('Empty LinkedIn message from LLM', { email });
    return null;
  }

  // Enforce character limit
  let message = parsed.message;
  if (message.length > maxChars) {
    log.warn('Message exceeds limit, truncating', { email, length: message.length, max: maxChars });
    message = message.substring(0, maxChars - 3) + '...';
  }

  if (dryRun) {
    log.info('Dry run', { email, type, message, angle: parsed.angle });
  }

  return {
    email,
    step,
    type: type as GeneratedLinkedInMessage['type'],
    message,
    angle: parsed.angle,
    linkedinUrl,
  };
}
