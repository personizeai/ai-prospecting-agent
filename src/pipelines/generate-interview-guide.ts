/**
 * Interview Guide Generation Pipeline
 *
 * Generates a dynamic interview guide tailored to the contact, purpose, and
 * what we already know (vs. what gaps remain). Unlike cold call scripts
 * (linear, pitch-oriented), interview guides are discovery-oriented with
 * branching topics and probing questions.
 *
 * Supported purposes:
 *   - discovery:          BANT/MEDDIC qualification after initial interest
 *   - win_loss:           Post-deal analysis — why they bought or didn't
 *   - customer_health:    Periodic check-in for churn prevention
 *   - feature_validation: Quick customer pulse on product direction
 *   - nps_followup:       Deep-dive after NPS score
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { INTERVIEW_CONFIG, ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { assembleContext } from './generate-outreach.js';
import { accountPreflight } from './account-preflight.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { INTERVIEW_GUIDE_SCHEMA, INTERVIEW_GUIDE_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';
import { workspace } from '../lib/workspace.js';
import type { InterviewGuide, InterviewPurpose, InterviewTopic } from '../types.js';

const log = logger.child({ pipeline: 'generate-interview-guide' });

const PURPOSE_LABELS: Record<InterviewPurpose, string> = {
  discovery: 'Discovery / Qualification Interview',
  win_loss: 'Win/Loss Analysis Interview',
  customer_health: 'Customer Health Check',
  feature_validation: 'Feature Validation Interview',
  nps_followup: 'NPS Follow-Up Interview',
};

const PURPOSE_FOCUS: Record<InterviewPurpose, string> = {
  discovery: `Focus on BANT/MEDDIC: Budget, Authority, Need, Timeline, Decision Process, Metrics, Champion.
Understand their current situation, pain points, what they've tried, and what would make them act now.
Do NOT pitch — listen, probe, and qualify.`,
  win_loss: `Focus on the decision journey: what triggered the evaluation, who was involved, what alternatives they considered,
what tipped the decision, what almost derailed it, and what they'd tell peers considering the same choice.
Be neutral — we want honest feedback, not validation.`,
  customer_health: `Focus on satisfaction, adoption, value realization, and risk signals.
Ask about: what's working well, what's frustrating, upcoming changes that might affect usage,
whether they'd recommend us, and what would make the partnership stronger.`,
  feature_validation: `Focus on specific product direction questions. Understand their workflow,
where they hit friction, what they'd build if they could, and how they'd prioritize improvements.
Use concrete scenarios rather than abstract feature descriptions.`,
  nps_followup: `The contact gave an NPS score. Understand WHY: what drove the score,
what specific experiences shaped their perception, what one thing would change their rating,
and whether their sentiment is trending up or down.`,
};

/** Get contact details from Personize memory. */
async function getContactDetails(email: string): Promise<{
  name: string;
  title: string;
  phone: string;
} | null> {
  const digest = await memory.retrieveDigest({
    email,
    maxTokens: 500,
  });

  const props = (digest as any)?.properties || {};
  const firstName = props.first_name?.value || '';
  const lastName = props.last_name?.value || '';
  const name = `${firstName} ${lastName}`.trim() || 'Unknown';
  const title = props.job_title?.value || 'Unknown';
  const phone = props.phone_number?.value || '';

  if (!phone) return null;

  return { name, title, phone };
}

