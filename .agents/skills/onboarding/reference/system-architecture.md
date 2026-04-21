# System Architecture Reference

This reference maps every configuration setting to its runtime effect, so the onboarding skill knows exactly what each change does.

---

## File Map

### Configuration Files (what this skill modifies)

| File | Purpose | Runtime Effect |
|---|---|---|
| `src/setup/create-governance.ts` | 6 governance variables pushed to Personize | Controls ALL AI-generated content — every email, every reply analysis, every signal interpretation |
| `src/config/prospecting.config.ts` | All tunable settings | Controls targeting, cadence timing, discovery filters, API limits, enrichment rules |
| `src/setup/create-schemas.ts` | 6 collection schemas (Contacts, Companies, Outreach Log, Web Research, Campaigns, Products) | Controls what data fields are stored per entity. Campaigns stores campaign config + stats. Products stores ecommerce catalog. Contacts include ecommerce properties (total_orders, style_preferences, customer_segment). |
| `.env` | API keys, feature flags | Controls which integrations are active (Personize + Trigger.dev required, everything else optional) |

### Campaign & MCP Infrastructure (new)

| Component | What It Does | Storage |
|---|---|---|
| `src/mcp-server.ts` | MCP server with 16 tools for AI assistants (Claude, Cowork, OpenClaw) | Wraps Revenue OS functions as MCP tools |
| `src/lib/campaign.ts` | Campaign enrollment, stats, ICP matching, capacity checking | Campaigns collection in Personize |
| `src/scripts/ros.ts` | CLI for campaign management | Calls campaign.ts + sender-profiles.ts |
| `src/trigger/learning-loop.ts` | Weekly angle-to-outcome analysis with governance suggestions | Personize memory (system-logs) |
| `.mcp.json` | MCP server configuration for AI assistants | Repo root |
| `src/pipelines/sync-ecommerce.ts` | Import products + purchases from CSV to Personize | Products + Contacts collections |
| `src/pipelines/infer-preferences.ts` | AI inference of style, price tier, segment from purchase history | Contact ecommerce properties |

### Email Infrastructure (managed via dashboard, not .env)

| Component | What It Does | Storage |
|---|---|---|
| IMAP Accounts | Connect Gmail, Outlook, ZapMail, or any IMAP/SMTP email account | Personize guideline: `imap-accounts-config` |
| Sender Profiles | Stable sender identities with warmup, health monitoring, lead assignment | Personize guideline: `sender-profiles-config` |
| `assigned_sender` | Contact property linking each lead to a sender profile (stable across email rotation) | Personize Contact schema |

The account strategizer sees sender profiles and assigns leads based on capacity, persona match, account consistency, and health.

### Pipeline Files (what this skill does NOT modify)

These files read from governance + config at runtime. They don't need changes:

| File | What It Does | Reads From |
|---|---|---|
| `src/pipelines/generate-outreach.ts` | AI email generation | `smartGuidelines()` → governance, `smartDigest()` → contact memory, `prospecting.config.ts` → cadence |
| `src/pipelines/detect-signals.ts` | ICP scoring + buying signals | `smartGuidelines()` → ICP definition + signal definitions |
| `src/pipelines/analyze-reply.ts` | Reply sentiment classification | `smartGuidelines()` → playbook rules |
| `src/pipelines/research-company.ts` | Tavily web research | `TAVILY_CONFIG` → search settings |
| `src/pipelines/discover-contacts-apollo.ts` | Find contacts at accounts | `DISCOVERY_CONFIG` → titles, seniorities, departments |
| `src/pipelines/enrich-apollo.ts` | Contact enrichment | `APOLLO_CONFIG` → rate limits, budgets |
| `src/pipelines/sync-hubspot.ts` | HubSpot CRM sync | `HUBSPOT_CONFIG` → properties, engagement types |
| `src/pipelines/account-strategy.ts` | AI account strategizer — evaluates all contacts, assigns senders, produces coordinated strategy | `ACCOUNT_STRATEGY_CONFIG` → thresholds, `smartGuidelines()` → governance, `sender-profiles` → sender capacity/health |
| `src/pipelines/account-preflight.ts` | Pre-outreach gate — checks account strategy, returns proceed/modify/delay/block | `ACCOUNT_STRATEGY_CONFIG` → carpet bomb, event pause settings |
| `src/pipelines/execute-task.ts` | Task routing + execution | `TASK_EXECUTOR_CONFIG` → owners, limits |
| `src/lib/imap-service.ts` | IMAP connect, poll, fetch, conversation history, credential encryption | IMAP account configs from Personize |
| `src/lib/sender-profiles.ts` | Sender profile CRUD, assignment, health tracking, warmup ramp | Sender profiles from Personize |
| `src/delivery/smtp.ts` | SMTP send + thread reply via nodemailer | IMAP account SMTP config |
| `src/trigger/imap-reply-monitor.ts` | Polls IMAP inboxes every 3 min, matches replies to contacts | IMAP accounts from Personize |
| `src/trigger/personize-webhook.ts` | Receives Personize memorize webhooks, matches to campaigns, auto-enrolls, routes to pipelines | Webhook payload + pipeline config + campaign ICP criteria |
| `src/trigger/learning-loop.ts` | Weekly: queries outreach-log, analyzes angle performance, suggests governance updates | Outreach-log memories + Slack + Personize memory |
| `src/trigger/daily-digest.ts` | Daily Slack report with campaign health, auto-pause for underperformers, time-series snapshots, daily brief memorized for Claude | Metrics + campaigns + Slack + Personize memory |

