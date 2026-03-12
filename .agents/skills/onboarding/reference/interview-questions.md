# Interview Questions — Full Reference

Each question includes **why we ask** and **how the answer maps to configuration**.

---

## Phase 1: The Business

### Q1. Company name and website

> "What's your company name, and what's your website URL?"

**Why:** The company name appears in sender identity, governance variables, and brand voice examples. The website URL is used for research and to verify the business exists.

**Maps to:**
- `create-governance.ts` → Brand Voice (sign-off name, company references)
- `.env` → `SENDER_NAME`, `SENDER_EMAIL`
- All governance variables (replace placeholder references)

### Q2. What you sell

> "In 1-2 sentences, what does your product or service do? What problem does it solve?"

**Why:** The value proposition drives every outreach email. The agent needs to know what it's selling to write compelling first sentences.

**Maps to:**
- `create-governance.ts` → Brand Voice (value prop language), Outreach Playbook (CTA framing), Email Format Examples (all 3 email templates)
- `create-governance.ts` → ICP Definition (tech stack signals related to the product)

### Q3. Your role

> "What's your role? Are you the founder, sales leader, or marketing lead running this?"

**Why:** Shapes the sender persona. A CEO sending cold email is different from an SDR. Also helps calibrate how technical the setup guidance should be.

**Maps to:**
- `.env` → `SENDER_NAME`
- `create-governance.ts` → Brand Voice (sign-off style, authority level in emails)

---

## Phase 2: The Target

### Q4. Who do you sell to? (Companies)

> "What types of companies are your best customers? Think about: industry, company size (employees), revenue range, growth stage (startup vs. established), and any tech they typically use."

**Why:** This IS the ICP. Every signal, every score, every targeting decision flows from this.

**Maps to:**
- `create-governance.ts` → ICP Definition (Company Criteria section)
- `prospecting.config.ts` → `DISCOVERY_CONFIG.minEmployees`, `DISCOVERY_CONFIG.maxEmployees`

### Q5. Who do you talk to? (People)

> "What job titles buy your product? What seniority level — managers, directors, VPs, C-suite? What department — sales, marketing, engineering, ops?"

**Why:** Discovery filters use these exact values to find contacts at target accounts.

**Maps to:**
- `create-governance.ts` → ICP Definition (Contact Criteria section)
- `prospecting.config.ts` → `DISCOVERY_CONFIG.targetTitles`, `DISCOVERY_CONFIG.targetSeniorities`, `DISCOVERY_CONFIG.targetDepartments`

### Q6. Deal size and sales cycle

> "What's your typical deal size? (e.g., $500/mo, $50K/year, $200K enterprise). How long does a deal usually take from first touch to close?"

**Why:** Determines cadence aggressiveness. Small/fast deals = aggressive outreach. Large/slow deals = patient enterprise cadence.

**Maps to:**
- `prospecting.config.ts` → `CADENCES` (timing between emails), `CADENCE_RULES` (score thresholds)

### Q7. What disqualifies a lead?

> "What makes a company or person NOT a fit? Existing customers? Too small? Wrong industry? Government/non-profit?"

**Why:** Disqualification criteria prevent the agent from wasting outreach on bad-fit leads.

**Maps to:**
- `create-governance.ts` → ICP Definition (Disqualification Criteria section)

---

## Phase 3: The Competition

### Q8. Who are your competitors?

> "Who do you compete against? For each, what are they known for, and what's your advantage over them?"

**Why:** The competitor policy controls how the agent handles competitive situations in outreach and reply analysis.

**Maps to:**
- `create-governance.ts` → Competitor Policy (Known Competitors section)

### Q9. What makes you different?

> "If a prospect asked 'why should I choose you over [competitor]?', what would you say in one sentence?"

**Why:** This becomes the positioning guidance the agent uses when a prospect mentions a competitor.

**Maps to:**
- `create-governance.ts` → Competitor Policy (positioning rules), Brand Voice (key differentiator language)

---

## Phase 4: Current State

### Q10. Do you have leads already?

> "Do you have a list of contacts or companies to prospect? Where are they — HubSpot, a CSV file, somewhere else? Roughly how many?"

**Why:** Determines the sync source configuration and whether the user needs to import data before the agent can run.

**Maps to:**
- `prospecting.config.ts` → `CRM_SOURCE_CONFIG.source` ('hubspot', 'csv', or 'both')
- Setup guidance for data import

### Q11. What CRM do you use?

> "Do you use HubSpot, Salesforce, or manage contacts some other way?"

**Why:** The agent currently supports HubSpot sync and CSV import. Salesforce requires a different integration path.

**Maps to:**
- `prospecting.config.ts` → `CRM_SOURCE_CONFIG.source`
- `prospecting.config.ts` → `HUBSPOT_CONFIG` settings
- `.env` → `HUBSPOT_ACCESS_TOKEN`

### Q12. Email setup

> "Are you using Google Workspace / Gmail for sending? How many sender accounts do you want to rotate? What email addresses will you send from?"

