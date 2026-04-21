/**
 * Interview Scheduler — Trigger.dev Tasks
 *
 * Provides three ways to trigger interviews:
 *
 *   1. interview-trigger (manual) — Trigger an interview for a specific contact + purpose.
 *      Called by other pipelines (e.g., after positive cold call) or via Trigger.dev API.
 *
 *   2. interview-from-call (automatic) — Fires after analyze-call detects "interested" outcome.
 *      Auto-schedules a discovery interview for the contact.
 *
 *   3. interview-health-check-scheduler (cron) — Weekly check-in interviews for existing customers.
 *      Finds customers due for health checks and queues interviews.
 */

import { task, schedules } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { INTERVIEW_CONFIG, CALL_CONFIG } from '../config/prospecting.config.js';
import { generateInterviewGuide } from '../pipelines/generate-interview-guide.js';
import { conductInterview, getRemainingInterviewCapacity } from '../pipelines/conduct-interview.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';
import type { InterviewPurpose } from '../types.js';

const log = logger.child({ trigger: 'interview-scheduler' });

// ─── Manual Interview Trigger ────────────────────────────────────

export const interviewTriggerTask = task({
  id: "interview-trigger",
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("interview-trigger", ctx.run.id, error);
  },
  run: async (payload: {
    email: string;
    purpose: InterviewPurpose;
    contactId?: string;
    additionalContext?: string;
    dryRun?: boolean;
  }) => {
    const { email, purpose, contactId = '', additionalContext = '', dryRun = false } = payload;

    if (!INTERVIEW_CONFIG.enabled) {
      log.info('Interview module disabled', { email });
      return { status: 'skipped', reason: 'Interview module disabled' };
    }

    log.info('Interview trigger received', { email, purpose, dryRun });

    // Generate guide
    const guide = await generateInterviewGuide(email, purpose, additionalContext, dryRun);
    if (!guide) {
      return { status: 'skipped', reason: 'Guide generation returned null (check logs for gate details)' };
    }

    if (dryRun) {
      log.info('Dry run — interview guide generated but not dispatched', { email, purpose });
      return { status: 'dry_run', guide };
    }

    // Dispatch interview call
    const result = await conductInterview(guide, contactId);

    return {
      status: 'dispatched',
      callId: result.callId,
      provider: result.provider,
      purpose: result.purpose,
      phone: result.phone,
    };
  },
});

// ─── Auto-trigger After Positive Cold Call ───────────────────────

export const interviewFromCallTask = task({
  id: "interview-from-call",
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("interview-from-call", ctx.run.id, error);
  },
  run: async (payload: {
    email: string;
    callOutcome: string;
    callSummary: string;
    contactId?: string;
  }) => {
    const { email, callOutcome, callSummary, contactId = '' } = payload;

    if (!INTERVIEW_CONFIG.enabled) {
      return { status: 'skipped', reason: 'Interview module disabled' };
    }

    if (!INTERVIEW_CONFIG.autoTriggerPurposes.includes('discovery')) {
      return { status: 'skipped', reason: 'Discovery not in auto-trigger purposes' };
    }

    // Only auto-trigger for positive call outcomes
    if (callOutcome !== 'interested' && callOutcome !== 'meeting_booked') {
      log.info('Call outcome does not warrant auto-interview', { email, callOutcome });
      return { status: 'skipped', reason: `Call outcome "${callOutcome}" does not trigger interview` };
    }

    if (getRemainingInterviewCapacity() <= 0) {
      log.warn('Interview daily limit reached, cannot auto-trigger', { email });
      return { status: 'skipped', reason: 'Daily interview limit reached' };
    }

    log.info('Auto-triggering discovery interview after positive call', { email, callOutcome });

    const additionalContext = `This contact had a positive cold call (outcome: ${callOutcome}). Summary: ${callSummary}. The interview should build on this momentum and go deeper into qualification.`;

    const guide = await generateInterviewGuide(email, 'discovery', additionalContext, false);
    if (!guide) {
      return { status: 'skipped', reason: 'Guide generation returned null' };
    }

    const result = await conductInterview(guide, contactId);

    return {
      status: 'dispatched',
      callId: result.callId,
      provider: result.provider,
      purpose: 'discovery',
    };
  },
});

// ─── Scheduled Customer Health Check Interviews ──────────────────

export const interviewHealthCheckScheduler = schedules.task({
  id: "interview-health-check-scheduler",
  cron: "0 15 * * 3", // 3pm UTC every Wednesday
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("interview-health-check-scheduler", ctx.run.id, error);
  },
  run: async () => {
    if (!INTERVIEW_CONFIG.enabled) {
      log.info('Interview module disabled, skipping health check scheduler');
      return { status: 'skipped', reason: 'Interview module disabled' };
    }

    if (!INTERVIEW_CONFIG.autoTriggerPurposes.includes('customer_health')) {
      log.info('Customer health not in auto-trigger purposes');
      return { status: 'skipped', reason: 'customer_health not in auto-trigger purposes' };
    }

    log.info('Running customer health check interview scheduler');

    // Find customers due for health check
    // Look for contacts with lead_status = 'Customer' who haven't had a health check recently
    const customers = await client.memory.recall({
      message: 'active customer accounts due for health check, no recent interview',
      type: 'Contact',
      limit: 20,
    });

    let scheduled = 0;
    let skipped = 0;

    for (const customer of customers.data || []) {
      if (getRemainingInterviewCapacity() <= 0) {
        log.info('Interview daily limit reached, stopping scheduler');
        break;
      }

      const email = (customer as any).email;
      if (!email) {
        skipped++;
        continue;
      }

      // Check if we already did a health check recently (within 30 days)
      const recentChecks = await client.memory.recall({
        message: `interview customer_health for ${email}`,
        limit: 1,
      });

      const hasRecentCheck = (recentChecks.data || []).some((item) => {
        const content = (item.content || '').toUpperCase();
        if (!content.includes('[INTERVIEW') || !content.includes('CUSTOMER_HEALTH')) return false;
        // Check if within last 30 days
        const dateMatch = item.content?.match(/Date: (\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return false;
        const daysSince = (Date.now() - new Date(dateMatch[1]).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince < 30;
      });

      if (hasRecentCheck) {
        skipped++;
        continue;
      }

      try {
        const guide = await generateInterviewGuide(email, 'customer_health', '', false);
        if (guide) {
          await conductInterview(guide, '');
          scheduled++;
        } else {
          skipped++;
        }
      } catch (err) {
        log.warn('Failed to schedule health check interview', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    log.info('Health check scheduler complete', { scheduled, skipped });

    return { status: 'completed', scheduled, skipped };
  },
});
