import { google } from 'googleapis';
import { GMAIL_CONFIG, type GmailSender } from '../config/prospecting.config.js';
import type { GeneratedEmail } from '../types.js';
import { isValidEmail } from '../lib/email-validator.js';

/**
 * Gmail API multi-sender for Google Workspace.
 *
 * Supports multiple sender accounts with round-robin rotation and daily limits.
 * Each sender needs their own OAuth2 refresh token but all share the same
 * Client ID / Client Secret (one Google Cloud project).
 *
 * Setup:
 *   1. Enable Gmail API in Google Cloud Console
 *   2. Create OAuth2 credentials (Desktop app type)
 *   3. Run `npm run gmail:auth` for EACH sender to get their refresh token
 *   4. Configure via GMAIL_SENDERS env var (JSON array) or single-sender env vars
 */

// ─── Daily Send Tracking ─────────────────────────────────────────────

/** In-memory daily send counter per sender. Resets at midnight UTC. */
const dailySends: Map<string, { count: number; date: string }> = new Map();

function getTodayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

function getSendCount(senderEmail: string): number {
  const entry = dailySends.get(senderEmail);
  const today = getTodayUTC();
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

function incrementSendCount(senderEmail: string): void {
  const today = getTodayUTC();
  const entry = dailySends.get(senderEmail);
  if (!entry || entry.date !== today) {
    dailySends.set(senderEmail, { count: 1, date: today });
  } else {
    entry.count++;
  }
}

// ─── Sender Selection ─────────────────────────────────────────────────

let roundRobinIndex = 0;

/**
 * Pick the next available sender that hasn't hit their daily limit.
 * Returns null if all senders are exhausted for the day.
 */
export function selectSender(): GmailSender | null {
  const { senders, strategy } = GMAIL_CONFIG;
  if (senders.length === 0) return null;

  // Filter to senders under their daily limit
  const available = senders.filter(
    (s) => getSendCount(s.email) < s.dailyLimit,
  );

  if (available.length === 0) return null;

  if (strategy === 'random') {
    return available[Math.floor(Math.random() * available.length)];
  }

  // Round-robin: cycle through available senders
  const sender = available[roundRobinIndex % available.length];
  roundRobinIndex = (roundRobinIndex + 1) % available.length;
  return sender;
}

/**
 * Get remaining capacity across all senders for today.
 */
export function getRemainingCapacity(): { total: number; perSender: Array<{ email: string; remaining: number }> } {
  const perSender = GMAIL_CONFIG.senders.map((s) => ({
    email: s.email,
    remaining: Math.max(0, s.dailyLimit - getSendCount(s.email)),
  }));

  return {
    total: perSender.reduce((sum, s) => sum + s.remaining, 0),
    perSender,
  };
}

// ─── OAuth2 ───────────────────────────────────────────────────────────

function getOAuth2Client(sender: GmailSender) {
  if (!GMAIL_CONFIG.clientId || !GMAIL_CONFIG.clientSecret) {
    throw new Error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET');
  }

  const oauth2 = new google.auth.OAuth2(
    GMAIL_CONFIG.clientId,
    GMAIL_CONFIG.clientSecret,
  );

  oauth2.setCredentials({ refresh_token: sender.refreshToken });
  return oauth2;
}

// ─── MIME Building ────────────────────────────────────────────────────

/**
 * Build a RFC 2822 MIME message with both HTML and plain-text parts.
 */
export function buildMimeMessage(params: {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lines = [
    `From: ${params.fromName} <${params.from}>`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    params.bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    params.bodyHtml,
    ``,
    `--${boundary}--`,
  ];

  return lines.join('\r\n');
}

/**
 * Encode a MIME message as URL-safe base64 (required by Gmail API).
 */
export function encodeMessage(mime: string): string {
  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── Send ─────────────────────────────────────────────────────────────

export interface GmailSendResult {
  messageId: string;
  threadId: string;
  senderEmail: string;
  senderName: string;
}

/**
 * Send an email via the Gmail API using the next available sender.
 *
 * Automatically selects a sender via round-robin, respecting daily limits.
 * Throws if no senders are available (all exhausted or none configured).
 */
export async function sendViaGmail(generated: GeneratedEmail): Promise<GmailSendResult> {
  // Validate email before sending — fail fast on bad addresses
  if (!isValidEmail(generated.email)) {
    throw new Error(`Invalid recipient email address: "${generated.email}"`);
  }

  const sender = selectSender();
  if (!sender) {
    const capacity = getRemainingCapacity();
    throw new Error(
      capacity.total === 0 && GMAIL_CONFIG.senders.length > 0
        ? `All ${GMAIL_CONFIG.senders.length} Gmail senders have hit their daily limit`
        : 'No Gmail senders configured. Set GMAIL_SENDERS or single-sender env vars.',
    );
  }

  const auth = getOAuth2Client(sender);
  const gmail = google.gmail({ version: 'v1', auth });

  const mime = buildMimeMessage({
    to: generated.email,
    from: sender.email,
    fromName: sender.name,
    subject: generated.subject,
    bodyHtml: generated.bodyHtml,
    bodyText: generated.bodyText,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeMessage(mime),
    },
  });

  incrementSendCount(sender.email);

  return {
    messageId: response.data.id || '',
    threadId: response.data.threadId || '',
    senderEmail: sender.email,
    senderName: sender.name,
  };
}

/**
 * Send a reply in an existing Gmail thread (for follow-up emails in a sequence).
 *
 * Uses a specific sender (the one who sent the original email) and the threadId
 * to keep the conversation grouped in the recipient's inbox.
 */
export async function sendGmailReply(
  generated: GeneratedEmail,
  threadId: string,
  senderEmail?: string,
): Promise<GmailSendResult> {
  // Use the specified sender, or fall back to auto-selection
  let sender: GmailSender | null = null;
  if (senderEmail) {
    sender = GMAIL_CONFIG.senders.find((s) => s.email === senderEmail) || null;
  }
  if (!sender) {
    sender = selectSender();
  }
  if (!sender) {
    throw new Error('No Gmail sender available for reply');
  }

  const auth = getOAuth2Client(sender);
  const gmail = google.gmail({ version: 'v1', auth });

  const mime = buildMimeMessage({
    to: generated.email,
    from: sender.email,
    fromName: sender.name,
    subject: generated.subject.startsWith('Re: ') ? generated.subject : `Re: ${generated.subject}`,
    bodyHtml: generated.bodyHtml,
    bodyText: generated.bodyText,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeMessage(mime),
      threadId,
    },
  });

  incrementSendCount(sender.email);

  return {
    messageId: response.data.id || '',
    threadId: response.data.threadId || '',
    senderEmail: sender.email,
    senderName: sender.name,
  };
}
