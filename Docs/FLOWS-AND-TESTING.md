# Flows & Testing Reference

All supported pipeline flows, trigger schedules, and test coverage.

---

## System Overview

```
HubSpot CRM ──→ CRM Sync ──→ Personize Memory ──→ Signal Detection ──→ Hot Accounts
                    │                                      │
                    ▼                                      ▼
              Enrichment                          Contact Discovery
              (Apollo)                          (Apollo Search + Enrich)
                    │                                      │
                    ▼                                      ▼
              Personize Memory ◄──────────────────── Personize Memory
                    │
                    ▼
            Outreach Generation ──→ Gmail API / HubSpot ──→ Recipient
                    │
                    ▼
              Engagement Webhook ──→ Reply Handler ──→ CRM Tasks / Slack
```

---

## Flow 1: CRM Sync + Engagement History + Auto-Enrich

**Schedule:** Every hour, Mon–Fri (`0 * * * 1-5`)

```
crm-sync (cron)
  │
  ├─ syncHubSpot()
  │   ├─ STEP 1: Fetch HubSpot contacts (filtered by Personize Lead property)
  │   │   └─ Properties: firstname, lastname, email, jobtitle, phone,
  │   │                  company, hs_lead_status, lifecyclestage
  │   │
  │   ├─ STEP 2: Fetch HubSpot companies
  │   │   └─ Properties: name, domain, industry, numberofemployees,
  │   │                  annualrevenue, city, state, country
  │   │
  │   ├─ STEP 3: Memorize contacts + companies → Personize memory
  │   │
  │   └─ STEP 4: Sync engagement history (IF HUBSPOT_CONFIG.syncEngagements = true)
  │       └─ syncEngagementHistory()
  │           ├─ Fetch all synced contacts with CRM IDs from Personize
  │           └─ For each contact:
  │               ├─ syncContactEngagements(crmId, email)
  │               │   ├─ For each engagement type (notes, emails, meetings, calls, tasks):
  │               │   │   ├─ HubSpot associationsApi.getAll(contactId, type)
  │               │   │   ├─ Batch read engagement details (up to 10 per type)
  │               │   │   ├─ Filter by recency window (default: 90 days)
  │               │   │   ├─ Format into tagged text (HTML stripped, plain text only):
  │               │   │   │   ├─ [CRM NOTE — date] body (≤2000, HTML stripped)
  │               │   │   │   ├─ [CRM EMAIL SENT/RECEIVED — date] from + subject + body (≤2000, text preferred, HTML fallback)
  │               │   │   │   ├─ [CRM MEETING — date] title + outcome + location + internal notes (≤2000) + body (≤1500)
  │               │   │   │   ├─ [CRM CALL (Inbound/Outbound) — date] title + duration + status + disposition + body (≤2000)
  │               │   │   │   └─ [CRM TASK (EMAIL/CALL/TODO) — date] subject + status + priority + body (≤1000)
  │               │   │   └─ memorizeBatch() → contacts collection
  │               │   │       └─ Tags: crm, hubspot, engagement:{type}
  │               │   │
  │               │   └─ IF HUBSPOT_CONFIG.syncDeals = true:
  │               │       ├─ Fetch associated deals (up to 10)
  │               │       ├─ Batch read deal details (name, amount, stage, pipeline, closedate, currency, won/lost reason)
  │               │       └─ memorizeBatch() → contacts collection
  │               │           └─ Tags: crm, hubspot, deal
  │               │
  │               └─ Rate limit pause between contacts
  │
  └─ IF SIGNAL_CONFIG.autoEnrichAfterSync = true
      └─ enrich-contacts task triggered
          ├─ enrichContacts()  →  Apollo People Enrichment (1 credit/person)
          └─ IF autoEnrichCompaniesAfterSync = true
              └─ enrichCompanies()  →  Apollo Org Enrichment (1 credit/company)
```

**Why engagement history matters:**
- Without it, the AI only knows a contact's name and title — not their past conversations, concerns, or deal context
- With it, outreach emails can reference "the demo we ran last month" or "your open deal at contract stage"
- `smartDigest()` with `token_budget` compiles all memories into a bounded summary, so even contacts with 50+ engagements produce manageable context

