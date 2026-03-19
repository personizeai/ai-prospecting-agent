import { client, aiOptions } from '../config.js';
import type { GeneratedEmail } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { OUTREACH_EMAIL_SCHEMA, OUTREACH_EMAIL_DEFAULTS } from '../lib/llm-schemas.js';
import { validateEmailHtml } from '../lib/email-html.js';
import { getCadence, type CadenceDefinition, ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { AGENT_MODE } from '../config/prospecting.config.js';
import { accountPreflight } from './account-preflight.js';
import { logger } from '../lib/logger.js';
import { workspace } from '../lib/workspace.js';

/** Assemble full context: governance + contact + company + previous outreach. */
export async function assembleContext(email: string): Promise<string> {
  const [guidelines, contactDigest, companyContext, previousOutreach] = await Promise.all([
    client.ai.smartGuidelines({
      message: 'brand voice, outreach playbook, ICP definition, competitor policy',
      mode: 'full',
    }),
    client.memory.smartDigest({
      email,
      type: 'Contact',
      token_budget: 2000,
    }),
    client.memory.recall({
      message: `company information, buying signals, account status for the company of ${email}`,
      type: 'Company',
      limit: 5,
    }),
    client.memory.recall({
      message: `previous outreach, emails sent, responses from ${email}`,
      limit: 5,
    }),
  ]);

  const governanceContent = guidelines.data?.compiledContext || '';
  if (!governanceContent) {
    logger.warn('Governance is empty — emails will generate without brand voice, ICP, or playbook rules. Run: npm run setup:governance');
  }

  return [
    '## GOVERNANCE\n' + (governanceContent || 'No governance configured.'),
    '## CONTACT PROFILE\n' + (contactDigest.data?.compiledContext || ''),
    '## COMPANY CONTEXT\n' + (companyContext.data?.map((r: any) => r.content).join('\n') || 'No company data.'),
    '## PREVIOUS OUTREACH\n' + (previousOutreach.data?.map((r: any) => r.content).join('\n') || 'No previous outreach.'),
  ].join('\n\n---\n\n');
}

/** Generate the next email in the sequence for a contact.
 *  Cadence (pace + length) is auto-selected from ICP score, or passed explicitly. */
export async function generateOutreachForContact(
  email: string,
  dryRun = true,
  cadenceOverride?: CadenceDefinition,
): Promise<GeneratedEmail | null> {
  const log = logger.child({ pipeline: 'generate-outreach' });

  // ── Account pre-flight check ──────────────────────────────────────
  let accountContext = '';
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const preflight = await accountPreflight(email);

    if (preflight.decision === 'block') {
      log.info('Account preflight BLOCKED', { email, reason: preflight.reason });
      return null;
    }

    if (preflight.decision === 'delay') {
      log.info('Account preflight DELAYED', { email, reason: preflight.reason, retryAfter: preflight.retryAfter });
      return null;
    }

    if (preflight.decision === 'modify' && preflight.modifications) {
      log.info('Account preflight MODIFIED', { email, reason: preflight.reason });

      // Apply cadence override from account strategy
      if (preflight.modifications.cadenceOverride && !cadenceOverride) {
        // Warm intro cadence: fewer emails, longer gaps
        cadenceOverride = { maxEmails: preflight.modifications.maxEmails || 2, waitDays: [5], label: preflight.modifications.cadenceOverride };
      }

      // Collect account context to inject into outreach generation
      if (preflight.modifications.accountContext) {
        accountContext = preflight.modifications.accountContext;
      }

      // Angle modifications will be injected into the prompt below
      if (preflight.modifications.angleBlacklist?.length) {
        accountContext += `\nANGLE BLACKLIST (do NOT use these angles): ${preflight.modifications.angleBlacklist.join(', ')}`;
      }
      if (preflight.modifications.angleRecommendations?.length) {
        accountContext += `\nRECOMMENDED ANGLES: ${preflight.modifications.angleRecommendations.join(', ')}`;
      }
    }
  }

  // Resolve cadence — use override if provided, otherwise look up ICP score
  let cadence = cadenceOverride;
  if (!cadence) {
    const scoreRecall = await client.memory.recall({
      message: `ICP score signal assessment for ${email}`,
      limit: 1,
    });
    const scoreContent = scoreRecall.data?.[0]?.content || '';
    const scoreMatch = scoreContent.match(/icp_fit_score[":]*\s*(\d+)/i);
    const icpScore = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
    cadence = getCadence(icpScore);
  }

  const contactState = await workspace.getSequenceState(email);

  if (contactState.emailsSent >= cadence.maxEmails) {
    log.info('Sequence complete, skipping', { email, sent: cadence.maxEmails, max: cadence.maxEmails });
    return null;
  }

  // Draft gate: a manual-hubspot task was created but the human hasn't sent it yet.
  // Don't generate the next email until this step is confirmed sent.
  if (contactState.hasDraftAtStep !== null) {
    const nextExpected = contactState.hasDraftAtStep + 1;
    if (contactState.emailsSent < nextExpected) {
      log.info('Draft pending human send, skipping generation', {
        email,
        draftAtStep: contactState.hasDraftAtStep,
      });
      return null;
    }
  }

  // Timing gap check (backup safety — Trigger.dev wait.for() handles this in durable sequences)
  if (contactState.lastSentAt) {
    const lastSentTime = new Date(contactState.lastSentAt).getTime();
    if (isNaN(lastSentTime)) {
      log.info('Invalid lastSentAt date, proceeding cautiously', { email, lastSentAt: contactState.lastSentAt });
    } else {
      const daysSince = (Date.now() - lastSentTime) / (1000 * 60 * 60 * 24);
      const minGap = cadence.waitDays[contactState.emailsSent - 1] ?? cadence.waitDays[cadence.waitDays.length - 1];
      if (daysSince < minGap) {
        log.info('Too soon to send next email, skipping', { email, daysSince: Number(daysSince.toFixed(1)), minGap });
        return null;
      }
    }
  }

  const nextStep = contactState.emailsSent + 1;
  log.info('Generating email', { email, step: nextStep, maxEmails: cadence.maxEmails, cadence: cadence.label });

  let context = await assembleContext(email);
  if (accountContext) {
    context = `## ACCOUNT STRATEGY CONTEXT\n${accountContext}\n\n---\n\n${context}`;
  }

  // Use agent mode terminology for multi-vertical support
  const t = AGENT_MODE.terminology;
  const entityLabel = t.entity; // e.g., "prospect", "member", "candidate", "donor"
  const actionLabel = t.action; // e.g., "prospecting", "outreach", "follow-up", "nurture"
  const conversionLabel = t.conversion; // e.g., "deal", "appointment", "renewal", "enrollment"

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze the ${entityLabel} and their ${t.organization}. Identify: their role, likely pain points, strongest personalization angle, and what signals exist. If previous emails were sent, note what angles were used so we don't repeat. If the ${entityLabel} opened or clicked previous emails, note which topics or links engaged them — prioritize those angles.`,
        maxSteps: 2,
      },
      {
        prompt: `Generate Email ${nextStep} of ${cadence.maxEmails} for this ${entityLabel}. This is a ${actionLabel} sequence (${cadence.label}).
${nextStep === 1 ? `Email 1: Specific observation about them/their ${t.organization} + our value prop + soft CTA. Max 150 words.` : ''}
${nextStep === 2 ? `Email 2: Different angle/insight than Email 1 + how it relates to their situation + medium CTA. Max 120 words. Reference Email 1 existence but don't repeat its content. If they opened or clicked Email 1, lean into the topic that engaged them.` : ''}
${nextStep >= 3 && nextStep < cadence.maxEmails ? `Email ${nextStep}: New angle, build on previous touches. If they showed engagement (opens/clicks), reference those signals. Medium CTA. Max 120 words.` : ''}
${nextStep === cadence.maxEmails ? `Email ${nextStep} (final): Brief and direct. One final compelling reason + binary yes/no CTA. Max 100 words.` : ''}

${buildJsonInstruction(OUTREACH_EMAIL_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
    evaluate: true,
    evaluationCriteria: `Email must: (1) reference at least 1 specific fact about the ${entityLabel}/${t.organization} from context, (2) follow brand voice guidelines, (3) have a single clear CTA, (4) stay within word limit, (5) not repeat angles from previous emails, (6) not invent any claims or stats.`,
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, OUTREACH_EMAIL_SCHEMA, OUTREACH_EMAIL_DEFAULTS);

  if (usedFallback) {
    log.warn('LLM returned non-JSON output, used regex fallback', { email });
  }
  if (errors.length > 0) {
    log.warn('Parse warnings', { email, warnings: errors.join(', ') });
  }

  const subject = parsed.subject;
  const bodyText = parsed.body_text;
  const angle = parsed.angle;

  // Sanitize HTML — strip disallowed tags, ensure safe output
  const htmlResult = validateEmailHtml(parsed.body_html);
  const bodyHtml = htmlResult.sanitized;
  if (!htmlResult.valid) {
    log.warn('HTML sanitized', { email, errors: htmlResult.errors.join(', ') });
  }

  // Guard: never send a blank email
  if (!subject || !bodyText) {
    log.error('LLM output parsing failed', { email, rawOutput: output.substring(0, 500) });
    return null;
  }

  if (dryRun) {
    log.info('Dry run output', { email, subject, angle, bodyText });
  }

  return { email, step: nextStep, subject, bodyHtml, bodyText, angle };
}

/** Generate a 30-second cold call opening script for a contact. */
export async function generateCallScript(email: string) {
  const context = await assembleContext(email);

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Generate a 30-second cold call opening script for this prospect. Include:
OPENER: [first 2 sentences — who you are + why calling]
HOOK: [1 sentence connecting to their specific situation]
ASK: [1 sentence — the meeting request]
OBJECTION_HANDLERS: [2-3 common objections with 1-sentence responses]

Keep it conversational, not scripted-sounding. Reference specific facts from their profile.`,
        maxSteps: 3,
      },
    ],
  });

  return String(result.data || '');
}
