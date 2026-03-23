/**
 * Sender Profiles — Stable identity layer for email outreach.
 *
 * A Sender Profile decouples "who sends" from "which email address":
 *   - Stable ID (sp_xxx) that never changes, even when email addresses rotate
 *   - Links to an active IMAP account for sending
 *   - Tracks health (bounce rate, deliverability), warmup state, capacity
 *   - Contacts are assigned to profiles, not to email addresses
 *
 * When a sender's email gets burned:
 *   1. Add new IMAP account in dashboard
 *   2. Update profile's activeAccountId → new account
 *   3. All assigned leads continue seamlessly from the new address
 *
 * Storage: Personize guideline (same pattern as imap-accounts-config).
 *
 * Usage:
 *   import { senderProfiles } from '../lib/sender-profiles.js';
 *   const profile = await senderProfiles.assignToContact(contactEmail);
 *   const sender = await senderProfiles.resolveForContact(contactEmail);
 */

import { client } from '../config.js';
import { imapAccounts } from './imap-accounts.js';
import { logger } from './logger.js';
import type { ImapAccount } from './imap-service.js';

const log = logger.child({ module: 'sender-profiles' });

// ─── Types ────────────────────────────────────────────────────────

export interface SenderProfile {
  /** Stable identifier (e.g., "sp_abc123"). Never changes. */
  id: string;
  /** Display name for outbound emails (e.g., "Alice Smith"). */
  name: string;
  /** Persona type — used for matching to leads. */
  persona: 'technical' | 'executive' | 'general' | 'consultative';
  /** Currently active IMAP account ID (for sending + receiving). */
  activeAccountId: string;
  /** Previous account IDs (audit trail for sender rotation). */
  previousAccountIds: string[];
  /** Max leads that can be assigned to this profile. */
  maxLeadsAssigned: number;
  /** Current number of assigned leads (updated by assignment logic). */
  assignedLeadCount: number;
  /** Daily send limit (may differ from IMAP account limit for warmup). */
  dailySendLimit: number;
  /** Emails sent today (reset daily by the monitor). */
  sentToday: number;
  /** Date string for sentToday (to know when to reset). */
  sentTodayDate: string;
  /** Email signature (HTML). */
  signature?: string;

  // ─── Health ─────────────────────────────────────────────
  /** Overall health score (0-100). Degrades on bounces, improves on replies. */
  healthScore: number;
  /** Total emails sent (lifetime). */
  totalSent: number;
  /** Total bounces (lifetime). */
  totalBounces: number;
  /** Total replies received (lifetime). */
  totalReplies: number;
  /** Whether this profile is active and available for assignment. */
  active: boolean;
  /** If paused, why. */
  pauseReason?: string;

  // ─── Warmup ─────────────────────────────────────────────
  /** Whether this sender is in warmup phase. */
  isWarmingUp: boolean;
  /** Warmup start date (ISO). */
  warmupStartDate?: string;
  /** Current warmup day (1-based). */
  warmupDay: number;
  /** Warmup ramp schedule: daily send limits per day.
   *  e.g., [5, 10, 15, 20, 30, 40, 50, 75, 100] means
   *  day 1: 5 emails, day 2: 10, ..., day 9+: 100. */
  warmupRamp: number[];

  /** When this profile was created. */
  createdAt: string;
}

export interface ResolvedSender {
  profile: SenderProfile;
  account: ImapAccount;
}

// ─── Guideline Storage ────────────────────────────────────────────

export const SENDER_PROFILES_GUIDELINE_NAME = 'sender-profiles-config';

interface StoredConfig {
  profiles: SenderProfile[];
  updatedAt: string;
  updatedBy: string;
}

