/**
 * Phone / Call Delivery Channel
 *
 * Creates call tasks and optionally triggers AI-powered calls via:
 *   - manual-hubspot: Creates a HubSpot CALL task for a human rep (default)
 *   - bland-ai: Triggers an outbound call via Bland.ai (POST /v1/calls)
 *   - vapi: Triggers an outbound call via Vapi (POST /calls)
 *   - elevenlabs: Triggers via ElevenLabs Conversational AI + Twilio (POST /v1/convai/twilio/outbound-call)
 *
 * Call scripts include:
 *   - A structured script (opener, hook, ask, objection handlers) for human SDRs
 *   - A full verbatim script for AI callers
 *   - A short playbook with mindset, pacing, and tips
 */

import { client } from '../config.js';
import { CALL_CONFIG, MANUAL_HUBSPOT_CONFIG } from '../config/prospecting.config.js';
import { createHubSpotFollowUpTask } from './hubspot-deliver.js';
import { workspace } from '../lib/workspace.js';
import { logger } from '../lib/logger.js';
import type { GeneratedCallScript } from '../types.js';

const log = logger.child({ pipeline: 'phone-deliver' });

/** Daily call tracking (resets per UTC day). */
const dailyCalls = new Map<string, number>();

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getRemainingCapacity(): number {
  const today = getTodayKey();
  const called = dailyCalls.get(today) || 0;
  return Math.max(0, CALL_CONFIG.dailyCallLimit - called);
}

function recordCall(): void {
  const today = getTodayKey();
  dailyCalls.set(today, (dailyCalls.get(today) || 0) + 1);

  for (const key of dailyCalls.keys()) {
    if (key !== today) dailyCalls.delete(key);
  }
}

export interface CallSendResult {
  callId: string;
  provider: string;
  phone: string;
}

/**
 * Execute a call via the configured provider.
 */
export async function executeCall(
  script: GeneratedCallScript,
  contactId: string,
): Promise<CallSendResult> {
  if (!CALL_CONFIG.enabled) {
    throw new Error('Call channel is not enabled. Set CALL_ENABLED=true');
  }

  if (getRemainingCapacity() <= 0) {
    log.warn('Call daily limit reached', { limit: CALL_CONFIG.dailyCallLimit });
    throw new Error('Call daily limit reached');
  }

  const provider = CALL_CONFIG.provider;
  let callId = '';

  // Always create a HubSpot task (even for AI callers — for CRM tracking)
  await createCallTask(script, contactId);

  if (provider === 'bland-ai') {
    callId = await triggerBlandAiCall(script);
  } else if (provider === 'vapi') {
    callId = await triggerVapiCall(script);
  } else if (provider === 'elevenlabs') {
    callId = await triggerElevenLabsCall(script);
  } else {
    // manual-hubspot: task already created above
    callId = `manual-${Date.now()}`;
  }

  recordCall();

  // Record in workspace
  await workspace.addMessageSent(script.email, {
    channel: 'call',
    subject: `Call: ${script.contactName}`,
    bodyPreview: `${script.opener} ${script.hook}`.substring(0, 200),
    step: script.step,
    angle: script.angle,
    sentBy: provider === 'manual-hubspot' ? 'sales-rep' : 'outreach-agent',
    status: provider === 'manual-hubspot' ? 'sent' : 'delivered',
  });

  // Memorize in Personize
  await client.memory.memorize({
    email: script.email,
    content: [
      `[CALL SCRIPT — Step ${script.step}]`,
      `Date: ${new Date().toISOString()}`,
      `Contact: ${script.contactName} (${script.contactTitle})`,
      `Phone: ${script.phone}`,
      `Provider: ${provider}`,
      `Angle: ${script.angle}`,
      ``,
      `OPENER: ${script.opener}`,
      `HOOK: ${script.hook}`,
      `ASK: ${script.ask}`,
      ``,
      `OBJECTION HANDLERS:`,
      ...script.objectionHandlers.map((h) => `- "${h.objection}" → ${h.response}`),
      ``,
      `HUMAN PLAYBOOK:`,
      script.humanPlaybook,
    ].join('\n'),
    enhanced: true,
    tags: ['generated', 'outreach', 'call', `sequence:call-${script.step}`, `provider:${provider}`],
  });

  log.info('Call executed', { email: script.email, step: script.step, provider, phone: script.phone });

  return { callId, provider, phone: script.phone };
}

/**
 * Create a HubSpot CALL task with the full script and playbook.
 */
async function createCallTask(
  script: GeneratedCallScript,
  contactId: string,
): Promise<void> {
  const ownerId = MANUAL_HUBSPOT_CONFIG.ownerId;
  if (!ownerId) {
    log.warn('No HUBSPOT_OWNER_ID — skipping call task creation');
    return;
  }

  const objectionSection = script.objectionHandlers
    .map((h) => `  Q: "${h.objection}"\n  A: ${h.response}`)
    .join('\n\n');

  await createHubSpotFollowUpTask({
    contactId,
    ownerId,
    subject: `Call: ${script.contactName} — ${script.contactTitle}`,
    body: [
      `**Call Script for ${script.contactName}**`,
      `**Phone:** ${script.phone}`,
      `**Angle:** ${script.angle}`,
      ``,
      `━━━ SCRIPT ━━━`,
      ``,
      `**OPENER (first 10 seconds):**`,
      script.opener,
      ``,
      `**HOOK (connect to their situation):**`,
      script.hook,
      ``,
      `**ASK (the meeting request):**`,
      script.ask,
      ``,
      `━━━ OBJECTION HANDLERS ━━━`,
      ``,
      objectionSection,
      ``,
      `━━━ PLAYBOOK ━━━`,
      ``,
      script.humanPlaybook,
      ``,
      `---`,
      `Generated by AI Prospecting Agent.`,
    ].join('\n'),
    priority: 'HIGH',
    taskType: 'CALL',
  });
}

