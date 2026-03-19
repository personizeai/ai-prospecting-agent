# AI Prospecting Agent — Setup Guide

Everything you need to do, in order, to go from zero to a running AI prospecting agent on autopilot.

---

## Phase 1: Get Your API Keys

You need 4 accounts. All have free tiers or trials.

### 1.1 — Personize (AI Memory + Generation Engine)

1. Go to [personize.ai](https://personize.ai) and create an account
2. Go to **Settings → API Keys**
3. Click **Create New Key**
4. Copy the key — it starts with `pz_sk_...`
5. Save it somewhere safe — you'll need it in Phase 3

> **What this does:** Stores everything the agent learns about contacts and companies, enforces your brand voice and ICP rules, and generates personalized emails.

### 1.2 — Trigger.dev (Autopilot Scheduler)

1. Go to [cloud.trigger.dev](https://cloud.trigger.dev) and create an account
2. Click **New Project** → name it `ai-prospecting-agent`
3. From your project dashboard, copy two things:
   - **Project ID** — looks like `proj_xxxxxxxxxxxx` (shown in project settings)
   - **Secret Key** — looks like `tr_dev_xxxxxxxxxxxx` (Settings → API Keys)
4. Save both

> **What this does:** Runs your pipelines on schedule (hourly CRM sync, daily signal detection, twice-daily outreach). No servers to manage — it handles retries, monitoring, and durable waits between sequence emails.

### 1.3 — HubSpot (CRM)

1. Log into [app.hubspot.com](https://app.hubspot.com)
2. Go to **Settings** (gear icon top-right)
3. Go to **Integrations → Private Apps**
4. Click **Create a private app**
5. Name it `AI Prospecting Agent`
6. Under **Scopes**, add:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
   - `crm.objects.deals.read`
   - `sales-email-read`
   - `crm.objects.owners.read`
7. Click **Create app** → **Continue creating**
8. Copy the **Access Token** — starts with `pat-...`

> **What this does:** Reads your contacts and companies into the agent's memory, and logs generated emails/tasks back to HubSpot.

### 1.4 — Email Delivery (Choose One)

The agent supports four delivery options. Pick one — you can switch later by changing `EMAIL_PROVIDER`.

#### Option A: Smartlead (Recommended for new setups)

Smartlead manages warmed mailboxes and deliverability for you. No mailbox warming required.

1. Go to [smartlead.ai](https://smartlead.ai) and create an account
2. Go to **Settings → API Keys** and create a key
3. Create one campaign (e.g. `AI Prospecting Agent`) — set it to **Active**
4. Add your email accounts to that campaign (Smartlead warms them for you)
5. Copy the campaign's numeric ID from the URL (e.g. `smartlead.ai/campaigns/12345` → `12345`)
6. Save your `SMARTLEAD_API_KEY` and `SMARTLEAD_CAMPAIGN_ID`

> **What this does:** Routes all outreach emails through Smartlead's warmed mailbox infrastructure. Smartlead handles sending windows and delivery tracking; the agent owns sequence timing and personalization.
>
> **Reply/bounce events:** In Smartlead dashboard → **Settings → Webhooks**, point the webhook to your Trigger.dev reply-handler URL (you'll get this URL after deploying in Phase 7).

#### Option B: SendGrid (If you already have it set up)

1. Go to [sendgrid.com](https://sendgrid.com) and create an account (free tier: 100 emails/day)
2. Go to **Settings → API Keys → Create API Key**
3. Give it **Full Access** (or at minimum: Mail Send)
4. Copy the key — starts with `SG.`
5. **Important:** Verify your sender identity:
   - Go to **Settings → Sender Authentication**
   - Authenticate your entire domain (recommended over single sender)
   - The email you verify is your `SENDER_EMAIL`

> **What this does:** Sends via your own SendGrid account and sender domain. You are responsible for domain warming and deliverability.

#### Option C: Gmail API (If you have Google Workspace)

1. Enable Gmail API in [Google Cloud Console](https://console.cloud.google.com)
2. Create OAuth2 credentials (Desktop app type)
3. Run `npm run gmail:auth` for each sender to generate refresh tokens
4. Configure `GMAIL_SENDERS` as a JSON array (see Phase 3.2)

> **What this does:** Sends directly from your Google Workspace mailboxes. Supports multiple senders with round-robin rotation. Note: daily send limits are tracked in-memory — avoid running multiple concurrent workers.

#### Option D: Manual — HubSpot Tasks

No email is sent automatically. Instead, the agent creates a HubSpot task for each generated email so a sales rep can review and send it manually.

1. Find your HubSpot owner ID: **Settings → Users & Teams** → click your user → copy the numeric ID from the URL
2. Save it as `HUBSPOT_OWNER_ID`
3. No other email service needed

> **What this does:** The agent drafts and queues emails in HubSpot. Your team reviews each one before anything goes out. The sequence pauses at each step until the human sends it and updates the record. Good for high-value enterprise accounts or teams that want full human review.

### 1.5 — Slack Webhook (Alerts & Reports)

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App → From scratch**
3. Name it `Prospecting Agent`, select your workspace
4. Go to **Incoming Webhooks** → toggle **ON**
5. Click **Add New Webhook to Workspace**
6. Select the channel where you want alerts (e.g., `#sales-alerts`)
7. Copy the webhook URL — starts with `https://hooks.slack.com/services/...`

> **What this does:** Sends you Slack alerts when a prospect replies, when a hot prospect is found, weekly performance reports, and error notifications.

---

## Phase 2: Install the Project (5 minutes)

### 2.1 — Prerequisites

Make sure you have **Node.js 18+** installed. Check with:

```bash
node --version
# Should show v18.x.x or higher
```

If not installed, download from [nodejs.org](https://nodejs.org) (use the LTS version).

### 2.2 — Install Dependencies

```bash
cd ai-prospecting-agent
npm install
```

> **Note:** If `@personize/sdk` fails to install, you may need to configure access. Check [personize.ai/docs](https://personize.ai) for SDK installation instructions.

### 2.3 — Verify TypeScript Compiles

```bash
npm run typecheck
```

This should complete with no errors. If you see errors, check that `npm install` completed successfully.

### 2.4 — Run Tests

```bash
npm test
```

All tests should pass. These validate the core parsing logic, input sanitization, and safety guards.

---

## Phase 3: Configure Environment Variables (10 minutes)

### 3.1 — Create Your .env File

```bash
cp .env.example .env
```

### 3.2 — Fill In Your Keys

Open `.env` and replace the placeholder values:

```env
# From Phase 1.1
PERSONIZE_SECRET_KEY=pz_sk_your_actual_key_here

# From Phase 1.2
TRIGGER_PROJECT_ID=proj_your_actual_id_here
TRIGGER_SECRET_KEY=tr_dev_your_actual_key_here

# From Phase 1.3
HUBSPOT_ACCESS_TOKEN=pat-your_actual_token_here

# From Phase 1.4 — Email Delivery
# Set to: smartlead | sendgrid | gmail | manual-hubspot
EMAIL_PROVIDER=smartlead

# Option A: Smartlead (if EMAIL_PROVIDER=smartlead)
SMARTLEAD_API_KEY=your_smartlead_api_key_here
SMARTLEAD_CAMPAIGN_ID=12345

# Option B: SendGrid (if EMAIL_PROVIDER=sendgrid)
# SENDGRID_API_KEY=SG.your_actual_key_here
# SENDER_EMAIL=outreach@yourcompany.com
# SENDER_NAME=Your Name

# Option C: Gmail (if EMAIL_PROVIDER=gmail)
# GMAIL_CLIENT_ID=your_client_id
# GMAIL_CLIENT_SECRET=your_client_secret
# GMAIL_SENDERS=[{"email":"you@yourcompany.com","name":"Your Name","refreshToken":"...","dailyLimit":100}]

# Option D: Manual HubSpot tasks (if EMAIL_PROVIDER=manual-hubspot)
# HUBSPOT_OWNER_ID=12345678

# From Phase 1.5
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/actual/webhook

# KEEP THIS AS true UNTIL YOU'RE READY TO SEND REAL EMAILS
DRY_RUN=true
```

### 3.3 — Update trigger.config.ts

Open `trigger.config.ts` and verify the project ID matches:

```typescript
project: process.env.TRIGGER_PROJECT_ID || "proj_your_project_id",
```

This reads from your `.env` file automatically.

---

## Phase 4: Set Up Personize (15 minutes)

### 4.1 — Run Setup (Collections + Governance)

One command creates everything: 4 collections (Contacts, Companies, Outreach Log, Web Research) with workspace properties, and 8 governance variables that control the agent's behavior.

```bash
npm run setup
```

**Expected output:**
```
Created Contacts collection (with workspace properties)
Created Companies collection (with account workspace properties)
Created Outreach Log collection
Created Web Research collection
Schema setup complete.
Created: ICP Definition
Created: Brand Voice
Created: Outreach Playbook
...
Governance setup complete.
```

If it says "already exists" — that's fine, it's idempotent.

### 4.2 — Customize Your Governance (IMPORTANT)

**Expected output:**
```
Created: ICP Definition
Created: Brand Voice
Created: Outreach Playbook
Created: Signal Definitions
Created: Competitor Policy
```

Go to [personize.ai](https://personize.ai) dashboard → **Governance** section.

Edit each variable with YOUR specific details:

| Variable | What to Customize |
|---|---|
| **ICP Definition** | Your actual target industries, company sizes, revenue ranges, titles, and disqualification criteria |
| **Brand Voice** | Your company's actual tone, forbidden phrases, and personalization rules |
| **Outreach Playbook** | Your preferred sequence structure, timing, and escalation rules |
| **Signal Definitions** | Which signals matter for YOUR product (adjust scores) |
| **Competitor Policy** | Replace `[Competitor A/B/C]` with your actual competitors and positioning |

> **This is the most important step.** The quality of your outreach depends entirely on how specific and accurate these governance variables are. Spend 30-60 minutes getting these right.

### 4.3 — Verify Setup

Go to the Personize dashboard and confirm:
- 4 collections visible (Contacts, Companies, Outreach Log, Web Research)
- 8 governance variables visible
- All governance variables have your real content (not the placeholder text)

> The agent also runs a health check every 15 minutes that validates governance is configured. If governance variables are empty, you'll see a "degraded" warning in Slack.

---

## Phase 5: Initial Data Sync (10 minutes)

### 5.1 — Run Your First CRM Sync

This pulls all contacts and companies from HubSpot into Personize memory.

```bash
npx tsx src/pipelines/sync-hubspot.ts
```

Or trigger it via the setup by running the Trigger.dev dev server (Phase 6) and manually triggering the `crm-sync` task.

**Watch for:**
- `Synced contacts: X total` — should match your HubSpot contact count
- `Synced companies: X total` — should match your HubSpot company count
- Any error messages about rate limits (if so, the configurable pause handles it)

### 5.2 — Verify Data in Personize

Go to Personize dashboard:
- Check the **Contacts** collection — should show your CRM contacts
- Check the **Companies** collection — should show your CRM companies
- Click into a few records to verify the data looks correct

---

## Phase 6: Test Locally with Trigger.dev (15 minutes)

### 6.1 — Start the Dev Server

```bash
npx trigger.dev@latest dev
```

This connects your local project to Trigger.dev's cloud. You should see:

```
✔ Connected to Trigger.dev
✔ Found 7 tasks
  - crm-sync
  - signal-detection
  - outreach-scheduler
  - process-contact-outreach
  - full-outreach-sequence
  - weekly-report
  - error-alert
  ...
```

### 6.2 — Test Each Pipeline (In Order)

Go to your **Trigger.dev dashboard** ([cloud.trigger.dev](https://cloud.trigger.dev)) and manually trigger each task:

#### Test 1: CRM Sync
- Click `crm-sync` → **Trigger test run**
- Wait for it to complete
- Check Personize dashboard — contacts and companies should appear

#### Test 2: Signal Detection
- Click `signal-detection` → **Trigger test run**
- This scores all your companies and finds hot accounts
- Check the logs — you should see ICP scores and recommended actions
- This takes longer (2-15 minutes depending on company count)

#### Test 3: Outreach Generation (DRY RUN)
- Make sure `DRY_RUN=true` in your `.env`
- Click `outreach-scheduler` → **Trigger test run**
- Check the logs — you should see generated emails printed to console
- **Review the output carefully:** Are the subjects compelling? Is the tone right? Are facts accurate?

#### Test 4: Weekly Report
- Click `weekly-report` → **Trigger test run**
- Check your Slack channel — you should receive a report

### 6.3 — Review and Tune

After test runs, review the generated content:

| What to Check | If It's Wrong | Fix |
|---|---|---|
| Emails sound too corporate | Update **Brand Voice** governance in Personize dashboard |
| Wrong companies being targeted | Update **ICP Definition** governance |
| Emails too long or too short | Update word limits in **Outreach Playbook** governance |
| Wrong angles being used | Update **Signal Definitions** scoring weights |
| Mentioning competitors incorrectly | Update **Competitor Policy** governance |

> **Iterate on governance variables until the dry-run output looks like something your best sales rep would send.** This is where you tune the agent's judgment — no code changes needed.

---

## Phase 7: Go Live (5 minutes)

### 7.1 — Deploy to Production

Once you're happy with the dry-run output:

```bash
npx trigger.dev@latest deploy
```

This deploys your tasks to Trigger.dev's cloud. They will run on the schedules defined in the code.

### 7.2 — Add Environment Variables to Trigger.dev

Go to **Trigger.dev Dashboard → Settings → Environment Variables** and add ALL of these:

| Variable | Value |
|---|---|
| `PERSONIZE_SECRET_KEY` | Your Personize key |
| `HUBSPOT_ACCESS_TOKEN` | Your HubSpot token |
| `SLACK_WEBHOOK_URL` | Your Slack webhook URL |
| `EMAIL_PROVIDER` | `smartlead`, `sendgrid`, `gmail`, or `manual-hubspot` |
| `SMARTLEAD_API_KEY` | Your Smartlead key (if `EMAIL_PROVIDER=smartlead`) |
| `SMARTLEAD_CAMPAIGN_ID` | Your Smartlead campaign ID (if `EMAIL_PROVIDER=smartlead`) |
| `SENDGRID_API_KEY` | Your SendGrid key (if `EMAIL_PROVIDER=sendgrid`) |
| `SENDER_EMAIL` | Your sender email (if `EMAIL_PROVIDER=sendgrid`) |
| `GMAIL_CLIENT_ID` | OAuth client ID (if `EMAIL_PROVIDER=gmail`) |
| `GMAIL_CLIENT_SECRET` | OAuth client secret (if `EMAIL_PROVIDER=gmail`) |
| `GMAIL_SENDERS` | JSON array of sender accounts (if `EMAIL_PROVIDER=gmail`) |
| `HUBSPOT_OWNER_ID` | HubSpot user ID for task assignment (if `EMAIL_PROVIDER=manual-hubspot`) |
| `DRY_RUN` | `true` (keep dry run for production initially!) |

### 7.3 — Verify Production Schedules

In the Trigger.dev dashboard, you should see these scheduled tasks:

| Task | Schedule | What It Does |
|---|---|---|
| `crm-sync` | Every hour, Mon-Fri | Keeps CRM data fresh |
| `signal-detection` | 8am UTC daily, Mon-Fri | Scores accounts, finds hot prospects |
| `outreach-scheduler` | 10am + 2pm UTC, Mon-Fri | Generates and queues outreach |
| `weekly-report` | 4pm UTC, Fridays | Sends performance report to Slack |

### 7.4 — Switch to Live Sending (When Ready)

When you've reviewed enough dry-run output and are confident:

1. Go to **Trigger.dev Dashboard → Environment Variables**
2. Change `DRY_RUN` from `true` to `false`
3. **Start small:** Consider limiting to 10-20 contacts first by adjusting the `limit` in `outreach-engine.ts`

> **There is no undo for sent emails.** Make sure you've reviewed at least 20+ dry-run outputs and your governance variables are dialed in before switching to live.

---

## Phase 8: Daily Operations (No Code Needed)

### What Happens Automatically

| Time | What Runs |
|---|---|
| Every hour (Mon-Fri) | CRM sync pulls new contacts/companies |
| 8am UTC (Mon-Fri) | Signal detection scores accounts, identifies buying windows |
| 10am + 2pm UTC (Mon-Fri) | Outreach engine generates and sends personalized emails |
| Continuous | Durable sequences wait 3-5 days between emails, check for replies |
| Real-time | Engagement webhooks log opens/clicks/replies |
| 4pm UTC (Fridays) | Weekly performance report to Slack |

### What You Monitor

| Where | What to Check | How Often |
|---|---|---|
| **Slack** | Reply alerts, error alerts, weekly reports | Check when notified |
| **Trigger.dev Dashboard** | Task runs, errors, retry attempts | 1-2x per week |
| **Personize Dashboard** | Memory records, property extraction quality | 1x per week |
| **HubSpot** | Logged emails, created tasks, contact status | As needed |

### How to Tune (No Code Changes)

| What You Want to Change | Where to Change It |
|---|---|
| Target different companies/roles | Update **ICP Definition** in Personize dashboard |
| Change email tone or style | Update **Brand Voice** in Personize dashboard |
| Adjust sequence timing or structure | Update **Outreach Playbook** in Personize dashboard |
| Add/remove buying signals | Update **Signal Definitions** in Personize dashboard |
| Update competitor positioning | Update **Competitor Policy** in Personize dashboard |
| Pause the agent | Trigger.dev Dashboard → Pause any schedule |
| Change run times | Edit `cron` in code → `npx trigger.dev deploy` |
| Add more contacts | Just add them to HubSpot — next sync picks them up |

---

## Optional: Connect Enrichment & Signal Sources

These are optional integrations that make the agent smarter.

### Apollo.io (Contact Enrichment)

1. Get an API key from [apollo.io](https://apollo.io)
2. In `source-contacts.ts`, replace the TODO block with Apollo API calls
3. The agent will automatically find and enrich contacts at hot accounts

### SendGrid Webhooks (Engagement Tracking)

1. In SendGrid, go to **Settings → Mail Settings → Event Webhook**
2. Set the URL to a webhook endpoint that triggers `engagement-webhook` task
3. Enable: Opens, Clicks, Bounces, Unsubscribes
4. The agent will learn from engagement data to improve future emails

### HubSpot Webhooks (Real-Time CRM Events)

1. In HubSpot, go to **Settings → Integrations → Webhooks**
2. Subscribe to deal stage changes and contact updates
3. Point to a webhook endpoint that triggers `hubspot-webhook` task
4. The agent will react to CRM changes in real-time

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `npm install` fails on `@personize/sdk` | Check Personize docs for SDK access instructions |
| `npm run setup:schemas` says "unauthorized" | Verify your `PERSONIZE_SECRET_KEY` in `.env` is correct |
| CRM sync shows 0 contacts | Check your `HUBSPOT_ACCESS_TOKEN` has the right scopes |
| Signal detection takes too long | Normal for 100+ companies. First run is slowest. |
| Generated emails are generic | Your governance variables need more specific detail |
| Slack alerts not arriving | Verify `SLACK_WEBHOOK_URL` and that the webhook is active |
| `trigger.dev dev` can't connect | Check `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_ID` in `.env` |
| Task shows "failed" in dashboard | Click the run → read the error logs → check the relevant API key |
| `DRY_RUN=false` but no emails sent | Check `EMAIL_PROVIDER` is set and the matching API key/config is present |
| Smartlead returns 401 | Verify `SMARTLEAD_API_KEY` is correct |
| Smartlead returns 404 on campaign | Verify `SMARTLEAD_CAMPAIGN_ID` is numeric and the campaign is Active |
| `manual-hubspot` tasks not appearing | Verify `HUBSPOT_OWNER_ID` is set and is a valid numeric HubSpot user ID |

---

## File Reference

| File | Purpose | When You'd Edit It |
|---|---|---|
| `.env` | Your API keys (local dev) | Phase 3 |
| `src/setup/create-schemas.ts` | Collection definitions | Only if adding new properties |
| `src/setup/create-governance.ts` | Default governance content | Never — edit in Personize dashboard instead |
| `src/pipelines/sync-hubspot.ts` | CRM sync logic | Only if adding Salesforce or changing fields |
| `src/pipelines/detect-signals.ts` | Signal scoring | Only if changing scoring logic |
| `src/pipelines/generate-outreach.ts` | Email generation | Only if changing sequence structure |
| `src/pipelines/source-contacts.ts` | Contact sourcing | When connecting Apollo/ZoomInfo API |
| `src/delivery/hubspot-deliver.ts` | Send-and-log orchestrator | When adding a new delivery provider |
| `src/delivery/smartlead.ts` | Smartlead API sender | Rarely — already configured |
| `src/delivery/sendgrid.ts` | SendGrid sender | Rarely — already configured |
| `src/delivery/gmail.ts` | Gmail API sender | Rarely — already configured |
| `src/delivery/slack-notify.ts` | Slack alerts | Rarely — already configured |
| `src/trigger/*.ts` | Autopilot schedules | Only to change run times (cron expressions) |
| `trigger.config.ts` | Trigger.dev project config | Only once during setup |

---

## Quick Reference: Key Commands

```bash
# Install
npm install

# Setup (run once — creates collections + governance)
npm run setup

# Test
npm test
npm run typecheck

# Local development
npx trigger.dev@latest dev

# Deploy to production
npx trigger.dev@latest deploy
```
