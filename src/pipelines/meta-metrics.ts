/**
 * Meta-Metrics Pipeline — Structured daily metrics for the strategy meta-agent.
 *
 * Aggregates data from:
 *   - Revenue OS: outreach-log (angle attribution), workspace state, reply sentiment
 *   - Content OS: CMS analytics (via Personize memory, synced by performance-tracker)
 *
 * Output: A structured StrategyMetrics object stored in Personize memory,
 * queryable by the meta-agent for optimization decisions.
 *
 * Usage:
 *   import { collectStrategyMetrics } from '../pipelines/meta-metrics.js';
 *   const metrics = await collectStrategyMetrics();
 */

import { client } from '../config.js';
import { memory } from '../lib/memory.js';
import { collectDailyMetrics } from '../lib/metrics.js';
import { memoryCrud } from '../lib/personize-crud.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'meta-metrics' });

// ─── Types ──────────────────────────────────────────────────────────

export interface AnglePerformance {
  angle: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  positiveReplies: number;
  negativeReplies: number;
  openRate: number;
  replyRate: number;
  positiveReplyRate: number;
}

export interface SegmentPerformance {
  segment: string;
  contacts: number;
  emailsSent: number;
  replies: number;
  positiveReplies: number;
  replyRate: number;
}

export interface ContentPerformance {
  totalPosts: number;
  totalViews: number;
  avgViewsPerPost: number;
  topTopics: Array<{ title: string; views: number; viewsPerDay: number }>;
  underperforming: Array<{ title: string; views: number; ageDays: number }>;
}

export interface StrategyMetrics {
  period: string;
  collectedAt: string;

  revenueOS: {
    daily: {
      emailsSent: number;
      replyRate: number;
      positiveReplyRate: number;
      repliesByType: Record<string, number>;
      sequencesCompleted: number;
      optedOut: number;
    };
    anglePerformance: AnglePerformance[];
    topPerformingAngle: string | null;
    worstPerformingAngle: string | null;
    senderHealth: Record<string, string>;
  };

  contentOS: ContentPerformance;

  crossSignals: {
    /** Topics mentioned in positive outreach replies — potential content ideas. */
    topicsFromReplies: string[];
    /** High-performing content topics that could inform outreach angles. */
    topContentTopics: string[];
  };
}

// ─── Angle Attribution Metrics ──────────────────────────────────────

async function collectAngleMetrics(): Promise<AnglePerformance[]> {
  const angleMap = new Map<string, {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    positiveReplies: number;
    negativeReplies: number;
  }>();

  try {
    // Query outreach-log records for angle data
    const outreachLogs = await client.memory.recall({
      message: 'outreach sent angle reply opened clicked',
      limit: 200,
    });

    for (const record of outreachLogs.data || []) {
      const content = (record as any).content || '';
      const props = (record as any).properties || {};

      // Extract angle from tags or content
      const angleProp = props.angle_used?.value;
      if (!angleProp) continue;

      if (!angleMap.has(angleProp)) {
        angleMap.set(angleProp, { sent: 0, opened: 0, clicked: 0, replied: 0, positiveReplies: 0, negativeReplies: 0 });
      }

      const stats = angleMap.get(angleProp)!;

      if (content.includes('[OUTREACH SENT]')) stats.sent++;
      if (props.opened?.value === true) stats.opened++;
      if (props.clicked?.value === true) stats.clicked++;
      if (props.replied?.value === true) {
        stats.replied++;
        const sentiment = String(props.reply_sentiment?.value || '').toLowerCase();
        if (sentiment === 'positive') stats.positiveReplies++;
        if (sentiment === 'negative') stats.negativeReplies++;
      }
    }
  } catch (err) {
    log.warn('Failed to collect angle metrics', { error: (err as Error).message });
  }

  return Array.from(angleMap.entries()).map(([angle, stats]) => ({
    angle,
    ...stats,
    openRate: stats.sent > 0 ? stats.opened / stats.sent : 0,
    replyRate: stats.sent > 0 ? stats.replied / stats.sent : 0,
    positiveReplyRate: stats.sent > 0 ? stats.positiveReplies / stats.sent : 0,
  }));
}

// ─── Content Performance (from synced CMS analytics) ────────────────

async function collectContentMetrics(): Promise<ContentPerformance> {
  try {
    const performanceData = await client.memory.recall({
      message: 'blog post performance views per day published',
      limit: 100,
    });

    const posts: Array<{ title: string; views: number; viewsPerDay: number; ageDays: number }> = [];

    for (const record of performanceData.data || []) {
      const content = (record as any).content || '';
      if (!content.includes('[PERFORMANCE]')) continue;

      const props = (record as any).properties || {};
      const titleMatch = content.match(/"([^"]+)"/);

      posts.push({
        title: titleMatch?.[1] || 'Unknown',
        views: Number(props.views?.value) || 0,
        viewsPerDay: Number(props.views_per_day?.value) || 0,
        ageDays: Number(props.age_days?.value) || 0,
      });
    }

    const totalViews = posts.reduce((sum, p) => sum + p.views, 0);
    const sorted = [...posts].sort((a, b) => b.viewsPerDay - a.viewsPerDay);

    return {
      totalPosts: posts.length,
      totalViews,
      avgViewsPerPost: posts.length > 0 ? totalViews / posts.length : 0,
      topTopics: sorted.slice(0, 5).map(p => ({ title: p.title, views: p.views, viewsPerDay: p.viewsPerDay })),
      underperforming: posts
        .filter(p => p.ageDays > 14 && p.viewsPerDay < (totalViews / posts.length / 2))
        .sort((a, b) => a.viewsPerDay - b.viewsPerDay)
        .slice(0, 5),
    };
  } catch (err) {
    log.warn('Failed to collect content metrics', { error: (err as Error).message });
    return { totalPosts: 0, totalViews: 0, avgViewsPerPost: 0, topTopics: [], underperforming: [] };
  }
}

