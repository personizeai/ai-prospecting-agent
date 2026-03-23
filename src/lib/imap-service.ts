/**
 * IMAP Service — Connect, poll, search, and fetch emails via IMAP.
 *
 * Uses `imapflow` for modern async/await IMAP with automatic extension handling.
 * Supports Gmail (app passwords + OAuth2 XOAUTH2), Outlook, and any standard IMAP provider.
 *
 * Features:
 *   - Multi-account polling with per-account state tracking
 *   - Conversation history retrieval per contact email
 *   - AES-256-GCM credential encryption at rest
 *   - Connection health checks with timeout
 *   - Graceful error handling per-account (one bad account doesn't block others)
 *
 * Usage:
 *   import { imapService } from '../lib/imap-service.js';
 *   const messages = await imapService.pollAccount(account);
 *   const history = await imapService.getConversationHistory(account, 'contact@example.com');
 */

import { ImapFlow } from 'imapflow';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { logger } from './logger.js';

const log = logger.child({ module: 'imap-service' });

// ─── Types ────────────────────────────────────────────────────────

export interface ImapAccount {
  /** Unique identifier (uuid). */
  id: string;
  /** Human-readable label (e.g., "Alice's Gmail"). */
  label: string;
  /** Email address for this mailbox. */
  email: string;
  /** Display name for outbound emails (e.g., "Alice Smith"). */
  displayName?: string;

  // ─── IMAP (reading) ───────────────────────────────────────
  /** IMAP hostname (e.g., imap.gmail.com, outlook.office365.com). */
  host: string;
  /** IMAP port (usually 993 for TLS). */
  port: number;
  /** Whether to use TLS (true for port 993). */
  secure: boolean;

  // ─── SMTP (sending) ───────────────────────────────────────
  /** SMTP hostname (e.g., smtp.gmail.com, smtp-mail.outlook.com). */
  smtpHost?: string;
  /** SMTP port (587 for STARTTLS, 465 for TLS). */
  smtpPort?: number;
  /** Whether SMTP uses TLS (true for port 465, false for 587 STARTTLS). */
  smtpSecure?: boolean;
  /** Whether this account can be used for sending (not just reading). */
  sendingEnabled?: boolean;

  // ─── Auth ─────────────────────────────────────────────────
  /** Authentication method.
   *  - 'password': App password (Gmail/Outlook) or regular password.
   *  - 'oauth2': Google OAuth2 — requires refreshToken + clientId/clientSecret.
   *    Access tokens are auto-refreshed at connection time. */
  auth: 'password' | 'oauth2';
  /** App password or regular password (encrypted at rest in Personize).
   *  Same credential is used for both IMAP and SMTP. */
  password?: string;
  /** OAuth2 refresh token (long-lived — use gmail-auth.ts to generate).
   *  Stored encrypted. The agent refreshes the access token automatically. */
  refreshToken?: string;
  /** OAuth2 access token (short-lived, auto-refreshed from refreshToken). */
  accessToken?: string;

  // ─── Polling config ───────────────────────────────────────
  /** Whether this account is actively polled. */
  enabled: boolean;
  /** IMAP folders to monitor (default: ['INBOX']). */
  folders: string[];
  /** Poll interval in minutes (default: 3). */
  pollIntervalMinutes: number;

  // ─── Runtime state (managed by agent) ─────────────────────
  /** ISO timestamp of last successful poll. */
  lastCheckedAt?: string;
  /** Last known UID per folder (for incremental polling). */
  lastUids?: Record<string, number>;
  /** Connection status from last poll attempt. */
  status?: 'connected' | 'error' | 'disabled';
  /** Last error message (if status === 'error'). */
  lastError?: string;
  /** When this account was added. */
  createdAt: string;
}

