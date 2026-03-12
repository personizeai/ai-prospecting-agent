import { schedules, task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { workspace } from '../lib/workspace.js';
import { executeTask } from '../pipelines/execute-task.js';
import { TASK_EXECUTOR_CONFIG } from '../config/prospecting.config.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

// ─── Scheduled Parent: Poll for Pending Tasks ────────────────────

export const taskExecutorScheduler = schedules.task({
  id: "task-executor",
  cron: "*/30 * * * *", // every 30 minutes
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("task-executor", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "task-executor" }, async () => {
      // Recall all pending workspace tasks globally
      const pendingTasks = await workspace.getAllPendingTasks(TASK_EXECUTOR_CONFIG.maxTasksPerRun * 2);

      let queued = 0;

      for (const item of pendingTasks.data || []) {
        if (queued >= TASK_EXECUTOR_CONFIG.maxTasksPerRun) break;

        const content = item.content || '';
        let parsed: any;

        try {
          parsed = JSON.parse(content);
        } catch {
          continue; // Not a JSON task — skip
        }

        // Only pick up pending tasks
        if (parsed.status !== 'pending') continue;

        // Only pick up tasks owned by AI agents (not sales-rep)
        const owner = parsed.owner || '';
        const isActionable = TASK_EXECUTOR_CONFIG.actionableOwners.includes(owner);
        const isGeneric = TASK_EXECUTOR_CONFIG.enableGenericTaskHandler && owner && owner !== 'sales-rep';
        if (!isActionable && !isGeneric) continue;

        // Skip stale tasks
        if (parsed.timestamp && TASK_EXECUTOR_CONFIG.maxTaskAgeDays > 0) {
          const taskAge = Date.now() - new Date(parsed.timestamp).getTime();
          const maxAge = TASK_EXECUTOR_CONFIG.maxTaskAgeDays * 86400_000;
          if (taskAge > maxAge) continue;
        }

        // Check if this task was already executed (completion record exists)
        const completionCheck = await client.memory.recall({
          message: `task_completion "${parsed.title}" completed`,
          email: (item as any).email,
          limit: 3,
        });

        let alreadyDone = false;
        for (const c of completionCheck.data || []) {
          try {
            const cp = JSON.parse(c.content || '');
            if (cp.type === 'task_completion' && cp.taskTitle === parsed.title) {
              alreadyDone = true;
              break;
            }
            if (cp.type === 'task_declined' && cp.taskTitle === parsed.title) {
              alreadyDone = true;
              break;
            }
            if (cp.type === 'task_rescheduled' && cp.taskTitle === parsed.title) {
              alreadyDone = true;
              break;
            }
          } catch {
            // Not JSON — skip
          }
        }

        if (alreadyDone) continue;

        // Extract contact email from the memory item
        const contactEmail = (item as any).email;
        if (!contactEmail) continue;

        // Trigger the child task
        await executeWorkspaceTask.trigger({
          contactEmail,
          task: {
            title: parsed.title,
            description: parsed.description,
            status: parsed.status,
            owner: parsed.owner,
            createdBy: parsed.createdBy,
            priority: parsed.priority,
            dueDate: parsed.dueDate,
          },
        });

        queued++;
      }

      return { tasksQueued: queued, timestamp: new Date().toISOString() };
    });
  },
});

// ─── Child Task: Execute a Single Workspace Task ─────────────────

const executeWorkspaceTask = task({
  id: "execute-workspace-task",
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000 },
  queue: {
    concurrencyLimit: TASK_EXECUTOR_CONFIG.concurrencyLimit,
  },
  onFailure: async (payload, error, { ctx }) => {
    // On failure, decline the task so it doesn't retry forever
    try {
      await workspace.declineTask(
        payload.contactEmail,
        payload.task.title,
        `Execution failed after retries: ${error instanceof Error ? error.message : String(error)}`,
        payload.task.owner,
      );
    } catch {
      // Best effort
    }
    await reportFailure(`execute-workspace-task (${payload.contactEmail}: ${payload.task.title})`, ctx.run.id, error);
  },
  run: async (payload: { contactEmail: string; task: import('../lib/workspace.js').WorkspaceTask }, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "execute-workspace-task" }, async () => {
      const dryRun = process.env.DRY_RUN !== 'false';

      if (dryRun) {
        logger.info('[DRY RUN] Executing task', { contactEmail: payload.contactEmail, taskTitle: payload.task.title });
      }

      // Mark as in-progress in timeline
      await workspace.addUpdate(payload.contactEmail, {
        author: 'task-executor',
        type: 'system',
        summary: `Picking up task: "${payload.task.title}"`,
      });

      const result = await executeTask(payload.contactEmail, payload.task, dryRun);

      logger.info('Task execution complete', { contactEmail: payload.contactEmail, decision: result.decision, outcome: result.outcome });

      return {
        contactEmail: payload.contactEmail,
        task: payload.task.title,
        decision: result.decision,
        outcome: result.outcome,
        dryRun,
      };
    });
  },
});
