/**
 * Call Script Generation Pipeline
 *
 * Generates personalized cold call scripts with three outputs:
 *   1. Structured script (opener, hook, ask, objection handlers) — for quick reference
 *   2. Human playbook — mindset, pacing, do's/don'ts for SDRs
 *   3. AI caller script — full verbatim script for Bland.ai, Vapi, or similar
 *
 * Rules (from Outreach Playbook governance):
 *   - Phone call ONLY for contacts scored 80+ who have a phone number
 *   - Call task created after Email 1 has been opened or after Email 2
 *   - Never call opted-out or bounced contacts
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { CALL_CONFIG, ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { assembleContext } from './generate-outreach.js';
import { accountPreflight } from './account-preflight.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { CALL_SCRIPT_SCHEMA, CALL_SCRIPT_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';
import type { GeneratedCallScript } from '../types.js';
import { workspace } from '../lib/workspace.js';

const log = logger.child({ pipeline: 'generate-call-script' });

/** Check if we already generated a call script for this contact. */
async function getCallState(email: string): Promise<{ callScriptsGenerated: number }> {
  const history = await memory.retrieve({
    message: `call script phone call for ${email}`,
    limit: 5,
    mode: 'fast',
  });

  let callScriptsGenerated = 0;
  for (const item of (history as any) || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('[CALL SCRIPT')) callScriptsGenerated++;
  }

  return { callScriptsGenerated };
}

/** Check how many emails have been sent via structured workspace state. */
async function getEmailProgress(email: string): Promise<number> {
  const state = await workspace.getSequenceState(email);
  return state.emailsSent;
}

/** Get contact details (name, title, phone) from Personize memory. */
async function getContactDetails(email: string): Promise<{
  name: string;
  title: string;
  phone: string;
  linkedinUrl: string;
} | null> {
  const digest = await memory.retrieveDigest({
    email,
    maxTokens: 500,
  });

  const props = (digest as any)?.properties || {};
  const firstName = props.first_name?.value || '';
  const lastName = props.last_name?.value || '';
  const name = `${firstName} ${lastName}`.trim() || 'Unknown';
  const title = props.job_title?.value || 'Unknown';
  const phone = props.phone_number?.value || '';
  const linkedinUrl = props.linkedin_url?.value || '';

  if (!phone) return null;

  return { name, title, phone, linkedinUrl };
}

/**
 * Generate a call script for a contact.
 *
 * @param email - Contact email
 * @param icpScore - ICP score (calls only for 80+)
 * @param step - Sequence step (usually 1 — calls are typically one-shot)
 * @param dryRun - If true, don't record to memory
 */
export async function generateCallScriptForContact(
  email: string,
  icpScore: number,
  step = 1,
  dryRun = true,
): Promise<GeneratedCallScript | null> {
  if (!CALL_CONFIG.enabled) {
    log.info('Call channel disabled, skipping', { email });
    return null;
  }

  // Gate: only high-ICP contacts
  if (icpScore < CALL_CONFIG.minScoreForCall) {
    log.info('ICP score below call threshold', { email, icpScore, threshold: CALL_CONFIG.minScoreForCall });
    return null;
  }

  // Get contact details
  const contact = await getContactDetails(email);
  if (!contact) {
    log.info('No phone number, skipping call', { email });
    return null;
  }

  // Gate: at least Email 1 sent
  const emailProgress = await getEmailProgress(email);
  if (emailProgress < 1) {
    log.info('No emails sent yet, skipping call', { email });
    return null;
  }

  // Gate: only one call script per contact
  const callState = await getCallState(email);
  if (callState.callScriptsGenerated >= 1) {
    log.info('Call script already generated', { email });
    return null;
  }

  // Account preflight
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const preflight = await accountPreflight(email);
    if (preflight.decision === 'block' || preflight.decision === 'delay') {
      log.info('Account preflight blocked call', { email, decision: preflight.decision });
      return null;
    }
  }

  const context = await assembleContext(email);

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this contact for a cold call. Their name is ${contact.name}, title is ${contact.title}. Identify: their likely priorities, the strongest reason to call NOW (based on signals), and potential objections they'll raise.`,
        maxSteps: 2,
      },
      {
        prompt: `Generate a complete cold call script for ${contact.name} (${contact.title}).

You must provide THREE things:

1. **STRUCTURED SCRIPT** — Short, punchy components:
   - OPENER: 2 sentences max. Who you are + why calling. Sound human, not robotic.
   - HOOK: 1 sentence connecting to THEIR specific situation (reference a real fact).
   - ASK: 1 sentence — the meeting request. Clear and direct.
   - OBJECTION HANDLERS: 2-3 common objections with 1-sentence responses.
     Format each as "objection text | response text" (pipe-separated).
     Common objections: "I'm not interested", "Send me an email", "We already have a solution", "I'm busy right now"

2. **HUMAN PLAYBOOK** — Guidance for a human SDR making this call:
   - Mindset: how to approach this specific person (e.g., "they're a VP — be peer-to-peer, not salesy")
   - Pacing: when to pause, when to push
   - Do's: 2-3 specific things to do on THIS call
   - Don'ts: 2-3 things to avoid
   - Pivot point: if they sound disengaged, what to pivot to
   Format as bullet points.

3. **AI CALLER SCRIPT** — Full verbatim script for an AI voice agent (Bland.ai, Vapi):
   - Write it as a complete conversation flow
   - Include the greeting, pitch, objection handling, and close
   - Use natural, conversational language (not corporate-speak)
   - Include pause indicators: [pause] for natural breaks
   - Include tone indicators: [warm], [confident], [curious]
   - End with a clear next step (calendar link, transfer to rep, or follow-up)

${buildJsonInstruction(CALL_SCRIPT_SCHEMA)}`,
        maxSteps: 4,
      },
    ],
    evaluate: true,
    evaluationCriteria: 'Script must: (1) reference at least 1 specific fact about the contact, (2) sound natural and conversational, (3) have a clear ask, (4) include relevant objection handlers, (5) AI script must be complete enough to run standalone.',
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, CALL_SCRIPT_SCHEMA, CALL_SCRIPT_DEFAULTS);

  if (usedFallback) log.warn('LLM returned non-JSON, used regex fallback', { email });
  if (errors.length > 0) log.warn('Parse warnings', { email, warnings: errors.join(', ') });

  if (!parsed.opener || !parsed.hook || !parsed.ask) {
    log.error('Incomplete call script from LLM', { email });
    return null;
  }

  // Parse objection handlers from "objection | response" format
  const objectionHandlers = (parsed.objection_handlers || []).map((entry: string) => {
    const parts = entry.split('|').map((s: string) => s.trim());
    return {
      objection: parts[0] || entry,
      response: parts[1] || 'I understand. Would it help if I sent you a brief overview first?',
    };
  });

  if (dryRun) {
    log.info('Dry run call script', {
      email,
      contact: contact.name,
      opener: parsed.opener,
      hook: parsed.hook,
      ask: parsed.ask,
    });
  }

  return {
    email,
    step,
    contactName: contact.name,
    contactTitle: contact.title,
    phone: contact.phone,
    opener: parsed.opener,
    hook: parsed.hook,
    ask: parsed.ask,
    objectionHandlers,
    humanPlaybook: parsed.human_playbook,
    aiCallerScript: parsed.ai_caller_script,
    angle: parsed.angle,
  };
}
