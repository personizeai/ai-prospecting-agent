/**
 * Account Strategy Pipeline
 *
 * Evaluates a company account holistically by:
 * 1. Finding all contacts at the company
 * 2. Recalling each contact's workspace state (sequence, tasks, issues, engagement)
 * 3. Assembling company-level context (signals, research, previous strategy)
 * 4. Using AI to produce a coordinated account strategy
 * 5. Persisting the strategy and creating contact-level tasks as needed
 *
 * This is the "brain" that prevents edge cases like carpet bombing,
 * cold-emailing at engaged accounts, or tone-deaf outreach during layoffs.
 */

import { client, RATE_LIMIT_PAUSE_MS, aiOptions } from '../config.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { workspace } from '../lib/workspace.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { ACCOUNT_STRATEGY_SCHEMA, ACCOUNT_STRATEGY_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'account-strategy' });

// ─── Types ─────────────────────────────────────────────────────────

export interface AccountStrategyResult {
  domain: string;
  company: string;
  stage: string;
  health: string;
  coordinationFlags: string[];
  contactCount: number;
  actionsCreated: number;
  strategySummary: string;
}

// ─── Core Pipeline ─────────────────────────────────────────────────

/**
 * Run the account strategizer for a single company domain.
 * Gathers all context, evaluates with AI, persists strategy and tasks.
 */
