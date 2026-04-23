import { client } from '../config.js';
import { memory } from '../lib/memory.js';
import type { EnrichmentData } from '../types.js';
import { logger } from '../lib/logger.js';

export type { EnrichmentData } from '../types.js';

const log = logger.child({ pipeline: 'ingest-enrichment' });

export async function ingestEnrichment(data: EnrichmentData) {
  const technologies = Array.isArray(data.technologies) ? data.technologies : [];
  const fundingDisplay = data.funding_amount
    ? `$${data.funding_amount.toLocaleString()}`
    : 'N/A';

  await memory.save({
    email: data.email,
    ...(data.company_domain ? { websiteUrl: data.company_domain } : {}),
    content: [
      `[ENRICHMENT from ${data.source}]`,
      `Title: ${data.title}${data.seniority ? ` (${data.seniority})` : ''}`,
      data.department ? `Department: ${data.department}` : '',
      `Company: ${data.company_name} | ${data.company_domain}`,
      data.company_domain ? `Company Size: ${data.employee_count ?? 'Unknown'} employees` : '',
      data.industry ? `Industry: ${data.industry}` : '',
      technologies.length ? `Tech Stack: ${technologies.join(', ')}` : '',
      `Funding: ${fundingDisplay}`,
      data.linkedin_url ? `LinkedIn: ${data.linkedin_url}` : '',
    ].filter(Boolean).join('\n'),
    enhanced: true,
    tags: ['enrichment', data.source.toLowerCase()],
  });

  if (data.company_domain) {
    try {
      await memory.save({
        websiteUrl: data.company_domain,
        content: [
          `[ENRICHMENT from ${data.source}]`,
          `Company: ${data.company_name}`,
          data.industry ? `Industry: ${data.industry}` : '',
          `Size: ${data.employee_count ?? 'Unknown'} employees`,
          `Funding: ${fundingDisplay}`,
          technologies.length ? `Technologies: ${technologies.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
        enhanced: true,
        tags: ['enrichment', 'company', data.source.toLowerCase()],
      });
    } catch (err) {
      log.error('Company enrichment memorize failed', { domain: data.company_domain, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
