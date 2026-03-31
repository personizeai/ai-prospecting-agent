import { Personize } from '@personize/sdk';
import 'dotenv/config';
import { logger } from './lib/logger.js';

const REQUIRED_ENV = ['PERSONIZE_SECRET_KEY'] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const client = new Personize({
  secretKey: process.env.PERSONIZE_SECRET_KEY!,
  timeout: 60_000,
});

/** Call once at startup to verify auth and print plan limits. */
export async function verifySetup() {
  const me = await client.me();
  logger.info('Verified setup', {
    org: me.data?.organization,
    rateLimit: `${me.data?.plan?.limits?.maxApiCallsPerMinute}/min`,
    monthlyLimit: `${me.data?.plan?.limits?.maxApiCallsPerMonth}/mo`,
  });
  return me.data;
}

/** Configurable rate-limit pause (ms) between batched API calls. */
export const RATE_LIMIT_PAUSE_MS = Number(process.env.RATE_LIMIT_PAUSE_MS) || 2000;

/**
 * Optional BYOK (Bring Your Own Key) AI options.
 * Spread into Personize AI calls: `...aiOptions`
 * If none are set, Personize auto-selects the model via tier.
 */
export const aiOptions = {
  ...(process.env.AI_TIER && { tier: process.env.AI_TIER as 'basic' | 'pro' | 'ultra' }),
  ...(process.env.AI_PROVIDER && { provider: process.env.AI_PROVIDER as 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'openrouter' }),
  ...(process.env.AI_MODEL && { model: process.env.AI_MODEL }),
  ...(process.env.AI_API_KEY && { openrouterApiKey: process.env.AI_API_KEY }),
};
