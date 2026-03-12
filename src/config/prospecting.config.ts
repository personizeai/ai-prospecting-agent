/**
 * Prospecting Agent Configuration
 *
 * All tunable settings in one place. Edit this file to change:
 * - HubSpot filtering
 * - Apollo enrichment & discovery settings
 * - Signal scanning frequency
 * - Contact discovery filters (titles, seniority, limits)
 *
 * No code changes needed elsewhere — just update values here and redeploy.
 */

// ─── Budget Tier ─────────────────────────────────────────────────
//
// ONE setting controls how aggressively (and expensively) the agent
// monitors and enriches accounts. Everything else derives from this.
//
//   conservative — scoring quarterly, no web research or contact discovery
//                  (lowest cost, good for small lists or tight budgets)
//   balanced     — scoring monthly, research + discovery for hot accounts
//                  (recommended for most teams)
//   aggressive   — scoring weekly, research + discovery for hot + warm
//                  (higher cost, best for teams with strong ICP and budget)
//
// Set via BUDGET_TIER env var or change the default below.

export type BudgetTier = 'conservative' | 'balanced' | 'aggressive';

export const BUDGET_TIER: BudgetTier =
  (process.env.BUDGET_TIER as BudgetTier | undefined) || 'balanced';

/** Internal presets derived from BUDGET_TIER. Power users can override individual settings below. */
const BUDGET_PRESETS: Record<BudgetTier, {
  enableSignalDetection: boolean;
  enableTavilyResearch: boolean;
  enableApolloDiscovery: boolean;
  enableAccountStrategy: boolean;
  rescoringDays: number;
  tavilyRefreshDays: number;
  strategyStalenessDays: number;
  maxResearchPerRun: number;
  maxDiscoveryPerRun: number;
  maxStrategyPerRun: number;
}> = {
  conservative: {
    enableSignalDetection: true,
    enableTavilyResearch: false,
    enableApolloDiscovery: false,
    enableAccountStrategy: false,
    rescoringDays: 90,
    tavilyRefreshDays: 90,
    strategyStalenessDays: 90,
    maxResearchPerRun: 5,
    maxDiscoveryPerRun: 3,
    maxStrategyPerRun: 5,
  },
  balanced: {
    enableSignalDetection: true,
    enableTavilyResearch: true,
    enableApolloDiscovery: true,
    enableAccountStrategy: true,
    rescoringDays: 30,
    tavilyRefreshDays: 30,
    strategyStalenessDays: 30,
    maxResearchPerRun: 10,
    maxDiscoveryPerRun: 5,
    maxStrategyPerRun: 10,
  },
  aggressive: {
    enableSignalDetection: true,
    enableTavilyResearch: true,
    enableApolloDiscovery: true,
    enableAccountStrategy: true,
    rescoringDays: 7,
    tavilyRefreshDays: 7,
    strategyStalenessDays: 7,
    maxResearchPerRun: 25,
    maxDiscoveryPerRun: 15,
    maxStrategyPerRun: 25,
  },
};

const preset = BUDGET_PRESETS[BUDGET_TIER];

// ─── HubSpot Filter ────────────────────────────────────────────────
export const HUBSPOT_CONFIG = {
  /** Internal name of the custom property used to tag leads for Personize.
   *  Find it in HubSpot → Settings → Properties → search "Personize" → Internal name. */
  leadFilterProperty: process.env.HUBSPOT_PERSONIZE_LEAD_PROPERTY || 'personize___lead',

  /** Value that marks a contact/company as a Personize lead. */
  leadFilterValue: 'true',

  /** Properties to fetch for contacts during sync. */
  contactProperties: [
    'firstname', 'lastname', 'email', 'jobtitle', 'phone',
    'company', 'website', 'hs_lead_status', 'lifecyclestage',
  ],

  /** Properties to fetch for companies during sync. */
  companyProperties: [
    'name', 'domain', 'industry', 'numberofemployees',
    'annualrevenue', 'city', 'state', 'country',
  ],

  /** Sync engagement history (notes, emails, meetings, calls, tasks) for each contact.
   *  This gives the AI context about past conversations and existing relationships. */
  syncEngagements: true,

  /** Which engagement types to sync. Each type = 1 HubSpot API call per contact. */
  engagementTypes: ['notes', 'emails', 'meetings', 'calls', 'tasks'] as string[],

  /** Also sync associated deals for each contact. */
  syncDeals: true,

  /** Max engagements to fetch per type, per contact (most recent first). */
  maxEngagementsPerType: 10,

  /** Only sync engagements from the last N days (0 = all time). */
  engagementRecencyDays: 90,
};

