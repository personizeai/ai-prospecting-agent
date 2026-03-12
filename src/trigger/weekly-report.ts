import { schedules } from "@trigger.dev/sdk/v3";
import { generateWeeklyReport } from '../pipelines/weekly-report.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';

// Runs every Friday at 4pm UTC
export const weeklyReportTask = schedules.task({
  id: "weekly-report",
  cron: "0 16 * * 5", // 4pm UTC, Fridays
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("weekly-report", ctx.run.id, error);
  },
  run: async () => {
    const report = await generateWeeklyReport();

    await notifySlack(`*Weekly Prospecting Report*\n\n${report}`);

    return { report };
  },
});
