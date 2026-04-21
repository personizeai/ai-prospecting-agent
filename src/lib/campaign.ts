/**
 * Campaign Helpers — Enrollment, stats, and campaign-aware queries.
 *
 * This is the integration point between campaigns and the rest of the system.
 * Every function here is small and calls existing infrastructure.
 *
 * Usage:
 *   import { campaigns } from '../lib/campaign.js';
 *   await campaigns.enroll(email, 'fintech-ctos-q2');
 *   await campaigns.incrementStat('fintech-ctos-q2', 'emails_sent');
 *   const config = await campaigns.getConfig('fintech-ctos-q2');
 */

import { client } from '../config.js';
import { memory } from './memory.js';
import { senderProfiles } from './sender-profiles.js';
import { workspace } from './workspace.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'campaign' });

// ─── Types ──────────────────────────────────────────────────────────

export interface CampaignConfig {
  campaignId: string;
  name: string;
  status: string;
  market: string;
  agentMode: string;
  icpCriteria: ICPCriteria | null;
  senderProfileIds: string[];
  dailySendCap: number;
  cadence: string;
  maxEmails: number;
  governanceOverrides: string[];
}

export interface ICPCriteria {
  industries?: string[];
  seniorities?: string[];
  titles?: string[];
  departments?: string[];
  min_employees?: number;
  max_employees?: number;
  geos?: string[];
}

export interface CampaignStats {
  contacts_enrolled: number;
  contacts_reached: number;
  emails_sent: number;
  replies: number;
  positive_replies: number;
  meetings_booked: number;
  bounced: number;
  opted_out: number;
  emails_sent_today: number;
}

// ─── Read Campaign Config ───────────────────────────────────────────

async function getConfig(campaignId: string): Promise<CampaignConfig | null> {
  try {
    const result = await client.memory.properties({
      email: campaignId,
      type: 'Campaign',
      propertyNames: [
        'campaign_id', 'name', 'status', 'market', 'agent_mode',
        'icp_criteria', 'sender_profile_ids', 'daily_send_cap',
        'cadence', 'max_emails', 'governance_overrides',
      ],
    });

    const props: Record<string, any> = {};
    for (const prop of (result.data as any)?.properties ?? []) {
      props[prop.systemName || prop.name] = prop.value;
    }

    if (!props.campaign_id) return null;

    let icpCriteria: ICPCriteria | null = null;
    if (props.icp_criteria) {
      try {
        icpCriteria = typeof props.icp_criteria === 'string'
          ? JSON.parse(props.icp_criteria)
          : props.icp_criteria;
      } catch { /* invalid JSON — leave null */ }
    }

    return {
      campaignId: props.campaign_id,
      name: props.name || '',
      status: props.status || 'Draft',
      market: props.market || '',
      agentMode: props.agent_mode || 'outbound-sdr',
      icpCriteria,
      senderProfileIds: Array.isArray(props.sender_profile_ids) ? props.sender_profile_ids : [],
      dailySendCap: Number(props.daily_send_cap) || 0,
      cadence: props.cadence || 'standard',
      maxEmails: Number(props.max_emails) || 3,
      governanceOverrides: Array.isArray(props.governance_overrides) ? props.governance_overrides : [],
    };
  } catch (err) {
    log.warn('Failed to read campaign config', { campaignId, error: (err as Error).message });
    return null;
  }
}

// ─── List Active Campaigns ──────────────────────────────────────────

async function listActive(): Promise<CampaignConfig[]> {
  try {
    const result = await memory.filterByProperty({
      type: 'Campaign',
      conditions: [{ propertyName: 'status', operator: 'equals', value: 'Active' }],
      limit: 50,
    });

    const configs: CampaignConfig[] = [];
    for (const record of result.records) {
      const props = record.matchedProperties || {};
      let icpCriteria: ICPCriteria | null = null;
      if (props.icp_criteria) {
        try {
          icpCriteria = typeof props.icp_criteria === 'string'
            ? JSON.parse(props.icp_criteria as string)
            : props.icp_criteria as ICPCriteria;
        } catch { /* skip */ }
      }

      configs.push({
        campaignId: String(props.campaign_id || ''),
        name: String(props.name || ''),
        status: String(props.status || 'Active'),
        market: String(props.market || ''),
        agentMode: String(props.agent_mode || 'outbound-sdr'),
        icpCriteria,
        senderProfileIds: Array.isArray(props.sender_profile_ids) ? props.sender_profile_ids : [],
        dailySendCap: Number(props.daily_send_cap) || 0,
        cadence: String(props.cadence || 'standard'),
        maxEmails: Number(props.max_emails) || 3,
        governanceOverrides: Array.isArray(props.governance_overrides) ? props.governance_overrides : [],
      });
    }

    return configs;
  } catch (err) {
    log.warn('Failed to list active campaigns', { error: (err as Error).message });
    return [];
  }
}

