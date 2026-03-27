import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { HUBSPOT_CONFIG } from '../config/prospecting.config.js';
import { Client as HubSpotClient } from '@hubspot/api-client';
import type { FilterGroup } from '@hubspot/api-client/lib/codegen/crm/contacts/index.js';
import { FilterOperatorEnum as ContactFilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts/models/Filter.js';
import { FilterOperatorEnum as CompanyFilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/companies/models/Filter.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'sync-hubspot' });

let hubspot!: HubSpotClient;

function ensureHubSpotClient(): HubSpotClient {
  if (hubspot) return hubspot;

  const token = (process.env.HUBSPOT_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new Error('Missing required environment variable: HUBSPOT_ACCESS_TOKEN');
  }

  hubspot = new HubSpotClient({ accessToken: token });
  return hubspot;
}

/**
 * Build HubSpot Search API filter for "Personize - Lead" = true.
 * Falls back to unfiltered getPage() if the property name is empty.
 */
function buildLeadFilter(): FilterGroup[] {
  const prop = HUBSPOT_CONFIG.leadFilterProperty;
  if (!prop) return [];

  return [
    {
      filters: [
        {
          propertyName: prop,
          operator: ContactFilterOperatorEnum.Eq,
          value: HUBSPOT_CONFIG.leadFilterValue,
        },
      ],
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Personal email domains that should NOT be used as company website_url. */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com',
  'yandex.com', 'gmx.com', 'gmx.net', 'fastmail.com',
]);

/** Extract a company domain from a business email address. Returns undefined for personal emails. */
function extractCompanyDomain(email: string): string | undefined {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return undefined;
  return domain;
}

async function getAssociatedObjectIds(
  fromObjectType: 'contacts',
  fromObjectId: string,
  toObjectType: string,
  limit = 100,
): Promise<string[]> {
  const response = await hubspot.apiRequest({
    method: 'GET',
    path: `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}`,
    qs: { limit },
  });

  const data = await response.json() as { results?: Array<{ toObjectId?: number | string; id?: number | string }> };
  return (data.results || [])
    .map((item) => item.toObjectId ?? item.id)
    .filter((value): value is number | string => value !== undefined && value !== null)
    .map(String);
}

// ─── Contacts ──────────────────────────────────────────────────────

async function syncHubSpotContacts() {
  let totalSynced = 0;
  const filterGroups = buildLeadFilter();
  const useSearch = filterGroups.length > 0;

  if (useSearch) {
    log.info('Filtering contacts', { property: HUBSPOT_CONFIG.leadFilterProperty, value: HUBSPOT_CONFIG.leadFilterValue });
  }

  let after: string | undefined;

  do {
    let results: any[];
    let nextAfter: string | undefined;

    if (useSearch) {
      // Use Search API with filter
      const response = await hubspot.crm.contacts.searchApi.doSearch({
        filterGroups,
        properties: HUBSPOT_CONFIG.contactProperties,
        limit: 100,
        after,
        sorts: ['createdate'],
      });
      results = response.results;
      nextAfter = response.paging?.next?.after;
    } else {
      // Fallback: no filter, use getPage
      const response = await hubspot.crm.contacts.basicApi.getPage(
        100,
        after,
        HUBSPOT_CONFIG.contactProperties,
      );
      results = response.results;
      nextAfter = response.paging?.next?.after;
    }

    const records = results
      .filter((contact: any) => contact.properties.email)
      .map((contact: any) => {
        const companyDomain = contact.properties.website || extractCompanyDomain(contact.properties.email!);
        return {
        email: contact.properties.email!,
        ...(companyDomain ? { website_url: companyDomain } : {}),
        content: [
          `Name: ${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
          `Title: ${contact.properties.jobtitle || 'Unknown'}`,
          `Company: ${contact.properties.company || 'Unknown'}`,
          `Phone: ${contact.properties.phone || 'N/A'}`,
          `HubSpot Status: ${contact.properties.hs_lead_status || 'New'}`,
          `Lifecycle Stage: ${contact.properties.lifecyclestage || 'subscriber'}`,
        ].join('\n'),
        collectionName: 'contacts',
        properties: {
          first_name: { value: contact.properties.firstname || '', extractMemories: false },
          last_name: { value: contact.properties.lastname || '', extractMemories: false },
          job_title: { value: contact.properties.jobtitle || '', extractMemories: false },
          phone_number: { value: contact.properties.phone || '', extractMemories: false },
          company_name: { value: contact.properties.company || '', extractMemories: false },
          company_website: { value: companyDomain || '', extractMemories: false },
          source: { value: 'HubSpot', extractMemories: false },
          crm_id: { value: String(contact.id), extractMemories: false },
        },
        tags: ['crm', 'hubspot', 'sync'],
      };
      });

    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50);
      try {
        await client.memory.memorizeBatch({ records: batch, enhanced: true });
        totalSynced += batch.length;
        log.info('Synced contacts', { totalSynced });
      } catch (err) {
        log.error('Failed to sync contact batch', { batchStart: i, error: err instanceof Error ? err.message : String(err) });
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
    }

    after = nextAfter;
  } while (after);

  log.info('Contact sync complete', { totalSynced });
}

// ─── Companies ─────────────────────────────────────────────────────

async function syncHubSpotCompanies() {
  let totalSynced = 0;
  const filterGroups = buildLeadFilter();
  const useSearch = filterGroups.length > 0;

  if (useSearch) {
    log.info('Filtering companies', { property: HUBSPOT_CONFIG.leadFilterProperty, value: HUBSPOT_CONFIG.leadFilterValue });
  }

  let after: string | undefined;

  do {
    let results: any[];
    let nextAfter: string | undefined;

    if (useSearch) {
      const response = await hubspot.crm.companies.searchApi.doSearch({
        filterGroups: filterGroups.map((group) => ({
          ...group,
          filters: group.filters.map((filter) => ({
            ...filter,
            operator: CompanyFilterOperatorEnum.Eq,
          })),
        })),
        properties: HUBSPOT_CONFIG.companyProperties,
        limit: 100,
        after,
        sorts: ['createdate'],
      });
      results = response.results;
      nextAfter = response.paging?.next?.after;
    } else {
      const response = await hubspot.crm.companies.basicApi.getPage(
        100,
        after,
        HUBSPOT_CONFIG.companyProperties,
      );
      results = response.results;
      nextAfter = response.paging?.next?.after;
    }

    const records = results
      .filter((company: any) => company.properties.domain)
      .map((company: any) => ({
        website_url: company.properties.domain!,
        content: [
          `Company: ${company.properties.name || 'Unknown'}`,
          `Industry: ${company.properties.industry || 'Unknown'}`,
          `Employees: ${company.properties.numberofemployees || 'Unknown'}`,
          `Revenue: ${company.properties.annualrevenue || 'Unknown'}`,
          `Location: ${[company.properties.city, company.properties.state, company.properties.country].filter(Boolean).join(', ') || 'Unknown'}`,
        ].join('\n'),
        collectionName: 'companies',
        properties: {
          company_name: { value: company.properties.name || '', extractMemories: false },
          website: { value: company.properties.domain || '', extractMemories: false },
          industry: { value: company.properties.industry || '', extractMemories: false },
          employee_count: { value: Number(company.properties.numberofemployees) || 0, extractMemories: false },
          annual_revenue: { value: Number(company.properties.annualrevenue) || 0, extractMemories: false },
          crm_account_id: { value: String(company.id), extractMemories: false },
        },
        tags: ['crm', 'hubspot', 'company', 'sync'],
      }));

    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50);
      try {
        await client.memory.memorizeBatch({ records: batch, enhanced: true });
        totalSynced += batch.length;
        log.info('Synced companies', { totalSynced });
      } catch (err) {
        log.error('Failed to sync company batch', { batchStart: i, error: err instanceof Error ? err.message : String(err) });
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
    }

    after = nextAfter;
  } while (after);

  log.info('Company sync complete', { totalSynced });
}

// ─── Engagement History ──────────────────────────────────────────

/**
 * Optimized properties per engagement type.
 * Only fetch what's useful for AI context — skip HTML bodies, raw headers,
 * attachment IDs, and internal UI state. See HubSpot v3 properties docs.
 */
const ENGAGEMENT_PROPERTIES: Record<string, string[]> = {
  notes: [
    'hs_note_body', 'hs_timestamp', 'hubspot_owner_id',
  ],
  emails: [
    'hs_email_subject', 'hs_email_text', 'hs_email_html', // text preferred, html as fallback
    'hs_email_direction', 'hs_email_status',
    'hs_email_from_email', 'hs_email_to_email', 'hs_timestamp',
  ],
  meetings: [
    'hs_meeting_title', 'hs_meeting_body', 'hs_internal_meeting_notes',
    'hs_meeting_start_time', 'hs_meeting_end_time',
    'hs_meeting_outcome', 'hs_meeting_location',
  ],
  calls: [
    'hs_call_title', 'hs_call_body', 'hs_call_direction',
    'hs_call_duration', 'hs_call_status', 'hs_call_disposition',
    'hs_timestamp',
  ],
  tasks: [
    'hs_task_subject', 'hs_task_body', 'hs_task_status',
    'hs_task_priority', 'hs_task_type', 'hs_timestamp',
  ],
};

/** Strip HTML tags to plain text. Used as fallback when hs_email_text is null. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Get the best available email body — prefer plain text, fall back to stripped HTML. */
function getEmailBody(props: Record<string, string | null>): string {
  if (props.hs_email_text) return props.hs_email_text;
  if (props.hs_email_html) return stripHtml(props.hs_email_html);
  return '';
}

/** Format a single engagement into human-readable text for memorization. */
function formatEngagement(type: string, props: Record<string, string | null>): string {
  const timestamp = props.hs_timestamp || props.hs_meeting_start_time || '';
  const date = timestamp ? new Date(timestamp).toISOString().split('T')[0] : 'Unknown date';

  switch (type) {
    case 'notes': {
      const body = props.hs_note_body || '';
      // Note bodies can contain HTML from the HubSpot editor
      const cleanBody = body.includes('<') ? stripHtml(body) : body;
      return `[CRM NOTE — ${date}]\n${cleanBody.substring(0, 2000)}`;
    }

    case 'emails': {
      const direction = props.hs_email_direction === 'INCOMING_EMAIL' ? 'RECEIVED' : 'SENT';
      const body = getEmailBody(props);
      return [
        `[CRM EMAIL ${direction} — ${date}]`,
        `Subject: ${props.hs_email_subject || '(no subject)'}`,
        props.hs_email_from_email ? `From: ${props.hs_email_from_email}` : '',
        body.substring(0, 2000),
      ].filter(Boolean).join('\n');
    }

    case 'meetings': {
      const notes = props.hs_internal_meeting_notes || '';
      const body = props.hs_meeting_body || '';
      // Internal notes are higher value — put them first
      const cleanNotes = notes.includes('<') ? stripHtml(notes) : notes;
      const cleanBody = body.includes('<') ? stripHtml(body) : body;
      return [
        `[CRM MEETING — ${date}]`,
        `Title: ${props.hs_meeting_title || 'Meeting'}`,
        `Outcome: ${props.hs_meeting_outcome || 'Unknown'}`,
        props.hs_meeting_location ? `Location: ${props.hs_meeting_location}` : '',
        cleanNotes ? `Internal Notes: ${cleanNotes.substring(0, 2000)}` : '',
        cleanBody.substring(0, 1500),
      ].filter(Boolean).join('\n');
    }

    case 'calls': {
      const direction = props.hs_call_direction === 'INBOUND' ? 'Inbound' : 'Outbound';
      return [
        `[CRM CALL (${direction}) — ${date}]`,
        `Title: ${props.hs_call_title || 'Call'}`,
        `Duration: ${props.hs_call_duration ? Math.round(Number(props.hs_call_duration) / 1000 / 60) + ' min' : 'Unknown'}`,
        `Status: ${props.hs_call_status || 'Unknown'}`,
        props.hs_call_disposition ? `Disposition: ${props.hs_call_disposition}` : '',
        (props.hs_call_body || '').substring(0, 2000),
      ].filter(Boolean).join('\n');
    }

    case 'tasks': {
      const taskType = props.hs_task_type ? ` (${props.hs_task_type})` : '';
      return [
        `[CRM TASK${taskType} — ${date}]`,
        `Subject: ${props.hs_task_subject || 'Task'}`,
        `Status: ${props.hs_task_status || 'Unknown'}`,
        `Priority: ${props.hs_task_priority || 'Normal'}`,
        (props.hs_task_body || '').substring(0, 1000),
      ].join('\n');
    }

    default:
      return `[CRM ${type.toUpperCase()} — ${date}]\n${JSON.stringify(props).substring(0, 1000)}`;
  }
}

/** Check if an engagement is within the recency window. */
function isWithinRecencyWindow(props: Record<string, string | null>): boolean {
  const recencyDays = HUBSPOT_CONFIG.engagementRecencyDays;
  if (!recencyDays) return true; // 0 = all time

  const timestamp = props.hs_timestamp || props.hs_meeting_start_time || '';
  if (!timestamp) return true; // Include if we can't determine date

  const engagementDate = new Date(timestamp).getTime();
  if (isNaN(engagementDate)) return true;

  const cutoff = Date.now() - (recencyDays * 24 * 60 * 60 * 1000);
  return engagementDate >= cutoff;
}

/**
 * Sync engagement history (notes, emails, meetings, calls, tasks) for a single contact.
 * Each engagement type is fetched via HubSpot associations + batch read.
 * Each engagement becomes its own record in memorizeBatch() — Personize handles chunking.
 */
async function syncContactEngagements(contactId: string, contactEmail: string): Promise<number> {
  const types = HUBSPOT_CONFIG.engagementTypes || [];
  let totalSynced = 0;

  for (const type of types) {
    if (!ENGAGEMENT_PROPERTIES[type]) continue;

    try {
      // Get associated engagement IDs for this contact
      const ids = (await getAssociatedObjectIds('contacts', String(contactId), type, HUBSPOT_CONFIG.maxEngagementsPerType))
        .slice(0, HUBSPOT_CONFIG.maxEngagementsPerType);

      if (!ids.length) continue;

      // Fetch engagement details in batch
      const batchResponse = await hubspot.apiRequest({
        method: 'POST',
        path: `/crm/v3/objects/${type}/batch/read`,
        body: {
          inputs: ids.map((id: string) => ({ id })),
          properties: ENGAGEMENT_PROPERTIES[type],
        },
      });

      const results = (await batchResponse.json() as any).results || [];

      // Filter by recency and format
      const engagements = results
        .filter((r: any) => isWithinRecencyWindow(r.properties))
        .map((r: any) => formatEngagement(type, r.properties))
        .filter((text: string) => text.length > 30); // Skip empty entries

      if (!engagements.length) continue;

      // Send each engagement as its own record via batch memorize.
      // Each record's content can be 10-20k tokens — Personize handles chunking internally.
      const records = engagements.map((content: string) => ({
        email: contactEmail,
        content,
        collectionName: 'contacts',
        tags: ['crm', 'hubspot', `engagement:${type}`],
      }));

      await client.memory.memorizeBatch({ records, enhanced: true });
      totalSynced += records.length;
    } catch (err) {
      // Non-fatal — some types may not be available on all HubSpot plans
      log.warn('Failed to fetch engagements', { type, email: contactEmail, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Sync associated deals — each deal is its own record in memorizeBatch
  if (HUBSPOT_CONFIG.syncDeals) {
    try {
      const dealIds = (await getAssociatedObjectIds('contacts', String(contactId), 'deals', 10))
        .slice(0, 10);

      if (dealIds.length) {
        const dealResponse = await hubspot.apiRequest({
          method: 'POST',
          path: '/crm/v3/objects/deals/batch/read',
          body: {
            inputs: dealIds.map((id: string) => ({ id })),
            properties: [
              'dealname', 'amount', 'dealstage', 'pipeline',
              'closedate', 'description', 'deal_currency_code',
              'hs_is_closed_won', 'hs_is_closed_lost',
              'closed_lost_reason', 'closed_won_reason',
            ],
          },
        });

        const deals = (await dealResponse.json() as any).results || [];

        const dealTexts = deals.map((deal: any) => {
          const p = deal.properties;
          const currency = p.deal_currency_code || 'USD';
          const status = p.hs_is_closed_won === 'true' ? ' (WON)'
            : p.hs_is_closed_lost === 'true' ? ' (LOST)' : '';
          return [
            `[CRM DEAL${status}]`,
            `Deal: ${p.dealname || 'Untitled'}`,
            `Amount: ${p.amount ? Number(p.amount).toLocaleString() + ' ' + currency : 'Unknown'}`,
            `Stage: ${p.dealstage || 'Unknown'}`,
            `Pipeline: ${p.pipeline || 'Default'}`,
            `Close Date: ${p.closedate || 'Not set'}`,
            p.closed_won_reason ? `Won Reason: ${p.closed_won_reason}` : '',
            p.closed_lost_reason ? `Lost Reason: ${p.closed_lost_reason}` : '',
            p.description ? `Description: ${p.description.substring(0, 1000)}` : '',
          ].filter(Boolean).join('\n');
        }).filter((t: string) => t.length > 30);

        if (dealTexts.length) {
          const dealRecords = dealTexts.map((content: string) => ({
            email: contactEmail,
            content,
            collectionName: 'contacts',
            tags: ['crm', 'hubspot', 'deal'],
          }));
          await client.memory.memorizeBatch({ records: dealRecords, enhanced: true });
          totalSynced += dealRecords.length;
        }
      }
    } catch (err) {
      log.warn('Failed to fetch deals', { email: contactEmail, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return totalSynced;
}

/**
 * Fetch all synced contacts and sync their engagement history.
 * Runs after contact/company sync so CRM IDs are available.
 */
async function syncEngagementHistory() {
  const contacts = await client.memory.search({
    collectionName: 'contacts',
    filters: { tags: ['crm', 'hubspot'] },
    limit: 200,
  });

  const records = contacts.data || [];
  let totalEngagements = 0;

  for (const record of records) {
    const email = record.email;
    const crmId = record.properties?.crm_id;
    if (!email || !crmId) continue;

    const synced = await syncContactEngagements(String(crmId), email);
    totalEngagements += synced;

    if (synced > 0) {
      log.info('Engagements synced for contact', { email, count: synced });
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Engagement sync complete', { totalEngagements, contactCount: records.length });
}

// ─── Main Export ───────────────────────────────────────────────────

export async function syncHubSpot() {
  ensureHubSpotClient();

  log.info('Syncing HubSpot Contacts');
  try {
    await syncHubSpotContacts();
  } catch (err) {
    log.error('Contact sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing HubSpot Companies');
  try {
    await syncHubSpotCompanies();
  } catch (err) {
    log.error('Company sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // Sync engagement history (notes, emails, meetings, calls, tasks, deals)
  if (HUBSPOT_CONFIG.syncEngagements) {
    log.info('Syncing Engagement History');
    try {
      await syncEngagementHistory();
    } catch (err) {
      log.error('Engagement sync failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  log.info('HubSpot Sync Complete');
}
