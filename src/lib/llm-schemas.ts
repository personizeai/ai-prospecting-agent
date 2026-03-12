/**
 * LLM Output Schema Definitions
 *
 * These schemas define the expected JSON structure for each pipeline's LLM output.
 * They are NOT Personize collection schemas — they only validate LLM response shapes.
 * Data still flows into your existing contacts/companies collections unchanged.
 */

import type { SchemaMap } from './llm-output.js';

// ─── generate-outreach.ts ────────────────────────────────────────────

export const OUTREACH_EMAIL_SCHEMA = {
  subject: {
    description: 'Subject line, plain text, under 60 chars',
    type: 'string',
    required: true,
  },
  body_html: {
    description: 'Email body using only <p>, <b>, <i>, <a>, <br>, <strong>, <em> tags',
    type: 'string',
    required: true,
  },
  body_text: {
    description: 'Plain text version of the email (no HTML)',
    type: 'string',
    required: true,
  },
  angle: {
    description: '1-sentence description of the personalization angle used',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const OUTREACH_EMAIL_DEFAULTS = {
  subject: '',
  body_html: '',
  body_text: '',
  angle: '',
};

// ─── detect-signals.ts ──────────────────────────────────────────────

export const SIGNAL_ASSESSMENT_SCHEMA = {
  icp_fit_score: {
    description: 'ICP fit score from 0-100',
    type: 'number',
    required: true,
  },
  signal_strength: {
    description: 'Strength of buying signals detected',
    type: 'string',
    required: true,
    enumValues: ['None', 'Weak', 'Moderate', 'Strong', 'Very Strong'] as const,
  },
  buying_window: {
    description: 'Whether there is an active buying window',
    type: 'boolean',
    required: true,
  },
  reasoning: {
    description: '2-3 sentences explaining the score',
    type: 'string',
    required: true,
  },
  recommended_action: {
    description: 'Recommended next step',
    type: 'string',
    required: true,
    enumValues: ['Skip', 'Monitor', 'Research', 'Prospect Now'] as const,
  },
} as const satisfies SchemaMap;

export const SIGNAL_ASSESSMENT_DEFAULTS = {
  icp_fit_score: 0,
  signal_strength: 'None',
  buying_window: false,
  reasoning: '',
  recommended_action: 'Skip',
};

// ─── analyze-reply.ts ───────────────────────────────────────────────

export const REPLY_ANALYSIS_SCHEMA = {
  sentiment: {
    description: 'Reply sentiment classification',
    type: 'string',
    required: true,
    enumValues: ['positive', 'question', 'negative', 'ooo', 'referral', 'neutral'] as const,
  },
  summary: {
    description: '1-2 sentence summary of what they said',
    type: 'string',
    required: true,
  },
  key_points: {
    description: 'Important points from their reply',
    type: 'string[]',
    required: true,
  },
  urgency: {
    description: 'How urgently this needs attention',
    type: 'string',
    required: true,
    enumValues: ['high', 'medium', 'low'] as const,
  },
  next_action: {
    description: 'Specific action to take next',
    type: 'string',
    required: true,
  },
  suggested_response: {
    description: 'Draft response following brand voice (N/A for negative/ooo)',
    type: 'string',
    required: false,
    default: '',
  },
  return_date: {
    description: 'Return date in YYYY-MM-DD if OOO, otherwise N/A',
    type: 'string',
    required: false,
    default: 'N/A',
  },
  referred_contact: {
    description: 'Name/email of referred person if referral, otherwise N/A',
    type: 'string',
    required: false,
    default: 'N/A',
  },
} as const satisfies SchemaMap;

export const REPLY_ANALYSIS_DEFAULTS = {
  sentiment: 'neutral',
  summary: 'Reply received',
  key_points: [] as string[],
  urgency: 'medium',
  next_action: 'Review reply',
  suggested_response: '',
  return_date: 'N/A',
  referred_contact: 'N/A',
};

// ─── execute-task.ts (decision phase) ───────────────────────────────

export const TASK_DECISION_SCHEMA = {
  decision: {
    description: 'What to do with this task',
    type: 'string',
    required: true,
    enumValues: ['EXECUTE', 'DECLINE', 'RESCHEDULE', 'SKIP'] as const,
  },
  reason: {
    description: '1-2 sentence explanation',
    type: 'string',
    required: true,
  },
  new_due_date: {
    description: 'New due date if rescheduling (YYYY-MM-DD), otherwise N/A',
    type: 'string',
    required: false,
    default: 'N/A',
  },
  action: {
    description: 'Action to take if executing',
    type: 'string',
    required: false,
    enumValues: ['send_email', 'add_note', 'notify_slack'] as const,
    default: 'add_note',
  },
  subject: {
    description: 'Email subject if sending email',
    type: 'string',
    required: false,
    default: '',
  },
  body: {
    description: 'Email body or note content',
    type: 'string',
    required: false,
    default: '',
  },
  angle: {
    description: 'Personalization angle used',
    type: 'string',
    required: false,
    default: '',
  },
} as const satisfies SchemaMap;

export const TASK_DECISION_DEFAULTS = {
  decision: 'decline',
  reason: 'No reason provided.',
  new_due_date: 'N/A',
  action: 'add_note',
  subject: '',
  body: '',
  angle: '',
};

// ─── research-company.ts ────────────────────────────────────────────

export const COMPANY_RESEARCH_SCHEMA = {
  company_summary: {
    description: '2-3 sentence summary of the company and recent activity',
    type: 'string',
    required: true,
  },
  key_news: {
    description: 'Top 3 recent news items as an array of strings',
    type: 'string[]',
    required: true,
  },
  buying_signals: {
    description: 'Buying signals found: funding, hiring, expansion, etc.',
    type: 'string[]',
    required: true,
  },
  competitive_landscape: {
    description: 'Competitors or tools mentioned',
    type: 'string[]',
    required: true,
  },
  personalization_angles: {
    description: '3 specific angles for outreach emails based on this research',
    type: 'string[]',
    required: true,
  },
} as const satisfies SchemaMap;

export const COMPANY_RESEARCH_DEFAULTS = {
  company_summary: '',
  key_news: [] as string[],
  buying_signals: [] as string[],
  competitive_landscape: [] as string[],
  personalization_angles: [] as string[],
};

// ─── source-contacts.ts ─────────────────────────────────────────────

export const CONTACT_SOURCING_SCHEMA = {
  roles: {
    description: 'Array of role objects with title, priority (1-5), and reason',
    type: 'string[]',
    required: true,
  },
} as const satisfies SchemaMap;

export const CONTACT_SOURCING_DEFAULTS = {
  roles: [] as string[],
};

// ─── account-strategy.ts ─────────────────────────────────────────────

export const ACCOUNT_STRATEGY_SCHEMA = {
  account_stage: {
    description: 'Current account stage based on all contacts and signals',
    type: 'string',
    required: true,
    enumValues: ['new_target', 'researching', 'prospecting', 'multi_threaded', 'engaged', 'opportunity', 'customer', 'churned', 'blocked'] as const,
  },
  account_health: {
    description: 'Overall account health assessment',
    type: 'string',
    required: true,
    enumValues: ['healthy', 'at_risk', 'stalled', 'blocked'] as const,
  },
  coordination_flags: {
    description: 'Active coordination flags that should gate outreach decisions',
    type: 'string[]',
    required: true,
  },
  contact_summaries: {
    description: 'Brief status summary for each contact: "email | role | sequence status | last engagement | sentiment"',
    type: 'string[]',
    required: true,
  },
  recommended_actions: {
    description: 'Prioritized list of next actions: "contact_email | action | rationale | priority"',
    type: 'string[]',
    required: true,
  },
  angle_blacklist: {
    description: 'Angles/topics to AVOID in outreach (e.g. growth during layoffs, cold intro at engaged account)',
    type: 'string[]',
    required: false,
    default: [],
  },
  angle_recommendations: {
    description: 'Angles/topics to USE in outreach based on account context',
    type: 'string[]',
    required: false,
    default: [],
  },
  strategy_summary: {
    description: '3-5 sentence strategy for this account: what stage, what is working, what to do next, risks/blockers',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const ACCOUNT_STRATEGY_DEFAULTS = {
  account_stage: 'new_target',
  account_health: 'healthy',
  coordination_flags: [] as string[],
  contact_summaries: [] as string[],
  recommended_actions: [] as string[],
  angle_blacklist: [] as string[],
  angle_recommendations: [] as string[],
  strategy_summary: '',
};
