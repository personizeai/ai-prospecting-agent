import { syncCSV } from '../pipelines/sync-csv.js';
import { logger } from '../lib/logger.js';

syncCSV()
  .then(() => logger.info('CSV sync finished.'))
  .catch((err) => {
    logger.error('CSV sync failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
