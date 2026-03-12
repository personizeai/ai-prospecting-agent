import { SMARTLEAD_CONFIG } from '../config/prospecting.config.js';
import type { GeneratedEmail } from '../types.js';

/**
 * Smartlead email delivery.
 *
 * Sends a single email through a Smartlead campaign, using Smartlead's
 * warmed mailboxes and deliverability infrastructure.
 *
 * Setup:
 *   1. Create a Smartlead account at smartlead.ai
 *   2. Create one campaign (e.g. "AI Prospecting Agent") — set it to Active
 *   3. Add your warmed email accounts to that campaign
 *   4. Set SMARTLEAD_API_KEY and SMARTLEAD_CAMPAIGN_ID in your environment
 *
 * How it works:
 *   Each call adds the contact as a lead in the campaign and schedules
 *   the email for immediate send. Smartlead handles mailbox selection,
 *   sending windows, and delivery tracking. Our sequence loop owns the
 *   timing between steps — Smartlead only owns the act of sending.
 *
 * Reply and bounce events:
 *   Configure a Smartlead outbound webhook (Settings → Webhooks) pointing
 *   to your Trigger.dev webhook endpoint (reply-handler task). Smartlead
 *   will POST reply/bounce/unsubscribe events so the sequence can stop.
 */

export interface SmartleadSendResult {
  messageId: string;
  leadId: string;
  senderEmail: string;
}

interface SmartleadLeadPayload {
  email: string;
  subject: string;
  body: string;
  campaign_id: string | number;
  send_immediately: boolean;
  custom_fields?: Record<string, string>;
}

interface SmartleadLeadResponse {
  ok: boolean;
  data?: {
    id?: string | number;
    email_account?: { email?: string };
    [key: string]: unknown;
  };
  error?: string;
  message?: string;
}

/**
 * Send a single email via Smartlead.
 *
 * Adds the contact as a lead in the configured campaign and triggers
 * an immediate send. Returns a messageId and the sender email Smartlead
 * selected from the campaign's warmed mailbox pool.
 */
export async function sendViaSmartlead(generated: GeneratedEmail): Promise<SmartleadSendResult> {
  const { apiKey, baseUrl, campaignId } = SMARTLEAD_CONFIG;

  if (!apiKey) throw new Error('Missing SMARTLEAD_API_KEY');
  if (!campaignId) throw new Error('Missing SMARTLEAD_CAMPAIGN_ID');

  const payload: SmartleadLeadPayload = {
    email: generated.email,
    subject: generated.subject,
    body: generated.bodyHtml,
    campaign_id: campaignId,
    send_immediately: true,
    custom_fields: {
      angle: generated.angle,
      sequence_step: String(generated.step),
    },
  };

  const response = await fetch(`${baseUrl}/leads?api_key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Smartlead API error ${response.status}: ${text}`);
  }

  const result = (await response.json()) as SmartleadLeadResponse;

  if (!result.ok && result.error) {
    throw new Error(`Smartlead rejected send: ${result.error}`);
  }

  const leadId = String(result.data?.id || '');
  const senderEmail = result.data?.email_account?.email || 'smartlead-managed';

  return {
    messageId: leadId,   // Smartlead lead ID serves as the message reference
    leadId,
    senderEmail,
  };
}