**Data size controls:**
- `engagementRecencyDays: 90` — only sync last 90 days (configurable, 0 = all time)
- `maxEngagementsPerType: 10` — cap per type per contact
- Content truncation: meeting notes 2000 + body 1500 chars, emails/notes 2000, tasks 1000
- HTML stripping: note bodies and email HTML fallback are stripped to plain text
- `smartDigest()` compiles everything into a bounded token window (e.g., 2000 tokens)

**Files:**
- Trigger: `src/trigger/crm-sync.ts`
- Pipeline: `src/pipelines/sync-hubspot.ts`
- Enrichment: `src/pipelines/enrich-apollo.ts`, `src/pipelines/enrich-companies-apollo.ts`
- Ingestion: `src/pipelines/ingest-enrichment.ts`

**Stop conditions:** None — runs on schedule regardless.

---

## Flow 2: Signal Detection + Web Research + Contact Discovery

**Schedule:** Daily 8am UTC, Mon–Fri (`0 8 * * 1-5`)

This is the main intelligence pipeline. It runs three steps in order:
1. **Score** all companies → identify hot accounts
2. **Research** hot accounts via Tavily → find news, funding, hiring signals
3. **Discover** contacts at hot accounts via Apollo → enrich and ingest

```
signal-detection (cron — 8am UTC Mon-Fri)
  │
  ├─ STEP 1: Score accounts
  │   └─ detectAndScoreSignals()
  │       ├─ Fetch up to 200 companies from Personize memory
  │       ├─ For each company:
  │       │   ├─ Get ICP guidelines (smartGuidelines)
  │       │   ├─ Get company digest (smartDigest)
  │       │   ├─ AI scores: ICP_FIT_SCORE, SIGNAL_STRENGTH, BUYING_WINDOW
  │       │   └─ Memorize assessment back to company
  │       └─ Filter: score >= 70 OR buying_window = "Yes" → hot accounts
  │
  ├─ STEP 2: Research hot accounts (Tavily)
  │   └─ IF SIGNAL_CONFIG.autoResearchHotAccounts = true
  │       └─ researchHotAccounts(hotAccounts)
  │           ├─ For each hot account (up to maxResearchPerRun=20):
  │           │   ├─ Skip if researched within last 7 days (configurable)
  │           │   ├─ Tavily Search 1: "{name} {domain} news funding hiring"
  │           │   ├─ Tavily Search 2: "{name} product launch partnership expansion"
  │           │   ├─ Deduplicate results by URL
  │           │   ├─ Memorize raw results → web-research collection
  │           │   ├─ AI analysis → extract signals, news, angles
  │           │   └─ Memorize analysis → companies collection
  │           │       └─ Updates: company_summary, buying_signals properties
  │           └─ Return: companiesResearched, totalSignals
  │
  ├─ STEP 3: Discover contacts (Apollo)
  │   └─ IF SIGNAL_CONFIG.autoDiscoverContacts = true
  │       └─ discover-contacts task triggered
  │           └─ discoverContactsForHotAccounts(hotAccounts)
  │               ├─ For each hot account:
  │               │   ├─ Check existing contacts in memory (dedup)
  │               │   ├─ Apollo People Search (FREE — 0 credits)
  │               │   │   └─ Filters: targetTitles, targetSeniorities, targetDepartments
  │               │   ├─ For each new contact (up to contactsPerAccount=5):
  │               │   │   ├─ Apollo People Enrichment (1 credit)
  │               │   │   └─ ingestEnrichment() → Personize memory
  │               │   └─ Memorize discovery activity at company
  │               └─ Return: accountsProcessed, contactsDiscovered
  │
  └─ STEP 4: AI sourcing plan
      └─ sourceContactsForHotAccounts(hotAccounts)
          └─ IF Apollo configured → uses real discovery (step 3 above)
          └─ IF Apollo NOT configured → AI generates sourcing plan (no real contacts)
```

**Why this order matters:**
- Research runs BEFORE contact discovery so that by the time outreach emails are generated, the company's recent news, funding rounds, and product launches are already in memory — giving the AI better personalization angles.

**Files:**
- Triggers: `src/trigger/signal-detection.ts`, `src/trigger/discover-contacts.ts`
- Pipelines: `src/pipelines/detect-signals.ts`, `src/pipelines/research-company.ts`, `src/pipelines/discover-contacts-apollo.ts`, `src/pipelines/source-contacts.ts`
- Libraries: `src/lib/apollo.ts`, `src/lib/tavily.ts`

---

## Flow 3: Web Research Detail (Tavily)

