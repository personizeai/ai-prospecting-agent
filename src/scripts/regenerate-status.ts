#!/usr/bin/env npx tsx
/**
 * Revenue OS — STATUS.md Regenerator
 *
 * Writes live system state to STATUS.md. Run on demand.
 * Uses Promise.allSettled so one failure doesn't abort the whole regeneration.
 *
 * Usage:
 *   npm run status
 *   npx tsx src/scripts/regenerate-status.ts
 */

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { client } from '../config.js';
import { memory } from '../lib/memory.js';

const STATE_PATH = path.join(process.cwd(), 'data', 'state', 'dry_run.txt');
const STATUS_PATH = path.join(process.cwd(), 'STATUS.md');

// ─── DRY_RUN ─────────────────────────────────────────────────────────

async function readDryRun(): Promise<boolean> {
  try {
    const raw = (await readFile(STATE_PATH, 'utf8')).trim().toLowerCase();
    return raw !== 'false';
  } catch {
    return true; // missing file → DRY_RUN true
  }
}

// ─── Data fetchers ────────────────────────────────────────────────────

async function fetchOrgInfo(): Promise<{ orgName: string; monthlyLimit: string }> {
  const me = await client.me();
  // MeResponse.organization only has { id } — fetch full org separately
  const orgId = (me.data as any)?.organization?.id;
  const orgName = orgId ? `(org: ${orgId})` : '(unknown)';
  const monthlyLimit = String((me.data as any)?.plan?.limits?.maxApiCallsPerMonth ?? '(unknown)');
  return { orgName, monthlyLimit };
}

async function fetchGuidelineCount(): Promise<number> {
  const result = await client.context.list({ type: 'guideline' });
  return Array.isArray(result.data) ? result.data.length : 0;
}

interface CampaignRow {
  name: string;
  status: string;
}

async function fetchCampaigns(): Promise<CampaignRow[]> {
  const result = await memory.filterByProperty({
    type: 'Campaign',
    conditions: [{ propertyName: 'status', operator: 'exists' }],
    limit: 100,
  });

  if (!result.records || result.records.length === 0) return [];

  return result.records.map((r) => ({
    name: String(r.matchedProperties?.name ?? r.matchedProperties?.campaign_id ?? '(unnamed)'),
    status: String(r.matchedProperties?.status ?? '(unknown)'),
  }));
}

const CONTACT_STAGES = [
  'New',
  'Contacted',
  'Replied',
  'Meeting Set',
  'Closed',
  'Disqualified',
  'Opted Out',
] as const;

async function fetchPipelineCounts(): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};

  await Promise.allSettled(
    CONTACT_STAGES.map(async (stage) => {
      try {
        const result = await memory.filterByProperty({
          type: 'Contact',
          conditions: [{ propertyName: 'outreach_stage', operator: 'equals', value: stage }],
          limit: 1,
        });
        counts[stage] = String(result.totalMatched ?? result.records?.length ?? 0);
      } catch {
        counts[stage] = '(error)';
      }
    }),
  );

  return counts;
}

interface ActivityEntry {
  content?: string;
  [key: string]: unknown;
}

async function fetchRecentActivity(): Promise<string> {
  try {
    const result = await memory.retrieve({
      message: 'outreach sent email LinkedIn call reply',
      mode: 'fast',
      limit: 10,
    });

    const data = result as any;
    const records: ActivityEntry[] = Array.isArray(data?.records)
      ? data.records
      : Array.isArray(data?.data?.records)
        ? data.data.records
        : [];

    if (records.length === 0) return '(outreach log not yet queryable)';

    return records
      .map((r: ActivityEntry, i: number) => `${i + 1}. ${String(r.content ?? '').substring(0, 120)}`)
      .join('\n');
  } catch {
    return '(outreach log not yet queryable)';
  }
}

// ─── Render ──────────────────────────────────────────────────────────

function renderCampaignTable(campaigns: CampaignRow[]): string {
  if (campaigns.length === 0) {
    return '| (none yet) | — |';
  }
  const header = '| Campaign | Status |\n|----------|--------|';
  const rows = campaigns.map((c) => `| ${c.name} | ${c.status} |`).join('\n');
  return `${header}\n${rows}`;
}

function renderPipelineTable(counts: Record<string, string>): string {
  return CONTACT_STAGES.map(
    (stage) => `| ${stage} | ${counts[stage] ?? '(error)'} |`,
  ).join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const timestamp = new Date().toISOString();

  // Fetch everything in parallel, tolerating individual failures
  const [dryRun, orgResult, guidelineResult, campaignResult, pipelineResult, activityResult] =
    await Promise.allSettled([
      readDryRun(),
      fetchOrgInfo(),
      fetchGuidelineCount(),
      fetchCampaigns(),
      fetchPipelineCounts(),
      fetchRecentActivity(),
    ]);

  const isDryRun = dryRun.status === 'fulfilled' ? dryRun.value : true;
  const dryRunDisplay = isDryRun
    ? '**ON** — no real sends'
    : '**OFF** — sending for real';

  const org = orgResult.status === 'fulfilled' ? orgResult.value : { orgName: '(unavailable)', monthlyLimit: '(unavailable)' };
  const guidelineCount = guidelineResult.status === 'fulfilled' ? String(guidelineResult.value) : '(unavailable)';
  const campaigns = campaignResult.status === 'fulfilled' ? campaignResult.value : [];
  const pipelineCounts = pipelineResult.status === 'fulfilled' ? pipelineResult.value : {};
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : '(outreach log not yet queryable)';

  const output = `# Revenue OS — Status Dashboard

> **Owner: Agent.** Auto-generated. Do NOT edit manually.
> Last updated: ${timestamp}
> See \`PLAN.md\` for strategic intent (human-maintained).

---

## System Health

| Metric | Value |
|--------|-------|
| DRY_RUN | ${dryRunDisplay} |
| Organization | ${org.orgName} |
| Plan | ${org.monthlyLimit}/month |
| Guidelines active | ${guidelineCount} |

---

## Campaigns

${renderCampaignTable(campaigns)}

---

## Lead Pipeline

| Stage | Count |
|-------|-------|
${renderPipelineTable(pipelineCounts)}

---

## Recent Activity

${activity}

---

*Regenerate with \`npm run status\`.*
`;

  await writeFile(STATUS_PATH, output, 'utf8');
  console.log(`Status regenerated: ${STATUS_PATH}`);
}

main().catch((err) => {
  console.error('Failed to regenerate status:', err);
  process.exit(1);
});
