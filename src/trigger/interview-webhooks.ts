/**
 * Interview Result Webhook Receivers
 *
 * Receives post-interview webhooks from AI voice providers and processes them.
 * Follows the same pattern as call-webhooks.ts but:
 *   - Detects interview calls via metadata.type === 'interview'
 *   - Retrieves the interview guide from memory to pass to the analysis pipeline
 *   - Routes to processInterviewResult instead of processCallResult
 *
 * Provider setup: same as call webhooks — point the webhook URL at these tasks.
 * Use INTERVIEW_WEBHOOK_URL if you want separate endpoints, or share CALL_WEBHOOK_URL
 * and route based on metadata.type.
 */

import { task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { processInterviewResult } from '../pipelines/analyze-interview.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';
import type { CallResult, InterviewGuide, InterviewPurpose, InterviewTopic } from '../types.js';

const log = logger.child({ trigger: 'interview-webhooks' });

/**
 * Retrieve the interview guide from Personize memory.
 * We stored it when generating the guide — recall it now for analysis context.
 */
async function recoverInterviewGuide(
  email: string,
  purpose: string,
): Promise<InterviewGuide> {
  const history = await client.memory.recall({
    message: `interview guide ${purpose} for ${email}`,
    limit: 3,
  });

  // Try to extract topic info from the stored guide
  const guideMemory = (history.data || []).find((item) => {
    const content = (item.content || '').toUpperCase();
    return content.includes('[INTERVIEW GUIDE') && content.includes(purpose.toUpperCase());
  });

  const topicsStr = guideMemory?.content?.match(/Topics: (.+)/)?.[1] || '';
  const topics: InterviewTopic[] = topicsStr.split(',').map((t) => ({
    topic: t.trim(),
    objective: '',
    primaryQuestion: '',
    probes: [],
    maxMinutes: 4,
  }));

  const gapsStr = guideMemory?.content?.match(/Knowledge Gaps: (.+)/)?.[1] || '';
  const knowledgeGaps = gapsStr.split(',').map((g) => g.trim()).filter(Boolean);

  return {
    email,
    contactName: '',
    contactTitle: '',
    phone: '',
    purpose: purpose as InterviewPurpose,
    opening: '',
    topics,
    closing: '',
    aiInterviewerPrompt: '',
    targetDurationMins: 20,
    knowledgeGaps,
  };
}

// ─── Bland.ai Interview Webhook ───────────────────────────────────

export const blandInterviewWebhookTask = task({
  id: "bland-interview-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("bland-interview-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    call_id?: string;
    status?: string;
    completed?: boolean;
    corrected_duration?: string;
    call_length?: number;
    concatenated_transcript?: string;
    transcripts?: Array<{ id: string; text: string; user: string; created_at: string }>;
    summary?: string;
    answered_by?: string;
    call_ended_by?: string;
    to?: string;
    from?: string;
    price?: number;
    metadata?: Record<string, unknown>;
    recording_url?: string;
  }) => {
    const email = (payload.metadata?.email as string) || '';
    const purpose = (payload.metadata?.purpose as string) || 'discovery';

    if (!email) {
      log.error('Bland.ai interview webhook missing email in metadata', { callId: payload.call_id });
      return;
    }

    log.info('Bland.ai interview webhook received', { callId: payload.call_id, email, purpose });

    const turns = (payload.transcripts || []).map((t) => ({
      role: (t.user === 'assistant' ? 'agent' : 'user') as 'agent' | 'user',
      message: t.text || '',
    }));

    const callResult: CallResult = {
      provider: 'bland-ai',
      callId: payload.call_id || '',
      email,
      status: payload.completed ? 'completed' : (payload.status as CallResult['status']) || 'unknown',
      answeredBy: (payload.answered_by === 'human' ? 'human' : payload.answered_by === 'voicemail' ? 'voicemail' : 'unknown') as CallResult['answeredBy'],
      durationSecs: payload.call_length || parseFloat(payload.corrected_duration || '0') || 0,
      transcript: payload.concatenated_transcript || '',
      turns,
      summary: payload.summary || '',
      endedBy: payload.call_ended_by === 'AGENT' ? 'assistant' : payload.call_ended_by === 'USER' ? 'user' : 'unknown',
      endedReason: payload.status || '',
      costUsd: payload.price || 0,
      recordingUrl: payload.recording_url || '',
      metadata: payload.metadata || {},
    };

    const guide = await recoverInterviewGuide(email, purpose);
    guide.contactName = (payload.metadata?.contactName as string) || '';

    await processInterviewResult(callResult, guide);
  },
});

// ─── Vapi Interview Webhook ──────────────────────────────────────

