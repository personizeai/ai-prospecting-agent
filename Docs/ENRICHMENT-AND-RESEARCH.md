# Enrichment & Research Tools

Everything about the data enrichment and web research APIs used by the prospecting agent.

---

## Tools Overview

| Tool | Purpose | Cost | Status |
|------|---------|------|--------|
| **Apollo.io** | Contact & company enrichment, contact discovery | 1 credit/enrichment, search is FREE | Active |
| **Tavily** | Web search for company news, signals, personalization angles | ~$0.01/search | Active |
| **Personize AI** | AI-powered ICP scoring, outreach generation, reply analysis | Per plan | Active |

---

## Apollo.io

### API Endpoints Used

#### 1. People Search (FREE — 0 credits)

- **Endpoint:** `POST https://api.apollo.io/v1/mixed_people/search`
- **Auth:** `X-Api-Key` header
- **Cost:** FREE — no credit deduction
- **Rate limit:** ~1,000 requests/hour
- **Used by:** `src/pipelines/discover-contacts-apollo.ts`

**Parameters:**
```typescript
{
  organization_domains: ['acme.com'],       // Required — target company domain
  person_titles: ['VP Sales', 'CRO'],       // Substring match
  person_seniorities: ['vp', 'director'],   // c_suite | vp | director | manager | senior | entry
  person_departments: ['sales', 'marketing'], // Apollo department slugs
  per_page: 25,                              // 1–100
  page: 1                                    // 1-based pagination
}
```

**Returns:** Array of `ApolloPerson` objects (name, title, email, org data).

#### 2. People Enrichment (1 credit/person)

- **Endpoint:** `POST https://api.apollo.io/v1/people/match`
- **Cost:** 1 Apollo credit per call
- **Rate limit:** ~1,000 requests/hour
- **Used by:** `src/pipelines/enrich-apollo.ts`, `src/pipelines/discover-contacts-apollo.ts`

**Parameters:**
```typescript
{
  email: 'john@acme.com',
  reveal_personal_emails: false
}
```

**Returns:** Full `ApolloPerson` with nested `ApolloOrganization`:
```
Person: id, first_name, last_name, name, title, email, email_status,
        linkedin_url, phone_numbers[], seniority, departments[],
        organization_id
        └─ organization: { full ApolloOrganization object }
```

#### 3. Organization Enrichment (1 credit/company)

- **Endpoint:** `POST https://api.apollo.io/v1/organizations/enrich`
- **Cost:** 1 Apollo credit per call
- **Rate limit:** ~1,000 requests/hour
- **Used by:** `src/pipelines/enrich-companies-apollo.ts`

**Parameters:**
```typescript
{
  domain: 'acme.com'
}
```

**Returns:** Full `ApolloOrganization`:
```
id, name, website_url, primary_domain
estimated_num_employees, annual_revenue, annual_revenue_printed
total_funding, total_funding_printed
latest_funding_round_date, latest_funding_stage
technologies[], industry, keywords[], short_description
city, state, country, founded_year, linkedin_url
```

### Apollo Data Types

```typescript
// src/lib/apollo.ts

interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;       // "verified" | "guessed" | etc.
  linkedin_url: string;
  phone_numbers: Array<{ raw_number: string; type: string }>;
  seniority: string;
  departments: string[];
  organization_id: string;
  organization: ApolloOrganization;
}

interface ApolloOrganization {
  id: string;
  name: string;
  website_url: string;
  primary_domain: string;
  estimated_num_employees: number;
  annual_revenue: number;
  annual_revenue_printed: string;
  total_funding: number;
  total_funding_printed: string;
  latest_funding_round_date: string;
  latest_funding_stage: string;
  technologies: string[];
  industry: string;
  keywords: string[];
  short_description: string;
  city: string;
  state: string;
  country: string;
  founded_year: number;
  linkedin_url: string;
}
```

### Apollo Configuration

