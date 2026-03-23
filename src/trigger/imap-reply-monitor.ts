/**
 * IMAP Reply Monitor — Polls configured IMAP accounts for new emails.
 *
 * Runs every 3 minutes (configurable). For each enabled IMAP account:
 *   1. Connects to IMAP server
 *   2. Fetches messages since last poll (UID-based incremental)
 *   3. Matches sender → known Personize contacts
 *   4. Inbound replies from known contacts → replyHandlerTask (AI analysis)
 *   5. Updates poll state (lastCheckedAt, lastUids) per account
 *
 * Setup:
 *   1. Add IMAP accounts via dashboard (Settings → Email Accounts)
 *   2. The monitor auto-discovers enabled accounts from Personize
 *   3. Copy this task's Trigger.dev URL if you need manual triggering
 *
 * Error handling:
 *   - One failing account does NOT block others (per-account try/catch)
 *   - Connection failures update account status to 'error' with message
 *   - Consecutive failures are visible in dashboard account status
 */

import { schedules } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { imapService } from '../lib/imap-service.js';
import { imapAccounts } from '../lib/imap-accounts.js';
import { workspace } from '../lib/workspace.js';
import { replyHandlerTask } from './reply-handler.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';
import type { ImapAccount, FetchedEmail } from '../lib/imap-service.js';

const log = logger.child({ module: 'imap-reply-monitor' });

// ─── Contact Matching ─────────────────────────────────────────────

/**
 * Check if a sender email is a known contact in Personize.
 * Returns the contact record if found, null otherwise.
 */
async function findKnownContact(email: string): Promise<{ email: string; crmId: string } | null> {
  try {
    const result = await client.memory.search({
      type: 'Contact',
      query: email,
      limit: 1,
    });

    const records = (result.data as any)?.records || result.data || [];
    if (Array.isArray(records) && records.length > 0) {
      const record = records[0];
      const crmId = record.properties?.crm_id?.value || '';
      return { email: record.email || email, crmId };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Process Messages ─────────────────────────────────────────────

/**
 * Process fetched messages: match to contacts, trigger reply analysis.
 */
async function processMessages(
  messages: FetchedEmail[],
  account: ImapAccount,
): Promise<{ repliesTriggered: number; messagesLogged: number }> {
  let repliesTriggered = 0;
  let messagesLogged = 0;

  // Only process inbound messages (not our own sent mail)
  const inbound = messages.filter((m) => !m.isOutbound);

  for (const msg of inbound) {
    const contact = await findKnownContact(msg.from);
    if (!contact) continue;

    // Log the message as an engagement update in the workspace
    await workspace.addUpdate(contact.email, {
      author: 'imap-monitor',
      type: 'engagement',
      summary: `Email received via IMAP: "${msg.subject}"`,
      details: `From: ${msg.fromName || msg.from} | Account: ${account.label} | Date: ${msg.date.toISOString()}`,
    });

    await workspace.addNote(contact.email, {
      author: 'imap-monitor',
      content: `Inbound email received.\nSubject: ${msg.subject}\nPreview: ${(msg.textBody || msg.htmlBody || '').substring(0, 500)}`,
      category: 'reply-analysis',
    });

    messagesLogged++;

    // Check if this looks like a reply to our outreach (has In-Reply-To or Re: subject)
    const isReply = !!msg.inReplyTo || /^re:/i.test(msg.subject);

    if (isReply && (msg.textBody || msg.htmlBody)) {
      // Trigger full reply analysis
      await replyHandlerTask.trigger({
        email: contact.email,
        crmId: contact.crmId,
        replyBody: msg.textBody || msg.htmlBody,
        replySubject: msg.subject,
      });
      repliesTriggered++;

      log.info('Triggered reply analysis from IMAP', {
        contactEmail: contact.email,
        subject: msg.subject,
        account: account.label,
      });
    } else if (msg.textBody || msg.htmlBody) {
      // New inbound email (not a reply) from a known contact — still valuable
      // Log it but don't trigger full reply analysis (could be a newsletter, forward, etc.)
      await workspace.rewriteContext(contact.email, [
        `Latest Signal: Inbound email received (not a reply to our outreach)`,
        `Subject: "${msg.subject}"`,
        `Date: ${msg.date.toISOString().split('T')[0]}`,
        `Action: Review if follow-up needed`,
      ].join('\n'), 'imap-monitor');
    }
  }

  return { repliesTriggered, messagesLogged };
}

// ─── Scheduled Task ───────────────────────────────────────────────

export const imapReplyMonitorTask = schedules.task({
  id: "imap-reply-monitor",
  cron: "*/3 * * * *", // Every 3 minutes
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("imap-reply-monitor", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "imap-reply-monitor" }, async () => {

      // Load enabled accounts from Personize
      const accounts = await imapAccounts.listEnabled();

      if (accounts.length === 0) {
        log.debug('No enabled IMAP accounts, skipping');
        return { polled: 0, accounts: 0, repliesTriggered: 0 };
      }

      log.info('Starting IMAP poll cycle', { accounts: accounts.length });

      let totalReplies = 0;
      let totalMessages = 0;
      let accountsPolled = 0;
      let accountsFailed = 0;

      for (const account of accounts) {
        try {
          // Check if enough time has passed since last poll
          if (account.lastCheckedAt) {
            const msSinceLastPoll = Date.now() - new Date(account.lastCheckedAt).getTime();
            const minIntervalMs = (account.pollIntervalMinutes || 3) * 60_000;
            if (msSinceLastPoll < minIntervalMs) {
              log.debug('Skipping account, polled recently', {
                accountId: account.id,
                email: account.email,
                msSinceLastPoll,
              });
              continue;
            }
          }

          // Poll for new messages
          const messages = await imapService.pollAccount(account);
          accountsPolled++;

          // Process and match messages to contacts
          if (messages.length > 0) {
            const result = await processMessages(messages, account);
            totalReplies += result.repliesTriggered;
            totalMessages += result.messagesLogged;
          }

          // Compute updated UIDs from the messages we fetched
          const updatedUids: Record<string, number> = { ...(account.lastUids || {}) };
          for (const msg of messages) {
            const currentMax = updatedUids[msg.folder] || 0;
            if (msg.uid > currentMax) updatedUids[msg.folder] = msg.uid;
          }

          // Update poll state
          await imapAccounts.updatePollState(account.id, {
            lastCheckedAt: new Date().toISOString(),
            lastUids: updatedUids,
            status: 'connected',
            lastError: undefined,
          });

        } catch (err) {
          accountsFailed++;
          const errorMsg = err instanceof Error ? err.message : String(err);

          // Update account status to error (don't stop other accounts)
          try {
            await imapAccounts.updatePollState(account.id, {
              lastCheckedAt: new Date().toISOString(),
              lastUids: account.lastUids,
              status: 'error',
              lastError: errorMsg,
            });
          } catch {
            // If we can't even update the status, just log it
          }

          log.error('Failed to poll IMAP account', {
            accountId: account.id,
            email: account.email,
            error: errorMsg,
          });
        }
      }

      log.info('IMAP poll cycle complete', {
        accountsPolled,
        accountsFailed,
        totalMessages,
        totalReplies,
      });

      return {
        polled: accountsPolled,
        failed: accountsFailed,
        accounts: accounts.length,
        messagesFound: totalMessages,
        repliesTriggered: totalReplies,
        timestamp: new Date().toISOString(),
      };
    });
  },
});
