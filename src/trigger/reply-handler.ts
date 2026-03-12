import { task } from "@trigger.dev/sdk/v3";
import { analyzeReply, handleAnalyzedReply } from '../pipelines/analyze-reply.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';

/**
 * Analyzes a lead's reply and takes action based on sentiment.
 * Triggered by the engagement webhook when a reply is detected.
 *
 * Flow:
 *   Reply webhook → engagement-webhook task → triggers this task
 *   → AI classifies reply → different actions per sentiment
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
  }) => {
    logger.info('Analyzing reply', { email: payload.email });

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

    return {
      email: payload.email,
      sentiment: analysis.sentiment,
      summary: analysis.summary,
      urgency: analysis.urgency,
      nextAction: analysis.nextAction,
      referredContact: analysis.referredContact,
      timestamp: new Date().toISOString(),
    };
  },
});
