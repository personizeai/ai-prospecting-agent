/**
 * Call Result Webhook Receivers
 *
 * Receives post-call webhooks from AI voice providers and processes them:
 *   1. Normalizes provider-specific payload → CallResult
 *   2. Triggers the call analysis pipeline (memorize → analyze → act)
 *
 * Provider setup:
 *   - Bland.ai:    Set `webhook` field in POST /v1/calls (done automatically by phone.ts)
 *   - Vapi:        Set Server URL in Vapi dashboard → Assistant → Server URL, point to vapi-call-webhook
 *   - ElevenLabs:  Set webhook in General Settings → Webhooks, select "post_call_transcription" event
 *
 * Each provider has its own Trigger.dev task because payload shapes differ significantly.
 * All three normalize to CallResult and feed into the same processCallResult pipeline.
 */

import { task } from "@trigger.dev/sdk/v3";
import { processCallResult } from '../pipelines/analyze-call.js';
import { reportFailure } from './error-handler.js';
import { CALL_CONFIG } from '../config/prospecting.config.js';
import { logger, withContext } from '../lib/logger.js';
import type { CallResult } from '../types.js';

// ─── Bland.ai Webhook ──────────────────────────────────────────────
//
// Bland.ai POSTs to the webhook URL when a call ends.
// Docs: https://docs.bland.ai/api-v1/post/calls
//
// Key fields from Bland.ai webhook payload:
//   call_id, status, completed, corrected_duration, call_length,
//   concatenated_transcript, transcripts[], summary, answered_by,
//   call_ended_by, to, from, metadata, variables, price

export const blandCallWebhookTask = task({
  id: "bland-call-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("bland-call-webhook", ctx.run.id, error);
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
    metadata?: Record<string, unknown>;
    variables?: Record<string, unknown>;
    price?: number;
    recording_url?: string;
  }, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "bland-call-webhook" }, async () => {
      if (!payload.call_id) {
        logger.warn('Bland.ai webhook: missing call_id, skipping', { payload });
        return { processed: false, reason: 'missing_call_id' };
      }

      const email = (payload.metadata?.email as string) || '';
      if (!email) {
        logger.warn('Bland.ai webhook: no email in metadata, skipping', { callId: payload.call_id });
        return { processed: false, reason: 'missing_email_in_metadata' };
      }

      // Normalize Bland.ai status → our status
      const statusMap: Record<string, CallResult['status']> = {
        completed: 'completed',
        failed: 'failed',
        busy: 'busy',
        'no-answer': 'no-answer',
        canceled: 'failed',
      };

      // Normalize answered_by
      const answeredByMap: Record<string, CallResult['answeredBy']> = {
        human: 'human',
        voicemail: 'voicemail',
        unknown: 'unknown',
        'no-answer': 'no-answer',
      };

      // Build structured turns from Bland.ai transcripts array
      const turns: CallResult['turns'] = (payload.transcripts || []).map((t) => ({
        role: t.user === 'assistant' ? 'agent' as const : 'user' as const,
        message: t.text,
      }));

      const result: CallResult = {
        provider: 'bland-ai',
        callId: String(payload.call_id),
        email,
        status: statusMap[payload.status || ''] || 'unknown',
        answeredBy: answeredByMap[payload.answered_by || ''] || 'unknown',
        durationSecs: payload.corrected_duration
          ? Math.round(parseFloat(payload.corrected_duration))
          : Math.round((payload.call_length || 0) * 60),
        transcript: payload.concatenated_transcript || '',
        turns,
        summary: payload.summary || '',
        endedBy: payload.call_ended_by === 'ASSISTANT' ? 'assistant' : payload.call_ended_by === 'USER' ? 'user' : 'unknown',
        endedReason: payload.status || 'unknown',
        costUsd: payload.price || 0,
        recordingUrl: payload.recording_url || '',
        metadata: payload.metadata || {},
      };

      const analysis = await processCallResult(result);

      return {
        processed: true,
        provider: 'bland-ai',
        callId: result.callId,
        email,
        outcome: analysis.outcome,
        sentiment: analysis.sentiment,
        summary: analysis.summary,
      };
    });
  },
});

