# Enrichment & Signal Intelligence Plan

## Apollo.io + Apify Integration for the AI Prospecting Agent

---

## The Problem Today

The agent currently runs blind. It only knows what HubSpot tells it — names, titles, emails. It has:

- **No enrichment** — doesn't know tech stack, funding, seniority, LinkedIn profiles
- **No live signals** — can't detect new funding rounds, hiring surges, job postings, or news
- **No contact discovery** — can't find decision-makers at hot accounts
- **No HubSpot filtering** — syncs ALL contacts instead of only the ones you've tagged for prospecting

This plan fixes all four.

---

## What Each Tool Does

### Apollo.io — Contact & Company Intelligence

| Capability | API Endpoint | Credits | What You Get |
|---|---|---|---|
| **People Search** | `POST /mixed_people/api_search` | **Free (0 credits)** | Find contacts by company domain + job title. Returns name, title, seniority, LinkedIn URL, company info. Does NOT return email. |
| **People Enrichment** | `POST /people/match` | **1 credit/person** | Given an email, returns full profile: title, seniority, department, LinkedIn, employment history, company details, tech stack, funding stage |
| **Org Enrichment** | `GET /organizations/enrich` | **1 credit/company** | Given a domain, returns industry, headcount, revenue, funding rounds, tech stack, keywords |
| **Bulk People Enrichment** | `POST /people/bulk_match` | **1 credit/person** | Same as above, up to 10 people per request |

**Rate Limits:**

| Plan | Per Minute | Per Hour | Per Day | Credits/Year |
|---|---|---|---|---|
| Free | 50 | 200 | 600 | 100 total |
| Basic ($49/mo) | 200 | 400 | 2,000 | 5,000 |
| Professional ($79/mo) | 200 | 400 | 2,000 | 10,000 |

### Apify — Web Scraping for Live Signals

Apify runs "Actors" (pre-built scrapers) via API. You send input, it scrapes the web, and returns structured data.

| Signal Type | Apify Actor | Actor ID | What You Get |
|---|---|---|---|
| **Company News** | Google News Scraper | `lhotanova/google-news-scraper` | Headlines, descriptions, dates, URLs for any company |
| **Job Postings** | LinkedIn Jobs Scraper | `curious_coder/linkedin-jobs-scraper` | Open roles, departments, locations — hiring surge detection |
| **Tech Stack** | Techstack/Wappalyzer | `scraping_samurai/techstack-wappalyzer-scraper` | Technologies used on any website — CMS, analytics, frameworks |
| **Company Profile** | LinkedIn Company Scraper | `logical_scrapers/linkedin-company-scraper` | Employee count, specialties, HQ, founding year, description |

**How the API works:**

```
POST https://api.apify.com/v2/acts/{ACTOR_ID}/run-sync-get-dataset-items?format=json
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{ ...actor-specific input... }
```

Returns results directly in the response (waits up to 300s). For longer jobs, use async run + poll.

**Pricing:** $49/mo Starter plan includes $49 in compute credits. Most scrapers cost $0.25-2.00 per run depending on result count.

---

## Architecture: How It All Fits Together

