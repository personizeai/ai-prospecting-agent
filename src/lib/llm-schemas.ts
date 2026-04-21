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

// ─── generate-linkedin-message.ts ──────────────────────────────────────

export const LINKEDIN_MESSAGE_SCHEMA = {
  type: {
    description: 'Message type: connection_request, inmail, or message',
    type: 'string',
    required: true,
    enumValues: ['connection_request', 'inmail', 'message'] as const,
  },
  message: {
    description: 'The LinkedIn message text. Connection requests max 300 chars, messages max 500 chars.',
    type: 'string',
    required: true,
  },
  angle: {
    description: '1-sentence description of the personalization angle used',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const LINKEDIN_MESSAGE_DEFAULTS = {
  type: 'connection_request',
  message: '',
  angle: '',
};

// ─── generate-call-script.ts ────────────────────────────────────────

export const CALL_SCRIPT_SCHEMA = {
  opener: {
    description: '2 sentences: who you are + why calling. Natural, not scripted.',
    type: 'string',
    required: true,
  },
  hook: {
    description: '1 sentence connecting to their specific situation (reference a fact).',
    type: 'string',
    required: true,
  },
  ask: {
    description: '1 sentence — the meeting request. Clear and direct.',
    type: 'string',
    required: true,
  },
  objection_handlers: {
    description: 'Array of "objection | response" strings, 2-3 entries',
    type: 'string[]',
    required: true,
  },
  human_playbook: {
    description: 'Short playbook for human callers: mindset, pacing, do\'s and don\'ts, when to pivot. 3-5 bullet points.',
    type: 'string',
    required: true,
  },
  ai_caller_script: {
    description: 'Full verbatim script for AI voice callers (Bland.ai/Vapi). Include greeting, pitch, objection handling, and close. Conversational tone, complete sentences.',
    type: 'string',
    required: true,
  },
  angle: {
    description: '1-sentence description of the personalization angle used',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const CALL_SCRIPT_DEFAULTS = {
  opener: '',
  hook: '',
  ask: '',
  objection_handlers: [] as string[],
  human_playbook: '',
  ai_caller_script: '',
  angle: '',
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

// ─── analyze-call.ts ─────────────────────────────────────────────────

export const CALL_ANALYSIS_SCHEMA = {
  outcome: {
    description: 'Overall call outcome',
    type: 'string',
    required: true,
    enumValues: ['interested', 'meeting_booked', 'not_interested', 'callback_requested', 'voicemail', 'no_answer', 'wrong_person', 'neutral'] as const,
  },
  summary: {
    description: '2-3 sentence summary of what happened on the call',
    type: 'string',
    required: true,
  },
  key_points: {
    description: 'Key topics discussed or mentioned by the contact',
    type: 'string[]',
    required: true,
  },
  sentiment: {
    description: 'Contact sentiment during the call',
    type: 'string',
    required: true,
    enumValues: ['positive', 'neutral', 'negative'] as const,
  },
  urgency: {
    description: 'How urgently follow-up is needed',
    type: 'string',
    required: true,
    enumValues: ['high', 'medium', 'low'] as const,
  },
  next_action: {
    description: 'Specific next action to take (e.g., "Send calendar link", "Add to nurture", "Do not contact")',
    type: 'string',
    required: true,
  },
  objections_raised: {
    description: 'Objections the contact raised during the call',
    type: 'string[]',
    required: false,
    default: [],
  },
  callback_time: {
    description: 'If callback requested, when (e.g., "next Tuesday", "after Q1"). N/A otherwise.',
    type: 'string',
    required: false,
    default: 'N/A',
  },
  referred_contact: {
    description: 'If referred to another person, their name/title. N/A otherwise.',
    type: 'string',
    required: false,
    default: 'N/A',
  },
} as const satisfies SchemaMap;

export const CALL_ANALYSIS_DEFAULTS = {
  outcome: 'neutral',
  summary: 'Call completed',
  key_points: [] as string[],
  sentiment: 'neutral',
  urgency: 'medium',
  next_action: 'Review call transcript',
  objections_raised: [] as string[],
  callback_time: 'N/A',
  referred_contact: 'N/A',
};

// ─── generate-interview-guide.ts ────────────────────────────────────

export const INTERVIEW_GUIDE_SCHEMA = {
  opening: {
    description: 'Interview opening: introduce yourself, explain the purpose, ask for recording consent, build rapport. 3-5 sentences, warm and professional.',
    type: 'string',
    required: true,
  },
  topics: {
    description: 'Array of topic objects as JSON strings: {"topic":"...","objective":"...","primary_question":"...","probes":["..."],"max_minutes":5}. Order by priority. 4-6 topics.',
    type: 'string[]',
    required: true,
  },
  closing: {
    description: 'Interview closing: thank them, summarize what you heard, explain next steps, ask if they have questions. 3-4 sentences.',
    type: 'string',
    required: true,
  },
  ai_interviewer_prompt: {
    description: 'Full system prompt for the AI voice agent conducting the interview. Include: role, tone, pacing, how to probe deeper, how to handle tangents, when to move on, how to wrap up. Must be self-contained.',
    type: 'string',
    required: true,
  },
  knowledge_gaps: {
    description: 'What we do NOT know about this contact that this interview should fill. Array of specific gaps.',
    type: 'string[]',
    required: true,
  },
} as const satisfies SchemaMap;

export const INTERVIEW_GUIDE_DEFAULTS = {
  opening: '',
  topics: [] as string[],
  closing: '',
  ai_interviewer_prompt: '',
  knowledge_gaps: [] as string[],
};

// ─── analyze-interview.ts ───────────────────────────────────────────

export const INTERVIEW_ANALYSIS_SCHEMA = {
  quality: {
    description: 'Overall interview quality based on depth and completeness of answers',
    type: 'string',
    required: true,
    enumValues: ['excellent', 'good', 'partial', 'poor'] as const,
  },
  summary: {
    description: '3-5 sentence executive summary of the interview: who, what was discussed, key takeaways, recommended action',
    type: 'string',
    required: true,
  },
  topic_findings: {
    description: 'Array of per-topic findings as JSON strings: {"topic":"...","finding":"...","quotes":["..."],"confidence":"high|medium|low"}',
    type: 'string[]',
    required: true,
  },
  budget: {
    description: 'Budget information extracted (amount, range, or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  authority: {
    description: 'Decision-making authority: who decides, who influences, approval process (or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  need: {
    description: 'Core need or pain point identified (or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  timeline: {
    description: 'Purchase/decision timeline mentioned (or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  decision_process: {
    description: 'How decisions are made: committee, single buyer, procurement process (or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  metrics: {
    description: 'Success metrics or KPIs the contact cares about (or "not discussed")',
    type: 'string',
    required: false,
    default: 'not discussed',
  },
  champion: {
    description: 'Internal champion identified: name, title, level of advocacy (or "not identified")',
    type: 'string',
    required: false,
    default: 'not identified',
  },
  competitive_intel: {
    description: 'Competitors mentioned: "competitor_name | context". Array of pipe-separated strings.',
    type: 'string[]',
    required: false,
    default: [],
  },
  product_feedback: {
    description: 'Feature requests, product feedback, or wishlist items mentioned',
    type: 'string[]',
    required: false,
    default: [],
  },
  concerns: {
    description: 'Objections, concerns, or blockers raised by the contact',
    type: 'string[]',
    required: false,
    default: [],
  },
  sentiment_arc: {
    description: 'How the contact sentiment changed over the interview',
    type: 'string',
    required: true,
    enumValues: ['warming', 'steady_positive', 'steady_neutral', 'cooling', 'mixed'] as const,
  },
  next_steps: {
    description: 'Recommended next steps based on what was learned. 2-4 specific actions.',
    type: 'string[]',
    required: true,
  },
  sentiment: {
    description: 'Overall contact sentiment during the interview',
    type: 'string',
    required: true,
    enumValues: ['positive', 'neutral', 'negative'] as const,
  },
  urgency: {
    description: 'How urgently follow-up is needed based on interview findings',
    type: 'string',
    required: true,
    enumValues: ['high', 'medium', 'low'] as const,
  },
} as const satisfies SchemaMap;

export const INTERVIEW_ANALYSIS_DEFAULTS = {
  quality: 'partial',
  summary: 'Interview completed',
  topic_findings: [] as string[],
  budget: 'not discussed',
  authority: 'not discussed',
  need: 'not discussed',
  timeline: 'not discussed',
  decision_process: 'not discussed',
  metrics: 'not discussed',
  champion: 'not identified',
  competitive_intel: [] as string[],
  product_feedback: [] as string[],
  concerns: [] as string[],
  sentiment_arc: 'steady_neutral',
  next_steps: [] as string[],
  sentiment: 'neutral',
  urgency: 'medium',
};

// ─── infer-preferences.ts (ecommerce) ─────────────────────────

export const PREFERENCE_INFERENCE_SCHEMA = {
  style_preferences: {
    description: 'Detailed style profile: aesthetic, colors, materials, brand affinity. Be specific, e.g., "minimalist streetwear with earth tones and sustainable materials".',
    type: 'string',
    required: true,
  },
  price_tier: {
    description: 'Typical price range based on actual purchase amounts',
    type: 'string',
    required: true,
    enumValues: ['Budget', 'Mid-Range', 'Premium', 'Luxury'] as const,
  },
  customer_segment: {
    description: 'Behavioral segment based on recency, frequency, monetary value',
    type: 'string',
    required: true,
    enumValues: ['New', 'Active', 'Loyal', 'VIP', 'At-Risk', 'Lapsed', 'Win-Back'] as const,
  },
  category_affinity: {
    description: 'Comma-separated list of preferred categories ranked by purchase frequency',
    type: 'string',
    required: true,
  },
  purchase_frequency: {
    description: 'How often this customer buys (e.g., "monthly", "every 2-3 months", "seasonal")',
    type: 'string',
    required: true,
  },
  recommended_product_ids: {
    description: 'Product IDs from catalog that match their style but they have not purchased yet. 3-5 items.',
    type: 'string[]',
    required: true,
  },
} as const satisfies SchemaMap;

export const PREFERENCE_INFERENCE_DEFAULTS = {
  style_preferences: '',
  price_tier: 'Mid-Range',
  customer_segment: 'Active',
  category_affinity: '',
  purchase_frequency: '',
  recommended_product_ids: [] as string[],
};

// ─── generate-outreach.ts (ecommerce variable mode) ───────────

export const ECOMMERCE_VARIABLES_SCHEMA = {
  headline: {
    description: 'Primary headline, 5-12 words, emotionally compelling. Reference their specific style or last purchase.',
    type: 'string',
    required: true,
  },
  subheadline: {
    description: '1 sentence connecting to their personal style or purchase pattern.',
    type: 'string',
    required: true,
  },
  short_paragraph: {
    description: '2-3 sentences. The hook — why this matters to THEM specifically. Reference purchases, preferences, or timing.',
    type: 'string',
    required: true,
  },
  long_paragraph: {
    description: '4-6 sentences. The story — product recommendations with context, social proof, or seasonal relevance. Personal and specific.',
    type: 'string',
    required: true,
  },
  image_prompt: {
    description: 'AI image generation prompt for a lifestyle hero image. Describe scene, mood, lighting, style. Reference their aesthetic.',
    type: 'string',
    required: true,
  },
  cta_text: {
    description: 'Call-to-action button text. 2-5 words, action-oriented, specific to the offer.',
    type: 'string',
    required: true,
  },
  product_recommendations: {
    description: 'Array of recommended product IDs from catalog, ordered by relevance to this customer.',
    type: 'string[]',
    required: true,
  },
  angle: {
    description: '1-sentence description of the personalization angle used',
    type: 'string',
    required: true,
  },
  subject_line: {
    description: 'Email subject line, under 60 characters. Personal, not generic.',
    type: 'string',
    required: true,
  },
  preview_text: {
    description: 'Email preview text (shows after subject in inbox), 40-90 characters. Complements subject, adds intrigue.',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const ECOMMERCE_VARIABLES_DEFAULTS = {
  headline: '',
  subheadline: '',
  short_paragraph: '',
  long_paragraph: '',
  image_prompt: '',
  cta_text: 'Shop Now',
  product_recommendations: [] as string[],
  angle: '',
  subject_line: '',
  preview_text: '',
};

// ─── LinkedIn Event Analysis Schema ───────────────────────────────

export const LINKEDIN_EVENT_ANALYSIS_SCHEMA = {
  outcome: {
    description: 'Classification of the LinkedIn event significance',
    type: 'string',
    required: true,
    enumValues: ['interested', 'not_interested', 'question', 'referral', 'neutral', 'positive_signal'] as const,
  },
  summary: {
    description: '1-2 sentence summary of the event and its significance',
    type: 'string',
    required: true,
  },
  key_points: {
    description: 'Key points from the message (empty for non-message events)',
    type: 'string[]',
    required: true,
  },
  sentiment: {
    description: 'Contact sentiment',
    type: 'string',
    required: true,
    enumValues: ['positive', 'neutral', 'negative'] as const,
  },
  urgency: {
    description: 'How urgently follow-up is needed',
    type: 'string',
    required: true,
    enumValues: ['high', 'medium', 'low'] as const,
  },
  next_action: {
    description: 'Specific next action to take',
    type: 'string',
    required: true,
  },
} as const satisfies SchemaMap;

export const LINKEDIN_EVENT_ANALYSIS_DEFAULTS = {
  outcome: 'neutral',
  summary: 'LinkedIn event received',
  key_points: [] as string[],
  sentiment: 'neutral',
  urgency: 'low',
  next_action: 'Review LinkedIn activity',
};
