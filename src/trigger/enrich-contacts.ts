import { task } from "@trigger.dev/sdk/v3";
import { enrichContacts } from '../pipelines/enrich-apollo.js';
import { enrichCompanies } from '../pipelines/enrich-companies-apollo.js';
import { SIGNAL_CONFIG } from '../config/prospecting.config.js';
import { reportFailure } from './error-handler.js';

/**
 * Enriches new contacts and companies via Apollo after CRM sync.
 * Triggered by crm-sync task (not on its own schedule).
 */
export const enrichContactsTask = task({
  id: "enrich-contacts",
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("enrich-contacts", ctx.run.id, error);
  },
  run: async () => {
    const contactResult = await enrichContacts();

    let companyResult = { enriched: 0, skipped: 0, failed: 0, timestamp: '' };
    if (SIGNAL_CONFIG.autoEnrichCompaniesAfterSync) {
      companyResult = await enrichCompanies();
    }

    return {
      contacts: contactResult,
      companies: companyResult,
      timestamp: new Date().toISOString(),
    };
  },
});
