/**
 * Task Execution Pipeline
 *
 * Handles the actual execution of workspace tasks picked up by the task executor.
 * Routes tasks to the right handler based on owner, or uses AI interpretation
 * for generic/custom tasks (e.g., "engage this lead for New Year deals").
 *
 * The AI can take 4 actions on any task:
 *   EXECUTE  — do the work (send email, enrich, etc.)
 *   DECLINE  — can't do it, escalate to human with reason
 *   RESCHEDULE — not the right time, push the due date
 *   SKIP     — already done or no longer relevant
 */

import { client, aiOptions } from '../config.js';
import { workspace, type WorkspaceTask } from '../lib/workspace.js';
import { generateOutreachForContact, assembleContext } from './generate-outreach.js';
import { sendAndLog } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { TASK_DECISION_SCHEMA, TASK_DECISION_DEFAULTS } from '../lib/llm-schemas.js';
import { validateEmailHtml } from '../lib/email-html.js';

// ─── Types ─────────────────────────────────────────────────────────

export type TaskDecision = 'execute' | 'decline' | 'reschedule' | 'skip';

export interface TaskResult {
  decision: TaskDecision;
  outcome: string;
  newDueDate?: string;
}

// ─── Pre-flight Check ──────────────────────────────────────────────

/**
 * Before executing any task, check if the lead has blockers
 * (opted out, bounced, critical issues). If so, decline the task.
 */
async function preflight(contactEmail: string): Promise<{ ok: boolean; reason: string }> {
  const [state, issues] = await Promise.all([
    workspace.getSequenceState(contactEmail),
    workspace.getIssues(contactEmail),
  ]);

  if (state.hasOptedOut) return { ok: false, reason: 'Lead has opted out — do not contact.' };
  if (state.lastEngagement === 'bounced') return { ok: false, reason: 'Email bounced — address invalid.' };

  for (const item of issues.data || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('"STATUS":"OPEN"') && content.includes('"SEVERITY":"CRITICAL"')) {
      return { ok: false, reason: 'Critical issue open — see workspace issues.' };
    }
  }

  return { ok: true, reason: '' };
}

// ─── Outreach Task Handler ─────────────────────────────────────────

/**
 * Handles tasks owned by 'outreach-agent'.
 * Reads full workspace context (including past purchases, experiences),
 * generates a personalized email, and sends it.
 */
export async function handleOutreachTask(
  contactEmail: string,
  task: WorkspaceTask,
  dryRun: boolean,
): Promise<TaskResult> {
  // Pre-flight: check for blockers
  const check = await preflight(contactEmail);
  if (!check.ok) {
    return { decision: 'decline', outcome: check.reason };
  }

  // Check if this is a reschedule task (OOO return)
  const isReschedule = task.title.toLowerCase().includes('reschedule');
  if (isReschedule && task.dueDate) {
    const dueTime = new Date(task.dueDate).getTime();
    if (!isNaN(dueTime) && dueTime > Date.now()) {
      return {
        decision: 'reschedule',
        outcome: `Lead is OOO. Will retry after ${task.dueDate}.`,
        newDueDate: task.dueDate,
      };
    }
  }

  // Generate and send the email
  const generated = await generateOutreachForContact(contactEmail, dryRun);
  if (!generated) {
    return { decision: 'decline', outcome: 'Email generation failed — contact may not be qualified or sequence may be complete.' };
  }

  if (!dryRun) {
    await sendAndLog(generated, '');
  }

  // Record in workspace
  await workspace.addMessageSent(contactEmail, {
    channel: 'email',
    subject: generated.subject,
    bodyPreview: generated.bodyText.substring(0, 200),
    step: generated.step,
    angle: generated.angle,
    sentBy: 'task-executor',
    status: dryRun ? 'sent' : 'delivered',
  });

  return {
    decision: 'execute',
    outcome: `Email ${generated.step}/3 ${dryRun ? '(dry run)' : 'sent'}: "${generated.subject}" (angle: ${generated.angle})`,
  };
}

// ─── Generic / Custom Task Handler ─────────────────────────────────

/**
 * Handles tasks that don't match a known owner, or custom human-created tasks
 * like "engage this lead for New Year deals using past purchases".
 *
 * Uses AI to:
 * 1. Read the full workspace context (past experiences, purchases, signals)
 * 2. Evaluate whether the task is actionable by AI
 * 3. Decide: execute, decline, or reschedule
 * 4. If executing: generate the appropriate action (email, note, etc.)
 */