```typescript
// src/config/prospecting.config.ts

APOLLO_CONFIG = {
  baseUrl: 'https://api.apollo.io',
  monthlyCreditsbudget: 10_000,
  maxEnrichmentsPerRun: 100,         // Contact enrichment safety cap
  maxCompanyEnrichmentsPerRun: 50,   // Company enrichment safety cap
  rateLimitPauseMs: 1_000,           // Pause between API calls
}

DISCOVERY_CONFIG = {
  contactsPerAccount: 5,
  targetTitles: [
    'VP Sales', 'VP Marketing', 'Head of Growth',
    'Chief Revenue Officer', 'Director of Sales',
    'Director of Marketing', 'Head of Sales',
    'Head of Business Development',
  ],
  targetSeniorities: ['vp', 'director', 'c_suite', 'manager'],
  targetDepartments: ['sales', 'marketing', 'business_development', 'c_suite'],
  minEmployees: 0,       // 0 = no filter
  maxEmployees: 0,       // 0 = no filter
  requireVerifiedEmail: true,
}

ENRICHMENT_CONFIG = {
  skipAlreadyEnriched: true,
  enrichCompanies: true,
  personMemoryTags: ['enrichment', 'apollo'],
  companyMemoryTags: ['enrichment', 'company', 'apollo'],
}
```

### Apollo Credit Budget (10,000/month)

| Operation | Credits | Typical Volume | Monthly Cost |
|-----------|---------|---------------|--------------|
| People Search | FREE | Unlimited | 0 |
| People Enrichment | 1/person | ~500 contacts | 500 |
| Org Enrichment | 1/company | ~100 companies | 100 |
| Contact Discovery | 1/discovered | ~200 contacts | 200 |
| **Total estimated** | | | **~800/month** |

Remaining budget: ~9,200 credits for growth.

### Apollo Files

| File | Purpose |
|------|---------|
| `src/lib/apollo.ts` | API client — `searchPeople()`, `enrichPerson()`, `enrichOrganization()`, `getPhone()` |
| `src/pipelines/enrich-apollo.ts` | Contact enrichment pipeline |
| `src/pipelines/enrich-companies-apollo.ts` | Company enrichment pipeline |
| `src/pipelines/discover-contacts-apollo.ts` | Contact discovery at hot accounts |
| `src/pipelines/ingest-enrichment.ts` | Normalize + memorize enrichment data |

---

## Tavily (Web Research)

### What It Does

Tavily is a search API built for AI agents. It returns clean, structured web results — no HTML parsing needed. We use it to research companies before outreach: recent news, funding announcements, product launches, hiring activity, and competitive landscape.

### API Endpoint

- **Endpoint:** `POST https://api.tavily.com/search`
- **Auth:** API key in request body
- **Cost:** ~$0.01/search (1,000 searches = $10)
- **Rate limit:** 1,000 requests/minute (generous)
- **Used by:** `src/pipelines/research-company.ts`

**Parameters:**
```typescript
{
  api_key: process.env.TAVILY_API_KEY,
  query: 'Acme Corp acme.com recent news funding hiring',
  search_depth: 'basic' | 'advanced',   // basic = faster/cheaper, advanced = deeper
  max_results: 5,                         // 1–20
  include_answer: true,                   // AI-generated summary
  include_raw_content: false,             // Full page HTML (not needed)
  days: 30                                // Recency filter (last N days)
}
```

**Returns:**
```typescript
{
  answer: string;           // AI-generated summary of results
  results: Array<{
    title: string;          // Page title
    url: string;            // Source URL
    content: string;        // Relevant snippet (cleaned text)
    score: number;          // Relevance score (0–1)
    published_date?: string; // ISO date if available
  }>;
  query: string;
}
```

### Tavily Configuration

```typescript
// src/config/prospecting.config.ts

TAVILY_CONFIG = {
  maxResultsPerSearch: 5,          // Results per query
  searchDepth: 'basic' as const,   // 'basic' or 'advanced'
  maxSearchesPerCompany: 2,        // Queries per company research
  recencyDays: 30,                 // Only results from last N days
  maxResearchPerRun: 20,           // Companies per research batch
  skipIfResearchedWithinDays: 7,   // Dedup — skip recently researched
  rateLimitPauseMs: 500,           // Pause between searches
}
```

### Tavily Data Types

