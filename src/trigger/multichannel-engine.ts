/**
 * Multi-Channel Outreach Engine
 *
 * Orchestrates LinkedIn and Call outreach alongside the existing email engine.
 * Runs after the email outreach scheduler so channels are properly sequenced:
 *
 *   Email 1 → LinkedIn Connection Request → Email 2 → Call (if 80+ score) → Email 3
 *
 * Each channel respects daily limits, account strategy, and opt-out signals.
 */

import { schedules, task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { LINKEDIN_CONFIG, CALL_CONFIG } from '../config/prospecting.config.js';
import { generateLinkedInMessage } from '../pipelines/generate-linkedin-message.js';
import { generateCallScriptForContact } from '../pipelines/generate-call-script.js';
import { sendViaLinkedIn } from '../delivery/linkedin.js';
import { executeCall } from '../delivery/phone.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'multichannel-engine' });

// ─── LinkedIn Scheduler ──────────────────────────────────────────────
// Runs at 11am UTC (1 hour after email outreach) to catch contacts who
// already received Email 1 but haven't gotten a LinkedIn touch yet.

export const linkedInScheduler = schedules.task({
  id: "linkedin-outreach-scheduler",
  cron: "0 11 * * 1-5", // 11am UTC, Mon-Fri
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("linkedin-outreach-scheduler", ctx.run.id, error);
  },
  run: async () => {
    if (!LINKEDIN_CONFIG.enabled) {
      return { status: 'disabled', reason: 'LINKEDIN_ENABLED is not true' };
    }

    // Find contacts who have LinkedIn URLs and have received Email 1
    const contacts = await client.memory.search({
      type: 'Contact',
      query: 'contacts with linkedin url who received email 1 outreach, not opted out',
      limit: 50,
    });

    let queued = 0;
    for (const contact of contacts.data || []) {
      if (!contact.email) continue;

      const linkedinUrl = contact.properties?.linkedin_url || '';
      if (!linkedinUrl) continue;

      await processLinkedInTask.trigger({
        email: contact.email,
        linkedinUrl: String(linkedinUrl),
        crmId: String(contact.properties?.crm_id || ''),
      });
      queued++;
    }

    log.info('LinkedIn outreach queued', { queued });
    return { contactsQueued: queued };
  },
});

const processLinkedInTask = task({
  id: "process-linkedin-outreach",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  queue: { concurrencyLimit: 3 },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`process-linkedin-outreach (${payload.email})`, ctx.run.id, error);
  },
  run: async ({ email, linkedinUrl, crmId }: { email: string; linkedinUrl: string; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    const generated = await generateLinkedInMessage(email, linkedinUrl, 1, dryRun);
    if (!generated) return { email, status: 'skipped' };

    if (!dryRun) {
      await sendViaLinkedIn(generated, crmId);
    }

    return {
      email,
      type: generated.type,
      message: generated.message.substring(0, 100),
      dryRun,
    };
  },
});

// ─── Call Scheduler ──────────────────────────────────────────────────
// Runs at 1pm UTC (during business hours) to create call tasks for
// high-score contacts who have progressed past Email 1.

export const callScheduler = schedules.task({
  id: "call-outreach-scheduler",
  cron: "0 13 * * 1-5", // 1pm UTC, Mon-Fri
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("call-outreach-scheduler", ctx.run.id, error);
  },
  run: async () => {
    if (!CALL_CONFIG.enabled) {
      return { status: 'disabled', reason: 'CALL_ENABLED is not true' };
    }

    // Find high-score contacts with phone numbers
    const contacts = await client.memory.search({
      type: 'Contact',
      query: 'high scoring contacts with phone number, ICP score 80 or above, not opted out',
      limit: 30,
    });

    let queued = 0;
    for (const contact of contacts.data || []) {
      if (!contact.email) continue;

      const phone = contact.properties?.phone_number || '';
      if (!phone) continue;

      // Extract ICP score from properties or tags
      const scoreStr = String(contact.properties?.lead_score || '0');
      const icpScore = parseInt(scoreStr, 10) || 0;

      if (icpScore < CALL_CONFIG.minScoreForCall) continue;

      await processCallTask.trigger({
        email: contact.email,
        icpScore,
        crmId: String(contact.properties?.crm_id || ''),
      });
      queued++;
    }

    log.info('Call outreach queued', { queued });
    return { contactsQueued: queued };
  },
});

const processCallTask = task({
  id: "process-call-outreach",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  queue: { concurrencyLimit: 3 },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`process-call-outreach (${payload.email})`, ctx.run.id, error);
  },
  run: async ({ email, icpScore, crmId }: { email: string; icpScore: number; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    const script = await generateCallScriptForContact(email, icpScore, 1, dryRun);
    if (!script) return { email, status: 'skipped' };

    if (!dryRun) {
      await executeCall(script, crmId);
    }

    return {
      email,
      contact: script.contactName,
      phone: script.phone,
      opener: script.opener.substring(0, 100),
      dryRun,
    };
  },
});
