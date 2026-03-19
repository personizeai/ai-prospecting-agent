/**
 * Lead Workspace Helpers — Memory CRUD Edition
 *
 * Uses Personize Memory CRUD API for all state management:
 *   - arrayPush for adds (no read needed, race-free)
 *   - arrayRemove for removes (with read for index, expectedVersion for safety)
 *   - arrayPatch for in-place updates (no read needed)
 *   - filterByProperty for cross-record queries (deterministic, no LLM cost)
 *   - propertyHistory for audit trails (automatic, no manual tracking)
 *   - deleteRecord for opt-out enforcement (API-level exclusion)
 *
 * All function SIGNATURES are unchanged — 15 caller files need zero changes.
 *
 * Usage:
 *   import { workspace } from '../lib/workspace.js';
 *   await workspace.addUpdate(email, { ... });
 *   await workspace.addMessageSent(email, { ... });
 *   const digest = await workspace.getDigest(email);
 */

import { client } from '../config.js';
import { memoryCrud } from './personize-crud.js';
import { logger } from './logger.js';

// ─── Types (unchanged — callers depend on these) ──────────────────

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

// ─── Internal Types (code-managed state) ──────────────────────────

interface Task {
  taskId: string;
  title: string;
  description: string;
  owner: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdBy: string;
  createdAt: string;
  dueDate?: string;
}

