import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { memory } from '../lib/memory.js';
import { CSV_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'sync-csv' });

// ─── Helpers ──────────────────────────────────────────────────────

/** Resolve a CSV file path. Returns null if the file doesn't exist. */
function resolveCSV(filename: string): string | null {
  if (!filename) return null;
  const filePath = resolve(CSV_CONFIG.dataDir, filename);
  if (!existsSync(filePath)) {
    log.warn('File not found, skipping', { filePath });
    return null;
  }
  return filePath;
}

/** Read and parse a CSV file into typed row objects. */
function parseCSVFile<T extends object>(filePath: string): T[] {
  const content = readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as T[];
}

/** Memorize records in batches of 50 with rate-limit pauses. */
async function batchMemorize(records: any[], label: string): Promise<number> {
  let totalSynced = 0;

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    try {
      await memory.saveBatch(batch.map((r: any) => ({ ...r, enhanced: true })));
      totalSynced += batch.length;
      log.info('Batch synced', { label, totalSynced });
    } catch (err) {
      log.error('Failed to sync batch', { label, batchStart: i, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  return totalSynced;
}

// ─── Contacts ──────────────────────────────────────────────────────

interface ContactRow {
  email: string;
  first_name: string;
  last_name: string;
  job_title: string;
  company_name: string;
  phone_number: string;
  linkedin_url: string;
  seniority_level: string;
  department: string;
  company_website: string;
  lead_status: string;
  crm_id: string;
}

async function syncCSVContacts(): Promise<number> {
  const filePath = resolveCSV(CSV_CONFIG.contactsFile);
  if (!filePath) return 0;

  const rows = parseCSVFile<ContactRow>(filePath).filter((r) => r.email);
  if (!rows.length) {
    log.info('No valid contact rows found.');
    return 0;
  }

  const records = rows.map((row) => ({
    email: row.email,
    ...(row.company_website ? { website_url: row.company_website } : {}),
    content: [
      `Name: ${row.first_name || ''} ${row.last_name || ''}`.trim(),
      `Title: ${row.job_title || 'Unknown'}`,
      `Company: ${row.company_name || 'Unknown'}`,
      `Phone: ${row.phone_number || 'N/A'}`,
      row.linkedin_url ? `LinkedIn: ${row.linkedin_url}` : '',
      row.seniority_level ? `Seniority: ${row.seniority_level}` : '',
      row.department ? `Department: ${row.department}` : '',
      row.lead_status ? `Status: ${row.lead_status}` : '',
    ].filter(Boolean).join('\n'),
    collectionName: 'contacts',
    properties: {
      first_name: { value: row.first_name || '', extractMemories: false },
      last_name: { value: row.last_name || '', extractMemories: false },
      job_title: { value: row.job_title || '', extractMemories: false },
      phone_number: { value: row.phone_number || '', extractMemories: false },
      company_name: { value: row.company_name || '', extractMemories: false },
      linkedin_url: { value: row.linkedin_url || '', extractMemories: false },
      seniority_level: { value: row.seniority_level || '', extractMemories: false },
      department: { value: row.department || '', extractMemories: false },
      company_website: { value: row.company_website || '', extractMemories: false },
      source: { value: 'CSV', extractMemories: false },
      crm_id: { value: row.crm_id || '', extractMemories: false },
    },
    tags: ['crm', 'csv', 'sync'],
  }));

  const synced = await batchMemorize(records, 'contacts');
  log.info('Contact sync complete', { count: synced });
  return synced;
}

// ─── Companies ─────────────────────────────────────────────────────

interface CompanyRow {
  website: string;
  company_name: string;
  industry: string;
  employee_count: string;
  annual_revenue: string;
  headquarters: string;
  funding_stage: string;
  crm_account_id: string;
}

async function syncCSVCompanies(): Promise<number> {
  const filePath = resolveCSV(CSV_CONFIG.companiesFile);
  if (!filePath) return 0;

  const rows = parseCSVFile<CompanyRow>(filePath).filter((r) => r.website);
  if (!rows.length) {
    log.info('No valid company rows found.');
    return 0;
  }

  const records = rows.map((row) => ({
    website_url: row.website,
    content: [
      `Company: ${row.company_name || 'Unknown'}`,
      `Industry: ${row.industry || 'Unknown'}`,
      `Employees: ${row.employee_count || 'Unknown'}`,
      `Revenue: ${row.annual_revenue || 'Unknown'}`,
      `Headquarters: ${row.headquarters || 'Unknown'}`,
      row.funding_stage ? `Funding Stage: ${row.funding_stage}` : '',
    ].filter(Boolean).join('\n'),
    collectionName: 'companies',
    properties: {
      company_name: { value: row.company_name || '', extractMemories: false },
      website: { value: row.website || '', extractMemories: false },
      industry: { value: row.industry || '', extractMemories: false },
      employee_count: { value: Number(row.employee_count) || 0, extractMemories: false },
      annual_revenue: { value: Number(row.annual_revenue) || 0, extractMemories: false },
      headquarters: { value: row.headquarters || '', extractMemories: false },
      crm_account_id: { value: row.crm_account_id || '', extractMemories: false },
    },
    tags: ['crm', 'csv', 'company', 'sync'],
  }));

  const synced = await batchMemorize(records, 'companies');
  log.info('Company sync complete', { count: synced });
  return synced;
}

// ─── Notes / Engagements ───────────────────────────────────────────

interface NoteRow {
  email: string;
  date: string;
  type: string;
  subject: string;
  body: string;
}

const VALID_NOTE_TYPES = ['note', 'email', 'meeting', 'call', 'task'];

async function syncCSVNotes(): Promise<number> {
  const filePath = resolveCSV(CSV_CONFIG.notesFile);
  if (!filePath) return 0;

  const rows = parseCSVFile<NoteRow>(filePath).filter((r) => r.email && r.body);
  if (!rows.length) {
    log.info('No valid note rows found.');
    return 0;
  }

  const records = rows.map((row) => {
    const type = VALID_NOTE_TYPES.includes(row.type?.toLowerCase()) ? row.type.toLowerCase() : 'note';
    const date = row.date || 'Unknown date';
    const typeLabel = type.toUpperCase();

    const content = [
      `[CSV ${typeLabel} — ${date}]`,
      row.subject ? `Subject: ${row.subject}` : '',
      row.body,
    ].filter(Boolean).join('\n');

    // Map CSV type to HubSpot engagement type for tag compatibility
    const engagementTag = type === 'note' ? 'notes'
      : type === 'email' ? 'emails'
      : type === 'meeting' ? 'meetings'
      : type === 'call' ? 'calls'
      : 'tasks';

    return {
      email: row.email,
      content,
      collectionName: 'contacts',
      tags: ['crm', 'csv', `engagement:${engagementTag}`],
    };
  });

  const synced = await batchMemorize(records, 'notes');
  log.info('Notes sync complete', { count: synced });
  return synced;
}

// ─── Deals ─────────────────────────────────────────────────────────

interface DealRow {
  email: string;
  deal_name: string;
  amount: string;
  currency: string;
  stage: string;
  pipeline: string;
  close_date: string;
  status: string;
  won_reason: string;
  lost_reason: string;
  description: string;
}

async function syncCSVDeals(): Promise<number> {
  const filePath = resolveCSV(CSV_CONFIG.dealsFile);
  if (!filePath) return 0;

  const rows = parseCSVFile<DealRow>(filePath).filter((r) => r.email && r.deal_name);
  if (!rows.length) {
    log.info('No valid deal rows found.');
    return 0;
  }

  const records = rows.map((row) => {
    const currency = row.currency || 'USD';
    const statusSuffix = row.status === 'won' ? ' (WON)'
      : row.status === 'lost' ? ' (LOST)' : '';

    const content = [
      `[CSV DEAL${statusSuffix}]`,
      `Deal: ${row.deal_name}`,
      row.amount ? `Amount: ${Number(row.amount).toLocaleString()} ${currency}` : '',
      `Stage: ${row.stage || 'Unknown'}`,
      `Pipeline: ${row.pipeline || 'Default'}`,
      `Close Date: ${row.close_date || 'Not set'}`,
      row.won_reason ? `Won Reason: ${row.won_reason}` : '',
      row.lost_reason ? `Lost Reason: ${row.lost_reason}` : '',
      row.description ? `Description: ${row.description}` : '',
    ].filter(Boolean).join('\n');

    return {
      email: row.email,
      content,
      collectionName: 'contacts',
      tags: ['crm', 'csv', 'deal'],
    };
  });

  const synced = await batchMemorize(records, 'deals');
  log.info('Deals sync complete', { count: synced });
  return synced;
}

// ─── Main Export ───────────────────────────────────────────────────

export async function syncCSV(): Promise<void> {
  if (!CSV_CONFIG.enabled) {
    log.info('CSV import is disabled. Skipping.');
    return;
  }

  log.info('Reading CSV files', { dataDir: resolve(CSV_CONFIG.dataDir) });

  log.info('Syncing CSV Contacts');
  try {
    await syncCSVContacts();
  } catch (err) {
    log.error('CSV contact sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing CSV Companies');
  try {
    await syncCSVCompanies();
  } catch (err) {
    log.error('CSV company sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing CSV Notes');
  try {
    await syncCSVNotes();
  } catch (err) {
    log.error('CSV notes sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing CSV Deals');
  try {
    await syncCSVDeals();
  } catch (err) {
    log.error('CSV deals sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('CSV Sync Complete');
}
