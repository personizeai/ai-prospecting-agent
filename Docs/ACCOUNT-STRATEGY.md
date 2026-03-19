# Account Strategy — Account-Level Intelligence Layer

The Account Strategy layer adds account-level awareness on top of the existing contact-level workspace. It prevents tone-deaf outreach, coordinates across contacts at the same company, and ensures every contact-level action is informed by the full account picture.

## Why This Exists

Without account-level intelligence, every contact is an island. The system doesn't know that three contacts at the same 30-person startup are all getting cold emails on the same day, or that a new contact was just discovered at a company already in proposal stage. The account strategizer is a **pre-flight gate** that runs before contact-level actions and adjusts behavior based on account context.

---

## Architecture Overview

```
                                    ┌─────────────────────────┐
                                    │    Account Workspace     │
                                    │  (keyed on website_url)  │
                                    │                          │
                                    │  strategy, account tasks │
                                    │  account notes, rollups  │
                                    └────────────┬────────────┘
                                                 │
                                                 │ writes strategy
                                                 │
┌──────────────┐    ┌────────────────────────────┴────────────────────────────┐
│  CRM Sync    │───→│              Account Strategizer                        │
│  Enrichment  │    │                                                         │
│  Signals     │    │  1. search() → all contacts at company                  │
│  Replies     │    │  2. smartDigest() → company profile                     │
│              │    │  3. smartRecall() per contact → sequence, tasks, issues  │
│              │    │  4. AI evaluates → strategy + next actions               │
│              │    │  5. Creates/modifies contact tasks based on account      │
└──────────────┘    └──────────┬──────────────────────────────┬───────────────┘
                               │                              │
                               │ reads                        │ gates/modifies
                               ▼                              ▼
                    ┌──────────────────┐            ┌──────────────────────┐
                    │ Contact Workspace │            │  generate-outreach   │
                    │ (keyed on email)  │            │  task-executor       │
                    │                  │            │  outreach-sequence   │
                    │ per-person state  │            │  reply-handler       │
                    └──────────────────┘            └──────────────────────┘
```

### Two Workspace Layers (Complementary, Not Competing)

| Layer | Key | Holds | Unchanged? |
|-------|-----|-------|------------|
| Contact workspace | `email` | Individual outreach, sequence state, reply analysis, per-person tasks | Yes — fully untouched |
| Account workspace | `website_url` | Account strategy, cross-contact rollups, account-level signals, account tasks | New |

The contact workspace continues to work exactly as-is. The account workspace is additive.

---

## Contact-to-Company Linking

### The Problem

Today, contacts are memorized with `email` only. Companies are memorized with `website_url` only. There's no explicit link — the only association is a `company_name` text property on the contact.

This means `search({ websiteUrl: 'acme.com', type: 'Contact' })` returns nothing, because no contact was ever memorized with `website_url`.

### The Fix

Add `website_url` (company domain) to every contact memorization call. The Personize SDK stores all provided CRM keys on every row, so contacts become findable by company:

```typescript
// Before (current)
{ email: 'john@acme.com', content: '...', collectionName: 'contacts' }

// After (with linking)
{ email: 'john@acme.com', website_url: 'acme.com', content: '...', collectionName: 'contacts' }
```

Now `search({ websiteUrl: 'acme.com', type: 'Contact', returnRecords: true })` returns all contacts at Acme.

### Files That Need `website_url` Added

| File | Change | Domain Source |
|------|--------|---------------|
| `src/pipelines/sync-csv.ts` | Add `website_url: row.company_website` to contact records | `company_website` column (already in CSV row) |
| `src/pipelines/sync-hubspot.ts` | Add `website_url` to contact records | Resolve from associated company domain, or add `domain` to `HUBSPOT_CONFIG.contactProperties` |
| `src/pipelines/ingest-enrichment.ts` | Add `website_url: data.company_domain` to the contact `memorize()` call (line 15) | `company_domain` already available in `EnrichmentData` |

### What This Enables

```typescript
// Find all contacts at a company (deterministic, structured)
const contacts = await client.memory.search({
  websiteUrl: 'acme.com',
  type: 'Contact',
  returnRecords: true,
});

// Semantic search across all memories linked to this company
const companyMemories = await client.memory.smartRecall({
  website_url: 'acme.com',
  query: 'buying signals, engagement, pain points',
  fast_mode: true,
});
```

### Note on Workspace Memories

Contact workspace writes (`workspace.addTask()`, `workspace.addNote()`, etc.) will continue to pass only `email`. This means `smartRecall({ website_url })` won't surface individual workspace memories — only the initial contact records memorized with both keys.

The account strategizer compensates by doing per-contact recalls after finding contacts via `search()`. This is the pragmatic v1 approach. A v2 optimization could thread `website_url` through workspace writes for single-call cross-contact intelligence.

---

## End-to-End Workflow: From Lead Sync to Account Strategy

This is the complete lifecycle showing where account strategy integrates with existing flows.