---

## Governance Variable → Runtime Behavior Map

### ICP Definition (`icp-definition`)

| Section | Used By | How |
|---|---|---|
| Company Criteria | `detect-signals.ts` | AI scores companies against these criteria (0-100) |
| Contact Criteria | `discover-contacts-apollo.ts` | Filters Apollo search to these titles/seniorities |
| Disqualification Criteria | `detect-signals.ts` | Companies matching these get score 0 and are skipped |
| Scoring Weights | `detect-signals.ts` | Weights applied to composite score calculation |

### Brand Voice (`brand-voice`)

| Section | Used By | How |
|---|---|---|
| Tone | `generate-outreach.ts` | AI matches this tone in every generated email |
| Rules (NEVER list) | `generate-outreach.ts` | AI explicitly avoids these phrases/patterns |
| Personalization Rules | `generate-outreach.ts` | AI follows these when referencing contact/company facts |

### Outreach Playbook (`outreach-playbook`)

| Section | Used By | How |
|---|---|---|
| Sequence Structure | `generate-outreach.ts`, `outreach-sequence.ts` | Controls number of emails and CTA escalation |
| Timing | `outreach-sequence.ts` | Wait durations between emails (combined with cadence config) |
| Channel Rules | `outreach-engine.ts` | Which channels to use at which step |
| Opt-Out | `reply-handler.ts`, `analyze-reply.ts` | Stop sequences on opt-out keywords |
| Escalation | `reply-handler.ts` | When to notify human reps |

### Signal Definitions (`signal-definitions`)

| Section | Used By | How |
|---|---|---|
| Strong Signals (+30) | `detect-signals.ts` | High-value events that spike ICP score |
| Moderate Signals (+15) | `detect-signals.ts` | Growth indicators that moderately increase score |
| Weak Signals (+5) | `detect-signals.ts` | Minor positive indicators |
| Negative Signals (-20) | `detect-signals.ts` | Events that reduce score or trigger disqualification |

### Competitor Policy (`competitor-policy`)

| Section | Used By | How |
|---|---|---|
| Known Competitors | `generate-outreach.ts`, `analyze-reply.ts` | AI knows competitor names and positioning |
| Rules | `generate-outreach.ts` | AI never badmouths, positions on own strengths |

### Email Format & Examples (`email-format-examples`)

| Section | Used By | How |
|---|---|---|
| Required HTML Structure | `generate-outreach.ts` | AI follows these formatting rules |
| Email 1/2/3 Examples | `generate-outreach.ts` | AI uses these as structural templates (not copied verbatim) |
| Anti-Patterns | `generate-outreach.ts` | AI avoids all listed patterns |

---

## Config Setting → Runtime Behavior Map

### DISCOVERY_CONFIG

| Setting | Default | Effect |
|---|---|---|
| `contactsPerAccount` | 5 | How many contacts Apollo finds per hot account |
| `targetTitles` | VP Sales, VP Marketing, etc. | Apollo People Search title filter |
| `targetSeniorities` | vp, director, c_suite, manager | Apollo seniority filter |
| `targetDepartments` | sales, marketing, business_development, c_suite | Apollo department filter |
| `minEmployees` | 0 | Skip companies smaller than this |
| `maxEmployees` | 0 (no max) | Skip companies larger than this |
| `requireVerifiedEmail` | true | Only return contacts with verified emails |

### CADENCES

| Cadence | Default Timing | When Used |
|---|---|---|
| `aggressive` | 3 emails, wait [2, 3] days | ICP score 80+ |
| `standard` | 3 emails, wait [3, 5] days | ICP score 50-79 |
| `enterprise` | 4 emails, wait [5, 7, 10] days | ICP score 0-49 |

### SIGNAL_CONFIG

