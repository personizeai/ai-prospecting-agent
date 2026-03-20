/**
 * Account Workspace Helpers — Memory CRUD Edition
 *
 * Account-level collaboration surface, keyed on company domain (website_url).
 * Uses Personize Memory CRUD API for all state management:
 *   - arrayPush for adds (race-free)
 *   - arrayPatch for in-place status updates (race-free, no index lookup)
 *   - arrayPatch for in-place updates
 *   - Direct property updates for strategy and context
 *   - propertyHistory for automatic audit trails
 *
 * Usage:
 *   import { accountWorkspace } from '../lib/account-workspace.js';
 *   await accountWorkspace.addUpdate('acme.com', { ... });
 *   const strategy = await accountWorkspace.getStrategy('acme.com');
 */

import { client } from '../config.js';
import { memoryCrud } from './personize-crud.js';
import { logger } from './logger.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface AccountUpdate {
  author: string;
  type: 'strategy' | 'coordination' | 'signal' | 'escalation' | 'system' | 'human';
  summary: string;
  details?: string;
}

export interface AccountTask {
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  owner: string;
  createdBy: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  outcome?: string;
}

export interface AccountNote {
  author: string;
  content: string;
  category: 'observation' | 'analysis' | 'competitive-intel' | 'strategy' | 'coordination';
}

export interface AccountIssue {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  raisedBy: string;
  resolution?: string;
}

export interface AccountStrategy {
  accountStage: string;
  accountHealth: string;
  approach: string;
  contactRollup: Array<{
    email: string;
    name: string;
    role: string;
    sequenceStatus: string;
    engagement: string;
    lastAction: string;
  }>;
  coordinationFlags: string[];
  recommendedActions: Array<{
    contact?: string;
    action: string;
    rationale: string;
    priority: string;
  }>;
  angleBlacklist?: string[];
  angleRecommendations?: string[];
  strategySummary: string;
  generatedAt: string;
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

const log = logger.child({ module: 'account-workspace' });

/**
 * Read a single property value from a company record.
 * Uses properties() API for lightweight, targeted reads (no LLM cost, no token budget).
 */
async function readProperty<T>(domain: string, propertyName: string, fallback: T): Promise<T> {
  try {
    const result = await client.memory.properties({
      websiteUrl: domain,
      type: 'Company',
      propertyNames: [propertyName],
      nonEmpty: true,
    });
    const prop = (result.data as any)?.properties?.find((p: any) => p.name === propertyName || p.systemName === propertyName);
    if (prop?.value != null) return prop.value as T;
  } catch (err) {
    log.warn('Failed to read account property, using fallback', { domain, propertyName, error: (err as Error).message });
  }
  return fallback;
}

/**
 * Read multiple properties from a company record in a single API call.
 */
async function readProperties(domain: string, propertyNames: string[]): Promise<Record<string, any>> {
  try {
    const result = await client.memory.properties({
      websiteUrl: domain,
      type: 'Company',
      propertyNames,
    });
    const out: Record<string, any> = {};
    for (const prop of (result.data as any)?.properties ?? []) {
      const key = prop.systemName || prop.name;
      out[key] = prop.value;
    }
    return out;
  } catch (err) {
    log.warn('Failed to read account properties', { domain, propertyNames, error: (err as Error).message });
    return {};
  }
}

// ─── Write Functions (arrayPush — race-free) ──────────────────────

async function addUpdate(domain: string, update: AccountUpdate) {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_updates',
    arrayPush: {
      items: [{
        ...update,
        timestamp: new Date().toISOString(),
      }],
    },
    updatedBy: update.author,
  });
}

async function addTask(domain: string, task: AccountTask): Promise<string> {
  const taskId = generateId('at');
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
    recordId: domain,
    type: 'Company',
    propertyName: 'account_pending_tasks',
    arrayPush: { items: [newTask] },
    updatedBy: task.createdBy || task.owner,
  });

  return taskId;
}

async function addNote(domain: string, note: AccountNote) {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_notes',
    arrayPush: {
      items: [{
        ...note,
        timestamp: new Date().toISOString(),
      }],
    },
    updatedBy: note.author,
  });
}

async function raiseIssue(domain: string, issue: AccountIssue): Promise<string> {
  const issueId = generateId('ai');
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
    recordId: domain,
    type: 'Company',
    propertyName: 'account_open_issues',
    arrayPush: { items: [newIssue] },
    updatedBy: issue.raisedBy,
  });

  return issueId;
}

async function setStrategy(domain: string, strategy: AccountStrategy) {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_strategy',
    propertyValue: JSON.stringify(strategy),
    updatedBy: 'account-strategizer',
  });
}

// ─── Read Functions ────────────────────────────────────────────────

async function getDigest(domain: string, tokenBudget = 3000) {
  return client.memory.smartDigest({
    website_url: domain,
    type: 'Company',
    token_budget: tokenBudget,
    include_properties: true,
    include_memories: true,
  });
}

