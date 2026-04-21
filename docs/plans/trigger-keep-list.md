# Trigger.dev Keep List — Phase 6

Date: 2026-04-21

## Summary
- Files in `src/trigger/`: 25
- Classified KEEP: 22
- Classified MOVE: 3
- UNCLEAR: 0

## KEEP (guaranteed execution required)

| File | Why | Schedule or Trigger |
|---|---|---|
| call-webhooks.ts | Three inbound webhook receivers (Bland.ai, Vapi, ElevenLabs) for post-call transcription — external providers POST here; cannot be agent-invoked | webhook |
| clay-webhook.ts | Inbound webhook from Clay.com — external POST from Clay tables, must listen continuously | webhook |
| crm-sync.ts | Hourly cron keeps HubSpot/Salesforce/Clay/CSV data fresh; also chains enrichContactsTask | cron `0 * * * 1-5` |
| daily-digest.ts | 9am weekday digest: collects metrics, runs health check, posts Slack summary, auto-pauses bad campaigns, memorizes brief for Claude | cron `0 9 * * 1-5` |
| error-handler.ts | Global `reportFailure` helper + `error-alert` task wired into every other task's `onFailure`. Trigger.dev infrastructure — not a pipeline wrapper | triggered by onFailure |
| health-check.ts | 15-min health monitor; alerts Slack when any integration goes unhealthy — must run continuously regardless of agent activity | cron `*/15 * * * *` |
| heyreach-webhook.ts | Inbound LinkedIn event webhook from HeyReach — receives CONNECTION_REQUEST_ACCEPTED, MESSAGE_REPLY_RECEIVED, etc. | webhook |
| imap-reply-monitor.ts | 3-min cron polls all enabled IMAP accounts for new inbound emails; matches to contacts; chains replyHandlerTask | cron `*/3 * * * *` |
| interview-scheduler.ts | Mixed: `interviewHealthCheckScheduler` is a Wednesday cron for customer health check calls. `interviewTriggerTask` and `interviewFromCallTask` are on-demand tasks called by pipelines (analyze-call) — keeping all three because the scheduler cron anchors the file | cron `0 15 * * 3` + on-demand |
| interview-webhooks.ts | Three inbound webhook receivers (Bland.ai, Vapi, ElevenLabs) for post-interview transcription | webhook |
| learning-loop.ts | Monday 9am cron: analyzes 14-day outreach outcomes, surfaces playbook suggestions to Slack | cron `0 9 * * 1` |
| meta-metrics.ts | 6am weekday cron: collects structured strategy metrics from Revenue OS + Content OS for the meta-agent strategy review | cron `0 6 * * 1-5` |
| multichannel-engine.ts | Two cron schedulers (LinkedIn 11am, Call 1pm) + internal queue tasks with `concurrencyLimit` | cron `0 11 * * 1-5` + `0 13 * * 1-5` |
| outreach-engine.ts | Twice-daily cron queues per-contact outreach; `processContactTask` uses `queue: { concurrencyLimit: 5 }` for safe parallel sends | cron `0 10,14 * * 1-5` |
| outreach-sequence.ts | Uses `wait.for({ days: N })` — Trigger.dev durable checkpoint between sequence steps. Cannot be replaced by a direct function call without losing durable waits across days | durable wait |
| personize-webhook.ts | Inbound webhook from Personize (new contact/company memorized) — entry point for no-CRM-sync flow; routes to enrich/strategy/sequence pipelines | webhook |
| reply-handler.ts | Triggered by KEEP files: `imap-reply-monitor.ts` and `webhooks.ts` (engagement webhook). Provides retries + queue semantics for reply analysis | triggered by KEEP |
| role-schedulers.ts | Three cron schedulers (one per sales role: SDR, AE, CSM) with queue concurrency — replaces outreach-scheduler when Sales Org is enabled | cron (per-role schedule) |
| signal-detection.ts | 8am weekday cron: scores accounts via Tavily signals, researches hot accounts, chains discoverContacts and account strategy | cron `0 8 * * 1-5` |
| task-executor.ts | 30-min cron polls pending workspace tasks; `executeWorkspaceTask` child has `concurrencyLimit` and durable retry on failure | cron `*/30 * * * *` |
| webhooks.ts | HubSpot CRM webhook + SendGrid engagement webhook (reply/bounce/unsubscribe/open/click). Both are inbound HTTP handlers | webhook |
| weekly-report.ts | Friday 4pm cron: generates weekly report via pipeline and posts to Slack | cron `0 16 * * 5` |

## MOVE (agent-invokable via MCP run_pipeline / CLI dispatcher)

| File | Underlying pipeline | Notes |
|---|---|---|
| csv-sync.ts | `src/pipelines/sync-csv.ts` → `syncCSV()` | Thin wrapper: `task({ run: () => syncCSV() })`. On-demand, no cron. Agents can call `run_pipeline('sync-csv')` directly. Had an internal `enrichContactsTask.trigger()` call — rewritten to call pipeline functions directly (see Task B). |
| discover-contacts.ts | `src/pipelines/discover-contacts-apollo.ts` → `discoverContactsForHotAccounts()` | Thin wrapper: `task({ run: ({hotAccounts}) => discoverContactsForHotAccounts(hotAccounts) })`. No cron. Called by `signal-detection.ts` and `personize-webhook.ts` (both KEEP) — those callers rewritten to import the pipeline function directly (see Task B). |
| enrich-contacts.ts | `src/pipelines/enrich-apollo.ts` → `enrichContacts()` + `src/pipelines/enrich-companies-apollo.ts` → `enrichCompanies()` | Thin wrapper composing two enrichment pipelines. No cron. Called by `crm-sync.ts`, `csv-sync.ts` (being deleted), and `personize-webhook.ts` — callers in KEEP files rewritten to call pipeline functions directly (see Task B). |

## UNCLEAR (flagged for human review)

None.

## Callers

Files classified MOVE that are invoked by task ID from within `src/`:

### `enrich-contacts.ts` (task id: `enrich-contacts`) — `enrichContactsTask.trigger()`

| Caller file | Location | Action taken |
|---|---|---|
| `src/trigger/crm-sync.ts` | line 43 | Rewritten — calls `enrichContacts()` + `enrichCompanies()` directly |
| `src/trigger/csv-sync.ts` | line 21 | MOVE file — deleted; no action needed |
| `src/trigger/personize-webhook.ts` | line 149 | Rewritten — calls `enrichContacts()` + `enrichCompanies()` directly |

### `discover-contacts.ts` (task id: `discover-contacts`) — `discoverContactsTask.trigger()`

| Caller file | Location | Action taken |
|---|---|---|
| `src/trigger/signal-detection.ts` | line 33 | Rewritten — calls `discoverContactsForHotAccounts()` directly |
| `src/trigger/personize-webhook.ts` | line 247 | Rewritten — calls `discoverContactsForHotAccounts()` directly |

### `csv-sync.ts` (task id: `csv-sync`)

No callers invoke this by task ID from within `src/`. It is an externally-triggered on-demand task only.
