import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import type { GeneratedEmail } from '../types.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { OUTREACH_EMAIL_SCHEMA, OUTREACH_EMAIL_DEFAULTS, ECOMMERCE_VARIABLES_SCHEMA, ECOMMERCE_VARIABLES_DEFAULTS } from '../lib/llm-schemas.js';
import { validateEmailHtml } from '../lib/email-html.js';
import { getCadence, type CadenceDefinition, ACCOUNT_STRATEGY_CONFIG, SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { AGENT_MODE } from '../config/prospecting.config.js';
import { accountPreflight } from './account-preflight.js';
import { getGovernanceForRole } from '../lib/role-governance.js';
import { logger } from '../lib/logger.js';
import { workspace } from '../lib/workspace.js';
import type { SalesRoleId } from '../config/sales-roles.js';

/**
 * Assemble full context: governance + contact + company + previous outreach.
 *
 * When roleId is provided and SALES_ORG is enabled, fetches role-specific
 * governance overlays (e.g., SDR challenger tone, AE consultative tone).
 */
export async function assembleContext(email: string, roleId?: SalesRoleId): Promise<string> {
  const governanceMessage = 'brand voice, outreach playbook, ICP definition, competitor policy';

  const [governanceContent, contactDigest, companyContext, previousOutreach] = await Promise.all([
    // Use role-aware governance when available
    (roleId && SALES_ORG_CONFIG.enabled)
      ? getGovernanceForRole(roleId, governanceMessage)
      : client.context.retrieve({ message: governanceMessage, types: ['guideline'], mode: 'full' })
          .then((r) => r.data?.compiledContext || ''),
    memory.retrieveDigest({
      email,
      maxTokens: 2000,
    }),
    memory.retrieve({
      message: `company information, buying signals, account status for the company of ${email}`,
      limit: 5,
      mode: 'fast',
    }),
    memory.retrieve({
      message: `previous outreach, emails sent, responses from ${email}`,
      limit: 5,
      mode: 'fast',
    }),
  ]);

  if (!governanceContent) {
    logger.warn('Governance is empty — emails will generate without brand voice, ICP, or playbook rules. Run: npm run setup:governance');
  }

  return [
    '## GOVERNANCE\n' + (governanceContent || 'No governance configured.'),
    '## CONTACT PROFILE\n' + ((contactDigest as any)?.compiledContext || ''),
    '## COMPANY CONTEXT\n' + ((companyContext as any)?.map((r: any) => r.content).join('\n') || 'No company data.'),
    '## PREVIOUS OUTREACH\n' + ((previousOutreach as any)?.map((r: any) => r.content).join('\n') || 'No previous outreach.'),
  ].join('\n\n---\n\n');
}

/** Generate the next email in the sequence for a contact.
 *  Cadence (pace + length) is auto-selected from ICP score, or passed explicitly.
 *  When campaignId is provided, loads campaign-specific governance overrides. */
export async function generateOutreachForContact(
  email: string,
  dryRun = true,
  cadenceOverride?: CadenceDefinition,
  roleId?: SalesRoleId,
  campaignId?: string,
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
    const scoreRecall = await memory.retrieve({
      message: `ICP score signal assessment for ${email}`,
      limit: 1,
      mode: 'fast',
    });
    const scoreContent = (scoreRecall as any)?.[0]?.content || '';
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

  let context = await assembleContext(email, roleId);
  if (accountContext) {
    context = `## ACCOUNT STRATEGY CONTEXT\n${accountContext}\n\n---\n\n${context}`;
  }

  // Load campaign-specific governance overrides (takes priority over org governance)
  if (campaignId) {
    try {
      const { campaigns: campaignLib } = await import('../lib/campaign.js');
      const config = await campaignLib.getConfig(campaignId);
      if (config?.governanceOverrides?.length) {
        const campaignGov = await client.context.retrieve({
          message: config.governanceOverrides.join(', '),
          types: ['guideline'],
          mode: 'full',
        });
        if (campaignGov.data?.compiledContext) {
          context = `## CAMPAIGN GOVERNANCE (${config.name})\n${campaignGov.data.compiledContext}\n\n---\n\n${context}`;
        }
      }
    } catch (err) {
      log.warn('Campaign governance load failed, using org defaults', { campaignId, error: (err as Error).message });
    }
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

/** Generate ecommerce personalization variables for a customer.
 *  Returns structured variables (headline, paragraphs, image prompt, CTA, product recommendations)
 *  that can be injected into any ESP template (Klaviyo, Mailchimp, Braze, etc.).
 *  Uses purchase history + inferred preferences for deep personalization. */
export async function generateEcommerceVariables(
  email: string,
  campaignType: 'winback' | 'post-purchase' | 'promotional' | 'seasonal' = 'winback',
  campaignId?: string,
): Promise<import('../types.js').EcommerceVariables | null> {
  const log = logger.child({ pipeline: 'generate-ecommerce-variables' });

  // Assemble context with purchase history emphasis
  const [governanceContent, contactDigest, purchaseHistory, productCatalog] = await Promise.all([
    client.context.retrieve({ message: 'brand voice, ecommerce playbook, customer communication style', types: ['guideline'], mode: 'full' })
      .then((r) => r.data?.compiledContext || ''),
    memory.retrieveDigest({
      email,
      maxTokens: 2000,
    }),
    memory.retrieve({
      message: `all purchases, orders, products bought, shopping preferences for ${email}`,
      limit: 20,
      mode: 'fast',
    }),
    memory.retrieve({
      message: 'product catalog, new arrivals, bestsellers, product descriptions',
      limit: 20,
      mode: 'fast',
    }),
  ]);

  const purchaseContent = (purchaseHistory as any)?.map((r: any) => r.content).join('\n') || '';
  if (!purchaseContent) {
    log.info('No purchase history found, skipping variable generation', { email });
    return null;
  }

  let context = [
    '## GOVERNANCE\n' + (governanceContent || 'No governance configured.'),
    '## CUSTOMER PROFILE\n' + ((contactDigest as any)?.compiledContext || ''),
    '## PURCHASE HISTORY\n' + purchaseContent,
    '## PRODUCT CATALOG\n' + ((productCatalog as any)?.map((r: any) => r.content).join('\n') || 'No catalog data.'),
  ].join('\n\n---\n\n');

  // Load campaign-specific governance if provided
  if (campaignId) {
    try {
      const { campaigns: campaignLib } = await import('../lib/campaign.js');
      const config = await campaignLib.getConfig(campaignId);
      if (config?.governanceOverrides?.length) {
        const campaignGov = await client.context.retrieve({
          message: config.governanceOverrides.join(', '),
          types: ['guideline'],
          mode: 'full',
        });
        if (campaignGov.data?.compiledContext) {
          context = `## CAMPAIGN GOVERNANCE (${config.name})\n${campaignGov.data.compiledContext}\n\n---\n\n${context}`;
        }
      }
    } catch (err) {
      log.warn('Campaign governance load failed', { campaignId, error: (err as Error).message });
    }
  }

  const campaignPrompts: Record<string, string> = {
    winback: `This is a WIN-BACK email. The customer hasn't purchased recently. Make them feel remembered, not guilt-tripped. Reference their SPECIFIC past purchases and preferences. Create excitement about what's new that matches their taste. The tone should be warm and personal — like a favorite store clerk who remembers them.`,
    'post-purchase': `This is a POST-PURCHASE email. The customer just bought something. Help them get value from their purchase and naturally introduce complementary products. The tone should be helpful, not pushy. Reference their specific order.`,
    promotional: `This is a PROMOTIONAL email. Feature products that match this customer's specific style, price range, and category preferences. Make it feel curated FOR THEM, not a blast. Reference their purchase history to justify why these picks matter.`,
    seasonal: `This is a SEASONAL campaign. Connect the season/occasion to this customer's specific style and preferences. Reference past purchases to make seasonal picks feel personal, not generic.`,
  };

  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this customer deeply. Identify: their style profile, favorite categories, price sensitivity, what they've been buying, what they haven't tried yet, and what would genuinely excite them. Note any patterns (seasonal buying, brand loyalty, category expansion).`,
        maxSteps: 2,
      },
      {
        prompt: `Generate personalized email variables for this customer.

${campaignPrompts[campaignType] || campaignPrompts.winback}

IMPORTANT:
- Every variable must reference something SPECIFIC about THIS customer (not generic marketing copy)
- Product recommendations must come from the catalog AND match their style/price tier
- The image prompt should describe a lifestyle scene matching their aesthetic
- Subject line must be personal enough that they stop scrolling

${buildJsonInstruction(ECOMMERCE_VARIABLES_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
    evaluate: true,
    evaluationCriteria: `Variables must: (1) reference at least 2 specific facts about the customer's purchase history or preferences, (2) follow brand voice, (3) include product recommendations from the actual catalog, (4) not invent purchases or facts, (5) feel personal — not like a template.`,
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, ECOMMERCE_VARIABLES_SCHEMA, ECOMMERCE_VARIABLES_DEFAULTS);

  if (usedFallback) {
    log.warn('LLM returned non-JSON, used regex fallback', { email });
  }
  if (errors.length > 0) {
    log.warn('Parse warnings', { email, warnings: errors.join(', ') });
  }

  if (!parsed.headline || !parsed.short_paragraph) {
    log.error('Variable generation produced empty output', { email, rawOutput: output.substring(0, 500) });
    return null;
  }

  log.info('Ecommerce variables generated', { email, campaignType, angle: parsed.angle, products: parsed.product_recommendations.length });

  return {
    email,
    campaignType,
    headline: parsed.headline,
    subheadline: parsed.subheadline,
    shortParagraph: parsed.short_paragraph,
    longParagraph: parsed.long_paragraph,
    imagePrompt: parsed.image_prompt,
    ctaText: parsed.cta_text,
    productRecommendations: parsed.product_recommendations,
    angle: parsed.angle,
    subjectLine: parsed.subject_line,
    previewText: parsed.preview_text,
  };
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