async function getStrategy(domain: string): Promise<AccountStrategy | null> {
  const raw = await readProperty<string | null>(domain, 'account_strategy', null);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function getOpenTasks(domain: string): Promise<Task[]> {
  const all = await readProperty<Task[]>(domain, 'account_pending_tasks', []);
  return all.filter(t => !t.status || t.status === 'active');
}

async function getIssues(domain: string): Promise<Issue[]> {
  const all = await readProperty<Issue[]>(domain, 'account_open_issues', []);
  return all.filter(i => i.status === 'open' || i.status === 'investigating');
}

async function getUpdates(domain: string) {
  return readProperty<any[]>(domain, 'account_updates', []);
}

/**
 * Get all contacts at this company with their structured properties.
 */
async function getContacts(domain: string) {
  return client.memory.search({
    websiteUrl: domain,
    type: 'Contact',
    returnRecords: true,
  });
}

/**
 * Get a complete contact rollup for the account.
 * Finds all contacts, then reads workspace properties for each.
 */
async function getContactRollup(domain: string) {
  const contacts = await getContacts(domain);
  const records = contacts.data?.records ?? {};
  const recordIds = contacts.data?.recordIds ?? [];

  const contactInfos: Array<{ recordId: string; email: string; props: Record<string, any> }> = [];
  for (const recordId of recordIds) {
    const props = records[recordId] ?? {};
    const email = String(props['email']?.value ?? '');
    if (email) {
      contactInfos.push({ recordId, email, props });
    }
  }

  // Read workspace properties for each contact via properties() (parallel, no LLM cost)
  const workspacePropertyNames = ['sequence_status', 'emails_sent', 'pending_tasks', 'open_issues'];
  const workspaceStates = await Promise.all(
    contactInfos.map(async ({ email }) => {
      try {
        const result = await client.memory.properties({
          email,
          type: 'Contact',
          propertyNames: workspacePropertyNames,
        });
        const propsMap: Record<string, any> = {};
        for (const prop of (result.data as any)?.properties ?? []) {
          propsMap[prop.systemName || prop.name] = prop.value;
        }
        return {
          email,
          sequenceStatus: propsMap.sequence_status || 'Unknown',
          emailsSent: propsMap.emails_sent || 0,
          pendingTasks: propsMap.pending_tasks || [],
          openIssues: propsMap.open_issues || [],
        };
      } catch {
        return { email, sequenceStatus: 'Unknown', emailsSent: 0, pendingTasks: [], openIssues: [] };
      }
    }),
  );

  return {
    contacts: contactInfos.map(({ email, props }) => ({
      email,
      firstName: props['first_name']?.value ?? '',
      lastName: props['last_name']?.value ?? '',
      jobTitle: props['job_title']?.value ?? '',
      leadStatus: props['lead_status']?.value ?? '',
      outreachStage: props['outreach_stage']?.value ?? '',
      leadScore: String(props['lead_score']?.value ?? '0'),
      lastContacted: props['last_contacted']?.value ?? '',
      sentiment: props['sentiment']?.value ?? '',
    })),
    workspaceStates: Object.fromEntries(
      workspaceStates.map(({ email, ...state }) => [email, state]),
    ),
  };
}

// ─── Task Lifecycle (arrayPatch — race-free, no index lookup) ────

async function completeTask(domain: string, taskId: string, outcome: string): Promise<void> {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_pending_tasks',
    arrayPatch: {
      match: { taskId },
      set: { status: 'completed', outcome, completedAt: new Date().toISOString() },
    },
    updatedBy: 'task-executor',
  });
}

async function declineTask(domain: string, taskId: string, reason: string, declinedBy: string): Promise<void> {
  // Read the task title for the escalation message
  const current = await readProperty<Task[]>(domain, 'account_pending_tasks', []);
  const task = current.find(t => t.taskId === taskId);
  const taskTitle = task?.title ?? taskId;

  // Mark declined (race-free — no index needed)
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_pending_tasks',
    arrayPatch: {
      match: { taskId },
      set: { status: 'declined', outcome: reason, completedAt: new Date().toISOString() },
    },
    updatedBy: declinedBy,
  });

  await addTask(domain, {
    title: `[Escalated] ${taskTitle}`,
    description: `AI agent (${declinedBy}) could not execute this task.\n\nReason: ${reason}\n\nOriginal task: ${taskTitle}\n\nPlease review and either handle manually or provide more context.`,
    status: 'pending',
    owner: 'sales-rep',
    createdBy: 'task-executor',
    priority: 'high',
  });

  await addUpdate(domain, {
    author: 'task-executor',
    type: 'system',
    summary: `Account task declined: "${taskTitle}" — ${reason}`,
  });
}

async function rescheduleTask(domain: string, taskId: string, newDueDate: string, reason: string, rescheduledBy: string): Promise<void> {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_pending_tasks',
    arrayPatch: { match: { taskId }, set: { dueDate: newDueDate } },
    updatedBy: rescheduledBy,
  });

  await addUpdate(domain, {
    author: rescheduledBy,
    type: 'system',
    summary: `Account task rescheduled: "${taskId}" → ${newDueDate}. Reason: ${reason}`,
  });
}

async function resolveIssue(domain: string, issueId: string, resolution: string): Promise<void> {
  await memoryCrud.update({
    recordId: domain,
    type: 'Company',
    propertyName: 'account_open_issues',
    arrayPatch: {
      match: { issueId },
      set: { status: 'resolved', resolution, resolvedAt: new Date().toISOString() },
    },
    updatedBy: 'system',
  });
}

// ─── Export ────────────────────────────────────────────────────────

export const accountWorkspace = {
  // Write (arrayPush — race-free)
  addUpdate,
  addNote,
  addTask,
  raiseIssue,
  setStrategy,
  // Task lifecycle
  completeTask,
  declineTask,
  rescheduleTask,
  // Issue lifecycle
  resolveIssue,
  // Read
  getDigest,
  getStrategy,
  getOpenTasks,
  getIssues,
  getUpdates,
  getContacts,
  getContactRollup,
};