This is the detail of Step 2 above. It can also be called **manually** for any company outside the signal detection schedule (e.g., before a specific outreach, or to refresh stale research).

**Trigger:** Automatically by signal detection (Step 2), or manually via `researchCompany(domain, name)`.

```
researchCompany(domain, companyName)
  │
  ├─ Dedup: check if researched within skipIfResearchedWithinDays (default 7)
  │   └─ Recall memory for [WEB RESEARCH] tag at this domain
  │   └─ IF recent research exists → skip, return null
  │
  ├─ Tavily Search 1: "{company_name} {domain} news funding hiring"
  │   └─ Returns: title, url, content snippet, score, published_date
  │
  ├─ Tavily Search 2: "{company_name} product launch partnership expansion"
  │   └─ Returns: additional web results
  │
  ├─ Deduplicate results by URL across both searches
  │
  ├─ Memorize raw results → web-research collection
  │   └─ Tags: web-research, tavily, {domain}
  │   └─ Content: full result list with titles, URLs, snippets
  │
  ├─ AI analysis (Personize prompt):
  │   ├─ COMPANY_SUMMARY — what they do, recent activity, market position
  │   ├─ KEY_NEWS — top 3 recent items with dates
  │   ├─ BUYING_SIGNALS — funding, hiring, expansion, leadership change
  │   ├─ COMPETITIVE_LANDSCAPE — competitors and tools mentioned
  │   └─ PERSONALIZATION_ANGLES — 3 specific hooks for outreach emails
  │
  └─ Memorize analysis → companies collection
      └─ Updates: company_summary, buying_signals properties
      └─ Tags: web-research, analysis, tavily
```

**Where research data is consumed downstream:**

| Consumer | How It Uses Research |
|----------|---------------------|
| `generate-outreach.ts` | `assembleContext()` pulls company digest — includes research summary, news, and angles for email personalization |
| `detect-signals.ts` | Next signal detection run sees enriched company context (buying signals, competitive info) for better ICP scoring |
| `weekly-report.ts` | Hot prospects section references recent company activity |
| Sales reps | Company workspace shows research findings via `smartDigest()` |

**Files:**
- Library: `src/lib/tavily.ts`
- Pipeline: `src/pipelines/research-company.ts`
- Config: `TAVILY_CONFIG` in `src/config/prospecting.config.ts`

---

## Flow 4: Outreach Scheduler (Batch)

**Schedule:** 10am and 2pm UTC, Mon–Fri (`0 10,14 * * 1-5`)

```
outreach-scheduler (cron)
  │
  ├─ Query Personize for qualified contacts ready for outreach (limit 50)
  │
  └─ For each contact (concurrency: 5):
      └─ process-contact-outreach task
          ├─ generateOutreachForContact(email)
          │   ├─ assembleContext(email)
          │   │   ├─ smartGuidelines() — brand voice, ICP, playbook
          │   │   ├─ smartDigest(email) — contact context
          │   │   ├─ recall(company) — company context
          │   │   └─ recall(previous outreach) — dedup angles
          │   ├─ Determine step (1, 2, or 3) from outreach history
          │   ├─ Check timing gap (3 days for step 2, 5 days for step 3)
          │   ├─ AI generates email with 2-step prompt:
          │   │   1. Analyze contact + identify personalization angle
          │   │   2. Generate email N/3 with word limits and CTA
          │   └─ AI self-evaluates against criteria
          │
          ├─ IF DRY_RUN = false:
          │   └─ sendAndLog()
          │       ├─ selectSender() — round-robin across Gmail accounts (respects daily limits)
          │       ├─ sendViaGmail() — deliver from selected sender's mailbox
          │       ├─ createHubSpotEmail() — log in CRM
          │       └─ memorize() — record in Personize (with sender, Gmail message/thread IDs)
          │
          └─ Return: email, step, subject, status
```

**Files:**
- Trigger: `src/trigger/outreach-engine.ts`
- Pipeline: `src/pipelines/generate-outreach.ts`
- Delivery: `src/delivery/hubspot-deliver.ts`, `src/delivery/gmail.ts`

---

## Flow 5: Full Durable Sequence (3 Emails, 8 Days)

**Trigger:** Manual — per contact.

