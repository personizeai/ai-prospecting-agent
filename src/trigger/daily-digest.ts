import { schedules } from "@trigger.dev/sdk/v3";
import { collectDailyMetrics } from '../lib/metrics.js';
import { runHealthCheck } from '../lib/health.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';

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

    // ─── Assemble Full Message ─────────────────────────────────────
    const message = [
      `\uD83D\uDCCA *Prospecting Agent \u2014 Daily Report*`,
      ``,
      outreachSection,
      ``,
      pipelineSection,
      ``,
      healthSection,
      attentionSection,
    ].join('\n');

    await notifySlack(message);

    return { metrics, health };
  },
});
