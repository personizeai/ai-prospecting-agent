/**
 * SMTP Delivery — Send emails via any SMTP server (Gmail, Outlook, Zoho, custom).
 *
 * Uses `nodemailer` for SMTP with full thread support (In-Reply-To, References).
 * Credentials come from the ImapAccount config (same app password for IMAP + SMTP).
 *
 * This is the universal, zero-vendor-dependency sending path. Users who connect
 * email accounts via the dashboard get both reading (IMAP) and sending (SMTP)
 * from a single account config.
 *
 * Usage:
 *   import { smtpDelivery } from '../delivery/smtp.js';
 *   await smtpDelivery.send(account, { to, subject, bodyHtml, bodyText });
 *   await smtpDelivery.sendReply(account, { to, subject, bodyHtml, bodyText }, threadCtx);
 */

import { createTransport, type Transporter } from 'nodemailer';
import { decryptCredential, getAccessToken, type ImapAccount } from '../lib/imap-service.js';
import { logger } from '../lib/logger.js';
import { isDryRun } from '../lib/dry-run.js';

const log = logger.child({ module: 'smtp-delivery' });

// Cache transports per account to reuse connections
const transportCache = new Map<string, Transporter>();

export interface SmtpSendParams {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export interface SmtpThreadContext {
  /** Message-ID of the email being replied to. */
  inReplyTo: string;
  /** Full chain of Message-IDs in the thread. */
  references: string[];
  /** Original subject — will be prefixed with "Re: " if needed. */
  originalSubject?: string;
}

export interface SmtpSendResult {
  messageId: string;
  senderEmail: string;
  accepted: string[];
}

// ─── Transport ────────────────────────────────────────────────────

async function getTransport(account: ImapAccount): Promise<Transporter> {
  // Don't cache OAuth2 transports — access tokens expire after ~1 hour
  if (account.auth !== 'oauth2') {
    const cached = transportCache.get(account.id);
    if (cached) return cached;
  }

  if (!account.smtpHost) {
    throw new Error(`SMTP not configured for account ${account.email}. Set smtpHost in account settings.`);
  }

  let authConfig: Record<string, unknown>;

  if (account.auth === 'oauth2') {
    // Refresh the access token before creating the transport
    const freshAccessToken = await getAccessToken(account);
    authConfig = {
      type: 'OAuth2',
      user: account.email,
      accessToken: freshAccessToken,
    };
  } else {
    const password = account.password ? decryptCredential(account.password) : '';
    authConfig = {
      user: account.email,
      pass: password,
    };
  }

  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort || 587,
    secure: account.smtpSecure ?? false, // false = STARTTLS on connect
    auth: authConfig as any,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  if (account.auth !== 'oauth2') {
    transportCache.set(account.id, transport);
  }

  return transport;
}

// ─── Send ─────────────────────────────────────────────────────────

/**
 * Send a new email (not a reply) via SMTP.
 */
async function send(account: ImapAccount, params: SmtpSendParams): Promise<SmtpSendResult> {
  if (await isDryRun()) {
    log.info('[DRY_RUN] Would send email via SMTP', { to: params.to, subject: params.subject, account: account.email });
    return { messageId: 'dry-run', senderEmail: account.email, accepted: [params.to] };
  }

  const transport = await getTransport(account);
  const fromName = account.displayName || account.label || account.email;

  const info = await transport.sendMail({
    from: `${fromName} <${account.email}>`,
    to: params.to,
    subject: params.subject,
    text: params.bodyText,
    html: params.bodyHtml,
  });

  log.info('Email sent via SMTP', {
    accountId: account.id,
    from: account.email,
    to: params.to,
    messageId: info.messageId,
  });

  return {
    messageId: info.messageId || '',
    senderEmail: account.email,
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
  };
}

/**
 * Send a reply in an existing thread via SMTP.
 *
 * Sets In-Reply-To and References headers for proper threading across
 * all email clients (Gmail, Outlook, Apple Mail, Thunderbird, etc.).
 */
async function sendReply(
  account: ImapAccount,
  params: SmtpSendParams,
  thread: SmtpThreadContext,
): Promise<SmtpSendResult> {
  if (await isDryRun()) {
    log.info('[DRY_RUN] Would send reply via SMTP', { to: params.to, subject: params.subject, account: account.email, inReplyTo: thread.inReplyTo });
    return { messageId: 'dry-run', senderEmail: account.email, accepted: [params.to] };
  }

  const transport = await getTransport(account);
  const fromName = account.displayName || account.label || account.email;

  const subject = thread.originalSubject
    ? (thread.originalSubject.startsWith('Re: ') ? thread.originalSubject : `Re: ${thread.originalSubject}`)
    : (params.subject.startsWith('Re: ') ? params.subject : `Re: ${params.subject}`);

  const info = await transport.sendMail({
    from: `${fromName} <${account.email}>`,
    to: params.to,
    subject,
    text: params.bodyText,
    html: params.bodyHtml,
    inReplyTo: thread.inReplyTo,
    references: thread.references.join(' '),
    headers: {
      'In-Reply-To': thread.inReplyTo,
      'References': thread.references.join(' '),
    },
  });

  log.info('Reply sent via SMTP', {
    accountId: account.id,
    from: account.email,
    to: params.to,
    inReplyTo: thread.inReplyTo,
    messageId: info.messageId,
  });

  return {
    messageId: info.messageId || '',
    senderEmail: account.email,
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
  };
}

/**
 * Test SMTP connection (verify credentials without sending).
 */
async function testConnection(account: ImapAccount): Promise<{ success: boolean; error?: string }> {
  try {
    const transport = await getTransport(account);
    await transport.verify();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('SMTP connection test failed', { accountId: account.id, error: message });
    return { success: false, error: message };
  }
}

/**
 * Close cached transport for an account (call when account is deleted/disabled).
 */
function closeTransport(accountId: string): void {
  const transport = transportCache.get(accountId);
  if (transport) {
    transport.close();
    transportCache.delete(accountId);
  }
}

// ─── Public API ───────────────────────────────────────────────────

export const smtpDelivery = {
  send,
  sendReply,
  testConnection,
  closeTransport,
};