export const vapiInterviewWebhookTask = task({
  id: "vapi-interview-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("vapi-interview-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    message?: {
      type?: string;
      call?: {
        id?: string;
        customData?: Record<string, unknown>;
        status?: string;
        endedReason?: string;
        cost?: number;
      };
      artifact?: {
        transcript?: string;
        messages?: Array<{ role: string; message: string; time?: number }>;
        recordingUrl?: string;
      };
      durationSeconds?: number;
      endedReason?: string;
    };
  }) => {
    const message = payload.message;
    if (!message || message.type !== 'end-of-call-report') {
      log.info('Ignoring non-end-of-call Vapi interview event', { type: message?.type });
      return;
    }

    const email = (message.call?.customData?.email as string) || '';
    const purpose = (message.call?.customData?.purpose as string) || 'discovery';

    if (!email) {
      log.error('Vapi interview webhook missing email in customData', { callId: message.call?.id });
      return;
    }

    log.info('Vapi interview webhook received', { callId: message.call?.id, email, purpose });

    const turns = (message.artifact?.messages || [])
      .filter((m) => m.role === 'assistant' || m.role === 'user')
      .map((m) => ({
        role: (m.role === 'assistant' ? 'agent' : 'user') as 'agent' | 'user',
        message: m.message || '',
        timeSecs: m.time,
      }));

    const callResult: CallResult = {
      provider: 'vapi',
      callId: message.call?.id || '',
      email,
      status: 'completed',
      answeredBy: turns.some((t) => t.role === 'user') ? 'human' : 'unknown',
      durationSecs: message.durationSeconds || 0,
      transcript: message.artifact?.transcript || '',
      turns,
      summary: '',
      endedBy: message.endedReason === 'assistant-ended-call' ? 'assistant' : message.endedReason === 'customer-ended-call' ? 'user' : 'unknown',
      endedReason: message.endedReason || '',
      costUsd: message.call?.cost || 0,
      recordingUrl: message.artifact?.recordingUrl || '',
      metadata: message.call?.customData || {},
    };

    const guide = await recoverInterviewGuide(email, purpose);
    guide.contactName = (message.call?.customData?.contactName as string) || '';

    await processInterviewResult(callResult, guide);
  },
});

// ─── ElevenLabs Interview Webhook ────────────────────────────────

export const elevenlabsInterviewWebhookTask = task({
  id: "elevenlabs-interview-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("elevenlabs-interview-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    type?: string;
    data?: {
      conversation_id?: string;
      agent_id?: string;
      status?: string;
      transcript?: Array<{ role: string; message: string; time_in_call_secs?: number }>;
      metadata?: {
        call_duration_secs?: number;
        cost?: { total_cost_usd?: number };
      };
      analysis?: { call_successful?: boolean; transcript_summary?: string };
      conversation_initiation_client_data?: {
        dynamic_variables?: Record<string, unknown>;
      };
      recording_url?: string;
    };
  }) => {
    if (payload.type !== 'post_call_transcription') {
      log.info('Ignoring non-transcript ElevenLabs interview event', { type: payload.type });
      return;
    }

    const dynVars = payload.data?.conversation_initiation_client_data?.dynamic_variables || {};
    const email = (dynVars.email as string) || '';
    const purpose = (dynVars.purpose as string) || 'discovery';

    if (!email) {
      log.error('ElevenLabs interview webhook missing email', {
        conversationId: payload.data?.conversation_id,
      });
      return;
    }

    log.info('ElevenLabs interview webhook received', {
      conversationId: payload.data?.conversation_id,
      email,
      purpose,
    });

    const turns = (payload.data?.transcript || []).map((t) => ({
      role: (t.role === 'agent' ? 'agent' : 'user') as 'agent' | 'user',
      message: t.message || '',
      timeSecs: t.time_in_call_secs,
    }));

    const callResult: CallResult = {
      provider: 'elevenlabs',
      callId: payload.data?.conversation_id || '',
      email,
      status: payload.data?.status === 'done' ? 'completed' : (payload.data?.status as CallResult['status']) || 'unknown',
      answeredBy: turns.some((t) => t.role === 'user') ? 'human' : 'unknown',
      durationSecs: payload.data?.metadata?.call_duration_secs || 0,
      transcript: turns.map((t) => `${t.role === 'agent' ? 'Interviewer' : 'Contact'}: ${t.message}`).join('\n'),
      turns,
      summary: payload.data?.analysis?.transcript_summary || '',
      endedBy: 'unknown',
      endedReason: payload.data?.status || '',
      costUsd: payload.data?.metadata?.cost?.total_cost_usd || 0,
      recordingUrl: payload.data?.recording_url || '',
      metadata: dynVars,
    };

    const guide = await recoverInterviewGuide(email, purpose);
    guide.contactName = (dynVars.contact_name as string) || '';

    await processInterviewResult(callResult, guide);
  },
});
