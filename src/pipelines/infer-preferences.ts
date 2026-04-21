import { client, aiOptions } from '../config.js';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { PREFERENCE_INFERENCE_SCHEMA, PREFERENCE_INFERENCE_DEFAULTS } from '../lib/llm-schemas.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'infer-preferences' });

/**
 * Infer shopping preferences for a customer from their purchase history.
 *
 * Reads the customer's memorized purchase records, analyzes patterns
 * (categories, price range, style, frequency, seasonality), and writes
 * inferred properties back to the contact:
 *   - style_preferences (text)
 *   - price_tier (Budget / Mid-Range / Premium / Luxury)
 *   - customer_segment (New / Active / Loyal / VIP / At-Risk / Lapsed / Win-Back)
 *
 * These inferred properties are then available as context when
 * generate-outreach.ts assembles the prompt for personalized campaigns.
 */
export async function inferPreferencesForCustomer(
  email: string,
): Promise<{ email: string; stylePreferences: string; priceTier: string; segment: string; recommendations: string[] } | null> {
  // 1. Recall purchase history and profile
  const [purchaseHistory, contactDigest, productCatalog] = await Promise.all([
    client.memory.recall({
      message: `all purchases, orders, products bought by ${email}`,
      limit: 20,
    }),
    client.memory.smartDigest({
      email,
      type: 'Contact',
      token_budget: 1500,
    }),
    client.memory.recall({
      message: 'product catalog, product descriptions, categories, pricing',
      type: 'Product',
      limit: 30,
    }),
  ]);

  const purchaseContent = purchaseHistory.data?.map((r: any) => r.content).join('\n') || '';
  if (!purchaseContent) {
    log.info('No purchase history found, skipping', { email });
    return null;
  }

  const context = [
    '## CUSTOMER PROFILE\n' + (contactDigest.data?.compiledContext || 'No profile data.'),
    '## PURCHASE HISTORY\n' + purchaseContent,
    '## PRODUCT CATALOG (for reference)\n' + (productCatalog.data?.map((r: any) => r.content).join('\n') || 'No catalog data.'),
  ].join('\n\n---\n\n');

  // 2. AI inference
  const result = await client.ai.prompt({
    ...aiOptions,
    context,
    instructions: [
      {
        prompt: `Analyze this customer's complete purchase history. Identify:
1. **Style profile**: What aesthetic, colors, materials, and brands do they gravitate toward? Be specific (e.g., "minimalist streetwear with earth tones" not just "casual").
2. **Price sensitivity**: Based on actual amounts spent, what tier do they shop in? Budget (<$30), Mid-Range ($30-80), Premium ($80-150), Luxury ($150+).
3. **Category affinity**: Which categories dominate? What cross-category patterns exist?
4. **Purchase frequency & recency**: How often do they buy? When was the last purchase? Are they at risk of lapsing?
5. **Customer segment**: Based on RFM (recency, frequency, monetary):
   - New: 1 order
   - Active: bought within 30 days, 2+ orders
   - Loyal: bought within 60 days, 3+ orders
   - VIP: bought within 60 days, 5+ orders OR $500+ total
   - At-Risk: 60-120 days since last purchase
   - Lapsed: 120-180 days since last purchase
   - Win-Back: 180+ days since last purchase
6. **Product recommendations**: Based on their pattern, suggest 3-5 product IDs from the catalog they haven't bought yet.

${buildJsonInstruction(PREFERENCE_INFERENCE_SCHEMA)}`,
        maxSteps: 3,
      },
    ],
  });

  const output = String(result.data || '');
  const { data: parsed, usedFallback, errors } = parseLLMJson(output, PREFERENCE_INFERENCE_SCHEMA, PREFERENCE_INFERENCE_DEFAULTS);

  if (usedFallback) {
    log.warn('LLM returned non-JSON, used regex fallback', { email });
  }
  if (errors.length > 0) {
    log.warn('Parse warnings', { email, warnings: errors.join(', ') });
  }

  const stylePreferences = parsed.style_preferences;
  const priceTier = parsed.price_tier;
  const segment = parsed.customer_segment;
  const recommendations = parsed.recommended_product_ids;

  if (!stylePreferences) {
    log.error('Inference produced empty style preferences', { email });
    return null;
  }

  // 3. Write inferred properties back to the contact
  await client.memory.memorize({
    email,
    collectionName: 'contacts',
    content: `[PREFERENCE INFERENCE — ${new Date().toISOString().slice(0, 10)}]\nStyle: ${stylePreferences}\nPrice tier: ${priceTier}\nSegment: ${segment}\nCategory affinity: ${parsed.category_affinity}\nPurchase frequency: ${parsed.purchase_frequency}\nRecommended products: ${recommendations.join(', ')}`,
    properties: {
      style_preferences: { value: stylePreferences, extractMemories: false },
      price_tier: { value: priceTier, extractMemories: false },
      customer_segment: { value: segment, extractMemories: false },
    },
    tags: ['ecommerce', 'preferences', 'inference'],
  });

  log.info('Preferences inferred', { email, priceTier, segment, recommendations: recommendations.length });

  return { email, stylePreferences, priceTier, segment, recommendations };
}

/**
 * Run preference inference for all customers with purchase history.
 * Designed to be called after syncEcommerce() or on a schedule.
 */
export async function inferPreferencesBatch(
  emails: string[],
): Promise<{ processed: number; inferred: number; skipped: number }> {
  let inferred = 0;
  let skipped = 0;

  for (const email of emails) {
    try {
      const result = await inferPreferencesForCustomer(email);
      if (result) {
        inferred++;
      } else {
        skipped++;
      }
    } catch (err) {
      log.error('Preference inference failed', { email, error: err instanceof Error ? err.message : String(err) });
      skipped++;
    }
  }

  log.info('Batch preference inference complete', { processed: emails.length, inferred, skipped });
  return { processed: emails.length, inferred, skipped };
}
