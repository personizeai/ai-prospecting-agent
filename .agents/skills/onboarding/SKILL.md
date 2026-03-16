---
name: onboarding
description: "Full onboarding wizard for the AI Prospecting Agent. Interviews the user about their business (company name, website, product, ICP, leads, objectives), then configures the entire system: rewrites governance variables (ICP, brand voice, playbook, signals, competitors), updates collection schemas, sets sequence cadences, configures discovery filters, and generates environment setup guidance. Use this skill whenever the user wants to set up, configure, or reconfigure their prospecting agent, or says things like 'set up my agent', 'configure for my business', 'onboard', 'customize the agent', 'update my ICP', or 'I need to change my target audience'."
license: Apache-2.0
compatibility: "Requires the ai-prospecting-agent repository and @personize/sdk"
metadata: {"author": "personize-ai", "version": "1.0", "emoji": "\U0001F680", "requires": {"env": ["PERSONIZE_SECRET_KEY"]}}
---

# Skill: Onboarding Wizard

This skill transforms a generic AI prospecting agent into a fully configured, business-specific outreach machine. It interviews the user about their business, selects the right agent mode, then writes all configuration, governance, schemas, and cadence settings.

## What This Skill Does

The AI Prospecting Agent ships with 18 pre-built modes (outbound-sdr, ecommerce-winback, talent-sourcing, member-renewal, donor-engagement, etc.) and placeholder configuration. This skill helps the user pick the right mode, replaces ALL placeholders with business-specific settings through a guided conversation, and produces a fully configured agent.

**End result:** A fully configured agent ready to run outreach on behalf of the user's specific business and use case.

---

## When This Skill is Activated

**If the user hasn't given specifics yet**, introduce yourself and start with mode selection:

> "I'm your onboarding wizard for the AI Prospecting Agent. First — what are you using this for? Here are some popular modes:
>
> **Sales & GTM:** Outbound SDR, ABM, Cold Deal Revival, Partner Recruitment, Event Follow-Up
> **Ecommerce:** Win-Back, Post-Purchase Upsell, Cart Abandonment
> **Membership:** Member Renewal, Member Onboarding
> **Recruiting:** Talent Sourcing, Employee Onboarding
> **Education:** Student Enrollment, Alumni Engagement
> **Other:** Real Estate Nurture, Agency New Business, Donor Engagement, Volunteer Recruitment
>
> Pick one and I'll pre-load the right defaults, then customize everything for your business."

**If the user gives partial info** (e.g., "set up my agent for a cybersecurity company"), infer the most likely mode (probably `outbound-sdr`), confirm it, then start from what you know and ask follow-up questions for the gaps.

**If the user wants to reconfigure** (e.g., "update my ICP"), jump directly to that section — don't re-interview everything.

**If the user picks a mode**, read the mode definition from `src/config/agent-modes.ts` to pre-populate governance and config defaults, then interview for the business-specific details that the mode doesn't know (company name, specific ICP criteria, competitors, etc.).

---

## Constraints

- **MUST** ask questions conversationally, 2-3 at a time — not a wall of 20 questions -- because overwhelming the user causes them to skip details or disengage.
- **MUST** confirm the full configuration with the user before writing any files -- because writing incorrect config wastes time and may overwrite working settings.
- **MUST** preserve the existing code structure and patterns — only change content/values, not the TypeScript architecture -- because breaking the code structure will crash the agent.
- **MUST NOT** invent business details the user hasn't provided — ask instead -- because fabricated ICP criteria or competitor info will cause the agent to target the wrong people.
- **SHOULD** provide sensible defaults when the user says "I don't know" or "whatever you think" -- because the system needs values to function and the user can always adjust later.
- **SHOULD** explain WHY each piece of information matters before asking -- because context helps the user give better, more specific answers.
- **MAY** suggest improvements or additions the user didn't think of -- because the skill has deep knowledge of what makes prospecting agents effective.

---

## Actions

You have 3 actions. They are sequential for first-time setup, but can be used independently for reconfiguration.

| Action | What It Does | Files Modified |
|---|---|---|
| **INTERVIEW** | Ask about the business, product, ICP, leads, objectives | None (gathering info) |
| **CONFIGURE** | Write governance, schemas, config, and cadences | `create-governance.ts`, `prospecting.config.ts`, `create-schemas.ts` |
| **VERIFY** | Confirm everything looks right, provide next steps | None (review + guidance) |

---

## Action: INTERVIEW

Gather everything needed to configure the agent. Ask in this order, 2-3 questions at a time.

### Phase 0: Agent Mode

> Read `src/config/agent-modes.ts` for all available modes and their preset configurations.