```
full-outreach-sequence (manual trigger)
  │
  ├─ shouldStopSequence(email)  ← workspace.getSequenceState()
  │   └─ Stops if: opted out | replied | bounced | critical issue
  │
  ├─ Email 1:
  │   ├─ generateOutreachForContact(email)
  │   ├─ sendAndLog() → HubSpot + Personize
  │   ├─ recordEmailSent() → workspace (message + update + context)
  │   └─ await wait.for({ days: 3 })  ← Trigger.dev durable wait
  │
  ├─ shouldStopSequence(email)  ← re-check after 3 days
  │
  ├─ Email 2:
  │   ├─ generateOutreachForContact(email)
  │   ├─ sendAndLog()
  │   ├─ recordEmailSent()
  │   └─ await wait.for({ days: 5 })  ← durable wait
  │
  ├─ shouldStopSequence(email)  ← re-check after 5 days
  │
  ├─ Email 3:
  │   ├─ generateOutreachForContact(email)
  │   ├─ sendAndLog()
  │   └─ recordEmailSent()
  │
  └─ Sequence complete:
      ├─ workspace.addTask() — "Evaluate for next steps" (medium priority)
      └─ workspace.rewriteContext() — "COMPLETE (3/3 sent, no reply)"
```

**Files:**
- Trigger: `src/trigger/outreach-sequence.ts`
- Pipeline: `src/pipelines/generate-outreach.ts`
- Library: `src/lib/workspace.ts`

**Stop signals checked at each step:**
- `hasOptedOut` — contact flagged via workspace issue
- `hasReplied` — reply detected from engagement webhook
- `lastEngagement === 'bounced'` — email bounced
- Critical open issue in workspace

---

## Flow 6: Engagement Webhook → Reply Handler

**Trigger:** External webhook (Gmail or custom).

```
engagement-webhook (webhook trigger)
  │
  ├─ Event: REPLY (with body)
  │   ├─ workspace.addNote() — raw reply preview
  │   ├─ workspace.addUpdate() — "Reply received"
  │   └─ reply-handler task triggered
  │       ├─ analyzeReply(email, replyBody, replySubject)
  │       │   ├─ workspace.getDigest() — full lead context
  │       │   ├─ smartGuidelines() — reply handling rules
  │       │   └─ AI classifies → SENTIMENT, SUMMARY, KEY_POINTS, URGENCY,
  │       │                       NEXT_ACTION, SUGGESTED_RESPONSE,
  │       │                       RETURN_DATE, REFERRED_CONTACT
  │       │
  │       └─ handleAnalyzedReply() — action per sentiment:
  │
  │           ├─ POSITIVE:
  │           │   ├─ workspace.addTask() — "Schedule call" (urgent, 1h SLA)
  │           │   ├─ createHubSpotFollowUpTask() — CALL task
  │           │   ├─ workspace.rewriteContext() — "POSITIVE REPLY"
  │           │   ├─ notifySlack() — green alert
  │           │   └─ memorize: lead_status → Engaged, outreach_stage → Replied
  │           │
  │           ├─ QUESTION:
  │           │   ├─ workspace.addTask() — "Answer question" (high, 4h SLA)
  │           │   ├─ createHubSpotFollowUpTask() — EMAIL task
  │           │   ├─ workspace.rewriteContext() — "QUESTION — needs info"
  │           │   ├─ notifySlack() — yellow alert
  │           │   └─ memorize: lead_status → Contacted, outreach_stage → Replied
  │           │
  │           ├─ NEGATIVE:
  │           │   ├─ workspace.raiseIssue() — critical issue
  │           │   ├─ workspace.addUpdate() — "Opted out"
  │           │   ├─ workspace.rewriteContext() — "OPTED OUT"
  │           │   ├─ memorize: lead_status → Disqualified, outreach_stage → Opted Out
  │           │   ├─ notifySlack() — red alert
  │           │   └─ NO HubSpot task created
  │           │
  │           ├─ OOO:
  │           │   ├─ workspace.addTask() — "Reschedule" (low, outreach-agent)
  │           │   └─ workspace.rewriteContext() — "OOO until {date}"
  │           │
  │           ├─ REFERRAL:
  │           │   ├─ workspace.addTask() — "Follow up with referral" (high, 24h)
  │           │   ├─ createHubSpotFollowUpTask() — EMAIL task
  │           │   ├─ workspace.rewriteContext() — "REFERRAL"
  │           │   └─ notifySlack() — blue alert
  │           │
  │           └─ NEUTRAL:
  │               ├─ workspace.addTask() — "Review reply" (medium)
  │               └─ workspace.rewriteContext() — "REPLIED (neutral)"
  │
  ├─ Event: REPLY (no body)
  │   └─ workspace.addTask() — "Reply received, review manually" (urgent)
  │
  ├─ Event: BOUNCE
  │   ├─ workspace.raiseIssue() — high severity
  │   └─ workspace.addUpdate() — "Email bounced"
  │
  ├─ Event: UNSUBSCRIBE / SPAM
  │   ├─ workspace.raiseIssue() — critical severity
  │   ├─ workspace.addUpdate() — "Unsubscribed / spam complaint"
  │   └─ notifySlack() — red alert
  │
  └─ Event: OPEN / CLICK
      └─ IF not already replied/opted out:
          ├─ workspace.addUpdate() — engagement signal
          └─ workspace.rewriteContext() — "Engaged (opened/clicked)"
```

