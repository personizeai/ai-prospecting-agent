import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildElevenLabsOutboundCallPayload } from '../lib/voice-provider-payloads.js';

describe('Voice Provider Payloads', () => {
  it('includes callback metadata in ElevenLabs dynamic variables', () => {
    const payload = buildElevenLabsOutboundCallPayload(
      {
        email: 'prospect@acme.com',
        phone: '+15551234567',
        contactName: 'Avery Prospect',
        contactTitle: 'VP Sales',
        step: 2,
        angle: 'funding',
        opener: 'Hi Avery, this is Sam.',
        hook: 'I saw Acme just raised.',
        ask: 'Worth a short chat next week?',
        aiCallerScript: 'Use a concise, friendly tone.',
        humanPlaybook: 'Keep it brief.',
        objectionHandlers: [],
      },
      {
        agentId: 'agent_123',
        phoneNumberId: 'phone_456',
      },
    );

    assert.equal(payload.agent_id, 'agent_123');
    assert.equal(payload.agent_phone_number_id, 'phone_456');
    assert.equal(payload.to_number, '+15551234567');
    assert.equal(payload.conversation_initiation_client_data.dynamic_variables.email, 'prospect@acme.com');
    assert.equal(payload.conversation_initiation_client_data.dynamic_variables.step, 2);
    assert.equal(payload.conversation_initiation_client_data.dynamic_variables.angle, 'funding');
    assert.equal(payload.conversation_initiation_client_data.dynamic_variables.contact_name, 'Avery Prospect');
    assert.equal(payload.call_recording_enabled, true);
  });
});