0. **What are you using this for?** — Select the agent mode. This pre-loads governance, cadences, signals, and discovery targets for the chosen use case. The mode's defaults become the starting point — everything is further customized in subsequent phases.

**Maps to:** `AGENT_MODE` env var and `prospecting.config.ts` → `AGENT_MODE`

After mode selection, use the mode's `terminology` to adjust all subsequent questions. For example, if the user picks `patient-reactivation`, ask about "patients" not "prospects", and "appointments" not "meetings".

### Phase 1: The Business

> Read `reference/interview-questions.md` for the full question set with context for each.

1. **Company/organization name and website** — Used in sender identity, governance, and brand voice
2. **What you sell** — Product/service description, value proposition, key differentiators
3. **Your role** — Are you the founder? Sales leader? Marketing? This shapes how the agent talks

### Phase 2: The Target

4. **Who do you sell to?** — Industry verticals, company sizes, geographies
5. **Who do you talk to?** — Job titles, seniority levels, departments of your buyers
6. **Deal size and sales cycle** — Affects cadence aggressiveness and touchpoint count
7. **What disqualifies a lead?** — Existing customers, too small, wrong industry, etc.

### Phase 3: The Competition

8. **Who are your competitors?** — Names, what they're known for, your advantage over each
9. **What makes you different?** — The "why us" that the agent should communicate

### Phase 4: Current State

10. **Do you have leads already?** — In HubSpot? CSV? How many contacts and companies?
11. **What CRM do you use?** — HubSpot, Salesforce, CSV-only, or something else?
12. **Email setup** — Gmail workspace? How many senders? What email addresses?
13. **Do you have API keys ready?** — Personize, Apollo, Tavily, Slack webhook

### Phase 5: Preferences

14. **Outreach style** — Casual/professional? Direct/consultative? Technical/non-technical?
15. **Sequence preferences** — How many emails? How aggressive? Best send times for your audience?
16. **What should the agent NEVER say?** — Forbidden phrases, topics to avoid, compliance rules
17. **Objectives** — What does success look like? Meetings booked? Pipeline generated? Responses?

### Phase 6: Budget & Monitoring

18. **Budget tier** — How aggressively should the agent monitor accounts?

> "How much signal monitoring do you want? This controls how often the agent re-scores accounts, researches companies, and discovers new contacts:
>
> 1. **Conservative** — scores accounts quarterly, no web research or contact discovery (lowest cost, good for <100 accounts or tight budgets)
> 2. **Balanced** — scores monthly, researches and discovers contacts for hot accounts (recommended for most teams)
> 3. **Aggressive** — scores weekly, researches hot + warm accounts (higher cost, best for teams with strong ICP and budget)
>
> You can always change this later with one config change."

**Maps to:**
- `prospecting.config.ts` → `BUDGET_TIER` (one setting that derives all signal, research, discovery, and strategy thresholds)
- `.env` → `BUDGET_TIER` (conservative | balanced | aggressive)

---

## Action: CONFIGURE

After the interview, generate all configuration. Present each section to the user for confirmation before writing.

### Step 1: Governance Variables

Update `src/setup/create-governance.ts` with business-specific content for all 6 governance variables:

#### 1. ICP Definition (`icp-definition`)
Map the user's answers to:
- **Company Criteria**: Industry verticals, employee count range, revenue range, growth stage, tech stack signals
- **Contact Criteria**: Exact titles, seniority levels, departments
- **Disqualification Criteria**: Based on what the user said disqualifies
- **Scoring Weights**: Adjust based on their sales motion (inbound-heavy = more engagement weight, outbound-heavy = more firmographic weight)

#### 2. Brand Voice (`brand-voice`)
Map the user's outreach style to:
- **Tone**: Based on their preference (casual/professional/technical/consultative)
- **Rules**: Include their forbidden phrases + the defaults
- **Personalization Rules**: Keep the defaults, they're good for everyone

#### 3. Outreach Playbook (`outreach-playbook`)
Map the user's sequence preferences to:
- **Sequence Structure**: Number of emails, CTA style per step
- **Timing**: Based on their audience's timezone and habits
- **Channel Rules**: Based on what channels they want to use
- **Opt-Out & Escalation**: Keep defaults (compliance-critical)

#### 4. Signal Definitions (`signal-definitions`)
Customize signals for their industry:
- **Strong Signals**: What buying events matter most for their product?
- **Moderate Signals**: Industry-specific growth indicators
- **Weak Signals**: General activity signals
- **Negative Signals**: What events mean "don't prospect this account"?

#### 5. Competitor Policy (`competitor-policy`)
Fill in from interview:
- **Known Competitors**: Real names, their strengths, user's advantages
- **Rules**: Keep defaults (never badmouth, position on strengths)

