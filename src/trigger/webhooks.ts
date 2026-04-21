import { task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { memory } from '../lib/memory.js';
import { workspace } from '../lib/workspace.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { replyHandlerTask } from './reply-handler.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';
import { outreachLog } from '../lib/outreach-log.js';

// HubSpot CRM update — triggered by webhook
export const hubspotWebhookTask = task({
  id: "hubspot-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("hubspot-webhook", ctx.run.id, error);
  },
  run: async (payload: { objectType: string; objectId: string; propertyName: string; propertyValue: string }, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "hubspot-webhook" }, async () => {
      if (!payload.objectType || !payload.propertyName) {
        logger.warn('Malformed webhook payload, skipping', { payload });
        return { processed: false, reason: 'malformed_payload' };
      }

      if (payload.objectType === 'DEAL' && payload.propertyName === 'dealstage') {
        await memory.save({
          content: `[CRM EVENT] Deal ${payload.objectId} stage changed to: ${payload.propertyValue}`,
          enhanced: true,
          tags: ['crm', 'hubspot', 'deal-update'],
        });
        return { processed: true, event: 'deal_stage_change' };
      }

      return { processed: false, reason: 'unhandled_event' };
    });
  },
});

// Email engagement (open/click/reply/bounce/unsubscribe) — triggered by SendGrid webhook
export const engagementWebhookTask = task({
  id: "engagement-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("engagement-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    email: string;
    event: string;
    url?: string;
    subject?: string;
    body?: string;
    timestamp?: string;
  }) => {
    if (!payload.email || !payload.event) {
      logger.warn('Malformed engagement payload, skipping', { payload });
      return { processed: false, reason: 'malformed_payload' };
    }

    const idempotencyKey = `engagement-${payload.email}-${payload.event}-${payload.timestamp || Date.now()}`;
    const eventUpper = payload.event.toUpperCase();

    // Write structured update to workspace
    await workspace.addUpdate(payload.email, {
      author: 'engagement-webhook',
      type: 'engagement',
      summary: `Email ${eventUpper}${payload.url ? ` — clicked: ${payload.url}` : ''}`,
      details: payload.subject ? `Subject: ${payload.subject}` : undefined,
    });

    // ─── Reply ─────────────────────────────────────────────────
    if (payload.event === 'reply') {
      // Record the raw reply immediately
      await workspace.addNote(payload.email, {
        author: 'engagement-webhook',
        content: `Reply received. ${payload.body ? `Preview: ${payload.body.substring(0, 500)}` : 'Body not captured — check inbox.'}`,
        category: 'reply-analysis',
      });

      await workspace.rewriteContext(payload.email, [
        'Sequence Status: REPLIED — analyzing reply...',
        `Reply received: ${new Date().toISOString().split('T')[0]}`,
      ].join('\n'), 'engagement-webhook');

      // Trigger AI reply analysis (classifies sentiment, creates CRM tasks, notifies rep)
      if (payload.body) {
        await replyHandlerTask.trigger({
          email: payload.email,
          crmId: '', // Will be looked up by reply handler if needed
          replyBody: payload.body,
          replySubject: payload.subject,
        });
        logger.info('Triggered reply analysis', { email: payload.email });
      } else {
        // No body captured — create generic task for human review
        await workspace.addTask(payload.email, {
          title: 'Reply received — check inbox and respond',
          description: 'Reply body not captured by webhook. Check your inbox for the full reply and respond accordingly.',
          status: 'pending',
          owner: 'sales-rep',
          createdBy: 'engagement-webhook',
          priority: 'urgent',
          dueDate: new Date(Date.now() + 3600_000).toISOString(),
        });

        await notifySlack(
          `*Reply received!*\nFrom: ${payload.email}\nAction: Check inbox — reply body not captured by webhook`
        );
      }
    }

    // ─── Bounce ────────────────────────────────────────────────
    if (payload.event === 'bounce') {
      await workspace.raiseIssue(payload.email, {
        title: 'Email bounced',
        description: 'Email delivery failed. The address may be invalid or the mailbox full.',
        severity: 'high',
        status: 'open',
        raisedBy: 'engagement-webhook',
      });

      await workspace.rewriteContext(payload.email, [
        'Sequence Status: BOUNCED — email delivery failed.',
        'Action: Verify email address or find alternative contact.',
      ].join('\n'), 'engagement-webhook');

      // Track in outreach-log for attribution metrics
      await outreachLog.recordBounce(payload.email);
    }

    // ─── Unsubscribe / Spam Report ���────────────────────────────
    if (payload.event === 'unsubscribe' || payload.event === 'spamreport') {
      // Soft-delete: all read paths automatically exclude this record
      await workspace.softDelete(
        payload.email,
        payload.event === 'spamreport' ? 'spam_report' : 'unsubscribe',
        'engagement-webhook',
      );

      await workspace.rewriteContext(payload.email, [
        `Sequence Status: STOPPED (${payload.event}).`,
        'Action: Do not contact again.',
      ].join('\n'), 'engagement-webhook');

      await notifySlack(
        `*${payload.event === 'spamreport' ? 'SPAM REPORT' : 'Unsubscribe'}* from ${payload.email} — record soft-deleted from all queries.`
      );
    }

    // ─── Open / Click (positive signal) ────────────────────────
    if (payload.event === 'open' || payload.event === 'click') {
      // Track engagement in outreach-log for angle attribution metrics
      await outreachLog.recordEngagement(
        payload.email,
        payload.event === 'click' ? 'clicked' : 'opened',
        payload.url,
      );

      const state = await workspace.getSequenceState(payload.email);
      if (!state.hasReplied && !state.hasOptedOut) {
        await workspace.rewriteContext(payload.email, [
          `Sequence Status: Email ${state.emailsSent} sent. Lead ${eventUpper} the email.`,
          payload.event === 'click' ? `Clicked: ${payload.url}` : '',
          'Signal: Interested — prioritize next touchpoint.',
        ].filter(Boolean).join('\n'), 'engagement-webhook');
      }
    }

    return { processed: true, event: payload.event };
  },
});