export async function evaluateAccountStrategy(domain: string): Promise<AccountStrategyResult | null> {
  log.info('Evaluating account strategy', { domain });

  // ── STEP 1: Gather context in parallel ──────────────────────────

  const [companyDigest, previousStrategy, accountIssues, contactRollup, guidelines] = await Promise.all([
    accountWorkspace.getDigest(domain, 2500),
    accountWorkspace.getStrategy(domain),
    accountWorkspace.getIssues(domain),
    accountWorkspace.getContactRollup(domain),
    client.ai.smartGuidelines({
      message: 'account strategy, prospecting coordination, outreach sequencing, ICP prioritization',
      mode: 'fast',
    }),
  ]);

  const contacts = contactRollup.contacts;

  if (contacts.length === 0) {
    log.info('No contacts found at this company, skipping', { domain });
    return null;
  }

  // ── STEP 2: Format context for AI ───────────────────────────────

  const contactSummaries = contacts.map((c) => {
    const ws = contactRollup.workspaceStates[c.email] ?? {};
    const wsContext = `Status: ${ws.sequenceStatus || 'Unknown'} | Emails: ${ws.emailsSent || 0} | Tasks: ${(ws.pendingTasks || []).length} | Issues: ${(ws.openIssues || []).length}`;
    return [
      `- ${c.firstName} ${c.lastName} (${c.jobTitle || 'Unknown role'})`,
      `  Email: ${c.email}`,
      `  Lead Status: ${c.leadStatus || 'Unknown'}`,
      `  Outreach Stage: ${c.outreachStage || 'Not Started'}`,
      `  Lead Score: ${c.leadScore || 'N/A'}`,
      `  Sentiment: ${c.sentiment || 'Unknown'}`,
      `  Last Contacted: ${c.lastContacted || 'Never'}`,
      `  Workspace: ${wsContext || 'No workspace data'}`,
    ].join('\n');
  }).join('\n\n');

  const previousStrategyText = previousStrategy
    ? JSON.stringify(previousStrategy).substring(0, 2000)
    : 'No previous strategy.';

  const issuesSummary = (Array.isArray(accountIssues) ? accountIssues : [])
    .map((i: any) => `[${i.severity?.toUpperCase()}] ${i.title}: ${i.description}`)
    .join('\n')
    .substring(0, 1000);

  const context = [
    guidelines.data?.compiledContext ? `## Governance & Guidelines\n${guidelines.data.compiledContext}` : '',
    companyDigest.data?.compiledContext ? `## Company Profile\n${companyDigest.data.compiledContext}` : '',
    `## Contacts at This Account (${contacts.length})\n${contactSummaries}`,
    previousStrategyText ? `## Previous Account Strategy\n${previousStrategyText}` : '',
    issuesSummary ? `## Active Account Issues\n${issuesSummary}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  // ── STEP 3: AI Strategy Evaluation ──────────────────────────────

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `You are an account strategizer for a B2B sales AI system. Analyze this account and produce a coordinated strategy.

CRITICAL EDGE CASES TO CHECK:
1. NEW CONTACT AT ADVANCED ACCOUNT: If the account is engaged/opportunity/proposal stage and a contact has "Not Started" outreach, they should NOT get cold outreach. Flag: "new_contact_at_advanced_account"
2. CARPET BOMBING: If multiple contacts have "Not Started" and company is small (<100 employees), stagger outreach. Flag: "carpet_bomb_risk"
3. NEGATIVE SIGNAL IMPACT: If any contact opted out or replied negatively, evaluate if this is account-level rejection. Flag: "negative_at_account"
4. LOST DEAL HISTORY: If company has churned/lost deal context, adjust tone to re-engagement. Flag: "previous_relationship"
5. CHAMPION DEPARTED: If a previously engaged contact shows signs of leaving (stale, no engagement after positive), flag: "champion_at_risk"
6. CUSTOMER CONVERSION: If any signal shows deal closed-won or account became customer, STOP all prospecting. Flag: "account_converted"
7. CONFLICTING SIGNALS: If contacts show mixed sentiments (one positive, one negative), flag: "conflicting_signals"
8. REFERRAL PENDING: If a reply analysis mentioned a referral, any new contact matching that referral should NOT get cold outreach. Flag: "pending_referral"
9. DATA STALENESS: If contacts haven't been enriched/updated in 90+ days and show zero engagement, flag: "stale_data"
10. NEGATIVE COMPANY EVENT: If company context mentions layoffs, crisis, leadership change, flag: "negative_company_event"

For each recommended action, specify which contact it applies to (or "account" for account-level actions).
Prioritize actions as: urgent > high > medium > low.
${buildJsonInstruction(ACCOUNT_STRATEGY_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(result.data || '');
  const { data: parsed } = parseLLMJson(output, ACCOUNT_STRATEGY_SCHEMA, ACCOUNT_STRATEGY_DEFAULTS);

  // ── STEP 4: Persist strategy ────────────────────────────────────

  const companyName = companyDigest.data?.properties?.company_name || domain;

  await accountWorkspace.setStrategy(domain, {
    accountStage: parsed.account_stage,
    accountHealth: parsed.account_health,
    approach: parsed.strategy_summary,
    contactRollup: contacts.map((c) => ({
      email: c.email,
      name: `${c.firstName} ${c.lastName}`.trim(),
      role: c.jobTitle || 'Unknown',
      sequenceStatus: c.outreachStage || 'Not Started',
      engagement: c.sentiment || 'Unknown',
      lastAction: c.lastContacted || 'Never',
    })),
    coordinationFlags: parsed.coordination_flags,
    recommendedActions: parsed.recommended_actions.map((a: string) => {
      const parts = a.split('|').map((p: string) => p.trim());
      return {
        contact: parts[0] || '',
        action: parts[1] || a,
        rationale: parts[2] || '',
        priority: parts[3] || 'medium',
      };
    }),
    angleBlacklist: parsed.angle_blacklist,
    angleRecommendations: parsed.angle_recommendations,
    strategySummary: parsed.strategy_summary,
    generatedAt: new Date().toISOString(),
  });

  await accountWorkspace.addUpdate(domain, {
    author: 'account-strategizer',
    type: 'strategy',
    summary: `Strategy evaluated: ${parsed.account_stage} / ${parsed.account_health}. ${contacts.length} contacts. Flags: ${parsed.coordination_flags.join(', ') || 'none'}.`,
    details: parsed.strategy_summary,
  });

  // ── STEP 5: Create contact-level tasks from recommendations ─────

  let actionsCreated = 0;
  for (const actionStr of parsed.recommended_actions) {
    const parts = actionStr.split('|').map((p: string) => p.trim());
    const contactEmail = parts[0];
    const action = parts[1] || actionStr;
    const rationale = parts[2] || '';
    const priority = (parts[3] || 'medium') as 'low' | 'medium' | 'high' | 'urgent';

    // Skip if the email doesn't look valid
    if (!contactEmail || !contactEmail.includes('@')) {
      // Account-level action — store as account task
      await accountWorkspace.addTask(domain, {
        title: action,
        description: `${rationale}\n\nSource: Account strategizer`,
        status: 'pending',
        owner: 'sales-rep',
        createdBy: 'account-strategizer',
        priority,
      });
      actionsCreated++;
      continue;
    }

    // Contact-level action — store on contact workspace
    await workspace.addTask(contactEmail, {
      title: action,
      description: `${rationale}\n\nAccount context: ${parsed.strategy_summary}\n\nSource: Account strategizer`,
      status: 'pending',
      owner: determineTaskOwner(action),
      createdBy: 'account-strategizer',
      priority,
    });
    actionsCreated++;
  }

  log.info('Account strategy complete', {
    domain,
    stage: parsed.account_stage,
    health: parsed.account_health,
    contacts: contacts.length,
    flags: parsed.coordination_flags,
    actions: actionsCreated,
  });

  return {
    domain,
    company: String(companyName),
    stage: parsed.account_stage,
    health: parsed.account_health,
    coordinationFlags: parsed.coordination_flags,
    contactCount: contacts.length,
    actionsCreated,
    strategySummary: parsed.strategy_summary,
  };
}

// ─── Batch: Evaluate Multiple Accounts ──────────────────────────────

/**
 * Run account strategy for a list of hot accounts (post-signal detection).
 */
export async function evaluateAccountStrategies(
  accounts: Array<{ domain: string; company?: string }>,
  maxAccounts = 20,
): Promise<AccountStrategyResult[]> {
  const results: AccountStrategyResult[] = [];
  const batch = accounts.slice(0, maxAccounts);

  log.info('Evaluating account strategies', { count: batch.length });

  for (const account of batch) {
    try {
      const result = await evaluateAccountStrategy(account.domain);
      if (result) results.push(result);
    } catch (err) {
      log.error('Account strategy failed', {
        domain: account.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Account strategies complete', {
    evaluated: results.length,
    blocked: results.filter((r) => r.health === 'blocked').length,
    atRisk: results.filter((r) => r.health === 'at_risk').length,
  });

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Determine the best task owner based on the action description. */
function determineTaskOwner(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('email') || lower.includes('outreach') || lower.includes('send') || lower.includes('sequence')) {
    return 'outreach-agent';
  }
  if (lower.includes('enrich') || lower.includes('research') || lower.includes('discover')) {
    return 'enrichment-agent';
  }
  if (lower.includes('schedule') || lower.includes('call') || lower.includes('meeting') || lower.includes('review')) {
    return 'sales-rep';
  }
  return 'sales-rep';
}
