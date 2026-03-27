import { client, RATE_LIMIT_PAUSE_MS, aiOptions } from '../config.js';
import type { HotAccount } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS } from '../lib/llm-schemas.js';
import { SIGNAL_CONFIG, CSV_CONFIG, CRM_SOURCE_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

// ─── Smart Re-scoring ──────────────────────────────────────────────

interface RescoreDecision {
  rescore: boolean;
  reason: string;
}

export interface SignalDetectionSummary {
  hotAccounts: HotAccount[];
  total: number;
  scored: number;
  skipped: number;
  skipReasons: Record<string, number>;
  companyResults: Array<{
    company: string;
    domain: string;
    status: 'scored' | 'skipped' | 'error';
    score?: number;
    strength?: string;
    buyingWindow?: 'Yes' | 'No';
    action?: string;
    isHot?: boolean;
    reason?: string;
    reasoning?: string;
    usedFallback?: boolean;
    parseErrors?: string[];
    rawOutputPreview?: string;
  }>;
}

const FORCE_SIGNAL_RESCORE = process.env.FORCE_SIGNAL_RESCORE === 'true';
const PERSONIZE_BASE_URL = process.env.PERSONIZE_BASE_URL || 'https://agent.personize.ai';
const PROMPT_POLL_INTERVAL_MS = Number(process.env.PERSONIZE_PROMPT_POLL_INTERVAL_MS) || 1500;
const PROMPT_POLL_TIMEOUT_MS = Number(process.env.PERSONIZE_PROMPT_POLL_TIMEOUT_MS) || 90000;
const SIGNAL_TEST_DOMAIN = process.env.SIGNAL_TEST_DOMAIN?.trim().toLowerCase();

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickPropertyValue(prop: unknown): string | undefined {
  if (typeof prop === 'string') return prop.trim() || undefined;
  if (prop && typeof prop === 'object' && 'value' in (prop as any)) {
    return pickString((prop as any).value);
  }
  return undefined;
}

function getCompanyDomain(company: any): string | undefined {
  return (
    pickString(company?.website_url) ||
    pickString(company?.website) ||
    pickPropertyValue(company?.record?.website_url) ||
    pickPropertyValue(company?.record?.website) ||
    pickString(company?.mainProperties?.website_url) ||
    pickString(company?.mainProperties?.website) ||
    pickString(company?.recordId)
  );
}

function getCompanyName(company: any, fallback: string): string {
  return (
    pickString(company?.company_name) ||
    pickString(company?.name) ||
    pickPropertyValue(company?.record?.company_name) ||
    pickPropertyValue(company?.record?.name) ||
    pickString(company?.mainProperties?.company_name) ||
    pickString(company?.mainProperties?.name) ||
    fallback
  );
}

interface CompanySeed {
  company_name?: string;
  name?: string;
  website?: string;
  website_url?: string;
}

interface CsvContactRow {
  email?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  company_website?: string;
  lead_status?: string;
}

interface CsvNoteRow {
  email?: string;
  date?: string;
  type?: string;
  subject?: string;
  body?: string;
}

interface CsvDealRow {
  email?: string;
  deal_name?: string;
  amount?: string;
  currency?: string;
  stage?: string;
  status?: string;
  description?: string;
}

interface CsvSignalContext {
  summary: string;
}

function loadCsvCompanySeeds(): CompanySeed[] {
  const filePath = resolve(CSV_CONFIG.dataDir, CSV_CONFIG.companiesFile);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<{ company_name?: string; website?: string }>;

  return rows
    .filter((row) => pickString(row.website))
    .map((row) => ({
      company_name: row.company_name,
      website: row.website,
      website_url: row.website,
    }));
}

function loadCsvSignalContextByDomain(): Record<string, CsvSignalContext> {
  const contactsPath = resolve(CSV_CONFIG.dataDir, CSV_CONFIG.contactsFile);
  if (!existsSync(contactsPath)) return {};

  const parseCsv = <T>(filePath: string): T[] => parse(readFileSync(filePath, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as T[];

  const contacts = parseCsv<CsvContactRow>(contactsPath);
  const notesPath = resolve(CSV_CONFIG.dataDir, CSV_CONFIG.notesFile);
  const dealsPath = resolve(CSV_CONFIG.dataDir, CSV_CONFIG.dealsFile);

  const emailToDomain = new Map<string, string>();
  const linesByDomain = new Map<string, string[]>();

  for (const row of contacts) {
    const email = pickString(row.email)?.toLowerCase();
    const domain = pickString(row.company_website)?.toLowerCase();
    if (!email || !domain) continue;

    emailToDomain.set(email, domain);
    const lines = linesByDomain.get(domain) || [];
    lines.push([
      'Contact:',
      [row.first_name, row.last_name].filter(Boolean).join(' ') || email,
      row.job_title ? `| ${row.job_title}` : '',
      row.lead_status ? `| status ${row.lead_status}` : '',
    ].filter(Boolean).join(' '));
    linesByDomain.set(domain, lines);
  }

  if (existsSync(notesPath)) {
    const notes = parseCsv<CsvNoteRow>(notesPath);
    for (const row of notes) {
      const email = pickString(row.email)?.toLowerCase();
      if (!email) continue;
      const domain = emailToDomain.get(email);
      if (!domain) continue;

      const lines = linesByDomain.get(domain) || [];
      lines.push([
        'Engagement:',
        row.date || '',
        row.type || '',
        row.subject || '',
        row.body || '',
      ].filter(Boolean).join(' '));
      linesByDomain.set(domain, lines);
    }
  }

  if (existsSync(dealsPath)) {
    const deals = parseCsv<CsvDealRow>(dealsPath);
    for (const row of deals) {
      const email = pickString(row.email)?.toLowerCase();
      if (!email) continue;
      const domain = emailToDomain.get(email);
      if (!domain) continue;

      const lines = linesByDomain.get(domain) || [];
      lines.push([
        'Deal:',
        row.deal_name || '',
        row.amount ? `| ${row.amount} ${row.currency || 'USD'}` : '',
        row.stage ? `| stage ${row.stage}` : '',
        row.status ? `| status ${row.status}` : '',
        row.description || '',
      ].filter(Boolean).join(' '));
      linesByDomain.set(domain, lines);
    }
  }

  const result: Record<string, CsvSignalContext> = {};
  for (const [domain, lines] of linesByDomain.entries()) {
    result[domain] = { summary: lines.slice(0, 12).join('\n') };
  }
  return result;
}

function isSignalAssessmentObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    'icp_fit_score' in obj &&
    'signal_strength' in obj &&
    'buying_window' in obj &&
    'reasoning' in obj &&
    'recommended_action' in obj
  );
}

function isPromptReceipt(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const obj = value as {
    success?: unknown;
    message?: unknown;
    data?: { eventId?: unknown; trackingId?: unknown; status?: unknown };
  };

  const message = typeof obj.message === 'string' ? obj.message : '';
  const status = typeof obj.data?.status === 'string' ? obj.data.status.toLowerCase() : '';
  const hasEventId =
    typeof obj.data?.eventId === 'string' ||
    typeof obj.data?.trackingId === 'string';

  return Boolean(
    obj.success === true &&
    hasEventId &&
    (status === 'received' || message.includes('Poll GET /api/v1/events/'))
  );
}

function looksLikePromptOutput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('```')
  );
}

