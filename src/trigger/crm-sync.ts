import { schedules } from "@trigger.dev/sdk/v3";
import { SIGNAL_CONFIG, CRM_SOURCE_CONFIG } from '../config/prospecting.config.js';
import { enrichContactsTask } from './enrich-contacts.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

const CRM_SYNC_DISABLED = process.env.DISABLE_CRM_SYNC === 'true';

// Runs every hour on weekdays — keeps CRM data fresh
export const crmSyncTask = schedules.task({
  id: "crm-sync",
  cron: "0 * * * 1-5", // Every hour, Mon-Fri
  retry: { maxAttempts: 3, minTimeoutInMs: 30_000, factor: 2 },
  onFailure: async ({ error, ctx }: any) => {
    await reportFailure("crm-sync", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "crm-sync" }, async () => {
      if (CRM_SYNC_DISABLED) {
        logger.info('CRM sync is disabled via DISABLE_CRM_SYNC=true. Skipping run.');
        return {
          synced: false,
          skipped: true,
          reason: 'DISABLE_CRM_SYNC=true',
          timestamp: new Date().toISOString(),
        };
      }

      const source = CRM_SOURCE_CONFIG.source;

      // Dynamic imports avoid crashing on missing env vars when a source is disabled.
      // e.g. HUBSPOT_ACCESS_TOKEN is not needed when source is 'csv'.
      if (source === 'hubspot' || source === 'all') {
        const { syncHubSpot } = await import('../pipelines/sync-hubspot.js');
        await syncHubSpot();
      }

      if (source === 'salesforce' || source === 'all') {
        const { syncSalesforce } = await import('../pipelines/sync-salesforce.js');
        await syncSalesforce();
      }

      if (source === 'clay' || source === 'all') {
        const { syncClay } = await import('../pipelines/sync-clay.js');
        await syncClay();
      }

      if (source === 'csv' || source === 'all') {
        const { syncCSV } = await import('../pipelines/sync-csv.js');
        await syncCSV();
      }

      // Chain: enrich new contacts + companies after sync
      if (SIGNAL_CONFIG.autoEnrichAfterSync) {
        await enrichContactsTask.trigger({});
        logger.info('Triggered enrich-contacts task');
      }

      return { synced: true, source, timestamp: new Date().toISOString() };
    });
  },
});
