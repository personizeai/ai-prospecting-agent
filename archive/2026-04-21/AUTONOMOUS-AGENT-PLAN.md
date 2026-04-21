# Autonomous Revenue OS — Architecture Plan (v4)

> **Goal:** A user chats with their AI. The AI runs their sales operation — campaigns, outreach, replies, reporting. It asks questions when stuck, shares results, learns from feedback.

> **Constraint:** Don't rebuild what works. Don't add complexity. Keep it simple enough that one person can understand the whole system.

> **This version:** Audited 3 times against actual code. Every claim verified. Every gap tested against real execution paths.

---

## What Already Exists (Verified Against Code)

| Capability | File | Verified |
|---|---|---|
| **Personize webhook** | `trigger/personize-webhook.ts` | 317 lines. Routes memorize events → enrich → score → strategy → sequence. Secret verification, batch support, configurable pipeline steps. **Not yet tested in production.** |
| **ICP scoring + gating** | `personize-webhook.ts:188-194` | Checks `icp_match` + `lead_score >= 40` + `outreach_stage === 'Not Started'` before triggering outreach. Also in `generate-outreach.ts:114-116` for cadence selection. |
| **Outreach sequence** | `trigger/outreach-sequence.ts` | Full cadence-driven sequence: stop-signal checks, generation, sender resolution, SMTP delivery, outreach-log attribution, workspace updates, multi-channel follow-up (LinkedIn + calls). Uses Trigger.dev `wait.for()` for durable inter-email delays. |
| **Outreach engine (scheduler)** | `trigger/outreach-engine.ts` | Cron (10am + 2pm Mon-Fri). Finds qualified contacts, triggers `processContactTask` with concurrency limit of 5. **⚠️ Not campaign-aware — see gaps.** |
| **Outreach generation** | `pipelines/generate-outreach.ts` | Assembles context (governance + contact + company + previous outreach), runs account preflight, generates email with JSON-structured output, validates HTML. Role-aware governance when Sales Org enabled. |
| **Account preflight** | `pipelines/account-preflight.ts` | Pre-send gate: block/modify/delay based on account state. Prevents carpet-bombing, tone-deaf messaging at engaged accounts. |
| **Sender profiles** | `lib/sender-profiles.ts` | Stable IDs, health tracking (bounce → degrade, reply → boost, auto-pause at < 30), warmup ramp, capacity management, email rotation, persona matching (technical/executive/general/consultative), account consistency (same sender per company). |
| **Account workspaces** | `lib/account-workspace.ts` | Per-company: updates, tasks, notes, issues, strategy. Race-free arrayPush/arrayPatch. Contact rollup across company. Task lifecycle (complete, decline with escalation, reschedule). |
| **Contact workspaces** | `lib/workspace.ts` | Per-contact: updates, tasks, notes, issues, messages sent, sequence state. `getSequenceState()` returns emailsSent, hasReplied, hasOptedOut, lastEngagement, hasDraftAtStep. |
| **Outreach logging** | `lib/outreach-log.ts` | Every send recorded: contact, channel, step, subject, angle, messageId, senderEmail. Opens/clicks/replies tracked with angle attribution. |
| **Reply handler** | `trigger/reply-handler.ts` | Attributes reply to original message via In-Reply-To header, AI classifies (sentiment, urgency, next action, referred contact), routes actions, logs to outreach-log for feedback loop. |
| **Metrics** | `lib/metrics.ts` | Daily: emails sent (by step), sequences completed, opt-outs, replies (by sentiment), signals detected, contacts enriched, companies researched, Gmail capacity remaining, needs-attention items. |
| **Daily digest** | `trigger/daily-digest.ts` | Cron 9am UTC weekdays. Collects metrics + health check, posts formatted summary to Slack. |
| **Sales roles** | `config/sales-roles.ts` | SDR, AE, CSM, Sales Ops, Revenue Analyst. Role-based ownership (`ownsStatuses`), claim triggers, handoff triggers, governance overlays, per-role cron schedules. |
| **18 agent modes** | `config/agent-modes.ts` | Pre-configured for 8 industries. Each mode defines: terminology, ICP summary, brand voice tone, signal examples, playbook notes, cadence presets, discovery targets, suggested budget tier. |
| **Account strategy** | `pipelines/account-strategy.ts` | Gathers company digest + previous strategy + issues + contact rollup + governance + sender profiles in parallel. AI produces coordinated strategy with contact-level recommended actions. |
| **Governance safety** | `lib/governance-safety.ts` | Snapshot before edit, validate (size limits, truncation detection, contradiction detection), dry-run (generate test email with proposed governance), rollback. |
| **Contact discovery** | `pipelines/discover-contacts-apollo.ts`, `enrich-apollo.ts` | Apollo integration for finding + enriching contacts at target companies. |
| **Company research** | `pipelines/research-company.ts` | Tavily web research with AI synthesis, signal extraction, personalization angle identification. |
| **CRM sync** | `pipelines/sync-hubspot.ts`, `sync-salesforce.ts`, `sync-csv.ts`, `sync-clay.ts` | Pull-based sync. Still available as power-user option alongside webhooks. |
| **Multi-channel delivery** | `delivery/gmail.ts`, `delivery/smtp.ts`, `delivery/sendgrid.ts`, `delivery/linkedin.ts`, `delivery/phone.ts`, `delivery/smartlead.ts` | Gmail API, SMTP, SendGrid, HeyReach (LinkedIn), Bland.ai/Vapi/ElevenLabs (voice). |
| **Task execution** | `pipelines/execute-task.ts` | AI reads pending tasks from workspace, decides if it can handle or must decline. Decline → creates escalated task for human. |
| **Health monitoring** | `trigger/health-check.ts` | 15-min checks on Personize, Gmail, Apollo, Tavily, HubSpot. |
| **IMAP reply monitoring** | `trigger/imap-reply-monitor.ts` | Watches configured inboxes for replies. |
| **Dashboard** | `revenue-os-dashboard/` | Next.js, authenticated API. |