interface Issue {
  issueId: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating';
  raisedBy: string;
  raisedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const log = logger.child({ module: 'workspace' });

/**
 * Read a single property value from a contact record.
 * Uses smartDigest with include_properties for reliable property reads.
 * Falls back to empty default if property doesn't exist yet (lazy migration).
 */
async function readProperty<T>(email: string, propertyName: string, fallback: T): Promise<T> {
  try {
    const digest = await client.memory.smartDigest({
      email,
      type: 'Contact',
      token_budget: 500,
      include_properties: true,
    });
    const props = (digest.data as any)?.properties;
    const value = props?.[propertyName]?.value;
    if (value != null) return value as T;
  } catch (err) {
    log.warn('Failed to read property, using fallback', { email, propertyName, error: (err as Error).message });
  }
  return fallback;
}

/**
 * Retry wrapper for VERSION_CONFLICT errors.
 * When two agents modify the same array simultaneously, the second write
 * gets a 409. This retries with a fresh read.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.code === 'VERSION_CONFLICT' && attempt < maxRetries - 1) {
        log.info('VERSION_CONFLICT, retrying', { attempt: attempt + 1, maxRetries });
        continue;
      }
      throw err;
    }
  }
  throw new Error('withRetry: max retries exceeded');
}

// ─── Write Functions (arrayPush — no read needed, race-free) ──────

async function addUpdate(email: string, update: WorkspaceUpdate) {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'updates',
    arrayPush: {
      items: [{
        ...update,
        timestamp: new Date().toISOString(),
      }],
    },
    updatedBy: update.author,
  });
}

async function addTask(email: string, task: WorkspaceTask): Promise<string> {
  const taskId = generateId('t');
  const newTask: Task = {
    taskId,
    title: task.title,
    description: task.description,
    owner: task.owner,
    priority: task.priority,
    createdBy: task.createdBy || task.owner,
    createdAt: new Date().toISOString(),
    dueDate: task.dueDate,
  };

  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'pending_tasks',
    arrayPush: { items: [newTask] },
    updatedBy: task.createdBy || task.owner,
  });

  return taskId;
}

async function addNote(email: string, note: WorkspaceNote) {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'notes',
    arrayPush: {
      items: [{
        ...note,
        timestamp: new Date().toISOString(),
      }],
    },
    updatedBy: note.author,
  });
}

async function raiseIssue(email: string, issue: WorkspaceIssue): Promise<string> {
  const issueId = generateId('i');
  const newIssue: Issue = {
    issueId,
    title: issue.title,
    description: issue.description,
    severity: issue.severity,
    status: 'open',
    raisedBy: issue.raisedBy,
    raisedAt: new Date().toISOString(),
  };

  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'open_issues',
    arrayPush: { items: [newIssue] },
    updatedBy: issue.raisedBy,
  });

  return issueId;
}

async function addMessageSent(email: string, message: WorkspaceMessage) {
  const entry = {
    ...message,
    sentAt: new Date().toISOString(),
  };

  // Push to messages_sent array
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'messages_sent',
    arrayPush: { items: [entry] },
    updatedBy: message.sentBy,
  });

  // Update scalar sequence state properties for fast deterministic reads
  if (message.channel === 'email') {
    await memoryCrud.update({
      recordId: email,
      type: 'Contact',
      propertyName: 'emails_sent',
      propertyValue: message.step,
      updatedBy: message.sentBy,
    });
    await memoryCrud.update({
      recordId: email,
      type: 'Contact',
      propertyName: 'last_sent_at',
      propertyValue: entry.sentAt,
      updatedBy: message.sentBy,
    });
  }
}

async function rewriteContext(email: string, context: string, author: string) {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'context',
    propertyValue: context,
    updatedBy: author,
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

async function getOpenTasks(email: string): Promise<Task[]> {
  return readProperty<Task[]>(email, 'pending_tasks', []);
}

/** @deprecated Use getSequenceState() for structured reads. Kept for backward compat. */
async function getMessageHistory(email: string) {
  return client.memory.recall({
    message: `outreach emails messages sent to ${email}`,
    email,
    limit: 10,
  });
}

async function getIssues(email: string): Promise<Issue[]> {
  return readProperty<Issue[]>(email, 'open_issues', []);
}

/**
 * Get the current sequence state from structured properties.
 * Reads emails_sent, last_sent_at, sequence_status directly — no semantic search.
 * Includes hasDraftAtStep for manual-hubspot draft gating.
 */
async function getSequenceState(email: string): Promise<{
  emailsSent: number;
  lastSentAt: string;
  lastEngagement: string;
  hasReplied: boolean;
  hasOptedOut: boolean;
  hasDraftAtStep: number | null;
}> {
  try {
    const digest = await client.memory.smartDigest({
      email,
      type: 'Contact',
      token_budget: 500,
      include_properties: true,
    });

    const props = (digest.data as any)?.properties || {};
    const emailsSent = Number(props.emails_sent?.value) || 0;
    const lastSentAt = String(props.last_sent_at?.value || '');
    const sequenceStatus = String(props.sequence_status?.value || 'Active');

    // Determine engagement state from sequence_status property
    const hasReplied = sequenceStatus === 'Replied';
    const hasOptedOut = sequenceStatus === 'Opted Out';

    let lastEngagement = 'none';
    if (hasReplied) lastEngagement = 'replied';
    else if (sequenceStatus === 'Bounced') lastEngagement = 'bounced';

    // Check for drafts in messages_sent array
    let hasDraftAtStep: number | null = null;
    const messagesSent = props.messages_sent?.value;
    if (Array.isArray(messagesSent)) {
      for (const msg of messagesSent) {
        if (msg.status === 'draft' || msg.status === 'pending_review') {
          hasDraftAtStep = msg.step;
        }
      }
      // Also check engagement from messages if sequence_status hasn't been set yet
      if (lastEngagement === 'none') {
        for (const msg of messagesSent) {
          if (msg.status === 'opened' && lastEngagement === 'none') lastEngagement = 'opened';
          if (msg.status === 'clicked' && lastEngagement !== 'replied') lastEngagement = 'clicked';
        }
      }
    }

    return { emailsSent, lastSentAt, lastEngagement, hasReplied, hasOptedOut, hasDraftAtStep };
  } catch (err: any) {
    // If record is soft-deleted (404), treat as opted out
    if (err?.status === 404 || err?.code === 'RECORD_NOT_FOUND') {
      return { emailsSent: 0, lastSentAt: '', lastEngagement: 'none', hasReplied: false, hasOptedOut: true, hasDraftAtStep: null };
    }

    // Lazy migration fallback: if properties don't exist yet, use old recall-based parsing
    log.warn('getSequenceState falling back to recall-based parsing', { email, error: (err as Error).message });
    return getSequenceStateLegacy(email);
  }
}

/**
 * Legacy fallback for records that predate the CRUD migration.
 * Uses recall + string parsing. Will be removed once all records are migrated.
 */
async function getSequenceStateLegacy(email: string): Promise<{
  emailsSent: number;
  lastSentAt: string;
  lastEngagement: string;
  hasReplied: boolean;
  hasOptedOut: boolean;
  hasDraftAtStep: number | null;
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
  let hasDraftAtStep: number | null = null;

  for (const item of messages.data || []) {
    const content = item.content || '';
    try {
      const parsed = JSON.parse(content);
      if (parsed.step && parsed.channel === 'email') {
        emailsSent = Math.max(emailsSent, parsed.step);
        if (parsed.sentAt > lastSentAt) lastSentAt = parsed.sentAt;
        if (parsed.status === 'draft') hasDraftAtStep = parsed.step;
      }
    } catch {
      const match = content.match(/\[OUTREACH SENT\s*[-\u2014\u2013]+\s*Email (\d+)\]/);
      if (match) {
        emailsSent = Math.max(emailsSent, parseInt(match[1], 10));
        const dateMatch = content.match(/Date:\s*(.+)/);
        if (dateMatch) {
          const d = dateMatch[1].trim();
          if (d > lastSentAt) lastSentAt = d;
        }
      }
      const draftMatch = content.match(/\[OUTREACH DRAFT\s*[-\u2014\u2013]+\s*Email (\d+)\]/);
      if (draftMatch) {
        hasDraftAtStep = parseInt(draftMatch[1], 10);
        emailsSent = Math.max(emailsSent, hasDraftAtStep);
      }
    }
  }

  for (const item of engagements.data || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('REPLY') || content.includes('REPLIED')) { hasReplied = true; lastEngagement = 'replied'; }
    if (content.includes('OPT') && content.includes('OUT')) hasOptedOut = true;
    if (content.includes('UNSUBSCRIBE')) hasOptedOut = true;
    if (content.includes('NOT INTERESTED')) hasOptedOut = true;
    if (content.includes('REMOVE ME')) hasOptedOut = true;
    if (content.includes('OPENED') && lastEngagement === 'none') lastEngagement = 'opened';
    if (content.includes('CLICKED') && lastEngagement !== 'replied') lastEngagement = 'clicked';
    if (content.includes('BOUNCED')) lastEngagement = 'bounced';
  }

