/**
 * IMAP Accounts — Personize-backed storage for IMAP account configurations.
 *
 * Stores account configs as a Personize guideline (same pattern as agent-runtime-config).
 * Both the dashboard and the agent read/write from the same guideline.
 *
 * Credentials are encrypted with AES-256-GCM before storage (see imap-service.ts).
 *
 * Usage:
 *   import { imapAccounts } from '../lib/imap-accounts.js';
 *   const accounts = await imapAccounts.list();
 *   await imapAccounts.upsert(account);
 */

import { client } from '../config.js';
import { logger } from './logger.js';
import type { ImapAccount } from './imap-service.js';

const log = logger.child({ module: 'imap-accounts' });

export const IMAP_ACCOUNTS_GUIDELINE_NAME = 'imap-accounts-config';

interface StoredConfig {
  accounts: ImapAccount[];
  updatedAt: string;
  updatedBy: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

async function findGuideline(): Promise<{ id: string; config: StoredConfig } | null> {
  try {
    const guidelines = await client.guidelines.list();
    const actions = guidelines.data?.actions || [];
    const match = actions.find(
      (a: any) => a.payload?.name === IMAP_ACCOUNTS_GUIDELINE_NAME,
    );

    if (match && typeof match.payload?.value === 'string') {
      try {
        const config = JSON.parse(match.payload.value) as StoredConfig;
        return { id: match.id, config };
      } catch {
        log.warn('Invalid JSON in IMAP accounts guideline, returning empty');
      }
    }
    return null;
  } catch (err) {
    log.error('Failed to read IMAP accounts guideline', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function saveGuideline(config: StoredConfig, existingId?: string): Promise<void> {
  const value = JSON.stringify(config);

  if (existingId) {
    await client.guidelines.update(existingId, { value });
  } else {
    await client.guidelines.create({
      name: IMAP_ACCOUNTS_GUIDELINE_NAME,
      value,
      tags: ['system', 'imap-config'],
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * List all configured IMAP accounts.
 */
async function list(): Promise<ImapAccount[]> {
  const stored = await findGuideline();
  return stored?.config.accounts || [];
}

/**
 * List only enabled accounts (for polling).
 */
async function listEnabled(): Promise<ImapAccount[]> {
  const accounts = await list();
  return accounts.filter((a) => a.enabled);
}

/**
 * Get a single account by ID.
 */
async function getById(id: string): Promise<ImapAccount | null> {
  const accounts = await list();
  return accounts.find((a) => a.id === id) || null;
}

/**
 * Create or update an account. Matches on account.id.
 */
async function upsert(account: ImapAccount, updatedBy = 'system'): Promise<void> {
  const stored = await findGuideline();
  const accounts = stored?.config.accounts || [];
  const existingIdx = accounts.findIndex((a) => a.id === account.id);

  if (existingIdx >= 0) {
    accounts[existingIdx] = account;
  } else {
    accounts.push(account);
  }

  await saveGuideline(
    { accounts, updatedAt: new Date().toISOString(), updatedBy },
    stored?.id,
  );

  log.info('IMAP account upserted', { accountId: account.id, email: account.email });
}

/**
 * Delete an account by ID.
 */
async function remove(id: string, updatedBy = 'system'): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;

  const accounts = stored.config.accounts.filter((a) => a.id !== id);

  await saveGuideline(
    { accounts, updatedAt: new Date().toISOString(), updatedBy },
    stored.id,
  );

  log.info('IMAP account removed', { accountId: id });
}

/**
 * Update per-account poll state (lastCheckedAt, lastUids, status, lastError).
 * This is a lightweight partial update — only touches the fields needed after a poll.
 */
async function updatePollState(
  id: string,
  state: Pick<ImapAccount, 'lastCheckedAt' | 'lastUids' | 'status' | 'lastError'>,
): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;

  const account = stored.config.accounts.find((a) => a.id === id);
  if (!account) return;

  Object.assign(account, state);

  await saveGuideline(
    { ...stored.config, updatedAt: new Date().toISOString(), updatedBy: 'imap-monitor' },
    stored.id,
  );
}

export const imapAccounts = {
  list,
  listEnabled,
  getById,
  upsert,
  remove,
  updatePollState,
  GUIDELINE_NAME: IMAP_ACCOUNTS_GUIDELINE_NAME,
};
