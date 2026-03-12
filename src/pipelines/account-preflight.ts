/**
 * Account Pre-flight Check
 *
 * Gate that runs BEFORE generating outreach for any contact.
 * Checks the account-level strategy and coordination flags to determine
 * whether outreach should proceed, be modified, delayed, or blocked.
 *
 * This is the integration point that prevents all 10 edge cases:
 * carpet bombing, cold email at engaged accounts, tone-deaf messaging, etc.
 */

import { client } from '../config.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { evaluateAccountStrategy } from './account-strategy.js';
import { ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'account-preflight' });

// ─── Types ─────────────────────────────────────────────────────────

export type PreflightDecision = 'proceed' | 'modify' | 'delay' | 'block';

export interface PreflightResult {
  decision: PreflightDecision;
  reason: string;
  modifications?: {
    /** Override cadence (e.g., 'warm-intro' instead of cold sequence) */
    cadenceOverride?: string;
    /** Angles to avoid in outreach generation */
    angleBlacklist?: string[];
    /** Recommended angles to use */
    angleRecommendations?: string[];
    /** Additional context to inject into outreach generation prompt */
    accountContext?: string;
    /** Max emails in this sequence (may be lower than default) */
    maxEmails?: number;
  };
  /** If delayed, when to retry */
  retryAfter?: string;
}

// ─── Pre-flight Check ──────────────────────────────────────────────

/**
 * Check account-level strategy before sending outreach to a contact.
 *
 * @param contactEmail - The contact being evaluated for outreach
 * @param companyDomain - The company domain (website_url). If unknown, extracted from email.
 * @returns PreflightResult with decision and any modifications
 */
