/**
 * Reply Analysis Pipeline
 *
 * When a lead replies to an outreach email, this pipeline:
 * 1. Reads the full workspace context (who is this person, what did we send)
 * 2. Classifies the reply sentiment via AI
 * 3. Takes different actions based on classification:
 *
 *    POSITIVE  → Create HubSpot task "Schedule call", update lead status, Slack alert
 *    QUESTION  → Create HubSpot task "Answer question", draft suggested reply
 *    NEGATIVE  → Mark opted out, update lead status, no further contact
 *    OOO       → Reschedule sequence for return date
 *    REFERRAL  → Create task to follow up with referred person
 *    NEUTRAL   → Create task for rep to review
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { workspace } from '../lib/workspace.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { evaluateAccountStrategy } from './account-strategy.js';
import { createHubSpotFollowUpTask } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { REPLY_ANALYSIS_SCHEMA, REPLY_ANALYSIS_DEFAULTS } from '../lib/llm-schemas.js';
import { ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'analyze-reply' });

// ─── Types ─────────────────────────────────────────────────────────

export type ReplySentiment = 'positive' | 'question' | 'negative' | 'ooo' | 'referral' | 'neutral';

export interface ReplyAnalysis {
  sentiment: ReplySentiment;
  summary: string;
  suggestedResponse: string;
  keyPoints: string[];
  urgency: 'high' | 'medium' | 'low';
  nextAction: string;
  returnDate?: string; // for OOO replies
  referredContact?: string; // for referral replies
}

// ─── Analyze ───────────────────────────────────────────────────────

export async function analyzeReply(
  contactEmail: string,
  replyBody: string,
  replySubject?: string,
): Promise<ReplyAnalysis> {
  // Read full workspace context: who is this person, what did we send, what do we know
  const [digest, guidelines] = await Promise.all([
    workspace.getDigest(contactEmail, 3000),
    client.context.retrieve({
      message: 'reply handling, outreach playbook, brand voice, competitor policy',
      types: ['guideline'],
      mode: 'fast',
    }),
  ]);

  const context = [
    '## GOVERNANCE\n' + (guidelines.data?.compiledContext || ''),
    '## LEAD WORKSPACE\n' + ((digest as any)?.compiledContext || ''),
    '## INCOMING REPLY\n' +
      (replySubject ? `Subject: ${replySubject}\n` : '') +
      `Body:\n${replyBody}`,
  ].join('\n\n---\n\n');

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this reply from the lead. Classify it and determine the right response.

Classification guide:
- POSITIVE: interested, wants to learn more, agrees to a meeting, asks for pricing, says "send me info"
- QUESTION: asks a specific question but hasn't committed (e.g. "how does this work with X?")
- NEGATIVE: not interested, stop emailing, wrong person, don't contact again
- OOO: out of office / auto-reply / on vacation
- REFERRAL: redirects to someone else ("talk to my colleague Sarah")
- NEUTRAL: vague or unclear intent

For suggested_response: draft a response following brand voice guidelines — only if sentiment is positive, question, or referral. For negative/ooo, write "N/A".
For return_date: if OOO, extract in YYYY-MM-DD format, otherwise "N/A".
For referred_contact: if referral, extract name/email, otherwise "N/A".
${buildJsonInstruction(REPLY_ANALYSIS_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(result.data || '');
  const { data: parsed } = parseLLMJson(output, REPLY_ANALYSIS_SCHEMA, REPLY_ANALYSIS_DEFAULTS);

  const sentiment = parsed.sentiment as ReplySentiment;
  const suggestedResponse = parsed.suggested_response === 'N/A' ? '' : parsed.suggested_response;
  const returnDate = parsed.return_date === 'N/A' ? undefined : parsed.return_date;
  const referredContact = parsed.referred_contact === 'N/A' ? undefined : parsed.referred_contact;

  return {
    sentiment,
    summary: parsed.summary,
    suggestedResponse,
    keyPoints: parsed.key_points as string[],
    urgency: parsed.urgency as 'high' | 'medium' | 'low',
    nextAction: parsed.next_action,
    returnDate,
    referredContact,
  };
}

// ─── Act on Analysis ───────────────────────────────────────────────

export async function handleAnalyzedReply(
  contactEmail: string,
  crmId: string,
  analysis: ReplyAnalysis,
  replyBody: string,
) {
  const ownerId = process.env.HUBSPOT_OWNER_ID || '';

  // Store the full analysis in workspace
  await workspace.addNote(contactEmail, {
    author: 'reply-analyzer',
    content: [
      `Reply Analysis:`,
      `Sentiment: ${analysis.sentiment.toUpperCase()}`,
      `Summary: ${analysis.summary}`,
      `Key Points: ${analysis.keyPoints.join(', ')}`,
      `Urgency: ${analysis.urgency}`,
      `Next Action: ${analysis.nextAction}`,
      analysis.suggestedResponse ? `Suggested Response: ${analysis.suggestedResponse}` : '',
    ].filter(Boolean).join('\n'),
    category: 'reply-analysis',
  });

  // ─── POSITIVE: interested, wants a call/demo ─────────────────
  if (analysis.sentiment === 'positive') {
    await workspace.addTask(contactEmail, {
      title: 'Lead interested — schedule call',
      description: [
        `Reply summary: ${analysis.summary}`,
        `Key points: ${analysis.keyPoints.join(', ')}`,
        `Suggested response: ${analysis.suggestedResponse || 'Craft a personal response confirming the meeting.'}`,
        `\nAction: ${analysis.nextAction}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'reply-analyzer',
      priority: 'urgent',
      dueDate: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
    });

    if (crmId && ownerId) {
      await createHubSpotFollowUpTask({
        contactId: crmId,
        ownerId,
        subject: `Positive Reply — ${analysis.nextAction}`,
        body: [
          `Lead replied with interest!`,
          ``,
          `**Reply Summary:** ${analysis.summary}`,
          `**Key Points:** ${analysis.keyPoints.join(', ')}`,
          ``,
          `**Suggested Response:**`,
          analysis.suggestedResponse || 'Craft a personal response confirming next steps.',
          ``,
          `---`,
          `**Original Reply:**`,
          replyBody.substring(0, 1000),
        ].join('\n'),
        priority: 'HIGH',
        taskType: 'CALL',
      });
    }

    await workspace.rewriteContext(contactEmail, [
      'Status: POSITIVE REPLY — Lead interested!',
      'Priority: URGENT — respond within 1 hour.',
      `Summary: ${analysis.summary}`,
      `Next: ${analysis.nextAction}`,
    ].join('\n'), 'reply-analyzer');

    await notifySlack([
      `*Positive reply!* 🟢`,
      `From: ${contactEmail}`,
      `Summary: ${analysis.summary}`,
      `Action: ${analysis.nextAction}`,
      `Priority: Respond within 1 hour`,
    ].join('\n'));
  }

  // ─── QUESTION: interested but needs info ─────────────────────
  if (analysis.sentiment === 'question') {
    await workspace.addTask(contactEmail, {
      title: 'Lead asked a question — answer and advance',
      description: [
        `Reply summary: ${analysis.summary}`,
        `Key points: ${analysis.keyPoints.join(', ')}`,
        `Suggested response: ${analysis.suggestedResponse || 'Answer their question with specifics, then suggest a call.'}`,
        `\nAction: ${analysis.nextAction}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'reply-analyzer',
      priority: 'high',
      dueDate: new Date(Date.now() + 4 * 3600_000).toISOString(), // 4 hours
    });

    if (crmId && ownerId) {
      await createHubSpotFollowUpTask({
        contactId: crmId,
        ownerId,
        subject: `Question from Lead — ${analysis.keyPoints[0] || 'needs response'}`,
        body: [
          `Lead asked a question in their reply.`,
          ``,
          `**Question Summary:** ${analysis.summary}`,
          ``,
          `**Suggested Response:**`,
          analysis.suggestedResponse || 'Answer the question directly, then pivot to scheduling a call.',
          ``,
          `---`,
          `**Original Reply:**`,
          replyBody.substring(0, 1000),
        ].join('\n'),
        priority: 'HIGH',
        taskType: 'EMAIL',
      });
    }

    await workspace.rewriteContext(contactEmail, [
      'Status: QUESTION — Lead engaged, needs more info.',
      'Priority: HIGH — respond within 4 hours.',
      `Question: ${analysis.summary}`,
      `Next: ${analysis.nextAction}`,
    ].join('\n'), 'reply-analyzer');

    await notifySlack([
      `*Question from lead* 🟡`,
      `From: ${contactEmail}`,
      `Question: ${analysis.summary}`,
      `Action: Answer and advance`,
    ].join('\n'));
  }

  // ─── NEGATIVE: not interested ────────────────────────────────
  if (analysis.sentiment === 'negative') {
    await workspace.raiseIssue(contactEmail, {
      title: 'Lead declined — do not contact',
      description: `Reply: "${analysis.summary}". Reason: ${analysis.keyPoints.join(', ') || 'not interested'}. Remove from all sequences and do NOT send further outreach.`,
      severity: 'critical',
      status: 'open',
      raisedBy: 'reply-analyzer',
    });

    await workspace.addUpdate(contactEmail, {
      author: 'reply-analyzer',
      type: 'engagement',
      summary: `Negative reply: ${analysis.summary}. Marked as opted out.`,
    });

    await workspace.rewriteContext(contactEmail, [
      'Status: OPTED OUT — Negative reply received.',
      `Reason: ${analysis.summary}`,
      'Action: Do not contact again. All sequences stopped.',
    ].join('\n'), 'reply-analyzer');

    // Update lead status in Personize memory
    await memory.save({
      email: contactEmail,
      content: `[LEAD STATUS UPDATE] Opted out. Reason: ${analysis.summary}`,
      collectionName: 'contacts',
      properties: {
        lead_status: { value: 'Disqualified', extractMemories: false },
        outreach_stage: { value: 'Opted Out', extractMemories: false },
        responsive: { value: true, extractMemories: false },
        sentiment: { value: 'Negative', extractMemories: false },
      },
      tags: ['opted-out', 'negative-reply'],
    });

    await notifySlack([
      `*Negative reply* 🔴`,
      `From: ${contactEmail}`,
      `Reason: ${analysis.summary}`,
      `Action: Removed from sequences. No further contact.`,
    ].join('\n'));
  }

  // ─── OOO: out of office ──────────────────────────────────────
  if (analysis.sentiment === 'ooo') {
    const returnDate = analysis.returnDate || 'unknown';

    await workspace.addTask(contactEmail, {
      title: `Reschedule outreach — lead is OOO until ${returnDate}`,
      description: `Auto-reply detected. ${analysis.summary}. Resume sequence after they return.`,
      status: 'pending',
      owner: 'outreach-agent',
      createdBy: 'reply-analyzer',
      priority: 'low',
      dueDate: analysis.returnDate || undefined,
    });

    await workspace.rewriteContext(contactEmail, [
      `Status: OUT OF OFFICE until ${returnDate}.`,
      'Action: Sequence paused. Will resume after return date.',
      `Note: ${analysis.summary}`,
    ].join('\n'), 'reply-analyzer');
  }

  // ─── REFERRAL: talk to someone else ──────────────────────────
  if (analysis.sentiment === 'referral') {
    await workspace.addTask(contactEmail, {
      title: `Follow up with referral: ${analysis.referredContact || 'see reply'}`,
      description: [
        `Original contact referred us to someone else.`,
        `Referred: ${analysis.referredContact || 'Not specified'}`,
        `Summary: ${analysis.summary}`,
        `Suggested response: ${analysis.suggestedResponse || 'Thank them and reach out to the referred contact.'}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'reply-analyzer',
      priority: 'high',
      dueDate: new Date(Date.now() + 24 * 3600_000).toISOString(), // 24 hours
    });

    if (crmId && ownerId) {
      await createHubSpotFollowUpTask({
        contactId: crmId,
        ownerId,
        subject: `Referral received — contact ${analysis.referredContact || 'see reply'}`,
        body: [
          `Lead referred us to someone else.`,
          ``,
          `**Referred to:** ${analysis.referredContact || 'Not specified — check reply'}`,
          `**Context:** ${analysis.summary}`,
          ``,
          `**Action:** Thank the original contact, then add the referral as a new lead.`,
          ``,
          `---`,
          `**Original Reply:**`,
          replyBody.substring(0, 1000),
        ].join('\n'),
        priority: 'HIGH',
        taskType: 'EMAIL',
      });
    }

    await workspace.rewriteContext(contactEmail, [
      'Status: REFERRAL — Lead redirected to another person.',
      `Referred: ${analysis.referredContact || 'See reply'}`,
      `Action: Thank this contact, then reach out to the referred person.`,
    ].join('\n'), 'reply-analyzer');

    await notifySlack([
      `*Referral received* 🔵`,
      `From: ${contactEmail}`,
      `Referred to: ${analysis.referredContact || 'see reply'}`,
      `Action: Thank and follow up with the referral`,
    ].join('\n'));
  }

  // ─── NEUTRAL: unclear intent ─────────────────────────────────
  if (analysis.sentiment === 'neutral') {
    await workspace.addTask(contactEmail, {
      title: 'Review ambiguous reply',
      description: [
        `Reply didn't clearly indicate interest or disinterest.`,
        `Summary: ${analysis.summary}`,
        `Key points: ${analysis.keyPoints.join(', ')}`,
        `Suggested response: ${analysis.suggestedResponse || 'Read the full reply and decide on next steps.'}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'reply-analyzer',
      priority: 'medium',
    });

    await workspace.rewriteContext(contactEmail, [
      'Status: REPLIED (neutral) — needs human review.',
      `Summary: ${analysis.summary}`,
      'Action: Sales rep to review reply and decide next steps.',
    ].join('\n'), 'reply-analyzer');
  }

  // ─── Account impact assessment ─────────────────────────────────
  // Re-evaluate account strategy when a reply materially changes the picture
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const replyLog = logger.child({ pipeline: 'reply-account-impact' });
    const impactSentiments: ReplySentiment[] = ['positive', 'negative', 'referral'];
    if (impactSentiments.includes(analysis.sentiment)) {
      const domain = contactEmail.split('@')[1]?.toLowerCase();
      if (domain) {
        replyLog.info('Reply triggers account strategy re-evaluation', {
          email: contactEmail,
          sentiment: analysis.sentiment,
          domain,
        });

        // Record the reply at account level
        await accountWorkspace.addUpdate(domain, {
          author: 'reply-analyzer',
          type: 'coordination',
          summary: `Reply from ${contactEmail}: ${analysis.sentiment.toUpperCase()} — ${analysis.summary}`,
          details: analysis.sentiment === 'negative'
            ? 'Evaluating if this is an account-level rejection or contact-level only.'
            : analysis.sentiment === 'referral'
            ? `Referral to: ${analysis.referredContact || 'unknown'}. New contact should get warm intro, not cold sequence.`
            : `Positive signal — may upgrade account stage.`,
        });

        // Re-run account strategy to update coordination flags
        try {
          await evaluateAccountStrategy(domain);
        } catch (err) {
          replyLog.warn('Account strategy re-evaluation failed (non-fatal)', {
            domain,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // ─── Always: update contact properties ───────────────────────
  if (analysis.sentiment !== 'negative') {
    await memory.save({
      email: contactEmail,
      content: `[REPLY RECEIVED] Sentiment: ${analysis.sentiment}. Summary: ${analysis.summary}`,
      collectionName: 'contacts',
      properties: {
        responsive: { value: true, extractMemories: false },
        sentiment: {
          value: analysis.sentiment === 'positive' ? 'Positive'
            : analysis.sentiment === 'question' ? 'Neutral'
            : 'Neutral',
          extractMemories: false,
        },
        lead_status: {
          value: analysis.sentiment === 'positive' ? 'Engaged'
            : analysis.sentiment === 'question' ? 'Contacted'
            : analysis.sentiment === 'referral' ? 'Contacted'
            : 'Contacted',
          extractMemories: false,
        },
        outreach_stage: { value: 'Replied', extractMemories: false },
      },
      tags: ['reply', analysis.sentiment],
    });
  }

  // ─── Sales Org: Check for role handoff ──────────────────────
  try {
    const { SALES_ORG_CONFIG } = await import('../config/prospecting.config.js');
    if (SALES_ORG_CONFIG.enabled && (analysis.sentiment === 'positive' || analysis.sentiment === 'question')) {
      const currentRole = await workspace.getRoleOwner(contactEmail);
      if (currentRole && currentRole !== 'unassigned') {
        const { getHandoffTarget } = await import('../config/sales-roles.js');
        const newStatus = analysis.sentiment === 'positive' ? 'Engaged' : 'Contacted';
        const handoff = getHandoffTarget(currentRole, newStatus);

        if (handoff) {
          const { processHandoff } = await import('./process-handoff.js');
          await processHandoff(
            contactEmail,
            currentRole,
            handoff.toRole,
            `${analysis.sentiment} reply: ${analysis.summary}`,
            [
              `Sentiment: ${analysis.sentiment}`,
              `Key points: ${analysis.keyPoints.join(', ')}`,
              `Suggested response: ${analysis.suggestedResponse || ''}`,
              `Next action: ${analysis.nextAction}`,
            ].join('\n'),
          );
        }
      }
    }
  } catch (err) {
    log.warn('Handoff processing failed', { error: String(err), contactEmail });
  }

  return analysis;
}
