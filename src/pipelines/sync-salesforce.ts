/**
 * Salesforce CRM Sync Pipeline
 *
 * Syncs contacts, accounts (companies), opportunities (deals), and activities
 * from Salesforce into Personize memory. Uses jsforce for REST API access.
 *
 * Follows the same pattern as sync-hubspot.ts:
 *   - Paginated queries with configurable filters
 *   - Batch memorization with rate limiting
 *   - Engagement history sync (activities, opportunities)
 *   - Company domain extraction for account-level linking
 */

import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { memory } from '../lib/memory.js';
import { SALESFORCE_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'sync-salesforce' });

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

/** Extract domain from a URL (e.g., "https://www.acme.com" → "acme.com"). */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

/**
 * Create a jsforce connection using username/password auth.
 * Docs: https://jsforce.github.io/document/
 * Uses dynamic import to avoid crashing when jsforce isn't installed.
 * Install: npm i jsforce (already in package.json)
 */
async function createConnection(): Promise<any> {
  // jsforce v3 supports both `import jsforce from 'jsforce'` and `import { Connection } from 'jsforce'`.
  // We use the default import for compatibility with both v2 and v3.
  const jsforce = await import('jsforce');
  const Connection = jsforce.Connection || (jsforce as any).default?.Connection;

  if (!Connection) {
    throw new Error('jsforce not installed or incompatible version. Run: npm i jsforce');
  }

  const conn = new Connection({
    loginUrl: SALESFORCE_CONFIG.loginUrl,
  });

  await conn.login(
    SALESFORCE_CONFIG.username,
    SALESFORCE_CONFIG.password + SALESFORCE_CONFIG.securityToken,
  );

  log.info('Salesforce connected', {
    instanceUrl: conn.instanceUrl,
    userId: conn.userInfo?.id,
  });

  return conn;
}

// ─── Contacts ──────────────────────────────────────────────────────