```
PHASE 1: DATA INGESTION
════════════════════════

CRM Sync (hourly, Mon-Fri)
  │
  ├─ syncHubSpotContacts()
  │   └─ memorizeBatch() with email + website_url (NEW: company linking)
  │       └─ Tags: crm, hubspot, sync
  │
  ├─ syncHubSpotCompanies()
  │   └─ memorizeBatch() with website_url
  │       └─ Tags: crm, hubspot, company, sync
  │
  ├─ syncEngagementHistory()
  │   └─ For each contact: notes, emails, meetings, calls, tasks, deals
  │       └─ memorizeBatch() with email
  │
  └─ Auto-enrich (if enabled)
      ├─ enrichContacts() → Apollo People Enrichment
      │   └─ ingestEnrichment() → memorize with email + website_url (NEW)
      └─ enrichCompanies() → Apollo Org Enrichment
          └─ memorize with website_url


PHASE 2: INTELLIGENCE
═════════════════════

Signal Detection (daily 8am, Mon-Fri)
  │
  ├─ STEP 1: Score all companies
  │   └─ For each company: smartDigest + AI scoring → ICP fit, signal strength
  │
  ├─ STEP 2: Research hot accounts (Tavily)
  │   └─ News, funding, hiring, product launches → memorize to company
  │
  ├─ STEP 3: Discover contacts at hot accounts (Apollo)
  │   └─ ingestEnrichment() → memorize with email + website_url (NEW)
  │
  └─ ★ STEP 4: Account Strategy (NEW)
      └─ accountStrategyForHotAccounts(hotAccounts)
          └─ For each hot account:
              │
              ├─ GATHER (parallel)
              │   ├─ search({ websiteUrl, type: 'Contact', returnRecords: true })
              │   │   → all contacts with structured properties
              │   ├─ smartDigest({ website_url, type: 'Company', token_budget: 2000 })
              │   │   → company profile, signals, research
              │   ├─ smartRecall({ website_url, query: 'account strategy signals research', fast_mode: true })
              │   │   → previous strategy, company-level memories
              │   ├─ Per contact (parallel):
              │   │   smartRecall({ email, query: 'sequence state tasks issues engagement replies', fast_mode: true })
              │   │   → each contact's workspace state
              │   └─ smartGuidelines({ message: 'account strategy prospecting prioritization' })
              │       → governance rules
              │
              ├─ EVALUATE
              │   AI produces:
              │   ├─ account_health: healthy | at_risk | stalled | blocked
              │   ├─ account_stage: new_target | researching | prospecting | multi-threaded | engaged | opportunity
              │   ├─ contact_rollup: per-contact status summary
              │   ├─ coordination_flags: carpet_bomb_risk | champion_gone | conflicting_signals | ...
              │   ├─ recommended_actions: list of { contact, action, rationale, priority }
              │   └─ strategy_summary: human-readable account plan
              │
              └─ PERSIST
                  ├─ accountWorkspace.setStrategy(domain, strategy)
                  ├─ accountWorkspace.addUpdate(domain, { summary of changes })
                  ├─ For each recommended contact action:
                  │   └─ workspace.addTask(email, task) — with account context in description
                  └─ Update company properties: account_status, signal_strength


PHASE 3: OUTREACH (modified by account strategy)
═════════════════════════════════════════════════

Outreach Scheduler (10am & 2pm, Mon-Fri)
  │
  └─ For each qualified contact:
      │
      ├─ ★ PRE-FLIGHT: Account Strategy Check (NEW)
      │   │
      │   ├─ Recall account strategy for this contact's company
      │   │   smartRecall({ website_url, query: 'account strategy coordination flags', fast_mode: true })
      │   │
      │   ├─ Check coordination flags:
      │   │   ├─ carpet_bomb_risk → delay this contact, stagger outreach
      │   │   ├─ account_stage = engaged/opportunity → warm tone, not cold
      │   │   ├─ negative_signal_at_account → pause, review
      │   │   ├─ recent_company_event → adjust angle (no "scaling your team" during layoffs)
      │   │   └─ referred_contact → use referral cadence, not cold sequence
      │   │
      │   ├─ Inject account context into outreach generation:
      │   │   └─ "Other contacts at this company: John (VP, replied positively), Sarah (Dir, meeting set)"
      │   │
      │   └─ GATE DECISION:
      │       ├─ PROCEED → generate outreach with account context injected
      │       ├─ MODIFY → change cadence, tone, or angle based on account state
      │       ├─ DELAY → reschedule to avoid carpet bombing or timing conflict
      │       └─ BLOCK → do not email (account converted, all contacts negative, etc.)
      │
      ├─ generateOutreachForContact(email)  ← now receives account context
      │   ├─ assembleContext() — includes account strategy alongside contact/company context
      │   └─ AI generates email informed by account state
      │
      └─ sendAndLog()


PHASE 4: ENGAGEMENT & FEEDBACK LOOP
════════════════════════════════════

Reply Received (webhook)
  │
  ├─ analyzeReply() — existing flow (unchanged)
  │   └─ Classify sentiment, create contact-level tasks
  │
  └─ ★ Account Impact Assessment (NEW)
      │
      ├─ Recall account strategy
      ├─ Evaluate: does this reply change the account picture?
      │   ├─ Positive reply from key contact → account_stage upgrade
      │   ├─ Negative reply → check if account-level rejection
      │   ├─ Referral → add new contact with warm flag
      │   └─ OOO → adjust timing for this contact only
      │
      ├─ If account state changed:
      │   ├─ Re-run account strategizer for this company
      │   ├─ accountWorkspace.addUpdate(domain, impact)
      │   └─ May create/cancel tasks for other contacts at same account
      │
      └─ If other contacts should be affected:
          └─ Pause/modify sequences for related contacts


PHASE 5: REPORTING
══════════════════

Daily Digest (existing) — now includes account-level metrics
  ├─ Accounts in motion (stage changes)
  ├─ Multi-threaded accounts (>1 contact engaged)
  └─ Blocked accounts (all contacts negative/bounced)

Weekly Report (existing) — now includes account strategy section
  ├─ Top accounts by engagement
  ├─ Strategy effectiveness (did recommended actions convert?)
  └─ Accounts needing human review
```

