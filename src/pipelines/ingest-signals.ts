import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import type { Signal } from '../types.js';
import { logger } from '../lib/logger.js';

export type { Signal } from '../types.js';

const log = logger.child({ pipeline: 'ingest-signals' });

export async function ingestSignal(signal: Signal) {
  if (!signal.company_domain) {
    log.warn('Skipping signal with empty company_domain', { companyName: signal.company_name });
    return;
  }
  if (!signal.signal_type) {
    log.warn('Skipping signal with missing signal_type', { companyName: signal.company_name });
    return;
  }

  await client.memory.memorize({
    website_url: signal.company_domain,
    content: [
      `[BUYING SIGNAL DETECTED \u2014 ${signal.signal_type.toUpperCase()}]`,
      `Company: ${signal.company_name} (${signal.company_domain})`,
      `Signal: ${signal.description}`,
      `Strength: ${signal.strength}`,
      `Source: ${signal.source}`,
      `Detected: ${signal.detected_at}`,
    ].join('\n'),
    enhanced: true,
    tags: ['signal', signal.signal_type, signal.strength],
  });

  log.info('Signal ingested', { signalType: signal.signal_type, companyName: signal.company_name, strength: signal.strength });
}

export async function ingestSignalBatch(signals: Signal[]) {
  for (const signal of signals) {
    try {
      await ingestSignal(signal);
    } catch (err) {
      log.error('Failed to ingest signal', { companyName: signal.company_name, error: err instanceof Error ? err.message : String(err) });
      // Continue with remaining signals
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS / 4)); // lighter pause for signals
  }
}
