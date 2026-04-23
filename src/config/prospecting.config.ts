/**
 * Prospecting Agent Configuration
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  START HERE — the only 3 settings most users need to touch      │
 * │                                                                  │
 * │  AGENT_MODE=outbound-sdr    # What kind of outreach?            │
 * │  BUDGET_TIER=balanced       # How aggressive / expensive?       │
 * │  CRM_SOURCE=hubspot         # Where does your data come from?   │
 * │                                                                  │
 * │  Set these in .env, run the onboarding skill to fill in your    │
 * │  ICP and brand voice, then deploy. Everything else has sensible │
 * │  defaults and can be changed when you actually need to.         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Everything below is organized from most-commonly-changed to least.
 * Sections marked [OPTIONAL] are off by default or rarely need touching.
 */

import { getAgentMode } from './agent-modes.js';

// ─── Agent Mode ──────────────────────────────────────────────────
//
// Modes pre-configure governance, cadences, signals, and terminology
// for different use cases. The pipeline architecture stays the same —
// what changes is WHO you contact, WHY, and HOW you talk to them.
//
// Set via AGENT_MODE env var. Default: 'outbound-sdr'.
//
// Sales & GTM:        outbound-sdr, abm, cold-deals, partner-recruitment, event-followup
// Ecommerce & D2C:    ecommerce-winback, post-purchase, cart-abandonment
// Membership:         member-renewal, member-onboarding
// Recruiting & HR:    talent-sourcing, employee-onboarding
// Education:          student-enrollment, alumni-engagement
// Real Estate:        real-estate-nurture
// Agency:             agency-outreach
// Nonprofit:          donor-engagement, volunteer-recruitment
//
// Each mode provides SUGGESTED governance, cadences, and discovery targets.
// The onboarding skill uses these as a starting point and customizes further.

export const AGENT_MODE = getAgentMode();
export { AGENT_MODES, MODE_CATEGORIES, getAvailableModes, getModesByCategory, getModeById } from './agent-modes.js';
export type { AgentModeDefinition, ModeCategory } from './agent-modes.js';

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

  /** Ecommerce CSV files. Set to empty string to skip. */
  purchasesFile: 'purchases.csv',
  productsFile: 'products.csv',

  /** Source tag value used in memorized records (distinguishes from HubSpot). */
  sourceTag: 'csv',
};

