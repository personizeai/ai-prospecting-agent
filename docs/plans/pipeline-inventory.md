# Pipeline Inventory — Phase 2 Scope

Generated: 2026-04-21. Classifies every file in `src/pipelines/` for the CLI-first refactor.

**Total pipelines:** 30
**Classification counts:**
- pure-function: 22
- trigger-coupled: 0
- orphan: 3
- entrypoint-only: 0
- internal-utility: 5 _(called only by other pipelines or via dynamic import from trigger wrappers — pure functions but narrow callers)_

> Note: zero pipelines import `@trigger.dev/sdk/v3`. All business logic already lives outside Trigger. The trigger files in `src/trigger/` are thin wrappers that call these pure functions. Classification focuses on caller surface and effort to expose each pipeline to the CLI layer.

| Pipeline | Exports | Trigger Import | Task ID | Inputs | Callers | Classification | Effort |
|---|---|---|---|---|---|---|---|
| `account-preflight` | `accountPreflight` | no | — | `(contactEmail: string, companyDomain?: string)` | `src/pipelines/generate-outreach.ts`, `src/pipelines/generate-call-script.ts`, `src/pipelines/generate-interview-guide.ts`, `src/pipelines/generate-linkedin-message.ts` | `pure-function` | S |
| `account-strategy` | `evaluateAccountStrategy`, `evaluateAccountStrategies` | no | — | `(domain: string)` / `(accounts: Array<{domain, company?}>, maxAccounts?)` | `src/trigger/signal-detection.ts`, `src/trigger/personize-webhook.ts` (dynamic import) | `pure-function` | S |
| `analyze-call` | `analyzeCall`, `handleAnalyzedCall`, `processCallResult` | no | — | `(result: CallResult)` | `src/trigger/call-webhooks.ts` | `pure-function` | S |
| `analyze-interview` | `analyzeInterview`, `handleAnalyzedInterview`, `processInterviewResult` | no | — | `(result: CallResult, guide: InterviewGuide)` | `src/trigger/interview-webhooks.ts` | `pure-function` | S |
| `analyze-linkedin-event` | `processLinkedInEvent` | no | — | `(event: LinkedInEvent)` | `src/trigger/heyreach-webhook.ts` | `pure-function` | S |
| `analyze-reply` | `analyzeReply`, `handleAnalyzedReply` | no | — | `(contactEmail: string, replyBody: string, replySubject?: string)` | `src/trigger/reply-handler.ts` | `pure-function` | S |
| `assign-role` | `assignRoleToContact`, `backfillRoles` | no | — | `(email: string, leadStatus?: string)` | `src/trigger/personize-webhook.ts` (dynamic import) | `pure-function` | S |
| `conduct-interview` | `conductInterview` | no | — | `(guide: InterviewGuide, contactId: string)` | `src/trigger/interview-scheduler.ts` | `pure-function` | S |
| `detect-signals` | `detectAndScoreSignals` | no | — | `()` | `src/trigger/signal-detection.ts` | `pure-function` | S |
| `discover-contacts-apollo` | `discoverContactsForAccount`, `discoverContactsForHotAccounts` | no | — | `(account: HotAccount)` / `(hotAccounts: HotAccount[])` | `src/trigger/discover-contacts.ts`, `src/pipelines/source-contacts.ts` | `pure-function` | S |
| `enrich-apollo` | `enrichContacts` | no | — | `()` | `src/trigger/enrich-contacts.ts` | `pure-function` | S |
| `enrich-companies-apollo` | `enrichCompanies` | no | — | `()` | `src/trigger/enrich-contacts.ts` | `pure-function` | S |
| `execute-task` | `handleOutreachTask`, `handleGenericTask`, `executeTask` | no | — | `(contactEmail: string, task: WorkspaceTask, dryRun: boolean, taskId?: string)` | `src/trigger/task-executor.ts` | `pure-function` | S |
| `generate-call-script` | `generateCallScriptForContact` | no | — | `(email: string, icpScore: number, step?: number, dryRun?: boolean)` | `src/trigger/multichannel-engine.ts` | `pure-function` | S |
| `generate-interview-guide` | `generateInterviewGuide` | no | — | `(email: string, purpose: InterviewPurpose, additionalContext?: string, dryRun?: boolean)` | `src/trigger/interview-scheduler.ts` | `pure-function` | S |
| `generate-linkedin-message` | `generateLinkedInMessage` | no | — | `(email: string, linkedinUrl: string, step?: number, dryRun?: boolean)` | `src/trigger/multichannel-engine.ts` | `pure-function` | S |
| `generate-outreach` | `assembleContext`, `generateOutreachForContact`, `generateEcommerceVariables`, `generateCallScript` | no | — | `(email: string, dryRun?: boolean, cadenceOverride?, roleId?, campaignId?)` | `src/trigger/outreach-engine.ts`, `src/trigger/outreach-sequence.ts`, `src/trigger/role-schedulers.ts`, `src/mcp-server.ts` | `pure-function` | S |
| `infer-preferences` | `inferPreferencesForCustomer`, `inferPreferencesBatch` | no | — | `(email: string)` | `src/mcp-server.ts` (dynamic import) | `pure-function` | S |
| `ingest-enrichment` | `ingestEnrichment` | no | — | `(data: EnrichmentData)` | `src/pipelines/discover-contacts-apollo.ts`, `src/pipelines/enrich-apollo.ts` | `pure-function` | S |
| `ingest-signals` | `ingestSignal`, `ingestSignalBatch` | no | — | `(signal: Signal)` / `(signals: Signal[])` | _(no trigger or external callers — only self-referencing batch wrapper)_ | `orphan` | S |
| `meta-metrics` | `collectStrategyMetrics` | no | — | `()` | `src/trigger/meta-metrics.ts` | `pure-function` | S |
| `process-handoff` | `processHandoff` | no | — | `(contactEmail, fromRole, toRole, reason, context?)` | `src/pipelines/account-strategy.ts` (dynamic import), `src/pipelines/analyze-reply.ts` (dynamic import) | `pure-function` | S |
| `research-company` | `researchCompany`, `researchHotAccounts` | no | — | `(domain: string, companyName: string)` / `(hotAccounts: HotAccount[])` | `src/trigger/signal-detection.ts`, `src/trigger/personize-webhook.ts` (dynamic import) | `pure-function` | S |
| `source-contacts` | `sourceContactsForAccount`, `sourceContactsForHotAccounts` | no | — | `(account: HotAccount)` | `src/trigger/signal-detection.ts` | `pure-function` | S |
| `sync-clay` | `transformClayRow`, `memorizeClayRecords`, `ingestClayWebhook`, `syncClay` | no | — | `(payload: Record<string,any>)` / `()` | `src/trigger/clay-webhook.ts`, `src/trigger/crm-sync.ts` (dynamic import) | `pure-function` | S |
| `sync-csv` | `syncCSV` | no | — | `()` | `src/scripts/run-csv-sync.ts`, `src/trigger/csv-sync.ts`, `src/trigger/crm-sync.ts` (dynamic import) | `pure-function` | S |
| `sync-ecommerce` | `syncEcommerce` | no | — | `()` | `src/mcp-server.ts` (dynamic import) | `pure-function` | S |
| `sync-hubspot` | `syncHubSpot` | no | — | `()` | `src/trigger/crm-sync.ts` (dynamic import) | `pure-function` | S |
| `sync-salesforce` | `syncSalesforce` | no | — | `()` | `src/trigger/crm-sync.ts` (dynamic import) | `pure-function` | S |
| `weekly-report` | `generateWeeklyReport` | no | — | `()` | `src/trigger/weekly-report.ts` | `pure-function` | S |

