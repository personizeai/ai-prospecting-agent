import { client, RATE_LIMIT_PAUSE_MS, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import type { HotAccount } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS } from '../lib/llm-schemas.js';
import { SIGNAL_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

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
    const recall = await memory.retrieve({
      message: 'SIGNAL ASSESSMENT icp_fit_score signal_strength recommended_action',
      websiteUrl: domain,
      limit: 1,
      mode: 'fast',
    });

    const results = (recall as any)?.results ?? [];
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

  for (const company of companies.data) {
    const domain = company.website_url || company.website;
    // Don't use email as a website_url — it produces bad digest results
    if (!domain || domain.includes('@')) continue;

    // Smart re-scoring: check if this company needs evaluation
    const rescoreCheck = await shouldRescoreCompany(domain);
    if (!rescoreCheck.rescore) {
      skipped++;
      const bucketReason = rescoreCheck.reason.replace(/_\d+d.*/, ''); // Group by reason type
      skipReasons[bucketReason] = (skipReasons[bucketReason] || 0) + 1;
      continue;
    }

    try {
      const digest = await memory.retrieveDigest({
        websiteUrl: domain,
        maxTokens: 2000,
      });

      const context = [
        guidelines.data?.compiledContext || '',
        (digest as any)?.compiledContext || '',
      ].join('\n\n---\n\n');

      const result = await client.ai.prompt({
        ...aiOptions,
        context,
        instructions: [
          {
            prompt: `Assess this company as a prospecting target.
${buildJsonInstruction(SIGNAL_ASSESSMENT_SCHEMA)}`,
            maxSteps: 3,
          },
        ],
      });

      const output = String(result.data || '');
      const { data: parsed } = parseLLMJson(output, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

      const score = parsed.icp_fit_score;
      const strength = parsed.signal_strength;
      const buyingWindow = parsed.buying_window ? 'Yes' : 'No';
      const action = parsed.recommended_action;

      await memory.save({
        websiteUrl: domain,
        content: `[SIGNAL ASSESSMENT ${new Date().toISOString().split('T')[0]}]\n${output}`,
        enhanced: true,
        tags: ['assessment', 'signal-detection'],
      });

      if (buyingWindow === 'Yes' || score >= 70) {
        hotAccounts.push({
          company: company.company_name || company.name || domain,
          domain,
          score,
          strength,
          action,
        });
      }
    } catch (err) {
      log.error('Signal detection failed', { domain, error: err instanceof Error ? err.message : String(err) });
      // Continue with next company instead of aborting
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
  });

  for (const a of hotAccounts.sort((a, b) => b.score - a.score)) {
    log.info('Hot account', { score: a.score, strength: a.strength, company: a.company, action: a.action });
  }

  return hotAccounts;
}
