/**
 * Contact Discovery via Apollo.io People Search API
 *
 * For each hot account, searches Apollo for contacts matching the
 * configured titles/seniority/departments, then enriches and memorizes them.
 *
 * Cost: People Search is FREE (0 credits). Each discovered contact that
 * gets enriched costs 1 credit via People Enrichment.
 *
 * Settings in: src/config/prospecting.config.ts → DISCOVERY_CONFIG
 */

import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { memory } from '../lib/memory.js';
import { APOLLO_CONFIG, DISCOVERY_CONFIG, SIGNAL_CONFIG } from '../config/prospecting.config.js';
import { searchPeople, enrichPerson, isApolloConfigured, getPhone } from '../lib/apollo.js';
import { ingestEnrichment } from './ingest-enrichment.js';
import type { HotAccount, DiscoveryRunResult } from '../types.js';
import { logger } from '../lib/logger.js';

export async function discoverContactsForAccount(account: HotAccount): Promise<number> {
  const log = logger.child({ pipeline: 'discover-contacts-apollo' });

  if (!isApolloConfigured()) {
    log.info('Apollo not configured — skipping contact discovery.');
    return 0;
  }

  // Dedup: skip if we discovered contacts at this company recently
  try {
    // Upstream PR #7 used prefer_recent / min_score on smartRecall; SDK 0.9.x
    // retrieve does not expose those. Relying on semantic match + mode:'fast'.
    const recent = await memory.retrieve({
      message: `CONTACT DISCOVERY via Apollo ${account.domain}`,
      websiteUrl: account.domain,
      limit: 1,
      mode: 'fast',
    });

    const results = (recent as any)?.results ?? [];
    if (results.length > 0) {
      const content = results[0].text || results[0].content || '';
      const dateMatch = content.match(/Discovered \d+ new contacts on (\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const lastDate = new Date(dateMatch[1]).getTime();
        const daysSince = Math.floor((Date.now() - lastDate) / 86400_000);
        if (daysSince < SIGNAL_CONFIG.rescoring.rescoringDays) {
          log.info('Contacts discovered recently, skipping', { domain: account.domain, daysSince });
          return 0;
        }
      }
    }
  } catch {
    // If dedup check fails, proceed with discovery
  }

  log.info('Discovering contacts', { company: account.company, domain: account.domain });

  // Check what contacts we already have at this company
  const existing = await memory.retrieve({
    message: `contacts at ${account.company} ${account.domain}`,
    limit: 20,
    mode: 'fast',
  });

  const existingEmails = new Set(
    ((existing as any) || [])
      .map((c: any) => c.email?.toLowerCase())
      .filter(Boolean)
  );

  log.info('Existing contacts at account', { company: account.company, count: existingEmails.size });

  // Search Apollo for matching contacts (FREE — 0 credits)
  const searchResult = await searchPeople({
    organizationDomains: [account.domain],
    personTitles: DISCOVERY_CONFIG.targetTitles,
    personSeniorities: DISCOVERY_CONFIG.targetSeniorities,
    personDepartments: DISCOVERY_CONFIG.targetDepartments,
    perPage: DISCOVERY_CONFIG.contactsPerAccount + existingEmails.size, // fetch extra to account for dupes
  });

  if (!searchResult.people?.length) {
    log.info('No matching contacts found', { domain: account.domain });
    return 0;
  }

  log.info('Apollo returned candidates', { domain: account.domain, count: searchResult.people.length });

  let discovered = 0;

  for (const person of searchResult.people) {
    // Stop once we hit the limit
    if (discovered >= DISCOVERY_CONFIG.contactsPerAccount) break;

    // Skip if we already have this contact
    if (person.email && existingEmails.has(person.email.toLowerCase())) {
      log.info('Skipping existing contact', { email: person.email });
      continue;
    }

    // Skip contacts without email if required
    if (DISCOVERY_CONFIG.requireVerifiedEmail && (!person.email || person.email_status !== 'verified')) {
      log.info('Skipping contact — no verified email', { name: person.name });
      continue;
    }

    if (!person.email) continue;

    try {
      // Enrich the discovered contact for full data (1 credit)
      const enriched = await enrichPerson(person.email);
      const enrichedPerson = enriched || person;

      await ingestEnrichment({
        email: enrichedPerson.email || person.email,
        first_name: enrichedPerson.first_name || '',
        last_name: enrichedPerson.last_name || '',
        title: enrichedPerson.title || '',
        company_name: enrichedPerson.organization?.name || account.company,
        company_domain: enrichedPerson.organization?.primary_domain || account.domain,
        linkedin_url: enrichedPerson.linkedin_url || '',
        phone: getPhone(enrichedPerson),
        seniority: enrichedPerson.seniority || '',
        department: enrichedPerson.departments?.[0] || '',
        technologies: enrichedPerson.organization?.technologies || [],
        employee_count: enrichedPerson.organization?.estimated_num_employees,
        funding_amount: enrichedPerson.organization?.total_funding,
        industry: enrichedPerson.organization?.industry || '',
        source: 'Apollo',
      });

      discovered++;
      log.info('Discovered contact', { email: person.email, title: person.title });
    } catch (err) {
      log.error('Failed to enrich discovered contact', { email: person.email, error: err instanceof Error ? err.message : String(err) });
    }

    await new Promise((r) => setTimeout(r, Math.max(RATE_LIMIT_PAUSE_MS, APOLLO_CONFIG.rateLimitPauseMs)));
  }

  // Memorize the discovery activity
  await memory.save({
    websiteUrl: account.domain,
    content: `[CONTACT DISCOVERY via Apollo] Discovered ${discovered} new contacts on ${new Date().toISOString().split('T')[0]}. Titles searched: ${DISCOVERY_CONFIG.targetTitles.join(', ')}.`,
    enhanced: true,
    tags: ['sourcing', 'apollo', 'discovery'],
  });

  log.info('Discovery complete', { company: account.company, discovered });
  return discovered;
}

export async function discoverContactsForHotAccounts(hotAccounts: HotAccount[]): Promise<DiscoveryRunResult> {
  const log = logger.child({ pipeline: 'discover-contacts-apollo' });

  const result: DiscoveryRunResult = {
    accountsProcessed: 0,
    contactsDiscovered: 0,
    timestamp: new Date().toISOString(),
  };

  for (const account of hotAccounts) {
    try {
      const found = await discoverContactsForAccount(account);
      result.contactsDiscovered += found;
      result.accountsProcessed++;
    } catch (err) {
      log.error('Contact discovery failed', { company: account.company, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Discovery batch complete', { contactsDiscovered: result.contactsDiscovered, accountsProcessed: result.accountsProcessed });
  return result;
}