```typescript
// src/types.ts

interface WebResearchResult {
  domain: string;
  company_name: string;
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
  ai_summary: string;
  researched_at: string;
  source: 'tavily';
}
```

### Research Pipeline Flow

```
researchCompany(domain, companyName)
  │
  ├─ Check if already researched within skipIfResearchedWithinDays (dedup)
  │
  ├─ Search 1: "{company_name} {domain} news funding hiring"
  │   └─ Tavily returns structured results with snippets
  │
  ├─ Search 2: "{company_name} product launch partnership expansion"
  │   └─ Additional angle-finding results
  │
  ├─ Memorize raw results → web-research collection
  │   └─ Tags: web-research, tavily, {domain}
  │
  ├─ AI Analysis (Personize prompt):
  │   ├─ COMPANY_SUMMARY — what they do, recent activity
  │   ├─ KEY_NEWS — top 3 recent items with dates
  │   ├─ BUYING_SIGNALS — funding, hiring, expansion indicators
  │   ├─ COMPETITIVE_LANDSCAPE — competitors/tools mentioned
  │   └─ PERSONALIZATION_ANGLES — hooks for outreach emails
  │
  └─ Memorize analysis → companies collection
      └─ Updates: company_summary, buying_signals properties
```

### What Tavily Data Powers

| Downstream Consumer | How It Uses Research |
|---------------------|---------------------|
| **Signal Detection** | Buying signals from news (funding, hiring surges, expansion) |
| **Outreach Generation** | Personalization angles — reference recent news, product launches |
| **ICP Scoring** | Market activity indicators improve scoring accuracy |
| **Weekly Report** | Hot prospects section references recent company activity |

### Tavily Files

| File | Purpose |
|------|---------|
| `src/lib/tavily.ts` | API client — `searchTavily()`, `isTavilyConfigured()` |
| `src/pipelines/research-company.ts` | Research pipeline — search + analyze + memorize |

### Cost Estimate

| Scenario | Searches | Monthly Cost |
|----------|----------|-------------|
| 20 hot accounts/day × 2 searches each | ~800/month | ~$8 |
| 50 hot accounts/day × 2 searches each | ~2,000/month | ~$20 |
| Signal detection + outreach research | ~1,500/month | ~$15 |

---

## HubSpot Engagement History

### What It Does

Beyond basic contact/company fields, the CRM sync pulls the full engagement history for each contact — notes, emails, meetings, calls, tasks, and deals. This gives the AI context about past conversations and existing relationships, so outreach emails can reference real interactions instead of being generic.

### Engagement Types Synced

| Type | HubSpot Properties Fetched | Content Truncation | Notes |
|------|---------------------------|-------------------|-------|
| **Notes** | `hs_note_body`, `hs_timestamp`, `hubspot_owner_id` | 2,000 chars | HTML stripped from note body |
| **Emails** | `hs_email_subject`, `hs_email_text`, `hs_email_html`, `hs_email_direction`, `hs_email_status`, `hs_email_from_email`, `hs_email_to_email`, `hs_timestamp` | 2,000 chars | Prefers plain text; falls back to stripped HTML when `hs_email_text` is null. Skips `hs_email_headers` (redundant). |
| **Meetings** | `hs_meeting_title`, `hs_meeting_body`, `hs_internal_meeting_notes`, `hs_meeting_start_time`, `hs_meeting_end_time`, `hs_meeting_outcome`, `hs_meeting_location` | Body 1,500 + Notes 2,000 chars | Internal notes are highest value — rep's private notes not shared with attendees |
| **Calls** | `hs_call_title`, `hs_call_body`, `hs_call_direction`, `hs_call_duration`, `hs_call_status`, `hs_call_disposition`, `hs_timestamp` | 2,000 chars | Shows Inbound/Outbound direction. Skips phone numbers (PII). |
| **Tasks** | `hs_task_subject`, `hs_task_body`, `hs_task_status`, `hs_task_priority`, `hs_task_type`, `hs_timestamp` | 1,000 chars | Task type shows EMAIL/CALL/TODO classification |
| **Deals** | `dealname`, `amount`, `dealstage`, `pipeline`, `closedate`, `description`, `deal_currency_code`, `hs_is_closed_won`, `hs_is_closed_lost`, `closed_won_reason`, `closed_lost_reason` | 1,000 chars | Shows WON/LOST status and win/loss reasons |