// ─── CSV Import ────────────────────────────────────────────────────
export const CSV_CONFIG = {
  /** Whether CSV import is enabled. */
  enabled: true,

  /** Directory containing CSV files, relative to project root. */
  dataDir: process.env.CSV_DATA_DIR || 'data',

  /** Expected file names. Set to empty string to skip that type. */
  contactsFile: 'contacts.csv',
  companiesFile: 'companies.csv',
  notesFile: 'notes.csv',
  dealsFile: 'deals.csv',

  /** Source tag value used in memorized records (distinguishes from HubSpot). */
  sourceTag: 'csv',
};

// ─── CRM Source Selection ──────────────────────────────────────────
export const CRM_SOURCE_CONFIG = {
  /** Which data sources to sync: 'hubspot', 'csv', or 'both'. */
  source: (process.env.CRM_SOURCE || 'hubspot') as 'hubspot' | 'csv' | 'both',
};

// ─── Email Delivery Provider ──────────────────────────────────────
//
// Controls which channel actually sends outreach emails.
//
//   smartlead    — Managed warmed mailboxes via Smartlead API (recommended for new setups)
//   sendgrid     — Your own SendGrid account and sender domain
//   gmail        — Google Workspace via Gmail API (multi-sender, round-robin)
//   manual-hubspot — No sending; creates a HubSpot task for a human to review and send
//
// Set via EMAIL_PROVIDER env var.

export type EmailProvider = 'smartlead' | 'sendgrid' | 'gmail' | 'manual-hubspot';

export const EMAIL_DELIVERY_CONFIG = {
  provider: (process.env.EMAIL_PROVIDER || 'smartlead') as EmailProvider,
};

// ─── Smartlead ────────────────────────────────────────────────────
export const SMARTLEAD_CONFIG = {
  /** API key from Smartlead dashboard → Settings → API Keys. */
  apiKey: process.env.SMARTLEAD_API_KEY || '',

  /** Base URL for Smartlead REST API. */
  baseUrl: 'https://server.smartlead.ai/api/v1',

  /** Smartlead campaign ID to send emails through.
   *  Create a single "AI Prospecting Agent" campaign in Smartlead,
   *  set it to active, and paste the numeric ID here.
   *  Smartlead uses this campaign's warmed mailboxes for all sends. */
  campaignId: process.env.SMARTLEAD_CAMPAIGN_ID || '',
};

// ─── Manual HubSpot ───────────────────────────────────────────────
export const MANUAL_HUBSPOT_CONFIG = {
  /** HubSpot owner ID to assign review tasks to.
   *  Find it in HubSpot → Settings → Users & Teams → click a user → copy numeric ID from URL. */
  ownerId: process.env.HUBSPOT_OWNER_ID || '',
};

// ─── Gmail Senders ────────────────────────────────────────────────
/** Multiple Google Workspace senders for email delivery.
 *  Each sender needs their own OAuth2 refresh token (run `npm run gmail:auth` per sender).
 *  All senders can share the same GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.
 *
 *  Set via GMAIL_SENDERS env var as JSON array, or falls back to single-sender env vars.
 *  Daily limit per sender: keep under 100/day for best deliverability (Google allows 2,000). */
export interface GmailSender {
  email: string;
  name: string;
  refreshToken: string;
  dailyLimit: number;
}

function loadGmailSenders(): GmailSender[] {
  // Option 1: Multi-sender JSON array
  if (process.env.GMAIL_SENDERS) {
    try {
      const parsed = JSON.parse(process.env.GMAIL_SENDERS);
      return (parsed as Array<Partial<GmailSender>>).map((s) => ({
        email: s.email || '',
        name: s.name || 'Sales Team',
        refreshToken: s.refreshToken || '',
        dailyLimit: s.dailyLimit || 100,
      }));
    } catch {
      throw new Error('GMAIL_SENDERS is not valid JSON. Expected: [{"email":"...","name":"...","refreshToken":"..."}]');
    }
  }

  // Option 2: Single-sender env vars (backward compatible)
  if (process.env.GMAIL_REFRESH_TOKEN && process.env.SENDER_EMAIL) {
    return [{
      email: process.env.SENDER_EMAIL,
      name: process.env.SENDER_NAME || 'Sales Team',
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      dailyLimit: 100,
    }];
  }

  return [];
}

export const GMAIL_CONFIG = {
  /** OAuth2 Client ID (shared across all senders — one Google Cloud project). */
  clientId: process.env.GMAIL_CLIENT_ID || '',

  /** OAuth2 Client Secret (shared across all senders). */
  clientSecret: process.env.GMAIL_CLIENT_SECRET || '',

  /** All configured sender accounts. */
  senders: loadGmailSenders(),

  /** Selection strategy: 'round-robin' rotates evenly, 'random' picks randomly. */
  strategy: (process.env.GMAIL_SENDER_STRATEGY || 'round-robin') as 'round-robin' | 'random',
};

