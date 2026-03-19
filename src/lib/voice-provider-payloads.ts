import type { GeneratedCallScript } from '../types.js';

export interface ElevenLabsOutboundCallPayload {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data: {
    dynamic_variables: {
      email: string;
      step: number;
      angle: string;
      contact_name: string;
      contact_title: string;
      opener: string;
      hook: string;
      ask: string;
      script: string;
    };
  };
  call_recording_enabled: boolean;
}

export function buildElevenLabsOutboundCallPayload(
  script: GeneratedCallScript,
  config: {
    agentId: string;
    phoneNumberId: string;
  },
): ElevenLabsOutboundCallPayload {
  return {
    agent_id: config.agentId,
    agent_phone_number_id: config.phoneNumberId,
    to_number: script.phone,
    conversation_initiation_client_data: {
      dynamic_variables: {
        email: script.email,
        step: script.step,
        angle: script.angle,
        contact_name: script.contactName,
        contact_title: script.contactTitle,
        opener: script.opener,
        hook: script.hook,
        ask: script.ask,
        script: script.aiCallerScript,
      },
    },
    call_recording_enabled: true,
  };
}