---

## What's Actually Missing (Verified Against Execution Paths)

### Gap 1: Campaign entity — no way to group contacts into campaigns

No Campaign collection. No `campaign_id` on contacts. No way to say "these 200 contacts are my fintech campaign" and get stats, pause it, or compare it.

**Impact:** The system processes ALL qualified contacts as one undifferentiated pool. Can't run multiple campaigns with different ICPs, senders, cadences, or governance.

### Gap 2: Outreach engine is not campaign-aware

`outreach-engine.ts:25-29` queries `'qualified contacts ready for outreach, not opted out'` — a semantic search across ALL contacts. No campaign filter. No per-campaign daily caps. No per-campaign sender pool selection. No per-campaign governance overrides.

The outreach-sequence (`outreach-sequence.ts`) also has no campaign awareness — it processes a single contact without knowing which campaign it belongs to.

`generate-outreach.ts` assembles context from org-wide governance (`smartGuidelines`), not campaign-specific governance.

**Impact:** Running 2+ campaigns simultaneously would send all contacts through the same pipeline with the same governance, same senders, same cadence. No isolation.

**Fix required:** Thread `campaignId` through:
- `outreach-engine.ts` → query contacts by `campaign_id`, respect campaign daily cap
- `outreach-sequence.ts` → pass `campaignId` alongside `contactEmail`
- `generate-outreach.ts` → load campaign-specific governance overrides before org defaults

### Gap 3: Webhook doesn't know about campaigns

`personize-webhook.ts:178-195` fires `fullSequenceTask.trigger()` for any new contact with `icp_match` + `lead_score >= 40`. But it doesn't:
- Check which active campaigns match the contact's ICP
- Assign the contact to a campaign
- Use campaign-specific sender pool

**Impact:** New contacts arriving via HubSpot/Zapier/CSV enter the pipeline without campaign assignment. They get processed by the global outreach engine with no campaign context.

**Fix required:** After ICP scoring, match contact against active campaign ICP criteria. If match found → assign `campaign_id`, assign sender from campaign pool, then trigger campaign-aware sequence.

