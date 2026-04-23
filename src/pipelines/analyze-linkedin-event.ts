/**
 * LinkedIn Event Analysis Pipeline
 *
 * When a HeyReach webhook fires (connection accepted, reply received, etc.),
 * this pipeline:
 * 1. Memorizes the event into Personize memory (keeps the memory loop intact)
 * 2. For reply events: uses AI to classify sentiment and determine next action
 * 3. Updates workspace (tasks, context, notes) based on the event
 *
 * Follows the same pattern as analyze-reply.ts and analyze-call.ts:
 *   workspace context + AI classification + actions.
 *
 * HeyReach webhook events (from Composio docs + Make triggers):
 *   CONNECTION_REQUEST_SENT      — we sent a connection request
 *   CONNECTION_REQUEST_ACCEPTED   — they accepted our connection
 *   MESSAGE_SENT                  — we sent a LinkedIn message
 *   MESSAGE_REPLY_RECEIVED        — they replied to our message
 *   INMAIL_SENT                   — we sent an InMail
 *   INMAIL_REPLY_RECEIVED         — they replied to our InMail
 *   FOLLOW_SENT                   — we followed them
 *   LIKED_POST                    — we liked their post
 *   VIEWED_PROFILE                — we viewed their profile
 *   CAMPAIGN_COMPLETED            — campaign finished for this lead
 *   LEAD_TAG_UPDATED              — lead's tag changed in HeyReach
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { workspace } from '../lib/workspace.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { evaluateAccountStrategy } from './account-strategy.js';
import { createHubSpotFollowUpTask } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { LINKEDIN_EVENT_ANALYSIS_SCHEMA, LINKEDIN_EVENT_ANALYSIS_DEFAULTS } from '../lib/llm-schemas.js';
import { ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';
import type { LinkedInEvent, LinkedInEventAnalysis } from '../types.js';

const log = logger.child({ pipeline: 'analyze-linkedin-event' });

// ─── Memorize Event ────────────────────────────────────────────────

/**
 * Store the LinkedIn event into Personize memory.
 * This ensures the next email/call/LinkedIn touch has full context.
 */
async function memorizeEvent(event: LinkedInEvent): Promise<void> {
  const eventLabels: Record<string, string> = {
    CONNECTION_REQUEST_SENT: 'CONNECTION REQUEST SENT',
    CONNECTION_REQUEST_ACCEPTED: 'CONNECTION ACCEPTED',
    MESSAGE_SENT: 'MESSAGE SENT',
    MESSAGE_REPLY_RECEIVED: 'MESSAGE REPLY RECEIVED',
    INMAIL_SENT: 'INMAIL SENT',
    INMAIL_REPLY_RECEIVED: 'INMAIL REPLY RECEIVED',
    FOLLOW_SENT: 'FOLLOW SENT',
    LIKED_POST: 'LIKED POST',
    VIEWED_PROFILE: 'VIEWED PROFILE',
    CAMPAIGN_COMPLETED: 'CAMPAIGN COMPLETED',
    LEAD_TAG_UPDATED: 'LEAD TAG UPDATED',
  };

  const label = eventLabels[event.eventType] || event.eventType;

  const content = [
    `[LINKEDIN ${label} — HeyReach]`,
    `Date: ${new Date().toISOString()}`,
    `Profile: ${event.profileUrl}`,
    event.firstName || event.lastName
      ? `Contact: ${event.firstName} ${event.lastName}`.trim()
      : '',
    event.company ? `Company: ${event.company}` : '',
    event.messageContent ? `\nMessage:\n${event.messageContent}` : '',
  ].filter(Boolean).join('\n');

  // Determine which email to memorize under
  const email = event.email || '';
  if (!email) {
    // If no email, try to find the contact by LinkedIn URL in Personize
    const searchResult = await client.memory.search({
      type: 'Contact',
      query: `linkedin url ${event.profileUrl}`,
      limit: 1,
    });
    const found = searchResult.data?.[0]?.email;
    if (found) {
      await memory.save({
        email: found,
        content,
        enhanced: true,
        tags: ['linkedin', 'heyreach', event.eventType.toLowerCase()],
      });
      // Mutate for downstream use
      (event as any).email = found;
      log.info('Memorized LinkedIn event (resolved email from profile URL)', {
        email: found,
        eventType: event.eventType,
      });
      return;
    }

    log.warn('No email for LinkedIn event, memorizing without email', {
      profileUrl: event.profileUrl,
      eventType: event.eventType,
    });
    await memory.save({
      content,
      enhanced: true,
      tags: ['linkedin', 'heyreach', event.eventType.toLowerCase(), 'no-email'],
    });
    return;
  }

  await memory.save({
    email,
    content,
    enhanced: true,
    tags: ['linkedin', 'heyreach', event.eventType.toLowerCase()],
  });

  log.info('Memorized LinkedIn event', {
    email,
    eventType: event.eventType,
    profileUrl: event.profileUrl,
  });
}