---

## The 10 Edge Cases

### Edge Case 1: New Contact at Advanced-Stage Account

**Scenario:** Account is in `Proposal` stage. John (VP Sales) and Sarah (Director) are engaged — Sarah had a positive reply, John has a meeting set. Apollo discovers Dave (Head of Procurement). Without account awareness, Dave enters the cold prospecting sequence.

**What goes wrong without the strategizer:**
Dave receives: *"Hi Dave, I noticed Acme is scaling its sales team..."* — a generic cold Email 1. Dave walks to John's desk: "Some vendor just cold-emailed me about the thing you're already evaluating." Looks uncoordinated and undermines credibility.

**How the strategizer handles it:**

```
1. DETECT
   Dave is memorized with website_url: 'acme.com'
   Account strategy for acme.com shows: stage = proposal, engaged contacts = [John, Sarah]

2. PRE-FLIGHT (before outreach scheduler picks up Dave)
   Coordination flag: account_stage = proposal
   Gate decision: MODIFY — do not use cold cadence

3. ACTION
   Dave's outreach is modified:
   - Cadence: warm-introduction (1-2 emails max, not 3-email cold sequence)
   - Tone: referential ("I've been working with John and Sarah on [X]...")
   - Angle: procurement-specific ("as this moves toward next steps, wanted to connect since your team will likely be involved")
   - Timing: may delay until John/Sarah confirm procurement involvement

4. PERSIST
   accountWorkspace.addUpdate('acme.com', {
     type: 'coordination',
     summary: 'New contact Dave (Procurement) — modified to warm intro, referencing John/Sarah engagement'
   })
```

**Decision tree:**

| Account Stage | New Contact Action |
|---|---|
| New Target / Researching | Normal cold sequence |
| Prospecting (other contacts in sequence) | Staggered cold, vary angle |
| Engaged (positive replies exist) | Warm intro referencing engaged contacts |
| Opportunity / Proposal | Warm intro, procurement/expansion angle |
| Customer | No prospecting — route to account management |

---

### Edge Case 2: Carpet Bombing — Multiple Contacts Emailed Same Day

**Scenario:** 4 contacts at a 30-person startup are all qualified and due for Email 1 today. The outreach scheduler picks up all 4.

**What goes wrong without the strategizer:**
All 4 receive different cold emails on the same morning. In a 30-person company, they'll compare notes over Slack or lunch. The emails have different angles but are clearly automated — it looks like a spray-and-pray operation. Trust is broken before a conversation even starts.

**How the strategizer handles it:**

```
1. DETECT
   search({ websiteUrl: 'startup.com', type: 'Contact' }) → 4 contacts
   All 4 have outreach_stage = 'Not Started'
   Company employee_count = 30
   Coordination flag: carpet_bomb_risk = true

2. EVALUATE
   AI considers:
   - Company size: small (everyone knows everyone)
   - Contact count: 4 (high ratio for a 30-person company)
   - Seniority ranking: CEO > VP Eng > Head of Product > Marketing Manager

3. ACTION
   Strategy:
   - Lead with highest-seniority: CEO gets Email 1 this week
   - Wait 5 days. If no response → VP Eng gets Email 1
   - Wait 5 days. If neither responds → Head of Product
   - Marketing Manager: hold unless others engage (4th contact at a 30-person company is overkill)
   - All emails use complementary angles (not overlapping)
   - If CEO responds → DO NOT cold-email the others; pivot to warm intros

   Creates staggered tasks:
   - workspace.addTask(ceo_email, { title: 'Send Email 1', dueDate: today, priority: 'high' })
   - workspace.addTask(vp_email, { title: 'Send Email 1', dueDate: today + 5d, priority: 'medium' })
   - workspace.addTask(head_email, { title: 'Send Email 1', dueDate: today + 10d, priority: 'medium' })
   - workspace.addTask(marketing_email, { title: 'Hold — evaluate after senior contacts', status: 'pending', priority: 'low' })

4. PERSIST
   accountWorkspace.setStrategy('startup.com', {
     approach: 'top-down sequential',
     maxContactsPerWeek: 1,
     reason: 'Small company (30 employees), 4 contacts — stagger to avoid carpet bombing'
   })
```

