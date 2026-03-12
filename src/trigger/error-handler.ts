import { task } from "@trigger.dev/sdk/v3";
import { notifySlack } from '../delivery/slack-notify.js';
import { logger } from '../lib/logger.js';

/** Global failure handler — wired via onFailure on all other tasks. */
export const errorAlertTask = task({
  id: "error-alert",
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000 },
  run: async ({ taskId, error, runId }: { taskId: string; error: string; runId: string }) => {
    await notifySlack(
      `*Pipeline Error*\nTask: \`${taskId}\`\nRun: \`${runId}\`\nError: ${error}`
    );
    return { alerted: true };
  },
});

/** Call this from any task's onFailure callback. */
export async function reportFailure(taskId: string, runId: string, error: unknown) {
  try {
    await errorAlertTask.trigger({
      taskId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch (err) {
    logger.error('Failed to trigger error alert', { error: err instanceof Error ? err.message : String(err) });
  }
}