### Gap 4: Sender assignment happens at send time, not enrollment

`outreach-sequence.ts:191` calls `senderProfiles.resolveForContact()` at send time. But if no sender was pre-assigned (via `assigned_sender` property), it falls back to `sendAndLog()` which uses the default Gmail/SendGrid provider, completely **bypassing the sender profile system** (no health tracking, no warmup, no capacity management).

`senderProfiles.assignSender()` exists but isn't called during enrollment. It's a standalone function that picks the best sender based on capacity + persona match + account consistency.

**Impact:** Contacts can go through the whole pipeline without ever getting a sender profile assigned. Sender health tracking, warmup, and capacity limits are bypassed for these contacts.

**Fix required:** When enrolling a contact in a campaign, call `senderProfiles.assignSender()` with the campaign's sender pool. Store the result as `assigned_sender` on the contact.

### Gap 5: No MCP server or CLI for Claude integration

No `.mcp.json`, no MCP server file, no MCP tool definitions anywhere in the repo. Claude (via Cowork/Desktop/OpenClaw) cannot:
- Trigger Trigger.dev tasks (outreach, discovery, research)
- Read sender profile health/capacity (stored as guideline JSON — Claude would need to parse it)
- Get aggregated metrics (daily metrics function is internal)
- Create/manage campaigns

Claude CAN do everything via Personize MCP (memorize, recall, search, properties, guidelines, prompt). But the Revenue OS operational layer (trigger tasks, read sender state, get metrics) is inaccessible.

**Options:**
- **a) MCP server** (~200 lines): Expose Revenue OS functions as MCP tools. Full integration.
- **b) HTTP API**: Expose a few REST endpoints that Claude can call via `WebFetch` or that the user can curl.
- **c) CLI commands**: `npx ros campaign:create`, `npx ros stats`, `npx ros outreach:start`. Claude tells the user what to run.
- **d) Personize-only v1**: Claude uses only Personize MCP. For Revenue OS actions, Claude writes instructions in contact/campaign notes, and scheduled tasks pick them up.

**Recommendation:** Start with (c) CLI commands — minimal, works immediately, Claude can tell users what to run. Move to (a) MCP server when the system is proven.

### Gap 6: Stats are expensive to compute on demand

`memory.search()` returns max ~200 records per call. A campaign with 1,000 contacts requires 5 API calls just to count sent/replied/positive. Every time someone asks "how's it going?" costs credits.

**Fix:** Store lightweight counters on the campaign record. Increment them at event time:
- `outreach-log.recordSend()` → increment `campaign.emails_sent`
- `reply-handler` → increment `campaign.replies` (+ `campaign.positive_replies` if positive)
- `outreach-sequence` → increment `campaign.contacts_reached` when first email sent
- `workspace.raiseIssue()` for bounce → increment `campaign.bounced`

Reading stats = 1 API call (read campaign properties). Cost: 0 extra at query time, 1 extra API call per event.

### Gap 7: Claude has no context at conversation start

When a user opens a new Claude session, Claude doesn't know what campaigns are running, what happened overnight, or what needs attention. The daily-digest already computes all this for Slack, but Claude doesn't read Slack.

**Fix:** Add one `memorize()` call at the end of `daily-digest.ts`:

```typescript
// At the end of dailyDigestTask.run():
await client.memory.memorize({
  content: `[DAILY BRIEF ${new Date().toISOString().split('T')[0]}]\n${message}`,
  collectionName: 'system-logs',
  tags: ['daily-brief', 'latest'],
  enhanced: false,
});
```

Claude's first action in any conversation: `memory_recall` with tag `daily-brief` → instant context.

### Gap 8: DRY_RUN defaults to true

`outreach-sequence.ts:141`: `const dryRun = process.env.DRY_RUN !== 'false'`. Same in `outreach-engine.ts:57`, `multichannel-engine.ts:75`, `role-schedulers.ts:37`.

Every outreach pipeline defaults to dry run. Nothing sends until `DRY_RUN=false` in `.env`.