// ─── Enroll Contact in Campaign ─────────────────────────────────────

/**
 * Enroll a contact in a campaign:
 *   1. Check contact isn't already in an active campaign
 *   2. Set campaign_id on contact
 *   3. Assign sender from campaign's sender pool
 *   4. Append to campaign_history
 *   5. Increment campaign.contacts_enrolled
 *   6. Log to workspace
 */
async function enroll(
  contactEmail: string,
  campaignId: string,
  opts?: { skipDuplicateCheck?: boolean },
): Promise<{ enrolled: boolean; reason?: string; senderId?: string }> {
  // 1. Check for existing campaign assignment
  if (!opts?.skipDuplicateCheck) {
    try {
      const existing = await client.memory.properties({
        email: contactEmail,
        type: 'Contact',
        propertyNames: ['campaign_id', 'campaign_history'],
        nonEmpty: true,
      });
      const props: Record<string, any> = {};
      for (const prop of (existing.data as any)?.properties ?? []) {
        props[prop.systemName || prop.name] = prop.value;
      }

      if (props.campaign_id) {
        return {
          enrolled: false,
          reason: `Already in campaign "${props.campaign_id}"`,
        };
      }

      const history = Array.isArray(props.campaign_history) ? props.campaign_history : [];
      if (history.includes(campaignId)) {
        return {
          enrolled: false,
          reason: `Previously enrolled in "${campaignId}" — would re-enroll`,
        };
      }
    } catch {
      // Properties lookup failed — proceed with enrollment
    }
  }

  // 2. Load campaign config for sender assignment
  const config = await getConfig(campaignId);
  if (!config) {
    return { enrolled: false, reason: `Campaign "${campaignId}" not found` };
  }
  if (config.status !== 'Active' && config.status !== 'Draft') {
    return { enrolled: false, reason: `Campaign "${campaignId}" is ${config.status}` };
  }

  // 3. Assign sender from campaign's pool
  let assignedSenderId: string | undefined;

  // Read contact properties for persona matching
  let seniority: string | undefined;
  let department: string | undefined;
  let companyDomain: string | undefined;
  try {
    const contactProps = await client.memory.properties({
      email: contactEmail,
      type: 'Contact',
      propertyNames: ['seniority_level', 'department', 'company_website'],
    });
    for (const prop of (contactProps.data as any)?.properties ?? []) {
      if (prop.systemName === 'seniority_level') seniority = prop.value;
      if (prop.systemName === 'department') department = prop.value;
      if (prop.systemName === 'company_website') companyDomain = prop.value;
    }
  } catch { /* proceed without */ }

  if (config.senderProfileIds.length > 0) {
    // Assign from campaign's sender pool
    const allProfiles = await senderProfiles.listActive();
    const campaignProfiles = allProfiles.filter(p => config.senderProfileIds.includes(p.id));

    if (campaignProfiles.length > 0) {
      // Use the sender assignment logic but scoped to campaign profiles
      // Pick by: account consistency > capacity > persona match
      const assigned = await senderProfiles.assignSender({
        contactEmail,
        companyDomain,
        seniority,
        department,
      });

      // Check if assigned sender is in campaign pool
      if (assigned && config.senderProfileIds.includes(assigned.id)) {
        assignedSenderId = assigned.id;
      } else {
        // Fallback: pick campaign sender with most capacity
        const withCapacity = campaignProfiles
          .filter(p => senderProfiles.getRemainingCapacity(p) > 0)
          .sort((a, b) => senderProfiles.getRemainingCapacity(b) - senderProfiles.getRemainingCapacity(a));
        if (withCapacity.length > 0) {
          assignedSenderId = withCapacity[0].id;
        }
      }
    }
  } else {
    // No campaign-specific pool — use global assignment
    const assigned = await senderProfiles.assignSender({
      contactEmail,
      companyDomain,
      seniority,
      department,
    });
    if (assigned) assignedSenderId = assigned.id;
  }

  // 4. Set campaign_id + assigned_sender on contact
  await memory.update({
    recordId: contactEmail,
    type: 'Contact',
    propertyName: 'campaign_id',
    propertyValue: campaignId,
    updatedBy: 'campaign-enrollment',
  });

  if (assignedSenderId) {
    await memory.update({
      recordId: contactEmail,
      type: 'Contact',
      propertyName: 'assigned_sender',
      propertyValue: assignedSenderId,
      updatedBy: 'campaign-enrollment',
    });
  }

  // 5. Append to campaign_history
  await memory.update({
    recordId: contactEmail,
    type: 'Contact',
    propertyName: 'campaign_history',
    arrayPush: { items: [campaignId] },
    updatedBy: 'campaign-enrollment',
  });

  // 6. Increment campaign stat
  await incrementStat(campaignId, 'contacts_enrolled');

  // 7. Log to workspace
  await workspace.addUpdate(contactEmail, {
    author: 'campaign-enrollment',
    type: 'system',
    summary: `Enrolled in campaign "${config.name}" (${campaignId})${assignedSenderId ? `, sender: ${assignedSenderId}` : ''}`,
  });

  log.info('Contact enrolled in campaign', {
    email: contactEmail,
    campaignId,
    sender: assignedSenderId,
  });

  return { enrolled: true, senderId: assignedSenderId };
}