export async function accountPreflight(
  contactEmail: string,
  companyDomain?: string,
): Promise<PreflightResult> {
  // Resolve company domain from email if not provided
  const domain = companyDomain || extractDomainFromEmail(contactEmail);
  if (!domain) {
    // Can't determine company — proceed without account check
    return { decision: 'proceed', reason: 'No company domain available — skipping account check' };
  }

  // Recall previous account strategy (fast mode — ~500ms)
  let strategyResults: any[];
  try {
    const recall = await accountWorkspace.getStrategy(domain);
    strategyResults = (recall.data as any)?.results ?? [];
  } catch {
    log.warn('Account strategy recall failed, proceeding', { domain });
    return { decision: 'proceed', reason: 'Account strategy recall failed — proceeding with default behavior' };
  }

  // No strategy exists yet — check if there are multiple contacts at this company
  // to prevent carpet bombing on first batch outreach
  if (strategyResults.length === 0) {
    if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
      try {
        const contacts = await accountWorkspace.getContacts(domain);
        const contactCount = contacts.data?.recordIds?.length ?? 0;

        if (contactCount >= 2) {
          // Multiple contacts exist but no strategy — run strategy evaluation first
          log.info('No strategy for multi-contact account, triggering evaluation', { domain, contactCount });
          const strategyResult = await evaluateAccountStrategy(domain);

          if (strategyResult) {
            // Strategy created — re-run preflight with the new strategy
            return accountPreflight(contactEmail, domain);
          }
        }
      } catch (err) {
        log.warn('Multi-contact check failed, proceeding', { domain, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { decision: 'proceed', reason: 'No account strategy found — first-time outreach' };
  }

  // Parse the most recent strategy
  const latestStrategy = parseStrategy(strategyResults);
  if (!latestStrategy) {
    return { decision: 'proceed', reason: 'Could not parse account strategy — proceeding with default behavior' };
  }

  // ── Check hard blocks first ─────────────────────────────────────

  const flags = latestStrategy.coordinationFlags || [];

  // BLOCK: Account converted to customer
  if (flags.includes('account_converted') || latestStrategy.accountStage === 'customer') {
    return {
      decision: 'block',
      reason: 'Account has converted to customer — all prospecting stopped',
    };
  }

  // BLOCK: Account is blocked (all contacts negative, critical issues)
  if (latestStrategy.accountHealth === 'blocked') {
    return {
      decision: 'block',
      reason: `Account is blocked: ${latestStrategy.strategySummary?.substring(0, 200)}`,
    };
  }

  // ── Check delays ────────────────────────────────────────────────

  // DELAY: Negative company event (layoffs, crisis)
  if (flags.includes('negative_company_event')) {
    return {
      decision: 'delay',
      reason: 'Negative company event detected — outreach paused',
      retryAfter: new Date(Date.now() + 21 * 86400_000).toISOString(), // 3 weeks
    };
  }

  // DELAY: Carpet bomb risk — check if we recently emailed other contacts
  if (flags.includes('carpet_bomb_risk')) {
    const contacts = latestStrategy.contactRollup || [];
    const recentlyContacted = contacts.filter((c: any) =>
      c.email !== contactEmail &&
      c.sequenceStatus !== 'Not Started' &&
      c.lastAction && daysSince(c.lastAction) < ACCOUNT_STRATEGY_CONFIG.carpetBombWindowDays,
    );

    if (recentlyContacted.length >= ACCOUNT_STRATEGY_CONFIG.maxContactsPerWeek) {
      return {
        decision: 'delay',
        reason: `Carpet bomb prevention: ${recentlyContacted.length} contacts already emailed this week at ${domain}`,
        retryAfter: new Date(Date.now() + ACCOUNT_STRATEGY_CONFIG.carpetBombWindowDays * 86400_000).toISOString(),
      };
    }
  }

  // ── Check modifications ─────────────────────────────────────────

  const modifications: PreflightResult['modifications'] = {};
  let needsModification = false;

  // MODIFY: New contact at advanced account — switch to warm intro
  if (flags.includes('new_contact_at_advanced_account')) {
    const advancedStages = ['engaged', 'opportunity', 'multi_threaded'];
    if (advancedStages.includes(latestStrategy.accountStage)) {
      // Check if THIS specific contact is the new one (Not Started at an advanced account)
      const contactInRollup = (latestStrategy.contactRollup || []).find((c: any) => c.email === contactEmail);
      if (contactInRollup && (contactInRollup.sequenceStatus === 'Not Started' || !contactInRollup.sequenceStatus)) {
        modifications.cadenceOverride = 'warm-intro';
        modifications.maxEmails = 2;

        // Build context about engaged contacts
        const engagedContacts = (latestStrategy.contactRollup || [])
          .filter((c: any) => c.email !== contactEmail && c.sequenceStatus !== 'Not Started')
          .map((c: any) => `${c.name} (${c.role}) — ${c.sequenceStatus}, ${c.engagement}`)
          .join('; ');

        modifications.accountContext = `IMPORTANT: This account is in ${latestStrategy.accountStage} stage. ` +
          `Other contacts already engaged: ${engagedContacts || 'unknown'}. ` +
          `Do NOT use cold outreach tone. Reference the existing relationship. ` +
          `This is a warm introduction, not a cold email.`;

        needsModification = true;
      }
    }
  }

  // MODIFY: Previous relationship (lost deal / churned)
  if (flags.includes('previous_relationship')) {
    modifications.cadenceOverride = 're-engagement';
    modifications.accountContext = (modifications.accountContext || '') +
      ' This account has a previous relationship with us. Acknowledge the history — do not treat as a new prospect.';
    needsModification = true;
  }

  // MODIFY: Pending referral — new contact should reference the referrer
  if (flags.includes('pending_referral')) {
    modifications.cadenceOverride = 'referral';
    modifications.maxEmails = 2;
    modifications.accountContext = (modifications.accountContext || '') +
      ' This contact was referred by someone at the account. Reference the referral in your outreach.';
    needsModification = true;
  }

  // MODIFY: Conflicting signals — inject context about internal dynamics
  if (flags.includes('conflicting_signals')) {
    modifications.accountContext = (modifications.accountContext || '') +
      ' WARNING: Conflicting signals at this account — some contacts are positive, others negative. ' +
      'Be aware of internal dynamics. Do not reference other contacts\' negative responses.';
    needsModification = true;
  }

  // Apply angle blacklist/recommendations from strategy
  if (latestStrategy.angleBlacklist?.length) {
    modifications.angleBlacklist = latestStrategy.angleBlacklist;
    needsModification = true;
  }
  if (latestStrategy.angleRecommendations?.length) {
    modifications.angleRecommendations = latestStrategy.angleRecommendations;
    needsModification = true;
  }

  if (needsModification) {
    return {
      decision: 'modify',
      reason: `Account strategy requires modifications: ${flags.join(', ')}`,
      modifications,
    };
  }

  // All clear — proceed normally
  return { decision: 'proceed', reason: 'Account strategy check passed — no coordination issues' };
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Parse strategy from smartRecall results. Returns the most recent parsed strategy. */
function parseStrategy(results: any[]): any | null {
  for (const item of results) {
    const content = item.text || item.content || '';
    try {
      return JSON.parse(content);
    } catch {
      // Try to extract JSON from mixed content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

/** Extract domain from email, filtering personal domains. */
function extractDomainFromEmail(email: string): string | undefined {
  const personalDomains = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'live.com', 'aol.com', 'icloud.com', 'protonmail.com', 'proton.me',
  ]);
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || personalDomains.has(domain)) return undefined;
  return domain;
}

/** Calculate days since a date string. */
function daysSince(dateStr: string): number {
  const date = new Date(dateStr).getTime();
  if (isNaN(date)) return 999;
  return Math.floor((Date.now() - date) / 86400_000);
}
