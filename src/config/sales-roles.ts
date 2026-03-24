/**
 * Sales Org Roles — Specialized agent roles that coordinate under a VP-of-Sales strategizer.
 *
 * The pipeline architecture stays the same. What changes per role is:
 *   - Which contacts the role owns (by lead_status)
 *   - When leads are handed off to another role
 *   - Which governance overlays apply (voice, playbook, cadence)
 *   - Which task owners the role's executor picks up
 *
 * Roles are orthogonal to Agent Modes:
 *   - Mode = use case (outbound-sdr, ecommerce-winback, member-renewal)
 *   - Role = organizational position (SDR, AE, CSM)
 *   An SDR role might operate in "outbound-sdr" mode OR "event-followup" mode.
 *
 * When SALES_ORG_ENABLED=false (default), the system behaves as a single agent.
 * When enabled, role-scoped schedulers take over and contacts are partitioned by role_owner.
 */

// ─── Types ────────────────────────────────────────────────────────

export type SalesRoleId = 'sdr' | 'ae' | 'csm' | 'sales-ops' | 'revenue-analyst';

export interface HandoffTrigger {
  /** When lead_status transitions to this value... */
  fromStatus: string;
  /** ...hand off to this role. */
  toRole: SalesRoleId;
  /** Optional condition description (used in strategizer prompt). */
  condition?: string;
}

export interface SalesRole {
  id: SalesRoleId;
  name: string;
  description: string;
  /** lead_status values this role actively works. */
  ownsStatuses: string[];
  /** When a contact enters one of these statuses with no role_owner, this role claims it. */
  claimTriggers: string[];
  /** When to automatically hand off to another role. */
  handoffTriggers: HandoffTrigger[];
  /** Task owner strings this role's executor picks up. */
  taskOwners: string[];
  /** Governance overlay suffixes (e.g., 'brand-voice--sdr'). */
  governanceOverlays: string[];
  /** Which of the 18 agent modes this role defaults to. */
  defaultAgentMode: string;
  /** Cron schedules for this role's automated tasks. */
  schedule: {
    /** When to run outreach generation + sending. */
    outreachCron: string;
    /** When to pick up and execute pending tasks. */
    taskExecutorCron: string;
  };
}

// ─── Role Definitions ─────────────────────────────────────────────

export const SALES_ROLES: Record<SalesRoleId, SalesRole> = {

  sdr: {
    id: 'sdr',
    name: 'SDR',
    description: 'Sales Development Rep — cold outreach, qualification, and meeting booking. Owns leads from first touch to positive reply.',
    ownsStatuses: ['New', 'Researching', 'Qualified', 'Contacted'],
    claimTriggers: ['New', 'Researching'],
    handoffTriggers: [
      { fromStatus: 'Engaged', toRole: 'ae', condition: 'Lead showed buying interest (positive reply, meeting request)' },
      { fromStatus: 'Meeting Set', toRole: 'ae', condition: 'Meeting booked — AE takes the conversation' },
    ],
    taskOwners: ['sdr-outreach-agent', 'outreach-agent'],
    governanceOverlays: ['brand-voice--sdr', 'outreach-playbook--sdr'],
    defaultAgentMode: 'outbound-sdr',
    schedule: {
      outreachCron: '0 10,14 * * 1-5',    // 10am + 2pm UTC, Mon-Fri
      taskExecutorCron: '*/30 * * * *',     // Every 30 min
    },
  },

  ae: {
    id: 'ae',
    name: 'AE',
    description: 'Account Executive — warm follow-up, deal management, proposals, and closing. Takes over after SDR qualifies the lead.',
    ownsStatuses: ['Engaged', 'Meeting Set', 'Opportunity'],
    claimTriggers: ['Engaged', 'Meeting Set'],
    handoffTriggers: [
      { fromStatus: 'Customer', toRole: 'csm', condition: 'Deal closed-won — CSM takes over for onboarding and retention' },
    ],
    taskOwners: ['ae-outreach-agent'],
    governanceOverlays: ['brand-voice--ae', 'outreach-playbook--ae'],
    defaultAgentMode: 'outbound-sdr',
    schedule: {
      outreachCron: '0 9,13 * * 1-5',     // 9am + 1pm UTC, Mon-Fri (offset from SDR)
      taskExecutorCron: '15,45 * * * *',    // Every 30 min, offset from SDR
    },
  },

  csm: {
    id: 'csm',
    name: 'CSM',
    description: 'Customer Success Manager — onboarding, retention, renewal, and expansion. Owns the relationship post-sale.',
    ownsStatuses: ['Customer', 'Churned'],
    claimTriggers: ['Customer'],
    handoffTriggers: [
      // Churned customers that re-engage go back to SDR for re-qualification
      { fromStatus: 'New', toRole: 'sdr', condition: 'Churned customer re-entered pipeline as new lead' },
    ],
    taskOwners: ['csm-engagement-agent'],
    governanceOverlays: ['brand-voice--csm', 'outreach-playbook--csm'],
    defaultAgentMode: 'member-renewal',
    schedule: {
      outreachCron: '0 11 * * 1-5',        // 11am UTC, Mon-Fri (once daily — less aggressive)
      taskExecutorCron: '10,40 * * * *',    // Every 30 min, offset from SDR/AE
    },
  },

  'sales-ops': {
    id: 'sales-ops',
    name: 'Sales Ops',
    description: 'Sales Operations — CRM sync, data enrichment, reporting, and tooling. Background role, no outreach.',
    ownsStatuses: [],
    claimTriggers: [],
    handoffTriggers: [],
    taskOwners: ['enrichment-agent', 'signal-agent'],
    governanceOverlays: [],
    defaultAgentMode: 'outbound-sdr',
    schedule: {
      outreachCron: '',  // No outreach
      taskExecutorCron: '*/30 * * * *',
    },
  },

  'revenue-analyst': {
    id: 'revenue-analyst',
    name: 'Revenue Analyst',
    description: 'Revenue Intelligence — signal detection, account scoring, pipeline forecasting. Read-only analytical role.',
    ownsStatuses: [],
    claimTriggers: [],
    handoffTriggers: [],
    taskOwners: [],
    governanceOverlays: [],
    defaultAgentMode: 'outbound-sdr',
    schedule: {
      outreachCron: '',  // No outreach
      taskExecutorCron: '',
    },
  },
};

