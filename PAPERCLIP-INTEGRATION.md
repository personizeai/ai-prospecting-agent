# Revenue OS + Paperclip — Running an AI Sales Team

This guide shows how to use [Paperclip](https://github.com/paperclipai/paperclip) as the management layer on top of Revenue OS. Paperclip gives you a dashboard to hire, manage, and monitor a team of AI SDRs — each specialized on a different market, list, or campaign. You approve decisions, assign new tasks, and track costs from one UI (including mobile).

**Revenue OS** = the execution layer (find contacts, generate emails, send, handle replies, learn)
**Paperclip** = the management layer (org chart, task delegation, approvals, budgets, dashboards)

Neither repo needs code changes. They connect through MCP tools.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PAPERCLIP UI                          │
│                                                          │
│  You see: agents, tasks, approvals, budgets, org chart  │
│  You do:  approve, reject, assign, hire/fire, set goals │
└───────────────┬──────────────────────────────────────────┘
                │ heartbeats (scheduled wakeups)
                ▼
┌─────────────────────────────────────────────────────────┐
│              PAPERCLIP AGENTS (Claude Code)              │
│                                                          │
│  SDR "Fintech"   SDR "Healthcare"   SDR "Events"        │
│  SDR "EMEA"      Strategy Analyst   List Builder         │
│                                                          │
│  Each agent:                                             │
│    - Wakes on heartbeat schedule                         │
│    - Checks Paperclip for assigned tasks                 │
│    - Uses Revenue OS MCP tools to do the work            │
│    - Reports back, creates tickets for approvals         │
│    - Exits until next heartbeat                          │
└───────────────┬──────────────────────────────────────────┘
                │ MCP tool calls
                ▼
┌─────────────────────────────────────────────────────────┐
│              REVENUE OS (MCP Server + Pipelines)         │
│                                                          │
│  19 MCP tools: apollo_search, campaign_create,           │
│  discover_and_memorize, research_company, ...            │
│                                                          │
│  + Trigger.dev scheduled tasks: outreach engine,         │
│    reply monitor, daily digest, learning loop            │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **Revenue OS** installed, schemas created, `.env` configured (see [SETUP-GUIDE.md](SETUP-GUIDE.md))
2. **Paperclip** installed: `npx paperclipai onboard --yes` (see [Paperclip docs](https://github.com/paperclipai/paperclip))
3. Revenue OS MCP server working (test with `npm run ros -- status`)

---

## Step 1: Create the Company in Paperclip

Open the Paperclip UI (`http://localhost:3100`) and create a company:

- **Name:** Your company name
- **Mission:** e.g., "Book 50 qualified meetings per month through multi-channel outbound"
- **Goal:** e.g., "Build pipeline of $500K in Q2 by targeting fintech CTOs and healthcare CIOs"

---

## Step 2: Hire Your AI SDR Team

Each SDR is a Paperclip agent running Claude Code with Revenue OS MCP tools. Create agents in the Paperclip UI:

### SDR Agent: "Fintech Hunter"

| Field | Value |
|---|---|
| **Name** | Fintech Hunter |
| **Role** | SDR |
| **Reports to** | (you, or a Strategy Analyst agent) |
| **Adapter** | `claude_local` |
| **Model** | `claude-sonnet-4-6` (fast + cheap for routine work) |
| **Budget** | $50/month |
| **Heartbeat** | Every 4 hours, Mon-Fri |

**Agent configuration:**
```json
{
  "cwd": "/path/to/revenue-os",
  "model": "claude-sonnet-4-6",
  "maxTurnsPerRun": 30,
  "timeoutSec": 300,
  "env": {
    "PERSONIZE_SECRET_KEY": "your_key",
    "APOLLO_API_KEY": "your_key",
    "TAVILY_API_KEY": "your_key"
  }
}
```

**Job description** (set as agent instructions in Paperclip):

```markdown
You are the Fintech SDR for [Company Name]. Your job is to build and work 
the "fintech-ctos-q2" campaign.

## Your Campaign
- Campaign ID: fintech-ctos-q2
- Target: CTOs and VP Engineering at US fintech companies, 50-500 employees
- Cadence: standard (3 emails, 3-5 day gaps)
- Sender: sp_alice

## Your Tools
You have Revenue OS MCP tools available. Key ones:
- `discover_and_memorize_contacts` — find leads at target companies
- `campaign_stats` — check your campaign performance
- `campaign_enroll` — add qualified contacts to your campaign
- `research_company` — research companies before outreach
- `search_contacts` — find contacts by status in your campaign
- `daily_brief` — get today's system status

## Each Heartbeat, Do This
1. Check `campaign_stats` for your campaign
2. Check `search_contacts` for new replies (sequence_status: "Replied")
3. If positive replies → create a Paperclip ticket for human follow-up
4. If campaign needs more contacts → use `discover_and_memorize_contacts`
5. Report a summary comment on your current task

## When to Ask for Approval
- Before enrolling more than 20 contacts at once
- When a reply mentions pricing or legal questions  
- When you want to change the campaign cadence or governance
- When sender health drops below 50

## When to Act Autonomously
- Enrolling 1-10 contacts that match ICP
- Researching companies
- Checking stats and reporting
- Flagging issues (bounces, low reply rate)
```

### SDR Agent: "Healthcare Specialist"

Same structure, different scope:

| Field | Value |
|---|---|
| **Name** | Healthcare Specialist |
| **Campaign** | `healthcare-cios` |
| **Target** | CIOs at US healthcare companies |
| **Sender** | sp_bob |
| **Cadence** | enterprise |
| **Heartbeat** | Every 6 hours (enterprise = slower pace) |

### Strategy Analyst Agent

| Field | Value |
|---|---|
| **Name** | Revenue Analyst |
| **Role** | Analyst |
| **Reports to** | You |
| **Heartbeat** | Daily at 9am |
| **Model** | `claude-opus-4-6` (deeper analysis) |

**Job description:**

```markdown
You are the Revenue Analyst. You review all campaign performance, 
compare SDRs, and recommend strategic changes.

## Each Heartbeat
1. Call `daily_status` for the full system overview
2. Call `campaign_list` to see all campaigns
3. For each active campaign, call `campaign_stats`
4. Compare: which campaigns are winning? Which are underperforming?
5. Check `sender_list` for sender health issues
6. Call `daily_brief` for the latest Slack digest

## Create Tickets For
- Campaigns that should be paused (reply rate < 1% after 50+ reached)
- Campaigns that should be scaled (reply rate > 10%)
- Sender profiles that need attention (health < 50)
- Governance changes based on angle performance
- New campaign ideas based on patterns

## Report Format
Post a daily summary as a comment on your standing "Weekly Review" task:
- Pipeline: total contacts, reached, replies, positive, meetings across all campaigns
- Per-campaign: 1-line status with reply rate and trend
- Recommendations: what to change, with evidence
```

### Ecommerce Win-Back Agent (Optional — for D2C/ecommerce modes)

| Field | Value |
|---|---|
| **Name** | Win-Back Specialist |
| **Role** | SDR (ecommerce) |
| **Campaign** | `winback-q2` |
| **Heartbeat** | Daily at 10am |
| **Model** | `claude-sonnet-4-6` |

**Job description:**

```markdown
You are the Win-Back Specialist for [Company]. You re-engage lapsed customers
using personalized outreach based on their purchase history and preferences.

## Your Tools
- `ecommerce_sync` — import latest products + purchases (run weekly)
- `ecommerce_infer_preferences` — analyze customer purchase patterns
- `ecommerce_generate_variables` — create personalized email variables
- `search_contacts` — find customers by segment (At-Risk, Lapsed, Win-Back)
- `campaign_stats` — check win-back campaign performance

## Each Heartbeat
1. `search_contacts` with customer_segment "Lapsed" or "At-Risk"
2. For new lapsed customers → `ecommerce_infer_preferences` to refresh profiles
3. For campaign contacts → `ecommerce_generate_variables` to prepare variables
4. Report: "X customers at risk, Y variables generated, Z win-back emails queued"

## When to Ask for Approval
- Before adding > 50 customers to win-back campaign
- When recommending discount offers (governance check)
- When a VIP customer becomes At-Risk
```

---

### List Builder Agent (Optional)

| Field | Value |
|---|---|
| **Name** | List Builder |
| **Role** | Research |
| **Heartbeat** | Every 8 hours |

**Job description:**

```markdown
You find new target accounts and contacts for SDR campaigns.

## Each Heartbeat
1. Check if any campaign has fewer than 50 un-contacted contacts
2. For low-inventory campaigns, research new companies:
   - Call `research_company` for companies in the target market
   - Call `discover_and_memorize_contacts` with the campaign's ICP criteria
3. Create a Paperclip ticket if you found a promising new market segment
4. Report: "Added X contacts to Campaign Y. Z new companies researched."

## Budget
You use Apollo search (FREE) and Tavily research (~$0.01/search).
Stay under 50 research queries per heartbeat.
```

---

## Step 3: Create the Org Chart

In Paperclip UI, set up the reporting structure:

```
You (CEO / Founder)
├── Revenue Analyst
│   ├── SDR "Fintech Hunter"
│   ├── SDR "Healthcare Specialist"
│   └── SDR "Event Follow-up"
└── List Builder
```

The Analyst reviews all SDR performance. SDRs report to the Analyst. The Analyst escalates to you. You make strategic decisions (new campaigns, budget changes, hire/fire agents).

---

## Step 4: Create Standing Tasks

Give each agent a standing task in Paperclip:

| Agent | Task | Type |
|---|---|---|
| Fintech Hunter | "Work the Fintech CTOs Q2 campaign" | Ongoing |
| Healthcare Specialist | "Work the Healthcare CIOs campaign" | Ongoing |
| Revenue Analyst | "Weekly performance review" | Recurring (weekly) |
| List Builder | "Keep campaign inventories above 50 un-contacted contacts" | Ongoing |

---

## Step 5: Set Budgets

In Paperclip UI, set monthly token budgets per agent:

| Agent | Budget | Rationale |
|---|---|---|
| Fintech Hunter | $30/mo | 4 heartbeats/day × 20 days × ~$0.04/heartbeat |
| Healthcare Specialist | $20/mo | 3 heartbeats/day × 20 days × ~$0.04/heartbeat |
| Revenue Analyst | $15/mo | 1 heartbeat/day × 20 days × ~$0.03/heartbeat |
| List Builder | $10/mo | 2 heartbeats/day × 20 days × ~$0.02/heartbeat |
| **Total** | **~$75/mo** | For a full AI sales team |

Plus Revenue OS API costs: ~$50-200/mo (Personize + Apollo + email delivery).

---

## How It Looks Day-to-Day

### Morning (9am — Analyst heartbeat)

```
Paperclip UI → Revenue Analyst's task:

  💬 Revenue Analyst commented:
  
  Daily Report — April 4, 2026
  
  Pipeline: 312 contacts active, 189 reached, 18 replies (9.5%), 7 positive
  
  Campaigns:
  • 🟢 Fintech CTOs Q2: 47 reached, 6 replies (13%), 3 positive — outperforming
  • 🟡 Healthcare CIOs: 31 reached, 2 replies (6%) — below benchmark
  • 🟢 SaaStr Follow-up: 14 reached, 3 replies (21%) — strong early signal
  
  Recommendations:
  1. Scale Fintech: increase daily cap from 20 to 40
  2. Healthcare: hiring-signal angle underperforming — switch to compliance angle
  3. Alice (sp_alice) health at 91, Bob (sp_bob) at 78 — monitor Bob
  
  ⏳ Waiting for approval on recommendations 1-2.
```

You see this in Paperclip. Approve or reject each recommendation.

### Every 4 Hours (Fintech SDR heartbeat)

```
Paperclip UI → Fintech Hunter's task:

  💬 Fintech Hunter commented:
  
  Heartbeat — 2pm check-in
  
  Campaign stats: 47/89 contacted, 6 replies (13%)
  New since last check: 1 reply from Mike Ross (positive — wants to chat)
  
  Created ticket: "Mike Ross replied interested — schedule call?"
  
  Found 3 new contacts at TechFin Corp via Apollo (free search).
  Enrolled 2 (CTO + VP Eng), skipped 1 (ICP score 32).
  
  ✅ 12 emails sent today (cap: 20, remaining: 8)
```

### You Assign a New Task

```
You create a ticket in Paperclip:

  📋 New Task → assigned to Fintech Hunter
  
  "Research these 5 companies a VC friend recommended and add 
  qualified contacts to the fintech campaign: 
  dataflow.com, cloudpay.io, fintechx.com, paystack.com, neobank.co"
  
  Priority: High
```

Next heartbeat, Fintech Hunter picks this up, researches all 5, discovers contacts, enrolls qualified ones, and reports back on the ticket.

### You Hire a New SDR

```
You in Paperclip UI → Agents → Create Agent

  Name: EMEA SaaS SDR
  Adapter: claude_local
  Model: claude-sonnet-4-6
  Heartbeat: every 4 hours, Mon-Fri
  Budget: $30/mo
  Reports to: Revenue Analyst
  
  Instructions: "You work the EMEA SaaS campaign targeting 
  mid-market SaaS companies in Europe..."

Then in Revenue OS:
  npm run ros -- campaign:create --name "EMEA SaaS Q2" --market "EMEA Mid-Market SaaS" --cadence enterprise --daily-cap 15 --sender sp_charlie
```

The new SDR starts working on its next heartbeat.

---

## Revenue OS Stays Autonomous

Paperclip agents don't replace Revenue OS automation. They layer on top:

| Function | Who Does It |
|---|---|
| **Outreach generation + sending** | Revenue OS (Trigger.dev cron, 10am + 2pm) |
| **Reply monitoring** | Revenue OS (IMAP monitor, every 15 min) |
| **Health checks** | Revenue OS (every 15 min) |
| **Daily Slack digest** | Revenue OS (daily at 9am) |
| **Campaign auto-pause** | Revenue OS (daily digest checks) |
| **Weekly learning loop** | Revenue OS (Monday 9am) |
| **Monitoring + strategy** | Paperclip agents (on heartbeat schedule) |
| **New contact discovery** | Paperclip agents (List Builder, on heartbeat) |
| **Approval requests** | Paperclip agents → you approve in UI |
| **New campaign setup** | You + Paperclip agents |
| **Budget enforcement** | Paperclip (token budgets per agent) |
| **Audit trail** | Paperclip (every agent action is a ticket comment) |

Revenue OS does the heavy lifting (outreach engine, reply handling, email delivery). Paperclip agents are the supervisors that monitor, decide, discover, and escalate.

---

## MCP Configuration for Paperclip Agents

Each Paperclip agent needs both MCP servers. Set in the agent's env:

```json
{
  "env": {
    "PERSONIZE_SECRET_KEY": "sk_live_...",
    "APOLLO_API_KEY": "...",
    "TAVILY_API_KEY": "..."
  }
}
```

The agent's `cwd` should point to the revenue-os directory. The `.mcp.json` in the repo root auto-configures the Revenue OS MCP server. Agents also get the Paperclip skill auto-injected for coordination (checking tasks, posting comments, creating tickets).

---

## Template: Agent Instruction Skeleton

Use this for any new SDR agent:

```markdown
You are [AGENT NAME], an AI SDR for [COMPANY]. 

## Your Campaign
- Campaign ID: [CAMPAIGN_ID]
- Target: [ICP DESCRIPTION]
- Cadence: [aggressive/standard/enterprise]
- Sender: [SENDER_PROFILE_ID]

## Revenue OS MCP Tools Available (19 total)
- `campaign_stats` — check your campaign
- `search_contacts` — find contacts by status
- `discover_and_memorize_contacts` — find new leads
- `campaign_enroll` — add contacts to your campaign
- `campaign_create` / `campaign_activate` / `campaign_pause` — manage campaigns
- `research_company` — research a company
- `daily_brief` / `daily_status` — get system status
- `sender_list` — check sender health
- `apollo_search_contacts` — raw Apollo search (FREE)
- `apollo_enrich_contact` — enrich a specific person (1 credit)
- `apollo_enrich_company` — enrich a company (1 credit)
- `ecommerce_sync` — import products + purchases from CSV
- `ecommerce_infer_preferences` — analyze purchase patterns per customer
- `ecommerce_generate_variables` — personalized email variables for ESP templates

## Heartbeat Routine
1. `campaign_stats` — how's my campaign?
2. `search_contacts` with sequence_status "Replied" — new replies?
3. Handle replies (create Paperclip ticket if needs human)
4. If inventory low → find new contacts
5. Post summary on your Paperclip task

## Ask Approval For
- Enrolling > 20 contacts at once
- Pricing/legal reply handling
- Cadence or governance changes
- Sender health below 50

## Act Autonomously On
- Enrolling 1-10 ICP-matching contacts
- Researching companies
- Reporting stats
- Flagging issues
```

---

## Cost Summary

| Component | Monthly Cost | Notes |
|---|---|---|
| **Paperclip** | Free (self-hosted) | Node.js + embedded Postgres |
| **Paperclip agents (Claude tokens)** | $50-100 | 4 agents, ~$15-30 each |
| **Revenue OS (Personize)** | $50-200 | Memory + AI generation |
| **Apollo** | $0-50 | Search is free, enrichment 1 credit each |
| **Tavily** | $5-20 | Web research |
| **Email delivery** | $0-50 | Gmail free, SendGrid/Smartlead $20-50 |
| **Trigger.dev** | $0-30 | Free tier covers most setups |
| **Total** | **$100-450/mo** | For a full AI sales team |

Compare to: hiring 1 human SDR ($4,000-6,000/mo) or using a SaaS AI SDR tool ($2,000-5,000/mo).