// ─── Apollo.io Settings ────────────────────────────────────────────
export const APOLLO_CONFIG = {
  /** Base URL for Apollo REST API. */
  baseUrl: 'https://api.apollo.io',

  /** Monthly credit budget. Apollo deducts 1 credit per enrichment.
   *  Set this to prevent accidental overspend. */
  monthlyCreditsbudget: 10_000,

  /** Max contacts to enrich per single pipeline run (safety cap). */
  maxEnrichmentsPerRun: 100,

  /** Max companies to enrich per single pipeline run. */
  maxCompanyEnrichmentsPerRun: 50,

  /** Pause between individual Apollo API calls (ms) to stay within rate limits. */
  rateLimitPauseMs: 1_000,
};

// ─── Contact Discovery ────────────────────────────────────────────
export const DISCOVERY_CONFIG = {
  /** How many contacts to find per hot account. */
  contactsPerAccount: 5,

  /** Job titles to search for at target accounts.
   *  Apollo matches these as substrings, so "VP Sales" matches "VP of Sales". */
  targetTitles: [
    'VP Sales',
    'VP Marketing',
    'Head of Growth',
    'Chief Revenue Officer',
    'Director of Sales',
    'Director of Marketing',
    'Head of Sales',
    'Head of Business Development',
  ],

  /** Seniority levels to target (Apollo seniority values). */
  targetSeniorities: [
    'vp',
    'director',
    'c_suite',
    'manager',
  ],

  /** Departments to target (Apollo department values). */
  targetDepartments: [
    'sales',
    'marketing',
    'business_development',
    'c_suite',
  ],

  /** Minimum employee count for target companies (0 = no minimum). */
  minEmployees: 0,

  /** Maximum employee count (0 = no maximum). */
  maxEmployees: 0,

  /** Only discover contacts with verified emails. */
  requireVerifiedEmail: true,
};

// ─── Signal Scanning ───────────────────────────────────────────────
export const SIGNAL_CONFIG = {
  /** Master toggle — set to false to disable the entire daily scoring job.
   *  Useful for CSV-only or manual prospecting workflows. */
  enableSignalDetection: preset.enableSignalDetection,

  /** Minimum ICP score to consider an account "hot" (0-100). */
  hotAccountThreshold: 70,

  /** How many companies to scan per signal detection run (0 = all). */
  companiesPerScan: 200,

  /** Whether to auto-research hot accounts via Tavily after signal detection.
   *  Derived from budget tier — off for conservative, on for balanced/aggressive. */
  autoResearchHotAccounts: preset.enableTavilyResearch,

  /** Whether to auto-discover contacts at hot accounts after signal detection.
   *  Derived from budget tier — off for conservative, on for balanced/aggressive. */
  autoDiscoverContacts: preset.enableApolloDiscovery,

  /** Whether to auto-enrich new contacts after CRM sync. */
  autoEnrichAfterSync: true,

  /** Whether to auto-enrich companies after CRM sync. */
  autoEnrichCompaniesAfterSync: true,

  /** Smart re-scoring: skip companies scored within the tier threshold.
   *  conservative = 90 days (quarterly), balanced = 30 days (monthly), aggressive = 7 days (weekly).
   *  New accounts are always scored immediately. Activity triggers (replies, new contacts) bypass this. */
  rescoring: {
    /** Skip re-scoring companies assessed within this many days.
     *  Derived from budget tier: conservative=90, balanced=30, aggressive=7. */
    rescoringDays: preset.rescoringDays,

    /** Account statuses that should NEVER be re-scored (permanently excluded). */
    skipStatuses: ['customer', 'blocked', 'do_not_contact', 'opted_out'] as string[],
  },
};

// ─── Tavily Web Research ─────────────────────────────────────────
export const TAVILY_CONFIG = {
  /** Max results per individual Tavily search query. */
  maxResultsPerSearch: 5,

  /** Search depth: 'basic' (faster, cheaper) or 'advanced' (deeper). */
  searchDepth: 'basic' as const,

  /** How many separate queries to run per company. */
  maxSearchesPerCompany: 2,

  /** Only return results from the last N days (recency filter). */
  recencyDays: 30,

  /** Max companies to research in a single batch run.
   *  Derived from budget tier: conservative=5, balanced=10, aggressive=25. */
  maxResearchPerRun: preset.maxResearchPerRun,

  /** Skip companies that were researched within the last N days (0 = always research).
   *  Derived from budget tier: conservative=90, balanced=30, aggressive=7. */
  skipIfResearchedWithinDays: preset.tavilyRefreshDays,

  /** Pause between Tavily API calls (ms). */
  rateLimitPauseMs: 500,
};