#### 6. Email Format & Examples (`email-format-examples`)
Customize examples to match the user's brand voice and product:
- **Email 1 Example**: Rewrite with their value prop and typical observation hooks
- **Email 2 Example**: Rewrite with a second angle relevant to their product
- **Email 3 Example**: Keep the breakup format but match their tone

### Step 2: Prospecting Config

Update `src/config/prospecting.config.ts`:

#### Discovery Config
```typescript
DISCOVERY_CONFIG.targetTitles     // From interview: buyer titles
DISCOVERY_CONFIG.targetSeniorities // From interview: seniority levels
DISCOVERY_CONFIG.targetDepartments // From interview: departments
DISCOVERY_CONFIG.minEmployees      // From interview: company size floor
DISCOVERY_CONFIG.maxEmployees      // From interview: company size ceiling
```

#### Cadences
Based on their deal size and sales cycle:
- **Small deals / fast cycle** → aggressive cadence (2-3 day waits)
- **Mid-market** → standard cadence (3-5 day waits)
- **Enterprise / long cycle** → enterprise cadence (5-10 day waits)

Rename cadence labels to match their business (e.g., "SMB leads" instead of "Hot leads").

#### Budget Tier
Set the single budget control that drives all signal detection, research, and strategy costs:
```typescript
BUDGET_TIER  // 'conservative' | 'balanced' | 'aggressive'
```
This ONE setting automatically configures:
- Signal scoring frequency (quarterly / monthly / weekly)
- Tavily research (off / hot accounts monthly / hot accounts weekly)
- Apollo discovery (off / hot accounts / hot + warm)
- Account strategy evaluation (off / hot accounts monthly / hot accounts weekly)
- Per-run limits for research, discovery, and strategy evaluation

#### Signal Config
```typescript
SIGNAL_CONFIG.hotAccountThreshold  // Adjust based on how selective they want to be
```

#### Account Strategy Config
These fine-tune the account-level coordination WITHIN the budget tier:
```typescript
ACCOUNT_STRATEGY_CONFIG.maxContactsPerWeek   // 2 for mid-market, 1 for enterprise, 3-4 for SMB
ACCOUNT_STRATEGY_CONFIG.carpetBombWindowDays  // 7 default, 14 for enterprise
ACCOUNT_STRATEGY_CONFIG.negativeEventPauseDays // 21 default — how long to pause after layoffs/crisis
```

### Step 3: Collection Schemas (if needed)

Review `src/setup/create-schemas.ts`. The default schemas are comprehensive. Only modify if:
- They sell to a different entity type (e.g., healthcare = patients, real estate = properties)
- They need custom properties not in the defaults
- They want to rename options to match their terminology (e.g., lead statuses)

### Step 4: Environment Variables

Generate a filled `.env` guidance showing exactly what they need to set:
```
PERSONIZE_SECRET_KEY=sk_live_...     # From personize.ai dashboard
TRIGGER_PROJECT_ID=proj_...          # From trigger.dev project
TRIGGER_SECRET_KEY=tr_...            # From trigger.dev API keys
HUBSPOT_ACCESS_TOKEN=pat-...         # From HubSpot → Settings → Private Apps
SENDER_EMAIL=their-actual@email.com  # Their sender email
SENDER_NAME=Their Actual Name        # Their sender name
SLACK_WEBHOOK_URL=https://hooks...   # From Slack → Apps → Incoming Webhooks
BUDGET_TIER=balanced                 # conservative | balanced | aggressive
DRY_RUN=true                         # ALWAYS start with dry run
```

---

## Action: VERIFY

After configuration, walk through a final review:

1. **Read back the ICP** — "Your agent will target [titles] at [company types] in [industries]. Sound right?"
2. **Read back the voice** — "Emails will be [tone], avoiding [forbidden phrases]. Here's a sample first line..."
3. **Read back the cadence** — "Sequences will send [N] emails over [N] days. Hot leads get the aggressive cadence."
4. **Read back competitors** — "When [Competitor A] comes up, we'll position as [advantage]. Correct?"
5. **Next steps checklist**:
   - [ ] Set environment variables in `.env`
   - [ ] Run `npx tsx src/setup/create-schemas.ts` to create collections
   - [ ] Run `npx tsx src/setup/create-governance.ts` to push governance
   - [ ] Import leads (HubSpot sync or CSV)
   - [ ] Start with `DRY_RUN=true` to test
   - [ ] Review dry-run outputs in logs
   - [ ] Set `DRY_RUN=false` when ready to go live

---

## System Architecture Reference

> Read `reference/system-architecture.md` for the complete file map, pipeline descriptions, and how each configuration setting maps to runtime behavior.

### Key Files This Skill Modifies