**Carpet bomb threshold logic:**

| Company Size | Max Contacts/Week | Strategy |
|---|---|---|
| < 50 employees | 1 | Sequential, top-down by seniority |
| 50–200 employees | 2 | Stagger by department |
| 200–1000 employees | 3–5 | Parallel OK if different departments |
| 1000+ employees | No limit | Departments are independent |

---

### Edge Case 3: One Contact Opts Out, Others in Active Sequence

**Scenario:** VP replies: "Please remove me from your list." Director had opened Email 1 but hasn't replied. SDR contact hasn't been touched yet.

**What goes wrong without the strategizer:**
VP is marked opted-out (correct). Director gets Email 2 on schedule. SDR gets Email 1 next week. Both are treated as if the VP's response doesn't exist. But the VP's rejection might signal an account-level "no" — and the Director/SDR might escalate it to the VP if they also receive emails.

**How the strategizer handles it:**

```
1. DETECT
   Reply analyzer classifies VP reply → NEGATIVE
   Account impact assessment triggered
   Recall account strategy + all contact states

2. EVALUATE
   AI classifies the negative reply:

   Case A — "Not interested, we already use [Competitor]"
     → Account-level rejection. Competitive intel captured.
     → Pause ALL sequences at this account
     → accountWorkspace.raiseIssue: "VP rejected — competitor in place"
     → Create human review task: "Account rejected by VP. Competitor: [X]. Evaluate if worth continued outreach to other contacts."

   Case B — "I'm not the right person" (no referral)
     → Contact-level rejection, NOT account-level
     → Continue Director and SDR sequences unchanged
     → Note on VP: "Wrong persona — remove from sequence but don't flag account"

   Case C — "Not now, maybe next quarter"
     → Timing rejection, not categorical
     → Slow down cadence for ALL contacts (enterprise timing)
     → Reschedule VP for next quarter follow-up
     → Continue Director/SDR but with extended wait times

   Case D — "Stop emailing me" / hostile
     → Contact-level hard opt-out
     → Evaluate risk: if VP is the decision-maker, pause account
     → If VP is peripheral, continue with others cautiously

3. ACTION (Case A example)
   - workspace.raiseIssue(vp_email, { title: 'Opted out', severity: 'critical' })
   - Pause Director sequence: workspace.addTask(director_email, { title: 'HOLD — VP rejected, pending review' })
   - Cancel SDR enrollment: workspace.addTask(sdr_email, { title: 'DO NOT START — account under review' })
   - accountWorkspace.addUpdate('acme.com', { summary: 'VP opted out. Reason: competitor in place. All outreach paused.' })
   - accountWorkspace.setStrategy: account_stage = 'blocked', reason = 'decision-maker rejected'
```

---

### Edge Case 4: Account Was Lost/Churned, New Contacts Discovered

**Scenario:** Deal with Acme was lost 8 months ago. Lost reason: "Went with Competitor X." Signal detection finds Acme is hiring aggressively — hot account score = 85. Apollo discovers 3 new contacts.

**What goes wrong without the strategizer:**
New contacts enter cold prospecting with no awareness of history. If any of them were around during the previous deal, they'll remember: "We already looked at these guys and chose [Competitor]." Opening line about "noticed you're growing" feels generic when there's a relationship history to leverage.

**How the strategizer handles it:**

```
1. DETECT
   Signal detection flags Acme as hot (ICP score 85, hiring surge)
   Account strategy recall finds: previous deal LOST 8 months ago, reason: Competitor X
   Company records show: 2 previous contacts (old deal), 3 new contacts (just discovered)

2. EVALUATE
   AI considers:
   - Time since loss: 8 months (enough for buyer's remorse / contract renewal)
   - Lost reason: Competitor X (trackable — are they still using it?)
   - Hot signals: hiring surge suggests growth, possibly outgrowing Competitor X
   - New contacts: may or may not know about previous evaluation

   Strategy options:
   a) If signals suggest dissatisfaction with Competitor X → re-engagement angle
   b) If hiring surge in same department → "your team has grown since we last talked" angle
   c) If new contacts are in different department → treat as semi-cold, mention company familiarity

3. ACTION
   - DO NOT enroll in standard cold sequence
   - Cadence: re-engagement (2 emails, longer gaps, different tone)
   - Angle: "We worked with your team previously — things have changed on our side since then"
   - Research task: check if Competitor X contract is up for renewal
   - If previous contacts still at Acme → warm re-engagement: "It's been a while since we connected with [previous contact]. Your team has grown significantly since then..."

4. PERSIST
   accountWorkspace.setStrategy('acme.com', {
     approach: 're-engagement',
     history: 'Lost deal 8 months ago to Competitor X',
     angle: 'Growth since last evaluation, product improvements',
     avoid: 'Generic cold openers — they know us'
   })
```

