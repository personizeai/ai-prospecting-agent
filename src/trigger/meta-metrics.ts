/**
 * Meta-Metrics Scheduler — Collects structured strategy metrics daily.
 *
 * Runs at 6am UTC (before the strategy review) and aggregates data
 * from both Revenue OS and Content OS into Personize memory.
 *
 * The meta-agent (strategy review skill) reads this data to make
 * optimization proposals.
 */

import { schedules } from "@trigger.dev/sdk/v3";
import { collectStrategyMetrics } from '../pipelines/meta-metrics.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

export const metaMetricsTask = schedules.task({
  id: "meta-metrics",
  cron: "0 6 * * 1-5", // 6am UTC, Mon-Fri (before strategy review)
  retry: { maxAttempts: 2, minTimeoutInMs: 30_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("meta-metrics", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "meta-metrics" }, async () => {
      const metrics = await collectStrategyMetrics();

      return {
        period: metrics.period,
        emailsSent: metrics.revenueOS.daily.emailsSent,
        replyRate: metrics.revenueOS.daily.replyRate,
        anglesTracked: metrics.revenueOS.anglePerformance.length,
        topAngle: metrics.revenueOS.topPerformingAngle,
        contentPosts: metrics.contentOS.totalPosts,
        contentViews: metrics.contentOS.totalViews,
        crossSignals: metrics.crossSignals.topicsFromReplies.length,
        timestamp: metrics.collectedAt,
      };
    });
  },
});
