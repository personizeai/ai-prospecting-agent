import { schedules } from "@trigger.dev/sdk/v3";
import { runHealthCheck } from '../lib/health.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';

// Runs every 15 minutes
export const healthCheckTask = schedules.task({
  id: "health-check",
  cron: "*/15 * * * *",
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("health-check", ctx.run.id, error);
  },
  run: async () => {
    const result = await runHealthCheck();

    if (result.status === 'healthy') {
      return { status: result.status, alerted: false };
    }

    // Build alert message with failing checks
    const statusEmoji = result.status === 'unhealthy' ? '\u274C' : '\u26A0\uFE0F';
    const statusLabel = result.status === 'unhealthy' ? 'UNHEALTHY' : 'DEGRADED';

    const failingChecks = Object.entries(result.checks)
      .filter(([, check]) => check.status !== 'ok')
      .map(([name, check]) => `• ${name}: ${check.status}${check.detail ? ` — ${check.detail}` : ''}`)
      .join('\n');

    const message = [
      `${statusEmoji} *Prospecting Agent — Health Alert: ${statusLabel}*`,
      ``,
      `*Failing Checks:*`,
      failingChecks,
      ``,
      `_Checked at ${result.timestamp}_`,
    ].join('\n');

    await notifySlack(message);

    return { status: result.status, alerted: true, checks: result.checks };
  },
});
