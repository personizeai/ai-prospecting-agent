---
name: strategy-review
description: "Autonomous strategy review for Revenue OS and Content OS. Reads system metrics (outreach performance, reply rates, angle effectiveness, governance health, content performance), identifies what's working and what isn't, proposes governance or config changes, runs dry-run validation, and optionally applies changes. Use this skill when the user says 'review strategy', 'optimize outreach', 'what's working', 'analyze performance', 'check system health', 'improve results', 'strategy review', 'meta review', or when invoked by a scheduled operator loop."
license: Apache-2.0
compatibility: "Requires revenue-os repository, @personize/sdk, and Trigger.dev"
metadata: {"author": "personize-ai", "version": "0.1", "emoji": "\U0001F9E0", "requires": {"env": ["PERSONIZE_SECRET_KEY", "TRIGGER_SECRET_KEY"]}}
---

# Skill: Strategy Review

Autonomous strategy operator for Revenue OS and Content OS. Reviews system performance, identifies optimization opportunities, proposes changes, validates them, and applies with approval.

## What This Skill Does

This skill closes the human-in-the-loop gap for strategic decisions. Instead of a human reviewing dashboards and tweaking governance manually, this skill:

1. **Reads** — Collects structured metrics from Personize workspaces and Trigger.dev run history
2. **Analyzes** — Identifies patterns: which angles convert, which ICP tiers respond, which content performs
3. **Proposes** — Drafts specific governance or config changes with rationale
4. **Validates** — Dry-runs the proposed changes against recent data to predict impact
5. **Applies** — With user approval (or auto-apply in autonomous mode), writes changes to governance

---

## When This Skill is Activated

Present a structured review. Do NOT ask open-ended questions — go straight to analysis.

---

## Step 1: Collect System State

Run these data collection steps in parallel:

### Revenue OS Metrics
Use the Personize SDK and workspace APIs to gather:

```typescript
// 1. Campaign performance (per campaign)
// Use: import { campaigns } from '../lib/campaign.js'
// For each active campaign: campaigns.getStats(campaignId)
// Returns: contacts_enrolled, contacts_reached, emails_sent, replies, positive_replies,
//          meetings_booked, bounced, opted_out, emails_sent_today
// Calculate: reply_rate, positive_rate, bounce_rate per campaign
// Compare: campaigns side-by-side to identify winners and losers

// 2. Outreach performance (last 7 days)
// Query contacts collection for recent messages_sent, filter by sentAt
// Group by: angle, step, senderProfileId, campaign_id
// Calculate: sent count, open rate, click rate, reply rate, positive reply rate

// 3. Reply attribution (outreach-log collection with campaign_id)
// Query outreach-log for records with reply data
// Map: angle → reply_sentiment distribution, per campaign
// Also check: outreach-log now has campaign_id and variant fields for per-campaign analysis

// 4. Account strategy health
// Query companies collection for strategy decisions
// Count: proceed vs block vs delay vs modify decisions
// Flag: accounts stuck in "blocked" for 30+ days

// 5. Governance freshness
// Check when each governance variable was last updated
// Flag any that haven't been touched in 60+ days
// Check campaign-specific governance overrides

// 6. Sender health
// Use: import { senderProfiles } from '../lib/sender-profiles.js'
// senderProfiles.list() returns health, warmup, capacity per sender
// Flag degraded senders (health < 50)

// 7. Campaign health alerts
// Flag: campaigns with reply_rate < 1% after 50+ contacts (should auto-pause)
// Flag: campaigns approaching daily cap consistently
// Flag: campaigns with 0 governance overrides (using only org defaults)

// 8. Learning loop insights
// Read latest: recall with tag "learning-loop" for recent weekly analysis
// Check: were any governance proposals generated? Were they applied?

// 9. Ecommerce performance (if ecommerce mode is active)
// Check Products collection: how many products synced?
// Check Contact ecommerce properties: customer_segment distribution (New/Active/Loyal/VIP/At-Risk/Lapsed)
// Check: how many customers have style_preferences inferred vs empty?
// Check: ecommerce campaigns (winback, post-purchase) — reply rates vs B2B campaigns
// Flag: customers moving from Active → At-Risk (purchase gap growing)
```

### Content OS Metrics (if ai-blog-manager is configured)
```typescript
// 1. Content pipeline throughput
// Count: topics discovered, posts drafted, reviewed, published (last 7 days)

// 2. Review quality calibration
// Compare AI review scores vs actual engagement (if CMS analytics connected)
// Flag: high-scored posts that underperformed, low-scored posts that overperformed

// 3. Topic diversity
// Check category distribution of recent posts
// Flag: overrepresented or underrepresented categories
```

