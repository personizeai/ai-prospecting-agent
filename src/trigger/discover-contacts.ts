import { task } from "@trigger.dev/sdk/v3";
import { discoverContactsForHotAccounts } from '../pipelines/discover-contacts-apollo.js';
import { reportFailure } from './error-handler.js';
import type { HotAccount } from '../types.js';

/**
 * Discovers new contacts at hot accounts via Apollo People Search.
 * Triggered by signal-detection task after scoring accounts.
 */
export const discoverContactsTask = task({
  id: "discover-contacts",
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, factor: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("discover-contacts", ctx.run.id, error);
  },
  run: async (payload: { hotAccounts: HotAccount[] }) => {
    const result = await discoverContactsForHotAccounts(payload.hotAccounts);

    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  },
});
