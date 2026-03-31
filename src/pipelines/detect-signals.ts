import { client, RATE_LIMIT_PAUSE_MS, aiOptions } from '../config.js';
import type { HotAccount } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS } from '../lib/llm-schemas.js';
import { SIGNAL_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';
import { extractCompanyDomain, extractCompanyName } from '../lib/company-search-result.js';

// ─── Smart Re-scoring ──────────────────────────────────────────────

interface RescoreDecision {
  rescore: boolean;
  reason: string;
}

/**
 * Determine whether a company needs re-scoring.
 * Uses the budget tier's single threshold: conservative=90d, balanced=30d, aggressive=7d.
 *
 * Rules (in priority order):
 * 1. Never scored → always score (new accounts get scored immediately)
 * 2. Terminal account status (customer, blocked, DNC) → skip permanently
 * 3. Scored within tier threshold → skip
 * 4. Older than tier threshold → re-score
 *
 * Activity triggers (replies, new contacts) bypass this check entirely —
 * they call evaluateAccountStrategy() directly.
 */
async function shouldRescoreCompany(domain: string): Promise<RescoreDecision> {
  const { rescoring } = SIGNAL_CONFIG;

  try {
    const recall = await client.memory.smartRecall({
      query: 'SIGNAL ASSESSMENT icp_fit_score signal_strength recommended_action',
      website_url: domain,
      fast_mode: true,
      prefer_recent: true,
      min_score: 0.3,
      limit: 1,
    });

    const results = (recall.data as any)?.results ?? [];
    if (results.length === 0) {
      return { rescore: true, reason: 'never_scored' };
    }

    const content = results[0].text || results[0].content || '';

    // Extract date from "[SIGNAL ASSESSMENT 2026-03-11]"
    const dateMatch = content.match(/\[SIGNAL ASSESSMENT (\d{4}-\d{2}-\d{2})\]/);
    if (!dateMatch) {
      return { rescore: true, reason: 'no_assessment_date_found' };
    }

    const lastDate = new Date(dateMatch[1]).getTime();
    if (isNaN(lastDate)) {
      return { rescore: true, reason: 'invalid_assessment_date' };
    }

    const daysSince = Math.floor((Date.now() - lastDate) / 86400_000);

    // Terminal account statuses → never re-score
    for (const status of rescoring.skipStatuses) {
      if (content.toLowerCase().includes(`"recommended_action":"${status}"`) ||
          content.toLowerCase().includes(`"account_status":"${status}"`) ||
          content.toLowerCase().includes(status.replace(/_/g, ' '))) {
        return { rescore: false, reason: `terminal_${status}` };
      }
    }

    // Within tier threshold → skip
    if (daysSince < rescoring.rescoringDays) {
      return { rescore: false, reason: `scored_${daysSince}d_ago` };
    }

    // Stale → re-score
    return { rescore: true, reason: `stale_${daysSince}d` };
  } catch {
    // If recall fails, err on the side of scoring
    return { rescore: true, reason: 'rescore_check_failed' };
  }
}

// ─── Main Pipeline ──────────────────────────────────────────────────

export async function detectAndScoreSignals(): Promise<HotAccount[]> {
  const log = logger.child({ pipeline: 'detect-signals' });

  if (!SIGNAL_CONFIG.enableSignalDetection) {
    log.info('Signal detection disabled (budget tier or manual override)');
    return [];
  }

  const companies = await client.memory.search({
    type: 'Company',
    limit: 200,
  });

  if (!companies.data?.length) {
    log.info('No companies found. Run CRM sync first.');
    return [];
  }

  // Fetch guidelines once outside the loop (same for every company)
  const guidelines = await client.ai.smartGuidelines({
    message: 'ICP scoring criteria and buying signal definitions',
    mode: 'fast',
  });

  const hotAccounts: HotAccount[] = [];
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  log.debug('Companies found in memory', {
    count: companies.data.length,
    names: companies.data.map((c: any) => extractCompanyName(c, extractCompanyDomain(c))),
  });

  log.debug('Governance guidelines loaded', {
    hasContext: !!(guidelines.data?.compiledContext),
    contextLength: (guidelines.data?.compiledContext || '').length,
    contextPreview: (guidelines.data?.compiledContext || '').slice(0, 300),
  });

  for (const company of companies.data) {
    const c = company as any;
    const domain = extractCompanyDomain(c);
    const companyName = extractCompanyName(c, domain);

    if (!domain || domain.includes('@')) {
      log.warn('Skipping company — no valid domain', { companyName, mainProperties: c.mainProperties });
      continue;
    }

    // Smart re-scoring: check if this company needs evaluation
    const rescoreCheck = await shouldRescoreCompany(domain);
    if (!rescoreCheck.rescore) {
      skipped++;
      const bucketReason = rescoreCheck.reason.replace(/_\d+d.*/, '');
      skipReasons[bucketReason] = (skipReasons[bucketReason] || 0) + 1;
      log.info('Skipping company (already scored)', { companyName, domain, reason: rescoreCheck.reason });
      continue;
    }

    log.info('Scoring company', { companyName, domain, rescoreReason: rescoreCheck.reason });

    try {
      const digest = await client.memory.smartDigest({
        website_url: domain,
        type: 'Company',
        token_budget: 2000,
      });

      const digestContext = digest.data?.compiledContext || '';
      log.debug('Company digest', {
        companyName,
        domain,
        digestLength: digestContext.length,
        digestPreview: digestContext.slice(0, 500),
      });

      const context = [
        guidelines.data?.compiledContext || '',
        digestContext,
      ].join('\n\n---\n\n');

      const assessmentPrompt = `Assess this company as a prospecting target.\n${buildJsonInstruction(SIGNAL_ASSESSMENT_SCHEMA)}`;

      const chatResult = await client.chat.completions.create({
        ...(aiOptions.tier && { tier: aiOptions.tier }),
        ...(aiOptions.provider && { provider: aiOptions.provider }),
        ...(aiOptions.model && { model: aiOptions.model }),
        ...(aiOptions.openrouterApiKey && { openrouter_api_key: aiOptions.openrouterApiKey }),
        messages: [
          { role: 'system', content: context },
          { role: 'user', content: assessmentPrompt },
        ],
      });

      const output = chatResult.choices?.[0]?.message?.content || '';
      log.debug('AI assessment response', {
        companyName,
        outputLength: output.length,
        outputPreview: output.slice(0, 400),
        model: chatResult.model,
        creditsCharged: chatResult.metadata?.credits_charged,
      });
      const { data: parsed } = parseLLMJson(output, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

      const score = parsed.icp_fit_score;
      const strength = parsed.signal_strength;
      const buyingWindow = parsed.buying_window ? 'Yes' : 'No';
      const action = parsed.recommended_action;
      const isHot = buyingWindow === 'Yes' || score >= 70;

      log.info('Score result', {
        companyName,
        domain,
        icpScore: score,
        signalStrength: strength,
        buyingWindow,
        action,
        isHot,
      });

      await client.memory.memorize({
        website_url: domain,
        content: `[SIGNAL ASSESSMENT ${new Date().toISOString().split('T')[0]}]\n${output}`,
        enhanced: true,
        tags: ['assessment', 'signal-detection'],
      });

      if (isHot) {
        hotAccounts.push({
          company: companyName,
          domain,
          score,
          strength,
          action,
        });
      }
    } catch (err) {
      log.error('Signal detection failed', { companyName, domain, error: err instanceof Error ? err.message : String(err) });
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  const scored = companies.data.length - skipped;
  log.info('Signal detection complete', {
    total: companies.data.length,
    scored,
    skipped,
    skipReasons,
    hotAccounts: hotAccounts.length,
    hotThreshold: SIGNAL_CONFIG.hotAccountThreshold,
    budgetTier: process.env.BUDGET_TIER || 'balanced',
  });

  for (const a of hotAccounts.sort((a, b) => b.score - a.score)) {
    log.info('Hot account', { score: a.score, strength: a.strength, company: a.company, action: a.action });
  }

  if (hotAccounts.length === 0 && scored > 0) {
    log.warn('No hot accounts found — all companies scored below threshold', {
      threshold: SIGNAL_CONFIG.hotAccountThreshold,
      hint: 'Check your ICP Definition governance in the Personize dashboard. Generic ICP rules may not match your target companies.',
    });
  }

  return hotAccounts;
}
