# Agent-Native Convergence — revenue-os ↔ GTM superagent

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute with superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Converge `revenue-os` toward the autonomous-agent operating model pioneered in `GTM superagent` — agents wake → read → act → sleep — while preserving the durable cron/webhook execution revenue-os already does well.

**Architecture:** Code becomes a *toolbox* agents pick up when they wake, not a spine that must stay running. State lives in Personize memory + a small set of markdown files (PLAN.md, STATUS.md, governance/*.md). Trigger.dev shrinks to only the 3–5 things that genuinely need guaranteed execution (daily digest, IMAP monitor, cron-enforced send windows). Pipelines become CLI-first pure functions callable by both the agent and Trigger.dev.

**Tech Stack:** `@personize/sdk` 0.9.1 (canonical API surface), Personize MCP, Trigger.dev v3 (shrunk), Model Context Protocol for agent↔revenue-os tool surface, TypeScript, Node ≥ 18.

**Out of scope:** Changes to `revenue-os-dashboard/`, business-logic changes inside pipelines, anything touching other Playground subprojects (gtm-os, gs-edge, Generative Site, etc.).

---

## Dependency graph between phases

```
Phase 0 (SDK canonical migration) ─┬─► Phase 1 (governance as markdown) ──► Phase 5 (shared playbook)
                                   ├─► Phase 2 (CLI-first pipelines) ─────► Phase 4 (MCP expansion) ──► Phase 6 (Trigger.dev shrink)
                                   └─► Phase 3 (PLAN/STATUS/DRY_RUN) ─────► Phase 5 (shared playbook)
```

Phases 1/2/3 can run in parallel after Phase 0 closes.

---

## Phase 0 — Finish canonical SDK migration (in flight)

**Why first:** Every other phase assumes canonical API names. Migrating now avoids touching files twice.

**Files affected (counts):**
- 4 files, 11 sites: `client.guidelines.*` → `client.context.*`
- 10 files, 14 sites: `client.ai.smartGuidelines|smartDocs` + `client.agentdocs.*` → `client.context.retrieve()`
- 29 files, 53 sites: `client.memory.memorize|memorizeBatch` → `memory.save|saveBatch`
- 25 files, 46 sites: `client.memory.recall|smartRecall|smartRecallUnified|smartDigest` → `memory.retrieve({ mode })` / `retrieveDigest`

**Files to create / modify:**
- Create: `revenue-os/src/lib/personize-helpers.ts` — shared `unwrapOrThrow()` + typed entity facades
- Delete: `revenue-os/src/lib/personize-crud.ts` (after Task 0.3)
- Modify: ~49 pipeline/lib/trigger files for deprecation sweep

### Task 0.1: Central `unwrapOrThrow()` helper

**Files:**
- Create: `revenue-os/src/lib/personize-helpers.ts`

- [ ] **Step 1: Write helper with type-safe unwrap**

```ts
// src/lib/personize-helpers.ts
import type { ApiResponse } from '@personize/sdk';

export class PersonizeError extends Error {
  constructor(message: string, public code?: string, public raw?: unknown) {
    super(message);
    this.name = 'PersonizeError';
  }
}

export function unwrapOrThrow<T>(res: ApiResponse<T>): T {
  if (!res?.success || res.data === undefined) {
    throw new PersonizeError(
      res?.error || res?.message || 'Personize API error',
      typeof res?.error === 'string' ? res.error : undefined,
      res,
    );
  }
  return res.data;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd revenue-os && npx tsc --noEmit`
Expected: clean exit

- [ ] **Step 3: Commit**

```bash
git add src/lib/personize-helpers.ts
git commit -m "feat(lib): add central unwrapOrThrow helper + PersonizeError class"
```

### Task 0.2: Migrate `client.guidelines.*` → `client.context.*`

**Files (4):**
- Modify: `src/lib/imap-accounts.ts`, `src/lib/governance-safety.ts`, `src/setup/create-governance.ts`, `src/lib/sender-profiles.ts`

Mechanical rule:
- `client.guidelines.list()` → `client.context.list({ type: 'guideline' })`
- `client.guidelines.create({ name, value, tags })` → `client.context.create({ type: 'guideline', name, value, tags })`
- `client.guidelines.update(id, payload)` → `client.context.update(id, payload)` (type preserved implicitly)
- `client.guidelines.delete(id)` → `client.context.delete(id)`

- [ ] **Step 1: Run grep before**

Run: `rg -n "client\.guidelines\." revenue-os/src`
Record: 11 occurrences across 4 files.

- [ ] **Step 2: Apply mechanical rename across all 4 files**

For each file, apply the mapping above. For list/create calls, ensure `type: 'guideline'` is added.

- [ ] **Step 3: Verify grep returns zero**

Run: `rg -n "client\.guidelines\." revenue-os/src`
Expected: no matches.

- [ ] **Step 4: Typecheck + commit**

Run: `cd revenue-os && npx tsc --noEmit`
Expected: clean exit.

```bash
git add src/lib/imap-accounts.ts src/lib/governance-safety.ts src/setup/create-governance.ts src/lib/sender-profiles.ts
git commit -m "refactor(sdk): migrate client.guidelines.* to client.context.*"
```

### Task 0.3: Migrate `memorize` / `memorizeBatch` → `save` / `saveBatch`

**Files (29):** see Phase 0 summary counts. Pure rename, no signature change.

- [ ] **Step 1: Baseline grep**

Run: `rg -n "client\.memory\.memorize(Batch)?\b" revenue-os/src | wc -l`
Expected: 53.

- [ ] **Step 2: Apply sed-style rename**

Using Edit tool per file (not sed — Grep shows line numbers):
- `client.memory.memorize(` → `client.memory.save(`
- `client.memory.memorizeBatch(` → `client.memory.saveBatch(`

- [ ] **Step 3: Verify zero residual**

Run: `rg -n "client\.memory\.memorize(Batch)?\b" revenue-os/src`
Expected: no matches.

- [ ] **Step 4: Typecheck + commit**

```bash
git add -A
git commit -m "refactor(sdk): migrate memorize/memorizeBatch to canonical save/saveBatch"
```

### Task 0.4: Migrate recall family → `memory.retrieve({ mode })`

**Mapping (requires judgment per call):**
- `client.memory.recall(...)` → `client.memory.retrieve({ ...opts, mode: 'fast' })`
- `client.memory.smartRecall(...)` → `client.memory.retrieve({ ...opts, mode: 'deep' })`
- `client.smartRecallUnified(...)` → `client.memory.retrieve({ ...opts, mode: 'auto' })`
- `client.memory.smartDigest(...)` → `client.memory.retrieveDigest(...)`

- [ ] **Step 1: Locate each call**

Run: `rg -n "client\.memory\.(recall|smartRecall|smartDigest)\b|client\.smartRecallUnified\b" revenue-os/src`

- [ ] **Step 2: Apply per-site migration**

For each match, read the surrounding 10 lines to confirm options shape, then apply mapping. Any ambiguous case (e.g., an options object that mixes legacy shape with new) — keep the old call and mark with `// TODO(migrate-recall)` comment.

- [ ] **Step 3: Typecheck — expect zero errors; if TODOs remain, file them**

```bash
npx tsc --noEmit
rg -n "TODO\(migrate-recall\)" revenue-os/src  # list anything left
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(sdk): migrate recall family to memory.retrieve({ mode })"
```

### Task 0.5: Migrate `ai.smartGuidelines|smartDocs` + `agentdocs.*` → `context.retrieve()`

**Files (10):** `pipelines/account-strategy.ts`, `pipelines/analyze-reply.ts`, `pipelines/analyze-linkedin-event.ts`, `pipelines/analyze-interview.ts`, `pipelines/analyze-call.ts`, `pipelines/detect-signals.ts`, `pipelines/generate-outreach.ts` (4 sites), `pipelines/source-contacts.ts`, `lib/role-governance.ts` (2), `lib/health.ts`.

**Mapping:**
- `client.ai.smartGuidelines({ query, tags })` → `client.context.retrieve({ message: query, tags, types: ['guideline'] })`
- `client.ai.smartDocs({ query, types })` → `client.context.retrieve({ message: query, types })`
- `client.agentdocs.X` → `client.context.X` (identical surface)

- [ ] **Step 1: Per-site migration** (same pattern as 0.4)
- [ ] **Step 2: Typecheck**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(sdk): migrate ai.smart* and agentdocs.* to context.*"
```

### Task 0.6: Delete `personize-crud.ts` shim, inline `client.memory.*`

**Files:**
- Delete: `src/lib/personize-crud.ts`
- Modify: 11 caller files — replace `memoryCrud.X(...)` with `unwrapOrThrow(await client.memory.X(...))`

- [ ] **Step 1: For each caller, replace imports + calls**

Change:
```ts
import { memoryCrud } from '../lib/personize-crud.js';
// ...
const result = await memoryCrud.filterByProperty({ type: 'Campaign', conditions: [...] });
```
To:
```ts
import { client } from '../config.js';
import { unwrapOrThrow } from './personize-helpers.js';  // adjust relative path
// ...
const result = unwrapOrThrow(await client.memory.filterByProperty({ type: 'Campaign', conditions: [...] }));
```

- [ ] **Step 2: Delete shim**

```bash
rm revenue-os/src/lib/personize-crud.ts
```

- [ ] **Step 3: Typecheck — expect zero unresolved imports**

```bash
cd revenue-os && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(lib): inline client.memory.* calls, remove personize-crud shim"
```

### Task 0.7: Run existing test suites

- [ ] **Step 1: Run unit tests**

Run: `cd revenue-os && npm test`
Expected: all pass. If any fail, investigate before proceeding.

- [ ] **Step 2: Run integration tests (if Personize credentials available)**

Run: `npm run test:integration`
Expected: all pass. Integration test failures may indicate actual API behavior changes — investigate case-by-case.

- [ ] **Step 3: Commit any test fixups**

```bash
git commit -m "test: fixups for canonical SDK migration"
```

**Phase 0 exit criteria:** zero deprecated SDK calls, `tsc --noEmit` clean, `npm test` green, personize-crud.ts deleted.

---

## Phase 1 — Governance as markdown + declarative setup

**Why:** Hardcoded governance in TS strings is unreviewable by non-engineers and diffs poorly. GTM superagent's `guidelines/` folder pattern (13 markdown docs in named folders with a `manifest.json`) is the target shape.

**Files to create:**
- `revenue-os/governance/manifest.json`
- `revenue-os/governance/<name>/SKILL.md` for each guideline (name mirrors GTM superagent folders where applicable)
- `revenue-os/src/setup/sync-governance.ts` — declarative diff+apply runner

**Files to delete (after migration):**
- `src/setup/create-governance.ts`
- `src/setup/create-role-governance.ts`

### Task 1.1: Extract current governance into markdown

- [ ] **Step 1: Inventory existing governance**

Read `src/setup/create-governance.ts` and `src/setup/create-role-governance.ts`. List every guideline object with `{ name, value, tags }`.

- [ ] **Step 2: For each guideline, create `governance/<slug>/SKILL.md`**

Layout per folder:
```
governance/
  brand-voice-sdr/
    SKILL.md        # frontmatter: name, tags, type=guideline; body = value
  outreach-playbook-sdr/
    SKILL.md
  ...
  manifest.json     # array of { slug, name, tags, type } — drives sync order
```

SKILL.md frontmatter shape:
```yaml
---
name: brand-voice--sdr
type: guideline
tags: [governance, role-overlay, sdr]
---

# SDR Brand Voice Overlay
... (body from existing TS string)
```

- [ ] **Step 3: Commit the folder**

```bash
git add governance/
git commit -m "docs(governance): extract guidelines from TS to markdown folders"
```

### Task 1.2: Write declarative sync runner

**Files:**
- Create: `revenue-os/src/setup/sync-governance.ts`

- [ ] **Step 1: Write the runner**

```ts
// src/setup/sync-governance.ts
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
  const dirs = await readdir(GOV_DIR, { withFileTypes: true });
  const out: LocalDoc[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const skillPath = path.join(GOV_DIR, d.name, 'SKILL.md');
    const raw = await readFile(skillPath, 'utf8');
    const parsed = matter(raw);
    out.push({
      slug: d.name,
      name: parsed.data.name,
      type: parsed.data.type ?? 'guideline',
      tags: parsed.data.tags ?? [],
      value: parsed.content.trim(),
    });
  }
  return out;
}

async function loadRemote(): Promise<Map<string, any>> {
  const res = unwrapOrThrow(await client.context.list({ type: 'guideline' }));
  const map = new Map<string, any>();
  for (const action of (res as any).actions ?? []) {
    const name = action.payload?.name;
    if (name) map.set(name, action);
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
    } else if (existing.payload?.value !== doc.value || JSON.stringify(existing.payload?.tags) !== JSON.stringify(doc.tags)) {
      await client.context.update(existing.id, { value: doc.value, tags: doc.tags });
      logger.info(`Updated: ${doc.name}`);
      updated++;
    } else {
      skipped++;
    }
  }

  logger.info('Sync complete', { created, updated, skipped, total: local.length });
}

main().catch((err) => { logger.error(err); process.exit(1); });
```

- [ ] **Step 2: Add `gray-matter` dependency**

```bash
cd revenue-os && npm install gray-matter
```

- [ ] **Step 3: Wire into package.json**

Replace `scripts.setup:governance` value with `"setup:governance": "npx tsx src/setup/sync-governance.ts"`. Delete `setup:role-governance` line (merged into sync).

- [ ] **Step 4: Dry-run**

Run: `cd revenue-os && npx tsx src/setup/sync-governance.ts`
Expected: logs `Created`/`Updated`/`Skipped` lines, no errors, final summary matches local folder count.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(setup): declarative governance sync from governance/ folder"
```

### Task 1.3: Delete replaced setup scripts

- [ ] **Step 1: Delete old scripts**

```bash
rm revenue-os/src/setup/create-governance.ts revenue-os/src/setup/create-role-governance.ts
```

- [ ] **Step 2: Grep for stale imports**

Run: `rg -n "create-governance|create-role-governance" revenue-os/src`
Expected: no matches.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git commit -am "chore(setup): remove create-governance.ts and create-role-governance.ts (replaced by sync-governance)"
```

**Phase 1 exit criteria:** `governance/` folder is source of truth, `npm run setup:governance` is idempotent, TS governance scripts deleted.

---

## Phase 2 — CLI-first pipelines (decouple from Trigger.dev)

**Why:** Agents need to invoke `npx tsx pipelines/research-company.ts --domain acme.com` without pulling in the Trigger.dev runtime. Today pipelines are coupled to Trigger.dev via `@trigger.dev/sdk` imports in many of them.

**Pattern per pipeline:**
```
src/pipelines/research-company.ts          # Pure function. Zero Trigger.dev imports.
src/pipelines/research-company.cli.ts      # Thin CLI wrapper — parses argv, calls pure fn, prints result.
src/trigger/research-company.task.ts       # Trigger.dev task — imports pure fn.
```

### Task 2.1: Audit pipeline imports

- [ ] **Step 1: Find which pipelines import trigger.dev**

Run: `rg -l "@trigger\.dev/sdk" revenue-os/src/pipelines`
Record the list — these need decoupling.

- [ ] **Step 2: Categorize pipelines**

For each pipeline file, add one line to `docs/plans/pipeline-inventory.md` with: name, used-by (trigger task? mcp-server? cli?), takes args from.

- [ ] **Step 3: Commit the inventory**

```bash
git add docs/plans/pipeline-inventory.md
git commit -m "docs: pipeline-by-pipeline decoupling inventory"
```

### Task 2.2: Refactor one pipeline end-to-end as the template

Pick `research-company.ts` (representative: takes a domain, calls memory + AI, writes back).

- [ ] **Step 1: Extract pure function signature**

Rewrite `src/pipelines/research-company.ts` so the default export is a pure async function:
```ts
export interface ResearchCompanyInput { domain: string; depth?: 'fast' | 'deep'; }
export interface ResearchCompanyOutput { domain: string; findings: string; memoryId?: string; }
export async function researchCompany(input: ResearchCompanyInput): Promise<ResearchCompanyOutput> { /* ... */ }
```
No `import { task } from '@trigger.dev/sdk'`. No `logger` from Trigger's context — use `src/lib/logger.ts`.

- [ ] **Step 2: Create CLI wrapper**

```ts
// src/pipelines/research-company.cli.ts
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { researchCompany } from './research-company.js';

