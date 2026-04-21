# Revenue OS — Agent Context

This repo is the open-source operating system for AI-powered revenue teams. It runs outreach campaigns autonomously — prospecting, enrichment, multi-channel sequences, reply handling, and reporting.

## Stack

- **Runtime:** TypeScript + Node.js 18+
- **Scheduler:** Trigger.dev v3 (durable tasks, cron, webhooks)
- **Memory + AI:** Personize SDK (`@personize/sdk`) — entity memory, governance, AI generation
- **MCP Server:** `src/mcp-server.ts` — 19 tools for AI assistants (this repo)
- **Dashboard:** Next.js app in `revenue-os-dashboard/`

## Key Commands

```bash
npm run setup          # Create 6 collections + governance in Personize
npm run ros -- status  # Full system status (campaigns, senders, metrics)
npm test               # 318 tests
npm run typecheck      # TypeScript strict check
npm run dev            # Start Trigger.dev dev server
npm run deploy         # Deploy to Trigger.dev cloud
```

## MCP Tools Available (Revenue OS Server)

This repo includes an MCP server at `src/mcp-server.ts` with 19 tools. When working in this repo, these tools are available via `.mcp.json`:

**Discovery:** `apollo_search_contacts` (FREE), `apollo_enrich_contact` (1 credit), `apollo_enrich_company` (1 credit), `discover_and_memorize_contacts` (search + memorize + enroll, all-in-one)

**Research:** `research_company` (Tavily web search with AI summary)

**Campaigns:** `campaign_create`, `campaign_list`, `campaign_stats`, `campaign_activate`, `campaign_pause`, `campaign_enroll`

**Ecommerce:** `ecommerce_sync` (import products + purchases from CSV), `ecommerce_infer_preferences` (analyze purchase patterns → style/segment), `ecommerce_generate_variables` (personalized email variables for ESP templates)

**Status:** `sender_list`, `daily_status`, `daily_brief`, `search_contacts`

Full tool reference with parameters and example responses: `MCP-TOOLS.md`

## Architecture: Key Files

| Area | Files |
|------|-------|
| **Campaign system** | `src/lib/campaign.ts` (enrollment, stats, ICP matching), `src/scripts/ros.ts` (CLI) |
| **Outreach pipeline** | `src/trigger/outreach-engine.ts` → `src/trigger/outreach-sequence.ts` → `src/pipelines/generate-outreach.ts` |
| **Event-driven ingestion** | `src/trigger/personize-webhook.ts` (receives Personize events → scores ICP → matches campaigns → enrolls) |
| **Sender management** | `src/lib/sender-profiles.ts` (health, warmup, rotation, capacity, persona matching) |
| **Account coordination** | `src/lib/account-workspace.ts` + `src/pipelines/account-strategy.ts` + `src/pipelines/account-preflight.ts` |
| **Reply handling** | `src/trigger/imap-reply-monitor.ts` → `src/trigger/reply-handler.ts` → `src/pipelines/analyze-reply.ts` |
| **Learning** | `src/trigger/learning-loop.ts` (weekly angle analysis), `src/trigger/daily-digest.ts` (daily brief + auto-pause) |
| **Governance** | `src/lib/governance-safety.ts` (versioning, validation, dry-run, rollback) |
| **Ecommerce** | `src/pipelines/sync-ecommerce.ts` (purchase + product CSV ingest), `src/pipelines/infer-preferences.ts` (AI preference inference), `generate-outreach.ts:generateEcommerceVariables()` (variable-mode output for ESPs). Guide: `ECOMMERCE.md` |
| **Schemas** | `src/setup/create-schemas.ts` — 6 collections: Contacts, Companies, Outreach Log, Web Research, Campaigns, Products |
| **Config** | `src/config/prospecting.config.ts` (all settings), `src/config/agent-modes.ts` (18 modes), `src/config/sales-roles.ts` (5 roles) |

## Conventions

- `DRY_RUN=true` by default — emails generate but don't send. Set `DRY_RUN=false` to go live.
- Campaign stats are stored as properties on Campaign records (incremented on events, 0-cost reads).
- Outreach-log records include `campaign_id` and `variant` for per-campaign analysis.
- Every agent action writes to the contact/account workspace (audit trail).
- Governance variables control all AI-generated content — edit in Personize dashboard, not in code.

## Skills

- `/onboarding` — Full setup wizard: interviews user, configures governance, creates first campaign
- `/strategy-review` — Autonomous performance review: analyzes metrics, proposes governance changes