---

## Orphan candidates

| Pipeline | Reason |
|---|---|
| `ingest-signals` | `ingestSignal` is not imported by any trigger file or external caller. `ingestSignalBatch` only calls `ingestSignal` internally. Signal ingestion may happen inline in the webhook layer or was superseded by `detect-signals`. Candidate for deletion after confirming no webhook path calls it. |
| `sync-ecommerce` | Only caller is `src/mcp-server.ts` — not wired to any scheduled trigger or CRM sync. Could be surfaced via CLI or promoted to a proper scheduled task; no imminent deletion risk but worth reviewing. |
| `sync-hubspot` / `sync-salesforce` | Called only via dynamic import in `crm-sync.ts` — no direct import path. They are functionally reachable but architecturally invisible to static analysis. Not true orphans; confirmed active. |

---

## Refactor order

All 30 pipelines are already pure functions (zero Trigger.dev imports). The refactor effort for every pipeline is **S** (just wrap in `src/pipelines/<name>.cli.ts`). The ordering below prioritizes pipelines by standalone utility and likelihood of agent/CLI invocation.

### Group 1 — S effort, standalone (highest CLI value, no domain-object inputs)

These accept simple scalar inputs and are immediately testable via CLI without constructing complex objects:

1. `research-company` — ✅ **template (Task 2.2)**
2. `detect-signals` — zero inputs, pure trigger
3. `enrich-apollo` — zero inputs, pure trigger
4. `enrich-companies-apollo` — zero inputs, pure trigger
5. `weekly-report` — zero inputs, pure trigger
6. `meta-metrics` — zero inputs, pure trigger
7. `sync-csv` — zero inputs
8. `sync-ecommerce` — zero inputs
9. `sync-hubspot` — zero inputs
10. `sync-salesforce` — zero inputs
11. `assign-role` — email + optional status
12. `account-strategy` — domain string
13. `infer-preferences` — email string
14. `generate-outreach` — email + flags

### Group 2 — S effort, typed inputs (require a domain object from another pipeline or webhook)

These are pure functions but accept typed structs (`HotAccount`, `WorkspaceTask`, `CallResult`, etc.) that callers normally construct from webhook payloads. CLI wrappers need JSON-flag input or a `--json` stdin pattern:

15. `account-preflight`
16. `source-contacts`
17. `discover-contacts-apollo`
18. `generate-call-script`
19. `generate-linkedin-message`
20. `generate-interview-guide`
21. `conduct-interview`
22. `execute-task`
23. `analyze-reply`
24. `analyze-call`
25. `analyze-interview`
26. `analyze-linkedin-event`
27. `process-handoff`
28. `ingest-enrichment`
29. `sync-clay`
30. `ingest-signals` _(orphan — review before wrapping)_

### Group 3 — L effort (none)

No pipelines require significant rewrite. The Trigger.dev decoupling is already complete at the pipeline layer.

---

## Key observations for Task 2.3+

- **All trigger coupling lives in `src/trigger/`**, not `src/pipelines/`. The pipeline layer is already clean. Task 2.3 should focus on auditing `src/trigger/` files (25 files) and adding CLI entry points for the high-value pipelines in Group 1.
- **Dynamic imports** are used in 5 trigger files (`crm-sync.ts`, `personize-webhook.ts`, `task-executor.ts`, etc.) to avoid env-var crashes. These do not affect pipeline purity but mean static-analysis tooling will undercount callers.
- **`ingest-signals` is the only true orphan** — worth confirming deletion before Task 2.3.
- **`generate-outreach` is the busiest pipeline** (3 trigger callers + MCP server). It should get a CLI wrapper early for agent-direct invocation.