// ─── Cross-Signal Detection ─────────────────────────────────────────

async function detectCrossSignals(): Promise<StrategyMetrics['crossSignals']> {
  const topicsFromReplies: string[] = [];
  const topContentTopics: string[] = [];

  try {
    // Find topics/themes mentioned in positive reply analyses
    const replyNotes = await client.memory.recall({
      message: 'positive reply analysis key points topics mentioned interested',
      limit: 50,
    });

    for (const record of replyNotes.data || []) {
      const content = String((record as any).content || '');
      if (content.toLowerCase().includes('positive') || content.toLowerCase().includes('interested')) {
        // Extract key phrases (simple heuristic — the meta-agent will do deeper analysis)
        const keyPointsMatch = content.match(/key\s*points?:\s*(.+)/i);
        if (keyPointsMatch) {
          topicsFromReplies.push(keyPointsMatch[1].trim().substring(0, 200));
        }
      }
    }

    // Find top content topics (from CMS analytics already synced)
    const topContent = await client.memory.recall({
      message: 'blog post high performance views popular',
      limit: 10,
    });

    for (const record of topContent.data || []) {
      const content = String((record as any).content || '');
      const titleMatch = content.match(/"([^"]+)"/);
      if (titleMatch) {
        topContentTopics.push(titleMatch[1]);
      }
    }
  } catch (err) {
    log.warn('Failed to detect cross signals', { error: (err as Error).message });
  }

  return {
    topicsFromReplies: [...new Set(topicsFromReplies)].slice(0, 10),
    topContentTopics: [...new Set(topContentTopics)].slice(0, 10),
  };
}

// ─── Main Collection Function ───────────────────────────────────────

/**
 * Collect all strategy metrics from both Revenue OS and Content OS.
 * Returns a structured object and stores it in Personize memory.
 */
export async function collectStrategyMetrics(): Promise<StrategyMetrics> {
  log.info('Collecting strategy metrics');

  // Run all collections in parallel
  const [dailyMetrics, anglePerformance, contentMetrics, crossSignals] = await Promise.all([
    collectDailyMetrics(),
    collectAngleMetrics(),
    collectContentMetrics(),
    detectCrossSignals(),
  ]);

  // Find best/worst angles
  const anglesWithData = anglePerformance.filter(a => a.sent >= 3); // Min 3 sends for significance
  const topAngle = anglesWithData.length > 0
    ? anglesWithData.reduce((best, a) => a.positiveReplyRate > best.positiveReplyRate ? a : best)
    : null;
  const worstAngle = anglesWithData.length > 0
    ? anglesWithData.reduce((worst, a) => a.positiveReplyRate < worst.positiveReplyRate ? a : worst)
    : null;

  const totalSent = dailyMetrics.outreach.emailsSent || 1; // Avoid div by zero

  const metrics: StrategyMetrics = {
    period: new Date().toISOString().split('T')[0],
    collectedAt: new Date().toISOString(),

    revenueOS: {
      daily: {
        emailsSent: dailyMetrics.outreach.emailsSent,
        replyRate: dailyMetrics.replies.total / totalSent,
        positiveReplyRate: (dailyMetrics.replies.bySentiment['positive'] || 0) / totalSent,
        repliesByType: dailyMetrics.replies.bySentiment,
        sequencesCompleted: dailyMetrics.outreach.sequencesCompleted,
        optedOut: dailyMetrics.outreach.optedOut,
      },
      anglePerformance,
      topPerformingAngle: topAngle?.angle || null,
      worstPerformingAngle: worstAngle?.angle || null,
      senderHealth: {}, // TODO: wire into sender-profiles health data
    },

    contentOS: contentMetrics,
    crossSignals,
  };

  // Store in Personize for the meta-agent to query
  try {
    await memory.save({
      email: `strategy-metrics-${metrics.period}`,
      content: [
        `[STRATEGY METRICS] ${metrics.period}`,
        `Revenue OS: ${metrics.revenueOS.daily.emailsSent} emails, ${(metrics.revenueOS.daily.replyRate * 100).toFixed(1)}% reply rate`,
        metrics.revenueOS.topPerformingAngle ? `Top angle: "${metrics.revenueOS.topPerformingAngle}"` : '',
        metrics.revenueOS.worstPerformingAngle ? `Worst angle: "${metrics.revenueOS.worstPerformingAngle}"` : '',
        `Content OS: ${metrics.contentOS.totalPosts} posts, ${metrics.contentOS.totalViews} total views`,
        metrics.crossSignals.topicsFromReplies.length > 0
          ? `Cross-signals: Reply topics → ${metrics.crossSignals.topicsFromReplies.slice(0, 3).join(', ')}`
          : '',
      ].filter(Boolean).join('\n'),
      tags: ['strategy-metrics', metrics.period],
    });

    log.info('Strategy metrics collected and stored', {
      period: metrics.period,
      emailsSent: metrics.revenueOS.daily.emailsSent,
      anglesTracked: metrics.revenueOS.anglePerformance.length,
      contentPosts: metrics.contentOS.totalPosts,
    });
  } catch (err) {
    log.warn('Failed to store strategy metrics (non-fatal)', { error: (err as Error).message });
  }

  return metrics;
}