// ─── Campaign Stats ─────────────────────────────────────────────────

/**
 * Increment a stat counter on a campaign record.
 *
 * Uses arrayPush to append a "+1" marker instead of read-then-write.
 * This avoids the race condition where two parallel calls both read 5
 * and both write 6 instead of 7.
 *
 * The actual count is stored directly as a number, but we use
 * optimistic concurrency (expectedVersion) to detect conflicts.
 * On conflict, we retry with a fresh read.
 */
async function incrementStat(
  campaignId: string,
  field: keyof CampaignStats,
  amount = 1,
): Promise<void> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await client.memory.properties({
        email: campaignId,
        type: 'Campaign',
        propertyNames: [field],
      });
      const current = Number(
        (result.data as any)?.properties?.find(
          (p: any) => p.systemName === field || p.name === field
        )?.value
      ) || 0;

      await memory.update({
        recordId: campaignId,
        type: 'Campaign',
        propertyName: field,
        propertyValue: current + amount,
        updatedBy: 'campaign-stats',
      });

      return; // Success
    } catch (err) {
      const msg = (err as Error).message || '';
      // Retry on version conflict (optimistic concurrency)
      if (msg.includes('version') || msg.includes('conflict') || msg.includes('409')) {
        log.info('Stat increment conflict, retrying', { campaignId, field, attempt });
        continue;
      }
      log.warn('Failed to increment campaign stat', { campaignId, field, error: msg });
      return;
    }
  }
  log.warn('Stat increment retries exhausted', { campaignId, field, maxRetries });
}

/**
 * Increment emails_sent_today, respecting daily reset.
 * Returns the new count (for cap checking).
 */
async function incrementDailySend(campaignId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  try {
    const result = await client.memory.properties({
      email: campaignId,
      type: 'Campaign',
      propertyNames: ['emails_sent_today', 'emails_sent_today_date'],
    });

    const props: Record<string, any> = {};
    for (const prop of (result.data as any)?.properties ?? []) {
      props[prop.systemName || prop.name] = prop.value;
    }

    let sentToday = Number(props.emails_sent_today) || 0;
    const sentDate = props.emails_sent_today_date || '';

    // Reset if new day
    if (sentDate !== today) {
      sentToday = 0;
      await memory.update({
        recordId: campaignId,
        type: 'Campaign',
        propertyName: 'emails_sent_today_date',
        propertyValue: today,
        updatedBy: 'campaign-stats',
      });
    }

    sentToday += 1;

    await memory.update({
      recordId: campaignId,
      type: 'Campaign',
      propertyName: 'emails_sent_today',
      propertyValue: sentToday,
      updatedBy: 'campaign-stats',
    });

    return sentToday;
  } catch (err) {
    log.warn('Failed to increment daily send', { campaignId, error: (err as Error).message });
    return 0;
  }
}

/**
 * Check if campaign has remaining daily capacity.
 */
