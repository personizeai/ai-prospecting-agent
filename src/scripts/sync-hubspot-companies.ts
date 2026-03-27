/**
 * One-time script: Sync up to N companies from HubSpot into Personize memory.
 *
 * Usage:
 *   npx tsx src/scripts/sync-hubspot-companies.ts          # default 10
 *   npx tsx src/scripts/sync-hubspot-companies.ts 5        # override limit
 *
 * Respects HUBSPOT_PERSONIZE_LEAD_PROPERTY filter if set.
 */

import 'dotenv/config';
import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { HUBSPOT_CONFIG } from '../config/prospecting.config.js';
import { Client as HubSpotClient } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/companies/models/Filter.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ script: 'sync-hubspot-companies' });

const MAX_COMPANIES = Number(process.argv[2]) || 10;

async function run() {
  const token = (process.env.HUBSPOT_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('Missing HUBSPOT_ACCESS_TOKEN');

  const hubspot = new HubSpotClient({ accessToken: token });

  const prop = HUBSPOT_CONFIG.leadFilterProperty;

  log.info('Starting one-time HubSpot company sync', { limit: MAX_COMPANIES });

  let results: any[];

  // Try filtered search first; fall back to unfiltered getPage if the
  // property doesn't exist on Company objects (HubSpot returns 400).
  if (prop) {
    try {
      log.info('Attempting filtered search', { property: prop, value: HUBSPOT_CONFIG.leadFilterValue });
      const response = await hubspot.crm.companies.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: prop,
            operator: FilterOperatorEnum.Eq,
            value: HUBSPOT_CONFIG.leadFilterValue,
          }],
        }],
        properties: HUBSPOT_CONFIG.companyProperties,
        limit: MAX_COMPANIES,
        sorts: ['createdate'],
      });
      results = response.results;
    } catch (err: any) {
      const status = err?.code || err?.statusCode || (err?.message?.match(/HTTP-Code:\s*(\d+)/)?.[1]);
      log.warn(`Filtered search failed (HTTP ${status}) — property "${prop}" likely doesn't exist on Companies. Falling back to unfiltered fetch.`);
      const response = await hubspot.crm.companies.basicApi.getPage(
        MAX_COMPANIES,
        undefined,
        HUBSPOT_CONFIG.companyProperties,
      );
      results = response.results;
    }
  } else {
    const response = await hubspot.crm.companies.basicApi.getPage(
      MAX_COMPANIES,
      undefined,
      HUBSPOT_CONFIG.companyProperties,
    );
    results = response.results;
  }

  const records = results
    .filter((company: any) => company.properties.domain)
    .slice(0, MAX_COMPANIES)
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

  if (records.length === 0) {
    log.info('No companies with a domain found. Check your HubSpot filter or data.');
    return;
  }

  log.info(`Fetched ${records.length} companies from HubSpot — memorizing into Personize...`);

  for (const record of records) {
    log.info(`  → ${record.properties.company_name.value || record.website_url}`);
  }

  await client.memory.memorizeBatch({ records, enhanced: true });

  log.info(`Done! ${records.length} companies synced to Personize memory.`);
}

run().catch((err) => {
  log.error('Script failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