export async function handleGenericTask(
  contactEmail: string,
  task: WorkspaceTask,
  dryRun: boolean,
): Promise<TaskResult> {
  // Pre-flight: check for blockers
  const check = await preflight(contactEmail);
  if (!check.ok) {
    return { decision: 'decline', outcome: check.reason };
  }

  // Assemble full context: governance + contact profile + company + previous outreach
  const context = await assembleContext(contactEmail);

  // Ask AI to evaluate the task and decide what to do
  const evaluation = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `You are a task executor for a sales AI system. A task has been assigned:

TASK TITLE: ${task.title}
TASK DESCRIPTION: ${task.description}
PRIORITY: ${task.priority}
DUE DATE: ${task.dueDate || 'none'}
CREATED BY: ${task.createdBy}

Based on the contact profile, company context, past outreach, and governance rules above, decide what to do.

You MUST output one of these decisions:

DECISION: EXECUTE
Meaning: You have enough context to take action. Generate the deliverable.

DECISION: DECLINE
Meaning: You cannot execute this task. Reasons: not enough data, task requires human judgment, task conflicts with governance rules, contact is not a good fit, etc.

DECISION: RESCHEDULE
Meaning: The task is valid but the timing is wrong. Too soon after last outreach, lead is OOO, or a better window exists.

DECISION: SKIP
Meaning: This task is already done, duplicated, or no longer relevant based on workspace state.

If DECISION is EXECUTE, also include action, subject, body, and angle fields.
If DECISION is RESCHEDULE, include new_due_date in YYYY-MM-DD format.
${buildJsonInstruction(TASK_DECISION_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(evaluation.data || '');
  const { data: parsed } = parseLLMJson(output, TASK_DECISION_SCHEMA, TASK_DECISION_DEFAULTS);

  const decision = parsed.decision.toLowerCase() as TaskDecision;
  const reason = parsed.reason;
  const newDueDate = parsed.new_due_date;

  if (decision === 'decline') {
    return { decision: 'decline', outcome: reason };
  }

  if (decision === 'reschedule') {
    return {
      decision: 'reschedule',
      outcome: reason,
      newDueDate: newDueDate !== 'N/A' ? newDueDate : undefined,
    };
  }

  if (decision === 'skip') {
    return { decision: 'skip', outcome: reason };
  }

  // EXECUTE — use parsed action fields
  const action = parsed.action;
  const subject = parsed.subject;
  const body = parsed.body;
  const angle = parsed.angle;

  if (action === 'send_email' && subject && body) {
    // Sanitize AI-generated HTML
    const htmlResult = validateEmailHtml(`<p>${body.replace(/\n/g, '</p><p>')}</p>`);

    if (!dryRun) {
      await sendAndLog({
        email: contactEmail,
        step: 0, // custom task, not part of sequence
        subject,
        bodyHtml: htmlResult.sanitized,
        bodyText: body,
        angle,
      }, '');
    }

    await workspace.addMessageSent(contactEmail, {
      channel: 'email',
      subject,
      bodyPreview: body.substring(0, 200),
      step: 0,
      angle,
      sentBy: 'task-executor',
      status: dryRun ? 'sent' : 'delivered',
    });

    return {
      decision: 'execute',
      outcome: `Email ${dryRun ? '(dry run)' : 'sent'}: "${subject}" — ${reason}`,
    };
  }

  if (action === 'notify_slack') {
    await notifySlack(`*Task Executor*\nContact: ${contactEmail}\nTask: ${task.title}\n${body || reason}`);
    return { decision: 'execute', outcome: `Slack notification sent: ${reason}` };
  }

  // Default: add a note with the AI's output
  await workspace.addNote(contactEmail, {
    author: 'task-executor',
    content: `Task: ${task.title}\n${body || reason}`,
    category: 'analysis',
  });

  return { decision: 'execute', outcome: `Note added: ${reason}` };
}

// ─── Master Router ─────────────────────────────────────────────────

/**
 * Routes a task to the right handler and handles the result:
 * - EXECUTE → marks done with outcome
 * - DECLINE → declines with reason, escalates to human
 * - RESCHEDULE → records new due date
 * - SKIP → marks as completed (already done)
 */
export async function executeTask(
  contactEmail: string,
  task: WorkspaceTask,
  dryRun: boolean,
): Promise<TaskResult> {
  let result: TaskResult;

  // Route by owner
  switch (task.owner) {
    case 'outreach-agent':
      result = await handleOutreachTask(contactEmail, task, dryRun);
      break;
    default:
      result = await handleGenericTask(contactEmail, task, dryRun);
      break;
  }

  // Act on the decision
  switch (result.decision) {
    case 'execute':
      await workspace.completeTask(contactEmail, task.title, result.outcome);
      await workspace.addUpdate(contactEmail, {
        author: 'task-executor',
        type: 'system',
        summary: `Task completed: "${task.title}" — ${result.outcome}`,
      });
      break;

    case 'decline':
      await workspace.declineTask(contactEmail, task.title, result.outcome, task.owner);
      await notifySlack(
        `*Task Declined*\nContact: ${contactEmail}\nTask: ${task.title}\nReason: ${result.outcome}\nEscalated to sales rep.`
      );
      break;

    case 'reschedule':
      await workspace.rescheduleTask(
        contactEmail,
        task.title,
        result.newDueDate || new Date(Date.now() + 7 * 86400_000).toISOString(),
        result.outcome,
        task.owner,
      );
      // Re-create the task with the new due date
      await workspace.addTask(contactEmail, {
        ...task,
        dueDate: result.newDueDate || new Date(Date.now() + 7 * 86400_000).toISOString(),
      });
      break;

    case 'skip':
      await workspace.completeTask(contactEmail, task.title, `Skipped: ${result.outcome}`);
      await workspace.addUpdate(contactEmail, {
        author: 'task-executor',
        type: 'system',
        summary: `Task skipped: "${task.title}" — ${result.outcome}`,
      });
      break;
  }

  return result;
}
