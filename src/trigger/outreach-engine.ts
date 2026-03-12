import { schedules, task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { generateOutreachForContact } from '../pipelines/generate-outreach.js';
import { sendAndLog } from '../delivery/hubspot-deliver.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';

// Master outreach scheduler — runs twice daily (10am and 2pm UTC)
export const outreachScheduler = schedules.task({
  id: "outreach-scheduler",
  cron: "0 10,14 * * 1-5", // 10am and 2pm UTC, Mon-Fri
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("outreach-scheduler", ctx.run.id, error);
  },
  run: async () => {
    const contacts = await client.memory.search({
      type: 'Contact',
      query: 'qualified contacts ready for outreach, not opted out',
      limit: 50,
    });

    let processed = 0;
    for (const contact of contacts.data || []) {
      if (!contact.email) continue;

      await processContactTask.trigger({
        email: contact.email,
        crmId: contact.crm_id || '',
      });
      processed++;
    }

    return { contactsQueued: processed };
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
  run: async ({ email, crmId }: { email: string; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    if (dryRun) {
      logger.info('Generating outreach (dry run)', { email });
    }

    const generated = await generateOutreachForContact(email, dryRun);
    if (!generated) return { email, status: 'skipped' };

    if (!dryRun) {
      await sendAndLog(generated, crmId);
    }

    return { email, step: generated.step, subject: generated.subject, dryRun };
  },
});