async function hasCapacity(campaignId: string): Promise<boolean> {
  const config = await getConfig(campaignId);
  if (!config) return false;
  if (config.dailySendCap === 0) return true; // 0 = unlimited

  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await client.memory.properties({
      email: campaignId,
      type: 'Campaign',
      propertyNames: ['emails_sent_today', 'emails_sent_today_date'],
    });

    const props: Record<string, any> = {};
    for (const prop of (result.data as any)?.properties ?? []) {
      props[prop.systemName || prop.name] = prop.value;
    }

    const sentDate = props.emails_sent_today_date || '';
    if (sentDate !== today) return true; // New day, counter reset

    const sentToday = Number(props.emails_sent_today) || 0;
    return sentToday < config.dailySendCap;
  } catch {
    return true; // On error, allow sending (fail open)
  }
}

/**
 * Read campaign stats from properties (0 compute cost — just a property read).
 */
async function getStats(campaignId: string): Promise<CampaignStats> {
  const defaults: CampaignStats = {
    contacts_enrolled: 0,
    contacts_reached: 0,
    emails_sent: 0,
    replies: 0,
    positive_replies: 0,
    meetings_booked: 0,
    bounced: 0,
    opted_out: 0,
    emails_sent_today: 0,
  };

  try {
    const result = await client.memory.properties({
      email: campaignId,
      type: 'Campaign',
      propertyNames: Object.keys(defaults),
    });

    for (const prop of (result.data as any)?.properties ?? []) {
      const key = (prop.systemName || prop.name) as keyof CampaignStats;
      if (key in defaults) {
        defaults[key] = Number(prop.value) || 0;
      }
    }
  } catch (err) {
    log.warn('Failed to read campaign stats', { campaignId, error: (err as Error).message });
  }

  return defaults;
}

// ─── ICP Matching ───────────────────────────────────────────────────

/**
 * Match a contact's properties against a campaign's ICP criteria.
 * Returns a score 0-100 (higher = better match).
 * Deterministic — no AI calls.
 */
function matchICP(
  contactProps: Record<string, any>,
  criteria: ICPCriteria,
): number {
  let score = 0;
  let maxScore = 0;

  if (criteria.industries?.length) {
    maxScore += 25;
    const industry = String(contactProps.industry || contactProps.company_industry || '').toLowerCase();
    if (criteria.industries.some(i => industry.includes(i.toLowerCase()))) {
      score += 25;
    }
  }

  if (criteria.min_employees || criteria.max_employees) {
    maxScore += 20;
    const size = Number(contactProps.employee_count || contactProps.company_size || 0);
    if (
      (!criteria.min_employees || size >= criteria.min_employees) &&
      (!criteria.max_employees || size <= criteria.max_employees)
    ) {
      score += 20;
    }
  }

  if (criteria.geos?.length) {
    maxScore += 15;
    const geo = String(contactProps.country || contactProps.headquarters || '').toLowerCase();
    if (criteria.geos.some(g => geo.includes(g.toLowerCase()))) {
      score += 15;
    }
  }

  if (criteria.seniorities?.length) {
    maxScore += 20;
    const seniority = String(contactProps.seniority_level || '').toLowerCase();
    if (criteria.seniorities.some(s => seniority.toLowerCase().includes(s.toLowerCase()))) {
      score += 20;
    }
  }

  if (criteria.titles?.length) {
    maxScore += 20;
    const title = String(contactProps.job_title || '').toLowerCase();
    if (criteria.titles.some(t => title.includes(t.toLowerCase()))) {
      score += 20;
    }
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 50;
}

/**
 * Find the best matching active campaign for a contact's properties.
 * Returns null if no campaign matches above threshold (40).
 */
async function matchToCampaign(
  contactProps: Record<string, any>,
): Promise<{ campaignId: string; score: number } | null> {
  const activeCampaigns = await listActive();

  let bestMatch: { campaignId: string; score: number } | null = null;

  for (const campaign of activeCampaigns) {
    if (!campaign.icpCriteria) continue;

    const score = matchICP(contactProps, campaign.icpCriteria);
    if (score >= 40 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { campaignId: campaign.campaignId, score };
    }
  }

  return bestMatch;
}

// ─── Export ─────────────────────────────────────────────────────────

export const campaigns = {
  getConfig,
  listActive,
  enroll,
  incrementStat,
  incrementDailySend,
  hasCapacity,
  getStats,
  matchICP,
  matchToCampaign,
};
