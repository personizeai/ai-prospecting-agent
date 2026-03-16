/**
 * Clay.com Data Sync Pipeline
 *
 * Two integration modes:
 *
 *   webhook (default) — Clay POSTs enriched rows to a Trigger.dev webhook.
 *     Your Clay table runs enrichments, then an HTTP POST action sends each
 *     row (or batch) to the "clay-webhook" Trigger.dev task URL.
 *     This file provides the shared transform + memorize logic.
 *
 *   pull — This pipeline fetches rows from a Clay table via their HTTP API
 *     on the crm-sync cron schedule. Requires CLAY_API_KEY and CLAY_TABLE_URL.
 *
 * Both modes map Clay columns → Personize properties using either:
 *   - CLAY_FIELD_MAPPING (explicit JSON map), or
 *   - Auto-detection via common column name conventions
 *
 * Follows the same pattern as sync-hubspot.ts / sync-salesforce.ts:
 *   - Batch memorization with rate limiting
 *   - Company domain extraction for account-level linking
 *   - Source tagging for provenance tracking
 */

import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { CLAY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'sync-clay' });

/** Personal email domains that should NOT be used as company website_url. */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com',
  'yandex.com', 'gmx.com', 'gmx.net', 'fastmail.com',
]);

function extractCompanyDomain(email: string): string | undefined {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return undefined;
  return domain;
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

// ─── Column Name Conventions ──────────────────────────────────────
//
// Clay tables have user-defined column names. These aliases map common
// variations to Personize property names. CLAY_FIELD_MAPPING overrides these.

const CONTACT_ALIASES: Record<string, string> = {
  // email
  email: 'email', 'email_address': 'email', 'work_email': 'email', 'Email': 'email',
  // first name
  first_name: 'first_name', 'firstName': 'first_name', 'First Name': 'first_name', 'first': 'first_name',
  // last name
  last_name: 'last_name', 'lastName': 'last_name', 'Last Name': 'last_name', 'last': 'last_name',
  // job title
  job_title: 'job_title', 'title': 'job_title', 'Title': 'job_title', 'jobTitle': 'job_title', 'Job Title': 'job_title',
  // company
  company_name: 'company_name', 'company': 'company_name', 'Company': 'company_name', 'organization': 'company_name', 'companyName': 'company_name', 'Company Name': 'company_name',
  // phone
  phone: 'phone', 'phone_number': 'phone', 'Phone': 'phone', 'phoneNumber': 'phone', 'Phone Number': 'phone',
  // linkedin
  linkedin_url: 'linkedin_url', 'linkedin': 'linkedin_url', 'LinkedIn URL': 'linkedin_url', 'linkedinUrl': 'linkedin_url', 'LinkedIn': 'linkedin_url',
  // website / domain
  website: 'website', 'domain': 'website', 'company_domain': 'website', 'Website': 'website', 'Domain': 'website', 'company_website': 'website',
  // industry
  industry: 'industry', 'Industry': 'industry',
  // employee count
  employee_count: 'employee_count', 'employees': 'employee_count', 'Employees': 'employee_count', 'numberOfEmployees': 'employee_count', 'headcount': 'employee_count',
  // revenue
  annual_revenue: 'annual_revenue', 'revenue': 'annual_revenue', 'Revenue': 'annual_revenue', 'annualRevenue': 'annual_revenue',
  // location
  city: 'city', 'City': 'city',
  state: 'state', 'State': 'state',
  country: 'country', 'Country': 'country',
  location: 'location', 'Location': 'location',
};

/** Resolve a Clay column name to a Personize property name. */
function resolveField(clayColumn: string): string | undefined {
  // Explicit mapping takes priority
  if (CLAY_CONFIG.fieldMapping[clayColumn]) {
    return CLAY_CONFIG.fieldMapping[clayColumn];
  }
  return CONTACT_ALIASES[clayColumn];
}

/** Transform a raw Clay row into a Personize memorization record. */
export function transformClayRow(row: Record<string, any>): {
  record: Record<string, any>;
  email?: string;
  domain?: string;
} | null {
  // Map Clay columns → normalized properties
  const mapped: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || value === '') continue;
    const prop = resolveField(key);
    if (prop) {
      mapped[prop] = value;
    }
  }

  const isCompany = CLAY_CONFIG.targetCollection === 'companies';

  if (isCompany) {
    // Company record — needs a website/domain
    const domain = mapped.website
      ? extractDomain(String(mapped.website))
      : undefined;

    if (!domain) return null;

    return {
      domain,
      record: {
        website_url: domain,
        content: [
          `Company: ${mapped.company_name || 'Unknown'}`,
          `Industry: ${mapped.industry || 'Unknown'}`,
          `Employees: ${mapped.employee_count || 'Unknown'}`,
          `Revenue: ${mapped.annual_revenue || 'Unknown'}`,
          mapped.location || [mapped.city, mapped.state, mapped.country].filter(Boolean).join(', ')
            ? `Location: ${mapped.location || [mapped.city, mapped.state, mapped.country].filter(Boolean).join(', ')}`
            : '',
        ].filter(Boolean).join('\n'),
        collectionName: 'companies',
        properties: {
          company_name: { value: mapped.company_name || '', extractMemories: false },
          website: { value: domain, extractMemories: false },
          industry: { value: mapped.industry || '', extractMemories: false },
          employee_count: { value: Number(mapped.employee_count) || 0, extractMemories: false },
          annual_revenue: { value: Number(mapped.annual_revenue) || 0, extractMemories: false },
          source: { value: 'Clay', extractMemories: false },
        },
        tags: [...CLAY_CONFIG.tags, 'company'],
      },
    };
  }

  // Contact record — needs an email
  const email = mapped.email ? String(mapped.email).toLowerCase().trim() : undefined;
  if (!email) return null;

  const companyDomain = mapped.website
    ? extractDomain(String(mapped.website))
    : extractCompanyDomain(email);

  return {
    email,
    domain: companyDomain,
    record: {
      email,
      ...(companyDomain ? { website_url: companyDomain } : {}),
      content: [
        `Name: ${mapped.first_name || ''} ${mapped.last_name || ''}`.trim(),
        `Title: ${mapped.job_title || 'Unknown'}`,
        `Company: ${mapped.company_name || 'Unknown'}`,
        `Phone: ${mapped.phone || 'N/A'}`,
        mapped.linkedin_url ? `LinkedIn: ${mapped.linkedin_url}` : '',
      ].filter(Boolean).join('\n'),
      collectionName: 'contacts',
      properties: {
        first_name: { value: mapped.first_name || '', extractMemories: false },
        last_name: { value: mapped.last_name || '', extractMemories: false },
        job_title: { value: mapped.job_title || '', extractMemories: false },
        phone_number: { value: mapped.phone || '', extractMemories: false },
        company_name: { value: mapped.company_name || '', extractMemories: false },
        company_website: { value: companyDomain || '', extractMemories: false },
        linkedin_url: { value: mapped.linkedin_url || '', extractMemories: false },
        source: { value: 'Clay', extractMemories: false },
      },
      tags: [...CLAY_CONFIG.tags, 'contact'],
    },
  };
}