**Why:** Multi-sender setup improves deliverability. Each sender needs an OAuth token.

**Maps to:**
- `.env` → `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SENDER_EMAIL`, `SENDER_NAME`
- `prospecting.config.ts` → `GMAIL_CONFIG.senders`, `GMAIL_CONFIG.strategy`

### Q13. API keys

> "Do you have your Personize API key, and optionally Apollo, Tavily, and Slack webhook URL? If not, I'll guide you to get them."

**Why:** The agent can't run without at least a Personize key. Apollo and Tavily are optional but recommended.

**Maps to:**
- `.env` → all API key fields
- Generates setup guidance for missing keys

---

## Phase 5: Preferences

### Q14. Outreach style

> "How should your emails sound? Pick the best fit:
> - **Direct & punchy** — short, gets to the point fast
> - **Consultative** — asks questions, positions as an advisor
> - **Technical** — leads with product capabilities and specifics
> - **Casual & friendly** — conversational, like texting a colleague
> - **Executive** — authoritative, business-outcome focused"

**Why:** Brand voice is the single biggest driver of reply rates. Getting the tone right matters more than most settings.

**Maps to:**
- `create-governance.ts` → Brand Voice (Tone section, Rules section)

### Q15. Sequence preferences

> "For your outreach sequences:
> - How many emails max per contact? (default: 3)
> - How many days between emails? (default: 3-5 days)
> - What times work best for your audience? (default: Tue-Thu, 8-10am / 2-4pm)
> - Should the agent be more aggressive (faster follow-ups) or patient (longer gaps)?"

**Why:** Cadence timing directly affects reply rates and deliverability. Industry norms vary.

**Maps to:**
- `prospecting.config.ts` → `CADENCES` (all three cadence definitions)
- `create-governance.ts` → Outreach Playbook (Timing section)

### Q16. What should the agent NEVER say?

> "Are there words, phrases, claims, or topics the agent should absolutely avoid? Any compliance requirements? Things that would embarrass you if a prospect saw them?"

**Why:** Forbidden phrases prevent brand damage and compliance violations. The agent strictly obeys these.

**Maps to:**
- `create-governance.ts` → Brand Voice (Rules section — NEVER list)

### Q17. Objectives

> "What does success look like for you? Pick the most important:
> - Meetings booked
> - Qualified responses
> - Pipeline value generated
> - New accounts engaged
> - Something else?"

**Why:** Objectives shape the CTA style in emails and the escalation rules in the playbook. Meeting-focused = "open to a call?" CTAs. Pipeline-focused = "worth exploring?" CTAs.

**Maps to:**
- `create-governance.ts` → Outreach Playbook (CTA style), Brand Voice (outcome language)
- Future: metrics and reporting configuration

---

## Phase 6: Budget & Monitoring

### Q18. Budget tier

> "How aggressively should the agent monitor and research your accounts?
>
> 1. **Conservative** — scores accounts quarterly, no web research or contact discovery (lowest cost, good for <100 accounts or tight budgets)
> 2. **Balanced** — scores monthly, researches and discovers contacts for hot accounts (recommended for most teams)
> 3. **Aggressive** — scores weekly, researches hot + warm accounts (higher cost, best for teams with strong ICP and budget)"

**Why:** This ONE setting controls all the expensive operations — signal scoring (LLM calls), Tavily web research (API calls), Apollo contact discovery (API credits), and account strategy evaluation (LLM calls). Choosing the right tier prevents overspending while still getting value from the agent.

**Maps to:**
- `prospecting.config.ts` → `BUDGET_TIER` — single field that derives:
  - `SIGNAL_CONFIG.rescoring.rescoringDays` (90 / 30 / 7)
  - `SIGNAL_CONFIG.autoResearchHotAccounts` (false / true / true)
  - `SIGNAL_CONFIG.autoDiscoverContacts` (false / true / true)
  - `TAVILY_CONFIG.skipIfResearchedWithinDays` (90 / 30 / 7)
  - `TAVILY_CONFIG.maxResearchPerRun` (5 / 10 / 25)
  - `ACCOUNT_STRATEGY_CONFIG.enableAccountStrategy` (false / true / true)
  - `ACCOUNT_STRATEGY_CONFIG.strategyStalenessDays` (90 / 30 / 7)
  - `ACCOUNT_STRATEGY_CONFIG.maxAccountsPerRun` (5 / 10 / 25)
- `.env` → `BUDGET_TIER`

**Cost impact (200 accounts):**
| Tier | Accounts scored/day | Tavily calls/day | Apollo calls/day |
|---|---|---|---|
| Conservative | ~2 | 0 | 0 |
| Balanced | ~7 | ~4 (2 per hot account) | ~2 |
| Aggressive | ~29 | ~14 | ~8 |

**If user says "I don't know":** Default to **balanced**. It's the safest choice — meaningful monitoring without runaway costs. They can upgrade to aggressive later once they see value.