**Not a bug — this is a safety feature.** But the user walkthrough needs to make it explicit. When the user says "start outreach," Claude should warn: "Your system is in dry-run mode. Emails will be generated but not sent. Set DRY_RUN=false when you're ready to go live."

### Gap 9: No learning loop

The outreach-log tracks every send with angle attribution, and the reply-handler records sentiment + attributed angle. But nothing aggregates this data to identify which angles work and propose governance updates.

**Fix:** One scheduled task (~80 lines) that runs weekly, queries outreach-log, groups by angle, computes reply rates, asks AI for playbook suggestions, posts to Slack + memorizes for Claude.

---

## Data Flow: How It Actually Works (Post-Fix)

```
DATA IN (user's choice):
─────────────────────────────────────────────────────────────
  Zapier/HubSpot/Salesforce → Personize native integrations
  CSV exports (ZoomInfo, Apollo) → batch-memorize (Claude-assisted or CLI)
  Revenue OS sync pipelines → still available for pull-based sync
  Personize dashboard / MCP → manual entry

PERSONIZE NOTIFIES:
─────────────────────────────────────────────────────────────
  Personize memorize event → webhook → personize-webhook.ts

EXISTING WEBHOOK LOGIC (already built):
─────────────────────────────────────────────────────────────
  Contact created → enrich → score (icp_match + lead_score) → assign role
  Company created → research → discover contacts → evaluate strategy
  
NEW: CAMPAIGN MATCHING (must build):
─────────────────────────────────────────────────────────────
  Score ≥ 40 + ICP match?
    → Load active campaigns
    → Match contact against campaign ICP criteria
    → If match found:
        1. Set campaign_id on contact
        2. Assign sender from campaign's sender pool
        3. Trigger campaign-aware outreach sequence
    → If no match but qualified:
        Store as qualified, no campaign — agent/human assigns later

OUTREACH (must modify existing):
─────────────────────────────────────────────────────────────
  outreach-engine scheduler → query contacts BY campaign_id
  → Respect per-campaign daily cap
  → For each contact:
      → generate-outreach loads campaign governance (overrides + org defaults)
      → account-preflight still runs (cross-campaign carpet-bomb prevention)
      → sender resolved from pre-assigned profile (assigned at enrollment)
      → email sent, logged to outreach-log WITH campaign_id
      → campaign stats incremented

REPLIES (existing, add campaign stats):
─────────────────────────────────────────────────────────────
  IMAP monitor → reply-handler → classify → route
  → Increment campaign.replies (+ campaign.positive_replies if positive)
  → Outreach-log records angle attribution (existing)
  → Workspace updated (existing)

REPORTING:
─────────────────────────────────────────────────────────────
  Daily digest → Slack (existing) + memorize daily brief (new, 3 lines)
  Claude reads daily brief at conversation start (via memory_recall)
  Campaign stats → read campaign record properties (1 API call, 0 compute)
  Learning loop → weekly angle analysis → playbook suggestions
```

---

## User Experience (Corrected, Honest)

### Setup

```
1. Clone repo, npm install, copy .env
2. Set PERSONIZE_SECRET_KEY (required)
3. Set TRIGGER_DEV_TOKEN (required — for scheduled tasks + webhook)
4. Optional: APOLLO_API_KEY, Gmail creds, Slack webhook URL
5. Run: npx ros setup
   → Creates collections (Contact, Company, Campaign, outreach-log)
   → Creates default governance (brand voice, ICP, playbook)
6. Deploy to Trigger.dev: npx trigger-dev deploy
7. Register Personize webhook URL (from Trigger.dev dashboard)
8. Connect Claude: add Personize MCP server to Claude config
```

### First Conversation (Claude + Personize MCP)