**Files:**
- Triggers: `src/trigger/webhooks.ts`, `src/trigger/reply-handler.ts`
- Pipeline: `src/pipelines/analyze-reply.ts`
- Delivery: `src/delivery/hubspot-deliver.ts`, `src/delivery/slack-notify.ts`

---

## Flow 7: Weekly Performance Report

**Schedule:** Fridays 4pm UTC (`0 16 * * 5`)

```
weekly-report (cron)
  │
  ├─ generateWeeklyReport()
  │   ├─ Recall last 7 days outreach activity (max 100)
  │   ├─ Recall last 7 days engagement events (max 100)
  │   ├─ Truncate context to 30,000 chars
  │   └─ AI generates report:
  │       ├─ SUMMARY (top-level performance)
  │       ├─ EMAILS_SENT (count)
  │       ├─ OPEN_RATE (percentage)
  │       ├─ REPLY_RATE (percentage)
  │       ├─ TOP_PERFORMING_ANGLES (what worked)
  │       ├─ HOT_PROSPECTS (who to focus on)
  │       └─ RECOMMENDATIONS (next week actions)
  │
  └─ notifySlack(report) → Slack channel
```

**Files:**
- Trigger: `src/trigger/weekly-report.ts`
- Pipeline: `src/pipelines/weekly-report.ts`
- Delivery: `src/delivery/slack-notify.ts`

---

## Flow 8: Error Handling (Global)

**Trigger:** All task `onFailure` handlers.

```
Any task failure
  │
  └─ reportFailure(taskId, runId, error)
      └─ error-alert task triggered
          └─ notifySlack() — formatted error with task ID and run link
```

**Files:**
- Trigger: `src/trigger/error-handler.ts`
- Delivery: `src/delivery/slack-notify.ts`

---

## Trigger Schedule Summary

| Task | Schedule | Cron | Description |
|------|----------|------|-------------|
| `crm-sync` | Hourly, Mon–Fri | `0 * * * 1-5` | Sync HubSpot → Personize |
| `signal-detection` | Daily 8am, Mon–Fri | `0 8 * * 1-5` | Score companies → Tavily research → discover contacts |
| `outreach-scheduler` | 10am & 2pm, Mon–Fri | `0 10,14 * * 1-5` | Generate and send outreach |
| `weekly-report` | Fridays 4pm | `0 16 * * 5` | Performance summary → Slack |

| Task | Trigger | Description |
|------|---------|-------------|
| `enrich-contacts` | Chained from crm-sync | Apollo enrichment |
| `discover-contacts` | Chained from signal-detection | Apollo discovery at hot accounts |
| `process-contact-outreach` | Chained from outreach-scheduler | Per-contact email generation |
| `full-outreach-sequence` | Manual | 3-email durable sequence |
| `reply-handler` | Chained from engagement-webhook | AI reply classification |
| `engagement-webhook` | External webhook | Gmail/HubSpot events |
| `hubspot-webhook` | External webhook | HubSpot deal events |
| `error-alert` | All task failures | Slack error notification |

---

## Test Coverage

**195 tests across 54 suites.** Run with: `npm test`

### Test File: `env-validation.test.ts` (26 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Environment Variable Validation | 4 | DRY_RUN defaults, RATE_LIMIT_PAUSE_MS parsing |
| Input Sanitization | 4 | Email filtering, domain validation, null array handling |
| Signal Ingestion Validation | 3 | Required fields (domain, signal_type), valid signal format |
| Context Truncation | 1 | MAX_CONTEXT_CHARS limit (30,000) |
| Funding Display | 2 | Number formatting, N/A for zero/undefined |
| Outreach State Parsing | 5 | Em-dash/en-dash variants, step extraction, zero history |
| LLM Output Parsing | 4 | SUBJECT/BODY_HTML extraction, malformed output, multi-line body |
| Signal Detection Parsing | 2 | SIGNAL_STRENGTH regex, missing field graceful handling |
| Date Comparison | 3 | Date objects vs strings, invalid date detection, days-since |
| Opt-Out Detection | 3 | Keyword matching, reply detection, false positive prevention |