**Properties intentionally skipped** (to avoid token bloat):
- `hs_email_html` only used as fallback when `hs_email_text` is null — stripped of HTML tags before memorizing
- `hs_email_headers` — raw JSON headers, redundant with `hs_email_from_email`/`hs_email_to_email`
- `hs_attachment_ids` — file IDs require separate API calls to fetch content
- `hs_call_from_number`, `hs_call_to_number` — PII with no contextual value for AI
- `hs_analytics_*`, `hs_forecast_*` — internal HubSpot analytics/forecasting metadata

### How It Works

```
For each synced contact with a CRM ID:
  │
  ├─ For each engagement type (notes, emails, meetings, calls, tasks):
  │   ├─ HubSpot associationsApi.getAll(contactId, type)
  │   ├─ Batch read engagement details (up to maxEngagementsPerType=10)
  │   ├─ Filter by recency window (engagementRecencyDays=90)
  │   ├─ Format into tagged text (e.g., [CRM EMAIL SENT — 2026-03-01])
  │   └─ memorizeBatch() → contacts collection
  │       └─ Tags: crm, hubspot, engagement:{type}
  │
  └─ IF syncDeals = true:
      ├─ Fetch associated deals (up to 10)
      ├─ Batch read deal details
      └─ memorizeBatch() → contacts collection
          └─ Tags: crm, hubspot, deal
```

### Data Size Controls

| Control | Default | Purpose |
|---------|---------|---------|
| `engagementRecencyDays` | 90 | Only sync last 90 days (0 = all time) |
| `maxEngagementsPerType` | 10 | Cap per engagement type per contact |
| Content truncation | Varies by type | Meetings 3000, emails/notes 2000, tasks 1000 chars |
| `smartDigest()` token_budget | 2000 tokens | Compiles all memories into bounded AI context |

Even a contact with 50+ engagement records will produce manageable context via `smartDigest()`.

### Configuration

```typescript
// src/config/prospecting.config.ts → HUBSPOT_CONFIG

syncEngagements: true,
engagementTypes: ['notes', 'emails', 'meetings', 'calls', 'tasks'],
syncDeals: true,
maxEngagementsPerType: 10,
engagementRecencyDays: 90,
```

### Files

| File | Purpose |
|------|---------|
| `src/pipelines/sync-hubspot.ts` | `syncContactEngagements()`, `syncEngagementHistory()`, `formatEngagement()` |

### Cost

No additional API cost — uses the same HubSpot CRM API included in any HubSpot plan. The engagement sync adds ~6 API calls per contact per sync (1 association lookup + 1 batch read per engagement type).

---

## Personize AI (Intelligence Layer)

### Used For

Personize AI is not an enrichment API — it's the intelligence layer that processes enrichment data. Every pipeline uses it.

| Method | Purpose | Used By |
|--------|---------|---------|
| `memory.memorize()` | Store enrichment + research data | All enrichment pipelines |
| `memory.smartDigest()` | Compile entity context for AI | Signal detection, outreach generation |
| `memory.recall()` | Semantic search across memory | Outreach generation, reply analysis |
| `ai.smartGuidelines()` | Fetch governance rules | Signal detection, outreach, reply analysis |
| `ai.prompt()` | AI generation with multi-step instructions | Outreach generation, signal scoring, reply analysis, research analysis |

### How Enrichment Data Flows Into Personize

```
Apollo enrichment
  └─ memorize() with tags: ['enrichment', 'apollo']
      └─ Content: "[ENRICHMENT from Apollo]\nTitle: VP Sales\nCompany: Acme..."
      └─ Properties: { employee_count, annual_revenue, industry }

Tavily research
  └─ memorize() with tags: ['web-research', 'tavily']
      └─ Content: "[WEB RESEARCH]\nSummary: Acme recently raised $50M..."
      └─ Collection: web-research (raw results)
      └─ Also: companies collection (AI analysis)

Signal detection
  └─ memorize() with tags: ['assessment', 'signal-detection']
      └─ Content: "[SIGNAL ASSESSMENT] ICP: 85, Signals: Strong..."
```