```
User: I want to set up outreach to fintech CTOs. I have a ZoomInfo CSV.

Claude: [calls ai_smart_guidelines — sees default governance]
Claude: Let me customize your setup. A few questions:
        1. How should your emails sound? (technical, conversational, formal?)
        2. Company size range for your ICP?
        3. Any competitors or topics to avoid?

User: Technical and direct. 50-500 employees. Don't mention CompetitorX.

Claude: [calls ai_prompt to draft governance, then memory_memorize to store]
Claude: Done — brand voice, ICP, and competitor policy set up.
        
        Now for your CSV — share the file path and I'll import it.

User: C:\exports\zoominfo.csv

Claude: [reads CSV headers, maps to schema]
Claude: I see 800 contacts. I'll import them to Personize.
        [calls memory_batch_memorize in chunks of 50]
        
        ⚠️ Note: Your system is in DRY_RUN mode. Emails will be 
        generated but NOT sent until you set DRY_RUN=false in .env.
        
        Import complete. The webhook will score each contact against 
        your ICP. This may take a few minutes for 800 contacts.
        
        Next step: create a campaign. Run this in your terminal:
        
        npx ros campaign:create \
          --name "Fintech CTOs Q2" \
          --market "US Fintech 50-500 employees" \
          --cadence standard \
          --daily-cap 30
        
        Then:
        npx ros campaign:enroll fintech-ctos-q2 \
          --filter '{"icp_match": true, "lead_score_gte": 40}'
```

**Why CLI instead of Claude doing it directly?** Because there's no MCP server yet. Claude can do all the Personize operations (memorize, recall, search, governance), but triggering Revenue OS tasks requires the CLI or MCP server.

### Daily Operation

```
[Runs automatically — no user action needed]

10am UTC: outreach-engine queries contacts per campaign, generates + sends
2pm UTC:  outreach-engine runs again (second batch)
Every 15m: IMAP monitor checks for replies
Every 15m: health check verifies all systems
9am UTC:  daily digest → Slack + Personize memory

[User checks in via Claude]

User: How's my campaign?

Claude: [calls memory_recall with tag "daily-brief" — gets latest metrics]
Claude: [calls memory_search for campaign record — gets config]  
Claude: [calls memory_search for contacts with campaign_id — counts stats]

Claude: Fintech CTOs Q2 — Day 5 (still in dry-run mode):
        
        89/340 generated (not sent — DRY_RUN=true)
        Campaign cadence: standard (3 emails, 3-5 day gaps)
        Sender: Alice (health: 100, warmup day 1)
        
        Ready to go live? Set DRY_RUN=false and I'll confirm.

User: Yes, let's go live.

Claude: Run: DRY_RUN=false in your .env, then restart Trigger.dev.
        
        Once live, Alice will start at 5 emails/day (warmup) and 
        ramp to her full daily limit over 8 days.

[After going live, 3 days later]

User: How's it going?

Claude: [reads daily brief + campaign stats]

Claude: Fintech CTOs Q2 — Day 3 live:
        
        47/340 contacted (warmup: 15/day now, full capacity in 5 days)
        6 replies (13% reply rate):
          3 positive, 2 questions, 1 not interested
        Alice's sender health: 97
        
        The 3 positive replies need your attention:
        1. Sarah Chen (CTO, DataFlow): "What's pricing?"
        2. Mike Ross (VP Eng, CloudBase): "Can we chat next week?"
        3. Lisa Park (Dir Eng, FinServe): "Tell me about the API."
        
        I can draft follow-ups for Lisa (technical question).
        Sarah and Mike probably need your personal touch.
```

### Multiple Campaigns

```
User: I want a second campaign for healthcare. Different tone.

Claude: Healthcare needs different governance. Let me set that up.
        [creates campaign-specific governance overrides via Personize]
        
        You'll need a second sender — Alice is committed to fintech.
        Add Bob's email account and run:
        
        npx ros sender:create \
          --name "Bob Johnson" \
          --email bob@company.com \
          --persona consultative
        
        npx ros campaign:create \
          --name "Healthcare CIOs Q2" \
          --cadence enterprise \
          --daily-cap 20 \
          --sender sp_bob \
          --governance-overrides healthcare-brand-voice,healthcare-compliance

Claude: Two campaigns running:
        1. Fintech CTOs Q2 — Alice, standard cadence, 340 contacts
        2. Healthcare CIOs Q2 — Bob, enterprise cadence, 156 contacts
        
        Account preflight will prevent overlap if any company appears 
        in both campaigns.
```

