/**
 * Lead Workspace Helpers
 *
 * Convenience functions for contributing to and reading from lead workspaces.
 * Every function follows the collaboration pattern:
 *   memorize() with structured JSON + workspace tags + source attribution
 *
 * Usage:
 *   import { workspace } from '../lib/workspace.js';
 *   await workspace.addUpdate(email, { ... });
 *   await workspace.addMessageSent(email, { ... });
 *   const digest = await workspace.getDigest(email);
 */

import { client } from '../config.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface WorkspaceUpdate {
  author: string;
  type: 'enrichment' | 'signal' | 'outreach' | 'engagement' | 'system' | 'human';
  summary: string;
  details?: string;
}

export interface WorkspaceTask {
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  owner: string;
  createdBy: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  outcome?: string;
}

export interface WorkspaceNote {
  author: string;
  content: string;
  category: 'observation' | 'analysis' | 'enrichment' | 'signal' | 'reply-analysis';
}

export interface WorkspaceIssue {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  raisedBy: string;
  resolution?: string;
}

export interface WorkspaceMessage {
  channel: 'email' | 'call' | 'linkedin';
  subject: string;
  bodyPreview: string;
  step: number;
  angle: string;
  sentBy: string;
  status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced';
}

// ─── Write Functions ───────────────────────────────────────────────

async function addUpdate(email: string, update: WorkspaceUpdate) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      ...update,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:updates', `source:${update.author}`],
  });
}

async function addTask(email: string, task: WorkspaceTask) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      ...task,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:tasks', `source:${task.createdBy}`, `priority:${task.priority}`],
  });
}

async function addNote(email: string, note: WorkspaceNote) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      ...note,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:notes', `source:${note.author}`, `category:${note.category}`],
  });
}

async function raiseIssue(email: string, issue: WorkspaceIssue) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      ...issue,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:issues', `source:${issue.raisedBy}`, `severity:${issue.severity}`],
  });
}

async function addMessageSent(email: string, message: WorkspaceMessage) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      ...message,
      sentAt: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:messages', `source:${message.sentBy}`, `channel:${message.channel}`, `step:${message.step}`],
  });
}

async function rewriteContext(email: string, context: string, author: string) {
  await client.memory.memorize({
    email,
    content: `[WORKSPACE CONTEXT]\n${context}`,
    enhanced: true,
    tags: ['workspace:context', `source:${author}`],
  });
}

// ─── Read Functions ────────────────────────────────────────────────

async function getDigest(email: string, tokenBudget = 3000) {
  return client.memory.smartDigest({
    email,
    type: 'Contact',
    token_budget: tokenBudget,
    include_properties: true,
    include_memories: true,
  });
}

async function getOpenTasks(email: string) {
  return client.memory.recall({
    message: `open pending tasks for ${email}`,
    email,
    limit: 10,
  });
}

async function getMessageHistory(email: string) {
  return client.memory.recall({
    message: `outreach emails messages sent to ${email}`,
    email,
    limit: 10,
  });
}

async function getIssues(email: string) {
  return client.memory.recall({
    message: `open issues problems blockers for ${email}`,
    email,
    limit: 5,
  });
}

/**
 * Get the current sequence state from workspace messages.
 * Returns: how many emails sent, last sent date, last engagement type.
 */