// ─── Analyze Reply ────────────────────────────────────────────────

/**
 * Use AI to analyze a LinkedIn reply (MESSAGE_REPLY_RECEIVED or INMAIL_REPLY_RECEIVED).
 */
async function analyzeLinkedInReply(event: LinkedInEvent): Promise<LinkedInEventAnalysis> {
  const email = event.email;
  if (!email) {
    return {
      outcome: 'neutral',
      summary: 'LinkedIn reply received but contact email unknown. Needs manual review.',
      sentiment: 'neutral',
      urgency: 'medium',
      nextAction: 'Find contact email and review LinkedIn reply manually.',
      keyPoints: [],
    };
  }

  const [digest, guidelines] = await Promise.all([
    workspace.getDigest(email, 3000),
    client.context.retrieve({
      message: 'linkedin outreach, reply handling, outreach playbook, brand voice',
      types: ['guideline'],
      mode: 'fast',
    }),
  ]);

  const context = [
    '## GOVERNANCE\n' + (guidelines.data?.compiledContext || ''),
    '## LEAD WORKSPACE\n' + ((digest as any)?.compiledContext || ''),
    '## LINKEDIN REPLY',
    `From: ${event.firstName} ${event.lastName} (${event.profileUrl})`,
    event.company ? `Company: ${event.company}` : '',
    `Event: ${event.eventType}`,
    '',
    '## MESSAGE CONTENT',
    event.messageContent || '(no message content)',
  ].filter(Boolean).join('\n\n---\n\n');

  const aiResult = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this LinkedIn reply. Classify the outcome and determine the right follow-up.

Classification guide:
- INTERESTED: Contact expressed interest, asked questions, wants to learn more
- NOT_INTERESTED: Contact declined, asked to stop messaging, clearly not interested
- QUESTION: Contact asked a specific question that needs answering
- REFERRAL: Contact mentioned another person who might be a better fit
- NEUTRAL: Ambiguous — didn't clearly express interest or disinterest
- POSITIVE_SIGNAL: Positive but not directly actionable (e.g., "thanks for connecting", "nice to meet you")

${buildJsonInstruction(LINKEDIN_EVENT_ANALYSIS_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(aiResult.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, LINKEDIN_EVENT_ANALYSIS_SCHEMA, LINKEDIN_EVENT_ANALYSIS_DEFAULTS);

  if (usedFallback) log.warn('LLM returned non-JSON, used regex fallback', { email });
  if (errors.length > 0) log.warn('Parse warnings', { email, warnings: errors.join(', ') });

  return {
    outcome: parsed.outcome as LinkedInEventAnalysis['outcome'],
    summary: parsed.summary,
    sentiment: parsed.sentiment as LinkedInEventAnalysis['sentiment'],
    urgency: parsed.urgency as LinkedInEventAnalysis['urgency'],
    nextAction: parsed.next_action,
    keyPoints: parsed.key_points as string[],
  };
}

// ─── Act on Event ──────────────────────────────────────────────────

async function handleLinkedInEvent(
  event: LinkedInEvent,
  analysis?: LinkedInEventAnalysis,
): Promise<void> {
  const email = event.email;
  if (!email) return; // Can't take workspace actions without email

  const ownerId = process.env.HUBSPOT_OWNER_ID || '';

  // ─── CONNECTION ACCEPTED ───────────────────────────────────────
  if (event.eventType === 'CONNECTION_REQUEST_ACCEPTED') {
    await workspace.addUpdate(email, {
      author: 'heyreach',
      type: 'outreach',
      summary: `LinkedIn connection accepted by ${event.firstName} ${event.lastName}`.trim(),
    });

    await workspace.rewriteContext(email, [
      'LinkedIn: CONNECTED — connection request accepted.',
      'Next: Monitor for LinkedIn reply. If email sequence active, continue.',
    ].join('\n'), 'heyreach');

    await memory.save({
      email,
      content: `[LEAD STATUS UPDATE] LinkedIn connection accepted`,
      collectionName: 'contacts',
      properties: {
        linkedin_connected: { value: true, extractMemories: false },
        lead_status: { value: 'Engaged', extractMemories: false },
      },
      tags: ['linkedin', 'connection-accepted'],
    });

    await notifySlack([
      `*LinkedIn connection accepted*`,
      `Contact: ${event.firstName} ${event.lastName} (${email})`,
      `Profile: ${event.profileUrl}`,
    ].join('\n'));
    return;
  }

  // ─── REPLY RECEIVED (Message or InMail) ────────────────────────
  if (event.eventType === 'MESSAGE_REPLY_RECEIVED' || event.eventType === 'INMAIL_REPLY_RECEIVED') {
    if (!analysis) return;

    // Store analysis in workspace
    await workspace.addNote(email, {
      author: 'linkedin-analyzer',
      content: [
        `LinkedIn Reply Analysis:`,
        `Outcome: ${analysis.outcome.toUpperCase()}`,
        `Summary: ${analysis.summary}`,
        `Sentiment: ${analysis.sentiment}`,
        `Urgency: ${analysis.urgency}`,
        `Next Action: ${analysis.nextAction}`,
        analysis.keyPoints.length > 0 ? `Key Points: ${analysis.keyPoints.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
      category: 'analysis',
    });

    if (analysis.outcome === 'interested' || analysis.outcome === 'question') {
      await workspace.addTask(email, {
        title: analysis.outcome === 'interested'
          ? 'LinkedIn reply — interested! Follow up'
          : 'LinkedIn reply — question needs answering',
        description: [
          `LinkedIn ${event.eventType === 'INMAIL_REPLY_RECEIVED' ? 'InMail' : 'message'} reply:`,
          `"${event.messageContent}"`,
          ``,
          `Summary: ${analysis.summary}`,
          `Action: ${analysis.nextAction}`,
        ].join('\n'),
        status: 'pending',
        owner: 'sales-rep',
        createdBy: 'linkedin-analyzer',
        priority: analysis.urgency === 'high' ? 'urgent' : 'high',
        dueDate: new Date(Date.now() + 4 * 3600_000).toISOString(),
      });

      if (ownerId) {
        await createHubSpotFollowUpTask({
          contactId: '',
          ownerId,
          subject: `LinkedIn Reply — ${analysis.outcome === 'interested' ? 'Interested!' : 'Question'}`,
          body: [
            `**LinkedIn reply from ${event.firstName} ${event.lastName}**`,
            `**Profile:** ${event.profileUrl}`,
            '',
            `**Their message:**`,
            event.messageContent,
            '',
            `**Summary:** ${analysis.summary}`,
            `**Action:** ${analysis.nextAction}`,
          ].join('\n'),
          priority: 'HIGH',
          taskType: 'TODO',
        });
      }

      await workspace.rewriteContext(email, [
        `Status: ${analysis.outcome.toUpperCase()} — positive LinkedIn reply!`,
        `Summary: ${analysis.summary}`,
        `Action: ${analysis.nextAction}`,
      ].join('\n'), 'linkedin-analyzer');

      await notifySlack([
        `*Positive LinkedIn reply!*`,
        `Contact: ${event.firstName} ${event.lastName} (${email})`,
        `Summary: ${analysis.summary}`,
        `Action: ${analysis.nextAction}`,
      ].join('\n'));
    }

    if (analysis.outcome === 'not_interested') {
      await workspace.raiseIssue(email, {
        title: 'Contact not interested (LinkedIn reply)',
        description: `LinkedIn reply: "${event.messageContent}". Stop all outreach.`,
        severity: 'critical',
        status: 'open',
        raisedBy: 'linkedin-analyzer',
      });

      await workspace.rewriteContext(email, [
        'Status: NOT INTERESTED — declined on LinkedIn.',
        `Summary: ${analysis.summary}`,
        'Action: Stop all sequences. Do not contact again.',
      ].join('\n'), 'linkedin-analyzer');

      await memory.save({
        email,
        content: `[LEAD STATUS UPDATE] Not interested (LinkedIn reply). Summary: ${analysis.summary}`,
        collectionName: 'contacts',
        properties: {
          lead_status: { value: 'Disqualified', extractMemories: false },
          outreach_stage: { value: 'Opted Out', extractMemories: false },
          responsive: { value: true, extractMemories: false },
          sentiment: { value: 'Negative', extractMemories: false },
        },
        tags: ['opted-out', 'negative-linkedin-reply'],
      });

      await notifySlack([
        `*Not interested (LinkedIn)*`,
        `Contact: ${event.firstName} ${event.lastName} (${email})`,
        `Summary: ${analysis.summary}`,
      ].join('\n'));
    }

    // Update contact properties for all reply outcomes
    if (analysis.outcome !== 'not_interested') {
      await memory.save({
        email,
        content: `[LINKEDIN REPLY] Outcome: ${analysis.outcome}. Summary: ${analysis.summary}`,
        collectionName: 'contacts',
        properties: {
          responsive: { value: true, extractMemories: false },
          sentiment: {
            value: analysis.sentiment === 'positive' ? 'Positive'
              : analysis.sentiment === 'negative' ? 'Negative'
              : 'Neutral',
            extractMemories: false,
          },
          lead_status: {
            value: analysis.outcome === 'interested' ? 'Engaged' : 'Contacted',
            extractMemories: false,
          },
        },
        tags: ['linkedin-reply', analysis.outcome],
      });
    }
  }

  // ─── CAMPAIGN COMPLETED ────────────────────────────────────────
  if (event.eventType === 'CAMPAIGN_COMPLETED') {
    await workspace.addUpdate(email, {
      author: 'heyreach',
      type: 'outreach',
      summary: `HeyReach campaign ${event.campaignId} completed for this contact.`,
    });
  }

  // ─── Account impact for significant events ─────────────────────
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy && analysis) {
    const impactOutcomes = ['interested', 'not_interested'];
    if (impactOutcomes.includes(analysis.outcome)) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain) {
        await accountWorkspace.addUpdate(domain, {
          author: 'linkedin-analyzer',
          type: 'coordination',
          summary: `LinkedIn reply from ${email}: ${analysis.outcome.toUpperCase()} — ${analysis.summary}`,
        });

        try {
          await evaluateAccountStrategy(domain);
        } catch (err) {
          log.warn('Account strategy re-evaluation failed (non-fatal)', {
            domain,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Full LinkedIn event processing: memorize → analyze (if reply) → take action.
 */
export async function processLinkedInEvent(event: LinkedInEvent): Promise<LinkedInEventAnalysis | null> {
  log.info('Processing LinkedIn event', {
    eventType: event.eventType,
    profileUrl: event.profileUrl,
    email: event.email,
    hasMessage: !!event.messageContent,
  });

  // Step 1: Always memorize the event
  await memorizeEvent(event);

  // Step 2: Analyze if it's a reply (needs AI classification)
  let analysis: LinkedInEventAnalysis | null = null;
  const replyEvents = ['MESSAGE_REPLY_RECEIVED', 'INMAIL_REPLY_RECEIVED'];

  if (replyEvents.includes(event.eventType) && event.messageContent) {
    analysis = await analyzeLinkedInReply(event);
    log.info('LinkedIn reply analyzed', {
      email: event.email,
      outcome: analysis.outcome,
      sentiment: analysis.sentiment,
    });
  }

  // For connection accepted, create a simple positive analysis
  if (event.eventType === 'CONNECTION_REQUEST_ACCEPTED') {
    analysis = {
      outcome: 'positive_signal',
      summary: 'LinkedIn connection request accepted — contact is open to engagement.',
      sentiment: 'positive',
      urgency: 'low',
      nextAction: 'Continue email sequence. Monitor for LinkedIn reply.',
      keyPoints: [],
    };
  }

  // Step 3: Take action based on event type and analysis
  await handleLinkedInEvent(event, analysis || undefined);

  return analysis;
}
