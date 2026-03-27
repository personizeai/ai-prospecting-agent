import { schedules, task } from "@trigger.dev/sdk/v3";
import { workspace } from '../lib/workspace.js';
import { executeTask } from '../pipelines/execute-task.js';
import { TASK_EXECUTOR_CONFIG } from '../config/prospecting.config.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';
import type { WorkspaceTask } from '../lib/workspace.js';

type ExecuteWorkspaceTaskPayload = {
  contactEmail: string;
  taskId: string;
  task: WorkspaceTask;
};

// ─── Scheduled Parent: Poll for Pending Tasks ────────────────────

export const taskExecutorScheduler = schedules.task({
  id: "task-executor",
  cron: "*/30 * * * *", // every 30 minutes
  retry: { maxAttempts: 2 },
  onFailure: async ({ error, ctx }: any) => {
    await reportFailure("task-executor", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "task-executor" }, async () => {
      // Query all contacts with pending tasks via filterByProperty (deterministic, no LLM cost)
      const pendingResult = await workspace.getAllPendingTasks(TASK_EXECUTOR_CONFIG.maxTasksPerRun * 2);

      let queued = 0;

      for (const record of pendingResult.records || []) {
        if (queued >= TASK_EXECUTOR_CONFIG.maxTasksPerRun) break;

        const contactEmail = record.recordId;
        if (!contactEmail) continue;

        // Read the pending_tasks property directly from matched properties
        const tasks = record.matchedProperties?.pending_tasks;
        if (!Array.isArray(tasks)) continue;

        for (const t of tasks) {
          if (queued >= TASK_EXECUTOR_CONFIG.maxTasksPerRun) break;

          // Only pick up tasks owned by AI agents (not sales-rep)
          const owner = t.owner || '';
          const isActionable = TASK_EXECUTOR_CONFIG.actionableOwners.includes(owner);
          const isGeneric = TASK_EXECUTOR_CONFIG.enableGenericTaskHandler && owner && owner !== 'sales-rep';
          if (!isActionable && !isGeneric) continue;

          // Skip stale tasks
          if (t.createdAt && TASK_EXECUTOR_CONFIG.maxTaskAgeDays > 0) {
            const taskAge = Date.now() - new Date(t.createdAt).getTime();
            const maxAge = TASK_EXECUTOR_CONFIG.maxTaskAgeDays * 86400_000;
            if (taskAge > maxAge) continue;
          }

          // No dedup check needed — completed tasks are removed from pending_tasks

          // Trigger the child task
          await executeWorkspaceTask.trigger({
            contactEmail,
            taskId: t.taskId,
            task: {
              title: t.title,
              description: t.description,
              status: 'pending',
              owner: t.owner,
              createdBy: t.createdBy,
              priority: t.priority,
              dueDate: t.dueDate,
            },
          });

          queued++;
        }
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
  onFailure: async ({ payload, error, ctx }: any) => {
    // On failure, decline the task so it doesn't retry forever
    try {
      await workspace.declineTask(
        payload.contactEmail,
        payload.taskId,
        `Execution failed after retries: ${error instanceof Error ? error.message : String(error)}`,
        payload.task.owner,
      );
    } catch {
      // Best effort
    }
    await reportFailure(`execute-workspace-task (${payload.contactEmail}: ${payload.task.title})`, ctx.run.id, error);
  },
  run: async (payload: ExecuteWorkspaceTaskPayload, { ctx }) => {
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

      const result = await executeTask(payload.contactEmail, payload.task, dryRun, payload.taskId);

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
