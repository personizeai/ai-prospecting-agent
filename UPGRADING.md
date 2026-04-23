# Upgrading the AI Prospecting Agent

This guide helps you pull the latest changes from upstream into your fork without breaking your setup.

---

## Quick Upgrade

```bash
# 1. Fetch the latest from upstream
git remote add upstream https://github.com/personizeai/ai-prospecting-agent.git  # first time only
git fetch upstream

# 2. See what changed
git log --oneline HEAD..upstream/main

# 3. Merge (or rebase if you prefer)
git merge upstream/main

# 4. Reinstall dependencies (required when package.json changes)
rm -rf node_modules
npm install

# 5. Verify everything works
npm run typecheck
npm test
```

---

## Breaking Changes by Version

### v0.7.x — Personize SDK Upgrade (0.6.x → 0.7.2)

**What changed:**

1. **`workspace.getIssues()` returns `Issue[]` directly** — Previously returned `{ data: Issue[] }`. If you wrote custom code that accesses `.data` on issue results, remove it.

2. **Issue objects are now typed** — Access properties directly instead of parsing JSON strings from `.content`:
   ```typescript
   // Before
   if (content.includes('"STATUS":"OPEN"') && content.includes('"SEVERITY":"CRITICAL"')) { ... }
   // After
   if (item.status === 'open' && item.severity === 'critical') { ... }
   ```

3. **New SDK capabilities now utilized:**
   - `smartRecall` with `prefer_recent: true` — Fresh signals and strategies surface first
   - `memory.deleteRecord()` — Opt-outs and bounces trigger soft-delete with 30-day recovery (GDPR compliance)
   - `personize-crud.ts` — New utility wrapping `update()`, `bulkUpdate()`, `propertyHistory()`, `deleteRecord()`, and `cancelDeletion()`

4. **New SDK capabilities available** (optional — not yet integrated):
   - `memory.filterByProperty()` — Zero-cost deterministic filters (no LLM credits)
   - `memory.similar()` / `memory.segment()` — Lookalike prospecting and ICP-based segmentation
   - `memory.queryProperties()` — Natural-language search across property values

**How to upgrade your fork:**

```bash
npm install @personize/sdk@^0.7.2
npm run typecheck    # fix any .data or .content references
npm test             # verify everything passes
```

### Personize CLI (New Dev Tool)

The CLI is now included as a devDependency. Useful commands:

```bash
npx personize doctor              # Verify setup
npx personize context --email X   # What agent sees for a contact
npx personize filter --collection contacts --gt lead_score=70  # Zero-cost query
npx personize setup               # Configure MCP in your IDE
```

---

## Keeping Your Customizations Safe

These files are **yours** and won't be overwritten by upstream merges:

| File | What It Contains |
|---|---|
| `.env` | Your API keys and configuration |
| Personize Dashboard | Your governance variables (ICP, brand voice, playbook, signals, competitor policy) |
| `data/*.csv` | Your CSV data files |

These files **may change** in upstream and could cause merge conflicts:

| File | What To Do |
|---|---|
| `package.json` | Accept upstream changes, then run `npm install` |
| `src/config/prospecting.config.ts` | Merge carefully — keep your custom settings, accept new defaults |
| `trigger.config.ts` | Usually safe to accept upstream |

---

## If Something Breaks After Upgrade

```bash
# 1. Check TypeScript compiles
npm run typecheck

# 2. Run tests
npm test

# 3. If all else fails, start fresh
git stash
git reset --hard upstream/main
npm install
npm run typecheck && npm test
git stash pop                     # reapply your changes
```

---

## Staying Up to Date

We recommend pulling upstream changes at least monthly. Watch the repo for releases:

```
https://github.com/personizeai/ai-prospecting-agent/releases
```

New features are always backward-compatible unless noted in this file.