/** Check if we already conducted an interview for this purpose. */
async function hasExistingInterview(email: string, purpose: InterviewPurpose): Promise<boolean> {
  const history = await memory.retrieve({
    message: `interview ${purpose} for ${email}`,
    limit: 5,
    mode: 'fast',
  });

  for (const item of (history as any) || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('[INTERVIEW GUIDE') && content.includes(purpose.toUpperCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Generate an interview guide for a contact.
 *
 * @param email - Contact email
 * @param purpose - Interview purpose (discovery, win_loss, etc.)
 * @param additionalContext - Extra context (e.g., NPS score, deal outcome)
 * @param dryRun - If true, don't memorize the guide
 */
export async function generateInterviewGuide(
  email: string,
  purpose: InterviewPurpose,
  additionalContext = '',
  dryRun = true,
): Promise<InterviewGuide | null> {
  if (!INTERVIEW_CONFIG.enabled) {
    log.info('Interview module disabled, skipping', { email });
    return null;
  }

  const contact = await getContactDetails(email);
  if (!contact) {
    log.info('No phone number, skipping interview', { email });
    return null;
  }

  // Don't repeat the same interview type
  const existing = await hasExistingInterview(email, purpose);
  if (existing) {
    log.info('Interview already conducted for this purpose', { email, purpose });
    return null;
  }

  // Account preflight
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const preflight = await accountPreflight(email);
    if (preflight.decision === 'block') {
      log.info('Account preflight blocked interview', { email, decision: preflight.decision });
      return null;
    }
  }

  const context = await assembleContext(email);
  const targetDuration = INTERVIEW_CONFIG.maxDurationMins;
  const consentClause = INTERVIEW_CONFIG.requireRecordingConsent
    ? '\nIMPORTANT: You MUST ask for explicit recording consent before starting the interview. If they decline recording, thank them and end the call gracefully.'
    : '';

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `You are preparing a ${PURPOSE_LABELS[purpose]} for ${contact.name} (${contact.title}).

Review all available context about this contact and their company. Identify:
1. What we already KNOW about them (from prior outreach, calls, enrichment)
2. What GAPS remain that this interview should fill
3. What topics are most relevant given the interview purpose

${additionalContext ? `Additional context for this interview:\n${additionalContext}\n` : ''}
Purpose-specific guidance:
${PURPOSE_FOCUS[purpose]}`,
        maxSteps: 2,
      },
      {
        prompt: `Now generate a complete ${PURPOSE_LABELS[purpose]} guide for ${contact.name} (${contact.title}).

Target duration: ${targetDuration} minutes.
${consentClause}

Requirements:
1. OPENING — Warm, professional introduction. Explain why you're calling and what you hope to learn. ${INTERVIEW_CONFIG.requireRecordingConsent ? 'Ask for recording consent.' : ''} Build rapport before diving in.

2. TOPICS — 4-6 topics ordered by priority. Each topic needs:
   - A clear objective (what insight are we trying to extract?)
   - One primary question (open-ended, not yes/no)
   - 2-3 follow-up probes (for when answers are vague or reveal something interesting)
   - Time allocation (minutes) — total should be ~${targetDuration - 4} minutes (leaving 2 min for opening, 2 for closing)

3. CLOSING — Thank them, briefly reflect back what you heard (shows you listened), explain next steps, ask if they have anything to add.

4. AI INTERVIEWER PROMPT — A complete system prompt for an AI voice agent. Must include:
   - Role and tone (curious, warm, professional — NOT salesy)
   - Pacing instructions (pause after questions, don't rush, let silence work)
   - How to probe deeper (when to ask "tell me more", "why is that important", etc.)
   - How to handle tangents (gently redirect without cutting them off)
   - How to handle if they ask about pricing/product (defer gracefully, this is about THEM)
   - Time management (how to wrap up each topic and transition)
   - Consent handling instructions
   - The full topic guide embedded so the AI knows what to cover

5. KNOWLEDGE GAPS — What we DON'T know that this interview should fill.

${buildJsonInstruction(INTERVIEW_GUIDE_SCHEMA)}`,
        maxSteps: 4,
      },
    ],
    evaluate: true,
    evaluationCriteria: 'Guide must: (1) have 4-6 topics with probing questions, (2) AI prompt must be self-contained and conversational, (3) questions must be open-ended not yes/no, (4) guide must be tailored to this specific contact and purpose, (5) time allocations must sum to roughly the target duration.',
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, INTERVIEW_GUIDE_SCHEMA, INTERVIEW_GUIDE_DEFAULTS);

  if (usedFallback) log.warn('LLM returned non-JSON, used regex fallback', { email });
  if (errors.length > 0) log.warn('Parse warnings', { email, warnings: errors.join(', ') });

  if (!parsed.opening || !parsed.closing || !parsed.ai_interviewer_prompt) {
    log.error('Incomplete interview guide from LLM', { email });
    return null;
  }

  // Parse topic objects from JSON strings
  const topics: InterviewTopic[] = (parsed.topics || []).map((entry: string) => {
    try {
      const t = typeof entry === 'string' ? JSON.parse(entry) : entry;
      return {
        topic: t.topic || 'General',
        objective: t.objective || '',
        primaryQuestion: t.primary_question || '',
        probes: Array.isArray(t.probes) ? t.probes : [],
        maxMinutes: Number(t.max_minutes) || 4,
      };
    } catch {
      return {
        topic: 'General',
        objective: '',
        primaryQuestion: entry,
        probes: [],
        maxMinutes: 4,
      };
    }
  });

  const guide: InterviewGuide = {
    email,
    contactName: contact.name,
    contactTitle: contact.title,
    phone: contact.phone,
    purpose,
    opening: parsed.opening,
    topics,
    closing: parsed.closing,
    aiInterviewerPrompt: parsed.ai_interviewer_prompt,
    targetDurationMins: targetDuration,
    knowledgeGaps: parsed.knowledge_gaps as string[],
  };

  if (!dryRun) {
    // Memorize the guide for context in future interactions
    await memory.save({
      email,
      content: [
        `[INTERVIEW GUIDE — ${purpose.toUpperCase()}]`,
        `Date: ${new Date().toISOString()}`,
        `Contact: ${contact.name} (${contact.title})`,
        `Phone: ${contact.phone}`,
        `Purpose: ${PURPOSE_LABELS[purpose]}`,
        `Target Duration: ${targetDuration} minutes`,
        '',
        `Topics: ${topics.map((t) => t.topic).join(', ')}`,
        `Knowledge Gaps: ${guide.knowledgeGaps.join(', ')}`,
      ].join('\n'),
      enhanced: true,
      tags: ['generated', 'interview', 'guide', `purpose:${purpose}`],
    });

    await workspace.addNote(email, {
      author: 'interview-guide-gen',
      content: `Interview guide generated (${PURPOSE_LABELS[purpose]}). Topics: ${topics.map((t) => t.topic).join(', ')}. Target: ${targetDuration} min.`,
      category: 'observation',
    });
  }

  log.info('Interview guide generated', {
    email,
    purpose,
    topicCount: topics.length,
    targetDuration,
    dryRun,
  });

  return guide;
}