// ─── Task Executor ────────────────────────────────────────────────
export const TASK_EXECUTOR_CONFIG = {
  /** Max tasks to process per scheduled run. */
  maxTasksPerRun: 20,

  /** Agent owners that the executor will pick up (skip human-owned tasks). */
  actionableOwners: ['outreach-agent', 'enrichment-agent', 'signal-agent', 'reply-analyzer'],

  /** Whether to use AI interpretation for tasks with unknown agent owners. */
  enableGenericTaskHandler: true,

  /** Concurrency limit for parallel task execution. */
  concurrencyLimit: 3,

  /** Skip tasks older than N days (stale task cleanup). */
  maxTaskAgeDays: 30,
};

// ─── Outreach Cadences ───────────────────────────────────────────────
/** Named cadences define the pace and length of outreach sequences.
 *  Each cadence specifies how many emails to send and how long to wait between them.
 *  Cadences are auto-selected based on ICP score, or can be assigned manually. */
export interface CadenceDefinition {
  maxEmails: number;
  waitDays: number[];    // waitDays[0] = days after email 1, waitDays[1] = days after email 2, etc.
  label: string;         // Human-readable description
}

export const CADENCES: Record<string, CadenceDefinition> = {
  aggressive: {
    maxEmails: 3,
    waitDays: [2, 3],
    label: 'Hot leads (score 80+)',
  },
  standard: {
    maxEmails: 3,
    waitDays: [3, 5],
    label: 'Default cadence',
  },
  enterprise: {
    maxEmails: 4,
    waitDays: [5, 7, 10],
    label: 'Large accounts — longer runway',
  },
};

export const CADENCE_RULES = {
  /** Auto-select cadence based on ICP score thresholds (checked top to bottom). */
  scoreThresholds: [
    { minScore: 80, cadence: 'aggressive' as const },
    { minScore: 50, cadence: 'standard' as const },
    { minScore: 0,  cadence: 'enterprise' as const },
  ],
  defaultCadence: 'standard' as const,
};

/** Resolve which cadence to use for a given ICP score. */
export function getCadence(icpScore?: number): CadenceDefinition {
  if (icpScore != null) {
    for (const rule of CADENCE_RULES.scoreThresholds) {
      if (icpScore >= rule.minScore) {
        return CADENCES[rule.cadence];
      }
    }
  }
  return CADENCES[CADENCE_RULES.defaultCadence];
}

/** Get the cadence name for a given ICP score. */
export function getCadenceName(icpScore?: number): string {
  if (icpScore != null) {
    for (const rule of CADENCE_RULES.scoreThresholds) {
      if (icpScore >= rule.minScore) {
        return rule.cadence;
      }
    }
  }
  return CADENCE_RULES.defaultCadence;
}

// ─── Account Strategy ─────────────────────────────────────────────
export const ACCOUNT_STRATEGY_CONFIG = {
  /** Run account strategy evaluation after signal detection.
   *  Derived from budget tier — off for conservative, on for balanced/aggressive. */
  enableAccountStrategy: preset.enableAccountStrategy,

  /** Max accounts to evaluate per strategy run.
   *  Derived from budget tier: conservative=5, balanced=10, aggressive=25. */
  maxAccountsPerRun: preset.maxStrategyPerRun,

  /** Max contacts emailed at a single account per week (carpet bomb prevention). */
  maxContactsPerWeek: 2,

  /** Window in days for carpet bomb detection (contacts emailed within this window count). */
  carpetBombWindowDays: 7,

  /** Company size threshold — below this, enforce stricter staggering. */
  smallCompanyThreshold: 100,

  /** Days to pause outreach after a negative company event (layoffs, crisis). */
  negativeEventPauseDays: 21,

  /** Re-evaluate account strategy if the existing one is older than this many days.
   *  Derived from budget tier: conservative=90, balanced=30, aggressive=7. */
  strategyStalenessDays: preset.strategyStalenessDays,

  /** Account stages where new contacts should get warm intros instead of cold outreach. */
  warmIntroStages: ['engaged', 'opportunity', 'multi_threaded'] as string[],
};

// ─── Enrichment ────────────────────────────────────────────────────
export const ENRICHMENT_CONFIG = {
  /** Skip contacts that were already enriched (checks for 'apollo' tag in memory). */
  skipAlreadyEnriched: true,

  /** Also run company enrichment when enriching contacts. */
  enrichCompanies: true,

  /** Properties to extract during person enrichment for Personize memory. */
  personMemoryTags: ['enrichment', 'apollo'],

  /** Properties to extract during company enrichment for Personize memory. */
  companyMemoryTags: ['enrichment', 'company', 'apollo'],
};
