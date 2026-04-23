import { task } from "@trigger.dev/sdk/v3";
import { analyzeReply, handleAnalyzedReply } from '../pipelines/analyze-reply.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';
import { workspace } from '../lib/workspace.js';
import { outreachLog } from '../lib/outreach-log.js';

/**
 * Analyzes a lead's reply and takes action based on sentiment.
 * Triggered by the engagement webhook when a reply is detected.
 *
 * Flow:
 *   Reply webhook → engagement-webhook task → triggers this task
 *   → Attribute reply to sent message (via inReplyTo) → AI classifies reply → actions per sentiment
 */
export const replyHandlerTask = task({
  id: "reply-handler",
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000 },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`reply-handler (${payload.email})`, ctx.run.id, error);
  },
  run: async (payload: {
    email: string;
    crmId: string;
    replyBody: string;
    replySubject?: string;
    /** In-Reply-To header from the inbound email — used to attribute reply to a specific outreach step/angle. */
    inReplyTo?: string;
  }) => {
    logger.info('Analyzing reply', { email: payload.email, inReplyTo: payload.inReplyTo });

    // ── Attribution: link reply to the specific outreach message that triggered it ──
    let attributedAngle: string | undefined;
    let attributedStep: number | undefined;
    let attributedMessageId: string | undefined;

    if (payload.inReplyTo) {
      const originalMessage = await workspace.findMessageByMessageId(payload.email, payload.inReplyTo);
      if (originalMessage) {
        attributedAngle = originalMessage.angle;
        attributedStep = originalMessage.step;
        attributedMessageId = originalMessage.messageId;
        logger.info('Reply attributed to outreach message', {
          email: payload.email,
          angle: attributedAngle,
          step: attributedStep,
        });
      } else {
        logger.info('inReplyTo header present but no matching sent message found', {
          email: payload.email,
          inReplyTo: payload.inReplyTo,
        });
      }
    }

    const analysis = await analyzeReply(
      payload.email,
      payload.replyBody,
      payload.replySubject,
    );

    logger.info('Reply classified', { sentiment: analysis.sentiment, summary: analysis.summary, nextAction: analysis.nextAction });

    await handleAnalyzedReply(
      payload.email,
      payload.crmId,
      analysis,
      payload.replyBody,
    );

    // Write to outreach-log for angle-to-outcome attribution (feedback loop)
    await outreachLog.recordReply(
      payload.email,
      analysis.sentiment,
      attributedAngle,
      attributedStep,
    );

    // Increment campaign stats if contact belongs to a campaign
    try {
      const { campaigns: campaignLib } = await import('../lib/campaign.js');
      const { client: pzClient } = await import('../config.js');
      const contactProps = await pzClient.memory.properties({
        email: payload.email,
        type: 'Contact',
        propertyNames: ['campaign_id'],
        nonEmpty: true,
      });
      const campaignId = (contactProps.data as any)?.properties?.find(
        (p: any) => p.systemName === 'campaign_id'
      )?.value;

      if (campaignId) {
        await campaignLib.incrementStat(campaignId, 'replies');
        if (analysis.sentiment === 'positive') {
          await campaignLib.incrementStat(campaignId, 'positive_replies');
        }
        if (analysis.nextAction?.toLowerCase().includes('meeting') || analysis.nextAction?.toLowerCase().includes('call')) {
          await campaignLib.incrementStat(campaignId, 'meetings_booked');
        }
        // Check if reply analysis led to opt-out (handled by handleAnalyzedReply setting sequence_status)
        if (analysis.sentiment === 'negative' && analysis.nextAction?.toLowerCase().includes('opt')) {
          await campaignLib.incrementStat(campaignId, 'opted_out');
        }
      }
    } catch (err) {
      logger.warn('Campaign stat increment failed (non-fatal)', { email: payload.email, error: (err as Error).message });
    }

    return {
      email: payload.email,
      sentiment: analysis.sentiment,
      summary: analysis.summary,
      urgency: analysis.urgency,
      nextAction: analysis.nextAction,
      referredContact: analysis.referredContact,
      // Attribution data — closes the feedback loop
      attribution: {
        inReplyTo: payload.inReplyTo || null,
        matchedMessageId: attributedMessageId || null,
        angle: attributedAngle || null,
        step: attributedStep || null,
      },
      timestamp: new Date().toISOString(),
    };
  },
});
