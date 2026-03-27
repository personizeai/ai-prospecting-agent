import { schedules } from "@trigger.dev/sdk/v3";
import { detectAndScoreSignalsDetailed } from '../pipelines/detect-signals.js';
import { sourceContactsForHotAccounts } from '../pipelines/source-contacts.js';
import { researchHotAccounts } from '../pipelines/research-company.js';
import { evaluateAccountStrategies } from '../pipelines/account-strategy.js';
import { SIGNAL_CONFIG, ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { discoverContactsTask } from './discover-contacts.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

// Runs every morning at 8am UTC — scores accounts, researches, and discovers contacts
export const signalDetectionTask = schedules.task({
  id: "signal-detection",
  cron: "0 8 * * 1-5", // 8am UTC, Mon-Fri (adjust to your timezone)
  retry: { maxAttempts: 3, minTimeoutInMs: 30_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("signal-detection", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "signal-detection" }, async () => {
      const summary = await detectAndScoreSignalsDetailed();
      const hotAccounts = summary.hotAccounts;

      if (hotAccounts.length) {
        // 1. Web research — Tavily search for news, funding, hiring signals
        if (SIGNAL_CONFIG.autoResearchHotAccounts) {
          logger.info('Researching hot accounts via Tavily', { count: hotAccounts.length });
          const researchResult = await researchHotAccounts(hotAccounts);
          logger.info('Research complete', { companiesResearched: researchResult.companiesResearched, totalSignals: researchResult.totalSignals });
        }

        // 2. Contact discovery — Apollo search + enrichment
        if (SIGNAL_CONFIG.autoDiscoverContacts) {
          await discoverContactsTask.trigger({ hotAccounts });
          logger.info('Triggered discover-contacts for hot accounts', { count: hotAccounts.length });
        }

        // 3. AI sourcing plan (generates targeting strategy in memory)
        await sourceContactsForHotAccounts(hotAccounts);

        // 4. Account strategy evaluation — coordinate across contacts at each account
        if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
          logger.info('Evaluating account strategies', { count: hotAccounts.length });
          const strategyResults = await evaluateAccountStrategies(
            hotAccounts.map((a) => ({ domain: a.domain, company: a.company })),
            ACCOUNT_STRATEGY_CONFIG.maxAccountsPerRun,
          );
          logger.info('Account strategies complete', {
            evaluated: strategyResults.length,
            blocked: strategyResults.filter((r) => r.health === 'blocked').length,
            atRisk: strategyResults.filter((r) => r.health === 'at_risk').length,
          });
        }
      }

      return {
        hotAccounts: hotAccounts.length,
        totalCompanies: summary.total,
        scoredCompanies: summary.scored,
        skippedCompanies: summary.skipped,
        skipReasons: summary.skipReasons,
        companyResults: summary.companyResults,
        timestamp: new Date().toISOString(),
      };
    });
  },
});
