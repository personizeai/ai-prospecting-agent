/**
 * Central pipeline registry — one entry per runnable pipeline.
 * Used by both the CLI dispatcher (src/scripts/pipeline.ts) and MCP (Phase 4).
 */

import { accountPreflight } from './account-preflight.js';
import { evaluateAccountStrategy, evaluateAccountStrategies } from './account-strategy.js';
import { processCallResult } from './analyze-call.js';
import { processInterviewResult } from './analyze-interview.js';
import { processLinkedInEvent } from './analyze-linkedin-event.js';
import { analyzeReply } from './analyze-reply.js';
import { assignRoleToContact, backfillRoles } from './assign-role.js';
import { conductInterview } from './conduct-interview.js';
import { detectAndScoreSignals } from './detect-signals.js';
import { discoverContactsForHotAccounts } from './discover-contacts-apollo.js';
import { enrichContacts } from './enrich-apollo.js';
import { enrichCompanies } from './enrich-companies-apollo.js';
import { executeTask } from './execute-task.js';
import { generateCallScriptForContact } from './generate-call-script.js';
import { generateInterviewGuide } from './generate-interview-guide.js';
import { generateLinkedInMessage } from './generate-linkedin-message.js';
import { generateOutreachForContact } from './generate-outreach.js';
import { inferPreferencesForCustomer, inferPreferencesBatch } from './infer-preferences.js';
import { ingestEnrichment } from './ingest-enrichment.js';
import { collectStrategyMetrics } from './meta-metrics.js';
import { processHandoff } from './process-handoff.js';
import { researchCompany, researchHotAccounts } from './research-company.js';
import { sourceContactsForHotAccounts } from './source-contacts.js';
import { syncClay } from './sync-clay.js';
import { syncCSV } from './sync-csv.js';
import { syncEcommerce } from './sync-ecommerce.js';
import { syncHubSpot } from './sync-hubspot.js';
import { syncSalesforce } from './sync-salesforce.js';
import { generateWeeklyReport } from './weekly-report.js';

export interface PipelineEntry {
  name: string;
  description: string;
  run: (input: any) => Promise<unknown>;
}