### Trigger.dev Health
```bash
# Check recent task run success/failure rates
# Use Trigger.dev API: GET /api/v1/runs?limit=100
# Group by task ID, calculate success rate
# Flag: tasks with >10% failure rate
```

---

## Step 2: Analyze Patterns

After collecting data, identify:

### What's Working
- Top 3 outreach angles by positive reply rate (minimum 10 sends)
- Best-performing ICP tier (by reply rate)
- Healthy senders (low bounce, good reply rate)
- Content categories with highest engagement

### What's Not Working
- Angles with 0 replies after 20+ sends
- ICP tiers with high send volume but no engagement
- Senders approaching reputation risk (bounce rate > 5%)
- Governance variables that may be stale or contradictory
- Content topics with consistently low review scores
- Trigger.dev tasks with high failure rates

### Opportunities
- Angles that work well for specific ICP tiers but aren't used broadly
- Time-of-day or day-of-week patterns in reply rates
- Accounts stuck in pipeline that could be unblocked with strategy change
- Content gaps (categories with reader interest but no recent posts)

---

## Step 3: Propose Changes

For each finding, propose a specific change:

```markdown
### Proposal: [Short title]

**Finding:** [What the data shows]
**Current state:** [What governance/config says now]
**Proposed change:** [Exact text or config to change]
**Expected impact:** [Predicted improvement]
**Risk level:** LOW | MEDIUM | HIGH
**Reversible:** YES | NO
```

Classify proposals:
- **AUTO-APPLY** (low risk, clearly data-backed): angle weighting adjustments, send time optimization
- **REVIEW-REQUIRED** (medium risk): governance wording changes, ICP scoring weight adjustments
- **MANUAL-ONLY** (high risk): disabling senders, changing sequence structure, adding/removing ICP criteria

---

## Step 4: Validate (Dry Run)

For each AUTO-APPLY or REVIEW-REQUIRED proposal:

1. **Snapshot** the current governance variable value
2. **Draft** the new value
3. **Compare** side-by-side (show diff)
4. **Estimate** blast radius: how many contacts/accounts would be affected
5. **Check** for contradictions with other governance variables

Store snapshots so changes can be rolled back.

---

## Step 5: Apply Changes

Present the full review to the user:

```markdown
## Strategy Review — [Date]

### Performance Summary
[Key metrics table]

### What's Working
[Bulleted findings]

### What Needs Attention
[Bulleted findings with severity]

### Proposed Changes
[Numbered proposals with classification]

### Ready to Apply
[List of AUTO-APPLY changes — apply immediately? Y/N]

### Needs Your Decision
[List of REVIEW-REQUIRED changes — approve/reject each]
```

If running in **autonomous mode** (scheduled, no human present):
- Apply all AUTO-APPLY changes
- Queue REVIEW-REQUIRED changes for next human review
- Log everything to a `strategy-review-log` in Personize memory
- Send Slack summary

---

## Data Sources Reference

| Data | Source | API |
|------|--------|-----|
| Outreach metrics | Personize contacts collection | `client.memory.filterByProperty()` |
| Reply attribution | Personize outreach-log collection | `client.memory.filterByProperty()` |
| Account strategies | Personize companies collection | `client.memory.filterByProperty()` |
| Governance variables | Personize guidelines | `client.guidelines.list()` |
| Sender health | Personize sender-profiles | `client.memory.properties()` |
| Task run history | Trigger.dev API | `GET /api/v1/runs` |
| Content metrics | Personize blog-posts collection | `client.memory.filterByProperty()` |
| CMS analytics | WordPress/Ghost API | Platform-specific |

---

## CLI Usage

This skill can be invoked:

1. **Interactively:** `/strategy-review` in Claude Code
2. **Scheduled:** Via Trigger.dev cron task that invokes Claude Code CLI
3. **On-demand:** `claude -p "Run /strategy-review and apply AUTO-APPLY changes"`

---

## Safety Guardrails

1. **Never delete governance** — only modify or append
2. **Always snapshot before edit** — store previous value with timestamp
3. **Rate limit changes** — max 3 governance edits per review cycle
4. **Cooldown** — don't re-review the same variable within 7 days of a change
5. **Blast radius cap** — if a change affects >50% of active contacts, classify as MANUAL-ONLY
6. **Contradiction check** — before applying, verify the new value doesn't conflict with other governance variables
