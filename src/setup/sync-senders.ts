/**
 * Sync Sender Accounts — Provisions IMAP accounts + sender profiles from config.
 *
 * Reads EMAIL_SENDERS_CONFIG from prospecting.config.ts, resolves credentials
 * from environment variables, and syncs to Personize:
 *
 *   - New senders → creates IMAP account + sender profile
 *   - Existing senders → updates IMAP account + sender profile
 *   - Removed senders (in Personize but not in config) → optionally removes them
 *
 * Credentials are loaded from env vars named by sender key:
 *   SENDER_{KEY}_PASSWORD       — for auth: 'password' (app passwords)
 *   SENDER_{KEY}_REFRESH_TOKEN  — for auth: 'oauth2' (Gmail OAuth2)
 *
 * Usage:
 *   npm run setup:senders              # sync all senders from config
 *   npm run setup:senders -- --dry-run # preview changes without writing
 *   npm run setup:senders -- --prune   # also remove senders not in config
 *
 * @module setup/sync-senders
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { imapAccounts } from '../lib/imap-accounts.js';
import { senderProfiles } from '../lib/sender-profiles.js';
import { encryptCredential } from '../lib/imap-service.js';
import { smtpDelivery } from '../delivery/smtp.js';
import {
  EMAIL_SENDERS_CONFIG,
  EMAIL_PROVIDER_PRESETS,
  IMAP_CONFIG,
  type SenderAccountConfig,
  type EmailProviderPreset,
} from '../config/prospecting.config.js';
import type { ImapAccount } from '../lib/imap-service.js';

// ─── Helpers ────────────────────────────────────────────────────────

function envKey(senderKey: string): string {
  return senderKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function getCredential(sender: SenderAccountConfig): { password?: string; refreshToken?: string } {
  const key = envKey(sender.key);
  const auth = sender.auth || 'password';

  if (auth === 'oauth2') {
    const token = process.env[`SENDER_${key}_REFRESH_TOKEN`] || process.env.GMAIL_REFRESH_TOKEN;
    if (!token) {
      throw new Error(
        `Missing env var SENDER_${key}_REFRESH_TOKEN for OAuth2 sender "${sender.key}" (${sender.email}).` +
        ` Run \`npm run gmail:auth\` to generate one.`,
      );
    }
    return { refreshToken: token };
  }

  const password = process.env[`SENDER_${key}_PASSWORD`];
  if (!password) {
    throw new Error(
      `Missing env var SENDER_${key}_PASSWORD for sender "${sender.key}" (${sender.email}).` +
      ` Generate an App Password in your email provider's security settings.`,
    );
  }
  return { password };
}

function resolveHosts(sender: SenderAccountConfig) {
  const preset = EMAIL_PROVIDER_PRESETS[sender.provider];
  return {
    imapHost:   sender.imapHost || preset.imapHost,
    imapPort:   sender.imapPort || preset.imapPort,
    imapSecure: preset.imapSecure,
    smtpHost:   sender.smtpHost || preset.smtpHost,
    smtpPort:   sender.smtpPort || preset.smtpPort,
    smtpSecure: sender.smtpSecure ?? preset.smtpSecure,
  };
}

function buildImapAccount(
  sender: SenderAccountConfig,
  existingId?: string,
): ImapAccount {
  const hosts = resolveHosts(sender);
  const creds = getCredential(sender);
  const auth = sender.auth || 'password';

  return {
    id: existingId || randomUUID(),
    label: `${sender.displayName} (${sender.provider})`,
    email: sender.email,
    displayName: sender.displayName,
    host: hosts.imapHost,
    port: hosts.imapPort,
    secure: hosts.imapSecure,
    smtpHost: hosts.smtpHost,
    smtpPort: hosts.smtpPort,
    smtpSecure: hosts.smtpSecure,
    sendingEnabled: true,
    auth,
    password: creds.password ? encryptCredential(creds.password) : undefined,
    refreshToken: creds.refreshToken ? encryptCredential(creds.refreshToken) : undefined,
    enabled: sender.pollingEnabled !== false,
    folders: sender.folders || IMAP_CONFIG.defaultFolders,
    pollIntervalMinutes: sender.pollIntervalMinutes || IMAP_CONFIG.defaultPollIntervalMinutes,
    createdAt: new Date().toISOString(),
  };
}

// ─── Sync Logic ────────────────────────────────────────────────────

interface SyncResult {
  created: string[];
  updated: string[];
  removed: string[];
  errors: string[];
  tested: { email: string; success: boolean; error?: string }[];
}

async function syncSenders(opts: { dryRun?: boolean; prune?: boolean; test?: boolean }): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], removed: [], errors: [], tested: [] };

  const configSenders = EMAIL_SENDERS_CONFIG.senders;
  if (configSenders.length === 0) {
    console.log('No senders configured in EMAIL_SENDERS_CONFIG. Nothing to sync.');
    console.log('Add senders to prospecting.config.ts or set EMAIL_SENDERS env var.\n');
    return result;
  }

  console.log(`\nSyncing ${configSenders.length} sender(s) from config...\n`);

  // Load existing state from Personize
  const existingAccounts = await imapAccounts.list();
  const existingProfiles = await senderProfiles.list();

  // Index existing accounts by email for matching
  const accountByEmail = new Map(existingAccounts.map((a) => [a.email, a]));
  // Index profiles by activeAccountId for matching
  const profileByAccountId = new Map(existingProfiles.map((p) => [p.activeAccountId, p]));

  // Track which emails are in config (for pruning)
  const configEmails = new Set(configSenders.map((s) => s.email));

  // ── Create / Update ───────────────────────────────────────────

  for (const sender of configSenders) {
    const existing = accountByEmail.get(sender.email);

    try {
      const account = buildImapAccount(sender, existing?.id);

      // Preserve runtime state from existing account
      if (existing) {
        account.createdAt = existing.createdAt;
        if (existing.lastCheckedAt) (account as any).lastCheckedAt = existing.lastCheckedAt;
        if (existing.lastUids) (account as any).lastUids = existing.lastUids;
        if (existing.status) (account as any).status = existing.status;
      }

      if (opts.dryRun) {
        console.log(`  [DRY RUN] ${existing ? 'UPDATE' : 'CREATE'} account: ${sender.email} (${sender.provider})`);
      } else {
        await imapAccounts.upsert(account, 'setup:senders');

        // Create or update sender profile
        const existingProfile = existing ? profileByAccountId.get(existing.id) : undefined;
        const defaults = EMAIL_SENDERS_CONFIG;

        if (existingProfile) {
          // Update mutable fields, preserve runtime state (health, counters, warmup progress)
          existingProfile.name = sender.displayName;
          existingProfile.persona = sender.persona || existingProfile.persona;
          existingProfile.dailySendLimit = sender.dailySendLimit || existingProfile.dailySendLimit;
          existingProfile.maxLeadsAssigned = sender.maxLeadsAssigned || existingProfile.maxLeadsAssigned;
          if (sender.signature !== undefined) existingProfile.signature = sender.signature;
          await senderProfiles.upsert(existingProfile, 'setup:senders');
          console.log(`  UPDATED  ${sender.email} (profile: ${existingProfile.id})`);
          result.updated.push(sender.email);
        } else {
          const profile = senderProfiles.createFromAccount(account, {
            persona: sender.persona || 'general',
            dailySendLimit: sender.dailySendLimit || defaults.defaultDailySendLimit,
            maxLeadsAssigned: sender.maxLeadsAssigned || defaults.defaultMaxLeadsAssigned,
            isWarmingUp: sender.warmup !== false,
            warmupRamp: sender.warmupRamp || defaults.defaultWarmupRamp,
            signature: sender.signature,
          });
          await senderProfiles.upsert(profile, 'setup:senders');
          console.log(`  CREATED  ${sender.email} (profile: ${profile.id})`);
          result.created.push(sender.email);
        }
      }

      // Optional: test SMTP connection
      if (opts.test && !opts.dryRun) {
        const freshAccount = await imapAccounts.getById(account.id);
        if (freshAccount) {
          const testResult = await smtpDelivery.testConnection(freshAccount);
          result.tested.push({ email: sender.email, ...testResult });
          console.log(`  TESTED   ${sender.email}: ${testResult.success ? 'OK' : `FAIL — ${testResult.error}`}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${sender.email}: ${msg}`);
      console.error(`  ERROR    ${sender.email}: ${msg}`);
    }
  }

  // ── Prune (remove accounts not in config) ─────────────────────

  if (opts.prune) {
    for (const account of existingAccounts) {
      if (!configEmails.has(account.email)) {
        if (opts.dryRun) {
          console.log(`  [DRY RUN] REMOVE account: ${account.email}`);
        } else {
          // Remove sender profile first
          const profile = profileByAccountId.get(account.id);
          if (profile) {
            await senderProfiles.remove(profile.id, 'setup:senders');
          }
          await imapAccounts.remove(account.id, 'setup:senders');
          console.log(`  REMOVED  ${account.email}`);
          result.removed.push(account.email);
        }
      }
    }
  }

  return result;
}

// ─── CLI Entry Point ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const prune = args.includes('--prune');
  const test = args.includes('--test');

  if (dryRun) console.log('DRY RUN — no changes will be written.\n');

  const result = await syncSenders({ dryRun, prune, test });

  // Summary
  console.log('\n─── Summary ──────────────────────────────────────');
  console.log(`  Created: ${result.created.length}`);
  console.log(`  Updated: ${result.updated.length}`);
  console.log(`  Removed: ${result.removed.length}`);
  console.log(`  Errors:  ${result.errors.length}`);
  if (result.tested.length > 0) {
    const passed = result.tested.filter((t) => t.success).length;
    console.log(`  SMTP Tests: ${passed}/${result.tested.length} passed`);
  }
  console.log('');

  if (result.errors.length > 0) {
    console.error('Errors:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
