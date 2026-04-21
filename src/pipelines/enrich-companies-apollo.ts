/**
 * Company Enrichment via Apollo.io Organization Enrichment API
 *
 * Finds un-enriched companies in Personize memory and enriches them
 * with headcount, funding, tech stack, revenue, industry, and more.
 *
 * Cost: 1 Apollo credit per company.
 */

import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { memory } from '../lib/memory.js';
import { APOLLO_CONFIG, ENRICHMENT_CONFIG } from '../config/prospecting.config.js';
import { enrichOrganization, isApolloConfigured } from '../lib/apollo.js';
import type { EnrichmentRunResult } from '../types.js';
import { logger } from '../lib/logger.js';

export async function enrichCompanies(): Promise<EnrichmentRunResult> {
  const log = logger.child({ pipeline: 'enrich-companies-apollo' });

  const result: EnrichmentRunResult = {
    enriched: 0,
    skipped: 0,
    failed: 0,
    timestamp: new Date().toISOString(),
  };

  if (!isApolloConfigured()) {
    log.info('Apollo not configured — skipping company enrichment.');
    return result;
  }

  const companies = await client.memory.search({
    type: 'Company',
    limit: APOLLO_CONFIG.maxCompanyEnrichmentsPerRun,
  });

  if (!companies.data?.length) {
    log.info('No companies found for enrichment.');
    return result;
  }

  log.info('Evaluating companies for enrichment', { count: companies.data.length });

  for (const company of companies.data) {
    const domain = company.website_url || company.website;
    if (!domain || domain.includes('@')) {
      result.skipped++;
      continue;
    }

    // Check if already enriched
    if (ENRICHMENT_CONFIG.skipAlreadyEnriched) {
      const existing = await client.memory.recall({
        message: `[ENRICHMENT from Apollo] ${domain}`,
        website_url: domain,
        limit: 1,
      });

      if (existing.data?.length) {
        log.info('Skipping already enriched company', { domain });
        result.skipped++;
        continue;
      }
    }

    try {
      const org = await enrichOrganization(domain);

      if (!org) {
        log.info('No Apollo data found', { domain });
        result.failed++;
        continue;
      }

      const technologies = Array.isArray(org.technologies) ? org.technologies : [];
      const fundingDisplay = org.total_funding
        ? `$${org.total_funding.toLocaleString()}`
        : 'N/A';
      const revenueDisplay = org.annual_revenue
        ? `$${org.annual_revenue.toLocaleString()}`
        : org.annual_revenue_printed || 'Unknown';

      const location = [org.city, org.state, org.country].filter(Boolean).join(', ');

      await memory.save({
        websiteUrl: domain,
        content: [
          `[ENRICHMENT from Apollo]`,
          `Company: ${org.name}`,
          org.short_description ? `Description: ${org.short_description}` : '',
          `Industry: ${org.industry || 'Unknown'}`,
          `Employees: ${org.estimated_num_employees || 'Unknown'}`,
          `Annual Revenue: ${revenueDisplay}`,
          `Total Funding: ${fundingDisplay}`,
          org.latest_funding_stage ? `Latest Round: ${org.latest_funding_stage} (${org.latest_funding_round_date || 'date unknown'})` : '',
          org.founded_year ? `Founded: ${org.founded_year}` : '',
          location ? `Location: ${location}` : '',
          technologies.length ? `Tech Stack: ${technologies.join(', ')}` : '',
          org.keywords?.length ? `Keywords: ${org.keywords.join(', ')}` : '',
          org.linkedin_url ? `LinkedIn: ${org.linkedin_url}` : '',
        ].filter(Boolean).join('\n'),
        enhanced: true,
        tags: ENRICHMENT_CONFIG.companyMemoryTags,
      });

      // Also update company properties for structured queries
      await memory.save({
        websiteUrl: domain,
        collectionName: 'companies',
        content: `Apollo enrichment for ${org.name}`,
        properties: {
          employee_count: { value: org.estimated_num_employees || 0, extractMemories: false },
          annual_revenue: { value: org.annual_revenue || 0, extractMemories: false },
          industry: { value: org.industry || '', extractMemories: false },
        },
        tags: ['apollo', 'enrichment', 'structured'],
      });

      result.enriched++;
      log.info('Enriched company', { domain, name: org.name, employees: org.estimated_num_employees, funding: fundingDisplay });
    } catch (err) {
      log.error('Company enrichment failed', { domain, error: err instanceof Error ? err.message : String(err) });
      result.failed++;
    }

    await new Promise((r) => setTimeout(r, Math.max(RATE_LIMIT_PAUSE_MS, APOLLO_CONFIG.rateLimitPauseMs)));
  }

  log.info('Company enrichment complete', { enriched: result.enriched, skipped: result.skipped, failed: result.failed });
  return result;
}