---

### Edge Case 5: Champion Leaves the Account

**Scenario:** Sarah was the champion at Acme — she engaged, replied positively, was pushing internally. Enrichment refresh (or LinkedIn signal) detects she left Acme. She's now VP Marketing at NewCo. John and Dave at Acme never spoke to you directly.

**What goes wrong without the strategizer:**
Sarah's contact goes stale. John and Dave keep getting sequence emails as if nothing changed. Nobody follows up with Sarah at NewCo. The internal champion who was advocating is gone, but outreach continues as if the deal is progressing.

**How the strategizer handles it:**

```
1. DETECT
   Enrichment refresh shows Sarah's company changed: Acme → NewCo
   Account strategy for Acme shows: Sarah was primary engaged contact (positive reply, meeting set)
   John and Dave: contacted but not engaged

2. EVALUATE — Two Accounts Affected

   Acme (champion lost):
   - account_health: at_risk → champion departed
   - Remaining contacts (John, Dave) have weak engagement
   - Strategy: find new champion or pause

   NewCo (champion arrived):
   - Sarah knows you, had positive sentiment
   - Warm lead at a new company
   - Strategy: re-engage Sarah with new-role angle

3. ACTION

   At Acme:
   - accountWorkspace.raiseIssue('acme.com', { title: 'Champion departed', severity: 'high' })
   - Pause John/Dave sequences (they were relying on Sarah's internal push)
   - Create human task: "Sarah left Acme. John and Dave had low engagement. Find new champion or deprioritize."
   - Research task: identify Sarah's replacement at Acme

   At NewCo:
   - Create Sarah's record at NewCo with website_url: 'newco.com'
   - Carry forward: positive sentiment, previous engagement, relationship history
   - DO NOT carry forward: Acme-specific context (deal details, Acme pain points)
   - Cadence: warm re-engagement, not cold
   - Angle: "Congrats on the new role! We were making great progress at Acme — would love to explore whether NewCo has similar needs"
   - Research NewCo via Tavily before outreach

4. PERSIST
   accountWorkspace.setStrategy('acme.com', {
     status: 'at_risk',
     reason: 'Champion (Sarah) departed',
     action: 'Find replacement champion or deprioritize'
   })
   accountWorkspace.setStrategy('newco.com', {
     status: 'warm_lead',
     reason: 'Former champion Sarah joined as VP Marketing',
     action: 'Re-engage Sarah with new-role angle'
   })
```

---

### Edge Case 6: Account Just Became a Customer

**Scenario:** HubSpot deal moves to `Closed Won`. But 2 contacts at the same company are still in active cold sequences — Email 2 is scheduled for tomorrow.

**What goes wrong without the strategizer:**
"Just following up on my previous email..." lands in the inbox of someone whose company just signed. It signals internal disorganization and could embarrass the salesperson who closed the deal.

**How the strategizer handles it:**

```
1. DETECT
   HubSpot webhook: deal stage → Closed Won for company domain 'acme.com'
   Account strategy check finds: 2 contacts in active sequences

2. EVALUATE
   This is a hard gate — no AI judgment needed:
   account_status = Customer → STOP ALL PROSPECTING

3. ACTION — Immediate, automated:
   - For EVERY contact at this company:
     ├─ Cancel any pending outreach tasks
     ├─ workspace.raiseIssue(email, { title: 'Account converted — stop prospecting', severity: 'critical' })
     └─ workspace.rewriteContext(email, 'ACCOUNT CONVERTED — do not prospect')

   - accountWorkspace.addUpdate('acme.com', {
       type: 'system',
       summary: 'Deal closed-won. All prospecting sequences stopped.'
     })

   - Update company: account_status → 'Customer'

   - Optional: Create expansion tasks for contacts not yet in the relationship
     ("Introduce [product line B] to contacts outside the deal")

4. PERSIST
   accountWorkspace.setStrategy('acme.com', {
     status: 'customer',
     action: 'No prospecting. Route to account management / expansion play.'
   })
```

**This should be the highest-priority edge case to implement — the cost of getting it wrong is the highest.**

---

### Edge Case 7: Conflicting Signals Across Contacts

**Scenario:** VP replied positively: "This looks interesting, let's talk next week." Director (different thread, different sender) replied: "We already have a solution for this, not interested."

**What goes wrong without the strategizer:**
VP gets a meeting-booking follow-up. Director gets opted-out. Both responses are handled correctly in isolation, but the system doesn't realize these are at the same company. The meeting with VP happens without knowledge that the Director (who may control the budget or implementation) is resistant.

