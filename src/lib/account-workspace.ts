/**
 * Account Workspace Helpers
 *
 * Account-level collaboration surface, keyed on company domain (website_url).
 * Mirrors the contact workspace pattern but holds account-level state:
 * strategy, cross-contact rollups, account tasks, and coordination flags.
 *
 * Usage:
 *   import { accountWorkspace } from '../lib/account-workspace.js';
 *   await accountWorkspace.addUpdate('acme.com', { ... });
 *   const strategy = await accountWorkspace.getStrategy('acme.com');
 */

import { client } from '../config.js';

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

// ─── Write Functions ───────────────────────────────────────────────

async function addUpdate(domain: string, update: AccountUpdate) {
  await client.memory.memorize({
    website_url: domain,
    content: JSON.stringify({
      ...update,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:account-updates', `source:${update.author}`],
  });
}

async function addTask(domain: string, task: AccountTask) {
  await client.memory.memorize({
    website_url: domain,
    content: JSON.stringify({
      ...task,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:account-tasks', `source:${task.createdBy}`, `priority:${task.priority}`],
  });
}

async function addNote(domain: string, note: AccountNote) {
  await client.memory.memorize({
    website_url: domain,
    content: JSON.stringify({
      ...note,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:account-notes', `source:${note.author}`, `category:${note.category}`],
  });
}

async function raiseIssue(domain: string, issue: AccountIssue) {
  await client.memory.memorize({
    website_url: domain,
    content: JSON.stringify({
      ...issue,
      timestamp: new Date().toISOString(),
    }),
    enhanced: true,
    tags: ['workspace:account-issues', `source:${issue.raisedBy}`, `severity:${issue.severity}`],
  });
}

async function setStrategy(domain: string, strategy: AccountStrategy) {
  await client.memory.memorize({
    website_url: domain,
    content: JSON.stringify(strategy),
    enhanced: true,
    tags: ['workspace:account-strategy', 'source:account-strategizer'],
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

async function getStrategy(domain: string) {
  return client.memory.smartRecall({
    query: 'account strategy coordination flags approach stage health recommended actions',
    website_url: domain,
    fast_mode: true,
    min_score: 0.3,
    limit: 5,
  });
}

async function getIssues(domain: string) {
  return client.memory.smartRecall({
    query: 'account issues problems blockers risks champion departed negative signals',
    website_url: domain,
    fast_mode: true,
    min_score: 0.3,
    limit: 10,
  });
}

async function getUpdates(domain: string) {
  return client.memory.smartRecall({
    query: 'account updates timeline strategy coordination escalation',
    website_url: domain,
    fast_mode: true,
    min_score: 0.3,
    limit: 20,
  });
}

/**
 * Get all contacts at this company with their structured properties.
 * Returns contact records with email, name, title, stage, etc.
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
 * Finds all contacts, then recalls workspace state for each in parallel.
 */
async function getContactRollup(domain: string) {
  const contacts = await getContacts(domain);
  const records = contacts.data?.records ?? {};
  const recordIds = contacts.data?.recordIds ?? [];

  // Extract emails from contact records
  const contactInfos: Array<{ recordId: string; email: string; props: Record<string, any> }> = [];
  for (const recordId of recordIds) {
    const props = records[recordId] ?? {};
    const email = String(props['email']?.value ?? '');
    if (email) {
      contactInfos.push({ recordId, email, props });
    }
  }

  // Recall workspace state for each contact in parallel (fast_mode)
  const workspaceStates = await Promise.all(
    contactInfos.map(async ({ email }) => {
      try {
        const result = await client.memory.smartRecall({
          query: 'sequence state tasks issues engagement replies outreach stage opted out bounced',
          email,
          fast_mode: true,
          min_score: 0.3,
          limit: 10,
        });
        return { email, results: (result.data as any)?.results ?? [] };
      } catch {
        return { email, results: [] };
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
      workspaceStates.map(({ email, results }) => [email, results]),
    ),
  };
}

// ─── Export ────────────────────────────────────────────────────────

export const accountWorkspace = {
  addUpdate,
  addTask,
  addNote,
  raiseIssue,
  setStrategy,
  getDigest,
  getStrategy,
  getIssues,
  getUpdates,
  getContacts,
  getContactRollup,
};
