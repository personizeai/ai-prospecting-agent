/**
 * Contact Enrichment via Apollo.io People Enrichment API
 *
 * Finds un-enriched contacts in Personize memory and enriches them
 * with title, seniority, department, LinkedIn, phone, and company data.
 *
 * Cost: 1 Apollo credit per contact.
 */

import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { memory } from '../lib/memory.js';
import { APOLLO_CONFIG, ENRICHMENT_CONFIG } from '../config/prospecting.config.js';
import { enrichPerson, isApolloConfigured, getPhone } from '../lib/apollo.js';
import { ingestEnrichment } from './ingest-enrichment.js';
import type { EnrichmentRunResult } from '../types.js';
import { logger } from '../lib/logger.js';

export async function enrichContacts(): Promise<EnrichmentRunResult> {
  const log = logger.child({ pipeline: 'enrich-apollo' });

  const result: EnrichmentRunResult = {
    enriched: 0,
    skipped: 0,
    failed: 0,
    timestamp: new Date().toISOString(),
  };

  if (!isApolloConfigured()) {
    log.info('Apollo not configured — skipping contact enrichment.');
    return result;
  }

  // Find contacts that haven't been enriched yet
  const contacts = await client.memory.search({
    type: 'Contact',
    limit: APOLLO_CONFIG.maxEnrichmentsPerRun,
  });

  if (!contacts.data?.length) {
    log.info('No contacts found for enrichment.');
    return result;
  }

  log.info('Evaluating contacts for enrichment', { count: contacts.data.length });

  for (const contact of contacts.data) {
    const email = contact.email;
    if (!email) {
      result.skipped++;
      continue;
    }

    // Check if already enriched (look for apollo enrichment tag)
    if (ENRICHMENT_CONFIG.skipAlreadyEnriched) {
      const existing = await memory.retrieve({
        message: `[ENRICHMENT from Apollo] ${email}`,
        email,
        limit: 1,
        mode: 'fast',
      });

      if ((existing as any)?.length) {
        log.info('Skipping already enriched contact', { email });
        result.skipped++;
        continue;
      }
    }

    try {
      const person = await enrichPerson(email);

      if (!person) {
        log.info('No Apollo data found', { email });
        result.failed++;
        continue;
      }

      await ingestEnrichment({
        email: person.email || email,
        first_name: person.first_name || '',
        last_name: person.last_name || '',
        title: person.title || '',
        company_name: person.organization?.name || '',
        company_domain: person.organization?.primary_domain || '',
        linkedin_url: person.linkedin_url || '',
        phone: getPhone(person),
        seniority: person.seniority || '',
        department: person.departments?.[0] || '',
        technologies: person.organization?.technologies || [],
        employee_count: person.organization?.estimated_num_employees,
        funding_amount: person.organization?.total_funding,
        industry: person.organization?.industry || '',
        source: 'Apollo',
      });

      result.enriched++;
      log.info('Enriched contact', { email, title: person.title, company: person.organization?.name });
    } catch (err) {
      log.error('Enrichment failed', { email, error: err instanceof Error ? err.message : String(err) });
      result.failed++;
    }

    await new Promise((r) => setTimeout(r, Math.max(RATE_LIMIT_PAUSE_MS, APOLLO_CONFIG.rateLimitPauseMs)));
  }

  log.info('Contact enrichment complete', { enriched: result.enriched, skipped: result.skipped, failed: result.failed });
  return result;
}