**How the strategizer handles it:**

```
1. DETECT
   Two replies at same company within 48 hours:
   - VP: POSITIVE, "let's talk next week"
   - Director: NEGATIVE, "we already have a solution"
   Account strategy flags: conflicting_signals = true

2. EVALUATE
   AI considers:
   - Seniority: VP outranks Director
   - VP sentiment: positive, meeting interest
   - Director sentiment: defensive (protecting incumbent solution)
   - Interpretation: Director may be the current tool's internal champion
     or may not be aware of VP's initiative

3. ACTION
   - CONTINUE with VP → book the meeting
   - DO NOT email Director again (respect the opt-out)
   - But DO NOT mark account as "not interested"
   - Prepare VP meeting with competitive context:
     "Director's team currently uses [Competitor]. There may be internal resistance
      from the current solution's champion. Prepare to address switching costs."
   - Human notification: "Conflicting signals at Acme — VP interested, Director rejected.
     VP meeting taking priority. See account strategy for context."

4. PERSIST
   accountWorkspace.addNote('acme.com', {
     category: 'analysis',
     content: 'Conflicting signals: VP positive, Director negative (defending incumbent).
               Competitive dynamic identified. VP meeting scheduled — prepare for
               internal resistance during evaluation.'
   })
```

**Signal priority hierarchy:**

| Scenario | Account-Level Decision |
|---|---|
| Senior positive + junior negative | Follow senior signal, note competitive dynamic |
| Senior negative + junior positive | Pause — senior decision-maker said no |
| Same level, mixed | Human review — need to understand org dynamics |
| Multiple negatives | Account-level rejection — stop all |
| Multiple positives | Multi-threaded opportunity — accelerate |

---

### Edge Case 8: Referral Within Account

**Scenario:** Email to VP: VP replies: "I'm not the right person — talk to Lisa Chen, she runs this area." Lisa isn't in our system.

**What goes wrong without the strategizer:**
Reply analyzer creates a "follow up with referral" task on the VP's workspace. But later, when Lisa is discovered via Apollo (or manually added), she enters the system as a brand-new cold lead. She gets enrolled in the standard cold sequence with no knowledge of the referral.

**How the strategizer handles it:**

```
1. DETECT
   Reply analyzer extracts: REFERRAL, referred_contact = "Lisa Chen"
   VP's workspace: task created "Follow up with referral"

2. EVALUATE
   Account strategy intercepts Lisa's onboarding:
   - Lisa is being added to the same account (same website_url)
   - Account has a referral flag: referred_by = VP, referred_to = Lisa Chen
   - Match by name + company → link referral to new contact

3. ACTION
   When Lisa is memorized:
   - Tag: referred_contact = true, referred_by = VP email
   - DO NOT enroll in cold cadence
   - Create warm outreach task with referral context:
     Subject: "[VP Name] suggested I reach out"
     Body: references the referral naturally
   - Cadence: referral (1-2 emails max, high priority, fast follow-up)
   - Mark VP's referral task as actioned

   accountWorkspace.addUpdate('acme.com', {
     summary: 'VP referred Lisa Chen — warm intro queued, not cold sequence'
   })

4. SAFEGUARD
   Pre-flight check must catch this BEFORE outreach scheduler:
   - Any new contact at an account with a pending referral
   - Name match against referred_contact in recent reply analyses
   - If match: block cold cadence, route to referral cadence
```

---

### Edge Case 9: Data Staleness — Contact Left the Company

**Scenario:** Contact was enriched 6 months ago via Apollo. Their email still works (personal domain or forwarding), but they left the company 2 months ago. We're emailing them about their old company's needs.

**What goes wrong without the strategizer:**
Emails keep going. The contact either ignores them, replies confused ("I don't work there anymore"), or worse — the email forwards to their old company's IT, triggering a spam complaint.

**How the strategizer handles it:**

```
1. DETECT (multiple signals)
   Passive detection:
   - 3 emails sent, 0 opens → unusual for verified email
   - LinkedIn enrichment refresh shows different company
   - OOO reply mentioning new role
   - Bounce from company domain (if they used work email)

   Active detection (enrichment refresh):
   - Re-enrich contacts with 0 engagement every 90 days
   - Apollo returns different company → flag

2. EVALUATE
   Contact confirmed left:
   - Stop sequence immediately
   - Is their new company interesting? (ICP check)
   - Who replaced them at the old company?

   Contact suspected stale (no hard confirmation):
   - Flag for re-enrichment
   - Don't send next email until confirmed

3. ACTION
   At old company:
   - workspace.raiseIssue(email, { title: 'Contact may have left company', severity: 'high' })
   - Pause sequence
   - Research: who replaced them? (Apollo search by title at same company)
   - If replacement found → create new contact, inherit account context

   At new company (if contact moved to ICP-fit company):
   - Create new record at new company
   - Warm angle: "Congrats on the move! You might find [product] useful at [NewCo] too"
   - Carry forward: engagement history, communication preferences
   - Do NOT carry forward: old company's deal/context

4. PERSIST
   accountWorkspace.addUpdate('oldcompany.com', {
     summary: '[Contact] appears to have left. Sequence paused. Researching replacement.'
   })
```