// ─── Vapi Webhook ──────────────────────────────────────────────────
//
// Vapi sends POST to Server URL with message.type = "end-of-call-report".
// Docs: https://docs.vapi.ai/server-url/events
//
// Key fields:
//   message.type, message.call (full Call object),
//   message.artifact.transcript (string), message.artifact.messages[]
//   message.endedReason

export const vapiCallWebhookTask = task({
  id: "vapi-call-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("vapi-call-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    message?: {
      type?: string;
      endedReason?: string;
      call?: {
        id?: string;
        status?: string;
        startedAt?: string;
        endedAt?: string;
        costBreakdown?: { total?: number };
        customData?: Record<string, unknown>;
        analysis?: {
          summary?: string;
          structuredData?: Record<string, unknown>;
          successEvaluation?: string;
        };
      };
      artifact?: {
        transcript?: string;
        messages?: Array<{ role: string; message: string }>;
        recording?: { url?: string };
      };
    };
  }, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "vapi-call-webhook" }, async () => {
      const msg = payload.message;

      // Vapi sends multiple event types — we only process end-of-call-report
      if (!msg || msg.type !== 'end-of-call-report') {
        logger.info('Vapi webhook: ignoring non-end-of-call event', { type: msg?.type });
        return { processed: false, reason: `ignored_event_type:${msg?.type}` };
      }

      const call = msg.call;
      const callId = call?.id || '';
      const email = (call?.customData?.email as string) || '';

      if (!email) {
        logger.warn('Vapi webhook: no email in customData, skipping', { callId });
        return { processed: false, reason: 'missing_email_in_customData' };
      }

      // Calculate duration from timestamps
      let durationSecs = 0;
      if (call?.startedAt && call?.endedAt) {
        durationSecs = Math.round(
          (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
        );
      }

      // Build structured turns from Vapi messages array
      const turns: CallResult['turns'] = (msg.artifact?.messages || []).map((m) => ({
        role: m.role === 'assistant' || m.role === 'bot' ? 'agent' as const : 'user' as const,
        message: m.message,
      }));

      // Map Vapi endedReason to our answeredBy
      const noContactReasons = ['no-answer', 'busy', 'machine-detected'];
      const answeredBy: CallResult['answeredBy'] = noContactReasons.includes(msg.endedReason || '')
        ? 'no-answer'
        : msg.endedReason === 'voicemail'
        ? 'voicemail'
        : 'human';

      const statusMap: Record<string, CallResult['status']> = {
        ended: 'completed',
        'no-answer': 'no-answer',
        busy: 'busy',
        failed: 'failed',
      };

      const result: CallResult = {
        provider: 'vapi',
        callId,
        email,
        status: statusMap[call?.status || ''] || 'completed',
        answeredBy,
        durationSecs,
        transcript: msg.artifact?.transcript || '',
        turns,
        summary: call?.analysis?.summary || '',
        endedBy: msg.endedReason === 'hangup' || msg.endedReason === 'customer-ended-call' ? 'user' : 'assistant',
        endedReason: msg.endedReason || 'unknown',
        costUsd: call?.costBreakdown?.total || 0,
        recordingUrl: msg.artifact?.recording?.url || '',
        metadata: call?.customData || {},
      };

      const analysis = await processCallResult(result);

      return {
        processed: true,
        provider: 'vapi',
        callId,
        email,
        outcome: analysis.outcome,
        sentiment: analysis.sentiment,
        summary: analysis.summary,
      };
    });
  },
});