// ─── Mode-to-Role Mapping ─────────────────────────────────────────

/** Maps each agent mode to its default role. Used for initial role inference. */
export const MODE_TO_ROLE: Record<string, SalesRoleId> = {
  // Sales & GTM → SDR
  'outbound-sdr': 'sdr',
  'abm': 'sdr',
  'cold-deals': 'sdr',
  'partner-recruitment': 'sdr',
  'event-followup': 'sdr',
  'agency-outreach': 'sdr',

  // Post-sale & retention → CSM
  'ecommerce-winback': 'csm',
  'post-purchase': 'csm',
  'cart-abandonment': 'csm',
  'member-renewal': 'csm',
  'member-onboarding': 'csm',
  'donor-engagement': 'csm',
  'volunteer-recruitment': 'csm',
  'alumni-engagement': 'csm',

  // Recruiting → SDR (sourcing is prospecting)
  'talent-sourcing': 'sdr',
  'employee-onboarding': 'csm',

  // Education → SDR (enrollment is prospecting)
  'student-enrollment': 'sdr',

  // Real estate → SDR
  'real-estate-nurture': 'sdr',
};

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Get the role that should own a contact based on their lead_status.
 */
export function inferRoleFromStatus(leadStatus: string): SalesRoleId {
  for (const role of Object.values(SALES_ROLES)) {
    if (role.claimTriggers.includes(leadStatus) || role.ownsStatuses.includes(leadStatus)) {
      return role.id;
    }
  }
  return 'sdr'; // Default to SDR for unknown statuses
}

/**
 * Check if a status transition should trigger a handoff.
 */
export function getHandoffTarget(currentRole: SalesRoleId, newStatus: string): HandoffTrigger | null {
  const role = SALES_ROLES[currentRole];
  if (!role) return null;
  return role.handoffTriggers.find((h) => h.fromStatus === newStatus) || null;
}

/**
 * Get all task owner strings for a role (for task executor filtering).
 */
export function getTaskOwnersForRole(roleId: SalesRoleId): string[] {
  return SALES_ROLES[roleId]?.taskOwners || [];
}

/**
 * Get all task owners across all active roles.
 */
export function getAllActiveTaskOwners(activeRoles: SalesRoleId[]): string[] {
  const owners = new Set<string>();
  for (const roleId of activeRoles) {
    for (const owner of getTaskOwnersForRole(roleId)) {
      owners.add(owner);
    }
  }
  return [...owners];
}