### When Personize Webhook Fires (New Contact from HubSpot)

```
[HubSpot syncs new contact to Personize]
[Personize fires webhook to Revenue OS]
[personize-webhook.ts runs:]
  1. Enrich contact (Apollo if available)
  2. Score ICP (lead_score + icp_match)
  3. Score ≥ 40 + ICP match → check active campaigns
  4. Contact matches "Fintech CTOs Q2" ICP criteria
  5. Set campaign_id = "fintech-ctos-q2"
  6. Assign sender from campaign pool (Alice)
  7. Trigger outreach sequence
  8. Increment campaign.contacts_enrolled

[Next time user talks to Claude]

Claude: New contact arrived from HubSpot yesterday:
        James Wu, CTO at NexGen (ICP score: 68)
        Auto-enrolled in Fintech CTOs Q2, assigned to Alice.
        Email 1 goes out in the next scheduler cycle.
```

### Learning Loop (Weekly)

```
[Monday 9am — learning loop runs]

[Queries outreach-log for last 14 days]
[Groups sends + replies by angle]
[AI analyzes patterns]
[Posts to Slack + memorizes to Personize]

Slack:
  📊 Weekly Learning Loop
  
  Top angles by positive reply rate:
    1. "hiring-signal" — 22% positive reply (18 sent, 4 positive)
    2. "technical-proof" — 15% positive reply (26 sent, 4 positive)
    3. "pain-point" — 8% positive reply (24 sent, 2 positive)
  
  Underperforming:
    - "ROI-argument" — 2% positive reply (48 sent, 1 positive)
    - Consider retiring or reworking this angle.
  
  Sender health:
    - Alice: 94 (stable)
    - Bob: 87 (3 bounces this week — check list quality)
  
  Suggested playbook change:
    "Lead with hiring signals for Enterprise tier contacts.
     Reserve ROI arguments for mid-market only."
    
    Approve? React with ✅ to apply.

[User opens Claude]

Claude: The learning loop found that "hiring-signal" angle outperforms 
        everything else (22% vs 8% average). It suggests leading with 
        hiring signals for enterprise contacts.
        
        Want me to update the playbook? I'll use governance safety 
        (dry-run a test email first before applying).
```

---

## Implementation Plan (Ordered by Dependency)

### Step 1: Campaign schema (0.5 day)

Add Campaign collection + `campaign_id` on Contact. No new files — just additions to `create-schemas.ts`.

```
[ ] Add Campaign collection to create-schemas.ts (14 properties — config only)
[ ] Add campaign_id property to Contact collection
[ ] Run setup script to deploy schemas
[ ] Verify: campaign record can be created, contact can be tagged
```

### Step 2: Campaign stats counters (0.5 day)

Lightweight counters on campaign records, incremented at event time.

```
[ ] Add stat properties to Campaign schema: contacts_enrolled, contacts_reached, 
    emails_sent, replies, positive_replies, meetings_booked, bounced, opted_out
[ ] Add helper: incrementCampaignStat(campaignId, field, amount)
[ ] Wire into outreach-log.recordSend() → increment emails_sent
[ ] Wire into reply-handler → increment replies (+ positive_replies)
[ ] Wire into outreach-sequence → increment contacts_reached on first send
[ ] Wire into workspace.raiseIssue() for bounce → increment bounced
```

### Step 3: Campaign-aware webhook (1 day)

Modify existing `personize-webhook.ts` — don't create a new file.

```
[ ] After ICP scoring passes, load active campaigns via memory.search()
[ ] Match contact against campaign ICP criteria (industry, size, geo, titles)
[ ] If match: set campaign_id on contact, assign sender from campaign pool
[ ] If no match but qualified: leave unassigned (agent/human assigns later)
[ ] Call senderProfiles.assignSender() with campaign's sender_profile_ids
[ ] Store assigned_sender on contact property
[ ] Trigger campaign-aware outreach sequence (pass campaignId)
[ ] Increment campaign.contacts_enrolled
```