function extractPromptPayload(response: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof response === 'string') {
    return looksLikePromptOutput(response) ? response : undefined;
  }
  if (response == null || typeof response !== 'object') return undefined;
  if (seen.has(response as object)) return undefined;
  seen.add(response as object);

  if (isPromptReceipt(response)) return undefined;
  if (isSignalAssessmentObject(response)) return response;

  const obj = response as Record<string, unknown>;

  if (obj.outputs && typeof obj.outputs === 'object' && !Array.isArray(obj.outputs)) {
    if (isSignalAssessmentObject(obj.outputs)) return obj.outputs;

    const values = Object.values(obj.outputs as Record<string, unknown>);
    if (values.length === 1) {
      const nestedSingle = extractPromptPayload(values[0], seen);
      if (nestedSingle !== undefined) return nestedSingle;
    }
  }

  if (typeof obj.text === 'string' && obj.text.trim()) {
    return obj.text;
  }

  const preferredKeys = ['payload', 'result', 'response', 'completion', 'content', 'data'];
  for (const key of preferredKeys) {
    if (!(key in obj)) continue;
    const nested = extractPromptPayload(obj[key], seen);
    if (nested !== undefined) return nested;
  }

  for (const value of Object.values(obj)) {
    const nested = extractPromptPayload(value, seen);
    if (nested !== undefined) return nested;
  }

  return undefined;
}

