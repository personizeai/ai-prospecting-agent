/**
 * Clay.com Webhook Trigger Task
 *
 * Receives enriched records from Clay via HTTP POST.
 *
 * Setup:
 *   1. Set CLAY_ENABLED=true in your .env
 *   2. Deploy to Trigger.dev: npm run deploy
 *   3. In Trigger.dev dashboard → Tasks → "clay-webhook" → copy the webhook URL
 *   4. In Clay → your table → Add Action → HTTP POST:
 *      - URL: paste the Trigger.dev webhook URL
 *      - Method: POST
 *      - Headers: Content-Type: application/json
 *      - (Optional) X-Webhook-Secret: your CLAY_WEBHOOK_SECRET value
 *      - Body: Select columns to include (or "All columns")
 *   5. Run your Clay table — enriched rows flow into Personize automatically
 *
 * Payload format:
 *   Single row:  { "email": "...", "first_name": "...", ... }
 *   Batch:       [{ "email": "..." }, { "email": "..." }, ...]
 *
 * The task validates the webhook secret (if configured), transforms Clay
 * columns to Personize properties, and batch-memorizes into the configured
 * collection (contacts or companies).
 */

import { task } from "@trigger.dev/sdk/v3";
import { CLAY_CONFIG } from '../config/prospecting.config.js';
import { ingestClayWebhook } from '../pipelines/sync-clay.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

export const clayWebhookTask = task({
  id: "clay-webhook",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("clay-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    /** The Clay row(s) — single object or array. */
    data: Record<string, any> | Record<string, any>[];
    /** Webhook secret for verification (sent as X-Webhook-Secret header by Clay). */
    secret?: string;
  }, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "clay-webhook" }, async () => {
      // ─── Gate: Clay must be enabled ───────────────────────────
      if (!CLAY_CONFIG.enabled) {
        logger.warn('Clay webhook received but CLAY_ENABLED is not true, ignoring');
        return { processed: 0, skipped: 0, status: 'disabled' };
      }

      // ─── Gate: Verify webhook secret ──────────────────────────
      if (CLAY_CONFIG.webhookSecret && payload.secret !== CLAY_CONFIG.webhookSecret) {
        logger.warn('Clay webhook secret mismatch, rejecting');
        return { processed: 0, skipped: 0, status: 'unauthorized' };
      }

      // ─── Process rows ─────────────────────────────────────────
      if (!payload.data) {
        logger.warn('Clay webhook has no data field', { keys: Object.keys(payload) });

        // Try treating the entire payload as data (Clay might not wrap in a "data" field)
        const rawPayload = { ...payload } as Record<string, any>;
        delete rawPayload.secret;

        if (Object.keys(rawPayload).length === 0) {
          return { processed: 0, skipped: 0, status: 'empty_payload' };
        }

        const result = await ingestClayWebhook(rawPayload);
        return { ...result, status: 'ok' };
      }

      const result = await ingestClayWebhook(payload.data);
      return { ...result, status: 'ok' };
    });
  },
});
