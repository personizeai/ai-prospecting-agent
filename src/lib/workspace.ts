/**
 * Lead Workspace Helpers — Memory CRUD Edition
 *
 * Uses Personize Memory CRUD API for all state management:
 *   - arrayPush for adds (no read needed, race-free)
 *   - arrayPatch for in-place updates and status transitions (race-free, no index lookup)
 *   - filterByProperty for cross-record queries (deterministic, no LLM cost)
 *   - properties() for lightweight targeted reads (no LLM cost, no token budget)
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
import { memory } from './memory.js';
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
  /** Agent or role that initiated the send (e.g., 'outreach-agent', 'task-executor'). */
  sentBy: string;
  /** Sender Profile ID (sp_xxx) — stable identity across email rotations. */
  senderProfileId?: string;
  /** Actual email address used to send (for audit trail). */
  senderEmail?: string;
  /** Provider message ID (e.g., Gmail Message-ID header). Used to match inReplyTo on replies for attribution. */
  messageId?: string;
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
  completedAt?: string;
  outcome?: string;
  status?: 'active' | 'completed' | 'declined';
}

interface Issue {
  issueId: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved';
  raisedBy: string;
  raisedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const log = logger.child({ module: 'workspace' });

/**
 * Read a single property value from a contact record.
 * Uses properties() API for lightweight, targeted reads (no LLM cost, no token budget).
 */
async function readProperty<T>(email: string, propertyName: string, fallback: T): Promise<T> {
  try {
    const result = await client.memory.properties({
      email,
      type: 'Contact',
      propertyNames: [propertyName],
      nonEmpty: true,
    });
    const prop = (result.data as any)?.properties?.find((p: any) => p.name === propertyName || p.systemName === propertyName);
    if (prop?.value != null) return prop.value as T;
  } catch (err) {
    log.warn('Failed to read property, using fallback', { email, propertyName, error: (err as Error).message });
  }
  return fallback;
}

/**
 * Read multiple properties from a contact record in a single API call.
 */
async function readProperties(email: string, propertyNames: string[]): Promise<Record<string, any>> {
  try {
    const result = await client.memory.properties({
      email,
      type: 'Contact',
      propertyNames,
    });
    const out: Record<string, any> = {};
    for (const prop of (result.data as any)?.properties ?? []) {
      const key = prop.systemName || prop.name;
      out[key] = prop.value;
    }
    return out;
  } catch (err) {
    log.warn('Failed to read properties', { email, propertyNames, error: (err as Error).message });
    return {};
  }
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

  // Update scalar sequence state atomically via bulkUpdate (single round-trip)
  if (message.channel === 'email') {
    await memoryCrud.bulkUpdate({
      recordId: email,
      type: 'Contact',
      updates: [
        { propertyName: 'emails_sent', propertyValue: message.step },
        { propertyName: 'last_sent_at', propertyValue: entry.sentAt },
      ],
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
  return memory.retrieveDigest({
    email,
    maxTokens: tokenBudget,
  });
}

async function getOpenTasks(email: string): Promise<Task[]> {
  const all = await readProperty<Task[]>(email, 'pending_tasks', []);
  return all.filter(t => !t.status || t.status === 'active');
}

async function getIssues(email: string): Promise<Issue[]> {
  const all = await readProperty<Issue[]>(email, 'open_issues', []);
  return all.filter(i => i.status === 'open' || i.status === 'investigating');
}

/**
 * Get the current sequence state from structured properties.
 * Uses properties() API for lightweight, targeted reads — no LLM cost.
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
    const props = await readProperties(email, ['emails_sent', 'last_sent_at', 'sequence_status', 'messages_sent']);

    const emailsSent = Number(props.emails_sent) || 0;
    const lastSentAt = String(props.last_sent_at || '');
    const sequenceStatus = String(props.sequence_status || 'Active');

    // Determine engagement state from sequence_status property
    const hasReplied = sequenceStatus === 'Replied';
    const hasOptedOut = sequenceStatus === 'Opted Out';

    let lastEngagement = 'none';
    if (hasReplied) lastEngagement = 'replied';
    else if (sequenceStatus === 'Bounced') lastEngagement = 'bounced';

    // Check for drafts in messages_sent array
    let hasDraftAtStep: number | null = null;
    const messagesSent = props.messages_sent;
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
    throw err;
  }
}

// ─── Attribution Helpers ──────────────────────────────────────────

/**
 * Find a sent message by its provider Message-ID (for reply attribution).
 * When an inbound reply arrives with an In-Reply-To header, call this to
 * identify which outreach step/angle the reply is responding to.
 */
async function findMessageByMessageId(email: string, targetMessageId: string): Promise<(WorkspaceMessage & { sentAt: string }) | null> {
  if (!targetMessageId) return null;
  const messages = await readProperty<Array<WorkspaceMessage & { sentAt: string }>>(email, 'messages_sent', []);
  return messages.find(m => m.messageId === targetMessageId) ?? null;
}

/**
 * Get all messages sent to a contact (for metrics/attribution).
 */
async function getMessagesSent(email: string): Promise<Array<WorkspaceMessage & { sentAt: string }>> {
  return readProperty<Array<WorkspaceMessage & { sentAt: string }>>(email, 'messages_sent', []);
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

// ─── Task Lifecycle (arrayPatch — race-free, no index lookup) ────

/**
 * Complete a task: mark as completed via arrayPatch (race-free, no index lookup needed).
 * History is tracked automatically by propertyHistory — no manual memorize needed.
 */
async function completeTask(email: string, taskId: string, outcome: string): Promise<void> {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'pending_tasks',
    arrayPatch: {
      match: { taskId },
      set: { status: 'completed', outcome, completedAt: new Date().toISOString() },
    },
    updatedBy: 'task-executor',
  });
}

/**
 * Decline a task: mark as declined via arrayPatch, then escalate to human.
 */
async function declineTask(email: string, taskId: string, reason: string, declinedBy: string): Promise<void> {
  // Read the task title for the escalation message
  const current = await readProperty<Task[]>(email, 'pending_tasks', []);
  const task = current.find(t => t.taskId === taskId);
  const taskTitle = task?.title ?? taskId;

  // Mark declined (race-free — no index needed)
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'pending_tasks',
    arrayPatch: {
      match: { taskId },
      set: { status: 'declined', outcome: reason, completedAt: new Date().toISOString() },
    },
    updatedBy: declinedBy,
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
 * Resolve an issue: mark as resolved via arrayPatch (race-free, no index lookup needed).
 * History tracked automatically by propertyHistory.
 */
async function resolveIssue(email: string, issueId: string, resolution: string): Promise<void> {
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'open_issues',
    arrayPatch: {
      match: { issueId },
      set: { status: 'resolved', resolution, resolvedAt: new Date().toISOString() },
    },
    updatedBy: 'system',
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

// ─── Role Owner ───────────────────────────────────────────────────

import type { SalesRoleId } from '../config/sales-roles.js';

/**
 * Set the role_owner for a contact and log the change.
 */
async function setRoleOwner(
  email: string,
  roleId: SalesRoleId | 'unassigned',
  reason: string,
  changedBy: string,
): Promise<void> {
  const previousRole = await readProperty<string>(email, 'role_owner', 'unassigned');

  // Update the property
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'role_owner',
    propertyValue: roleId,
    updatedBy: changedBy,
  });

  // Append to role history
  await memoryCrud.update({
    recordId: email,
    type: 'Contact',
    propertyName: 'role_owner_history',
    arrayPush: {
      items: [{
        fromRole: previousRole,
        toRole: roleId,
        reason,
        changedBy,
        timestamp: new Date().toISOString(),
      }],
    },
    updatedBy: changedBy,
  });

  log.info('Role owner updated', { email, fromRole: previousRole, toRole: roleId, reason, changedBy });
}

/**
 * Get the current role_owner for a contact.
 */
async function getRoleOwner(email: string): Promise<SalesRoleId | 'unassigned'> {
  return readProperty<SalesRoleId | 'unassigned'>(email, 'role_owner', 'unassigned');
}

/**
 * Get contacts owned by a specific role (for role-scoped scheduling).
 */
async function getContactsByRole(roleId: SalesRoleId, limit = 50): Promise<Array<{ email: string; properties: Record<string, unknown> }>> {
  try {
    const result = await memoryCrud.filterByProperty({
      type: 'Contact',
      conditions: [{ propertyName: 'role_owner', operator: 'equals', value: roleId }],
      limit,
    });
    return result.records.map((r) => ({ email: r.recordId, properties: r.matchedProperties }));
  } catch (err) {
    log.warn('Failed to query contacts by role', { roleId, error: (err as Error).message });
    return [];
  }
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
  getIssues,
  getSequenceState,
  // Attribution
  findMessageByMessageId,
  getMessagesSent,
  // Cross-record queries
  getAllPendingTasks,
  // Task lifecycle (arrayPatch — race-free)
  completeTask,
  declineTask,
  rescheduleTask,
  // Issue lifecycle
  resolveIssue,
  // Soft-delete
  softDelete,
  cancelDeletion,
  // Role ownership (Sales Org)
  setRoleOwner,
  getRoleOwner,
  getContactsByRole,
};