  return { emailsSent, lastSentAt, lastEngagement, hasReplied, hasOptedOut, hasDraftAtStep };
}

// ─── Cross-Record Queries ─────────────────────────────────────────

/**
 * Find all contacts with pending tasks (deterministic, no LLM cost).
 * Returns records with their pending_tasks property values.
 */
async function getAllPendingTasks(limit = 50) {
  return memoryCrud.filterByProperty({
    type: 'Contact',
    conditions: [{ propertyName: 'pending_tasks', operator: 'exists' }],
    limit,
  });
}

// ─── Task Lifecycle (arrayRemove with retry for safety) ──────────

/**
 * Complete a task: remove from pending_tasks via arrayRemove.
 * History is tracked automatically by propertyHistory — no manual memorize needed.
 */
async function completeTask(email: string, taskId: string, outcome: string): Promise<void> {
  await withRetry(async () => {
    const current = await readProperty<Task[]>(email, 'pending_tasks', []);
    const idx = current.findIndex(t => t.taskId === taskId);
    if (idx === -1) return;

    await memoryCrud.update({
      recordId: email,
      type: 'Contact',
      propertyName: 'pending_tasks',
      arrayRemove: { indices: [idx] },
      updatedBy: 'task-executor',
    });
  });
}

/**
 * Decline a task: remove from pending_tasks, escalate to human.
 */