// ─── ElevenLabs Webhook ────────────────────────────────────────────
//
// ElevenLabs sends POST to configured webhook URL with type = "post_call_transcription".
// Docs: https://elevenlabs.io/docs/overview/administration/webhooks
//
// Payload:
//   type: "post_call_transcription"
//   event_timestamp: ISO string
//   data.agent_id, data.conversation_id, data.status
//   data.transcript[]: { role, message, time_in_call_secs, tool_calls, tool_results }
//   data.metadata: { start_time, duration (call_duration_secs), cost, termination_reason, phone_call }
//   data.analysis: { call_successful, transcript_summary, data_collection_results }
//   data.conversation_initiation_client_data.dynamic_variables (our metadata)
//
// Signature verification via ElevenLabs-Signature header + webhook secret.

export const elevenlabsCallWebhookTask = task({
  id: "elevenlabs-call-webhook",
  retry: { maxAttempts: 3 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("elevenlabs-call-webhook", ctx.run.id, error);
  },
  run: async (payload: {
    type?: string;
    event_timestamp?: string;
    data?: {
      agent_id?: string;
      conversation_id?: string;
      status?: string;
      transcript?: Array<{
        role: string;
        message: string;
        time_in_call_secs?: number;
      }>;
      metadata?: {
        start_time_unix_secs?: number;
        call_duration_secs?: number;
        cost?: number;
        termination_reason?: string;
        phone_call?: {
          direction?: string;
          external_number?: string;
          call_sid?: string;
        };
      };
      analysis?: {
        call_successful?: string;
        transcript_summary?: string;
        data_collection_results?: Record<string, unknown>;
      };
      conversation_initiation_client_data?: {
        dynamic_variables?: Record<string, unknown>;
      };
    };
  }, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "elevenlabs-call-webhook" }, async () => {
      // Only process post_call_transcription events
      if (payload.type !== 'post_call_transcription') {
        logger.info('ElevenLabs webhook: ignoring event', { type: payload.type });
        return { processed: false, reason: `ignored_event_type:${payload.type}` };
      }

      const data = payload.data;
      if (!data?.conversation_id) {
        logger.warn('ElevenLabs webhook: missing conversation_id, skipping');
        return { processed: false, reason: 'missing_conversation_id' };
      }

      // Extract email from dynamic_variables (passed when triggering the call)
      const dynVars = data.conversation_initiation_client_data?.dynamic_variables || {};
      const email = (dynVars.email as string) || '';

      if (!email) {
        logger.warn('ElevenLabs webhook: no email in dynamic_variables, skipping', {
          conversationId: data.conversation_id,
        });
        return { processed: false, reason: 'missing_email_in_dynamic_variables' };
      }

      // Build structured turns
      const turns: CallResult['turns'] = (data.transcript || []).map((t) => ({
        role: t.role === 'agent' ? 'agent' as const : 'user' as const,
        message: t.message,
        timeSecs: t.time_in_call_secs,
      }));

      // Build flat transcript from turns
      const transcriptText = turns
        .map((t) => `${t.role === 'agent' ? 'AI' : 'Contact'}: ${t.message}`)
        .join('\n');

      // Determine status from ElevenLabs analysis
      const callSuccessful = data.analysis?.call_successful;
      const terminationReason = data.metadata?.termination_reason || '';

      const result: CallResult = {
        provider: 'elevenlabs',
        callId: data.conversation_id,
        email,
        status: data.status === 'done' ? 'completed' : data.status === 'failed' ? 'failed' : 'unknown',
        answeredBy: (data.metadata?.call_duration_secs || 0) > 5 ? 'human' : 'unknown',
        durationSecs: data.metadata?.call_duration_secs || 0,
        transcript: transcriptText,
        turns,
        summary: data.analysis?.transcript_summary || '',
        endedBy: terminationReason.includes('user') ? 'user' : 'assistant',
        endedReason: terminationReason || 'unknown',
        costUsd: data.metadata?.cost || 0,
        recordingUrl: '', // ElevenLabs sends recording in separate post_call_audio event
        metadata: dynVars,
      };

      const analysis = await processCallResult(result);

      return {
        processed: true,
        provider: 'elevenlabs',
        callId: data.conversation_id,
        email,
        outcome: analysis.outcome,
        sentiment: analysis.sentiment,
        summary: analysis.summary,
        callSuccessful,
      };
    });
  },
});