| File | What Changes | Why |
|---|---|---|
| `src/setup/create-governance.ts` | ICP, brand voice, playbook, signals, competitors, email examples | Governance variables control ALL AI-generated content |
| `src/config/prospecting.config.ts` | Discovery titles/seniorities, cadence timing, signal thresholds | Config controls who gets targeted and how aggressively |
| `src/setup/create-schemas.ts` | Collection properties (only if custom fields needed) | Schemas define what data is stored per contact/company |

### Account Strategy Layer

The agent includes an **account-level strategizer** that coordinates outreach across all contacts at a company. The onboarding skill does NOT need to modify these files — they are driven by config + governance — but you should know they exist:

| File | What It Does | Driven By |
|---|---|---|
| `src/lib/account-workspace.ts` | Account-level workspace (updates, tasks, notes, issues, strategy) keyed on `website_url` | Config: `ACCOUNT_STRATEGY_CONFIG` |
| `src/pipelines/account-strategy.ts` | AI evaluates the full account — all contacts, signals, history — and produces a coordinated strategy | Governance + config |
| `src/pipelines/account-preflight.ts` | Gate before outreach: checks account strategy and returns `proceed / modify / delay / block` | Config: `ACCOUNT_STRATEGY_CONFIG` |

The strategizer prevents 10 edge cases automatically (carpet bombing, cold email at engaged accounts, tone-deaf outreach during crises, etc.). See `Docs/ACCOUNT-STRATEGY.md` for full details.

**Config settings the onboarding skill CAN adjust** (in `prospecting.config.ts` → `ACCOUNT_STRATEGY_CONFIG`):

| Setting | Derived From | What It Controls |
|---|---|---|
| `enableAccountStrategy` | `BUDGET_TIER` | Off for conservative, on for balanced/aggressive |
| `strategyStalenessDays` | `BUDGET_TIER` | 90d conservative, 30d balanced, 7d aggressive |
| `maxAccountsPerRun` | `BUDGET_TIER` | 5 conservative, 10 balanced, 25 aggressive |
| `maxContactsPerWeek` | Manual (default: 2) | Max contacts emailed per account per week (carpet bomb prevention) |
| `carpetBombWindowDays` | Manual (default: 7) | Window for carpet bomb detection |
| `smallCompanyThreshold` | Manual (default: 100) | Companies below this size get carpet bomb protection |
| `negativeEventPauseDays` | Manual (default: 21) | How long to pause outreach after a negative company event |

**Budget tier controls the ON/OFF and frequency. Manual settings fine-tune behavior within the tier.**

Tune manual settings during onboarding based on the user's sales motion:
- **High-velocity sales** (SMB, fast cycle): `maxContactsPerWeek: 3-4`, `carpetBombWindowDays: 5`
- **Mid-market**: Defaults are good
- **Enterprise** (long cycle, relationship-driven): `maxContactsPerWeek: 1`, `carpetBombWindowDays: 14`

### Files This Skill Does NOT Modify

| File | Why Not |
|---|---|
| `src/pipelines/*.ts` | Pipeline logic is generic — config + governance drive behavior |
| `src/trigger/*.ts` | Trigger schedules work for all businesses |
| `src/delivery/*.ts` | Delivery channels are configured via env vars, not code |
| `src/lib/*.ts` | Utilities are business-agnostic |

---

## Handling Partial Information

If the user can't answer everything:

| Missing Info | Default | Impact |
|---|---|---|
| Competitors | Keep placeholders with `[Competitor A/B/C]` | Agent won't mention competitors (safe) |
| Deal size | Assume mid-market ($10K-$100K) | Standard cadence selected |
| Forbidden phrases | Use the built-in defaults | Avoids generic corporate speak |
| Company size range | 50-2,000 employees | Moderate targeting range |
| Send times | Tue-Thu, 8-10am / 2-4pm | Industry standard windows |
| API keys | Skip — guide them to get keys later | Agent won't run until keys are set |

---

## Reconfiguration

When the user wants to change just one thing:

- **"Update my ICP"** → Jump to Phase 2 of INTERVIEW, then update only the `icp-definition` governance variable and `DISCOVERY_CONFIG`
- **"Change my cadence"** → Ask about new timing preferences, update `CADENCES` in config
- **"Add a competitor"** → Ask for competitor details, update `competitor-policy` governance variable
- **"Change my brand voice"** → Ask about new tone, update `brand-voice` governance variable
- **"Change my budget"** → Explain the 3 tiers, update `BUDGET_TIER` in `.env` or config. All thresholds update automatically
- **"I got new API keys"** → Guide them through `.env` updates

For partial reconfiguration, **MUST** read the current file content first to avoid overwriting other settings.
