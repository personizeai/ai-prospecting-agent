import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { client, RATE_LIMIT_PAUSE_MS } from '../config.js';
import { CSV_CONFIG } from '../config/prospecting.config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'sync-ecommerce' });

// ─── Helpers ──────────────────────────────────────────────────────

function resolveCSV(filename: string): string | null {
  if (!filename) return null;
  const filePath = resolve(CSV_CONFIG.dataDir, filename);
  if (!existsSync(filePath)) {
    log.warn('File not found, skipping', { filePath });
    return null;
  }
  return filePath;
}

function parseCSVFile<T extends object>(filePath: string): T[] {
  const content = readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as T[];
}

async function batchMemorize(records: any[], label: string): Promise<number> {
  let totalSynced = 0;

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    try {
      await client.memory.memorizeBatch({ records: batch, enhanced: true });
      totalSynced += batch.length;
      log.info('Batch synced', { label, totalSynced });
    } catch (err) {
      log.error('Failed to sync batch', { label, batchStart: i, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  return totalSynced;
}

// ─── Products ─────────────────────────────────────────────────────

interface ProductRow {
  product_id: string;
  name: string;
  description: string;
  category: string;
  price: string;
  currency: string;
  reviews_avg: string;
  reviews_count: string;
  tags: string;
  image_url: string;
}

async function syncProducts(): Promise<number> {
  const filePath = resolveCSV(CSV_CONFIG.productsFile);
  if (!filePath) return 0;

  const rows = parseCSVFile<ProductRow>(filePath).filter((r) => r.product_id && r.name);
  if (!rows.length) {
    log.info('No valid product rows found.');
    return 0;
  }

  const records = rows.map((row) => ({
    email: row.product_id, // primaryKey for products collection
    content: [
      `Product: ${row.name}`,
      `Category: ${row.category || 'Uncategorized'}`,
      `Price: ${row.price} ${row.currency || 'USD'}`,
      row.description || '',
      row.reviews_avg ? `Rating: ${row.reviews_avg}/5 (${row.reviews_count || 0} reviews)` : '',
      row.tags ? `Tags: ${row.tags}` : '',
    ].filter(Boolean).join('\n'),
    collectionName: 'products',
    properties: {
      product_id: { value: row.product_id, extractMemories: false },
      name: { value: row.name, extractMemories: false },
      description: { value: row.description || '', extractMemories: true },
      category: { value: row.category || '', extractMemories: false },
      price: { value: Number(row.price) || 0, extractMemories: false },
      currency: { value: row.currency || 'USD', extractMemories: false },
      reviews_avg: { value: Number(row.reviews_avg) || 0, extractMemories: false },
      reviews_count: { value: Number(row.reviews_count) || 0, extractMemories: false },
      tags_list: { value: row.tags ? row.tags.split(';').map((t) => t.trim()) : [], extractMemories: false },
      image_url: { value: row.image_url || '', extractMemories: false },
    },
    tags: ['ecommerce', 'product', 'catalog', row.category?.toLowerCase() || 'uncategorized'],
  }));

  const synced = await batchMemorize(records, 'products');
  log.info('Product sync complete', { count: synced });
  return synced;
}

// ─── Purchases ────────────────────────────────────────────────────

interface PurchaseRow {
  email: string;
  product_id: string;
  product_name: string;
  purchase_date: string;
  amount: string;
  currency: string;
  quantity: string;
  category: string;
  location: string;
  order_id: string;
  metadata: string;
}

/**
 * Sync purchase history. Each purchase is memorized as a memory on the
 * customer's contact record. We also aggregate purchase stats (total orders,
 * total spent, first/last purchase date, product IDs) onto the contact.
 */
async function syncPurchases(): Promise<{ memorized: number; customersUpdated: number }> {
  const filePath = resolveCSV(CSV_CONFIG.purchasesFile);
  if (!filePath) return { memorized: 0, customersUpdated: 0 };

  const rows = parseCSVFile<PurchaseRow>(filePath).filter((r) => r.email && r.product_id);
  if (!rows.length) {
    log.info('No valid purchase rows found.');
    return { memorized: 0, customersUpdated: 0 };
  }

  // Group purchases by customer for aggregate stats
  const customerPurchases = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const existing = customerPurchases.get(row.email) || [];
    existing.push(row);
    customerPurchases.set(row.email, existing);
  }

  // 1. Memorize each purchase as a memory on the contact
  const purchaseRecords = rows.map((row) => {
    const qty = Number(row.quantity) || 1;
    const amount = Number(row.amount) || 0;
    const total = qty * amount;

    return {
      email: row.email,
      content: [
        `[PURCHASE — ${row.purchase_date || 'Unknown date'}]`,
        `Product: ${row.product_name || row.product_id}`,
        `Category: ${row.category || 'Unknown'}`,
        `Amount: ${total.toFixed(2)} ${row.currency || 'USD'}${qty > 1 ? ` (${qty} × ${amount.toFixed(2)})` : ''}`,
        row.location ? `Location: ${row.location}` : '',
        row.order_id ? `Order: ${row.order_id}` : '',
        row.metadata ? `Details: ${row.metadata.replace(/;/g, ', ')}` : '',
      ].filter(Boolean).join('\n'),
      collectionName: 'contacts',
      tags: ['ecommerce', 'purchase', row.category?.toLowerCase() || 'uncategorized'],
    };
  });

  const memorized = await batchMemorize(purchaseRecords, 'purchases');

  // 2. Update aggregate stats per customer
  let customersUpdated = 0;
  for (const [email, purchases] of customerPurchases) {
    const totalOrders = new Set(purchases.map((p) => p.order_id || `${p.email}-${p.purchase_date}`)).size;
    const totalSpent = purchases.reduce((sum, p) => sum + (Number(p.amount) || 0) * (Number(p.quantity) || 1), 0);
    const productIds = [...new Set(purchases.map((p) => p.product_id))];
    const categories = [...new Set(purchases.map((p) => p.category).filter(Boolean))];

    const dates = purchases
      .map((p) => p.purchase_date)
      .filter(Boolean)
      .sort();
    const firstPurchase = dates[0] || '';
    const lastPurchase = dates[dates.length - 1] || '';

    try {
      await client.memory.memorize({
        email,
        collectionName: 'contacts',
        content: `[PURCHASE SUMMARY] ${totalOrders} orders, $${totalSpent.toFixed(2)} total spent. Categories: ${categories.join(', ')}. Last purchase: ${lastPurchase}.`,
        properties: {
          total_orders: { value: totalOrders, extractMemories: false },
          total_spent: { value: Math.round(totalSpent * 100) / 100, extractMemories: false },
          first_purchase_date: { value: firstPurchase, extractMemories: false },
          last_purchase_date: { value: lastPurchase, extractMemories: false },
          purchased_product_ids: { value: productIds, extractMemories: false },
          favorite_categories: { value: categories, extractMemories: false },
          source: { value: 'Ecommerce CSV', extractMemories: false },
        },
        tags: ['ecommerce', 'customer', 'purchase-summary'],
      });
      customersUpdated++;
    } catch (err) {
      log.error('Failed to update customer aggregate', { email, error: err instanceof Error ? err.message : String(err) });
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
  }

  log.info('Purchase sync complete', { memorized, customersUpdated });
  return { memorized, customersUpdated };
}

// ─── Main Export ───────────────────────────────────────────────────

export interface EcommerceSyncResult {
  products: number;
  purchases: number;
  customersUpdated: number;
}

export async function syncEcommerce(): Promise<EcommerceSyncResult> {
  log.info('Starting ecommerce sync', { dataDir: resolve(CSV_CONFIG.dataDir) });

  let products = 0;
  let purchases = 0;
  let customersUpdated = 0;

  log.info('Syncing product catalog');
  try {
    products = await syncProducts();
  } catch (err) {
    log.error('Product sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Syncing purchase history');
  try {
    const result = await syncPurchases();
    purchases = result.memorized;
    customersUpdated = result.customersUpdated;
  } catch (err) {
    log.error('Purchase sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Ecommerce sync complete', { products, purchases, customersUpdated });
  return { products, purchases, customersUpdated };
}
