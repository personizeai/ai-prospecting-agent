import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { client } from '../config.js';
import { unwrapOrThrow } from '../lib/personize-helpers.js';
import { logger } from '../lib/logger.js';

const GOV_DIR = path.join(process.cwd(), 'governance');

interface LocalDoc {
  slug: string;
  name: string;
  type: string;
  tags: string[];
  value: string;
}

async function loadLocal(): Promise<LocalDoc[]> {
  const entries = await readdir(GOV_DIR, { withFileTypes: true });
  const out: LocalDoc[] = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const skillPath = path.join(GOV_DIR, d.name, 'SKILL.md');
    const raw = await readFile(skillPath, 'utf8').catch(() => null);
    if (!raw) continue;
    const parsed = matter(raw);
    out.push({
      slug: d.name,
      name: parsed.data.name ?? d.name,
      type: parsed.data.type ?? 'guideline',
      tags: parsed.data.tags ?? [],
      value: parsed.content.trim(),
    });
  }
  return out;
}

async function loadRemote(): Promise<Map<string, { id: string; payload: any }>> {
  const data = unwrapOrThrow(await client.context.list({ type: 'guideline' }));
  const map = new Map<string, { id: string; payload: any }>();
  // context.list returns either an array or { actions: [...] } — handle both
  const items = Array.isArray(data) ? data : (data as any)?.actions ?? [];
  for (const item of items as any[]) {
    const name = item.payload?.name ?? item.name;
    const id = item.id ?? item._id;
    if (name && id) map.set(name, { id, payload: item.payload ?? item });
  }
  return map;
}

async function main() {
  const local = await loadLocal();
  const remote = await loadRemote();
  let created = 0, updated = 0, skipped = 0;

  for (const doc of local) {
    const existing = remote.get(doc.name);
    if (!existing) {
      await client.context.create({ type: 'guideline', name: doc.name, value: doc.value, tags: doc.tags });
      logger.info(`Created: ${doc.name}`);
      created++;
    } else {
      const existingValue = existing.payload?.value ?? '';
      const existingTags = existing.payload?.tags ?? [];
      const sameValue = existingValue.trim() === doc.value;
      const sameTags = JSON.stringify([...existingTags].sort()) === JSON.stringify([...doc.tags].sort());
      if (sameValue && sameTags) {
        skipped++;
      } else {
        await client.context.update(existing.id, { value: doc.value, tags: doc.tags });
        logger.info(`Updated: ${doc.name}`);
        updated++;
      }
    }
  }

  logger.info('Governance sync complete', { created, updated, skipped, total: local.length });
}

main().catch((err) => {
  logger.error('Sync failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