### How Enrichment Data Is Consumed

```
assembleContext(email) — called before every outreach email
  │
  ├─ smartGuidelines('ICP, brand voice, outreach playbook')
  │   └─ Returns: tone rules, competitor policy, CTA guidelines
  │
  ├─ smartDigest(email, type: 'Contact')
  │   └─ Returns compiled context: enrichment data + workspace state
  │   └─ Includes: Apollo enrichment, web research findings, engagement history
  │
  ├─ recall(company context)
  │   └─ Returns: company enrichment, buying signals, tech stack
  │
  └─ recall(previous outreach)
      └─ Returns: past emails sent, angles used (dedup)
```

---

## Data Storage: Personize Collections

### Contacts Collection
Stores all contact-level enrichment and workspace data.

**Enrichment-relevant properties:**
- `first_name`, `last_name`, `email`, `phone_number`, `linkedin_url`
- `company_name`, `company_website`, `job_title`
- `seniority_level` (IC, Manager, Director, VP, C-Suite, Founder)
- `department` (Engineering, Sales, Marketing, Product, etc.)
- `source` (HubSpot, Apollo, LinkedIn, etc.)

### Companies Collection
Stores all company-level enrichment data.

**Enrichment-relevant properties:**
- `company_name`, `website`, `industry`, `headquarters`
- `employee_count`, `annual_revenue`
- `funding_stage`, `latest_funding_amount`, `latest_funding_date`
- `technology_stack` (array — from Apollo)
- `buying_signals` (array — from Tavily research + signal detection)
- `signal_strength` (None, Weak, Moderate, Strong, Very Strong)
- `hiring_velocity` (Stable, Moderate Growth, Rapid Growth, Contracting)
- `company_summary` (AI-generated from research + enrichment)

### Web Research Collection
Stores raw Tavily search results for auditing and re-analysis.

**Properties:**
- `domain` — company domain researched
- `company_name` — company name
- `search_queries` (array) — queries used
- `result_count` — number of results returned
- `top_result_url` — highest-scoring result URL
- `ai_summary` — AI-generated research summary
- `research_date` — when the research was performed
- `source` — always "tavily"
- `signals_found` (array) — buying signals extracted
- `personalization_angles` (array) — outreach angles found

### Outreach Log Collection
Tracks every outreach touch.

**Properties:** `contact_email`, `company`, `sequence_step`, `channel`, `subject_line`, `content_summary`, `angle_used`, `sent_at`, `opened`, `clicked`, `replied`, `reply_sentiment`, `outcome`

---

## Enrichment Deduplication

All enrichment pipelines check for existing data before making API calls:

| Pipeline | Dedup Check | Tag/Memory Checked |
|----------|-------------|-------------------|
| Contact Enrichment | `[ENRICHMENT from Apollo]` in memory | `enrichment` tag |
| Company Enrichment | `[ENRICHMENT from Apollo]` in memory | `enrichment`, `company` tags |
| Contact Discovery | Existing contacts at domain | Email match in memory |
| Web Research | `[WEB RESEARCH]` within last N days | `web-research` tag + date check |

---

## Environment Variables

```bash
# Apollo.io
APOLLO_API_KEY=            # From: Apollo → Settings → Integrations → API Keys

# Tavily
TAVILY_API_KEY=            # From: https://tavily.com → Dashboard → API Keys
```

---

## Adding a New Enrichment Source

To add a new enrichment provider (e.g., ZoomInfo, Clearbit):

1. **Create API client** in `src/lib/{provider}.ts` — wrapper with types
2. **Create pipeline** in `src/pipelines/enrich-{provider}.ts` — fetch + memorize loop
3. **Add config** in `src/config/prospecting.config.ts` — rate limits, caps
4. **Add types** in `src/types.ts` — response interfaces
5. **Wire trigger** in `src/trigger/enrich-contacts.ts` — chain after existing enrichment
6. **Add env var** in `.env.example`
7. **Add tests** in `src/__tests__/`

The pattern is always the same: fetch → normalize → memorize → tag.