/**
 * Trigger an outbound call via Bland.ai.
 * Docs: https://docs.bland.ai/api-v1/post/calls
 * Endpoint: POST /v1/calls
 * Auth: authorization header (plain API key, not Bearer)
 */
async function triggerBlandAiCall(script: GeneratedCallScript): Promise<string> {
  const { blandApiKey, blandPhoneNumberId } = CALL_CONFIG;
  if (!blandApiKey) {
    throw new Error('BLAND_API_KEY required for bland-ai provider');
  }

  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': blandApiKey,
    },
    body: JSON.stringify({
      phone_number: script.phone,
      from: blandPhoneNumberId || undefined,
      task: script.aiCallerScript,
      first_sentence: script.opener,
      wait_for_greeting: true,
      record: true,
      max_duration: 5, // minutes (Bland.ai uses minutes, not seconds)
      model: 'base',
      language: 'en-US',
      // Webhook for post-call transcript + analysis (Bland.ai POSTs call result here)
      ...(CALL_CONFIG.webhookUrl && { webhook: CALL_CONFIG.webhookUrl }),
      metadata: {
        email: script.email,
        step: script.step,
        angle: script.angle,
        contactName: script.contactName,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Bland.ai API error: ${response.status} ${await response.text()}`);
  }

  // Response: { status: "success", call_id: "uuid", batch_id: null }
  const data = await response.json() as any;
  log.info('Bland.ai call triggered', { callId: data.call_id, phone: script.phone });
  return data.call_id || `bland-${Date.now()}`;
}

/**
 * Trigger an outbound call via Vapi.
 * Docs: https://docs.vapi.ai
 * Endpoint: POST /calls
 * Auth: Authorization: Bearer <api_key>
 *
 * Post-call webhook: Configure Server URL in Vapi dashboard → Assistant settings.
 * Vapi sends "end-of-call-report" events to the Server URL with transcript + messages.
 * Point it at your vapi-call-webhook Trigger.dev task URL.
 */
async function triggerVapiCall(script: GeneratedCallScript): Promise<string> {
  const { vapiApiKey, vapiAssistantId } = CALL_CONFIG;
  if (!vapiApiKey) {
    throw new Error('VAPI_API_KEY required for vapi provider');
  }

  const response = await fetch('https://api.vapi.ai/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vapiApiKey}`,
    },
    body: JSON.stringify({
      phoneNumber: script.phone,
      assistantId: vapiAssistantId || undefined,
      assistantOverrides: {
        firstMessage: script.opener,
        model: {
          messages: [
            {
              role: 'system',
              content: script.aiCallerScript,
            },
          ],
        },
      },
      customData: {
        email: script.email,
        step: script.step,
        angle: script.angle,
        contactName: script.contactName,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Vapi API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;
  log.info('Vapi call triggered', { callId: data.id, phone: script.phone });
  return data.id || `vapi-${Date.now()}`;
}

/**
 * Trigger an outbound call via ElevenLabs Conversational AI + Twilio.
 * Docs: https://elevenlabs.io/docs/eleven-agents/api-reference/twilio/outbound-call
 * Endpoint: POST /v1/convai/twilio/outbound-call
 * Auth: xi-api-key header
 * Requires: agent_id, agent_phone_number_id (Twilio number registered in ElevenLabs), to_number
 *
 * Post-call webhook: Configure in ElevenLabs General Settings → Webhooks.
 * Select "post_call_transcription" event. ElevenLabs sends transcript + analysis.
 * Point it at your elevenlabs-call-webhook Trigger.dev task URL.
 */
async function triggerElevenLabsCall(script: GeneratedCallScript): Promise<string> {
  const { elevenlabsApiKey, elevenlabsAgentId, elevenlabsPhoneNumberId } = CALL_CONFIG;
  if (!elevenlabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY required for elevenlabs provider');
  }
  if (!elevenlabsAgentId) {
    throw new Error('ELEVENLABS_AGENT_ID required for elevenlabs provider');
  }
  if (!elevenlabsPhoneNumberId) {
    throw new Error('ELEVENLABS_PHONE_NUMBER_ID required for elevenlabs provider');
  }

  const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': elevenlabsApiKey,
    },
    body: JSON.stringify({
      agent_id: elevenlabsAgentId,
      agent_phone_number_id: elevenlabsPhoneNumberId,
      to_number: script.phone,
      conversation_initiation_client_data: {
        dynamic_variables: {
          contact_name: script.contactName,
          contact_title: script.contactTitle,
          opener: script.opener,
          hook: script.hook,
          ask: script.ask,
          script: script.aiCallerScript,
        },
      },
      call_recording_enabled: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status} ${await response.text()}`);
  }

  // Response: { success: boolean, message: string, conversation_id?: string, callSid?: string }
  const data = await response.json() as any;
  log.info('ElevenLabs call triggered', {
    conversationId: data.conversation_id,
    callSid: data.callSid,
    phone: script.phone,
  });
  return data.conversation_id || data.callSid || `11labs-${Date.now()}`;
}

export { getRemainingCapacity };