const { values } = parseArgs({ options: { domain: { type: 'string', short: 'd' }, depth: { type: 'string' } } });
if (!values.domain) { console.error('Usage: research-company --domain <domain> [--depth fast|deep]'); process.exit(1); }

researchCompany({ domain: values.domain, depth: values.depth as 'fast' | 'deep' | undefined })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Create Trigger.dev task wrapper**

```ts
// src/trigger/research-company.task.ts
import { task } from '@trigger.dev/sdk/v3';
import { researchCompany } from '../pipelines/research-company.js';

export const researchCompanyTask = task({
  id: 'research-company',
  run: async (payload: { domain: string; depth?: 'fast' | 'deep' }) => researchCompany(payload),
});
```

- [ ] **Step 4: Smoke test both invocation paths**

Run: `cd revenue-os && npx tsx src/pipelines/research-company.cli.ts --domain personize.ai`
Expected: JSON result printed, exit 0.

Run (if Trigger dev available): `npm run dev` and invoke the task via Trigger dashboard.
Expected: same output.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(pipelines): research-company as pure fn with CLI + Trigger wrappers (template)"
```

### Task 2.3: Apply the pattern to remaining pipelines

Loop through the inventory from 2.1. For each pipeline:
1. Extract pure function (strip Trigger.dev imports).
2. Add `.cli.ts` wrapper.
3. Move Trigger.dev task to `src/trigger/<name>.task.ts`.
4. Update imports in `src/mcp-server.ts` and elsewhere.
5. Smoke test via CLI.
6. Commit.

**Do these in batches of 3–5 pipelines per commit to keep reviews tractable.**

- [ ] Batch 1: sync-* pipelines (sync-csv, sync-hubspot, sync-salesforce, sync-clay, sync-ecommerce)
- [ ] Batch 2: generate-* pipelines (generate-outreach, generate-call-script, generate-linkedin-message, generate-interview-guide)
- [ ] Batch 3: analyze-* pipelines (analyze-call, analyze-reply, analyze-linkedin-event, analyze-interview)
- [ ] Batch 4: research/enrich pipelines (research-company, enrich-apollo, enrich-companies-apollo, discover-contacts-apollo)
- [ ] Batch 5: remaining (source-contacts, detect-signals, ingest-enrichment, ingest-signals, conduct-interview, assign-role, account-strategy, execute-task, infer-preferences, meta-metrics, weekly-report)

### Task 2.4: Add a batch-safe sync helper

**Why:** Most `sync-*` pipelines loop records calling `memory.save` per item. `memory.saveBatch` is ~10–50× faster.

**Files:**
- Modify: each `sync-*.ts` pipeline (already touched in Task 2.3 Batch 1)

- [ ] **Step 1: In each sync pipeline, replace per-record loop with `saveBatch`**

Before:
```ts
for (const record of records) {
  await client.memory.save({ recordId: record.email, type: 'Contact', properties: {...} });
}
```
After:
```ts
const items = records.map((r) => ({ recordId: r.email, type: 'Contact', properties: {...} }));
for (let i = 0; i < items.length; i += 100) {
  await client.memory.saveBatch({ items: items.slice(i, i + 100) });
}
```

- [ ] **Step 2: Remove `RATE_LIMIT_PAUSE_MS` sleep calls** inside these loops.

Run: `rg -n "RATE_LIMIT_PAUSE_MS|setTimeout.*2000" revenue-os/src/pipelines`
For each match, delete if it's inside a sync loop. SDK's built-in retry handles 429.

- [ ] **Step 3: Smoke test one sync with a small CSV**

Run: `npm run sync:csv` (points to small test file)
Expected: completes faster than baseline, no 429 errors logged.

- [ ] **Step 4: Commit**

```bash
git commit -am "perf(sync): batchify CRM syncs via memory.saveBatch, remove manual rate pause"
```

**Phase 2 exit criteria:** every pipeline runnable as `npx tsx src/pipelines/<name>.cli.ts`, no Trigger.dev import in `src/pipelines/`, all syncs use saveBatch.

---

## Phase 3 — PLAN.md / STATUS.md / DRY_RUN pattern

**Why:** Consolidate scattered intent files, give human a single lever, give agent a single scratchpad, and put a durable safety gate on send actions.

### Task 3.1: Create PLAN.md

**Files:**
- Create: `revenue-os/PLAN.md`
- Archive: `AUTONOMOUS-AGENT-PLAN.md`, `ROADMAP.md`, `SALES-COLLABORATION-HUB.md` → `archive/2026-04-21/`

- [ ] **Step 1: Draft PLAN.md using GTM superagent's template**

Sections: Vision, Active Goals (table), Campaigns — Strategic Intent, Decisions Made (dated), Backlog, Parking Lot, Team & Roles, How to Use This File.

Copy the scaffolding from `C:\Users\Admin\Documents\GitHub\GTM superagent\PLAN.md` — adapt fields to revenue-os domain (multi-channel, not just email).

- [ ] **Step 2: Seed PLAN.md by mining existing intent docs**

For each of `AUTONOMOUS-AGENT-PLAN.md`, `ROADMAP.md`, `SALES-COLLABORATION-HUB.md` — extract: current goals, open decisions, parking-lot items. Paste into PLAN.md's tables. Be ruthless — if something is stale, it goes to the archive, not the new PLAN.

- [ ] **Step 3: Move old files to `archive/2026-04-21/`**

```bash
mkdir -p revenue-os/archive/2026-04-21
git mv revenue-os/AUTONOMOUS-AGENT-PLAN.md revenue-os/ROADMAP.md revenue-os/SALES-COLLABORATION-HUB.md revenue-os/archive/2026-04-21/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: introduce PLAN.md as single source of human intent, archive scattered plans"
```

### Task 3.2: Create STATUS.md + regenerator script

**Files:**
- Create: `revenue-os/STATUS.md` (initial stub)
- Create: `revenue-os/src/scripts/regenerate-status.ts`

- [ ] **Step 1: Write the regenerator script**

Mirror GTM superagent's STATUS.md sections: System Health, Active Campaigns (query Personize), Lead Pipeline (counts by stage), Recent Activity (from outreach-log), Open Issues, Pending Tasks.

Script calls:
- `client.me()` → credits, plan
- `client.memory.filterByProperty({ type: 'Campaign' })` → active campaigns
- `client.memory.filterByProperty({ type: 'Contact', conditions: [...] })` → pipeline counts per stage
- Read `data/state/dry_run.txt` → DRY_RUN status

Output writes to `revenue-os/STATUS.md` with header `> Last updated: <ISO timestamp>`.

- [ ] **Step 2: Add to package.json**

Add script: `"status": "npx tsx src/scripts/regenerate-status.ts"`

- [ ] **Step 3: Run it**

Run: `cd revenue-os && npm run status`
Expected: STATUS.md written with real numbers, exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(status): STATUS.md regenerator for live system state"
```

