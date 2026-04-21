/**
 * Outreach Log — Tracks every outreach touch with angle-to-outcome attribution.
 *
 * Writes to the 'outreach-log' Personize collection (schema in create-schemas.ts).
 * This is the feedback loop that enables the meta-agent to learn which angles work.
 *
 * Usage:
 *   import { outreachLog } from '../lib/outreach-log.js';
 *   await outreachLog.recordSend({ ... });
 *   await outreachLog.recordEngagement(contactEmail, 'opened');
 *   await outreachLog.recordReply(contactEmail, 'positive', 'hiring-signal', 2);
 *   const metrics = await outreachLog.getAngleMetrics();
 */

import { client } from '../config.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'outreach-log' });

// ─── Types ──────────────────────────────────────────────────────────

export interface OutreachSendRecord {
  contactEmail: string;
  company?: string;
  channel: 'email' | 'phone' | 'linkedin';
  step: number;
  subject?: string;
  angle: string;
  messageId?: string;
  senderEmail?: string;
  campaignId?: string;
  variant?: string;
}

// ─── Write Functions ────────────────────────────────────────────────

/**
 * Record an outreach send in the outreach-log collection.
 * Called after every email/linkedin/call send.
 */
async function recordSend(record: OutreachSendRecord): Promise<void> {
  try {
    const stepLabel = record.channel === 'email' ? `Email ${record.step}`
      : record.channel === 'linkedin' ? 'LinkedIn Touch'
      : 'Call Task';

    await client.memory.memorize({
      email: record.contactEmail,
      collectionName: 'outreach-log',
      content: `[OUTREACH SENT] ${stepLabel} to ${record.contactEmail} — angle: "${record.angle}"${record.subject ? ` — subject: "${record.subject}"` : ''}`,
      properties: {
        contact_email: { value: record.contactEmail, extractMemories: false },
        company: { value: record.company || '', extractMemories: false },
        sequence_step: { value: stepLabel, extractMemories: false },
        channel: { value: record.channel.charAt(0).toUpperCase() + record.channel.slice(1), extractMemories: false },
        subject_line: { value: record.subject || '', extractMemories: false },
        angle_used: { value: record.angle, extractMemories: false },
        sent_at: { value: new Date().toISOString(), extractMemories: false },
        opened: { value: false, extractMemories: false },
        clicked: { value: false, extractMemories: false },
        replied: { value: false, extractMemories: false },
        outcome: { value: 'No Response', extractMemories: false },
        campaign_id: { value: record.campaignId || '', extractMemories: false },
        variant: { value: record.variant || '', extractMemories: false },
      },
      tags: [
        'outreach-log', record.channel, `step-${record.step}`, `angle:${record.angle}`,
        ...(record.campaignId ? [`campaign:${record.campaignId}`] : []),
        ...(record.variant ? [`variant:${record.variant}`] : []),
      ],
    });

    log.info('Outreach logged', {
      email: record.contactEmail,
      channel: record.channel,
      step: record.step,
      angle: record.angle,
    });
  } catch (err) {
    log.warn('Failed to log outreach (non-fatal)', { error: (err as Error).message });
  }
}

/**
 * Record an engagement event (open/click) against a contact's most recent outreach.
 */
async function recordEngagement(
  contactEmail: string,
  event: 'opened' | 'clicked',
  clickUrl?: string,
): Promise<void> {
  try {
    // Update the most recent outreach-log record for this contact
    const outcome = event === 'clicked' ? 'Clicked' : 'Opened';

    await client.memory.memorize({
      email: contactEmail,
      collectionName: 'outreach-log',
      content: `[ENGAGEMENT] ${contactEmail} ${event} the email${clickUrl ? ` — URL: ${clickUrl}` : ''}`,
      properties: {
        [event]: { value: true, extractMemories: false },
        outcome: { value: outcome, extractMemories: false },
      },
      tags: ['outreach-log', 'engagement', event],
    });

    log.info('Engagement logged', { email: contactEmail, event });
  } catch (err) {
    log.warn('Failed to log engagement (non-fatal)', { error: (err as Error).message });
  }
}

/**
 * Record a reply with sentiment and attributed angle/step.
 * This is the key attribution record — it connects angle → outcome.
 */
async function recordReply(
  contactEmail: string,
  sentiment: string,
  attributedAngle?: string,
  attributedStep?: number,
): Promise<void> {
  try {
    const sentimentLabel = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
    const outcome = sentiment === 'positive' ? 'Replied'
      : sentiment === 'negative' ? 'Rejected'
      : 'Replied';

    await client.memory.memorize({
      email: contactEmail,
      collectionName: 'outreach-log',
      content: `[REPLY] ${contactEmail} replied (${sentimentLabel})${attributedAngle ? ` to angle "${attributedAngle}" at step ${attributedStep}` : ''}`,
      properties: {
        replied: { value: true, extractMemories: false },
        reply_sentiment: { value: sentimentLabel, extractMemories: false },
        outcome: { value: outcome, extractMemories: false },
        // Store attribution for metrics queries
        content_summary: {
          value: attributedAngle
            ? `Reply to angle "${attributedAngle}" at step ${attributedStep}. Sentiment: ${sentimentLabel}.`
            : `Reply received. Sentiment: ${sentimentLabel}. No angle attribution (inReplyTo not matched).`,
          extractMemories: false,
        },
      },
      tags: [
        'outreach-log', 'reply', `sentiment:${sentiment}`,
        ...(attributedAngle ? [`angle:${attributedAngle}`] : []),
      ],
    });

    log.info('Reply logged to outreach-log', {
      email: contactEmail,
      sentiment,
      attributedAngle,
      attributedStep,
    });
  } catch (err) {
    log.warn('Failed to log reply to outreach-log (non-fatal)', { error: (err as Error).message });
  }
}

/**
 * Record a bounce against a contact's outreach.
 */
async function recordBounce(contactEmail: string): Promise<void> {
  try {
    await client.memory.memorize({
      email: contactEmail,
      collectionName: 'outreach-log',
      content: `[BOUNCE] Email to ${contactEmail} bounced`,
      properties: {
        outcome: { value: 'Bounced', extractMemories: false },
      },
      tags: ['outreach-log', 'bounce'],
    });
  } catch (err) {
    log.warn('Failed to log bounce (non-fatal)', { error: (err as Error).message });
  }
}

// ─── Export ──────────────────────────────────────────────────────────

export const outreachLog = {
  recordSend,
  recordEngagement,
  recordReply,
  recordBounce,
};