| Setting | Default | Effect |
|---|---|---|
| `hotAccountThreshold` | 70 | Minimum ICP score to trigger auto-research and auto-discovery |
| `companiesPerScan` | 200 | Max companies evaluated per signal detection run |
| `autoResearchHotAccounts` | true | Automatically research hot accounts via Tavily |
| `autoDiscoverContacts` | true | Automatically find contacts at hot accounts via Apollo |
| `autoEnrichAfterSync` | true | Automatically enrich new contacts after CRM sync |

### ACCOUNT_STRATEGY_CONFIG

| Setting | Default | Effect |
|---|---|---|
| `enableAccountStrategy` | `true` | Master toggle — when false, no account-level coordination |
| `maxAccountsPerRun` | `20` | Max accounts evaluated per strategy run |
| `maxContactsPerWeek` | `2` | Max contacts emailed per account per week (carpet bomb prevention) |
| `carpetBombWindowDays` | `7` | Time window for carpet bomb detection |
| `smallCompanyThreshold` | `100` | Companies below this headcount get carpet bomb protection |
| `negativeEventPauseDays` | `21` | Days to pause outreach after negative company event (layoffs, crisis) |
| `strategyStalenessDays` | `7` | Re-evaluate account strategy after this many days |
| `warmIntroStages` | `['engaged', 'opportunity', 'multi_threaded']` | Account stages where new contacts get warm intros instead of cold outreach |

### CRM_SOURCE_CONFIG

| Value | Behavior |
|---|---|
| `'hubspot'` | Only sync from HubSpot API |
| `'csv'` | Only sync from CSV files in `data/` directory |
| `'both'` | Sync from both sources |

---

## Collection Schemas

### Contacts (slug: `contacts`)
- **Primary key:** `email`
- **24 properties** + 6 workspace properties
- Stores: name, title, company, seniority, department, ICP match, lead score, outreach stage, sentiment, pain points, interests, communication style, competitors mentioned, messages sent, tasks, notes, issues, updates, context

### Companies (slug: `companies`)
- **Primary key:** `website`
- **20 properties**
- Stores: name, domain, industry, headcount, revenue, headquarters, funding, tech stack, business model, ICP score, buying signals, signal strength, decision makers, competitors, summary, account status, hiring velocity

### Outreach Log (slug: `outreach-log`)
- **Primary key:** `contact_email`
- **13 properties**
- Stores: recipient, company, sequence step, channel, subject, content summary, angle, timestamps, engagement (opened/clicked/replied), reply sentiment, outcome

### Web Research (slug: `web-research`)
- **Primary key:** `domain`
- **14 properties**
- Stores: company, search queries, results, AI summary, research date, source, signals found, personalization angles, competitors mentioned, key people, news headlines, technology references

### Account Workspace (via `account-workspace.ts`)
- **Primary key:** `website_url` (company domain)
- **Not a collection** — uses Personize memory with structured tags
- Stores: account strategy (stage, health, coordination flags, contact rollup, recommended actions), account updates timeline, account tasks, notes, issues
- Tags: `workspace:account-strategy`, `workspace:account-updates`, `workspace:account-tasks`, `workspace:account-notes`, `workspace:account-issues`

### Contact-to-Company Linking
- Contacts are linked to companies via `website_url` passed during memorization
- Sources: HubSpot `website` property → fallback to email domain extraction → CSV `company_website` column
- Enables `search({ websiteUrl, type: 'Contact' })` to find all contacts at a company
- The account strategizer uses this to build a complete contact rollup per account

---

## Environment Variables

### Required for the agent to run

| Variable | Where to Get It |
|---|---|
| `PERSONIZE_SECRET_KEY` | personize.ai → Dashboard → Settings → API Keys |
| `TRIGGER_PROJECT_ID` | trigger.dev → Project → Settings |
| `TRIGGER_SECRET_KEY` | trigger.dev → Project → API Keys |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot → Settings → Integrations → Private Apps |
| `GMAIL_CLIENT_ID` | Google Cloud Console → Credentials → OAuth2 |
| `GMAIL_CLIENT_SECRET` | Google Cloud Console → Credentials → OAuth2 |
| `GMAIL_REFRESH_TOKEN` | Run `npm run gmail:auth` after setting Client ID/Secret |
| `SENDER_EMAIL` | The email address emails come from |
| `SENDER_NAME` | The name that appears in the "From" field |
| `SLACK_WEBHOOK_URL` | Slack → Apps → Incoming Webhooks |

### Optional but recommended

| Variable | What It Enables |
|---|---|
| `APOLLO_API_KEY` | Contact enrichment + discovery (free tier: 10K/month) |
| `TAVILY_API_KEY` | Web research for company intelligence (~$8/month) |

### Safety

| Variable | Default | What It Does |
|---|---|---|
| `DRY_RUN` | `true` | When true, emails are logged but never sent |