```
┌─────────────────────────────────────────────────────────────┐
│                     EXISTING SYSTEM                          │
│                                                              │
│  HubSpot ──sync──> Personize Memory ──AI──> Email Outreach  │
│  (contacts)         (stores everything)     (via Trigger.dev)│
│                                                              │
├─────────────────── NEW ADDITIONS ────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │ HubSpot │    │  Apollo.io   │    │      Apify        │   │
│  │ Filter: │    │              │    │                   │   │
│  │ "Personize│   │ • Enrich     │    │ • Google News     │   │
│  │  - Lead" │   │   contacts   │    │ • LinkedIn Jobs   │   │
│  │  = true  │   │ • Enrich     │    │ • Tech Stack      │   │
│  │         │    │   companies  │    │ • Company Profile  │   │
│  │         │    │ • Find new   │    │                   │   │
│  │         │    │   contacts   │    │                   │   │
│  └────┬────┘    └──────┬───────┘    └────────┬──────────┘   │
│       │                │                      │              │
│       ▼                ▼                      ▼              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Personize Memory                         │   │
│  │  Every piece of data → memorize() → AI extracts      │   │
│  │  properties → available for outreach generation       │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Signal Detection + Scoring                  │   │
│  │  AI reads all signals + enrichment + governance       │   │
│  │  → ICP score + buying window detection                │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Outreach Generation                      │   │
│  │  Now with: tech stack, funding, news, job signals     │   │
│  │  → Much better personalization angles                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## HubSpot Filter: "Personize - Lead" = True

### What Changes

Instead of syncing ALL contacts and companies from HubSpot, the agent will only sync records where your custom property `personize___lead` equals `true`.

**Before:** `getPage(100, after, [...properties])` → syncs everything
**After:** Uses HubSpot Search API with a filter → syncs only tagged records

### HubSpot Custom Property Setup

Before this works, you need the custom property in HubSpot:

1. Go to **HubSpot → Settings → Properties**
2. Click **Create property**
3. For **Contacts**:
   - Label: `Personize - Lead`
   - Internal name: `personize___lead` (HubSpot auto-generates this)
   - Type: **Single checkbox** (Yes/No)
4. Repeat for **Companies** if you also want to filter companies
5. Tag the contacts/companies you want the agent to work with by setting this property to `true`

> **Why this matters:** You control exactly which records the agent touches. Add 10 records to test, then scale up. No risk of the agent emailing your entire CRM.

### Code Impact

The `sync-hubspot.ts` file will switch from `basicApi.getPage()` (which returns all records) to `searchApi.doSearch()` (which supports filters).

```typescript
// NEW: Search with filter instead of getPage
const response = await hubspot.crm.contacts.searchApi.doSearch({
  filterGroups: [
    {
      filters: [
        {
          propertyName: 'personize___lead',
          operator: 'EQ',
          value: 'true',
        },
      ],
    },
  ],
  properties: ['firstname', 'lastname', 'email', 'jobtitle', ...],
  limit: 100,
  after: after || '0',
});
```

---

## New Pipelines

### Pipeline 1: Apollo Contact Enrichment

**File:** `src/pipelines/enrich-apollo.ts`
**Trigger:** Runs after CRM sync — enriches any contact that hasn't been enriched yet
**Flow:**

```
For each contact in Personize memory where enrichment_status != 'enriched':
  1. Call Apollo People Enrichment API (POST /people/match) with their email
  2. If Apollo returns data:
     - memorize() contact enrichment (title, seniority, LinkedIn, department)
     - memorize() company enrichment (industry, headcount, funding, tech stack)
     - Update enrichment_status = 'enriched'
  3. If no match: mark enrichment_status = 'no_match'
  4. Rate limit: 1 request per 500ms (stays under 120/min)
```

**Credits consumed:** 1 per contact. A batch of 100 contacts = 100 credits.

### Pipeline 2: Apollo Contact Discovery

**File:** `src/pipelines/discover-contacts-apollo.ts`
**Trigger:** Runs after signal detection finds hot accounts
**Flow:**

```
For each hot account:
  1. AI plans which roles to target (existing logic in source-contacts.ts)
  2. For each role, call Apollo People Search API (FREE — 0 credits)
     - POST /mixed_people/api_search with domain + person_titles
     - Returns names, titles, LinkedIn URLs (no emails)
  3. For each discovered person with a high-priority role:
     - Call Apollo People Enrichment (1 credit) to get their email
     - memorize() the full contact profile into Personize
  4. Contacts are now ready for outreach generation
```

**Credits consumed:** 0 for search + 1 per contact you want to enrich. Finding 3 contacts at 10 hot accounts = 30 credits.

### Pipeline 3: Apify Signal Scanner

**File:** `src/pipelines/scan-signals-apify.ts`
**Trigger:** Daily scheduled task (runs after CRM sync, before signal detection)
**Flow:**

```
For each company in Personize memory:
  1. Google News scan (Apify: lhotanova/google-news-scraper)
     - Query: "{company_name}" + "funding OR hiring OR launch OR acquisition"
     - Last 14 days, max 10 results
     - memorize() any relevant news as buying signals

  2. Job Posting scan (Apify: curious_coder/linkedin-jobs-scraper)
     - Search: company name + domain
     - Max 20 results
     - Count roles by department → detect hiring surges
     - memorize() hiring signals (especially sales/revenue roles)

  3. Tech Stack scan (Apify: scraping_samurai/techstack-wappalyzer-scraper)
     - Input: company website URL
     - Returns all detected technologies
     - memorize() tech stack → enables "I see you use {tech}" personalization

  4. Classify each signal:
     - STRONG: funding, acquisition, new C-suite hire → score +30
     - MODERATE: hiring surge, product launch, partnership → score +15
     - WEAK: general hiring, tech change → score +5
     - Memorize classified signals with tags for detect-signals.ts to use
```

**Apify costs:** ~$0.50-1.50 per company (3 actors x ~$0.20-0.50 each). 50 companies = ~$25-75/day.

### Pipeline 4: Apollo Company Enrichment

**File:** `src/pipelines/enrich-companies-apollo.ts`
**Trigger:** Runs after CRM sync — enriches companies that haven't been enriched
**Flow:**

```
For each company in Personize memory where not recently enriched:
  1. Call Apollo Org Enrichment API (GET /organizations/enrich) with domain
  2. memorize() company data:
     - Industry, headcount, revenue
     - Total funding, latest funding stage, funding events
     - Technology stack
     - Keywords, LinkedIn URL
  3. Rate limit: 1 request per 500ms