async function getSequenceState(email: string): Promise<{
  emailsSent: number;
  lastSentAt: string;
  lastEngagement: string;
  hasReplied: boolean;
  hasOptedOut: boolean;
}> {
  const [messages, engagements] = await Promise.all([
    client.memory.recall({
      message: `outreach emails sent sequence step for ${email}`,
      email,
      limit: 10,
    }),
    client.memory.recall({
      message: `email engagement reply opt out bounce for ${email}`,
      email,
      limit: 10,
    }),
  ]);

  let emailsSent = 0;
  let lastSentAt = '';
  let lastEngagement = 'none';
  let hasReplied = false;
  let hasOptedOut = false;

  // Parse message history
  for (const item of messages.data || []) {
    const content = item.content || '';
    try {
      const parsed = JSON.parse(content);
      if (parsed.step && parsed.channel === 'email') {
        emailsSent = Math.max(emailsSent, parsed.step);
        if (parsed.sentAt > lastSentAt) {
          lastSentAt = parsed.sentAt;
        }
      }
    } catch {
      // Also handle the legacy [OUTREACH SENT] format
      const match = content.match(/\[OUTREACH SENT\s*[-\u2014\u2013]+\s*Email (\d+)\]/);
      if (match) {
        emailsSent = Math.max(emailsSent, parseInt(match[1], 10));
        const dateMatch = content.match(/Date:\s*(.+)/);
        if (dateMatch) {
          const d = dateMatch[1].trim();
          if (d > lastSentAt) lastSentAt = d;
        }
      }
    }
  }

  // Parse engagement events
  for (const item of engagements.data || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('REPLY') || content.includes('REPLIED')) {
      hasReplied = true;
      lastEngagement = 'replied';
    }
    if (content.includes('OPT') && content.includes('OUT')) hasOptedOut = true;
    if (content.includes('UNSUBSCRIBE')) hasOptedOut = true;
    if (content.includes('NOT INTERESTED')) hasOptedOut = true;
    if (content.includes('REMOVE ME')) hasOptedOut = true;
    if (content.includes('OPENED') && lastEngagement === 'none') lastEngagement = 'opened';
    if (content.includes('CLICKED') && lastEngagement !== 'replied') lastEngagement = 'clicked';
    if (content.includes('BOUNCED')) lastEngagement = 'bounced';
  }

  return { emailsSent, lastSentAt, lastEngagement, hasReplied, hasOptedOut };
}

// ─── Task Lifecycle Functions ─────────────────────────────────────

/**
 * Search for pending tasks across all leads that are assigned to AI agents.
 * Returns raw memory items — caller must parse JSON content and filter.
 */
async function getAllPendingTasks(limit = 50) {
  return client.memory.recall({
    message: 'pending workspace tasks that need to be executed by agents, status pending',
    limit,
  });
}

/**
 * Record that a task has been completed by the executor.
 * Writes a completion record so the task isn't re-executed on the next poll.
 */
async function completeTask(email: string, taskTitle: string, outcome: string) {
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      type: 'task_completion',
      taskTitle,
      outcome,
      completedAt: new Date().toISOString(),
      completedBy: 'task-executor',
    }),
    enhanced: true,
    tags: ['workspace:task-completions', 'source:task-executor'],
  });
}

/**
 * Decline a task that the AI cannot execute.
 * Records the reason and notifies humans via a new escalation task.
 */
async function declineTask(email: string, taskTitle: string, reason: string, declinedBy: string) {
  // Record the decline
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      type: 'task_declined',
      taskTitle,
      reason,
      declinedBy,
      declinedAt: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:task-completions', 'source:task-executor', 'declined'],
  });

  // Escalate to human with the reason
  await addTask(email, {
    title: `[Escalated] ${taskTitle}`,
    description: `AI agent (${declinedBy}) could not execute this task.\n\nReason: ${reason}\n\nOriginal task: ${taskTitle}\n\nPlease review and either handle manually or provide more context.`,
    status: 'pending',
    owner: 'sales-rep',
    createdBy: 'task-executor',
    priority: 'high',
  });

  // Update timeline
  await addUpdate(email, {
    author: 'task-executor',
    type: 'system',
    summary: `Task declined: "${taskTitle}" — ${reason}`,
  });
}

/**
 * Reschedule a task to a new due date.
 * Records the change and writes a new task with the updated date.
 */
async function rescheduleTask(email: string, originalTitle: string, newDueDate: string, reason: string, rescheduledBy: string) {
  // Record the reschedule
  await client.memory.memorize({
    email,
    content: JSON.stringify({
      type: 'task_rescheduled',
      taskTitle: originalTitle,
      newDueDate,
      reason,
      rescheduledBy,
      rescheduledAt: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:task-completions', 'source:task-executor', 'rescheduled'],
  });

  // Update timeline
  await addUpdate(email, {
    author: 'task-executor',
    type: 'system',
    summary: `Task rescheduled: "${originalTitle}" → ${newDueDate}. Reason: ${reason}`,
  });
}

// ─── Export ────────────────────────────────────────────────────────

export const workspace = {
  addUpdate,
  addTask,
  addNote,
  raiseIssue,
  addMessageSent,
  rewriteContext,
  getDigest,
  getOpenTasks,
  getMessageHistory,
  getIssues,
  getSequenceState,
  getAllPendingTasks,
  completeTask,
  declineTask,
  rescheduleTask,
};