### Test File: `prospecting-config.test.ts` (18 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Prospecting Config | 4 | HubSpot config fields, Apollo defaults, discovery titles, signal threshold |
| Apollo API Helpers | 4 | Search param building, optional param handling, phone extraction |
| HubSpot Filter Builder | 2 | Filter group creation, empty property fallback |
| Enrichment Dedup Logic | 2 | Skip already-enriched, pass un-enriched |
| Discovery Dedup Logic | 2 | Skip existing contacts, respect per-account limit |
| Company Enrichment Formatting | 4 | Funding display, location from parts, missing parts, all-empty |

### Test File: `reply-analysis.test.ts` (24 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Reply Sentiment Classification | 6 | Parse positive, negative, OOO, referral, question, unparseable |
| Reply Action Routing | 5 | Positive → urgent/1h, question → 4h, negative → opt out, OOO → reschedule, referral → 24h |
| Lead Status Updates by Sentiment | 5 | Positive → Engaged, negative → Disqualified, question → Contacted, Replied stage, Opted Out stage |
| HubSpot Task Creation | 5 | Positive → CALL, question → EMAIL, referral → EMAIL, negative → no task, body truncation |
| Slack Notification Routing | 3 | Color coding (green/red), OOO/neutral → no notification |

### Test File: `workspace.test.ts` (23 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Workspace Entry Formatting | 4 | Update, task, issue, message JSON structure |
| Workspace Tagging Conventions | 4 | Tag format for updates, tasks (priority), issues (severity), messages (channel/step) |
| Sequence State Parsing | 5 | JSON message entries, legacy `[OUTREACH SENT]` format, reply detection, opt-out detection, bounce detection |
| Sequence Stop Logic | 5 | Stop on reply, opt-out, bounce, continue on open, stop on critical issue |
| Context Rewrite Formatting | 3 | Active sequence context, stopped context, complete context |
| Message Body Preview Truncation | 2 | 200-char truncation, short body passthrough |

### Test File: `hubspot-engagement.test.ts` (45 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| HTML Stripping | 5 | Tag removal, `<br>` to newline, entity decoding, `&nbsp;`, newline collapsing |
| Email Body Fallback | 3 | Prefer plain text, fall back to stripped HTML, empty when both null |
| Engagement Formatting | 12 | Notes with HTML stripping, emails with from address and HTML fallback, meetings with internal notes and location, calls with direction/status, tasks with type, missing timestamps, unknown types |
| Engagement Content Truncation | 3 | Notes 2000 chars, meeting body 1500 chars (notes get 2000), tasks 1000 chars |
| Engagement Recency Window | 6 | Within/outside 90-day window, recencyDays=0 (all time), null timestamp, invalid timestamp, meeting start time fallback |
| Engagement Properties Config | 7 | All 5 types, timestamps, email text+html fallback, from/to fields, meeting internal notes, call direction, task type |
| HUBSPOT_CONFIG Engagement Settings | 4 | Config types, valid engagement types, reasonable max/recency values |
| Deal Formatting | 3 | Won deal with currency/reason, lost deal, missing properties |
| Engagement Batch Records | 2 | One record per engagement for memorizeBatch, one per deal |

### Test File: `gmail-sender.test.ts` (37 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| MIME Message Building | 10 | From/To/Subject headers, MIME version, multipart/alternative, plain text + HTML parts, boundary markers, special characters, empty body |
| Base64 URL-Safe Encoding | 4 | No +, /, or = characters, round-trip decode, unicode content, empty input |
| Gmail Reply Threading | 2 | Re: prefix addition, no double-prefix |
| Multi-Sender Config Loading | 6 | JSON array parsing, defaults, single-sender fallback, empty config, invalid JSON, multi-domain |
| Sender Selection — Round Robin | 4 | Cycling order, skip exhausted senders, all exhausted returns null, empty list |
| Daily Limit Tracking | 3 | Zero start, increment counting, per-sender independence |
| Remaining Capacity | 4 | Full capacity, decreases on send, zero when exhausted, no negative |
| sendAndLog memorize tags | 2 | Sender email tag, sender info in memorized content |
| Reply sender matching | 2 | Find sender by email, null for unknown |

