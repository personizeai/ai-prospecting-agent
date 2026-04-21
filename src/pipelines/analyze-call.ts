/**
 * Call Transcript Analysis Pipeline
 *
 * When an AI voice call completes, this pipeline:
 * 1. Reads the full workspace context (who is this person, what did we send)
 * 2. Memorizes the call transcript into Personize memory
 * 3. Classifies the call outcome via AI
 * 4. Takes different actions based on classification:
 *
 *    INTERESTED / MEETING_BOOKED → Create HubSpot task, Slack alert, update lead status
 *    CALLBACK_REQUESTED          → Create follow-up task with requested timing
 *    NOT_INTERESTED              → Mark opted out, stop sequences
 *    WRONG_PERSON                → Flag issue, create task to find correct contact
 *    VOICEMAIL / NO_ANSWER       → Create retry task
 *    NEUTRAL                     → Create task for rep to review transcript
 *
 * Follows the same pattern as analyze-reply.ts — workspace context + AI classification + actions.
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { workspace } from '../lib/workspace.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { evaluateAccountStrategy } from './account-strategy.js';
import { createHubSpotFollowUpTask } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { CALL_ANALYSIS_SCHEMA, CALL_ANALYSIS_DEFAULTS } from '../lib/llm-schemas.js';
import { ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';
import type { CallResult, CallAnalysis } from '../types.js';

const log = logger.child({ pipeline: 'analyze-call' });

// ─── Memorize Transcript ────────────────────────────────────────────

/**
 * Store the raw call transcript and metadata into Personize memory.
 * This ensures the next email/call/LinkedIn touch has full context.
 */
async function memorizeTranscript(result: CallResult): Promise<void> {
  const transcriptText = result.turns.length > 0
    ? result.turns.map((t) => `${t.role === 'agent' ? 'AI' : 'Contact'}: ${t.message}`).join('\n')
    : result.transcript;

  await memory.save({
    email: result.email,
    content: [
      `[CALL TRANSCRIPT — ${result.provider}]`,
      `Date: ${new Date().toISOString()}`,
      `Duration: ${result.durationSecs}s`,
      `Status: ${result.status}`,
      `Answered by: ${result.answeredBy}`,
      `Ended by: ${result.endedBy}`,
      result.summary ? `Provider Summary: ${result.summary}` : '',
      '',
      '--- TRANSCRIPT ---',
      transcriptText || '(no transcript available)',
    ].filter(Boolean).join('\n'),
    enhanced: true,
    tags: ['call', 'transcript', `provider:${result.provider}`, `status:${result.status}`],
  });

  log.info('Memorized call transcript', {
    email: result.email,
    provider: result.provider,
    durationSecs: result.durationSecs,
    status: result.status,
  });
}

// ─── Analyze ────────────────────────────────────────────────────────

/**
 * Use AI to analyze the call transcript and classify the outcome.
 */