### Step 4: Campaign-aware outreach engine (1 day)

Modify existing files — outreach-engine.ts, outreach-sequence.ts, generate-outreach.ts.

```
[ ] outreach-engine.ts: query contacts per campaign (not global semantic search)
    - Load active campaigns
    - For each campaign: query contacts with campaign_id + sequence_status != Complete
    - Respect campaign daily_send_cap (check campaign.emails_sent_today vs cap)
    - Pass campaignId to processContactTask
    
[ ] outreach-sequence.ts: accept campaignId parameter
    - Pass campaignId to generateOutreachForContact()
    - Sender resolution: if no assigned_sender, assign from campaign pool (not global)
    - Increment campaign stats on send
    
[ ] generate-outreach.ts: load campaign-specific governance
    - Accept campaignId parameter
    - Load campaign record → get governance_overrides (array of guideline IDs)
    - Fetch campaign governance FIRST, then org governance as fallback
    - Merge: campaign overrides take priority over org defaults
```

### Step 5: Sender assignment at enrollment (0.5 day)

```
[ ] Create enrollInCampaign(email, campaignId) helper function
    - Read campaign record → get sender_profile_ids
    - Call senderProfiles.assignSender() with campaign's sender pool
    - Set contact properties: campaign_id, assigned_sender
    - Increment campaign.contacts_enrolled
    - Log to workspace: "Enrolled in campaign X, assigned sender Y"
    
[ ] Wire into webhook (step 3) and CLI (step 7)
```

### Step 6: Daily brief to Personize memory (15 minutes)

```
[ ] At end of daily-digest.ts run(), add:
    await client.memory.memorize({
      content: `[DAILY BRIEF ${date}]\n${message}`,
      collectionName: 'system-logs',
      tags: ['daily-brief'],
      enhanced: false,
    });
    
[ ] Claude can now recall: memory_recall_pro with tag "daily-brief"
```

### Step 7: CLI commands (1 day)

Simple CLI scripts that Claude can tell users to run. No MCP server needed for v1.

```
[ ] npx ros setup — run create-schemas + create-governance
[ ] npx ros campaign:create --name --market --cadence --daily-cap --sender
[ ] npx ros campaign:list — show active campaigns with stats
[ ] npx ros campaign:stats <id> — show detailed campaign stats  
[ ] npx ros campaign:pause <id> — set status to Paused
[ ] npx ros campaign:enroll <id> --filter '{"icp_match": true}'
[ ] npx ros sender:create --name --email --persona
[ ] npx ros sender:list — show sender profiles with health
[ ] npx ros status — daily metrics + sender health + campaign summary
```

Implementation: each command is a small script in `src/scripts/` that imports existing library functions. No new logic — just CLI wrappers.

### Step 8: Learning loop (0.5 day)

```
[ ] Add src/trigger/learning-loop.ts (~80 lines)
    - Cron: Monday 9am UTC
    - Query outreach-log for last 14 days (recall with tags)
    - Group by angle → compute reply rates
    - AI prompt: analyze patterns, suggest playbook changes
    - Post to Slack (reuse notifySlack)
    - Memorize insights to Personize (for Claude to read)
```

### Step 9: MCP server (future — after v1 is proven)

```
[ ] Create src/mcp-server.ts
    - Expose Revenue OS functions as MCP tools
    - ros_campaign_list, ros_campaign_stats, ros_sender_status
    - ros_trigger_outreach, ros_daily_metrics, ros_account_info
    - Claude can then operate Revenue OS directly without CLI
```

### Step 10: Test the webhook in production

```
[ ] Deploy all changes to Trigger.dev
[ ] Register webhook URL with Personize
[ ] Test: memorize a contact with ICP match → webhook fires → campaign assigned → outreach triggered
[ ] Test: memorize a contact without ICP match → webhook fires → logged, no outreach
[ ] Test: memorize a company → webhook fires → research → discover contacts → qualify → enroll
[ ] Test: 2 campaigns running → contacts route to correct campaign → different senders
[ ] Test: same company in 2 campaigns → account preflight blocks carpet-bombing
[ ] Test: DRY_RUN=true → emails generated but not sent
[ ] Test: DRY_RUN=false → emails actually delivered
[ ] Test: reply comes in → classified → campaign stats updated → outreach-log attributed
```

