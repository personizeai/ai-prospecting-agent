import { readFile } from 'node:fs/promises';
import path from 'node:path';

const STATE_PATH = path.join(process.cwd(), 'data', 'state', 'dry_run.txt');

let cached: boolean | null = null;

export async function isDryRun(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const raw = (await readFile(STATE_PATH, 'utf8')).trim().toLowerCase();
    cached = raw !== 'false';  // default-safe: any content except "false" → DRY_RUN true
  } catch {
    cached = true;  // missing file → DRY_RUN true
  }
  return cached;
}

export function resetDryRunCache(): void { cached = null; }