```

**Credits consumed:** 1 per company (uses export credits).

---

## New Trigger Tasks

### Task: `enrich-contacts` (runs after CRM sync)

```
Schedule: Triggered after crm-sync completes (not cron — event-driven)
Flow: crm-sync → enrich-contacts → signal-detection → outreach
```

### Task: `scan-signals` (daily, 7am UTC)

```
Schedule: 0 7 * * 1-5 (7am UTC, Mon-Fri — runs BEFORE signal-detection at 8am)
Flow: scan-signals (Apify) → signal-detection (AI scoring) → outreach
```

### Task: `discover-contacts` (triggered by signal-detection)

```
Schedule: Event-driven — runs when signal-detection finds hot accounts
Flow: signal-detection → discover-contacts (Apollo search + enrich)
```

### Updated Pipeline Order

```
7:00am  │ scan-signals      │ Apify scrapes news, jobs, tech for all companies
8:00am  │ signal-detection   │ AI scores companies using enriched data + signals
        │ → discover-contacts│ Apollo finds + enriches contacts at hot accounts
        │ crm-sync          │ Hourly: pulls tagged HubSpot contacts/companies
        │ → enrich-contacts  │ Apollo enriches any new/un-enriched contacts
10:00am │ outreach-scheduler │ Generates personalized emails with FULL context
2:00pm  │ outreach-scheduler │ Second daily run
4:00pm  │ weekly-report      │ Fridays only
```

---

## New Dependencies

```json
{
  "dependencies": {
    // ... existing ...
    // No new npm packages needed — Apollo and Apify are pure REST APIs
    // We use native fetch() which is available in Node 18+
  }
}
```

No new npm dependencies. Both Apollo.io and Apify are called via `fetch()`.

---

## New Environment Variables

| Variable | Where to Get It | Example |
|---|---|---|
| `APOLLO_API_KEY` | Apollo.io → Settings → Integrations → API Keys | `xxxxxxxxxxxxxxxxxx` |
| `APIFY_API_TOKEN` | Apify Console → Settings → Integrations | `apify_api_xxxxxxxxx` |
| `HUBSPOT_PERSONIZE_LEAD_PROPERTY` | Your custom property internal name | `personize___lead` |

Add to `.env.example` and Trigger.dev dashboard.

---

## New API Key Setup

### Apollo.io API Key

1. Go to [app.apollo.io](https://app.apollo.io)
2. Click **Settings** (gear icon)
3. Go to **Integrations → API Keys**
4. Click **Create new key**
5. Name it `AI Prospecting Agent`
6. Select scopes: **People Search**, **People Enrichment**, **Organization Enrichment**
7. Copy the key — store it securely

> **Plan recommendation:** Start with **Basic ($49/mo)** — gives you 5,000 credits/year (~416/month). Enough for ~400 contact enrichments/month.

### Apify API Token

1. Go to [console.apify.com](https://console.apify.com)
2. Click **Settings → Integrations**
3. Copy your **API Token**

> **Plan recommendation:** Start with **Starter ($49/mo)** — gives you $49 in compute credits. Enough for ~50-100 companies/day of signal scanning.

---

## Files to Create

| File | Type | Description |
|---|---|---|
| `src/lib/apollo.ts` | Library | Apollo.io API wrapper — people search, people enrich, org enrich |
| `src/lib/apify.ts` | Library | Apify API wrapper — run actors, get results, typed responses |
| `src/pipelines/enrich-apollo.ts` | Pipeline | Enrich contacts via Apollo People Enrichment |
| `src/pipelines/enrich-companies-apollo.ts` | Pipeline | Enrich companies via Apollo Org Enrichment |
| `src/pipelines/discover-contacts-apollo.ts` | Pipeline | Find contacts at hot accounts via Apollo People Search |
| `src/pipelines/scan-signals-apify.ts` | Pipeline | Scan for buying signals via Apify (news, jobs, tech) |
| `src/trigger/enrich-contacts.ts` | Trigger Task | Scheduled: enrich new contacts after CRM sync |
| `src/trigger/scan-signals.ts` | Trigger Task | Scheduled: daily Apify signal scan at 7am |
| `src/trigger/discover-contacts.ts` | Trigger Task | Event-driven: find contacts at hot accounts |

## Files to Modify

| File | Change |
|---|---|
| `src/pipelines/sync-hubspot.ts` | Switch to HubSpot Search API with `personize___lead = true` filter |
| `src/pipelines/source-contacts.ts` | Replace TODO block with actual Apollo People Search calls |
| `src/types.ts` | Add Apollo and Apify response types |
| `src/trigger/signal-detection.ts` | Chain `discover-contacts` after scoring |
| `src/trigger/crm-sync.ts` | Chain `enrich-contacts` after sync |
| `.env.example` | Add `APOLLO_API_KEY`, `APIFY_API_TOKEN`, `HUBSPOT_PERSONIZE_LEAD_PROPERTY` |
| `package.json` | No changes needed (pure fetch) |

---

## Cost Estimate (Monthly)

### Small Scale (50 target accounts, ~200 contacts)

| Service | Usage | Monthly Cost |
|---|---|---|
| **Apollo.io** Basic | ~200 contact enrichments + ~150 company enrichments = 350 credits | $49/mo |
| **Apify** Starter | 50 companies × 3 actors × 22 workdays × ~$0.30/run = ~$990 compute | $49/mo (may need to limit to 3x/week) |
| **Personize** | ~2,000 additional API calls (memorize enrichments + signals) | Per plan |
| **Trigger.dev** | Minimal additional compute | Per plan |
| **Total additional** | | **~$100-150/mo** |

### Optimized Apify Usage

To keep Apify costs down:
- **News scan:** Daily for top 20 accounts, weekly for the rest
- **Job scan:** Weekly for all accounts (job postings don't change daily)
- **Tech scan:** Monthly (tech stacks don't change often)
- This reduces to ~$15-25/mo in Apify costs

---

## Implementation Order

### Phase 1: HubSpot Filter (1 file change)
1. Modify `sync-hubspot.ts` to filter by `personize___lead = true`
2. Test: only tagged records sync

### Phase 2: Apollo Libraries + Contact Enrichment (3 new files)
1. Create `src/lib/apollo.ts` — API wrapper
2. Create `src/pipelines/enrich-apollo.ts` — contact enrichment pipeline
3. Create `src/trigger/enrich-contacts.ts` — scheduled after CRM sync
4. Test: contacts get enriched with title, seniority, tech stack

### Phase 3: Apollo Contact Discovery (2 file changes)
1. Create `src/pipelines/discover-contacts-apollo.ts` — search + enrich
2. Wire into `source-contacts.ts` (replace TODO block)
3. Create `src/trigger/discover-contacts.ts`
4. Test: hot accounts get new contacts discovered

### Phase 4: Apify Signal Scanner (3 new files)
1. Create `src/lib/apify.ts` — API wrapper
2. Create `src/pipelines/scan-signals-apify.ts` — news, jobs, tech scanning
3. Create `src/trigger/scan-signals.ts` — daily 7am schedule
4. Test: companies get buying signals from real web data

### Phase 5: Apollo Company Enrichment (1 new file)
1. Create `src/pipelines/enrich-companies-apollo.ts`
2. Wire into the enrichment trigger
3. Test: companies get funding, headcount, tech stack from Apollo

### Phase 6: End-to-End Test
1. Tag 10 contacts in HubSpot as "Personize - Lead" = true
2. Run full pipeline: sync → enrich → scan → detect → discover → generate
3. Review outreach quality — should reference specific tech, funding, news
4. Tune governance variables based on enriched context quality
5. Scale up

---

## What the Agent Knows BEFORE vs. AFTER

### Before (HubSpot only)

```
Contact: John Doe
Title: VP Sales
Company: Acme Corp
Email: john@acme.com
→ Generic outreach: "I see you're in sales at Acme..."
```

### After (HubSpot + Apollo + Apify)

```
Contact: John Doe
Title: VP of Sales & Revenue Operations (Apollo)
Seniority: VP (Apollo)
Department: Sales (Apollo)
LinkedIn: linkedin.com/in/johndoe (Apollo)
Company: Acme Corp
  - 450 employees (Apollo)
  - Series B, raised $35M (Apollo)
  - Uses HubSpot, Salesforce, Outreach.io (Apollo tech stack)
  - Hiring 5 sales roles right now (Apify — LinkedIn Jobs)
  - Just announced partnership with BigCo (Apify — Google News)
  - Website runs React + Next.js + Segment (Apify — Wappalyzer)

→ Personalized outreach:
  "John — saw Acme just closed a $35M Series B and is hiring 5 new
   sales roles. When teams scale that fast with HubSpot + Outreach,
   the data silos between tools usually become the bottleneck.
   That's exactly what we solve. Worth a 15-min look?"
```

---

## Decision Points for You

Before I implement, confirm:

1. **HubSpot custom property name:** Is it `personize___lead` or something different? (Check in HubSpot → Settings → Properties for the internal name)

2. **Apollo plan:** Which plan are you on or will you get? (Determines credit budget)

3. **Apify plan:** Starter ($49/mo) enough to start?

4. **Signal scan frequency:** Daily for all companies, or tiered (daily for top 20, weekly for rest)?

5. **Contact discovery limit:** How many new contacts per hot account? (3? 5? 10?)

6. **Do you want company enrichment too?** (Apollo Org Enrichment — 1 credit per company)
