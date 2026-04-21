/**
 * Interview Transcript Analysis Pipeline
 *
 * When an AI interview call completes, this pipeline:
 *   1. Memorizes the full interview transcript
 *   2. Extracts structured insights via AI (BANT/MEDDIC, competitive intel, etc.)
 *   3. Takes action based on findings (tasks, CRM updates, Slack alerts)
 *
 * Unlike analyze-call.ts (which classifies simple outcomes like interested/not_interested),
 * this pipeline does deep extraction — it pulls out structured qualification data,
 * competitive intelligence, product feedback, and sentiment arcs.
 */

import { client, aiOptions } from '../config.js';
import { memory } from '../lib/memory.js';
import { workspace } from '../lib/workspace.js';
import { accountWorkspace } from '../lib/account-workspace.js';
import { evaluateAccountStrategy } from './account-strategy.js';
import { createHubSpotFollowUpTask } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { INTERVIEW_ANALYSIS_SCHEMA, INTERVIEW_ANALYSIS_DEFAULTS } from '../lib/llm-schemas.js';
import { ACCOUNT_STRATEGY_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';
import type { CallResult, InterviewGuide, InterviewAnalysis } from '../types.js';

const log = logger.child({ pipeline: 'analyze-interview' });

// ─── Memorize Transcript ────────────────────────────────────────────

async function memorizeInterviewTranscript(
  result: CallResult,
  guide: InterviewGuide,
): Promise<void> {
  const transcriptText = result.turns.length > 0
    ? result.turns.map((t) => `${t.role === 'agent' ? 'Interviewer' : 'Contact'}: ${t.message}`).join('\n')
    : result.transcript;

  await memory.save({
    email: result.email,
    content: [
      `[INTERVIEW TRANSCRIPT — ${guide.purpose.toUpperCase()}]`,
      `Date: ${new Date().toISOString()}`,
      `Duration: ${result.durationSecs}s`,
      `Provider: ${result.provider}`,
      `Purpose: ${guide.purpose}`,
      `Topics Planned: ${guide.topics.map((t) => t.topic).join(', ')}`,
      '',
      '--- TRANSCRIPT ---',
      transcriptText || '(no transcript available)',
    ].filter(Boolean).join('\n'),
    enhanced: true,
    tags: ['interview', 'transcript', `purpose:${guide.purpose}`, `provider:${result.provider}`],
  });

  log.info('Memorized interview transcript', {
    email: result.email,
    purpose: guide.purpose,
    durationSecs: result.durationSecs,
  });
}

// ─── Analyze ────────────────────────────────────────────────────────

export async function analyzeInterview(
  result: CallResult,
  guide: InterviewGuide,
): Promise<InterviewAnalysis> {
  // Short-circuit for non-connected calls
  if (result.status === 'no-answer' || result.answeredBy === 'no-answer') {
    return createMinimalAnalysis('Interview call was not answered.', 'low');
  }

  if (result.answeredBy === 'voicemail') {
    return createMinimalAnalysis('Interview call went to voicemail.', 'low');
  }

  // For very short calls (< 60s), likely consent declined or wrong time
  if (result.durationSecs < 60) {
    return createMinimalAnalysis(
      'Interview was very short — contact may have declined or was unavailable.',
      'medium',
    );
  }

  const [digest, guidelines] = await Promise.all([
    workspace.getDigest(result.email, 4000), // Larger budget for interview context
    client.ai.smartGuidelines({
      message: 'interview analysis, qualification criteria, competitive intelligence, brand voice',
      mode: 'fast',
    }),
  ]);

  const transcriptText = result.turns.length > 0
    ? result.turns.map((t) => `${t.role === 'agent' ? 'Interviewer' : 'Contact'}: ${t.message}`).join('\n')
    : result.transcript;

  const topicGuide = guide.topics
    .map((t) => `- ${t.topic}: ${t.objective}`)
    .join('\n');

  const context = [
    '## GOVERNANCE\n' + (guidelines.data?.compiledContext || ''),
    '## LEAD WORKSPACE\n' + ((digest as any)?.compiledContext || ''),
    '## INTERVIEW DETAILS',
    `Purpose: ${guide.purpose}`,
    `Provider: ${result.provider}`,
    `Duration: ${result.durationSecs} seconds (${Math.round(result.durationSecs / 60)} min)`,
    `Target Duration: ${guide.targetDurationMins} minutes`,
    `Answered by: ${result.answeredBy}`,
    `Ended by: ${result.endedBy}`,
    '',
    '## PLANNED TOPICS',
    topicGuide,
    '',
    '## KNOWLEDGE GAPS (what we wanted to learn)',
    guide.knowledgeGaps.map((g) => `- ${g}`).join('\n'),
    '',
    '## INTERVIEW TRANSCRIPT',
    transcriptText || '(no transcript available)',
  ].filter(Boolean).join('\n\n---\n\n');

  const aiResult = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this ${guide.purpose.replace('_', ' ')} interview transcript in depth.

For EACH planned topic, determine:
- What was learned (the finding)
- Key direct quotes from the contact that support it
- Your confidence in the finding (high if clear answer, medium if inferred, low if vague/skipped)

Then extract structured qualification data (BANT/MEDDIC fields):
- Budget: specific amounts, ranges, or signals about budget
- Authority: who decides, who influences, approval chain
- Need: core pain points, current solutions, what's broken
- Timeline: when they need to decide, upcoming deadlines
- Decision Process: how they evaluate vendors, who's involved
- Metrics: what success looks like to them, KPIs they track
- Champion: anyone internal who's advocating for a solution

Also extract:
- Competitive intel: any competitors or alternatives mentioned, in what context
- Product feedback: feature requests, complaints, wishlist items
- Concerns: objections, blockers, risks they mentioned
- Sentiment arc: did they warm up, stay neutral, cool down, or fluctuate?

${buildJsonInstruction(INTERVIEW_ANALYSIS_SCHEMA)}`,
        maxSteps: 5,
      },
    ],
    evaluate: true,
    evaluationCriteria: 'Analysis must: (1) cover all planned topics, (2) include direct quotes, (3) have specific BANT/MEDDIC data where discussed, (4) provide actionable next steps, (5) accurately reflect the transcript content.',
  });

  const output = String(aiResult.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, INTERVIEW_ANALYSIS_SCHEMA, INTERVIEW_ANALYSIS_DEFAULTS);

  if (usedFallback) log.warn('LLM returned non-JSON, used regex fallback', { email: result.email });
  if (errors.length > 0) log.warn('Parse warnings', { email: result.email, warnings: errors.join(', ') });

  // Parse topic findings from JSON strings
  const topicFindings = (parsed.topic_findings || []).map((entry: string) => {
    try {
      const f = typeof entry === 'string' ? JSON.parse(entry) : entry;
      return {
        topic: f.topic || 'General',
        finding: f.finding || '',
        quotes: Array.isArray(f.quotes) ? f.quotes : [],
        confidence: (f.confidence || 'medium') as 'high' | 'medium' | 'low',
      };
    } catch {
      return { topic: 'General', finding: entry, quotes: [], confidence: 'low' as const };
    }
  });

  // Parse competitive intel from "competitor | context" format
  const competitiveIntel = (parsed.competitive_intel || []).map((entry: string) => {
    const parts = entry.split('|').map((s: string) => s.trim());
    return { competitor: parts[0] || entry, context: parts[1] || '' };
  });

  return {
    quality: parsed.quality as InterviewAnalysis['quality'],
    summary: parsed.summary,
    topicFindings,
    qualification: {
      budget: parsed.budget,
      authority: parsed.authority,
      need: parsed.need,
      timeline: parsed.timeline,
      decisionProcess: parsed.decision_process,
      metrics: parsed.metrics,
      champion: parsed.champion,
    },
    competitiveIntel,
    productFeedback: parsed.product_feedback as string[],
    concerns: parsed.concerns as string[],
    sentimentArc: parsed.sentiment_arc as InterviewAnalysis['sentimentArc'],
    nextSteps: parsed.next_steps as string[],
    sentiment: parsed.sentiment as InterviewAnalysis['sentiment'],
    urgency: parsed.urgency as InterviewAnalysis['urgency'],
  };
}

function createMinimalAnalysis(summary: string, urgency: 'high' | 'medium' | 'low'): InterviewAnalysis {
  return {
    quality: 'poor',
    summary,
    topicFindings: [],
    qualification: {
      budget: 'not discussed',
      authority: 'not discussed',
      need: 'not discussed',
      timeline: 'not discussed',
      decisionProcess: 'not discussed',
      metrics: 'not discussed',
      champion: 'not identified',
    },
    competitiveIntel: [],
    productFeedback: [],
    concerns: [],
    sentimentArc: 'steady_neutral',
    nextSteps: ['Reschedule interview or continue with email follow-up.'],
    sentiment: 'neutral',
    urgency,
  };
}

// ─── Act on Analysis ────────────────────────────────────────────────

export async function handleAnalyzedInterview(
  result: CallResult,
  guide: InterviewGuide,
  analysis: InterviewAnalysis,
) {
  const { email } = result;
  const ownerId = process.env.HUBSPOT_OWNER_ID || '';
  const purposeLabel = guide.purpose.replace('_', ' ');
  const durationMin = Math.round(result.durationSecs / 60);

  // ─── 1. Update: log the interview event ───────────────────────
  await workspace.addUpdate(email, {
    author: 'interview-analyzer',
    type: 'outreach',
    summary: `${purposeLabel} interview completed (${durationMin} min, ${analysis.quality} quality). ${analysis.summary}`,
  });

  // ─── 2. Note: executive summary ──────────────────────────────
  await workspace.addNote(email, {
    author: 'interview-analyzer',
    content: [
      `[Interview Summary — ${purposeLabel}]`,
      `Quality: ${analysis.quality.toUpperCase()} | Duration: ${durationMin} min | Sentiment: ${analysis.sentiment} (${analysis.sentimentArc})`,
      '',
      analysis.summary,
    ].join('\n'),
    category: 'analysis',
  });

  // ─── 3. Note: per-topic findings with quotes ──────��──────────
  for (const finding of analysis.topicFindings) {
    if (!finding.finding) continue;
    const quotesBlock = finding.quotes.length > 0
      ? '\n' + finding.quotes.map((q) => `  > "${q}"`).join('\n')
      : '';
    await workspace.addNote(email, {
      author: 'interview-analyzer',
      content: `[${finding.topic}] (${finding.confidence} confidence)\n${finding.finding}${quotesBlock}`,
      category: 'observation',
    });
  }

  // ─── 4. Note: BANT/MEDDIC qualification data ─────────────────
  const qualFields = [
    analysis.qualification.budget !== 'not discussed' && `Budget: ${analysis.qualification.budget}`,
    analysis.qualification.authority !== 'not discussed' && `Authority: ${analysis.qualification.authority}`,
    analysis.qualification.need !== 'not discussed' && `Need: ${analysis.qualification.need}`,
    analysis.qualification.timeline !== 'not discussed' && `Timeline: ${analysis.qualification.timeline}`,
    analysis.qualification.decisionProcess !== 'not discussed' && `Decision Process: ${analysis.qualification.decisionProcess}`,
    analysis.qualification.metrics !== 'not discussed' && `Metrics: ${analysis.qualification.metrics}`,
    analysis.qualification.champion !== 'not identified' && `Champion: ${analysis.qualification.champion}`,
  ].filter(Boolean);

  if (qualFields.length > 0) {
    await workspace.addNote(email, {
      author: 'interview-analyzer',
      content: `[Qualification Data — from ${purposeLabel} interview]\n${qualFields.join('\n')}`,
      category: 'analysis',
    });
  }

  // ─── 5. Note: competitive intel (one note per competitor) ─────
  for (const intel of analysis.competitiveIntel) {
    await workspace.addNote(email, {
      author: 'interview-analyzer',
      content: `[Competitive Intel] ${intel.competitor}${intel.context ? ': ' + intel.context : ''}`,
      category: 'observation',
    });
  }

  // ─── 6. Note: product feedback items ──────────────────────────
  if (analysis.productFeedback.length > 0) {
    await workspace.addNote(email, {
      author: 'interview-analyzer',
      content: `[Product Feedback — from ${purposeLabel} interview]\n${analysis.productFeedback.map((f) => `• ${f}`).join('\n')}`,
      category: 'observation',
    });
  }

  // ─── 7. Issues: concerns and blockers ─────────────────────────
  for (const concern of analysis.concerns) {
    await workspace.raiseIssue(email, {
      title: `Concern raised in ${purposeLabel} interview`,
      description: concern,
      severity: analysis.urgency === 'high' ? 'critical' : 'medium',
      status: 'open',
      raisedBy: 'interview-analyzer',
    });
  }

  // ─── 8. Tasks: one per recommended next step ──────────────────
  const basePriority = analysis.urgency === 'high' ? 'urgent' : analysis.urgency;
  const baseDueHours = analysis.urgency === 'high' ? 2 : analysis.urgency === 'medium' ? 24 : 72;

  for (let i = 0; i < analysis.nextSteps.length; i++) {
    const step = analysis.nextSteps[i];
    await workspace.addTask(email, {
      title: step,
      description: `From ${purposeLabel} interview (${analysis.quality} quality).\nContext: ${analysis.summary}`,
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'interview-analyzer',
      priority: i === 0 ? basePriority : 'medium', // First next-step gets highest priority
      dueDate: new Date(Date.now() + (baseDueHours + i * 24) * 3600_000).toISOString(),
    });
  }

  // ─── 9. HubSpot task ─────────────────────────────────────────
  if (ownerId) {
    const findingsSection = analysis.topicFindings
      .map((f) => [
        `**${f.topic}** (${f.confidence} confidence)`,
        f.finding,
        ...f.quotes.map((q) => `  > "${q}"`),
      ].join('\n'))
      .join('\n\n');

    await createHubSpotFollowUpTask({
      contactId: (result.metadata.crm_id as string) || '',
      ownerId,
      subject: `Interview Complete — ${purposeLabel} — ${analysis.quality}`,
      body: [
        `**Interview with ${guide.contactName}**`,
        `**Purpose:** ${purposeLabel}`,
        `**Duration:** ${durationMin} min`,
        `**Quality:** ${analysis.quality.toUpperCase()}`,
        '',
        `**Summary:** ${analysis.summary}`,
        '',
        '━━━ QUALIFICATION ━━━',
        ...qualFields.length > 0 ? qualFields : ['(no qualification data extracted)'],
        '',
        '━━━ FINDINGS ━━━',
        findingsSection,
        '',
        analysis.competitiveIntel.length > 0
          ? `━━━ COMPETITIVE INTEL ━━━\n${analysis.competitiveIntel.map((c) => `• ${c.competitor}: ${c.context}`).join('\n')}\n`
          : '',
        analysis.concerns.length > 0
          ? `━━━ CONCERNS ━━━\n${analysis.concerns.map((c) => `• ${c}`).join('\n')}\n`
          : '',
        analysis.productFeedback.length > 0
          ? `━━━ PRODUCT FEEDBACK ━━━\n${analysis.productFeedback.map((f) => `• ${f}`).join('\n')}\n`
          : '',
        `━━━ NEXT STEPS ━━━`,
        ...analysis.nextSteps.map((s) => `• ${s}`),
        '',
        '---',
        'Generated by Revenue OS Interview Module.',
      ].filter(Boolean).join('\n'),
      priority: analysis.urgency === 'high' ? 'HIGH' : 'MEDIUM',
      taskType: 'TODO',
    });
  }

  // ─── 10. Update workspace context ─────────────────────────────
  await workspace.rewriteContext(email, [
    `Status: INTERVIEW COMPLETED (${purposeLabel}) — quality: ${analysis.quality}`,
    `Summary: ${analysis.summary}`,
    `Sentiment: ${analysis.sentiment} (arc: ${analysis.sentimentArc})`,
    ...qualFields,
    analysis.competitiveIntel.length > 0
      ? `Competitors mentioned: ${analysis.competitiveIntel.map((c) => c.competitor).join(', ')}`
      : '',
    analysis.concerns.length > 0
      ? `Open concerns: ${analysis.concerns.join('; ')}`
      : '',
    `Next: ${analysis.nextSteps[0] || 'Review findings'}`,
  ].filter(Boolean).join('\n'), 'interview-analyzer');

  // ─── 11. Slack notification ───────────────────────────────────
  if (analysis.quality === 'excellent' || analysis.quality === 'good' || analysis.urgency === 'high') {
    await notifySlack([
      `*Interview completed (${purposeLabel})*`,
      `Contact: ${guide.contactName} (${guide.contactTitle})`,
      `Quality: ${analysis.quality.toUpperCase()} | Sentiment: ${analysis.sentiment}`,
      `Duration: ${durationMin} min`,
      '',
      `Summary: ${analysis.summary}`,
      '',
      ...qualFields.slice(0, 3), // Top 3 qual fields in Slack
      '',
      analysis.competitiveIntel.length > 0
        ? `Competitors: ${analysis.competitiveIntel.map((c) => c.competitor).join(', ')}`
        : '',
      analysis.concerns.length > 0
        ? `Concerns: ${analysis.concerns.length} raised`
        : '',
      '',
      `Next: ${analysis.nextSteps.join('; ')}`,
    ].filter(Boolean).join('\n'));
  }

  // ─── 12. Memorize to Personize (properties on contacts) ──────
  const qualificationProps: Record<string, { value: string; extractMemories: boolean }> = {};

  if (analysis.qualification.budget !== 'not discussed') {
    qualificationProps.budget_info = { value: analysis.qualification.budget, extractMemories: false };
  }
  if (analysis.qualification.authority !== 'not discussed') {
    qualificationProps.authority_info = { value: analysis.qualification.authority, extractMemories: false };
  }
  if (analysis.qualification.need !== 'not discussed') {
    qualificationProps.primary_need = { value: analysis.qualification.need, extractMemories: false };
  }
  if (analysis.qualification.timeline !== 'not discussed') {
    qualificationProps.purchase_timeline = { value: analysis.qualification.timeline, extractMemories: false };
  }
  if (analysis.qualification.champion !== 'not identified') {
    qualificationProps.champion = { value: analysis.qualification.champion, extractMemories: false };
  }

  await memory.save({
    email,
    content: [
      `[INTERVIEW ANALYSIS — ${guide.purpose.toUpperCase()}]`,
      `Date: ${new Date().toISOString()}`,
      `Quality: ${analysis.quality}`,
      `Summary: ${analysis.summary}`,
      '',
      'Findings:',
      ...analysis.topicFindings.map((f) => `- ${f.topic}: ${f.finding}`),
      '',
      analysis.competitiveIntel.length > 0
        ? `Competitive Intel: ${analysis.competitiveIntel.map((c) => `${c.competitor}: ${c.context}`).join('; ')}`
        : '',
      analysis.concerns.length > 0 ? `Concerns: ${analysis.concerns.join('; ')}` : '',
      analysis.productFeedback.length > 0 ? `Product Feedback: ${analysis.productFeedback.join('; ')}` : '',
      '',
      `Next Steps: ${analysis.nextSteps.join('; ')}`,
    ].filter(Boolean).join('\n'),
    collectionName: 'contacts',
    properties: {
      ...qualificationProps,
      lead_status: {
        value: analysis.sentiment === 'positive' ? 'Qualified'
          : analysis.sentiment === 'negative' ? 'Disqualified'
          : 'Engaged',
        extractMemories: false,
      },
      responsive: { value: true, extractMemories: false },
      sentiment: {
        value: analysis.sentiment === 'positive' ? 'Positive'
          : analysis.sentiment === 'negative' ? 'Negative'
          : 'Neutral',
        extractMemories: false,
      },
    },
    enhanced: true,
    tags: ['interview', 'analysis', `purpose:${guide.purpose}`, `quality:${analysis.quality}`],
  });

  // ─── 13. Account-level impact ─────────────────────────────────
  if (ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain) {
      await accountWorkspace.addUpdate(domain, {
        author: 'interview-analyzer',
        type: 'coordination',
        summary: `Interview with ${email}: ${analysis.quality} quality, ${analysis.sentiment} sentiment. ${analysis.summary}`,
        details: analysis.qualification.need !== 'not discussed'
          ? `Key need: ${analysis.qualification.need}. Timeline: ${analysis.qualification.timeline}.`
          : 'Discovery interview completed — review findings for account strategy update.',
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

  return analysis;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Full interview result processing: memorize → analyze → take action.
 */
export async function processInterviewResult(
  result: CallResult,
  guide: InterviewGuide,
): Promise<InterviewAnalysis> {
  log.info('Processing interview result', {
    email: result.email,
    purpose: guide.purpose,
    provider: result.provider,
    callId: result.callId,
    durationSecs: result.durationSecs,
  });

  // Step 1: Memorize transcript
  await memorizeInterviewTranscript(result, guide);

  // Step 2: Analyze
  const analysis = await analyzeInterview(result, guide);

  log.info('Interview analyzed', {
    email: result.email,
    purpose: guide.purpose,
    quality: analysis.quality,
    sentiment: analysis.sentiment,
    topicsExtracted: analysis.topicFindings.length,
  });

  // Step 3: Take action
  await handleAnalyzedInterview(result, guide, analysis);

  return analysis;
}
