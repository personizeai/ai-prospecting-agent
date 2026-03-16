/**
 * HeyReach LinkedIn Webhook Receiver
 *
 * Receives webhook events from HeyReach when LinkedIn actions occur:
 *   - CONNECTION_REQUEST_ACCEPTED — they accepted our connection
 *   - MESSAGE_REPLY_RECEIVED     — they replied to our LinkedIn message
 *   - INMAIL_REPLY_RECEIVED      — they replied to our InMail
 *   - CAMPAIGN_COMPLETED         — HeyReach campaign finished for this lead
 *   - CONNECTION_REQUEST_SENT    — we sent a connection request (tracking)
 *   - MESSAGE_SENT               — we sent a message (tracking)
 *   - And other event types (FOLLOW_SENT, LIKED_POST, VIEWED_PROFILE, LEAD_TAG_UPDATED)
 *
 * Setup in HeyReach:
 *   1. Go to HeyReach → Integrations → Webhooks → "View and Create"
 *   2. Create a webhook pointing at this task's Trigger.dev URL
 *   3. Select the campaign(s) and event type(s) to trigger on
 *   4. All event types can point to the same URL — this handler routes by eventType
 *
 * HeyReach webhook docs: https://help.heyreach.io/en/articles/9877965-webhooks
 * API: https://api.heyreach.io/api/public
 * Auth for outbound calls: X-API-KEY header
 * Rate limit: 300 req/min
 *
 * Webhook event types (from Composio + Make docs):
 *   CONNECTION_REQUEST_SENT, CONNECTION_REQUEST_ACCEPTED,
 *   MESSAGE_SENT, MESSAGE_REPLY_RECEIVED,
 *   INMAIL_SENT, INMAIL_REPLY_RECEIVED,
 *   FOLLOW_SENT, LIKED_POST, VIEWED_PROFILE,
 *   CAMPAIGN_COMPLETED, LEAD_TAG_UPDATED
 */

import { task } from "@trigger.dev/sdk/v3";
import { processLinkedInEvent } from '../pipelines/analyze-linkedin-event.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';
import type { LinkedInEvent, HeyReachEventType } from '../types.js';

const log = logger.child({ pipeline: 'heyreach-webhook' });

/** Valid event types we process. */
const VALID_EVENT_TYPES = new Set<HeyReachEventType>([
  'CONNECTION_REQUEST_SENT',
  'CONNECTION_REQUEST_ACCEPTED',
  'MESSAGE_SENT',
  'MESSAGE_REPLY_RECEIVED',
  'INMAIL_SENT',
  'INMAIL_REPLY_RECEIVED',
  'FOLLOW_SENT',
  'LIKED_POST',
  'VIEWED_PROFILE',
  'CAMPAIGN_COMPLETED',
  'LEAD_TAG_UPDATED',
]);

/** Events that are actionable (we memorize + analyze + act). */
const ACTIONABLE_EVENTS = new Set<HeyReachEventType>([
  'CONNECTION_REQUEST_ACCEPTED',
  'MESSAGE_REPLY_RECEIVED',
  'INMAIL_REPLY_RECEIVED',
  'CAMPAIGN_COMPLETED',
]);

/** Events we memorize but don't deeply analyze (tracking only). */
const TRACKING_EVENTS = new Set<HeyReachEventType>([
  'CONNECTION_REQUEST_SENT',
  'MESSAGE_SENT',
  'INMAIL_SENT',
  'FOLLOW_SENT',
  'LIKED_POST',
  'VIEWED_PROFILE',
  'LEAD_TAG_UPDATED',
]);

/**
 * HeyReach LinkedIn webhook receiver.
 *
 * HeyReach webhook payload structure (derived from Make triggers, Zapier actions,
 * n8n integration guide, and MCP server source):
 *
 * The exact field names may vary by event type. Common fields:
 *   - eventType / event_type: The webhook event type string
 *   - campaignId / campaign_id: HeyReach campaign ID
 *   - profileUrl / profile_url / linkedInUrl: Lead's LinkedIn URL
 *   - linkedInId / linkedin_id / memberId: Lead's LinkedIn member ID
 *   - firstName / first_name: Lead first name
 *   - lastName / last_name: Lead last name
 *   - email / emailAddress: Lead email
 *   - company: Lead company
 *   - message / messageContent: Message text (for reply events)
 *   - conversationId / conversation_id: LinkedIn conversation ID
 *   - linkedInAccountId / sender_id: Sender account ID
 */
export const heyreachLinkedInWebhookTask = task({
  id: "heyreach-linkedin-webhook",
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("heyreach-linkedin-webhook", ctx.run.id, error);
  },
  run: async (payload: Record<string, unknown>, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "heyreach-linkedin-webhook" }, async () => {

      // ─── Normalize field names ────────────────────────────────
      // HeyReach may use camelCase or snake_case depending on the event.
      // We handle both to be robust.

      const eventType = String(
        payload.eventType || payload.event_type || payload.type || ''
      ).toUpperCase() as HeyReachEventType;

      if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
        log.info('HeyReach webhook: unknown or missing event type, skipping', {
          eventType,
          payloadKeys: Object.keys(payload),
        });
        return { processed: false, reason: `unknown_event_type:${eventType}` };
      }

      // Normalize the event
      const event: LinkedInEvent = {
        eventType,
        campaignId: String(payload.campaignId || payload.campaign_id || ''),
        profileUrl: String(
          payload.profileUrl || payload.profile_url || payload.linkedInUrl || payload.linkedin_url || ''
        ),
        linkedInId: String(
          payload.linkedInId || payload.linkedin_id || payload.memberId || payload.member_id || ''
        ),
        firstName: String(payload.firstName || payload.first_name || ''),
        lastName: String(payload.lastName || payload.last_name || ''),
        email: String(payload.email || payload.emailAddress || payload.email_address || ''),
        company: String(payload.company || ''),
        messageContent: String(
          payload.message || payload.messageContent || payload.message_content || ''
        ),
        conversationId: String(
          payload.conversationId || payload.conversation_id || ''
        ),
        senderAccountId: String(
          payload.linkedInAccountId || payload.linkedin_account_id || payload.senderId || payload.sender_id || ''
        ),
        rawPayload: payload,
      };

      // Clean up empty-string fields that were just '' from missing data
      if (event.profileUrl === 'undefined' || event.profileUrl === 'null') event.profileUrl = '';
      if (event.email === 'undefined' || event.email === 'null') event.email = '';

      if (!event.profileUrl && !event.email && !event.linkedInId) {
        log.warn('HeyReach webhook: no identifier (profileUrl, email, or linkedInId), skipping', {
          eventType,
        });
        return { processed: false, reason: 'no_lead_identifier' };
      }

      log.info('HeyReach webhook received', {
        eventType: event.eventType,
        profileUrl: event.profileUrl,
        email: event.email,
        hasMessage: !!event.messageContent,
        campaignId: event.campaignId,
      });

      // ─── Process the event ────────────────────────────────────
      // Actionable events get full pipeline treatment (memorize + analyze + act).
      // Tracking events just get memorized for the memory loop.

      if (ACTIONABLE_EVENTS.has(eventType) || TRACKING_EVENTS.has(eventType)) {
        const analysis = await processLinkedInEvent(event);

        return {
          processed: true,
          eventType: event.eventType,
          email: event.email,
          profileUrl: event.profileUrl,
          outcome: analysis?.outcome || 'tracked',
          sentiment: analysis?.sentiment || null,
          summary: analysis?.summary || `${eventType} tracked`,
        };
      }

      return { processed: false, reason: `unhandled_event_type:${eventType}` };
    });
  },
});
