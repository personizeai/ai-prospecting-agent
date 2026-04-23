import { google } from 'googleapis';
import { GMAIL_CONFIG, type GmailSender } from '../config/prospecting.config.js';
import type { GeneratedEmail } from '../types.js';
import { isValidEmail } from '../lib/email-validator.js';
import {
  getCapacityStoreStatus,
  getGmailSendCount,
  incrementGmailSendCount,
} from '../lib/capacity-store.js';
import { isDryRun } from '../lib/dry-run.js';

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

let roundRobinIndex = 0;

/**
 * Pick the next available sender that hasn't hit their daily limit.
 * Returns null if all senders are exhausted for the day.
 */
export function selectSender(): GmailSender | null {
  const { senders, strategy } = GMAIL_CONFIG;
  if (senders.length === 0) return null;

  const available = senders.filter(
    (sender) => getGmailSendCount(sender.email) < sender.dailyLimit,
  );

  if (available.length === 0) return null;

  if (strategy === 'random') {
    return available[Math.floor(Math.random() * available.length)];
  }

  const sender = available[roundRobinIndex % available.length];
  roundRobinIndex = (roundRobinIndex + 1) % available.length;
  return sender;
}

/**
 * Get remaining capacity across all senders for today.
 */
export function getRemainingCapacity(): {
  total: number;
  perSender: Array<{ email: string; remaining: number }>;
  store: ReturnType<typeof getCapacityStoreStatus>;
} {
  const perSender = GMAIL_CONFIG.senders.map((sender) => ({
    email: sender.email,
    remaining: Math.max(0, sender.dailyLimit - getGmailSendCount(sender.email)),
  }));

  return {
    total: perSender.reduce((sum, sender) => sum + sender.remaining, 0),
    perSender,
    store: getCapacityStoreStatus(),
  };
}

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
  /** Set for reply threading — the Message-ID of the email being replied to. */
  inReplyTo?: string;
  /** Set for reply threading — full chain of Message-IDs in the thread. */
  references?: string[];
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `From: ${params.fromName} <${params.from}>`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
  ];

  // Thread headers — ensures replies appear in the same conversation
  // across all email clients (Gmail, Outlook, Apple Mail, etc.)
  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references && params.references.length > 0) {
    headers.push(`References: ${params.references.join(' ')}`);
  }

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const lines = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.bodyText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.bodyHtml,
    '',
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
  if (!isValidEmail(generated.email)) {
    throw new Error(`Invalid recipient email address: "${generated.email}"`);
  }

  if (await isDryRun()) {
    const sender = selectSender();
    const senderEmail = sender?.email ?? 'dry-run@example.com';
    const senderName = sender?.name ?? 'DRY RUN';
    console.info('[DRY_RUN] Would send via Gmail', { to: generated.email, subject: generated.subject, campaign: generated.angle });
    return { messageId: 'dry-run', threadId: 'dry-run', senderEmail, senderName };
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

  incrementGmailSendCount(sender.email);

  return {
    messageId: response.data.id || '',
    threadId: response.data.threadId || '',
    senderEmail: sender.email,
    senderName: sender.name,
  };
}

/** Thread context for replying to an existing email conversation. */
export interface ThreadContext {
  /** Gmail thread ID (groups emails in the same conversation). */
  threadId: string;
  /** Message-ID header of the email being replied to (for In-Reply-To). */
  inReplyTo?: string;
  /** Full chain of Message-IDs in the thread (for References header). */
  references?: string[];
  /** Original subject (will be prefixed with "Re: " if not already). */
  originalSubject?: string;
  /** Prefer this sender (e.g., the one who sent the original email). */
  preferSenderEmail?: string;
}

/**
 * Send a reply in an existing email thread.
 *
 * Sets In-Reply-To and References headers for proper threading across
 * all email clients (Gmail, Outlook, Apple Mail, Thunderbird, etc.).
 * Also sets Gmail's threadId to keep the conversation grouped.
 *
 * Use this for:
 *   - Auto-replies to inbound emails (from replyHandlerTask)
 *   - Follow-up emails in a sequence (same thread as email 1)
 *   - Agent-generated responses that should appear in the original conversation
 */
export async function sendGmailReply(
  generated: GeneratedEmail,
  thread: ThreadContext | string,
): Promise<GmailSendResult> {
  // Backward compat: accept plain threadId string
  const ctx: ThreadContext = typeof thread === 'string'
    ? { threadId: thread }
    : thread;

  if (await isDryRun()) {
    const drySender = ctx.preferSenderEmail
      ? GMAIL_CONFIG.senders.find((s) => s.email === ctx.preferSenderEmail) ?? selectSender()
      : selectSender();
    const senderEmail = drySender?.email ?? 'dry-run@example.com';
    const senderName = drySender?.name ?? 'DRY RUN';
    console.info('[DRY_RUN] Would send Gmail reply', { to: generated.email, subject: generated.subject, threadId: ctx.threadId });
    return { messageId: 'dry-run', threadId: ctx.threadId, senderEmail, senderName };
  }

  let sender: GmailSender | null = null;
  if (ctx.preferSenderEmail) {
    sender = GMAIL_CONFIG.senders.find((configuredSender) => configuredSender.email === ctx.preferSenderEmail) || null;
  }
  if (!sender) {
    sender = selectSender();
  }
  if (!sender) {
    throw new Error('No Gmail sender available for reply');
  }

  const auth = getOAuth2Client(sender);
  const gmail = google.gmail({ version: 'v1', auth });

  const subject = ctx.originalSubject
    ? (ctx.originalSubject.startsWith('Re: ') ? ctx.originalSubject : `Re: ${ctx.originalSubject}`)
    : (generated.subject.startsWith('Re: ') ? generated.subject : `Re: ${generated.subject}`);

  const mime = buildMimeMessage({
    to: generated.email,
    from: sender.email,
    fromName: sender.name,
    subject,
    bodyHtml: generated.bodyHtml,
    bodyText: generated.bodyText,
    inReplyTo: ctx.inReplyTo,
    references: ctx.references,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeMessage(mime),
      threadId: ctx.threadId,
    },
  });

  incrementGmailSendCount(sender.email);

  return {
    messageId: response.data.id || '',
    threadId: response.data.threadId || '',
    senderEmail: sender.email,
    senderName: sender.name,
  };
}