export interface FetchedEmail {
  /** IMAP message UID. */
  uid: number;
  /** Sender email address. */
  from: string;
  /** Sender display name. */
  fromName: string;
  /** All recipient addresses. */
  to: string[];
  /** Email subject. */
  subject: string;
  /** Plain text body (preferred for analysis). */
  textBody: string;
  /** HTML body (fallback). */
  htmlBody: string;
  /** Message date. */
  date: Date;
  /** Message-ID header. */
  messageId: string;
  /** In-Reply-To header (thread tracking). */
  inReplyTo: string;
  /** References header (full thread chain). */
  references: string[];
  /** Which IMAP folder this came from. */
  folder: string;
  /** Which account this came from. */
  accountId: string;
  /** Whether this was sent by us (from Sent folder). */
  isOutbound: boolean;
}

// ─── Encryption Helpers ───────────────────────────────────────────

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'imap-credential-salt'; // Static salt (key is already unique per deployment)

function getEncryptionKey(): Buffer {
  const secret = process.env.IMAP_ENCRYPTION_KEY || process.env.PERSONIZE_SECRET_KEY || '';
  if (!secret) {
    log.warn('No IMAP_ENCRYPTION_KEY or PERSONIZE_SECRET_KEY — credentials stored in plain text');
    return Buffer.alloc(0);
  }
  return scryptSync(secret, SALT, 32);
}