### Task 3.3: DRY_RUN gate

**Files:**
- Create: `revenue-os/data/state/dry_run.txt` (contents: `true`)
- Create: `revenue-os/src/lib/dry-run.ts`
- Modify: every `delivery/` file + every pipeline that sends email/LinkedIn/phone

- [ ] **Step 1: Write gate helper**

```ts
// src/lib/dry-run.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const STATE_PATH = path.join(process.cwd(), 'data', 'state', 'dry_run.txt');

let cached: boolean | null = null;

export async function isDryRun(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const raw = (await readFile(STATE_PATH, 'utf8')).trim().toLowerCase();
    cached = raw !== 'false';
  } catch {
    cached = true;  // default-safe
  }
  return cached;
}

export function resetDryRunCache() { cached = null; }
```

- [ ] **Step 2: Seed the state file**

```bash
mkdir -p revenue-os/data/state
echo "true" > revenue-os/data/state/dry_run.txt
```

- [ ] **Step 3: Wrap every real send call**

Grep for actual send sites:
```bash
rg -n "nodemailer|imapflow.*send|gmailClient\.send|linkedinPost|phone\.dial" revenue-os/src
```
At each site:
```ts
import { isDryRun } from '../lib/dry-run.js';
// ...
if (await isDryRun()) {
  logger.info('[DRY_RUN] Would send', { to, subject, campaign });
  return { dryRun: true, would: { to, subject } };
}
// original send...
```