---

## Total Effort

| Step | Effort | New Files | Modified Files |
|---|---|---|---|
| Campaign schema | 0.5 day | 0 | `setup/create-schemas.ts` |
| Campaign stats | 0.5 day | 1 small helper | `lib/outreach-log.ts`, `trigger/reply-handler.ts`, `trigger/outreach-sequence.ts` |
| Campaign-aware webhook | 1 day | 0 | `trigger/personize-webhook.ts` |
| Campaign-aware outreach | 1 day | 0 | `trigger/outreach-engine.ts`, `trigger/outreach-sequence.ts`, `pipelines/generate-outreach.ts` |
| Sender enrollment | 0.5 day | 1 small helper | `trigger/personize-webhook.ts` |
| Daily brief | 15 min | 0 | `trigger/daily-digest.ts` |
| CLI commands | 1 day | 8-10 small scripts | `package.json` |
| Learning loop | 0.5 day | 1 | — |
| Testing | 1 day | 0 | — |
| **Total** | **~6 days** | **~12 small files** | **~8 existing files** |

No new frameworks. No new collections (except Campaign). No new architectural patterns. Just threading `campaignId` through existing pipelines and adding a few helpers.

---

## Polling + Webhooks Coexistence

**Default path: event-driven.** Personize webhook is the entry point. Data arrives from any source → Personize memorizes → webhook fires → qualification → campaign routing → outreach.

**Polling: still there, agent-decided.** Existing sync pipelines and cron tasks are untouched:
- `sync-hubspot.ts`, `sync-salesforce.ts`, `sync-csv.ts`, `sync-clay.ts` — pull-based CRM sync
- `health-check.ts` — 15-min health monitoring (inherently poll-based)
- `daily-digest.ts` — daily metrics collection (inherently poll-based)
- `imap-reply-monitor.ts` — inbox watching (inherently poll-based)
- `outreach-engine.ts` — scheduler that dispatches outreach (cron-based)

Both paths call the same downstream pipelines. A contact that enters via webhook goes through the same `generate-outreach` → `account-preflight` → `sender-profiles` → `outreach-log` pipeline as a contact that enters via CRM sync.

The agent (Claude) can also suggest setting up polling for specific use cases: "I'd recommend checking Apollo weekly for new hires at your top 20 accounts. Set up `detect-signals` with a weekly cron targeting those domains."

---

## Answers to Key Questions

**Can it handle 100/day?**
Yes, today. Outreach engine runs 2x/day with concurrency limit of 5. 100 contacts = 2 batches.

**Can it handle 1,000/day?**
Yes, with per-campaign caps distributed across multiple sender profiles. At 5 senders × 100/day each (post-warmup) = 500/day. Add more senders to scale.

**Can it handle 10,000+/day?**
Needs scale changes not in this plan: pre-generation overnight + delivery during business hours + parallel workers. Build this when you actually hit 2K+/day. ~2-day change when needed.

**Will it store stats?**
Yes. Campaign record has lightweight counters incremented at event time. Contact records have full workspace history. Outreach-log has every send with attribution. Reading stats = 1 API call.

**Will it report to the human?**
Daily digest to Slack (existing). Daily brief memorized to Personize (new, 3 lines). Claude reads brief at conversation start. Learning loop posts weekly angle analysis. Campaign stats available via CLI or Claude query.

**Can it handle multiple campaigns with different ICPs/senders/governance?**
Yes, after this implementation. Each campaign has its own ICP criteria, sender pool, cadence, daily cap, and governance overrides. Account preflight prevents cross-campaign carpet-bombing.

**Is DRY_RUN safe?**
Yes. Defaults to true. Nothing sends until explicitly set to false. Claude warns the user about this during setup.