### Test File: `outreach-parsing.test.ts` (5 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Outreach State Parsing | 5 | Dash variants in `[OUTREACH SENT — Email N]`, step extraction |

### Test File: `types.test.ts` (4 tests)

| Suite | Tests | What It Covers |
|-------|-------|----------------|
| Types | 4 | GeneratedEmail fields, HotAccount fields, Signal union types, EnrichmentData defaults |

---

## File Reference

### Entry Points (src/trigger/)
| File | Task ID | Type |
|------|---------|------|
| `crm-sync.ts` | `crm-sync` | Scheduled (cron) |
| `signal-detection.ts` | `signal-detection` | Scheduled (cron) |
| `outreach-engine.ts` | `outreach-scheduler`, `process-contact-outreach` | Scheduled + chained |
| `outreach-sequence.ts` | `full-outreach-sequence` | Manual |
| `reply-handler.ts` | `reply-handler` | Chained |
| `webhooks.ts` | `hubspot-webhook`, `engagement-webhook` | External webhook |
| `weekly-report.ts` | `weekly-report` | Scheduled (cron) |
| `enrich-contacts.ts` | `enrich-contacts` | Chained |
| `discover-contacts.ts` | `discover-contacts` | Chained |
| `error-handler.ts` | `error-alert` | Chained (global) |

### Pipeline Logic (src/pipelines/)
| File | Function | Used By |
|------|----------|---------|
| `sync-hubspot.ts` | `syncHubSpot()` | crm-sync |
| `detect-signals.ts` | `detectAndScoreSignals()` | signal-detection |
| `discover-contacts-apollo.ts` | `discoverContactsForAccount/HotAccounts()` | discover-contacts |
| `enrich-apollo.ts` | `enrichContacts()` | enrich-contacts |
| `enrich-companies-apollo.ts` | `enrichCompanies()` | enrich-contacts |
| `ingest-enrichment.ts` | `ingestEnrichment()` | enrich + discover pipelines |
| `ingest-signals.ts` | `ingestSignal/Batch()` | signal ingestion (framework) |
| `generate-outreach.ts` | `generateOutreachForContact()` | outreach-engine, outreach-sequence |
| `source-contacts.ts` | `sourceContactsForAccount()` | signal-detection (fallback) |
| `analyze-reply.ts` | `analyzeReply()`, `handleAnalyzedReply()` | reply-handler |
| `research-company.ts` | `researchCompany()`, `researchHotAccounts()` | signal-detection, manual |
| `weekly-report.ts` | `generateWeeklyReport()` | weekly-report |

### Delivery (src/delivery/)
| File | Function | Channel |
|------|----------|---------|
| `hubspot-deliver.ts` | `sendAndLog()`, `createHubSpotFollowUpTask()` | HubSpot CRM |
| `slack-notify.ts` | `notifySlack()`, `notifyRepOnSlack()` | Slack |
| `gmail.ts` | `sendViaGmail()`, `sendGmailReply()` | Email (Gmail API / Google Workspace) |

### Libraries (src/lib/)
| File | Purpose |
|------|---------|
| `workspace.ts` | Lead workspace read/write helpers |
| `apollo.ts` | Apollo.io API client |
| `tavily.ts` | Tavily web search API client |

### Config (src/config/)
| File | Purpose |
|------|---------|
| `config.ts` | Personize client, rate limits |
| `prospecting.config.ts` | All tunable settings |

### Setup (src/setup/)
| File | npm script |
|------|------------|
| `create-schemas.ts` | `npm run setup:schemas` |
| `create-governance.ts` | `npm run setup:governance` |
| `gmail-auth.ts` | `npm run gmail:auth` |

---

## NPM Scripts

```bash
npm run setup           # Run all setup scripts (schemas + governance)
npm run setup:schemas   # Create Personize collections (includes workspace properties)
npm run setup:governance # Create governance variables
npm run gmail:auth      # Gmail OAuth2 setup (run per sender)
npm run test            # Run all 280 tests
npm run typecheck       # TypeScript type checking
npm run dev             # Start Trigger.dev local dev
npm run deploy          # Deploy to Trigger.dev production
```