function normalizeAiOutput(response: unknown): string {
  const payload = extractPromptPayload(response);
  const value = payload !== undefined ? payload : response;

  if (typeof value === 'string') return value;
  if (value == null) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getPromptEventId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;

  const obj = response as {
    eventId?: unknown;
    trackingId?: unknown;
    data?: unknown;
  };

  if (typeof obj.eventId === 'string' && obj.eventId) return obj.eventId;
  if (typeof obj.trackingId === 'string' && obj.trackingId) return obj.trackingId;
  return getPromptEventId(obj.data);
}

async function waitForPromptResult(response: unknown): Promise<unknown> {
  if (extractPromptPayload(response) !== undefined) return response;

  const eventId = getPromptEventId(response);
  if (!eventId) return response;
  if (!process.env.PERSONIZE_SECRET_KEY) {
    throw new Error('Missing required environment variable: PERSONIZE_SECRET_KEY');
  }

  const startedAt = Date.now();
  let lastPayload = response;

  while (Date.now() - startedAt < PROMPT_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, PROMPT_POLL_INTERVAL_MS));

    const pollResponse = await fetch(`${PERSONIZE_BASE_URL}/api/v1/events/${eventId}`, {
      headers: {
        Authorization: `Bearer ${process.env.PERSONIZE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!pollResponse.ok) {
      throw new Error(`Failed to poll prompt result for ${eventId}: ${pollResponse.status} ${pollResponse.statusText}`);
    }

    const payload = await pollResponse.json();
    lastPayload = payload;

    if (extractPromptPayload(payload) !== undefined) {
      return payload;
    }

    const status = String(
      (payload as { status?: unknown; data?: { status?: unknown } }).status ??
      (payload as { data?: { status?: unknown } }).data?.status ??
      ''
    ).toLowerCase();

    if (['failed', 'error', 'cancelled', 'completed', 'succeeded'].includes(status)) {
      return payload;
    }
  }

  throw new Error(`Timed out waiting for prompt result: ${eventId}`);
}

/**
 * Determine whether a company needs re-scoring.
 * Uses the budget tier's single threshold: conservative=90d, balanced=30d, aggressive=7d.
 *
 * Rules (in priority order):
 * 1. Never scored → always score (new accounts get scored immediately)
 * 2. Terminal account status (customer, blocked, DNC) → skip permanently
 * 3. Scored within tier threshold → skip
 * 4. Older than tier threshold → re-score
 *
 * Activity triggers (replies, new contacts) bypass this check entirely —
 * they call evaluateAccountStrategy() directly.
 */
async function shouldRescoreCompany(domain: string): Promise<RescoreDecision> {
  const { rescoring } = SIGNAL_CONFIG;

  if (FORCE_SIGNAL_RESCORE) {
    return { rescore: true, reason: 'forced_rescore' };
  }

  try {
    const recall = await client.memory.smartRecall({
      query: 'SIGNAL ASSESSMENT icp_fit_score signal_strength recommended_action',
      website_url: domain,
      fast_mode: true,
      prefer_recent: true,
      min_score: 0.3,
      limit: 1,
    });

    const results = (recall.data as any)?.results ?? [];
    if (results.length === 0) {
      return { rescore: true, reason: 'never_scored' };
    }

    const content = results[0].text || results[0].content || '';

    // Extract date from "[SIGNAL ASSESSMENT 2026-03-11]"
    const dateMatch = content.match(/\[SIGNAL ASSESSMENT (\d{4}-\d{2}-\d{2})\]/);
    if (!dateMatch) {
      return { rescore: true, reason: 'no_assessment_date_found' };
    }

    const lastDate = new Date(dateMatch[1]).getTime();
    if (isNaN(lastDate)) {
      return { rescore: true, reason: 'invalid_assessment_date' };
    }

    const daysSince = Math.floor((Date.now() - lastDate) / 86400_000);

    // Terminal account statuses → never re-score
    for (const status of rescoring.skipStatuses) {
      if (content.toLowerCase().includes(`"recommended_action":"${status}"`) ||
          content.toLowerCase().includes(`"account_status":"${status}"`) ||
          content.toLowerCase().includes(status.replace(/_/g, ' '))) {
        return { rescore: false, reason: `terminal_${status}` };
      }
    }

    // Within tier threshold → skip
    if (daysSince < rescoring.rescoringDays) {
      return { rescore: false, reason: `scored_${daysSince}d_ago` };
    }

    // Stale → re-score
    return { rescore: true, reason: `stale_${daysSince}d` };
  } catch {
    // If recall fails, err on the side of scoring
    return { rescore: true, reason: 'rescore_check_failed' };
  }
}

// ─── Main Pipeline ──────────────────────────────────────────────────

export async function detectAndScoreSignalsDetailed(): Promise<SignalDetectionSummary> {
  const log = logger.child({ pipeline: 'detect-signals' });

  if (!SIGNAL_CONFIG.enableSignalDetection) {
    log.info('Signal detection disabled (budget tier or manual override)');
    return {
      hotAccounts: [],
      total: 0,
      scored: 0,
      skipped: 0,
      skipReasons: {},
      companyResults: [],
    };
  }

  const companySearch = await client.memory.search({
    type: 'Company',
    collectionName: 'companies',
    limit: 200,
    returnRecords: true,
  });

  let companies = Array.isArray(companySearch.data) ? companySearch.data : [];
  const csvSignalContextByDomain = CRM_SOURCE_CONFIG.source === 'csv'
    ? loadCsvSignalContextByDomain()
    : {};

  // CSV mode fallback: use the local seed file if search results do not include usable domains.
  if (CRM_SOURCE_CONFIG.source === 'csv') {
    const hasUsableDomain = companies.some((company) => {
      const domain = getCompanyDomain(company);
      return domain && !domain.includes('@');
    });

    if (!hasUsableDomain) {
      const csvSeeds = loadCsvCompanySeeds();
      if (csvSeeds.length) {
        companies = csvSeeds;
        log.info('Using CSV company seeds for signal detection', { count: csvSeeds.length });
      }
    }
  }

  if (SIGNAL_TEST_DOMAIN) {
    companies = companies.filter((company) => getCompanyDomain(company)?.toLowerCase() === SIGNAL_TEST_DOMAIN);
    log.info('Signal detection limited to test domain', {
      domain: SIGNAL_TEST_DOMAIN,
      count: companies.length,
    });
  }

  if (!companies.length) {
    log.info('No companies found. Run CRM sync first.');
    return {
      hotAccounts: [],
      total: 0,
      scored: 0,
      skipped: 0,
      skipReasons: {},
      companyResults: [],
    };
  }

  // Fetch guidelines once outside the loop (same for every company)
  const guidelines = await client.ai.smartGuidelines({
    message: 'ICP scoring criteria and buying signal definitions',
    mode: 'fast',
  });

  const hotAccounts: HotAccount[] = [];
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  const companyResults: SignalDetectionSummary['companyResults'] = [];

  for (const company of companies) {
    const domain = getCompanyDomain(company);
    // Don't use email as a website_url — it produces bad digest results
    if (!domain || domain.includes('@')) {
      skipped++;
      skipReasons.invalid_domain = (skipReasons.invalid_domain || 0) + 1;
      companyResults.push({
        company: getCompanyName(company, '(unknown company)'),
        domain: domain || '(missing)',
        status: 'skipped',
        reason: 'invalid_domain',
      });
      continue;
    }

    // Smart re-scoring: check if this company needs evaluation
    const rescoreCheck = await shouldRescoreCompany(domain);
    if (!rescoreCheck.rescore) {
      skipped++;
      const bucketReason = rescoreCheck.reason.replace(/_\d+d.*/, ''); // Group by reason type
      skipReasons[bucketReason] = (skipReasons[bucketReason] || 0) + 1;
      companyResults.push({
        company: getCompanyName(company, domain),
        domain,
        status: 'skipped',
        reason: rescoreCheck.reason,
      });
      continue;
    }

    try {
      const digest = await client.memory.smartDigest({
        website_url: domain,
        type: 'Company',
        token_budget: 2000,
      });

      const context = [
        guidelines.data?.compiledContext || '',
        digest.data?.compiledContext || '',
        csvSignalContextByDomain[domain.toLowerCase()]?.summary
          ? `## CSV ACCOUNT CONTEXT\n${csvSignalContextByDomain[domain.toLowerCase()].summary}`
          : '',
      ].join('\n\n---\n\n');

      const promptReceipt = await client.ai.prompt({
        ...aiOptions,
        context,
        instructions: [
          {
            prompt: `Assess this company as a prospecting target.
${buildJsonInstruction(SIGNAL_ASSESSMENT_SCHEMA)}`,
            maxSteps: 3,
          },
        ],
      });

      const result = await waitForPromptResult(promptReceipt);
      const output = normalizeAiOutput(result);
      const { data: parsed, usedFallback, errors } = parseLLMJson(output, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

      const score = parsed.icp_fit_score;
      const strength = parsed.signal_strength;
      const buyingWindow = parsed.buying_window ? 'Yes' : 'No';
      const action = parsed.recommended_action;
      const reasoning = parsed.reasoning;
      const companyName = getCompanyName(company, domain);

      // Only memorize assessments that carry real signal.
      // Zero-score / no-data responses waste a memorize + AI extraction call.
      if (score > 0 || strength !== 'None') {
        await client.memory.memorize({
          website_url: domain,
          content: `[SIGNAL ASSESSMENT ${new Date().toISOString().split('T')[0]}]\n${output}`,
          enhanced: false,
          tags: ['assessment', 'signal-detection'],
        });
      } else {
        log.info('Skipping memorize for zero-score assessment', { domain, score, strength });
      }

      log.info('Company assessment complete', {
        company: companyName,
        domain,
        score,
        strength,
        buyingWindow,
        action,
        reasoning,
        usedFallback,
        parseErrors: errors,
        rawOutputPreview: output.slice(0, 300),
        isHot: buyingWindow === 'Yes' || score >= SIGNAL_CONFIG.hotAccountThreshold,
      });

      companyResults.push({
        company: companyName,
        domain,
        status: 'scored',
        score,
        strength,
        buyingWindow,
        action,
        isHot: buyingWindow === 'Yes' || score >= SIGNAL_CONFIG.hotAccountThreshold,
      });

      if (buyingWindow === 'Yes' || score >= SIGNAL_CONFIG.hotAccountThreshold) {
        hotAccounts.push({
          company: companyName,
          domain,
          score,
          strength,
          action,
        });
      }
    } catch (err) {
      log.error('Signal detection failed', { domain, error: err instanceof Error ? err.message : String(err) });
      companyResults.push({
        company: getCompanyName(company, domain),
        domain,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      });
      // Continue with next company instead of aborting
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  const scored = companies.length - skipped;
  log.info('Signal detection complete', {
    total: companies.length,
    scored,
    skipped,
    skipReasons,
    hotAccounts: hotAccounts.length,
  });

  for (const a of hotAccounts.sort((a, b) => b.score - a.score)) {
    log.info('Hot account', { score: a.score, strength: a.strength, company: a.company, action: a.action });
  }

  return {
    hotAccounts,
    total: companies.length,
    scored,
    skipped,
    skipReasons,
    companyResults,
  };
}

export async function detectAndScoreSignals(): Promise<HotAccount[]> {
  const summary = await detectAndScoreSignalsDetailed();
  return summary.hotAccounts;
}
