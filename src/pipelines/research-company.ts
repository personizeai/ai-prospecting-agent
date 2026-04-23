/**
 * Company Web Research Pipeline
 *
 * Uses Tavily to search the web for recent news, funding, hiring activity,
 * and competitive landscape — then memorizes findings into Personize memory.
 *
 * Two outputs per company:
 * 1. Raw search results → web-research collection (audit trail)
 * 2. AI-analyzed summary → companies collection (actionable intel)
 *
 * Flow:
 *   Hot account identified → researchCompany(domain, name)
 *   → Tavily search (2 queries) → Personize AI analysis → memorize results
 */

import 'dotenv/config';
import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { searchTavily, isTavilyConfigured } from '../lib/tavily.js';
import { TAVILY_CONFIG } from '../config/prospecting.config.js';
import type { HotAccount, WebResearchResult } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { COMPANY_RESEARCH_SCHEMA, COMPANY_RESEARCH_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';

// ─── Single Company Research ────────────────────────────────────────

export async function researchCompany(
  domain: string,
  companyName: string,
): Promise<WebResearchResult | null> {
  const log = logger.child({ pipeline: 'research-company' });

  if (!isTavilyConfigured()) {
    log.info('Tavily not configured — skipping research', { domain });
    return null;
  }

  // ── Dedup: skip if researched recently ───────────────────────────
  if (TAVILY_CONFIG.skipIfResearchedWithinDays > 0) {
    const existing = await memory.retrieve({
      message: `[WEB RESEARCH] ${domain}`,
      websiteUrl: domain,
      mode: 'fast',
    });

    const recent = ((existing as any) || []).find((m: any) => {
      const content = String(m.content || '');
      if (!content.includes('[WEB RESEARCH]')) return false;
      const dateMatch = content.match(/Researched:\s*(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return false;
      const researchDate = new Date(dateMatch[1]);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - TAVILY_CONFIG.skipIfResearchedWithinDays);
      return researchDate > cutoff;
    });

    if (recent) {
      log.info('Already researched recently, skipping', { domain });
      return null;
    }
  }

  log.info('Researching company', { companyName, domain });

  // ── Search 1: News, funding, hiring ──────────────────────────────
  const search1 = await searchTavily(
    `"${companyName}" ${domain} news funding hiring`,
    { maxResults: TAVILY_CONFIG.maxResultsPerSearch },
  );

  // ── Search 2: Product, partnerships, expansion ───────────────────
  await new Promise((r) => setTimeout(r, TAVILY_CONFIG.rateLimitPauseMs));

  const search2 = await searchTavily(
    `"${companyName}" product launch partnership expansion`,
    { maxResults: TAVILY_CONFIG.maxResultsPerSearch },
  );

  // Combine results, deduplicate by URL
  const allResults = [...(search1?.results || []), ...(search2?.results || [])];
  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  if (deduped.length === 0) {
    log.info('No web results found', { domain });
    return null;
  }

  const now = new Date().toISOString();
  const queries = [search1?.query, search2?.query].filter(Boolean) as string[];

  // ── Store raw results in web-research collection ─────────────────
  const rawContent = [
    `[WEB RESEARCH]`,
    `Company: ${companyName} (${domain})`,
    `Researched: ${now.split('T')[0]}`,
    `Queries: ${queries.join(' | ')}`,
    `Results: ${deduped.length}`,
    '',
    ...deduped.map((r, i) => [
      `--- Result ${i + 1} (score: ${r.score.toFixed(2)}) ---`,
      `Title: ${r.title}`,
      `URL: ${r.url}`,
      r.published_date ? `Date: ${r.published_date}` : '',
      `Content: ${r.content.substring(0, 500)}`,
    ].filter(Boolean).join('\n')),
  ].join('\n');

  await memory.save({
    websiteUrl: domain,
    content: rawContent,
    enhanced: true,
    tags: ['web-research', 'tavily', domain],
    collectionName: 'web-research',
  });

  // ── AI analysis of research results ──────────────────────────────
  const researchContext = deduped.map((r) => [
    `[${r.title}](${r.url})`,
    r.published_date ? `Published: ${r.published_date}` : '',
    r.content.substring(0, 400),
  ].filter(Boolean).join('\n')).join('\n\n');

  const aiSummary = search1?.answer || search2?.answer || '';

  const analysis = await client.ai.prompt({
    ...aiOptions,
    context: [
      `## COMPANY: ${companyName} (${domain})`,
      '',
      `## WEB RESEARCH RESULTS`,
      researchContext,
      '',
      aiSummary ? `## TAVILY AI SUMMARY\n${aiSummary}` : '',
    ].join('\n'),
    instructions: [
      {
        prompt: `Analyze the web research results for ${companyName}. Extract actionable intelligence.

For arrays, provide items like ["item1", "item2"]. If no relevant information found, use an empty array [].
${buildJsonInstruction(COMPANY_RESEARCH_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(analysis.data || '');
  const { data: parsed } = parseLLMJson(output, COMPANY_RESEARCH_SCHEMA, COMPANY_RESEARCH_DEFAULTS);

  const companySummary = parsed.company_summary;
  const signalsArray = (parsed.buying_signals as string[]).filter((s) => s && s.toLowerCase() !== 'none found');
  const anglesArray = (parsed.personalization_angles as string[]).filter(Boolean);
  const keyNewsArray = (parsed.key_news as string[]).filter(Boolean);
  const competitiveArray = (parsed.competitive_landscape as string[]).filter(Boolean);

  // ── Store analysis in companies collection ───────────────────────
  const analysisContent = [
    `[WEB RESEARCH ANALYSIS]`,
    `Company: ${companyName} (${domain})`,
    `Researched: ${now.split('T')[0]}`,
    `Sources: ${deduped.length} web results via Tavily`,
    '',
    `Summary: ${companySummary}`,
    '',
    `Key News:`,
    keyNewsArray.map((n) => `- ${n}`).join('\n') || 'None found',
    '',
    `Buying Signals: ${signalsArray.join(', ') || 'None found'}`,
    '',
    `Competitive Landscape: ${competitiveArray.join(', ') || 'None found'}`,
    '',
    `Personalization Angles:`,
    anglesArray.map((a) => `- ${a}`).join('\n') || 'None found',
  ].join('\n');

  await memory.save({
    websiteUrl: domain,
    content: analysisContent,
    enhanced: true,
    tags: ['web-research', 'analysis', 'tavily'],
    collectionName: 'companies',
    properties: {
      ...(companySummary && companySummary !== 'None found'
        ? { company_summary: { value: companySummary, extractMemories: false } }
        : {}),
      ...(signalsArray.length > 0
        ? { buying_signals: { value: signalsArray, extractMemories: false } }
        : {}),
    },
  });

  log.info('Research complete', { domain, results: deduped.length, signalsFound: signalsArray.length });

  return {
    domain,
    company_name: companyName,
    queries,
    results: deduped,
    ai_summary: companySummary,
    signals_found: signalsArray,
    personalization_angles: anglesArray,
    researched_at: now,
    source: 'tavily',
  };
}

// ─── Batch: Research Hot Accounts ───────────────────────────────────

export interface ResearchRunResult {
  companiesResearched: number;
  companiesSkipped: number;
  totalSignals: number;
  timestamp: string;
}

export async function researchHotAccounts(
  hotAccounts: HotAccount[],
): Promise<ResearchRunResult> {
  const log = logger.child({ pipeline: 'research-company' });
  const limit = TAVILY_CONFIG.maxResearchPerRun || hotAccounts.length;
  const batch = hotAccounts.slice(0, limit);

  let researched = 0;
  let skipped = 0;
  let totalSignals = 0;

  for (const account of batch) {
    const result = await researchCompany(account.domain, account.company);

    if (result) {
      researched++;
      totalSignals += result.signals_found.length;
    } else {
      skipped++;
    }

    // Rate limit between companies
    await new Promise((r) => setTimeout(r, TAVILY_CONFIG.rateLimitPauseMs));
  }

  log.info('Batch research complete', { researched, skipped, totalSignals });

  return {
    companiesResearched: researched,
    companiesSkipped: skipped,
    totalSignals,
    timestamp: new Date().toISOString(),
  };
}