async function findGuideline(): Promise<{ id: string; config: StoredConfig } | null> {
  try {
    const guidelines = await client.guidelines.list();
    const actions = guidelines.data?.actions || [];
    const match = actions.find(
      (a: any) => a.payload?.name === SENDER_PROFILES_GUIDELINE_NAME,
    );
    if (match && typeof match.payload?.value === 'string') {
      try {
        return { id: match.id, config: JSON.parse(match.payload.value) };
      } catch { /* invalid JSON */ }
    }
    return null;
  } catch (err) {
    log.error('Failed to read sender profiles', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function saveGuideline(config: StoredConfig, existingId?: string): Promise<void> {
  const value = JSON.stringify(config);
  if (existingId) {
    await client.guidelines.update(existingId, { value });
  } else {
    await client.guidelines.create({
      name: SENDER_PROFILES_GUIDELINE_NAME,
      value,
      tags: ['system', 'sender-profiles'],
    });
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────

async function list(): Promise<SenderProfile[]> {
  const stored = await findGuideline();
  return stored?.config.profiles || [];
}

async function listActive(): Promise<SenderProfile[]> {
  const profiles = await list();
  return profiles.filter((p) => p.active);
}

async function getById(id: string): Promise<SenderProfile | null> {
  const profiles = await list();
  return profiles.find((p) => p.id === id) || null;
}

async function upsert(profile: SenderProfile, updatedBy = 'system'): Promise<void> {
  const stored = await findGuideline();
  const profiles = stored?.config.profiles || [];
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  await saveGuideline(
    { profiles, updatedAt: new Date().toISOString(), updatedBy },
    stored?.id,
  );
  log.info('Sender profile upserted', { profileId: profile.id, name: profile.name });
}

async function remove(id: string, updatedBy = 'system'): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;
  const profiles = stored.config.profiles.filter((p) => p.id !== id);
  await saveGuideline(
    { profiles, updatedAt: new Date().toISOString(), updatedBy },
    stored.id,
  );
  log.info('Sender profile removed', { profileId: id });
}

// ─── ID Generation ────────────────────────────────────────────────

function generateProfileId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sp_${ts}_${rand}`;
}

// ─── Effective Daily Limit ────────────────────────────────────────

function getEffectiveDailyLimit(profile: SenderProfile): number {
  if (!profile.isWarmingUp) return profile.dailySendLimit;

  // During warmup, use the ramp schedule
  const day = Math.max(1, profile.warmupDay);
  const ramp = profile.warmupRamp;
  if (ramp.length === 0) return profile.dailySendLimit;

  // Clamp to last ramp value if past the ramp length
  const rampLimit = day <= ramp.length ? ramp[day - 1] : ramp[ramp.length - 1];
  return Math.min(rampLimit, profile.dailySendLimit);
}

function getRemainingCapacity(profile: SenderProfile): number {
  const today = new Date().toISOString().split('T')[0];
  const sentToday = profile.sentTodayDate === today ? profile.sentToday : 0;
  return Math.max(0, getEffectiveDailyLimit(profile) - sentToday);
}

// ─── Sender Assignment ────────────────────────────────────────────

/**
 * Pick the best sender profile for a new contact.
 *
 * Deterministic rules (instant, no AI needed):
 *   1. If another contact at the same company already has a sender → use the same one (account consistency)
 *   2. Otherwise, pick the active profile with the most remaining capacity
 *   3. Tie-break by persona match if contact metadata available
 *
 * The strategizer can override this later with a better choice.
 */
async function assignSender(opts: {
  contactEmail: string;
  companyDomain?: string;
  seniority?: string;
  department?: string;
}): Promise<SenderProfile | null> {
  const profiles = await listActive();
  if (profiles.length === 0) return null;

  // ── Rule 1: Account consistency ─────────────────────────
  if (opts.companyDomain) {
    try {
      const result = await client.memory.search({
        type: 'Contact',
        query: `company:${opts.companyDomain}`,
        limit: 10,
      });
      const records = (result.data as any)?.records || result.data || [];
      if (Array.isArray(records)) {
        for (const record of records) {
          const email = record.email || record.id;
          if (email === opts.contactEmail) continue;
          const assignedSender = record.properties?.assigned_sender?.value;
          if (assignedSender) {
            const profile = profiles.find((p) => p.id === assignedSender);
            if (profile && getRemainingCapacity(profile) > 0) {
              log.info('Assigned sender by account consistency', {
                contact: opts.contactEmail,
                profile: profile.id,
                reason: `same account as ${email}`,
              });
              return profile;
            }
          }
        }
      }
    } catch {
      // Search failed, fall through to capacity-based
    }
  }

  // ── Rule 2: Most remaining capacity ─────────────────────
  const withCapacity = profiles
    .filter((p) => getRemainingCapacity(p) > 0 && p.assignedLeadCount < p.maxLeadsAssigned)
    .sort((a, b) => getRemainingCapacity(b) - getRemainingCapacity(a));

  if (withCapacity.length === 0) {
    log.warn('All sender profiles at capacity', { contact: opts.contactEmail });
    return null;
  }

  // ── Rule 3: Persona match (tie-break) ───────────────────
  const seniority = (opts.seniority || '').toLowerCase();
  const department = (opts.department || '').toLowerCase();

  let preferredPersona: SenderProfile['persona'] = 'general';
  if (seniority === 'c-suite' || seniority === 'vp' || seniority === 'founder') {
    preferredPersona = 'executive';
  } else if (department === 'engineering' || department === 'product') {
    preferredPersona = 'technical';
  }

  const personaMatch = withCapacity.find((p) => p.persona === preferredPersona);
  const selected = personaMatch || withCapacity[0];

  log.info('Assigned sender by capacity', {
    contact: opts.contactEmail,
    profile: selected.id,
    persona: selected.persona,
    remaining: getRemainingCapacity(selected),
  });

  return selected;
}

/**
 * Resolve the sender for an already-assigned contact.
 * Looks up assigned_sender property → profile → active IMAP account.
 * Returns null if no sender assigned or account unavailable.
 */
async function resolveForContact(contactEmail: string): Promise<ResolvedSender | null> {
  try {
    const digest = await client.memory.smartDigest({
      email: contactEmail,
      type: 'Contact',
      token_budget: 100,
      include_properties: true,
    });
    const profileId = (digest.data as any)?.properties?.assigned_sender?.value;
    if (!profileId) return null;

    const profile = await getById(profileId);
    if (!profile || !profile.active) return null;

    const account = await imapAccounts.getById(profile.activeAccountId);
    if (!account || !account.sendingEnabled || !account.smtpHost) return null;

    return { profile, account };
  } catch {
    return null;
  }
}

/**
 * Record that a send happened (increment counters).
 */
async function recordSend(profileId: string, bounced = false): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;

  const profile = stored.config.profiles.find((p) => p.id === profileId);
  if (!profile) return;

  const today = new Date().toISOString().split('T')[0];

  // Reset daily counter if new day
  if (profile.sentTodayDate !== today) {
    profile.sentToday = 0;
    profile.sentTodayDate = today;

    // Advance warmup day
    if (profile.isWarmingUp) {
      profile.warmupDay++;
      // End warmup if past the ramp
      if (profile.warmupDay > profile.warmupRamp.length) {
        profile.isWarmingUp = false;
        log.info('Sender warmup complete', { profileId, name: profile.name });
      }
    }
  }

  profile.sentToday++;
  profile.totalSent++;

  if (bounced) {
    profile.totalBounces++;
    // Degrade health: each bounce costs 5 points
    profile.healthScore = Math.max(0, profile.healthScore - 5);

    // Auto-pause if health drops below 30
    if (profile.healthScore < 30 && profile.active) {
      profile.active = false;
      profile.pauseReason = `Auto-paused: health score ${profile.healthScore} (${profile.totalBounces} bounces / ${profile.totalSent} sent)`;
      log.warn('Sender auto-paused due to low health', {
        profileId,
        healthScore: profile.healthScore,
        bounceRate: (profile.totalBounces / profile.totalSent * 100).toFixed(1) + '%',
      });
    }
  } else {
    // Slight health recovery on successful send
    profile.healthScore = Math.min(100, profile.healthScore + 0.5);
  }

  await saveGuideline(
    { ...stored.config, updatedAt: new Date().toISOString(), updatedBy: 'sender-monitor' },
    stored.id,
  );
}

/**
 * Record a reply received (boosts health).
 */
async function recordReply(profileId: string): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;

  const profile = stored.config.profiles.find((p) => p.id === profileId);
  if (!profile) return;

  profile.totalReplies++;
  // Each reply boosts health by 3 points
  profile.healthScore = Math.min(100, profile.healthScore + 3);

  await saveGuideline(
    { ...stored.config, updatedAt: new Date().toISOString(), updatedBy: 'sender-monitor' },
    stored.id,
  );
}

/**
 * Replace a sender's active account (email rotation).
 * Moves current account to previousAccountIds, sets new active.
 */
async function replaceAccount(
  profileId: string,
  newAccountId: string,
  updatedBy = 'dashboard',
): Promise<void> {
  const stored = await findGuideline();
  if (!stored) return;

  const profile = stored.config.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  // Archive old account
  if (profile.activeAccountId && profile.activeAccountId !== newAccountId) {
    profile.previousAccountIds.push(profile.activeAccountId);
  }

  profile.activeAccountId = newAccountId;

  // Optionally update display name from new account
  const newAccount = await imapAccounts.getById(newAccountId);
  if (newAccount?.displayName) {
    profile.name = newAccount.displayName;
  }

  await saveGuideline(
    { ...stored.config, updatedAt: new Date().toISOString(), updatedBy },
    stored.id,
  );

  log.info('Sender account replaced', {
    profileId,
    newAccountId,
    previousCount: profile.previousAccountIds.length,
  });
}

/**
 * Create a sender profile from an IMAP account (convenience for onboarding).
 */
function createFromAccount(account: ImapAccount, overrides?: Partial<SenderProfile>): SenderProfile {
  return {
    id: generateProfileId(),
    name: account.displayName || account.label || account.email,
    persona: 'general',
    activeAccountId: account.id,
    previousAccountIds: [],
    maxLeadsAssigned: 50,
    assignedLeadCount: 0,
    dailySendLimit: 100,
    sentToday: 0,
    sentTodayDate: '',
    healthScore: 100,
    totalSent: 0,
    totalBounces: 0,
    totalReplies: 0,
    active: true,
    isWarmingUp: true,
    warmupStartDate: new Date().toISOString(),
    warmupDay: 1,
    warmupRamp: [5, 10, 15, 25, 35, 50, 75, 100],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Public API ───────────────────────────────────────────────────

export const senderProfiles = {
  list,
  listActive,
  getById,
  upsert,
  remove,
  assignSender,
  resolveForContact,
  recordSend,
  recordReply,
  replaceAccount,
  createFromAccount,
  generateProfileId,
  getEffectiveDailyLimit,
  getRemainingCapacity,
  GUIDELINE_NAME: SENDER_PROFILES_GUIDELINE_NAME,
};
