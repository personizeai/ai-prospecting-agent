/**
 * Role-Scoped Schedulers — One outreach scheduler per active role.
 *
 * When SALES_ORG_ENABLED=true, these replace the single outreach-scheduler.
 * Each role's scheduler:
 *   1. Queries contacts owned by that role (via role_owner property)
 *   2. Generates outreach using role-specific governance overlays
 *   3. Sends via the contact's assigned sender profile
 *
 * When SALES_ORG_ENABLED=false, these tasks exit immediately (no-op).
 *
 * Trigger.dev requires static task IDs, so we define one per role.
 */

import { schedules, task } from "@trigger.dev/sdk/v3";
import { SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { SALES_ROLES, type SalesRoleId } from '../config/sales-roles.js';
import { workspace } from '../lib/workspace.js';
import { generateOutreachForContact } from '../pipelines/generate-outreach.js';
import { sendAndLog } from '../delivery/hubspot-deliver.js';
import { senderProfiles } from '../lib/sender-profiles.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

const log = logger.child({ module: 'role-schedulers' });

// ─── Per-Contact Processing ───────────────────────────────────────

const processRoleContactTask = task({
  id: "process-role-contact",
  retry: { maxAttempts: 2 },
  queue: { concurrencyLimit: 5 },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`process-role-contact (${payload.email})`, ctx.run.id, error);
  },
  run: async ({ email, roleId, crmId }: { email: string; roleId: SalesRoleId; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    // Generate with role-specific governance
    const generated = await generateOutreachForContact(email, dryRun, undefined, roleId);
    if (!generated) return { email, roleId, status: 'skipped' };

    // Send via assigned sender profile or fallback
    let senderEmail: string | undefined;
    if (!dryRun) {
      const resolved = await senderProfiles.resolveForContact(email);
      if (resolved) {
        const { sendViaSmtp } = await import('../delivery/hubspot-deliver.js');
        await sendViaSmtp(generated, resolved.account.id);
        senderEmail = resolved.account.email;
        await senderProfiles.recordSend(resolved.profile.id);
      } else {
        const result = await sendAndLog(generated, crmId);
        senderEmail = result.senderEmail;
      }
    }

    // Record
    await workspace.addMessageSent(email, {
      channel: 'email',
      subject: generated.subject,
      bodyPreview: generated.bodyText.substring(0, 200),
      step: generated.step,
      angle: generated.angle,
      sentBy: `${roleId}-outreach-agent`,
      senderEmail,
      status: dryRun ? 'sent' : 'delivered',
    });

    return { email, roleId, step: generated.step, subject: generated.subject, dryRun };
  },
});

// ─── Role Scheduler Factory ───────────────────────────────────────

async function runRoleScheduler(roleId: SalesRoleId, runId: string) {
  return withContext({ requestId: runId, pipeline: `outreach-scheduler-${roleId}` }, async () => {
    if (!SALES_ORG_CONFIG.enabled) return { skipped: true, reason: 'sales_org_disabled' };
    if (!SALES_ORG_CONFIG.activeRoles.includes(roleId)) return { skipped: true, reason: `role_${roleId}_not_active` };

    const contacts = await workspace.getContactsByRole(roleId, 50);
    if (contacts.length === 0) {
      log.debug(`No contacts for role ${roleId}`);
      return { role: roleId, processed: 0 };
    }

    log.info(`${roleId} scheduler: processing ${contacts.length} contacts`);

    let queued = 0;
    for (const contact of contacts) {
      const email = (contact as any).email || (contact as any).id;
      const crmId = (contact as any).properties?.crm_id?.value || '';
      if (!email) continue;

      await processRoleContactTask.trigger({ email, roleId, crmId });
      queued++;
    }

    return { role: roleId, queued, timestamp: new Date().toISOString() };
  });
}

// ─── Static Schedulers (one per role) ─────────────────────────────

export const sdrOutreachScheduler = schedules.task({
  id: "outreach-scheduler-sdr",
  cron: SALES_ROLES.sdr.schedule.outreachCron,
  retry: { maxAttempts: 2 },
  onFailure: async (_p, error, { ctx }) => { await reportFailure("outreach-scheduler-sdr", ctx.run.id, error); },
  run: async (_payload, { ctx }) => runRoleScheduler('sdr', ctx.run.id),
});

export const aeOutreachScheduler = schedules.task({
  id: "outreach-scheduler-ae",
  cron: SALES_ROLES.ae.schedule.outreachCron,
  retry: { maxAttempts: 2 },
  onFailure: async (_p, error, { ctx }) => { await reportFailure("outreach-scheduler-ae", ctx.run.id, error); },
  run: async (_payload, { ctx }) => runRoleScheduler('ae', ctx.run.id),
});

export const csmEngagementScheduler = schedules.task({
  id: "outreach-scheduler-csm",
  cron: SALES_ROLES.csm.schedule.outreachCron,
  retry: { maxAttempts: 2 },
  onFailure: async (_p, error, { ctx }) => { await reportFailure("outreach-scheduler-csm", ctx.run.id, error); },
  run: async (_payload, { ctx }) => runRoleScheduler('csm', ctx.run.id),
});