// ─── CRM Source Selection ──────────────────────────────────────────
export const CRM_SOURCE_CONFIG = {
  /** Which data sources to sync: 'hubspot', 'salesforce', 'csv', 'clay', or 'all'. */
  source: (process.env.CRM_SOURCE || 'hubspot') as 'hubspot' | 'salesforce' | 'csv' | 'clay' | 'all',
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
   *  Create a single "Revenue OS" campaign in Smartlead,
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

// ─── Email Sender Accounts ───────────────────────────────────────
//
// Define ALL sender accounts here — any provider (Gmail, Outlook, Zoho,
// Fastmail, ZapMail, Instantly, or any IMAP/SMTP host).
//
// Each sender needs:
//   - An email + display name
//   - A provider preset OR custom IMAP/SMTP hosts
//   - Credentials: app password (most providers) or OAuth2 refresh token (Gmail)
//   - Persona: how this sender is matched to leads (executive, technical, general, consultative)
//
// Passwords come from env vars — never hardcode credentials.
// Run `npm run setup:senders` to provision accounts + sender profiles in Personize.
// Re-run after adding/removing entries — it syncs (creates new, removes missing).
//
// For Gmail OAuth2: run `npm run gmail:auth` per sender to get refresh tokens.
// For all others: generate App Passwords in each provider's security settings.

export type EmailProviderPreset = 'gmail' | 'outlook' | 'yahoo' | 'zoho' | 'fastmail' | 'custom';

export interface SenderAccountConfig {
  /** Unique key for this sender (used for env var lookup and idempotent sync).
   *  e.g., 'alice', 'bob', 'sales1'. Maps to env var: SENDER_ALICE_PASSWORD */
  key: string;
  /** Email address for this sender. */
  email: string;
  /** Display name on outbound emails (e.g., "Alice Smith"). */
  displayName: string;
  /** Provider preset — auto-fills IMAP/SMTP hosts and ports.
   *  Use 'custom' and set imapHost/smtpHost for unlisted providers. */
  provider: EmailProviderPreset;
  /** Auth method. Default: 'password' (app passwords). Use 'oauth2' for Gmail OAuth2. */
  auth?: 'password' | 'oauth2';
  /** Persona for lead matching: C-suite → executive, engineers → technical, etc. */
  persona?: 'technical' | 'executive' | 'general' | 'consultative';
  /** Daily send limit (default: 100). Keep under 100/day for best deliverability. */
  dailySendLimit?: number;
  /** Max leads assigned to this sender (default: 50). */
  maxLeadsAssigned?: number;
  /** Enable warmup ramp on first setup (default: true). */
  warmup?: boolean;
  /** Custom warmup ramp schedule (default: [5, 10, 15, 25, 35, 50, 75, 100]). */
  warmupRamp?: number[];
  /** Whether IMAP polling is enabled for reply monitoring (default: true). */
  pollingEnabled?: boolean;
  /** IMAP folders to monitor (default: ['INBOX']). */
  folders?: string[];
  /** Poll interval in minutes (default: 3). */
  pollIntervalMinutes?: number;
  /** Custom IMAP host (only needed for provider: 'custom'). */
  imapHost?: string;
  /** Custom IMAP port (default: 993). */
  imapPort?: number;
  /** Custom SMTP host (only needed for provider: 'custom'). */
  smtpHost?: string;
  /** Custom SMTP port (default: 587). */
  smtpPort?: number;
  /** Whether SMTP uses implicit TLS (true for port 465, false for 587 STARTTLS). Default: false. */
  smtpSecure?: boolean;
  /** Email signature (HTML). */
  signature?: string;
}

/** Provider presets — IMAP and SMTP hosts for common providers. */
export const EMAIL_PROVIDER_PRESETS: Record<EmailProviderPreset, {
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
}> = {
  gmail:    { imapHost: 'imap.gmail.com',         imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com',           smtpPort: 587, smtpSecure: false },
  outlook:  { imapHost: 'outlook.office365.com',   imapPort: 993, imapSecure: true, smtpHost: 'smtp-mail.outlook.com',    smtpPort: 587, smtpSecure: false },
  yahoo:    { imapHost: 'imap.mail.yahoo.com',     imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.yahoo.com',      smtpPort: 587, smtpSecure: false },
  zoho:     { imapHost: 'imap.zoho.com',           imapPort: 993, imapSecure: true, smtpHost: 'smtp.zoho.com',            smtpPort: 587, smtpSecure: false },
  fastmail: { imapHost: 'imap.fastmail.com',       imapPort: 993, imapSecure: true, smtpHost: 'smtp.fastmail.com',        smtpPort: 587, smtpSecure: false },
  custom:   { imapHost: '',                        imapPort: 993, imapSecure: true, smtpHost: '',                          smtpPort: 587, smtpSecure: false },
};

/**
 * Load sender accounts from EMAIL_SENDERS env var (JSON array) or inline config.
 *
 * Credentials are loaded from env vars named: SENDER_{KEY}_PASSWORD or SENDER_{KEY}_REFRESH_TOKEN
 * where {KEY} is the sender's key in UPPER_CASE (e.g., key: 'alice' → SENDER_ALICE_PASSWORD).
 */
function loadSenderAccounts(): SenderAccountConfig[] {
  if (process.env.EMAIL_SENDERS) {
    try {
      return JSON.parse(process.env.EMAIL_SENDERS) as SenderAccountConfig[];
    } catch {
      throw new Error('EMAIL_SENDERS is not valid JSON. Expected: [{"key":"alice","email":"alice@co.com","displayName":"Alice","provider":"gmail"}]');
    }
  }

  // Backward compatible: single Gmail sender via legacy env vars
  if (process.env.SENDER_EMAIL && (process.env.GMAIL_REFRESH_TOKEN || process.env.SENDER_DEFAULT_PASSWORD)) {
    return [{
      key: 'default',
      email: process.env.SENDER_EMAIL,
      displayName: process.env.SENDER_NAME || 'Sales Team',
      provider: process.env.GMAIL_REFRESH_TOKEN ? 'gmail' : 'custom' as EmailProviderPreset,
      auth: process.env.GMAIL_REFRESH_TOKEN ? 'oauth2' : 'password',
    }];
  }

  return [];
}

export const EMAIL_SENDERS_CONFIG = {
  /** All configured sender accounts (loaded from EMAIL_SENDERS env var or inline). */
  senders: loadSenderAccounts(),

  /** Default warmup ramp for new senders (overridable per sender). */
  defaultWarmupRamp: [5, 10, 15, 25, 35, 50, 75, 100],

  /** Default daily send limit per sender. */
  defaultDailySendLimit: 100,

  /** Default max leads per sender. */
  defaultMaxLeadsAssigned: 50,
};

// ─── Gmail OAuth2 (shared credentials for Gmail senders) ─────────
//
// If any sender uses provider: 'gmail' with auth: 'oauth2', these
// shared OAuth2 credentials are used. One Google Cloud project for all.

export const GMAIL_OAUTH_CONFIG = {
  clientId: process.env.GMAIL_CLIENT_ID || '',
  clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
};

// ─── Legacy Gmail Config (backward compatible) ──────────────────
// Kept for existing gmail.ts delivery provider. New setups should
// use EMAIL_SENDERS_CONFIG + provider: 'gmail' instead.

export interface GmailSender {
  email: string;
  name: string;
  refreshToken: string;
  dailyLimit: number;
}

function loadGmailSenders(): GmailSender[] {
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
      throw new Error('GMAIL_SENDERS is not valid JSON.');
    }
  }
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
  clientId: process.env.GMAIL_CLIENT_ID || '',
  clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  senders: loadGmailSenders(),
  strategy: (process.env.GMAIL_SENDER_STRATEGY || 'round-robin') as 'round-robin' | 'random',
};

// ─── IMAP Reply Monitoring ────────────────────────────────────────
//
// Default poll settings for IMAP accounts. Individual sender accounts
// can override these via their own pollIntervalMinutes and folders.
//
// Credentials: Encrypted with AES-256-GCM using IMAP_ENCRYPTION_KEY or
// PERSONIZE_SECRET_KEY. For Gmail: use App Passwords (not regular password).
// For Outlook: use App Passwords or OAuth2.

export const IMAP_CONFIG = {
  /** Default poll interval in minutes for new accounts. */
  defaultPollIntervalMinutes: Number(process.env.IMAP_POLL_INTERVAL_MINUTES) || 3,

  /** Maximum messages to fetch per folder per poll (prevents overwhelming). */
  maxMessagesPerPoll: Number(process.env.IMAP_MAX_MESSAGES_PER_POLL) || 100,

  /** Default folders to monitor for new accounts. */
  defaultFolders: ['INBOX'],

  /** How many days back to search on first poll (no lastCheckedAt). */
  initialLookbackDays: Number(process.env.IMAP_INITIAL_LOOKBACK_DAYS) || 1,

  /** Provider presets (IMAP only — for backward compat with dashboard). */
  presets: Object.fromEntries(
    Object.entries(EMAIL_PROVIDER_PRESETS).map(([k, v]) => [k, { host: v.imapHost, port: v.imapPort, secure: v.imapSecure }]),
  ) as Record<string, { host: string; port: number; secure: boolean }>,
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

  /** Max retries for Tavily 429s before failing the search. */
  maxRetries: Number(process.env.TAVILY_MAX_RETRIES) || 3,
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

// ─── Sales Org (Multi-Role) ──────────────────────────────────────────
//
// When enabled, the system operates as a coordinated sales team:
//   - SDR: cold outreach, qualification (New → Contacted)
//   - AE: warm follow-up, deal management (Engaged → Opportunity)
//   - CSM: post-sale retention, renewal, expansion (Customer)
//
// When disabled (default), the system runs as a single agent.

import type { SalesRoleId } from './sales-roles.js';

export const SALES_ORG_CONFIG = {
  /** Master toggle. When false, the system behaves as a single agent (backward compatible). */
  enabled: process.env.SALES_ORG_ENABLED === 'true',

  /** Which roles are active. Only active roles get schedulers and pick up tasks. */
  activeRoles: (process.env.ACTIVE_ROLES || 'sdr,ae,csm').split(',').filter(Boolean) as SalesRoleId[],

  /** Default role for new contacts when auto-assignment can't determine from lead_status. */
  defaultRole: (process.env.DEFAULT_ROLE || 'sdr') as SalesRoleId,

  /** Automatically assign role_owner to new contacts based on lead_status. */
  autoAssignNewContacts: true,

  /** Send Slack notification on role handoffs. */
  handoffNotifySlack: true,
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

// ─── LinkedIn Outreach [OPTIONAL — off by default] ───────────────
//
// LinkedIn adds a second channel alongside email. Connection requests go out
// AFTER Email 1 (per playbook rules). Messages use the contact's linkedin_url
// from Apollo enrichment.
//
// Set LINKEDIN_ENABLED=true to activate. The agent creates HubSpot tasks
// for manual LinkedIn actions unless HeyReach is configured.
//
// HeyReach handles all LinkedIn automation (connection requests, messages,
// InMails, follows, profile views) via their API. We add leads to a campaign
// and receive webhook events for the memory loop.
//
// HeyReach API: https://api.heyreach.io/api/public
// Auth: X-API-KEY header, 300 req/min
// Docs: https://documenter.getpostman.com/view/23808049/2sA2xb5F75

export const LINKEDIN_CONFIG = {
  /** Master toggle — enables LinkedIn as an outreach channel. */
  enabled: process.env.LINKEDIN_ENABLED === 'true',

  /** How LinkedIn actions are executed.
   *  'manual-hubspot'  — Creates a HubSpot task for a human to send (default, safest)
   *  'heyreach'        — Adds lead to a HeyReach campaign for automated LinkedIn outreach */
  provider: (process.env.LINKEDIN_PROVIDER || 'manual-hubspot') as 'manual-hubspot' | 'heyreach',

  /** Max connection requests per day (LinkedIn limits: ~100/week for Sales Nav, ~20/week free). */
  dailyConnectionLimit: Number(process.env.LINKEDIN_DAILY_LIMIT) || 20,

  /** Max characters for a connection request note (LinkedIn limit: 300). */
  connectionNoteMaxChars: 300,

  /** HeyReach API key.
   *  Get it from: HeyReach → Settings → API → copy your API key.
   *  Test it: GET https://api.heyreach.io/api/public/auth/CheckApiKey with X-API-KEY header. */
  heyreachApiKey: process.env.HEYREACH_API_KEY || '',

  /** HeyReach campaign ID to add leads to.
   *  Create a LinkedIn outreach campaign in HeyReach, launch it at least once,
   *  then paste the numeric campaign ID here.
   *  Find it: HeyReach → Campaigns → click campaign → copy ID from URL. */
  heyreachCampaignId: process.env.HEYREACH_CAMPAIGN_ID || '',
};

// ─── Phone / Call Outreach [OPTIONAL — off by default] ──────────────
//
// Call scripts are generated for contacts that score 80+ AND have a phone number.
// Two output modes: a playbook for human SDRs, and a verbatim script for AI callers.
//
// The agent always creates a HubSpot CALL task. If an AI caller is configured,
// it also triggers the call via API.

export const CALL_CONFIG = {
  /** Master toggle — enables phone call as an outreach channel. */
  enabled: process.env.CALL_ENABLED === 'true',

  /** Minimum ICP score to trigger a call task (high-intent only). */
  minScoreForCall: Number(process.env.CALL_MIN_SCORE) || 80,

  /** How calls are executed.
   *  'manual-hubspot'  — Creates a HubSpot CALL task for a human rep (default)
   *  'bland-ai'        — Triggers call via Bland.ai (POST /v1/calls, auth: authorization header)
   *  'vapi'            — Triggers call via Vapi (POST /calls, auth: Bearer token)
   *  'elevenlabs'      — Triggers call via ElevenLabs Conversational AI + Twilio (POST /v1/convai/twilio/outbound-call) */
  provider: (process.env.CALL_PROVIDER || 'manual-hubspot') as 'manual-hubspot' | 'bland-ai' | 'vapi' | 'elevenlabs',

  /** Max calls per day (protect rep capacity). */
  dailyCallLimit: Number(process.env.CALL_DAILY_LIMIT) || 20,

  /** Bland.ai API key (header: authorization). */
  blandApiKey: process.env.BLAND_API_KEY || '',

  /** Bland.ai outbound phone number (from field). */
  blandPhoneNumberId: process.env.BLAND_PHONE_NUMBER_ID || '',

  /** Vapi API key (header: Authorization: Bearer). */
  vapiApiKey: process.env.VAPI_API_KEY || '',

  /** Vapi assistant ID. */
  vapiAssistantId: process.env.VAPI_ASSISTANT_ID || '',

  /** ElevenLabs API key (header: xi-api-key). */
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',

  /** ElevenLabs Conversational AI agent ID. */
  elevenlabsAgentId: process.env.ELEVENLABS_AGENT_ID || '',

  /** ElevenLabs phone number ID (registered with Twilio via ElevenLabs dashboard). */
  elevenlabsPhoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID || '',

  /** Webhook URL for receiving call completion events from AI voice providers.
   *  Set this to your Trigger.dev webhook URL for the call-result-webhook task.
   *  Bland.ai: passed as `webhook` in POST /v1/calls.
   *  Vapi: configured as Server URL in Vapi dashboard or per-assistant.
   *  ElevenLabs: configured in ElevenLabs General Settings → Webhooks. */
  webhookUrl: process.env.CALL_WEBHOOK_URL || '',

  /** ElevenLabs webhook secret for signature verification.
   *  Set in ElevenLabs General Settings → Webhooks when creating the webhook. */
  elevenlabsWebhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET || '',
};

// ─── AI Phone Interview [OPTIONAL — off by default] ───────────────
//
// AI-conducted phone interviews for deeper qualification, win/loss analysis,
// customer health checks, and feature validation. Unlike cold calls (short,
// scripted, pitch-oriented), interviews are longer, discovery-oriented
// conversations that extract structured insights.
//
// Uses the same voice providers as CALL_CONFIG (Bland.ai, Vapi, ElevenLabs)
// but with conversation-mode prompts, longer durations, and structured
// post-interview analysis.
//
// Trigger points:
//   - After a positive cold call (analyze-call outcome = interested)
//   - Post-demo / post-meeting (manual or CRM event trigger)
//   - Win/loss after deal closes (CRM stage change)
//   - Scheduled customer health check (recurring)
//   - NPS score received (webhook from survey tool)

export const INTERVIEW_CONFIG = {
  /** Master toggle — enables AI phone interviews. */
  enabled: process.env.INTERVIEW_ENABLED === 'true',

  /** Voice provider for interviews. Reuses CALL_CONFIG provider credentials.
   *  'vapi' is recommended — best at long-form, dynamic conversations.
   *  'bland-ai' and 'elevenlabs' also supported. */
  provider: (process.env.INTERVIEW_PROVIDER || CALL_CONFIG.provider) as 'bland-ai' | 'vapi' | 'elevenlabs',

  /** Max interview duration in minutes. AI will wrap up as this limit approaches. */
  maxDurationMins: Number(process.env.INTERVIEW_MAX_DURATION_MINS) || 20,

  /** Max interviews per day (these are longer/more expensive than cold calls). */
  dailyLimit: Number(process.env.INTERVIEW_DAILY_LIMIT) || 10,

  /** Minimum ICP score to auto-trigger a discovery interview.
   *  Manual interviews (via trigger task) bypass this gate. */
  minScoreForAutoInterview: Number(process.env.INTERVIEW_MIN_SCORE) || 70,

  /** Require explicit recording consent at the start of the interview.
   *  The AI interviewer will ask for consent before proceeding.
   *  If the contact declines, the interview ends gracefully. */
  requireRecordingConsent: process.env.INTERVIEW_REQUIRE_CONSENT !== 'false',

  /** Vapi assistant ID specifically for interviews (optional — overrides CALL_CONFIG).
   *  Use a separate assistant with longer timeout and conversational system prompt. */
  vapiInterviewAssistantId: process.env.VAPI_INTERVIEW_ASSISTANT_ID || '',

  /** ElevenLabs agent ID specifically for interviews (optional — overrides CALL_CONFIG). */
  elevenlabsInterviewAgentId: process.env.ELEVENLABS_INTERVIEW_AGENT_ID || '',

  /** Webhook URL for interview completion events (defaults to CALL_WEBHOOK_URL). */
  webhookUrl: process.env.INTERVIEW_WEBHOOK_URL || CALL_CONFIG.webhookUrl,

  /** Default interview purposes to auto-trigger.
   *  'discovery' — after positive cold call
   *  'win_loss'  — after deal closed-won or closed-lost
   *  'customer_health' — recurring for existing customers */
  autoTriggerPurposes: (process.env.INTERVIEW_AUTO_PURPOSES || 'discovery')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Array<'discovery' | 'win_loss' | 'customer_health' | 'feature_validation' | 'nps_followup'>,
};

// ─── Salesforce [OPTIONAL — only if CRM_SOURCE includes 'salesforce'] ──
//
// Salesforce CRM sync. Uses jsforce for REST API access.
// Supports contacts, accounts (companies), tasks, and opportunities (deals).
//
// Set CRM_SOURCE=salesforce or CRM_SOURCE=both to enable.

export const SALESFORCE_CONFIG = {
  /** Salesforce login URL (use https://test.salesforce.com for sandboxes). */
  loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',

  /** Salesforce username. */
  username: process.env.SF_USERNAME || '',

  /** Salesforce password. */
  password: process.env.SF_PASSWORD || '',

  /** Salesforce security token (appended to password). */
  securityToken: process.env.SF_TOKEN || '',

  /** SOQL WHERE clause to filter contacts (e.g., "Lead_Source__c = 'Personize'").
   *  Leave empty to sync all contacts. */
  contactFilter: process.env.SF_CONTACT_FILTER || '',

  /** SOQL WHERE clause to filter accounts. */
  accountFilter: process.env.SF_ACCOUNT_FILTER || '',

  /** Contact fields to fetch during sync. */
  contactFields: [
    'Id', 'FirstName', 'LastName', 'Email', 'Title', 'Phone',
    'Account.Name', 'Account.Website', 'LeadSource', 'Status__c',
  ],

  /** Account fields to fetch during sync. */
  accountFields: [
    'Id', 'Name', 'Website', 'Industry', 'NumberOfEmployees',
    'AnnualRevenue', 'BillingCity', 'BillingState', 'BillingCountry',
  ],

  /** Sync opportunities (deals) for each contact. */
  syncOpportunities: true,

  /** Sync activities (tasks, events) for each contact. */
  syncActivities: true,

  /** Max activities per contact. */
  maxActivitiesPerContact: 10,

  /** Only sync activities from the last N days (0 = all). */
  activityRecencyDays: 90,
};

// ─── Clay.com [OPTIONAL — off by default] ────────────────────────
//
// Clay is a data enrichment + workflow platform with 100+ providers.
// Two integration modes:
//
//   webhook (default) — Clay POSTs enriched records to a Trigger.dev webhook.
//                       Set up a Clay table, add enrichments, then add an HTTP POST
//                       action pointing at your Trigger.dev webhook URL.
//                       No polling, no API key needed on your side.
//
//   pull             — Your system pulls from a Clay table via HTTP API.
//                       Requires CLAY_API_KEY. Runs on the crm-sync cron.
//
// Use Clay when you want waterfall enrichment (try Provider A, fall back to B, C),
// AI-powered lead research, or to combine 75+ data sources without writing code.
//
// Set CLAY_ENABLED=true and configure your Clay table to POST to the webhook URL
// shown in your Trigger.dev dashboard under "clay-webhook" task.

export const CLAY_CONFIG = {
  /** Master toggle — enables Clay as a data source. */
  enabled: process.env.CLAY_ENABLED === 'true',

  /** Integration mode.
   *  'webhook' — Clay pushes enriched records to your Trigger.dev webhook (recommended)
   *  'pull'    — Your system pulls from Clay table via API on the crm-sync schedule */
  mode: (process.env.CLAY_MODE || 'webhook') as 'webhook' | 'pull',

  /** Clay API key (only required for 'pull' mode).
   *  Get it from: Clay → Settings → API Keys. */
  apiKey: process.env.CLAY_API_KEY || '',

  /** Clay table URL for pull mode (e.g., "https://api.clay.com/v1/tables/{table_id}/rows").
   *  Find it in Clay → Table → Share → API. */
  tableUrl: process.env.CLAY_TABLE_URL || '',

  /** Webhook secret for verifying inbound Clay webhooks (optional but recommended).
   *  Set the same value in Clay's HTTP POST action headers as X-Webhook-Secret. */
  webhookSecret: process.env.CLAY_WEBHOOK_SECRET || '',

  /** Which Personize collection to store Clay records in. */
  targetCollection: (process.env.CLAY_TARGET_COLLECTION || 'contacts') as 'contacts' | 'companies',

  /** Default tags applied to all Clay-imported records. */
  tags: ['clay', 'enrichment', 'sync'],

  /** Field mapping — maps Clay column names to Personize properties.
   *  Set as JSON: {"clay_column": "personize_property"}
   *  If empty, the pipeline uses sensible defaults (email, first_name, last_name, etc.). */
  fieldMapping: process.env.CLAY_FIELD_MAPPING
    ? JSON.parse(process.env.CLAY_FIELD_MAPPING) as Record<string, string>
    : {} as Record<string, string>,

  /** Max rows to pull per API call (pull mode only). */
  pullBatchSize: Number(process.env.CLAY_PULL_BATCH_SIZE) || 100,

  /** Max rows to pull per sync run (pull mode safety cap). */
  maxRowsPerSync: Number(process.env.CLAY_MAX_ROWS_PER_SYNC) || 1000,
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