**Staleness detection triggers:**

| Signal | Confidence | Action |
|---|---|---|
| 3+ emails, 0 opens | Low | Flag for re-enrichment |
| OOO mentioning new role | Medium | Pause + re-enrich |
| Apollo refresh shows new company | High | Stop + create at new company |
| Bounce on work email | High | Stop + find replacement |
| LinkedIn title/company changed | High | Stop + evaluate both accounts |

---

### Edge Case 10: Outreach Timing Collision with Account-Level Event

**Scenario:** Signal detection picks up that Acme just announced layoffs (25% reduction). Email 2 was scheduled today for a contact at Acme, with an angle about "scaling your sales team."

**What goes wrong without the strategizer:**
The email goes out with a tone-deaf message about growth and scaling while the company is in crisis mode. Even if the contact is personally safe from layoffs, receiving a sales pitch during a company crisis is off-putting. It signals you're not paying attention.

**How the strategizer handles it:**

```
1. DETECT
   Signal detection / Tavily research finds: "[Acme] announces 25% layoff"
   Account strategy check: 2 contacts in active sequences
   One has Email 2 scheduled today with "growth" angle

2. EVALUATE
   AI classifies event:
   - Event type: negative company event (layoffs)
   - Severity: high (public, affects morale company-wide)
   - Duration: pause for 2-4 weeks minimum
   - Angle impact: ALL growth/scaling/hiring angles are toxic right now

3. ACTION
   Immediate:
   - Pause ALL sequences at this account
   - Cancel today's Email 2
   - accountWorkspace.raiseIssue('acme.com', {
       title: 'Negative company event — layoffs announced',
       severity: 'high',
       description: '25% reduction announced. All outreach paused for 3 weeks.'
     })

   After pause period (3 weeks):
   - Re-evaluate: is the contact still there?
   - New angle: efficiency, cost reduction, doing more with less
   - Avoid: growth, scaling, hiring, expansion
   - Tone: empathetic, not salesy

   accountWorkspace.setStrategy('acme.com', {
     status: 'paused',
     reason: 'Layoffs announced — all outreach held',
     resume_date: today + 21 days,
     angle_blacklist: ['growth', 'scaling', 'hiring', 'team expansion'],
     recommended_angles: ['efficiency', 'cost reduction', 'consolidation']
   })
```

**Company event classification:**

| Event Type | Action | Resume After |
|---|---|---|
| Layoffs / RIF | Pause all, switch to efficiency angle | 3-4 weeks |
| CEO/leadership change | Pause, research new leadership | 2 weeks |
| Acquisition announced | Pause, research acquirer | 2-4 weeks |
| Data breach / PR crisis | Pause all outreach | 4+ weeks |
| Funding round | Accelerate — buying window | Immediately |
| Product launch | Adjust angle to reference launch | Immediately |
| IPO | Pause briefly, then re-engage | 1-2 weeks |
| Office expansion | Positive signal, continue | No pause |

---

## Account Strategizer: Method Selection Guide

Which Personize method to use at each step of the strategizer:

### During Context Assembly

| Need | Method | Why This One |
|---|---|---|
| All contacts at company | `search({ websiteUrl, type: 'Contact', returnRecords: true })` | Deterministic. Returns structured properties (name, title, stage, score). No AI needed. |
| Company profile + signals | `smartDigest({ website_url, type: 'Company', token_budget: 2000 })` | Compiled context — structured properties + freeform memories in one call. Token-budgeted. |
| Previous account strategy | `smartRecall({ website_url, query: 'account strategy, coordination, flags', fast_mode: true })` | Semantic search across company-keyed memories. Fast mode = ~500ms. |
| Per-contact workspace state | `smartRecall({ email, query: 'sequence tasks issues engagement replies', fast_mode: true })` | Per-contact semantic search. Run in parallel for all contacts. ~500ms each. |
| Governance rules | `smartGuidelines({ message: 'account strategy prospecting prioritization' })` | Org-level policies. Cached per topic. |
| Full contact dump (debugging) | `recall({ email, type: 'Contact' })` | DynamoDB direct read. No AI, no vector search. All properties + all freeform memories. |

### During Strategy Persistence

