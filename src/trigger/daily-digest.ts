import { schedules } from "@trigger.dev/sdk/v3";
import { collectDailyMetrics } from '../lib/metrics.js';
import { runHealthCheck } from '../lib/health.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';
import { campaigns } from '../lib/campaign.js';
import { memoryCrud } from '../lib/personize-crud.js';
import { logger } from '../lib/logger.js';

// Runs every weekday at 9am UTC
export const dailyDigestTask = schedules.task({
  id: "daily-digest",
  cron: "0 9 * * 1-5",
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("daily-digest", ctx.run.id, error);
  },
  run: async () => {
    const [metrics, health] = await Promise.all([
      collectDailyMetrics(),
      runHealthCheck(),
    ]);

    // ─── Build Outreach Section ────────────────────────────────────
    const stepBreakdown = Object.entries(metrics.outreach.byStep)
      .map(([step, count]) => `${count} ${step}`)
      .join(', ');

    const sentimentBreakdown = Object.entries(metrics.replies.bySentiment)
      .map(([sentiment, count]) => `${count} ${sentiment}`)
      .join(', ');

    const outreachSection = [
      `*Outreach*`,
      `• Emails sent: ${metrics.outreach.emailsSent}${stepBreakdown ? ` (${stepBreakdown})` : ''}`,
      `• Replies: ${metrics.replies.total}${sentimentBreakdown ? ` (${sentimentBreakdown})` : ''}`,
      `• Sequences completed: ${metrics.outreach.sequencesCompleted}`,
      `• Opted out: ${metrics.outreach.optedOut}`,
    ].join('\n');

    // ─── Build Pipeline Section ────────────────────────────────────
    const pipelineSection = [
      `*Pipeline Activity*`,
      `• Signals detected: ${metrics.pipeline.signalsDetected}`,
      `• Contacts enriched: ${metrics.pipeline.contactsEnriched}`,
      `• Companies researched: ${metrics.pipeline.companiesResearched}`,
    ].join('\n');

    // ─── Build Health Section ──────────────────────────────────────
    const statusEmoji = (s: string) => {
      if (s === 'ok') return '\u2705';
      if (s === 'error') return '\u274C';
      return '\u26A0\uFE0F';
    };

    const personizeCheck = health.checks['personize'];
    const gmailCheck = health.checks['gmail'];
    const apolloCheck = health.checks['apollo'];
    const tavilyCheck = health.checks['tavily'];
    const hubspotCheck = health.checks['hubspot'];

    const healthSection = [
      `*Pipeline Health*`,
      `• Personize: ${statusEmoji(personizeCheck?.status ?? 'unknown')} (${personizeCheck?.latency_ms ?? '?'}ms)`,
      `• Gmail capacity: ${metrics.capacity.gmailRemaining}/${metrics.capacity.gmailTotal} remaining`,
      `• Apollo: ${statusEmoji(apolloCheck?.status ?? 'unknown')} ${apolloCheck?.detail ?? 'Unknown'}`,
      `• Tavily: ${statusEmoji(tavilyCheck?.status ?? 'unknown')} ${tavilyCheck?.detail ?? 'Unknown'}`,
      `• HubSpot: ${statusEmoji(hubspotCheck?.status ?? 'unknown')} ${hubspotCheck?.detail ?? 'Unknown'}`,
    ].join('\n');

    // ─── Build Needs Attention Section ─────────────────────────────
    let attentionSection = '';
    if (metrics.needsAttention.length > 0) {
      const priorityEmoji = (p: string) => (p === 'high' ? '\uD83D\uDD34' : '\uD83D\uDFE1');
      const items = metrics.needsAttention
        .map((item) => `• ${priorityEmoji(item.priority)} ${item.description}`)
        .join('\n');
      attentionSection = `\n\n*Needs Your Attention*\n${items}`;
    }

    // ─── Campaign Health + Auto-Pause ──────────────────────────────
    let campaignSection = '';
    try {
      const activeCampaigns = await campaigns.listActive();
      if (activeCampaigns.length > 0) {
        const campaignLines: string[] = ['', '*Campaigns*'];
        for (const camp of activeCampaigns) {
          const stats = await campaigns.getStats(camp.campaignId);
          const reached = stats.contacts_reached;
          const replyRate = reached > 0 ? Math.round((stats.replies / reached) * 100) : 0;
          const positiveRate = reached > 0 ? Math.round((stats.positive_replies / reached) * 100) : 0;

          const icon = replyRate >= 10 ? '\u2705' : replyRate >= 3 ? '\uD83D\uDFE1' : reached > 20 ? '\uD83D\uDD34' : '\u26AA';
          campaignLines.push(`• ${icon} ${camp.name}: ${reached} reached, ${stats.replies} replies (${replyRate}%), ${stats.positive_replies} positive (${positiveRate}%)`);

          // Auto-pause underperforming campaigns (50+ reached, <1% reply rate)
          if (reached >= 50 && replyRate < 1) {
            await memoryCrud.update({
              recordId: camp.campaignId,
              type: 'Campaign',
              propertyName: 'status',
              propertyValue: 'Paused',
              updatedBy: 'auto-pause',
            });
            campaignLines.push(`  \u26A0\uFE0F AUTO-PAUSED: reply rate ${replyRate}% after ${reached} contacts (threshold: 1%)`);
            metrics.needsAttention.push({
              type: 'campaign_auto_paused',
              description: `Campaign "${camp.name}" auto-paused: ${replyRate}% reply rate after ${reached} contacts`,
              priority: 'high',
            });
            logger.warn('Campaign auto-paused', { campaignId: camp.campaignId, replyRate, reached });
          }

          // Daily stats snapshot (time series)
          const today = new Date().toISOString().split('T')[0];
          await (await import('../config.js')).client.memory.memorize({
            email: camp.campaignId,
            collectionName: 'campaigns',
            content: `[DAILY SNAPSHOT ${today}] ${camp.name}: ${reached} reached, ${stats.emails_sent} sent, ${stats.replies} replies (${replyRate}%), ${stats.positive_replies} positive`,
            tags: ['campaign-snapshot', camp.campaignId, today],
            enhanced: false,
          });
        }
        campaignSection = campaignLines.join('\n');
      }
    } catch (err) {
      logger.warn('Campaign health check failed', { error: (err as Error).message });
    }

    // ─── Assemble Full Message ─────────────────────────────────────
    const message = [
      `\uD83D\uDCCA *Prospecting Agent \u2014 Daily Report*`,
      ``,
      outreachSection,
      ``,
      pipelineSection,
      ``,
      healthSection,
      campaignSection,
      attentionSection,
    ].join('\n');

    await notifySlack(message);

    // Memorize daily brief to Personize so Claude can read it at conversation start
    try {
      await (await import('../config.js')).client.memory.memorize({
        content: `[DAILY BRIEF ${new Date().toISOString().split('T')[0]}]\n${message}`,
        collectionName: 'system-logs',
        tags: ['daily-brief'],
        enhanced: false,
      });
    } catch {
      // Non-fatal — Slack notification already sent
    }

    return { metrics, health };
  },
});