export async function analyzeCall(result: CallResult): Promise<CallAnalysis> {
  // Short-circuit for non-connected calls
  if (result.status === 'no-answer' || result.answeredBy === 'no-answer') {
    return {
      outcome: 'no_answer',
      summary: 'Call was not answered.',
      keyPoints: [],
      sentiment: 'neutral',
      urgency: 'low',
      nextAction: 'Retry call in 1-2 business days or continue email sequence.',
      objectionsRaised: [],
    };
  }

  if (result.answeredBy === 'voicemail') {
    return {
      outcome: 'voicemail',
      summary: result.summary || 'Call went to voicemail.',
      keyPoints: [],
      sentiment: 'neutral',
      urgency: 'low',
      nextAction: 'Voicemail left. Follow up with email referencing the call attempt.',
    objectionsRaised: [],
    };
  }

  // For completed calls with a transcript, use AI analysis
  const [digest, guidelines] = await Promise.all([
    workspace.getDigest(result.email, 3000),
    client.context.retrieve({
      message: 'call handling, outreach playbook, brand voice, competitor policy',
      types: ['guideline'],
      mode: 'fast',
    }),
  ]);

  const transcriptText = result.turns.length > 0
    ? result.turns.map((t) => `${t.role === 'agent' ? 'AI' : 'Contact'}: ${t.message}`).join('\n')
    : result.transcript;

  const context = [
    '## GOVERNANCE\n' + (guidelines.data?.compiledContext || ''),
    '## LEAD WORKSPACE\n' + ((digest as any)?.compiledContext || ''),
    '## CALL DETAILS',
    `Provider: ${result.provider}`,
    `Duration: ${result.durationSecs} seconds`,
    `Answered by: ${result.answeredBy}`,
    `Ended by: ${result.endedBy}`,
    `End reason: ${result.endedReason}`,
    result.summary ? `Provider summary: ${result.summary}` : '',
    '',
    '## CALL TRANSCRIPT',
    transcriptText || '(no transcript available)',
  ].filter(Boolean).join('\n\n---\n\n');

  const aiResult = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this call transcript. Classify the outcome and determine the right follow-up.

Classification guide:
- INTERESTED: Contact expressed interest, asked questions, wants to learn more
- MEETING_BOOKED: Contact agreed to a meeting, demo, or follow-up call
- NOT_INTERESTED: Contact declined, asked to be removed, or was clearly not interested
- CALLBACK_REQUESTED: Contact asked to be called back at a specific time
- WRONG_PERSON: Reached someone who isn't the right contact (wrong department, left company, etc.)
- VOICEMAIL: Left a voicemail (if transcript shows voicemail interaction)
- NEUTRAL: Ambiguous — didn't clearly express interest or disinterest

For callback_time: extract the requested timing if callback_requested, otherwise "N/A".
For referred_contact: if they mentioned talking to someone else, extract name/title, otherwise "N/A".
${buildJsonInstruction(CALL_ANALYSIS_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(aiResult.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, CALL_ANALYSIS_SCHEMA, CALL_ANALYSIS_DEFAULTS);

  if (usedFallback) log.warn('LLM returned non-JSON, used regex fallback', { email: result.email });
  if (errors.length > 0) log.warn('Parse warnings', { email: result.email, warnings: errors.join(', ') });

  const callbackTime = parsed.callback_time === 'N/A' ? undefined : parsed.callback_time;
  const referredContact = parsed.referred_contact === 'N/A' ? undefined : parsed.referred_contact;

  return {
    outcome: parsed.outcome as CallAnalysis['outcome'],
    summary: parsed.summary,
    keyPoints: parsed.key_points as string[],
    sentiment: parsed.sentiment as CallAnalysis['sentiment'],
    urgency: parsed.urgency as CallAnalysis['urgency'],
    nextAction: parsed.next_action,
    objectionsRaised: parsed.objections_raised as string[],
    callbackTime,
    referredContact,
  };
}

// ─── Act on Analysis ────────────────────────────────────────────────

export async function handleAnalyzedCall(
  result: CallResult,
  analysis: CallAnalysis,
) {
  const { email } = result;
  const ownerId = process.env.HUBSPOT_OWNER_ID || '';

  // Store analysis in workspace
  await workspace.addNote(email, {
    author: 'call-analyzer',
    content: [
      `Call Analysis (${result.provider}):`,
      `Outcome: ${analysis.outcome.toUpperCase()}`,
      `Summary: ${analysis.summary}`,
      `Key Points: ${analysis.keyPoints.join(', ')}`,
      `Sentiment: ${analysis.sentiment}`,
      `Urgency: ${analysis.urgency}`,
      `Next Action: ${analysis.nextAction}`,
      analysis.objectionsRaised.length > 0 ? `Objections: ${analysis.objectionsRaised.join(', ')}` : '',
      analysis.callbackTime ? `Callback: ${analysis.callbackTime}` : '',
      analysis.referredContact ? `Referred to: ${analysis.referredContact}` : '',
    ].filter(Boolean).join('\n'),
    category: 'analysis',
  });

  // ─── INTERESTED: wants to learn more ────────────────────────────
  if (analysis.outcome === 'interested') {
    await workspace.addTask(email, {
      title: 'Call went well — follow up with meeting link',
      description: [
        `Call summary: ${analysis.summary}`,
        `Key points: ${analysis.keyPoints.join(', ')}`,
        `\nAction: ${analysis.nextAction}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'call-analyzer',
      priority: 'urgent',
      dueDate: new Date(Date.now() + 2 * 3600_000).toISOString(), // 2 hours
    });

    if (ownerId) {
      await createHubSpotFollowUpTask({
        contactId: (result.metadata.crm_id as string) || '',
        ownerId,
        subject: `Positive Call — ${analysis.nextAction}`,
        body: [
          `Call with ${email} went well!`,
          '',
          `**Summary:** ${analysis.summary}`,
          `**Key Points:** ${analysis.keyPoints.join(', ')}`,
          analysis.objectionsRaised.length > 0 ? `**Objections:** ${analysis.objectionsRaised.join(', ')}` : '',
          '',
          `**Next Step:** ${analysis.nextAction}`,
        ].filter(Boolean).join('\n'),
        priority: 'HIGH',
        taskType: 'CALL',
      });
    }

    await workspace.rewriteContext(email, [
      'Status: INTERESTED — positive call!',
      'Priority: URGENT — send follow-up within 2 hours.',
      `Summary: ${analysis.summary}`,
      `Next: ${analysis.nextAction}`,
    ].join('\n'), 'call-analyzer');

    await notifySlack([
      `*Positive call!*`,
      `Contact: ${email}`,
      `Provider: ${result.provider}`,
      `Duration: ${result.durationSecs}s`,
      `Summary: ${analysis.summary}`,
      `Action: ${analysis.nextAction}`,
    ].join('\n'));
  }

  // ─── MEETING BOOKED ─────────────────────────────────────────────
  if (analysis.outcome === 'meeting_booked') {
    await workspace.addTask(email, {
      title: 'Meeting booked from call — confirm and prepare',
      description: [
        `Call summary: ${analysis.summary}`,
        `\nAction: ${analysis.nextAction}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'call-analyzer',
      priority: 'urgent',
      dueDate: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
    });

    if (ownerId) {
      await createHubSpotFollowUpTask({
        contactId: (result.metadata.crm_id as string) || '',
        ownerId,
        subject: `Meeting Booked! — confirm details`,
        body: [
          `Meeting booked on call with ${email}!`,
          '',
          `**Summary:** ${analysis.summary}`,
          `**Next Step:** ${analysis.nextAction}`,
        ].join('\n'),
        priority: 'HIGH',
        taskType: 'TODO',
      });
    }

    await workspace.rewriteContext(email, [
      'Status: MEETING BOOKED from call!',
      'Priority: URGENT — send confirmation immediately.',
      `Summary: ${analysis.summary}`,
      `Next: ${analysis.nextAction}`,
    ].join('\n'), 'call-analyzer');

    await notifySlack([
      `*Meeting booked from call!*`,
      `Contact: ${email}`,
      `Summary: ${analysis.summary}`,
      `Action: ${analysis.nextAction}`,
    ].join('\n'));
  }

  // ─── NOT INTERESTED ─────────────────────────────────────────────
  if (analysis.outcome === 'not_interested') {
    await workspace.raiseIssue(email, {
      title: 'Contact not interested (from call)',
      description: `Call summary: "${analysis.summary}". Objections: ${analysis.objectionsRaised.join(', ') || 'none stated'}. Stop all outreach.`,
      severity: 'critical',
      status: 'open',
      raisedBy: 'call-analyzer',
    });

    await workspace.rewriteContext(email, [
      'Status: NOT INTERESTED — declined on call.',
      `Summary: ${analysis.summary}`,
      'Action: Stop all sequences. Do not contact again.',
    ].join('\n'), 'call-analyzer');

    await memory.save({
      email,
      content: `[LEAD STATUS UPDATE] Not interested (from call). Summary: ${analysis.summary}`,
      collectionName: 'contacts',
      properties: {
        lead_status: { value: 'Disqualified', extractMemories: false },
        outreach_stage: { value: 'Opted Out', extractMemories: false },
        responsive: { value: true, extractMemories: false },
        sentiment: { value: 'Negative', extractMemories: false },
      },
      tags: ['opted-out', 'negative-call'],
    });

    await notifySlack([
      `*Not interested (call)*`,
      `Contact: ${email}`,
      `Summary: ${analysis.summary}`,
      `Action: Removed from sequences.`,
    ].join('\n'));
  }

  // ─── CALLBACK REQUESTED ─────────────────────────────────────────
  if (analysis.outcome === 'callback_requested') {
    await workspace.addTask(email, {
      title: `Callback requested${analysis.callbackTime ? ` — ${analysis.callbackTime}` : ''}`,
      description: [
        `Contact asked to be called back.`,
        `Summary: ${analysis.summary}`,
        analysis.callbackTime ? `Requested time: ${analysis.callbackTime}` : '',
        `\nAction: ${analysis.nextAction}`,
      ].filter(Boolean).join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'call-analyzer',
      priority: 'high',
    });

    await workspace.rewriteContext(email, [
      `Status: CALLBACK REQUESTED${analysis.callbackTime ? ` — ${analysis.callbackTime}` : ''}.`,
      `Summary: ${analysis.summary}`,
      `Action: ${analysis.nextAction}`,
    ].join('\n'), 'call-analyzer');
  }

  // ─── WRONG PERSON ───────────────────────────────────────────────
  if (analysis.outcome === 'wrong_person') {
    await workspace.raiseIssue(email, {
      title: 'Wrong person reached on call',
      description: `${analysis.summary}${analysis.referredContact ? ` Referred to: ${analysis.referredContact}` : ''}`,
      severity: 'medium',
      status: 'open',
      raisedBy: 'call-analyzer',
    });

    if (analysis.referredContact) {
      await workspace.addTask(email, {
        title: `Follow up with referred contact: ${analysis.referredContact}`,
        description: `Wrong person reached. They referred us to: ${analysis.referredContact}\nAction: ${analysis.nextAction}`,
        status: 'pending',
        owner: 'sales-rep',
        createdBy: 'call-analyzer',
        priority: 'high',
      });
    }

    await workspace.rewriteContext(email, [
      'Status: WRONG PERSON — reached incorrect contact.',
      `Summary: ${analysis.summary}`,
      analysis.referredContact ? `Referred to: ${analysis.referredContact}` : '',
      `Action: ${analysis.nextAction}`,
    ].filter(Boolean).join('\n'), 'call-analyzer');
  }

  // ─── VOICEMAIL / NO ANSWER ──────────────────────────────────────
  if (analysis.outcome === 'voicemail' || analysis.outcome === 'no_answer') {
    await workspace.addUpdate(email, {
      author: 'call-analyzer',
      type: 'outreach',
      summary: `Call ${analysis.outcome === 'voicemail' ? 'went to voicemail' : 'not answered'}. ${analysis.summary}`,
    });

    await workspace.rewriteContext(email, [
      `Status: ${analysis.outcome === 'voicemail' ? 'VOICEMAIL' : 'NO ANSWER'}.`,
      `Action: ${analysis.nextAction}`,
    ].join('\n'), 'call-analyzer');
  }

  // ─── NEUTRAL ────────────────────────────────────────────────────
  if (analysis.outcome === 'neutral') {
    await workspace.addTask(email, {
      title: 'Review call transcript — ambiguous outcome',
      description: [
        `Call completed but outcome is unclear.`,
        `Summary: ${analysis.summary}`,
        `Key points: ${analysis.keyPoints.join(', ')}`,
        `\nAction: ${analysis.nextAction}`,
      ].join('\n'),
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'call-analyzer',
      priority: 'medium',
    });

    await workspace.rewriteContext(email, [
      'Status: CALL COMPLETED (neutral) — needs human review.',
      `Summary: ${analysis.summary}`,
      `Action: ${analysis.nextAction}`,
    ].join('\n'), 'call-analyzer');
  }

  // ─── Account impact assessment ──────────────────────────────────
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const impactOutcomes = ['interested', 'meeting_booked', 'not_interested'];
    if (impactOutcomes.includes(analysis.outcome)) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain) {
        log.info('Call triggers account strategy re-evaluation', {
          email,
          outcome: analysis.outcome,
          domain,
        });

        await accountWorkspace.addUpdate(domain, {
          author: 'call-analyzer',
          type: 'coordination',
          summary: `Call with ${email}: ${analysis.outcome.toUpperCase()} — ${analysis.summary}`,
          details: analysis.outcome === 'not_interested'
            ? 'Evaluating if this is account-level rejection or contact-level only.'
            : analysis.outcome === 'meeting_booked'
            ? 'Meeting booked — account advancing.'
            : `Positive signal from call — may upgrade account stage.`,
        });

        try {
          await evaluateAccountStrategy(domain);
        } catch (err) {
          log.warn('Account strategy re-evaluation failed (non-fatal)', {
            domain,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // ─── Always: update contact properties ──────────────────────────
  if (analysis.outcome !== 'not_interested') {
    await memory.save({
      email,
      content: `[CALL RESULT] Outcome: ${analysis.outcome}. Summary: ${analysis.summary}`,
      collectionName: 'contacts',
      properties: {
        responsive: { value: analysis.outcome !== 'no_answer' && analysis.outcome !== 'voicemail', extractMemories: false },
        sentiment: {
          value: analysis.sentiment === 'positive' ? 'Positive'
            : analysis.sentiment === 'negative' ? 'Negative'
            : 'Neutral',
          extractMemories: false,
        },
        lead_status: {
          value: analysis.outcome === 'meeting_booked' ? 'Meeting Set'
            : analysis.outcome === 'interested' ? 'Engaged'
            : 'Contacted',
          extractMemories: false,
        },
      },
      tags: ['call-result', analysis.outcome],
    });
  }

  return analysis;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Full call result processing: memorize transcript → analyze → take action.
 */
export async function processCallResult(result: CallResult): Promise<CallAnalysis> {
  log.info('Processing call result', {
    email: result.email,
    provider: result.provider,
    callId: result.callId,
    status: result.status,
    durationSecs: result.durationSecs,
  });

  // Step 1: Always memorize the transcript
  await memorizeTranscript(result);

  // Step 2: Analyze the call
  const analysis = await analyzeCall(result);

  log.info('Call analyzed', {
    email: result.email,
    outcome: analysis.outcome,
    sentiment: analysis.sentiment,
    summary: analysis.summary,
  });

  // Step 3: Take action based on analysis
  await handleAnalyzedCall(result, analysis);

  return analysis;
}