- [ ] **Step 4: Add CLI helper to flip it**

Add to `src/scripts/ros.ts`: `ros dry-run on|off` commands that write to the state file.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(safety): DRY_RUN gate on all real send paths, default true"
```

**Phase 3 exit criteria:** PLAN.md owns intent, STATUS.md regenerates live, DRY_RUN defaults true and blocks every real send.

---

## Phase 4 — MCP tool surface expansion

**Why:** 30 pipelines, 18 MCP tools — the agent can't invoke most of the business logic without hand-editing code. Goal: generic `run_pipeline` tool + PLAN/STATUS/governance readers so the agent has a complete control surface.

### Task 4.1: Generic `run_pipeline` MCP tool

**Files:**
- Modify: `src/mcp-server.ts`

- [ ] **Step 1: Build a pipeline registry**

```ts
// src/mcp-server.ts (add near top)
import { researchCompany } from './pipelines/research-company.js';
import { generateOutreach } from './pipelines/generate-outreach.js';
// ... one import per pipeline

const PIPELINES: Record<string, { fn: (input: any) => Promise<any>; description: string }> = {
  'research-company': { fn: researchCompany, description: 'Research a company domain and memorize findings' },
  'generate-outreach': { fn: generateOutreach, description: 'Generate outreach email for a contact' },
  // ... etc
};
```

- [ ] **Step 2: Register the generic tool**

```ts
server.tool(
  'run_pipeline',
  `Run any revenue-os pipeline by name. List available pipelines via list_pipelines.
Input: { name: string, input: object } — input schema varies per pipeline; call list_pipelines first if unsure.`,
  {
    name: z.string().describe('Pipeline name (e.g., "research-company")'),
    input: z.record(z.any()).describe('Pipeline-specific input object'),
  },
  async ({ name, input }) => {
    const p = PIPELINES[name];
    if (!p) return { content: [{ type: 'text' as const, text: `Unknown pipeline: ${name}. Try list_pipelines.` }] };
    const result = await p.fn(input);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'list_pipelines',
  'List all available pipelines with descriptions.',
  {},
  async () => ({
    content: [{
      type: 'text' as const,
      text: Object.entries(PIPELINES).map(([k, v]) => `- ${k}: ${v.description}`).join('\n'),
    }],
  }),
);
```

- [ ] **Step 3: Smoke test from MCP inspector**

Run: `npx @modelcontextprotocol/inspector npx tsx src/mcp-server.ts`
In the UI, call `list_pipelines` → expect full list. Call `run_pipeline` with `{ name: 'research-company', input: { domain: 'personize.ai' } }` → expect JSON result.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(mcp): generic run_pipeline + list_pipelines tools"
```

### Task 4.2: PLAN/STATUS/governance reader tools

Add MCP tools:
- `read_plan()` → returns PLAN.md content
- `read_status()` → returns STATUS.md content (and triggers regenerate if older than 5 min)
- `read_governance({ slug })` → returns `governance/<slug>/SKILL.md` content
- `list_governance()` → returns slugs from `governance/manifest.json`

- [ ] **Step 1: Implement the four tools in mcp-server.ts**
- [ ] **Step 2: Smoke test each via inspector**
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(mcp): add plan/status/governance reader tools"
```

**Phase 4 exit criteria:** agent can list + run every pipeline, read PLAN/STATUS/governance entirely through MCP.

---

## Phase 5 — Shared agent playbook (RECALL → GOVERN → ACT → STORE)

**Why:** GTM superagent's CLAUDE.md encodes a RECALL→GOVERN→ACT→STORE loop. Revenue-os pipelines each reimplement this ad-hoc. One canonical playbook in Personize memory, referenced from both repos' CLAUDE.md.

### Task 5.1: Extract the playbook as a Personize guideline

- [ ] **Step 1: Write `governance/agent-playbook/SKILL.md`**

Content = distilled version of GTM superagent's CLAUDE.md "Core Loop" + "Tool Routing" + "Hard Rules" sections, adapted to be repo-agnostic (not GTM-specific).

- [ ] **Step 2: Sync it** (uses Phase 1's sync runner)

Run: `npm run setup:governance`
Expected: creates `agent-playbook` guideline in Personize.

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(governance): canonical agent playbook as shared guideline"
```

### Task 5.2: Wire into both repos' CLAUDE.md

**Files:**
- Modify: `revenue-os/CLAUDE.md`
- Modify: `C:\Users\Admin\Documents\GitHub\GTM superagent\CLAUDE.md`

- [ ] **Step 1: In each CLAUDE.md, replace inline playbook sections with a reference**

```markdown
## Agent Operating Loop

Load the shared playbook at session start:
  context_retrieve(message='agent operating loop', contextNames=['agent-playbook'])

Repo-specific overrides (below) extend, never replace, the playbook.
```

- [ ] **Step 2: Keep only repo-specific content in each CLAUDE.md**

- [ ] **Step 3: Commit each repo**

```bash
# in revenue-os
git commit -am "docs(claude): reference shared agent-playbook guideline"
# in GTM superagent (separate repo)
git commit -am "docs(claude): reference shared agent-playbook guideline"
```

**Phase 5 exit criteria:** one playbook in Personize, both repos' CLAUDE.md reference it, no inline duplication.

---

## Phase 6 — Trigger.dev shrink

**Why:** Now that pipelines are CLI-first and agent-invokable, most Trigger.dev tasks are redundant. Keep only what genuinely needs guaranteed cron/webhook execution.

### Task 6.1: Decide the keep list

- [ ] **Step 1: Audit `src/trigger/` against runtime needs**

For each trigger task, classify:
- **KEEP** — needs guaranteed execution (cron-based schedulers, webhook listeners, long-running queues)
- **AGENT** — can be agent-invoked instead

Expected keep list:
- `daily-digest.ts` (cron, needs 9am guaranteed)
- `imap-reply-monitor.ts` (persistent webhook listener)
- `outreach-engine.ts` (send-window enforcement + rate limit batching)
- `personize-webhook.ts` (inbound webhook handler)
- `interview-webhooks.ts` (inbound webhook handler)

Expected move-to-agent list:
- `outreach-sequence.ts`, `interview-scheduler.ts`, `learning-loop.ts`, `multichannel-engine.ts`, `webhooks.ts` (consolidate with the other webhook handlers)

- [ ] **Step 2: Document the keep list in `docs/plans/trigger-keep-list.md`**
- [ ] **Step 3: Commit the inventory**

### Task 6.2: Remove agent-invokable trigger tasks

- [ ] **Step 1: For each move-to-agent trigger, verify the underlying pipeline is callable via MCP `run_pipeline`**
- [ ] **Step 2: Delete the trigger file**
- [ ] **Step 3: Remove from trigger.config.ts if referenced**
- [ ] **Step 4: Typecheck + commit per batch of 2–3 deletions**

### Task 6.3: Verify Trigger.dev still works for kept tasks

- [ ] **Step 1: Run `npm run dev`**
Expected: only the kept tasks show up in the dashboard.

- [ ] **Step 2: Invoke each kept task**
Expected: all run successfully.

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(trigger): shrink to cron+webhook-only tasks, move rest to agent-invokable"
```

**Phase 6 exit criteria:** `src/trigger/` has only tasks that need guaranteed execution; everything else is agent-invokable.

---

## Cross-cutting concerns

### Optimistic concurrency on workspace mutations (idea I from earlier)

**Apply during Phase 2's pipeline refactors** — wherever `workspace.ts` or `account-workspace.ts` helpers are called, wrap in a 409 retry:

```ts
// src/lib/personize-helpers.ts (extend)
export async function withConcurrencyRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (err: any) {
      if (err?.status === 409 && i < maxAttempts - 1) continue;
      throw err;
    }
  }
  throw new Error('unreachable');
}
```

All workspace helpers that do read-modify-write on arrays should pass `expectedVersion` and use this wrapper.

### Branded types (idea O — optional, defer)

Low-priority, do only if concrete bug is traced to string-type confusion. Skip unless you see one.

### Pipeline orphan check (idea Q)

Run after Phase 6:
```bash
for f in revenue-os/src/pipelines/*.ts; do
  name=$(basename "$f" .ts)
  count=$(rg -l "from .*pipelines/$name" revenue-os/src | wc -l)
  [ "$count" -le 1 ] && echo "ORPHAN: $name"
done
```
Delete anything flagged (after a quick sanity read).

---

## Verification gates between phases

Between each phase, run:

```bash
cd revenue-os
npx tsc --noEmit                  # zero errors
npm test                          # all pass
npm run test:integration          # all pass (if creds available)
rg -n "TODO\(migrate-" src        # zero matches
```

Commit a checkpoint tag: `git tag phase-N-complete`.

---

## Estimated effort

| Phase | Est. tasks | Est. commits | Est. session-hours |
|---|---|---|---|
| 0 | 7 | 7 | 2–3 |
| 1 | 3 | 4 | 2 |
| 2 | 4 + 5 batches | 10–12 | 6–8 |
| 3 | 3 | 5 | 3 |
| 4 | 2 | 2 | 2 |
| 5 | 2 | 3 | 1 |
| 6 | 3 | 4–6 | 2 |
| **Total** | **~30 tasks** | **~35 commits** | **18–21 hours** |

---

## Risks

1. **Pipeline refactor touches 30 files** — highest chance of regressions. Mitigation: one pipeline end-to-end first as template (Task 2.2), test before applying to rest.
2. **DRY_RUN gate placement** — easy to miss a send site. Mitigation: grep audit before merge; cache behavior of `isDryRun()` inside long-running pipelines means cache reset on state-file change.
3. **Trigger.dev shrink removes safety nets** — a cron task you thought was optional might actually be load-bearing. Mitigation: Phase 6 Task 6.1 inventory before any deletion; keep list bias-to-retain for first pass.
4. **Archive of AUTONOMOUS-AGENT-PLAN.md etc.** is irreversible in spirit (human attention) even if files are in archive/. Mitigation: seed PLAN.md from them carefully; keep archive/ in git so nothing is truly gone.

---

## Not in this plan (separate work)

- Entity-helper facade (idea N) — defer until after Phase 2 when call-site repetition is actually painful.
- Branded types (idea O) — only if driven by a real bug.
- Dashboard convergence (`revenue-os-dashboard` vs nested copy) — separate work, out of scope.
- Other Playground subprojects (gtm-os, gs-edge, etc.) — each has its own cadence.
