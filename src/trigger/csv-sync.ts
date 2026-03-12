import { task } from "@trigger.dev/sdk/v3";
import { syncCSV } from '../pipelines/sync-csv.js';
import { SIGNAL_CONFIG } from '../config/prospecting.config.js';
import { enrichContactsTask } from './enrich-contacts.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

// On-demand task — trigger manually or via API when CSV files are updated
export const csvSyncTask = task({
  id: "csv-sync",
  retry: { maxAttempts: 3, minTimeoutInMs: 30_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("csv-sync", ctx.run.id, error);
  },
  run: async (_payload, { ctx }) => {
    return withContext({ requestId: ctx.run.id, pipeline: "csv-sync" }, async () => {
      await syncCSV();

      // Chain: enrich new contacts after CSV sync
      if (SIGNAL_CONFIG.autoEnrichAfterSync) {
        await enrichContactsTask.trigger({});
        logger.info('Triggered enrich-contacts task after CSV sync');
      }

      return { synced: true, timestamp: new Date().toISOString() };
    });
  },
});