// ─── Batch Memorize ────────────────────────────────────────────────

/** Memorize transformed records in batches of 50 with rate limiting. */
export async function memorizeClayRecords(records: Record<string, any>[]): Promise<number> {
  let totalSynced = 0;

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    try {
      await client.memory.memorizeBatch({ records: batch, enhanced: true });
      totalSynced += batch.length;
      log.info('Synced Clay records', { totalSynced, total: records.length });
    } catch (err) {
      log.error('Failed to sync Clay batch', {
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  return totalSynced;
}

// ─── Webhook Ingestion ─────────────────────────────────────────────

/**
 * Process a Clay webhook payload (single row or array of rows).
 * Called by the Trigger.dev clay-webhook task.
 */
export async function ingestClayWebhook(payload: Record<string, any> | Record<string, any>[]): Promise<{
  processed: number;
  skipped: number;
}> {
  const rows = Array.isArray(payload) ? payload : [payload];
  log.info('Processing Clay webhook', { rowCount: rows.length });

  const records: Record<string, any>[] = [];
  let skipped = 0;

  for (const row of rows) {
    const result = transformClayRow(row);
    if (result) {
      records.push(result.record);
    } else {
      skipped++;
    }
  }

  const processed = await memorizeClayRecords(records);

  log.info('Clay webhook ingestion complete', { processed, skipped });
  return { processed, skipped };
}

// ─── Pull Mode ─────────────────────────────────────────────────────

/**
 * Pull rows from a Clay table via HTTP API.
 * Called by the crm-sync cron when CRM_SOURCE includes clay.
 *
 * Clay HTTP API: GET /v1/tables/{table_id}/rows
 * Auth: Bearer token
 * Pagination: offset + limit query params
 */
export async function syncClay(): Promise<void> {
  if (!CLAY_CONFIG.enabled) {
    log.warn('Clay integration not enabled, skipping');
    return;
  }

  if (CLAY_CONFIG.mode !== 'pull') {
    log.info('Clay is in webhook mode — pull sync skipped. Records arrive via clay-webhook task.');
    return;
  }

  if (!CLAY_CONFIG.apiKey || !CLAY_CONFIG.tableUrl) {
    log.warn('Clay pull mode requires CLAY_API_KEY and CLAY_TABLE_URL, skipping');
    return;
  }

  log.info('Starting Clay pull sync', { tableUrl: CLAY_CONFIG.tableUrl.substring(0, 60) });

  let totalFetched = 0;
  let offset = 0;
  const allRecords: Record<string, any>[] = [];

  // Paginate through Clay table
  while (totalFetched < CLAY_CONFIG.maxRowsPerSync) {
    const url = new URL(CLAY_CONFIG.tableUrl);
    url.searchParams.set('limit', String(CLAY_CONFIG.pullBatchSize));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${CLAY_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      log.error('Clay API error', { status: response.status, body: await response.text() });
      break;
    }

    const data = await response.json() as { data?: any[]; rows?: any[]; has_more?: boolean };
    const rows = data.data || data.rows || [];

    if (rows.length === 0) break;

    for (const row of rows) {
      const result = transformClayRow(row);
      if (result) {
        allRecords.push(result.record);
      }
    }

    totalFetched += rows.length;
    offset += rows.length;

    log.info('Fetched Clay rows', { fetched: rows.length, totalFetched });

    // Stop if no more rows
    if (!data.has_more && rows.length < CLAY_CONFIG.pullBatchSize) break;

    await new Promise((r) => setTimeout(r, 500)); // Rate limit
  }

  log.info('Clay fetch complete', { totalFetched, validRecords: allRecords.length });

  const synced = await memorizeClayRecords(allRecords);

  log.info('Clay pull sync complete', { totalFetched, synced });
}