export const PIPELINES: Record<string, PipelineEntry> = {
  'account-preflight': {
    name: 'account-preflight',
    description: 'Gate check before generating outreach — returns proceed/modify/delay/block decision',
    run: (input: any) => accountPreflight(input.contactEmail, input.companyDomain),
  },
  'account-strategy': {
    name: 'account-strategy',
    description: 'Evaluate holistic account strategy for a company domain to coordinate multi-contact outreach',
    run: (input: any) => evaluateAccountStrategy(input.domain),
  },
  'account-strategies-batch': {
    name: 'account-strategies-batch',
    description: 'Run account strategy evaluation for a list of accounts ({ accounts: [{ domain, company? }], maxAccounts? })',
    run: (input: any) => evaluateAccountStrategies(input.accounts ?? [], input.maxAccounts ?? 20),
  },
  'analyze-call': {
    name: 'analyze-call',
    description: 'Process a completed AI voice call result, classify outcome, and take CRM actions',
    run: (input: any) => processCallResult(input),
  },
  'analyze-interview': {
    name: 'analyze-interview',
    description: 'Process a completed AI interview call transcript and extract structured qualification data ({ result: CallResult, guide: InterviewGuide })',
    run: (input: any) => processInterviewResult(input.result, input.guide),
  },
  'analyze-linkedin-event': {
    name: 'analyze-linkedin-event',
    description: 'Process a HeyReach LinkedIn webhook event (connection, reply, InMail, etc.)',
    run: (input: any) => processLinkedInEvent(input),
  },
  'analyze-reply': {
    name: 'analyze-reply',
    description: 'Classify an inbound email reply sentiment and take workspace actions',
    run: (input: any) => analyzeReply(input.contactEmail, input.replyBody, input.replySubject),
  },
  'assign-role': {
    name: 'assign-role',
    description: 'Auto-assign a sales role to a contact based on their lead_status',
    run: (input: any) => assignRoleToContact(input.email, input.leadStatus),
  },
  'backfill-roles': {
    name: 'backfill-roles',
    description: 'Backfill role_owner on all contacts that currently lack one (one-time migration)',
    run: (_input: any) => backfillRoles(),
  },
  'conduct-interview': {
    name: 'conduct-interview',
    description: 'Dispatch an AI-conducted phone interview given an interview guide and contact ID',
    run: (input: any) => conductInterview(input.guide, input.contactId),
  },
  'detect-signals': {
    name: 'detect-signals',
    description: 'Detect and score buying signals across all tracked accounts, returning hot accounts',
    run: (_input: any) => detectAndScoreSignals(),
  },
  'discover-contacts': {
    name: 'discover-contacts',
    description: 'Discover contacts via Apollo.io People Search for a set of hot accounts',
    run: (input: any) => discoverContactsForHotAccounts(input.hotAccounts ?? []),
  },
  'enrich-contacts': {
    name: 'enrich-contacts',
    description: 'Enrich un-enriched contacts via Apollo.io People Enrichment API',
    run: (_input: any) => enrichContacts(),
  },
  'enrich-companies': {
    name: 'enrich-companies',
    description: 'Enrich un-enriched companies via Apollo.io Organization Enrichment API',
    run: (_input: any) => enrichCompanies(),
  },
  'execute-task': {
    name: 'execute-task',
    description: 'Execute a workspace task for a contact (routes to outreach, enrichment, or AI generic handler)',
    run: (input: any) => executeTask(input.contactEmail, input.task, input.dryRun ?? true, input.taskId),
  },
  'generate-call-script': {
    name: 'generate-call-script',
    description: 'Generate a personalized cold call script for a contact given their email, ICP score, and sequence step',
    run: (input: any) => generateCallScriptForContact(input.email, input.icpScore, input.step ?? 1, input.dryRun ?? true),
  },
  'generate-interview-guide': {
    name: 'generate-interview-guide',
    description: 'Generate a dynamic interview guide for a contact given their email and interview purpose',
    run: (input: any) => generateInterviewGuide(input.email, input.purpose, input.additionalContext ?? '', input.dryRun ?? true),
  },
  'generate-linkedin-message': {
    name: 'generate-linkedin-message',
    description: 'Generate a personalized LinkedIn connection request or message for a contact',
    run: (input: any) => generateLinkedInMessage(input.email, input.linkedinUrl, input.step ?? 1, input.dryRun ?? true),
  },
  'generate-outreach': {
    name: 'generate-outreach',
    description: 'Generate a personalized outreach email for a contact at the next sequence step',
    run: (input: any) => generateOutreachForContact(input.email, input.dryRun ?? true, input.cadenceOverride, input.roleId, input.campaignId),
  },
  'infer-preferences': {
    name: 'infer-preferences',
    description: 'Infer style and price preferences for a single e-commerce customer from their purchase history',
    run: (input: any) => inferPreferencesForCustomer(input.email),
  },
  'infer-preferences-batch': {
    name: 'infer-preferences-batch',
    description: 'Infer preferences for a list of e-commerce customer emails ({ emails: string[] })',
    run: (input: any) => inferPreferencesBatch(input.emails ?? []),
  },
  'ingest-enrichment': {
    name: 'ingest-enrichment',
    description: 'Ingest a single enrichment data payload into Personize memory for a contact and their company',
    run: (input: any) => ingestEnrichment(input),
  },
  'meta-metrics': {
    name: 'meta-metrics',
    description: 'Collect strategy performance metrics (angle, segment, content performance) for the meta-agent',
    run: (_input: any) => collectStrategyMetrics(),
  },
  'process-handoff': {
    name: 'process-handoff',
    description: 'Process a role handoff for a contact from one sales role to another',
    run: (input: any) => processHandoff(input.contactEmail, input.fromRole, input.toRole, input.reason, input.context),
  },
  'research-company': {
    name: 'research-company',
    description: 'Research a company domain via Tavily web search and memorize findings',
    run: (input: any) => researchCompany(input.domain, input.name ?? input.domain),
  },
  'research-hot-accounts': {
    name: 'research-hot-accounts',
    description: 'Run company research for a list of hot accounts ({ hotAccounts: HotAccount[] })',
    run: (input: any) => researchHotAccounts(input.hotAccounts ?? []),
  },
  'source-contacts': {
    name: 'source-contacts',
    description: 'Source contacts for a list of hot accounts via Apollo or manual sourcing fallback',
    run: (input: any) => sourceContactsForHotAccounts(input.hotAccounts ?? []),
  },
  'sync-clay': {
    name: 'sync-clay',
    description: 'Sync Clay.com enrichment data into Personize memory (reads configured Clay CSV export)',
    run: (_input: any) => syncClay(),
  },
  'sync-csv': {
    name: 'sync-csv',
    description: 'Sync contacts from a CSV file into Personize memory',
    run: (_input: any) => syncCSV(),
  },
  'sync-ecommerce': {
    name: 'sync-ecommerce',
    description: 'Sync e-commerce purchase history and customer aggregates from CSV into Personize memory',
    run: (_input: any) => syncEcommerce(),
  },
  'sync-hubspot': {
    name: 'sync-hubspot',
    description: 'Sync contacts, companies, and engagement history from HubSpot into Personize memory',
    run: (_input: any) => syncHubSpot(),
  },
  'sync-salesforce': {
    name: 'sync-salesforce',
    description: 'Sync contacts, accounts, activities, and opportunities from Salesforce into Personize memory',
    run: (_input: any) => syncSalesforce(),
  },
  'weekly-report': {
    name: 'weekly-report',
    description: 'Generate a weekly pipeline health and outreach performance report',
    run: (_input: any) => generateWeeklyReport(),
  },
};

export const PIPELINE_NAMES = Object.keys(PIPELINES).sort();