async function syncContacts(conn: any) {
  let totalSynced = 0;

  const fields = SALESFORCE_CONFIG.contactFields.join(', ');
  const where = SALESFORCE_CONFIG.contactFilter
    ? ` WHERE ${SALESFORCE_CONFIG.contactFilter}`
    : '';

  const query = `SELECT ${fields} FROM Contact${where} ORDER BY CreatedDate ASC`;
  log.info('Querying Salesforce contacts', { query: query.substring(0, 200) });

  let result = await conn.query(query);
  let allRecords = result.records;

  // Handle pagination
  while (!result.done && result.nextRecordsUrl) {
    result = await conn.queryMore(result.nextRecordsUrl);
    allRecords = allRecords.concat(result.records);
  }

  log.info('Fetched contacts', { count: allRecords.length });

  const records = allRecords
    .filter((c: any) => c.Email)
    .map((c: any) => {
      const accountWebsite = c.Account?.Website;
      const companyDomain = accountWebsite
        ? extractDomain(accountWebsite)
        : extractCompanyDomain(c.Email);

      return {
        email: c.Email,
        ...(companyDomain ? { website_url: companyDomain } : {}),
        content: [
          `Name: ${c.FirstName || ''} ${c.LastName || ''}`.trim(),
          `Title: ${c.Title || 'Unknown'}`,
          `Company: ${c.Account?.Name || 'Unknown'}`,
          `Phone: ${c.Phone || 'N/A'}`,
          `Lead Source: ${c.LeadSource || 'Unknown'}`,
        ].join('\n'),
        collectionName: 'contacts',
        properties: {
          first_name: { value: c.FirstName || '', extractMemories: false },
          last_name: { value: c.LastName || '', extractMemories: false },
          job_title: { value: c.Title || '', extractMemories: false },
          phone_number: { value: c.Phone || '', extractMemories: false },
          company_name: { value: c.Account?.Name || '', extractMemories: false },
          company_website: { value: companyDomain || '', extractMemories: false },
          source: { value: 'Salesforce', extractMemories: false },
          crm_id: { value: String(c.Id), extractMemories: false },
        },
        tags: ['crm', 'salesforce', 'sync'],
      };
    });

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    try {
      await memory.saveBatch(batch.map((r: any) => ({ ...r, enhanced: true })));
      totalSynced += batch.length;
      log.info('Synced contacts', { totalSynced });
    } catch (err) {
      log.error('Failed to sync contact batch', {
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Contact sync complete', { totalSynced });
}

// ─── Accounts (Companies) ─────────────────────────────────────────

async function syncAccounts(conn: any) {
  let totalSynced = 0;

  const fields = SALESFORCE_CONFIG.accountFields.join(', ');
  const where = SALESFORCE_CONFIG.accountFilter
    ? ` WHERE ${SALESFORCE_CONFIG.accountFilter}`
    : '';

  const query = `SELECT ${fields} FROM Account${where} ORDER BY CreatedDate ASC`;
  log.info('Querying Salesforce accounts', { query: query.substring(0, 200) });

  let result = await conn.query(query);
  let allRecords = result.records;

  while (!result.done && result.nextRecordsUrl) {
    result = await conn.queryMore(result.nextRecordsUrl);
    allRecords = allRecords.concat(result.records);
  }

  log.info('Fetched accounts', { count: allRecords.length });

  const records = allRecords
    .filter((a: any) => a.Website)
    .map((a: any) => {
      const domain = extractDomain(a.Website);
      return {
        website_url: domain,
        content: [
          `Company: ${a.Name || 'Unknown'}`,
          `Industry: ${a.Industry || 'Unknown'}`,
          `Employees: ${a.NumberOfEmployees || 'Unknown'}`,
          `Revenue: ${a.AnnualRevenue || 'Unknown'}`,
          `Location: ${[a.BillingCity, a.BillingState, a.BillingCountry].filter(Boolean).join(', ') || 'Unknown'}`,
        ].join('\n'),
        collectionName: 'companies',
        properties: {
          company_name: { value: a.Name || '', extractMemories: false },
          website: { value: domain, extractMemories: false },
          industry: { value: a.Industry || '', extractMemories: false },
          employee_count: { value: Number(a.NumberOfEmployees) || 0, extractMemories: false },
          annual_revenue: { value: Number(a.AnnualRevenue) || 0, extractMemories: false },
          crm_account_id: { value: String(a.Id), extractMemories: false },
        },
        tags: ['crm', 'salesforce', 'company', 'sync'],
      };
    });

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    try {
      await memory.saveBatch(batch.map((r: any) => ({ ...r, enhanced: true })));
      totalSynced += batch.length;
      log.info('Synced accounts', { totalSynced });
    } catch (err) {
      log.error('Failed to sync account batch', {
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Account sync complete', { totalSynced });
}

// ─── Activities & Opportunities ──────────────────────────────────

async function syncContactActivities(conn: any) {
  if (!SALESFORCE_CONFIG.syncActivities && !SALESFORCE_CONFIG.syncOpportunities) return;

  const contacts = await client.memory.search({
    collectionName: 'contacts',
    filters: { tags: ['crm', 'salesforce'] },
    limit: 200,
  });

  const records = contacts.data || [];
  let totalActivities = 0;

  for (const record of records) {
    const email = record.email;
    const crmId = record.properties?.crm_id;
    if (!email || !crmId) continue;

    // Sync activities (tasks + events)
    if (SALESFORCE_CONFIG.syncActivities) {
      try {
        const recencyFilter = SALESFORCE_CONFIG.activityRecencyDays > 0
          ? ` AND ActivityDate >= LAST_N_DAYS:${SALESFORCE_CONFIG.activityRecencyDays}`
          : '';

        const taskQuery = `SELECT Subject, Description, Status, Priority, ActivityDate, Type FROM Task WHERE WhoId = '${crmId}'${recencyFilter} ORDER BY ActivityDate DESC LIMIT ${SALESFORCE_CONFIG.maxActivitiesPerContact}`;
        const taskResult = await conn.query(taskQuery);

        const activityRecords = (taskResult.records || []).map((t: any) => ({
          email,
          content: [
            `[CRM TASK (${t.Type || 'Task'}) — ${t.ActivityDate || 'Unknown date'}]`,
            `Subject: ${t.Subject || 'Task'}`,
            `Status: ${t.Status || 'Unknown'}`,
            `Priority: ${t.Priority || 'Normal'}`,
            (t.Description || '').substring(0, 1000),
          ].filter(Boolean).join('\n'),
          collectionName: 'contacts',
          tags: ['crm', 'salesforce', 'engagement:task'],
        }));

        if (activityRecords.length > 0) {
          await memory.saveBatch(activityRecords.map((r: any) => ({ ...r, enhanced: true })));
          totalActivities += activityRecords.length;
        }
      } catch (err) {
        log.warn('Failed to fetch activities', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Sync opportunities (deals)
    if (SALESFORCE_CONFIG.syncOpportunities) {
      try {
        const oppQuery = `SELECT Name, Amount, StageName, CloseDate, Probability, Description, IsClosed, IsWon FROM Opportunity WHERE Id IN (SELECT OpportunityId FROM OpportunityContactRole WHERE ContactId = '${crmId}') ORDER BY CloseDate DESC LIMIT 10`;
        const oppResult = await conn.query(oppQuery);

        const oppRecords = (oppResult.records || []).map((o: any) => {
          const status = o.IsWon ? ' (WON)' : o.IsClosed ? ' (LOST)' : '';
          return {
            email,
            content: [
              `[CRM DEAL${status}]`,
              `Deal: ${o.Name || 'Untitled'}`,
              `Amount: ${o.Amount ? Number(o.Amount).toLocaleString() : 'Unknown'}`,
              `Stage: ${o.StageName || 'Unknown'}`,
              `Close Date: ${o.CloseDate || 'Not set'}`,
              `Probability: ${o.Probability || 0}%`,
              o.Description ? `Description: ${o.Description.substring(0, 1000)}` : '',
            ].filter(Boolean).join('\n'),
            collectionName: 'contacts',
            tags: ['crm', 'salesforce', 'deal'],
          };
        });

        if (oppRecords.length > 0) {
          await memory.saveBatch(oppRecords.map((r: any) => ({ ...r, enhanced: true })));
          totalActivities += oppRecords.length;
        }
      } catch (err) {
        log.warn('Failed to fetch opportunities', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Activity sync complete', { totalActivities, contactCount: records.length });
}

// ─── Main Export ───────────────────────────────────────────────────

export async function syncSalesforce() {
  if (!SALESFORCE_CONFIG.username || !SALESFORCE_CONFIG.password) {
    log.warn('Salesforce credentials not configured, skipping sync');
    return;
  }

  const conn = await createConnection();

  log.info('Syncing Salesforce Contacts');
  try {
    await syncContacts(conn);
  } catch (err) {
    log.error('Contact sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing Salesforce Accounts');
  try {
    await syncAccounts(conn);
  } catch (err) {
    log.error('Account sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing Salesforce Activities & Opportunities');
  try {
    await syncContactActivities(conn);
  } catch (err) {
    log.error('Activity sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Salesforce Sync Complete');
}
