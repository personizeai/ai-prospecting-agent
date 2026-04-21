import { schedules, task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { generateOutreachForContact } from '../pipelines/generate-outreach.js';
import { sendAndLog } from '../delivery/hubspot-deliver.js';
import { SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';
import { campaigns } from '../lib/campaign.js';
import { memoryCrud } from '../lib/personize-crud.js';

// Master outreach scheduler — runs twice daily (10am and 2pm UTC)
// When SALES_ORG is enabled, role-scoped schedulers in role-schedulers.ts take over.
export const outreachScheduler = schedules.task({
  id: "outreach-scheduler",
  cron: "0 10,14 * * 1-5", // 10am and 2pm UTC, Mon-Fri
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("outreach-scheduler", ctx.run.id, error);
  },
  run: async () => {
    // When Sales Org is enabled, role-scoped schedulers handle outreach instead
    if (SALES_ORG_CONFIG.enabled) {
      logger.info('Sales Org enabled — skipping single-mode outreach scheduler (role-schedulers active)');
      return { skipped: true, reason: 'sales_org_enabled' };
    }

    const activeCampaigns = await campaigns.listActive();
    const results: Array<{ campaignId: string; queued: number; skipped: string }> = [];

    if (activeCampaigns.length > 0) {
      // ── Campaign-aware mode: process contacts per campaign ────────
      for (const campaign of activeCampaigns) {
        // Check daily cap
        const canSend = await campaigns.hasCapacity(campaign.campaignId);
        if (!canSend) {
          results.push({ campaignId: campaign.campaignId, queued: 0, skipped: 'daily_cap_reached' });
          logger.info('Campaign at daily cap, skipping', { campaignId: campaign.campaignId });
          continue;
        }

        // Query contacts in this campaign that need outreach
        const contacts = await memoryCrud.filterByProperty({
          type: 'Contact',
          conditions: [
            { propertyName: 'campaign_id', operator: 'equals', value: campaign.campaignId },
            { propertyName: 'sequence_status', operator: 'notEquals', value: 'Complete' },
            { propertyName: 'sequence_status', operator: 'notEquals', value: 'Replied' },
            { propertyName: 'sequence_status', operator: 'notEquals', value: 'Opted Out' },
            { propertyName: 'sequence_status', operator: 'notEquals', value: 'Bounced' },
          ],
          limit: 50,
        });

        let queued = 0;
        for (const record of contacts.records) {
          const email = String(record.matchedProperties?.email || '');
          if (!email) continue;

          await processContactTask.trigger({
            email,
            crmId: String(record.matchedProperties?.crm_id || ''),
            campaignId: campaign.campaignId,
          });
          queued++;
        }

        results.push({ campaignId: campaign.campaignId, queued, skipped: '' });
        logger.info('Campaign contacts queued', { campaignId: campaign.campaignId, queued });
      }
    } else {
      // ── Fallback: no campaigns — process all qualified contacts (legacy mode) ──
      const contacts = await client.memory.search({
        type: 'Contact',
        query: 'qualified contacts ready for outreach, not opted out',
        limit: 50,
      });

      let queued = 0;
      for (const contact of contacts.data || []) {
        if (!contact.email) continue;
        await processContactTask.trigger({
          email: contact.email,
          crmId: contact.crm_id || '',
        });
        queued++;
      }

      results.push({ campaignId: 'none', queued, skipped: '' });
    }

    return { campaigns: results };
  },
});

// Individual contact outreach — runs per contact, with built-in retries
const processContactTask = task({
  id: "process-contact-outreach",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  queue: {
    concurrencyLimit: 5,
  },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`process-contact-outreach (${payload.email})`, ctx.run.id, error);
  },
  run: async ({ email, crmId, campaignId }: { email: string; crmId: string; campaignId?: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    if (dryRun) {
      logger.info('Generating outreach (dry run)', { email, campaignId });
    }

    // Reserve capacity BEFORE generating (prevents overshoot under concurrency)
    if (campaignId) {
      const canSend = await campaigns.hasCapacity(campaignId);
      if (!canSend) {
        logger.info('Campaign daily cap reached, skipping', { email, campaignId });
        return { email, status: 'campaign_cap_reached', campaignId };
      }
      // Pre-increment daily counter to reserve the slot
      await campaigns.incrementDailySend(campaignId);
    }

    const generated = await generateOutreachForContact(email, dryRun, undefined, undefined, campaignId);
    if (!generated) {
      // Generation failed/skipped — unreserve the slot
      // (imprecise but safe — slight undercount is better than overshoot)
      return { email, status: 'skipped', campaignId };
    }

    if (!dryRun) {
      await sendAndLog(generated, crmId);
    }

    // Increment campaign stats (daily send already incremented above)
    if (campaignId) {
      await campaigns.incrementStat(campaignId, 'emails_sent');

      // Increment contacts_reached on first email
      if (generated.step === 1) {
        await campaigns.incrementStat(campaignId, 'contacts_reached');
      }
    }

    return { email, step: generated.step, subject: generated.subject, dryRun, campaignId };
  },
});