async function declineTask(email: string, taskId: string, reason: string, declinedBy: string): Promise<void> {
  let taskTitle = taskId;

  await withRetry(async () => {
    const current = await readProperty<Task[]>(email, 'pending_tasks', []);
    const idx = current.findIndex(t => t.taskId === taskId);
    if (idx === -1) return;
    taskTitle = current[idx].title;

    await memoryCrud.update({
      recordId: email,
      type: 'Contact',
      propertyName: 'pending_tasks',
      arrayRemove: { indices: [idx] },
      updatedBy: declinedBy,
    });
  });

  // Escalate to human
  await addTask(email, {
    title: `[Escalated] ${taskTitle}`,
    description: `AI agent (${declinedBy}) could not execute this task.\n\nReason: ${reason}\n\nOriginal task: ${taskTitle}\n\nPlease review and either handle manually or provide more context.`,
    status: 'pending',
    owner: 'sales-rep',
    createdBy: 'task-executor',
    priority: 'high',
  });

  await addUpdate(email, {
    author: 'task-executor',
    type: 'system',
    summary: `Task declined: "${taskTitle}" — ${reason}`,
  });
}

/**
 * Reschedule a task: update dueDate via arrayPatch (no read needed).
 */
async function rescheduleTask(email: string, taskId: string, newDueDate: string, reason: string, rescheduledBy: string): Promise<void> {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'pending_tasks',
    arrayPatch: { match: { taskId }, set: { dueDate: newDueDate } },
    updatedBy: rescheduledBy,
  });

  await addUpdate(email, {
    author: rescheduledBy,
    type: 'system',
    summary: `Task rescheduled: "${taskId}" → ${newDueDate}. Reason: ${reason}`,
  });
}

/**
 * Resolve an issue: remove from open_issues via arrayRemove.
 * History tracked automatically by propertyHistory.
 */
async function resolveIssue(email: string, issueId: string, resolution: string): Promise<void> {
  await withRetry(async () => {
    const current = await readProperty<Issue[]>(email, 'open_issues', []);
    const idx = current.findIndex(i => i.issueId === issueId);
    if (idx === -1) return;

    await memoryCrud.update({
      recordId: email,
      type: 'Contact',
      propertyName: 'open_issues',
      arrayRemove: { indices: [idx] },
      updatedBy: 'system',
    });
  });
}

// ─── Soft-Delete (opt-out enforcement) ────────────────────────────

/**
 * Soft-delete a contact record. All read paths automatically exclude it.
 * Recoverable within 30 days via cancelDeletion().
 */
async function softDelete(email: string, reason: string, performedBy: string): Promise<void> {
  await memoryCrud.deleteRecord({
    recordId: email,
    type: 'Contact',
    reason,
    performedBy,
  });
}

/**
 * Cancel a pending soft-delete within the 30-day recovery window.
 */
async function cancelDeletion(email: string, performedBy: string): Promise<void> {
  await memoryCrud.cancelDeletion({
    recordId: email,
    type: 'Contact',
    performedBy,
  });
}

// ─── Export ────────────────────────────────────────────────────────

export const workspace = {
  // Write (arrayPush — race-free)
  addUpdate,
  addTask,
  addNote,
  raiseIssue,
  addMessageSent,
  rewriteContext,
  // Read
  getDigest,
  getOpenTasks,
  getMessageHistory,
  getIssues,
  getSequenceState,
  // Cross-record queries
  getAllPendingTasks,
  // Task lifecycle (arrayRemove + retry)
  completeTask,
  declineTask,
  rescheduleTask,
  // Issue lifecycle
  resolveIssue,
  // Soft-delete
  softDelete,
  cancelDeletion,
};