export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  if (key.length === 0) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptCredential(encoded: string): string {
  const key = getEncryptionKey();
  if (key.length === 0) return encoded;

  try {
    const data = Buffer.from(encoded, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch {
    // Might be unencrypted (legacy or no key) — return as-is
    return encoded;
  }
}

// ─── OAuth2 Token Refresh ─────────────────────────────────────────

/**
 * Refresh a Google OAuth2 access token from a refresh token.
 * Uses the same GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET as the Gmail API setup.
 */
async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('OAuth2 requires GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth2 token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

/**
 * Get a fresh access token for an OAuth2 account.
 * Refreshes from the stored refresh token if needed.
 */
export async function getAccessToken(account: ImapAccount): Promise<string> {
  if (account.auth !== 'oauth2') {
    throw new Error('getAccessToken called on non-oauth2 account');
  }

  const refreshToken = account.refreshToken ? decryptCredential(account.refreshToken) : '';
  if (!refreshToken) {
    throw new Error(`No refresh token for OAuth2 account ${account.email}. Run: npm run gmail:auth`);
  }

  return refreshGoogleAccessToken(refreshToken);
}

// ─── IMAP Connection ──────────────────────────────────────────────

const CONNECTION_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 60_000;

async function createImapClient(account: ImapAccount): Promise<ImapFlow> {
  const password = account.password ? decryptCredential(account.password) : undefined;

  let authConfig: Record<string, unknown>;

  if (account.auth === 'oauth2') {
    // Refresh the access token before connecting (tokens expire after ~1 hour)
    const freshAccessToken = await getAccessToken(account);
    authConfig = {
      user: account.email,
      accessToken: freshAccessToken,
    };
  } else {
    authConfig = {
      user: account.email,
      pass: password || '',
    };
  }

  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: authConfig as any,
    logger: false, // Suppress imapflow's internal logging
    emitLogs: false,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: FETCH_TIMEOUT_MS,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
}

// ─── Core Operations ──────────────────────────────────────────────

/**
 * Test IMAP connection. Returns true if successful, throws on failure.
 */
async function testConnection(account: ImapAccount): Promise<{ success: boolean; error?: string }> {
  const client = await createImapClient(account);
  try {
    await client.connect();
    // Try opening INBOX to verify full access
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    await client.logout();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('IMAP connection test failed', { accountId: account.id, email: account.email, error: message });
    return { success: false, error: message };
  } finally {
    try { client.close(); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Parse email addresses from IMAP address objects.
 */
function parseAddresses(addresses: any[] | undefined): string[] {
  if (!addresses || !Array.isArray(addresses)) return [];
  return addresses
    .filter((a) => a?.address)
    .map((a) => a.address.toLowerCase());
}

function parseFirstAddress(addresses: any[] | undefined): { email: string; name: string } {
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return { email: '', name: '' };
  }
  const first = addresses[0];
  return {
    email: (first?.address || '').toLowerCase(),
    name: first?.name || '',
  };
}

/**
 * Fetch new messages from a single account since last check.
 * Uses UID-based incremental polling for efficiency.
 */
async function pollAccount(account: ImapAccount): Promise<FetchedEmail[]> {
  if (!account.enabled) return [];

  const client = await createImapClient(account);
  const messages: FetchedEmail[] = [];
  const updatedUids: Record<string, number> = { ...(account.lastUids || {}) };

  try {
    await client.connect();

    for (const folder of (account.folders.length > 0 ? account.folders : ['INBOX'])) {
      const isOutbound = /sent/i.test(folder);

      try {
        const lock = await client.getMailboxLock(folder);

        try {
          // Incremental: fetch messages with UID > last known UID
          const lastUid = updatedUids[folder] || 0;
          let searchCriteria: any;

          if (lastUid > 0) {
            // UID range: everything after our last seen UID
            searchCriteria = { uid: `${lastUid + 1}:*` };
          } else if (account.lastCheckedAt) {
            // Fallback: date-based search
            searchCriteria = { since: new Date(account.lastCheckedAt) };
          } else {
            // First poll: only get messages from the last 24 hours
            const yesterday = new Date(Date.now() - 86_400_000);
            searchCriteria = { since: yesterday };
          }

          const searchResult = await client.search(searchCriteria, { uid: true });
          const uids = Array.isArray(searchResult) ? searchResult : [];

          if (uids.length === 0) {
            lock.release();
            continue;
          }

          // Cap at 100 messages per folder per poll to avoid overwhelming the system
          const uidsToFetch = uids.slice(-100);
          let maxUid = lastUid;

          for await (const msg of client.fetch(uidsToFetch, {
            uid: true,
            envelope: true,
            bodyStructure: true,
            source: true,
          })) {
            try {
              const envelope = msg.envelope;
              if (!envelope) continue;

              const from = parseFirstAddress(envelope.from);
              const to = parseAddresses(envelope.to);
              const subject = envelope.subject || '(no subject)';
              const date = envelope.date ? new Date(envelope.date) : new Date();
              const messageId = envelope.messageId || '';
              const inReplyTo = envelope.inReplyTo || '';

              // Extract text body from source
              let textBody = '';
              let htmlBody = '';
              if (msg.source) {
                const source = msg.source.toString('utf8');
                // Simple extraction — for production, use mailparser
                const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
                const htmlMatch = source.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
                textBody = textMatch?.[1]?.trim() || '';
                htmlBody = htmlMatch?.[1]?.trim() || '';

                // If no multipart match, try plain body
                if (!textBody && !htmlBody) {
                  const bodyStart = source.indexOf('\r\n\r\n');
                  if (bodyStart > -1) {
                    textBody = source.substring(bodyStart + 4).trim();
                  }
                }
              }

              if (msg.uid > maxUid) maxUid = msg.uid;

              messages.push({
                uid: msg.uid,
                from: from.email,
                fromName: from.name,
                to,
                subject,
                textBody,
                htmlBody,
                date,
                messageId,
                inReplyTo,
                references: inReplyTo ? [inReplyTo] : [],
                folder,
                accountId: account.id,
                isOutbound,
              });
            } catch (parseErr) {
              log.warn('Failed to parse IMAP message', {
                accountId: account.id,
                folder,
                uid: msg.uid,
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
              });
            }
          }

          if (maxUid > lastUid) updatedUids[folder] = maxUid;
        } finally {
          lock.release();
        }
      } catch (folderErr) {
        log.warn('Failed to poll IMAP folder', {
          accountId: account.id,
          folder,
          error: folderErr instanceof Error ? folderErr.message : String(folderErr),
        });
      }
    }

    await client.logout();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('IMAP poll failed', { accountId: account.id, email: account.email, error: message });
    throw err;
  } finally {
    try { client.close(); } catch { /* ignore */ }
  }

  log.info('IMAP poll complete', {
    accountId: account.id,
    email: account.email,
    messagesFound: messages.length,
    folders: account.folders,
  });

  return messages;
}

/**
 * Get full conversation history between this mailbox and a specific contact.
 * Searches both INBOX and Sent folders for messages to/from the contact.
 */
async function getConversationHistory(
  account: ImapAccount,
  contactEmail: string,
  options: { maxMessages?: number; sinceDays?: number } = {},
): Promise<FetchedEmail[]> {
  const { maxMessages = 50, sinceDays = 180 } = options;
  const client = await createImapClient(account);
  const messages: FetchedEmail[] = [];
  const sinceDate = new Date(Date.now() - sinceDays * 86_400_000);

  try {
    await client.connect();

    // Search folders: INBOX for inbound, Sent for outbound
    const foldersToSearch = ['INBOX'];

    // Try common sent folder names
    const sentFolderCandidates = [
      '[Gmail]/Sent Mail', 'Sent', 'Sent Items', 'INBOX.Sent',
    ];
    const mailboxList = await client.list();
    const availablePaths = mailboxList.map((m: any) => m.path);

    for (const candidate of sentFolderCandidates) {
      if (availablePaths.includes(candidate)) {
        foldersToSearch.push(candidate);
        break;
      }
    }

    for (const folder of foldersToSearch) {
      const isOutbound = /sent/i.test(folder);

      try {
        const lock = await client.getMailboxLock(folder);

        try {
          // Search for messages from or to the contact
          const searchResult = isOutbound
            ? await client.search({ to: contactEmail, since: sinceDate }, { uid: true })
            : await client.search({ from: contactEmail, since: sinceDate }, { uid: true });
          const fromResults = Array.isArray(searchResult) ? searchResult : [];

          if (fromResults.length === 0) continue;

          // Take most recent N messages
          const uidsToFetch = fromResults.slice(-maxMessages);

          for await (const msg of client.fetch(uidsToFetch, {
            uid: true,
            envelope: true,
            source: true,
          })) {
            try {
              const envelope = msg.envelope;
              if (!envelope) continue;

              const from = parseFirstAddress(envelope.from);
              const to = parseAddresses(envelope.to);

              let textBody = '';
              let htmlBody = '';
              if (msg.source) {
                const source = msg.source.toString('utf8');
                const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
                const htmlMatch = source.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
                textBody = textMatch?.[1]?.trim() || '';
                htmlBody = htmlMatch?.[1]?.trim() || '';
                if (!textBody && !htmlBody) {
                  const bodyStart = source.indexOf('\r\n\r\n');
                  if (bodyStart > -1) textBody = source.substring(bodyStart + 4).trim();
                }
              }

              messages.push({
                uid: msg.uid,
                from: from.email,
                fromName: from.name,
                to,
                subject: envelope.subject || '(no subject)',
                textBody,
                htmlBody,
                date: envelope.date ? new Date(envelope.date) : new Date(),
                messageId: envelope.messageId || '',
                inReplyTo: envelope.inReplyTo || '',
                references: envelope.inReplyTo ? [envelope.inReplyTo] : [],
                folder,
                accountId: account.id,
                isOutbound,
              });
            } catch {
              // Skip unparseable messages
            }
          }
        } finally {
          lock.release();
        }
      } catch (folderErr) {
        log.warn('Failed to search conversation in folder', {
          folder,
          contactEmail,
          error: folderErr instanceof Error ? folderErr.message : String(folderErr),
        });
      }
    }

    await client.logout();
  } catch (err) {
    log.error('Failed to get conversation history', {
      accountId: account.id,
      contactEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    try { client.close(); } catch { /* ignore */ }
  }

  // Sort chronologically
  messages.sort((a, b) => a.date.getTime() - b.date.getTime());

  return messages;
}

// ─── Public API ───────────────────────────────────────────────────

export const imapService = {
  testConnection,
  pollAccount,
  getConversationHistory,
  encryptCredential,
  decryptCredential,
};