| Need | Method | Why |
|---|---|---|
| Write account strategy | `accountWorkspace.setStrategy(domain, strategy)` | Code-managed replace. Searchable via smartRecall. |
| Write account update | `accountWorkspace.addUpdate(domain, update)` | Append-only timeline. |
| Create account task | `accountWorkspace.addTask(domain, task)` → returns `taskId` | Code-managed pending_tasks (read-modify-write). |
| Complete account task | `accountWorkspace.completeTask(domain, taskId, outcome)` | Removes from pending, appends to task_history. |
| Raise account issue | `accountWorkspace.raiseIssue(domain, issue)` → returns `issueId` | Code-managed open_issues. |
| Resolve account issue | `accountWorkspace.resolveIssue(domain, issueId, resolution)` | Removes from open, appends to issue_history. |
| Write contact task | `workspace.addTask(email, task)` | Existing pattern. Unchanged. |
| Update company properties | `memorize({ website_url, collectionName: 'companies', properties: { account_status: ... } })` | Structured property update. |

---

## Account Workspace Module

Helper module — mirrors `workspace.ts` but keyed on `website_url`. Uses the same **dual-semantics** pattern as the contact workspace:

- **Code-managed (replace mode):** `pending_tasks`, `open_issues`, `strategy` — active state only, rewritten on every state change
- **AI-managed (append-only):** `updates`, `notes`, `task_history`, `issue_history` — chronological records, never edited

```
src/lib/account-workspace.ts
```

### Write Functions (append-only)

| Function | Purpose |
|---|---|
| `addUpdate(domain, update)` | Append to account timeline |
| `addNote(domain, note)` | Store account-level observation |

### Write Functions (code-managed)

| Function | Returns | Purpose |
|---|---|---|
| `addTask(domain, task)` | `taskId` | Create account-level task (added to code-managed pending_tasks) |
| `raiseIssue(domain, issue)` | `issueId` | Flag account-level problem (added to code-managed open_issues) |
| `setStrategy(domain, strategy)` | — | Write/overwrite account strategy document |

### Task Lifecycle Functions

| Function | Purpose |
|---|---|
| `completeTask(domain, taskId, outcome)` | Remove from pending_tasks, append to task_history |
| `declineTask(domain, taskId, reason, declinedBy)` | Remove from pending_tasks, append to task_history, escalate to human |
| `rescheduleTask(domain, taskId, newDueDate, reason, rescheduledBy)` | Update dueDate in pending_tasks, append to task_history |
| `resolveIssue(domain, issueId, resolution)` | Remove from open_issues, append to issue_history |

### Read Functions

| Function | Returns | Purpose |
|---|---|---|
| `getDigest(domain)` | smartDigest response | Company smartDigest (compiled context) |
| `getStrategy(domain)` | smartRecall response | Recall current strategy |
| `getOpenTasks(domain)` | `Task[]` | Active account tasks (from code-managed state) |
| `getIssues(domain)` | `Issue[]` | Active account issues (from code-managed state) |
| `getUpdates(domain)` | smartRecall response | Account timeline |
| `getContacts(domain)` | search response | All contacts at company |
| `getContactRollup(domain)` | rollup object | search + per-contact smartRecall (parallel) |

---

## Integration Points

The account strategizer integrates at these points in the existing system:

| Existing Flow | Integration | How |
|---|---|---|
| **CRM Sync** | Add `website_url` to contact memorization | Mechanical change — add field to 3 files |
| **Signal Detection** | Run account strategy after scoring | New step 4 in signal-detection flow |
| **Outreach Scheduler** | Pre-flight account check before generating email | New gate before `generateOutreachForContact()` |
| **Outreach Sequence** | Pre-flight check at each step | Check account strategy before each `shouldStopSequence()` |
| **Reply Handler** | Account impact assessment after reply analysis | New step after `handleAnalyzedReply()` |
| **Task Executor** | Account context injection for generic tasks | Add account recall to `handleGenericTask()` |
| **HubSpot Webhook** | Deal stage changes trigger account strategy update | New handler for deal events |
| **Daily Digest** | Account-level metrics | Add account health section |
| **Weekly Report** | Account strategy effectiveness | Add top accounts section |

---

## Files Summary

### New Files

| File | Purpose |
|---|---|
| `src/lib/account-workspace.ts` | Account workspace read/write helpers (mirrors workspace.ts) |
| `src/pipelines/account-strategy.ts` | Core strategizer pipeline — gather, evaluate, persist |
| `src/pipelines/account-preflight.ts` | Pre-flight gate for outreach — checks account state before sending |

### Modified Files

| File | Change |
|---|---|
| `src/pipelines/sync-csv.ts` | Add `website_url` to contact records |
| `src/pipelines/sync-hubspot.ts` | Add `website_url` to contact records |
| `src/pipelines/ingest-enrichment.ts` | Add `website_url` to contact `memorize()` call |
| `src/trigger/signal-detection.ts` | Add account strategy step after signal scoring |
| `src/trigger/outreach-engine.ts` | Add pre-flight account check before outreach generation |
| `src/trigger/outreach-sequence.ts` | Add pre-flight check at each sequence step |
| `src/pipelines/analyze-reply.ts` | Add account impact assessment after reply handling |
| `src/config/prospecting.config.ts` | Add account strategy config (thresholds, timing rules) |
| `src/setup/create-schemas.ts` | No new collection needed — companies collection already has the right properties |
