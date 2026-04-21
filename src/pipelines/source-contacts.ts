import { client, RATE_LIMIT_PAUSE_MS, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { DISCOVERY_CONFIG } from '../config/prospecting.config.js';
import { isApolloConfigured } from '../lib/apollo.js';
import { discoverContactsForAccount } from './discover-contacts-apollo.js';
import type { HotAccount } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { CONTACT_SOURCING_SCHEMA, CONTACT_SOURCING_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';

export async function sourceContactsForAccount(account: HotAccount) {
  const log = logger.child({ pipeline: 'source-contacts' });

  // If Apollo is configured, use real contact discovery
  if (isApolloConfigured()) {
    await discoverContactsForAccount(account);
    return;
  }

  // Fallback: AI-based sourcing plan (no real search, just identifies roles to target)
  const [guidelines, companyDigest] = await Promise.all([
    client.context.retrieve({
      message: 'ICP contact criteria: titles, seniority, departments to target',
      types: ['guideline'],
      mode: 'fast',
    }),
    memory.retrieveDigest({
      websiteUrl: account.domain,
      maxTokens: 1500,
    }),
  ]);

  const existingContacts = await memory.retrieve({
    message: `contacts at ${account.company} ${account.domain}`,
    limit: 10,
    mode: 'fast',
  });

  const context = [
    guidelines.data?.compiledContext || '',
    (companyDigest as any)?.compiledContext || '',
    (existingContacts as any)?.length
      ? `EXISTING CONTACTS:\n${(existingContacts as any).map((c: any) => `- ${c.email}: ${c.content?.substring(0, 100)}`).join('\n')}`
      : 'No existing contacts at this company.',
    `TARGET TITLES: ${DISCOVERY_CONFIG.targetTitles.join(', ')}`,
    `TARGET SENIORITIES: ${DISCOVERY_CONFIG.targetSeniorities.join(', ')}`,
    `MAX CONTACTS: ${DISCOVERY_CONFIG.contactsPerAccount}`,
  ].join('\n\n---\n\n');

  const planResult = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Based on the company context and ICP criteria, list the ${DISCOVERY_CONFIG.contactsPerAccount} specific roles we should target at this company.

Only list roles we don't already have contacts for. Each role should be a string like "VP Sales (priority 1) — controls budget".
${buildJsonInstruction(CONTACT_SOURCING_SCHEMA)}`,
        maxSteps: 2,
      },
    ],
  });

  const output = String(planResult.data || '');
  const { data: parsed } = parseLLMJson(output, CONTACT_SOURCING_SCHEMA, CONTACT_SOURCING_DEFAULTS);

  log.info('Sourcing plan generated (Apollo not configured — dry plan only)', { company: account.company, roles: parsed.roles });

  const rolesToSearch = (parsed.roles as string[]).filter(Boolean);

  await memory.save({
    websiteUrl: account.domain,
    content: `[CONTACT SOURCING] Initiated contact sourcing on ${new Date().toISOString().split('T')[0]}. Roles targeted: ${rolesToSearch.join(', ') || 'none identified'}. Note: Apollo not configured — no real search performed.`,
    enhanced: true,
    tags: ['sourcing', 'pipeline-activity'],
  });
}

export async function sourceContactsForHotAccounts(hotAccounts: HotAccount[]) {
  const log = logger.child({ pipeline: 'source-contacts' });

  for (const account of hotAccounts) {
    try {
      await sourceContactsForAccount(account);
    } catch (err) {
      log.error('Contact sourcing failed', { company: account.company, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }
}
