# Revenue OS — Sales Collaboration Hub

## Deployment Plan: Shared Data Layer + Referral & Intelligence Marketplace

**Status:** Ready to deploy  
**Created:** 2026-04-02  
**Apollo credits deadline:** ~2 days from creation  

---

## Table of Contents

1. [Vision & Strategy](#1-vision--strategy)
2. [Architecture Overview](#2-architecture-overview)
3. [Apollo Data Pull Strategy](#3-apollo-data-pull-strategy)
4. [Collection Schemas](#4-collection-schemas)
5. [Governance Layer](#5-governance-layer)
6. [Deployment Steps](#6-deployment-steps)
7. [User Onboarding Flow](#7-user-onboarding-flow)
8. [Agent Integration Patterns](#8-agent-integration-patterns)
9. [Matching Engine](#9-matching-engine)
10. [Trust & Reputation System](#10-trust--reputation-system)
11. [Open Questions & Risks](#11-open-questions--risks)

---

## 1. Vision & Strategy

### The Problem

Open-source AI prospecting tools ship empty. Users clone the repo, connect their email, and then… need to find prospects manually. The time-to-value is days or weeks.

### The Solution

A **shared Personize organization** pre-loaded with 60k+ AI-enriched contacts and 90k+ companies. Users join the org (free), connect a second API key, and instantly have:

1. **A working prospect database** — semantically searchable, AI-enriched, ready for Revenue OS pipelines
2. **A referral marketplace** — post what you sell, find warm intros from people who already know the account
3. **An intelligence market** — trade account intel with other service providers

### Why It Works

| What They Get | What You Get |
|---|---|
| 60k contacts + 90k companies, pre-embedded | User adoption → community → network effects |
| Warm referral opportunities they'd never find alone | Every user enriches the shared data |
| AI agents that work on day one (not after weeks of data loading) | Distribution channel for Personize |
| Governance playbooks so their first outreach is actually good | Proof that the shared-memory model works at scale |

### Target Users

Service providers who use Revenue OS to prospect for **their own clients**:

| User Type | What They Sell | Dataset They Need |
|---|---|---|
| MSPs / MSSPs | Managed IT, cybersecurity, cloud | SMBs on legacy tech, no IT team |
| Marketing agencies | SEO, PPC, content, social | Growing companies without marketing tools |
| Accounting firms | Bookkeeping, tax, advisory | Funded startups without a finance hire |
| RevOps / CRM consultants | HubSpot/Salesforce implementation | Companies with CRM but no RevOps role |
| Fractional executives | CFO, CMO, CRO services | Companies at the stage where they need leadership but can't hire full-time |
| Recruiting / staffing | Talent acquisition | Companies actively hiring 10+ roles |

### The Network Effect

```
User A (MSP) talks to Acme Corp
  → Learns they need marketing help (not IT)
  → Posts a Referral Offer: "I know the CEO. Will intro for 10%."
  
User B (Marketing Agency) searches for opportunities
  → Agent finds: "Acme Corp — MSP has warm relationship with CEO, will intro"
  → Accepts the referral, pays 10% commission on close

Both make money. The data gets richer. More users join.
```

Cold outreach converts at 1-2%. Warm referrals convert at 15-30%. The network makes everyone's pipeline warmer.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│              SHARED PERSONIZE ORG (your org ID)              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              BASE DATA LAYER (Apollo)                │     │
│  │  ┌────────────┐         ┌────────────┐              │     │
│  │  │  Contact   │         │  Company   │              │     │
│  │  │   60k      │         │   90k      │              │     │
│  │  └────────────┘         └────────────┘              │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │           COLLABORATION OVERLAYS (N:1)               │     │
│  │                                                      │     │
│  │  ┌────────────────┐  ┌────────────────┐             │     │
│  │  │    Referral     │  │    Referral    │             │     │
│  │  │    Request      │  │    Offer       │             │     │
│  │  │                 │  │                │             │     │
│  │  │ "I want to sell │  │ "I know people │             │     │
│  │  │  here. Paying   │  │  here. Will    │             │     │
│  │  │  X% for intros" │  │  intro for X%" │             │     │
│  │  └────────────────┘  └────────────────┘             │     │
│  │                                                      │     │
│  │  ┌────────────────┐                                  │     │
│  │  │    Intel        │                                 │     │
│  │  │    Offer        │                                 │     │
│  │  │                 │                                 │     │
│  │  │ "I have insider │                                 │     │
│  │  │  info. Here's   │                                 │     │
│  │  │  my price."     │                                 │     │
│  │  └────────────────┘                                  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                 GOVERNANCE LAYER                      │     │
│  │  Outreach playbooks │ ICP rules │ Marketplace rules  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Users + AI agents read / write / match / negotiate          │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **`contentId` for overlay collections.** Each referral request, referral offer, and intel offer is its own entity with a unique ID. Multiple users can post separate entries for the same company without overwriting each other.

2. **Company domain as the link.** Every overlay stores `company_domain` to connect back to the base Company record. Agents query across collections by domain.

3. **No partner profiles.** Users don't register — they just start using. Their identity lives in the `requester_email` / `offerer_email` / `provider_email` fields on each record they create.

4. **Agents are first-class participants.** Users' AI agents autonomously detect needs, post offers, find matches, and draft introductions. Humans approve and execute.

---

## 3. Apollo Data Pull Strategy

### Credit Budget

| Resource | Available | Expires |
|---|---|---|
| Contact credits | 60,000 | ~2 days |
| Organization exports | 100,000+ | ~2 days |

### Recommended Data Splits

| Dataset | Target User | Apollo Filters | Orgs | Contacts |
|---|---|---|---|---|
| **Legacy-Tech SMBs** | MSPs | 50-500 employees, no AWS/Azure/GCP in tech stack, industries: manufacturing, healthcare, legal, professional services | 25,000 | 15,000 |
| **Growth Companies, No Marketing** | Marketing agencies | 10-100 employees, no HubSpot/Marketo/Mailchimp/Pardot in tech stack, growing headcount signal | 25,000 | 15,000 |
| **Funded Startups, No Finance** | Accountants, fractional CFOs | Seed to Series B funding, 5-50 employees, no CFO/VP Finance/Controller title in org | 20,000 | 15,000 |
| **CRM Users, No RevOps** | CRM consultants, RevOps agencies | HubSpot or Salesforce in tech stack, no "RevOps" or "Sales Ops" or "Revenue Operations" title, 20-200 employees | 20,000 | 15,000 |
| **Total** | | | **~90,000** | **~60,000** |

### Apollo Export Fields

#### For Organizations
- Company name, domain, industry, sub-industry
- Employee count, annual revenue (estimated)
- Headquarters (city, state, country)
- Funding stage, total funding, last funding date
- Technologies/tech stack
- LinkedIn URL
- Description/keywords

#### For Contacts
- First name, last name, email (verified)
- Title, seniority, department
- Company name, company domain
- LinkedIn URL
- Phone (if available)
- City, state, country

### Export Process

1. **Build 4 saved searches in Apollo** using the filters above
2. **Export organizations first** (CSV) — 4 exports × ~25k each
3. **Export contacts** (CSV) — 4 exports × ~15k each, filtering for decision-maker titles:
   - For MSP dataset: CTO, VP IT, VP Operations, IT Director, Office Manager, CEO (at smaller companies)
   - For Marketing dataset: CEO, Founder, VP Marketing, Head of Growth, CMO, Marketing Director
   - For Finance dataset: CEO, Founder, COO, VP Operations (no CFO — that's the point)
   - For RevOps dataset: VP Sales, Head of Sales, CRO, CEO, Sales Director
4. **Tag each export** with the dataset name for downstream processing

---

## 4. Collection Schemas

### 4.1 Contact Collection (Base Data)

Use the standard Contact schema with these properties loaded from Apollo:

```json
{
  "name": "Contact Properties",
  "slug": "contact_properties",
  "entityType": "Contact",
  "primaryKeyField": "email",
  "identifierColumn": "email",
  "icon": "User",
  "color": "#3B82F6",
  "description": "Individual prospects — decision makers at target companies. Base data loaded from Apollo, enriched over time by community AI agents.",
  "properties": [
    {
      "name": "First Name",
      "systemName": "first_name",
      "type": "text",
      "description": "Contact's first/given name.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Last Name",
      "systemName": "last_name",
      "type": "text",
      "description": "Contact's last/family name.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Full Name",
      "systemName": "full_name",
      "type": "text",
      "description": "Full display name. Concatenated from first + last.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Phone Number",
      "systemName": "phone_number",
      "type": "text",
      "description": "Primary phone. Include country code if available (e.g., '+1-555-123-4567').",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "LinkedIn URL",
      "systemName": "linkedin_url",
      "type": "text",
      "description": "LinkedIn profile URL. Full URL format: 'https://linkedin.com/in/username'.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Company Name",
      "systemName": "company_name",
      "type": "text",
      "description": "Company or organization the contact works for. From Apollo enrichment or AI-extracted from conversations.",
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "identity"]
    },
    {
      "name": "Company Website",
      "systemName": "company_website",
      "type": "text",
      "description": "Website URL of the contact's company. Full URL: 'https://acme.com'.",
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "identity"]
    },
    {
      "name": "Job Title",
      "systemName": "job_title",
      "type": "text",
      "description": "Current job title or role. From Apollo or AI-updated when changes detected.",
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "identity", "qualification"]
    },
    {
      "name": "Seniority Level",
      "systemName": "seniority_level",
      "type": "options",
      "description": "Seniority within their organization. IC = Individual Contributor.",
      "options": ["IC", "Manager", "Director", "VP", "C-Suite", "Founder"],
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "qualification", "queryable"]
    },
    {
      "name": "Department",
      "systemName": "department",
      "type": "text",
      "description": "Department or function. E.g., 'Engineering', 'Marketing', 'Operations', 'Finance'.",
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "identity", "queryable"]
    },
    {
      "name": "Location",
      "systemName": "location",
      "type": "text",
      "description": "Contact's location. Format: 'City, State, Country'.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "geographic"]
    },
    {
      "name": "Dataset Tag",
      "systemName": "dataset_tag",
      "type": "options",
      "description": "Which Apollo dataset this contact was pulled from. Used for filtering and analytics.",
      "options": ["legacy-tech-smbs", "growth-no-marketing", "funded-no-finance", "crm-no-revops", "community-contributed"],
      "autoSystem": false,
      "update": true,
      "tags": ["segmentation", "queryable"]
    },
    {
      "name": "Personas",
      "systemName": "personas",
      "type": "array",
      "description": "Buyer or user personas this contact matches based on role, behavior, and challenges. E.g., 'Technical Evaluator', 'Budget Holder', 'Executive Sponsor'.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "segmentation", "queryable"]
    },
    {
      "name": "Pain Points",
      "systemName": "pain_points",
      "type": "array",
      "description": "Business problems expressed across any interaction. Concise phrases (5-15 words). E.g., 'servers go down weekly', 'no marketing attribution', 'drowning in spreadsheets'.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "qualification", "messaging"]
    },
    {
      "name": "Engagement Summary",
      "systemName": "engagement_summary",
      "type": "text",
      "description": "AI-compiled snapshot of the entire relationship across all interactions from all users in the network. The 'quick brief' for anyone engaging this contact.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "summary"]
    },
    {
      "name": "Lead Status",
      "systemName": "lead_status",
      "type": "options",
      "description": "Current status in the collective network pipeline. New = no prior interaction. Contacted = someone in the network has reached out. Qualified = needs confirmed. Active = ongoing engagement.",
      "options": ["New", "Contacted", "Qualified", "Active", "Not Interested", "Do Not Contact"],
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "pipeline", "queryable"]
    },
    {
      "name": "Contacted By",
      "systemName": "contacted_by",
      "type": "array",
      "description": "Emails of network users who have contacted this person. Prevents duplicate outreach from the same service category. E.g., ['msp@cloudfirst.io', 'agency@growthlab.com'].",
      "autoSystem": false,
      "updateSemantics": "append",
      "tags": ["network", "coordination"]
    },
    {
      "name": "ICP Match Tags",
      "systemName": "icp_match_tags",
      "type": "array",
      "description": "Which service categories this contact is relevant for based on company signals. E.g., ['msp-prospect', 'needs-marketing', 'needs-accounting']. Enables filtered prospecting per vertical.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "matching", "queryable"]
    }
  ]
}
```

### 4.2 Company Collection (Base Data)

```json
{
  "name": "Company Properties",
  "slug": "company_properties",
  "entityType": "Company",
  "primaryKeyField": "website",
  "identifierColumn": "websiteUrl",
  "icon": "Building2",
  "color": "#6366F1",
  "description": "Prospect companies. Base data from Apollo, enriched by community agents. Linked to collaboration overlays (referral requests, offers, intel) via domain.",
  "properties": [
    {
      "name": "Company Name",
      "systemName": "company_name",
      "type": "text",
      "description": "Official registered name. Use formal name, not abbreviations.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Website",
      "systemName": "website",
      "type": "text",
      "description": "Primary website URL. Full URL format: 'https://acme.com'.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Industry",
      "systemName": "industry",
      "type": "text",
      "description": "Primary industry or sector from Apollo. E.g., 'Manufacturing', 'Healthcare Technology', 'Professional Services'.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic"]
    },
    {
      "name": "Sub-Industry",
      "systemName": "sub_industry",
      "type": "text",
      "description": "More specific industry classification. E.g., 'Medical Devices', 'Industrial Automation', 'Legal Services'.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic"]
    },
    {
      "name": "Employee Count",
      "systemName": "employee_count",
      "type": "number",
      "description": "Approximate total headcount from Apollo/LinkedIn.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic", "queryable"]
    },
    {
      "name": "Annual Revenue",
      "systemName": "annual_revenue",
      "type": "number",
      "description": "Estimated annual revenue in USD. Range midpoint for private companies.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic", "queryable"]
    },
    {
      "name": "Headquarters",
      "systemName": "headquarters",
      "type": "text",
      "description": "HQ location. Format: 'City, State, Country'.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic", "geographic"]
    },
    {
      "name": "Funding Stage",
      "systemName": "funding_stage",
      "type": "options",
      "description": "Current funding stage from Apollo/Crunchbase.",
      "options": ["Bootstrapped", "Seed", "Series A", "Series B", "Series C+", "Public", "Unknown"],
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic", "queryable"]
    },
    {
      "name": "Total Funding",
      "systemName": "total_funding",
      "type": "number",
      "description": "Total funding raised in USD.",
      "autoSystem": false,
      "update": true,
      "tags": ["enrichment", "firmographic"]
    },
    {
      "name": "Technology Stack",
      "systemName": "technology_stack",
      "type": "array",
      "description": "Technologies detected from Apollo, job postings, or conversation extraction. E.g., ['Windows Server', 'Exchange', 'QuickBooks', 'HubSpot'].",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["hybrid", "technical"]
    },
    {
      "name": "LinkedIn URL",
      "systemName": "linkedin_url",
      "type": "text",
      "description": "Company LinkedIn page URL.",
      "autoSystem": false,
      "update": true,
      "tags": ["profile", "identity"]
    },
    {
      "name": "Description",
      "systemName": "description",
      "type": "text",
      "description": "Company description from Apollo or AI-compiled from multiple sources.",
      "autoSystem": true,
      "update": true,
      "tags": ["hybrid", "summary"]
    },
    {
      "name": "Dataset Tag",
      "systemName": "dataset_tag",
      "type": "options",
      "description": "Which Apollo dataset this company was pulled from.",
      "options": ["legacy-tech-smbs", "growth-no-marketing", "funded-no-finance", "crm-no-revops", "community-contributed"],
      "autoSystem": false,
      "update": true,
      "tags": ["segmentation", "queryable"]
    },
    {
      "name": "Services Needed",
      "systemName": "services_needed",
      "type": "array",
      "description": "AI-detected: what services this company likely needs based on tech stack gaps, hiring signals, company stage. E.g., ['managed IT', 'marketing agency', 'bookkeeping']. Updated as new signals arrive from any user.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "matching"]
    },
    {
      "name": "Services Currently Using",
      "systemName": "services_currently_using",
      "type": "array",
      "description": "Known service providers this company already uses. Detected from tech stack, conversations, or network reports. E.g., ['has MSP', 'no marketing agency', 'uses QuickBooks but no accountant']. Prevents irrelevant referrals.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "matching"]
    },
    {
      "name": "Key Decision Makers",
      "systemName": "key_decision_makers",
      "type": "array",
      "description": "Names and roles of decision makers discovered by any user in the network. E.g., ['John Smith - CEO', 'Sarah Chen - VP Operations']. AI extracts from conversations and meeting notes.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "qualification"]
    },
    {
      "name": "Buying Signals",
      "systemName": "buying_signals",
      "type": "array",
      "description": "Purchase intent indicators detected from any user's interactions. E.g., ['posted 3 DevOps roles (cloud migration signal)', 'CEO mentioned security concerns after phishing attempt', 'Contract with current vendor expires Q3']. Each entry includes approximate date.",
      "autoSystem": true,
      "updateSemantics": "append",
      "tags": ["ai-extracted", "pipeline"]
    },
    {
      "name": "Company Summary",
      "systemName": "company_summary",
      "type": "text",
      "description": "AI-compiled snapshot from all interactions across all network users. What the company does, current priorities, relationship history, active opportunities, notable patterns. The 'quick brief' for anyone engaging this account.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "summary"]
    },
    {
      "name": "Active Referral Requests",
      "systemName": "active_referral_requests",
      "type": "number",
      "description": "Count of open referral requests for this company. AI-updated. Signals demand — high count = hot account many people want into.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "network", "queryable"]
    },
    {
      "name": "Active Referral Offers",
      "systemName": "active_referral_offers",
      "type": "number",
      "description": "Count of active referral offers for this company. AI-updated. Signals access — high count = multiple people have relationships here.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "network", "queryable"]
    },
    {
      "name": "Intel Available",
      "systemName": "intel_available",
      "type": "boolean",
      "description": "Whether anyone in the network has posted intel offers for this company. Quick filter for accounts with insider information available.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "network", "queryable"]
    }
  ]
}
```

### 4.3 Referral Request Collection (Overlay — N:1 per company)

**Purpose:** "I sell X. I want to reach this account. Here's what I'll pay for an intro."

**Posted by:** Someone who wants to sell into an account but doesn't have a way in.

**Identifier:** `contentId` (unique per request — many requests per company).

```json
{
  "name": "Referral Request",
  "pluralLabel": "Referral Requests",
  "slug": "referral_request",
  "entityType": "Contact",
  "primaryKeyField": "request_id",
  "identifierColumn": "contentId",
  "icon": "MessageSquarePlus",
  "color": "#3B82F6",
  "description": "Individual requests from users who want introductions into a specific account. Many-to-one: multiple users can post separate requests for the same company, each with their own service, commission terms, and lifecycle. Keyed by unique contentId so records never overwrite.",
  "properties": [
    {
      "name": "Request ID",
      "systemName": "request_id",
      "type": "text",
      "description": "Unique identifier. Format: rr-{requester-slug}-{company-slug}-{YYYYMMDD}. E.g., 'rr-growthlab-acme-20260402'. Immutable — this IS the entity.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity"]
    },
    {
      "name": "Company Domain",
      "systemName": "company_domain",
      "type": "text",
      "description": "Target company domain. E.g., 'acme.com'. Used by agents to find all requests for a given company. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "relationship"]
    },
    {
      "name": "Company Name",
      "systemName": "company_name",
      "type": "text",
      "description": "Human-readable company name. Denormalized from Company collection for readability in digests and searches.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Target Contact Email",
      "systemName": "target_contact_email",
      "type": "text",
      "description": "Specific contact the requester wants to reach, if known. Null if seeking any intro at the right level.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity", "targeting"]
    },
    {
      "name": "Requester Email",
      "systemName": "requester_email",
      "type": "text",
      "description": "Email of the person/agent posting this request. Immutable. This is how others contact the requester.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "attribution"]
    },
    {
      "name": "Requester Company",
      "systemName": "requester_company",
      "type": "text",
      "description": "Business name of the requester. E.g., 'GrowthLab Marketing'.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Service to Sell",
      "systemName": "service_to_sell",
      "type": "text",
      "description": "What the requester wants to sell to this account. Be specific. E.g., 'SEO & content marketing retainer — $3-5K/mo range' not just 'marketing'.",
      "autoSystem": false,
      "update": true,
      "tags": ["matching", "commercial"]
    },
    {
      "name": "Service Category",
      "systemName": "service_category",
      "type": "options",
      "description": "Broad category for filtering and matching.",
      "options": [
        "Managed IT / MSP",
        "Cybersecurity",
        "Cloud / Infrastructure",
        "Marketing Agency",
        "SEO / Content",
        "Paid Advertising / PPC",
        "Web / App Development",
        "Accounting / Bookkeeping",
        "Tax Services",
        "CFO / Financial Advisory",
        "CRM / RevOps Consulting",
        "Recruiting / Staffing",
        "HR Consulting",
        "Legal / Compliance",
        "Insurance",
        "Fractional Executive",
        "Business Consulting",
        "Other"
      ],
      "autoSystem": false,
      "update": true,
      "tags": ["matching", "queryable"]
    },
    {
      "name": "Target Titles",
      "systemName": "target_titles",
      "type": "array",
      "description": "Job titles the requester wants to meet. E.g., ['VP Marketing', 'CMO', 'Head of Growth', 'CEO']. Helps the referrer identify who to introduce.",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["targeting", "qualification"]
    },
    {
      "name": "Target Departments",
      "systemName": "target_departments",
      "type": "array",
      "description": "Departments of interest. E.g., ['Marketing', 'Growth', 'Executive']. Broader than titles — useful when exact titles vary.",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["targeting", "qualification"]
    },
    {
      "name": "Why Good Fit",
      "systemName": "why_good_fit",
      "type": "text",
      "description": "Why this account is a fit for the requester's service. AI-enriched from base company data + requester's input. E.g., '150 employees, no marketing automation detected, 3 open marketing roles, $8M Series A — textbook fit for mid-market SEO package.'",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "matching"]
    },
    {
      "name": "Commission Model",
      "systemName": "commission_model",
      "type": "options",
      "description": "How the requester will compensate referrals.",
      "options": ["Percentage of ACV", "Flat Fee", "Revenue Share", "Reciprocal Exchange", "Negotiable"],
      "autoSystem": false,
      "update": true,
      "tags": ["commercial", "queryable"]
    },
    {
      "name": "Commission Offered",
      "systemName": "commission_offered",
      "type": "text",
      "description": "Specific commission terms. E.g., '10% of first-year ACV (~$3,600 typical)', '$500 per qualified introduction', '15% for deals over $50K'. Be explicit.",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial"]
    },
    {
      "name": "Average Deal Value",
      "systemName": "avg_deal_value",
      "type": "number",
      "description": "Typical annual contract value in USD. Helps referrers estimate their commission. E.g., 36000.",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial", "queryable"]
    },
    {
      "name": "Sales Cycle Days",
      "systemName": "sales_cycle_days",
      "type": "number",
      "description": "Typical days from introduction to close. Helps referrers set expectations. E.g., 45.",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial"]
    },
    {
      "name": "Minimum Intro Quality",
      "systemName": "min_intro_quality",
      "type": "text",
      "description": "What counts as a qualified referral. E.g., 'Warm email intro to a director+ in marketing. Must CC me. Not a cold LinkedIn forward. Prospect should be aware they're being introduced.'",
      "autoSystem": false,
      "update": true,
      "tags": ["qualification", "governance"]
    },
    {
      "name": "How to Position",
      "systemName": "how_to_position",
      "type": "text",
      "description": "Instructions for the referrer on how to frame the introduction. E.g., 'Lead with free content audit. Frame as growth partner not agency. Use this hook: we helped a similar company grow 3x organic traffic.'",
      "autoSystem": false,
      "update": true,
      "tags": ["messaging", "playbook"]
    },
    {
      "name": "What Not to Say",
      "systemName": "what_not_to_say",
      "type": "text",
      "description": "Guardrails for the referrer and their AI agent. E.g., 'Don't promise specific rankings. Don't share our rate card. Don't mention we work with their competitor.'",
      "autoSystem": false,
      "update": true,
      "tags": ["governance", "playbook"]
    },
    {
      "name": "Success Metrics",
      "systemName": "success_metrics",
      "type": "text",
      "description": "What success looks like for the requester's service. Social proof for the referrer to use. E.g., '40% organic traffic increase in 6 months. Average client retention: 18 months. 3x ROI within first year.'",
      "autoSystem": false,
      "update": true,
      "tags": ["messaging"]
    },
    {
      "name": "Collateral URL",
      "systemName": "collateral_url",
      "type": "text",
      "description": "Link to case study, one-pager, or landing page the referrer can share with the prospect. Must be public URL.",
      "autoSystem": false,
      "update": true,
      "tags": ["playbook"]
    },
    {
      "name": "Status",
      "systemName": "status",
      "type": "options",
      "description": "Lifecycle status of this request.",
      "options": ["Open", "Matched", "Intro Made", "In Conversation", "Proposal Sent", "Closed Won", "Closed Lost", "Withdrawn", "Expired"],
      "autoSystem": false,
      "update": true,
      "tags": ["pipeline", "queryable"]
    },
    {
      "name": "Matched With",
      "systemName": "matched_with",
      "type": "text",
      "description": "Email of the person who accepted the request and made/will make the intro. Populated when status moves to 'Matched'.",
      "autoSystem": false,
      "update": true,
      "tags": ["network", "attribution"]
    },
    {
      "name": "Outcome Notes",
      "systemName": "outcome_notes",
      "type": "text",
      "description": "What happened with this referral. AI-compiled or manually entered. E.g., 'Intro made 2026-04-05. Had discovery call 04-10. Sent proposal 04-15. Closed $36K annual deal 05-01. Referral fee: $3,600 paid.'",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "audit"]
    },
    {
      "name": "Posted At",
      "systemName": "posted_at",
      "type": "date",
      "description": "When this request was created. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["timeline"]
    },
    {
      "name": "Expires At",
      "systemName": "expires_at",
      "type": "date",
      "description": "When this request auto-expires. Default: 90 days from posted_at. Agents ignore expired requests.",
      "autoSystem": false,
      "update": true,
      "tags": ["timeline", "operational"]
    }
  ]
}
```

### 4.4 Referral Offer Collection (Overlay — N:1 per company)

**Purpose:** "I know people at this account. I'll make intros for X% commission."

**Posted by:** Someone who has existing relationships at an account and is willing to broker introductions.

**Identifier:** `contentId` (unique per offer).

```json
{
  "name": "Referral Offer",
  "pluralLabel": "Referral Offers",
  "slug": "referral_offer",
  "entityType": "Contact",
  "primaryKeyField": "offer_id",
  "identifierColumn": "contentId",
  "icon": "HandHelping",
  "color": "#10B981",
  "description": "Individual offers from users who have relationships at an account and are willing to make introductions. Many-to-one: multiple users can offer access to the same company, each with their own contacts, terms, and track record.",
  "properties": [
    {
      "name": "Offer ID",
      "systemName": "offer_id",
      "type": "text",
      "description": "Unique identifier. Format: ro-{offerer-slug}-{company-slug}-{YYYYMMDD}. E.g., 'ro-cloudfirst-acme-20260401'. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity"]
    },
    {
      "name": "Company Domain",
      "systemName": "company_domain",
      "type": "text",
      "description": "Account domain. E.g., 'acme.com'. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "relationship"]
    },
    {
      "name": "Company Name",
      "systemName": "company_name",
      "type": "text",
      "description": "Human-readable company name.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Offerer Email",
      "systemName": "offerer_email",
      "type": "text",
      "description": "Email of the person offering the referral. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "attribution"]
    },
    {
      "name": "Offerer Company",
      "systemName": "offerer_company",
      "type": "text",
      "description": "Business name. E.g., 'CloudFirst MSP'.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Relationship Context",
      "systemName": "relationship_context",
      "type": "text",
      "description": "How the offerer knows this account and the nature of the relationship. E.g., 'We've been their MSP for 3 years. Direct relationship with CEO and VP Ops. Handle all their IT. Trusted advisor status — they ask us for vendor recommendations regularly.'",
      "autoSystem": false,
      "update": true,
      "tags": ["qualification", "trust"]
    },
    {
      "name": "Relationship Strength",
      "systemName": "relationship_strength",
      "type": "options",
      "description": "Quality of the relationship.",
      "options": ["Trusted Advisor", "Strong", "Warm", "Acquaintance"],
      "autoSystem": false,
      "update": true,
      "tags": ["qualification", "queryable"]
    },
    {
      "name": "Key Contacts Known",
      "systemName": "key_contacts_known",
      "type": "array",
      "description": "People the offerer can introduce. Name + title visible; emails shared only after match. E.g., ['John Smith - CEO', 'Sarah Chen - VP Operations', 'Mike Rivera - IT Manager'].",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["qualification", "targeting"]
    },
    {
      "name": "Departments Accessible",
      "systemName": "departments_accessible",
      "type": "array",
      "description": "Departments the offerer has access to. E.g., ['Executive', 'Operations', 'IT', 'Finance'].",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["qualification", "matching"]
    },
    {
      "name": "Services Can Promote",
      "systemName": "services_can_promote",
      "type": "array",
      "description": "Types of services the offerer is willing to refer INTO this account. NOT their own services — services that others sell. E.g., ['Marketing', 'Accounting', 'Recruiting', 'Software Development'].",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["matching"]
    },
    {
      "name": "Services Not Welcome",
      "systemName": "services_not_welcome",
      "type": "array",
      "description": "Services the offerer will NOT refer. Prevents bad matches. E.g., ['Competing MSPs', 'Insurance (they just renewed)', 'Legal (already has counsel)'].",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["matching", "governance"]
    },
    {
      "name": "Min Commission",
      "systemName": "min_commission",
      "type": "text",
      "description": "Minimum compensation for making an introduction. E.g., '10% of first-year ACV or $500 minimum, whichever is higher'.",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial"]
    },
    {
      "name": "Commission Preferences",
      "systemName": "commission_preferences",
      "type": "text",
      "description": "How the offerer prefers to be compensated. E.g., 'Percentage for recurring services. Flat fee for one-time projects. Open to reciprocal if you serve manufacturing companies in Texas.'",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial"]
    },
    {
      "name": "Intro Process",
      "systemName": "intro_process",
      "type": "text",
      "description": "Step-by-step for how to request an introduction. E.g., '1. Email mike@cloudfirst.io with: who you are, what you sell, why it's relevant to this account. 2. I review within 48 hours. 3. If it's a fit, I make a warm email intro CC'ing both parties.'",
      "autoSystem": false,
      "update": true,
      "tags": ["operational", "playbook"]
    },
    {
      "name": "Conditions",
      "systemName": "conditions",
      "type": "text",
      "description": "Rules for working with this offerer. E.g., 'Don't cold-contact them directly. Go through me. If you reach out without going through me and they mention it, the referral relationship is over. No spam, no aggressive tactics.'",
      "autoSystem": false,
      "update": true,
      "tags": ["governance"]
    },
    {
      "name": "Capacity",
      "systemName": "capacity",
      "type": "options",
      "description": "How many more intros the offerer is willing to make for this account.",
      "options": ["Available", "Limited (1-2 more)", "Full"],
      "autoSystem": false,
      "update": true,
      "tags": ["operational", "queryable"]
    },
    {
      "name": "Referrals Made",
      "systemName": "referrals_made",
      "type": "number",
      "description": "How many introductions actually made from this offer. AI-tracked from outcome data.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "trust"]
    },
    {
      "name": "Referral Close Rate",
      "systemName": "referral_close_rate",
      "type": "number",
      "description": "Percentage of introductions that resulted in closed deals. AI-calculated. E.g., 33 = 33%.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "trust", "queryable"]
    },
    {
      "name": "Status",
      "systemName": "status",
      "type": "options",
      "description": "Whether this offer is active.",
      "options": ["Active", "Paused", "Withdrawn"],
      "autoSystem": false,
      "update": true,
      "tags": ["operational", "queryable"]
    },
    {
      "name": "Posted At",
      "systemName": "posted_at",
      "type": "date",
      "description": "When this offer was created. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["timeline"]
    },
    {
      "name": "Last Refreshed",
      "systemName": "last_refreshed",
      "type": "date",
      "description": "When the offerer last confirmed this info is still accurate. Stale offers (> 90 days) are flagged.",
      "autoSystem": false,
      "update": true,
      "tags": ["timeline", "trust"]
    }
  ]
}
```

### 4.5 Intel Offer Collection (Overlay — N:1 per company)

**Purpose:** "I have insider knowledge about this account. Here's a preview. Here's what I charge."

**Posted by:** Current/former vendors, employees, industry connections — anyone with non-public knowledge.

**Identifier:** `contentId` (unique per offer).

```json
{
  "name": "Intel Offer",
  "pluralLabel": "Intel Offers",
  "slug": "intel_offer",
  "entityType": "Contact",
  "primaryKeyField": "intel_id",
  "identifierColumn": "contentId",
  "icon": "Eye",
  "color": "#F59E0B",
  "description": "Intelligence about an account offered by someone with insider knowledge. Many-to-one: multiple users can offer different intel on the same company (MSP knows tech stack, former employee knows org politics, vendor knows budget cycle). Each is a separate tradeable asset.",
  "properties": [
    {
      "name": "Intel ID",
      "systemName": "intel_id",
      "type": "text",
      "description": "Unique identifier. Format: io-{provider-slug}-{company-slug}-{YYYYMMDD}. E.g., 'io-cloudfirst-acme-20260401'. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity"]
    },
    {
      "name": "Company Domain",
      "systemName": "company_domain",
      "type": "text",
      "description": "Account domain. E.g., 'acme.com'. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "relationship"]
    },
    {
      "name": "Company Name",
      "systemName": "company_name",
      "type": "text",
      "description": "Human-readable company name.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Contact Email",
      "systemName": "contact_email",
      "type": "text",
      "description": "Specific contact this intel is about, if applicable. Null if company-level intel.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity", "relationship"]
    },
    {
      "name": "Provider Email",
      "systemName": "provider_email",
      "type": "text",
      "description": "Email of the person offering intel. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["identity", "attribution"]
    },
    {
      "name": "Provider Company",
      "systemName": "provider_company",
      "type": "text",
      "description": "Business name of the intel provider.",
      "autoSystem": false,
      "update": true,
      "tags": ["identity"]
    },
    {
      "name": "Intel Categories",
      "systemName": "intel_categories",
      "type": "array",
      "description": "Types of intelligence available.",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["matching", "queryable"]
    },
    {
      "name": "Intel Depth",
      "systemName": "intel_depth",
      "type": "options",
      "description": "Quality level. Surface = public info + context. Detailed = insider knowledge from working relationship. Deep = strategic intelligence from trusted advisor position.",
      "options": ["Surface", "Detailed", "Deep"],
      "autoSystem": false,
      "update": true,
      "tags": ["qualification", "queryable"]
    },
    {
      "name": "Freshness",
      "systemName": "freshness",
      "type": "options",
      "description": "How current the intel is.",
      "options": ["Current (< 30 days)", "Recent (1-3 months)", "Aging (3-6 months)", "Historical (6+ months)"],
      "autoSystem": false,
      "update": true,
      "tags": ["qualification", "queryable"]
    },
    {
      "name": "How Acquired",
      "systemName": "how_acquired",
      "type": "options",
      "description": "Source of the intelligence.",
      "options": ["Current Vendor", "Former Vendor", "Current Employee", "Former Employee", "Industry Connection", "Public Research + Analysis", "Partner Network"],
      "autoSystem": false,
      "update": true,
      "tags": ["trust", "queryable"]
    },
    {
      "name": "Intel Preview",
      "systemName": "intel_preview",
      "type": "text",
      "description": "Teaser — enough to show value, not enough to give away the intel. E.g., 'Know their Q4 budget timeline, real decision maker (not who's on LinkedIn), that they're actively evaluating a replacement for their current marketing tool, and what happened with their last agency (it didn't end well).'",
      "autoSystem": false,
      "update": true,
      "tags": ["messaging"]
    },
    {
      "name": "Sample Insight",
      "systemName": "sample_insight",
      "type": "text",
      "description": "One free proof-of-quality insight. Proves the intel is real. E.g., 'Their VP Marketing just left. Interim is the CEO's nephew — he has budget authority but no marketing experience. This completely changes your sales approach.'",
      "autoSystem": false,
      "update": true,
      "tags": ["messaging", "trust"]
    },
    {
      "name": "Topics Available",
      "systemName": "topics_available",
      "type": "array",
      "description": "Specific questions this intel can answer. E.g., ['Who really makes the decision?', 'What's their budget cycle?', 'Which vendors are they evaluating?', 'What happened with their last agency?', 'What does the CEO care about most?']. Helps buyers know if the intel is relevant to their specific sales approach.",
      "autoSystem": false,
      "updateSemantics": "replace",
      "update": true,
      "tags": ["matching"]
    },
    {
      "name": "Fee Model",
      "systemName": "fee_model",
      "type": "options",
      "description": "How the provider charges for intel.",
      "options": ["Free (Community Goodwill)", "Reciprocal Intel Trade", "Flat Fee", "Commission on Close", "Bundled with Referral Offer"],
      "autoSystem": false,
      "update": true,
      "tags": ["commercial", "queryable"]
    },
    {
      "name": "Fee Amount",
      "systemName": "fee_amount",
      "type": "text",
      "description": "Specific pricing. E.g., '$0 (reciprocal trade)', '$200 for full brief', '5% of closed deal', 'Free if you share intel back on manufacturing accounts'.",
      "autoSystem": false,
      "update": true,
      "tags": ["commercial"]
    },
    {
      "name": "Request Process",
      "systemName": "request_process",
      "type": "text",
      "description": "How to purchase or trade for this intel. E.g., 'Email me at mike@cloudfirst.io. Tell me what you're selling and I'll customize the brief for your specific sales angle. Response within 24 hours.'",
      "autoSystem": false,
      "update": true,
      "tags": ["operational"]
    },
    {
      "name": "Restrictions",
      "systemName": "restrictions",
      "type": "text",
      "description": "Rules for using this intel. E.g., 'Don't attribute this to me. Don't mention our vendor relationship to the account. Don't share with other network members without asking.'",
      "autoSystem": false,
      "update": true,
      "tags": ["governance"]
    },
    {
      "name": "Times Requested",
      "systemName": "times_requested",
      "type": "number",
      "description": "How many times someone has requested this intel. AI-tracked. Signals demand and value.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "trust"]
    },
    {
      "name": "Buyer Satisfaction",
      "systemName": "buyer_satisfaction",
      "type": "number",
      "description": "Average rating from intel buyers (1-10). AI-tracked from feedback. Builds trust for future buyers.",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "trust", "queryable"]
    },
    {
      "name": "Verified Against Base",
      "systemName": "verified_against_base",
      "type": "boolean",
      "description": "AI cross-checked the preview/sample against base company data and other signals. True = consistent. False = contradictions found (flagged for review).",
      "autoSystem": true,
      "update": true,
      "tags": ["ai-extracted", "trust"]
    },
    {
      "name": "Status",
      "systemName": "status",
      "type": "options",
      "description": "Whether this intel offer is active.",
      "options": ["Active", "Stale", "Withdrawn"],
      "autoSystem": false,
      "update": true,
      "tags": ["operational", "queryable"]
    },
    {
      "name": "Posted At",
      "systemName": "posted_at",
      "type": "date",
      "description": "When this offer was created. Immutable.",
      "autoSystem": false,
      "update": false,
      "tags": ["timeline"]
    },
    {
      "name": "Last Verified",
      "systemName": "last_verified",
      "type": "date",
      "description": "When the provider last confirmed intel accuracy. Auto-moves to 'Stale' after 90 days without refresh.",
      "autoSystem": false,
      "update": true,
      "tags": ["timeline", "trust"]
    }
  ]
}
```

---

## 5. Governance Layer

### 5.1 Marketplace Rules (Required — Create First)

```
Name: Sales Collaboration Hub — Marketplace Rules
Trigger Keywords: referral, referral request, referral offer, intel, marketplace, commission, introduction, collaborate
Content:

## Core Principles
1. Every referral request and offer is a commitment. Don't post what you won't follow through on.
2. Commission terms are public. Honor them. Disputes damage everyone's trust.
3. Warm intros only. No cold outreach disguised as referrals.
4. Don't contact a company directly if someone has posted conditions requiring you to go through them.

## Referral Request Rules
- Be specific about what you sell and why it's a fit for THIS account (not generic)
- Set realistic commission rates (5-15% of ACV is standard, $250-$1,000 flat is standard)
- Describe minimum intro quality clearly — vague requests get ignored
- Update status when things change. Don't leave stale requests open.
- Requests auto-expire after 90 days. Renew if still interested.

## Referral Offer Rules
- Only offer introductions where you have a genuine relationship
- "Acquaintance" strength = be transparent about it. Don't oversell the warmth.
- Respect your account relationship. Don't over-introduce — max 2-3 referrals per quarter per account.
- If the account tells you to stop, update your offer to "Withdrawn" immediately.
- Keep "last_refreshed" current. Stale offers (> 90 days) get flagged.

## Intel Offer Rules
- The preview must be honest. Don't oversell what you know.
- The sample insight must be real and verifiable. Fake samples destroy trust permanently.
- Respect confidentiality. Don't share anything that violates an NDA or fiduciary duty.
- Mark freshness accurately. "Current" means < 30 days. Don't call 6-month-old intel "current."
- If you learn the intel is wrong, withdraw the offer immediately.

## Commission Payment
- Terms are set by the posting party and visible to all.
- Standard payment: NET 30 after the first invoice is paid (for percentage/revenue share).
- Standard payment: within 30 days of qualified intro confirmation (for flat fees).
- Disputes should be escalated to hub administrators.

## Prohibited Behavior
- No fake referral offers to collect commissions without a real relationship
- No cold outreach to contacts discovered via someone else's referral offer
- No intel fabrication or exaggeration
- No spamming the same company with multiple requests under different identities
- No sharing another member's intel or contact details without permission
```

### 5.2 Outreach Quality Standards (Required)

```
Name: Outreach Quality Standards
Trigger Keywords: email, outreach, cold email, sequence, message, writing, tone
Content:

## Email Quality Rules
- Never start with "I hope this email finds you well"
- Never use fake personalization ("I noticed your company...")  without an actual specific fact
- Never claim a referral or warm introduction that didn't happen
- Subject lines under 60 characters, no ALL CAPS, no exclamation marks
- First sentence must be relevant to the recipient — not about you
- One clear ask per email. Not three.
- Sign off with a real name and real company. No fake personas.

## When Using Referral Context
- If you have a warm intro, MENTION the person who introduced you by name in the first sentence
- Reference specific context: "Sarah mentioned you're looking at upgrading your IT infrastructure"
- Don't over-leverage the relationship. One mention is enough. Don't name-drop 5 times.

## When Using Intel
- Use intel to inform your angle, not to show off what you know
- Don't reveal confidential information in the email ("I heard your VP just left")
- DO use it to be relevant ("Companies going through leadership transitions often find that...")
- Never attribute intel to a source

## Compliance
- Include physical mailing address in email footer (CAN-SPAM)
- Include unsubscribe mechanism
- Don't email personal addresses unless explicitly shared
- Respect "Do Not Contact" status immediately and permanently
```

### 5.3 Vertical ICP Guidelines (One Per Dataset)

Create one guideline per vertical. Example for MSP dataset:

```
Name: ICP — Managed IT / MSP Prospects
Trigger Keywords: MSP, managed IT, managed services, cybersecurity, cloud migration, IT support, IT infrastructure, legacy tech
Content:

## Ideal Customer Profile
- 50-300 employees
- Manufacturing, healthcare, legal, or professional services
- Legacy on-premises infrastructure (Exchange, Windows Server, local file shares)
- No dedicated IT team OR overwhelmed 1-person IT department
- Located in US (for most MSPs — adjust for territory)

## Qualifying Signals (Strongest to Weakest)
1. STRONG: Job postings for IT roles (means they're overwhelmed)
2. STRONG: Recent security incident or compliance audit failure
3. STRONG: No cloud provider detected in tech stack
4. MEDIUM: Running software versions 2+ years old
5. MEDIUM: Contact mentions "our servers" or "our network" in conversation
6. WEAK: Growing headcount without IT scaling
7. WEAK: Industry peers have already migrated to cloud

## Disqualifiers
- Already has a managed IT provider (check services_currently_using)
- In-house IT team of 3+ people
- Government / highly regulated (need specific clearances most MSPs don't have)
- Under 20 employees (typically too small for managed services ROI)

## Messaging Angles
- Lead with RISK, not cost savings. "Your data is one ransomware attack away from gone."
- Free security assessment / IT audit is the strongest offer
- Reference industry-specific compliance (HIPAA for healthcare, CMMC for manufacturing)
- Don't lead with "cloud migration" — too abstract. Lead with the problem it solves.

## Decision Makers
- Primary: CEO or COO (at companies < 100)
- Primary: VP Operations or IT Director (at companies 100-300)
- Influencer: Office Manager (often the person who actually deals with IT pain daily)
```

Create similar guidelines for:
- **ICP — Marketing Agency Prospects** (trigger: marketing, SEO, content, PPC, digital marketing, growth)
- **ICP — Accounting/Finance Prospects** (trigger: accounting, bookkeeping, CFO, finance, tax, financial)
- **ICP — RevOps/CRM Prospects** (trigger: RevOps, CRM, HubSpot, Salesforce, sales operations, revenue operations)

---

## 6. Deployment Steps

### Phase 1: Foundation (Day 1 — URGENT: Before Apollo Credits Expire)

**Step 1.1: Export from Apollo**

```bash
# Four exports — one per vertical
# Save as CSV files in the data/ directory:
# - data/apollo-legacy-tech-smbs-orgs.csv
# - data/apollo-legacy-tech-smbs-contacts.csv
# - data/apollo-growth-no-marketing-orgs.csv
# - data/apollo-growth-no-marketing-contacts.csv
# - data/apollo-funded-no-finance-orgs.csv
# - data/apollo-funded-no-finance-contacts.csv
# - data/apollo-crm-no-revops-orgs.csv
# - data/apollo-crm-no-revops-contacts.csv
```

**Step 1.2: Create Collections via SDK**

```typescript
import { Personize } from '@personize/sdk';
import 'dotenv/config';

const client = new Personize({ secretKey: process.env.PERSONIZE_SECRET_KEY! });

// Verify auth and check limits
const { data: me } = await client.me();
console.log(`Org: ${me!.organization.name}`);
console.log(`Rate limit: ${me!.plan.limits.maxApiCallsPerMinute}/min`);

// Create each collection using the schemas defined in Section 4
// Use client.collections.create() with each schema
// Then verify with client.collections.list()
```

**Step 1.3: Load Apollo Data via memorizeBatch**

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

// Load companies
const companyRows = parse(
  fs.readFileSync('data/apollo-legacy-tech-smbs-orgs.csv', 'utf-8'),
  { columns: true }
);

// Batch memorize companies
await client.memory.memorizeBatch({
  source: 'Apollo Export — Legacy Tech SMBs',
  mapping: {
    entityType: 'company',
    websiteUrl: 'website_url',   // map to your CSV column name
    runName: `apollo-companies-legacy-tech-${Date.now()}`,
    properties: {
      company_name:    { sourceField: 'company_name',     collectionName: 'Company Properties' },
      website:         { sourceField: 'website_url',      collectionName: 'Company Properties' },
      industry:        { sourceField: 'industry',         collectionName: 'Company Properties' },
      employee_count:  { sourceField: 'employee_count',   collectionName: 'Company Properties' },
      annual_revenue:  { sourceField: 'annual_revenue',   collectionName: 'Company Properties' },
      headquarters:    { sourceField: 'headquarters',     collectionName: 'Company Properties' },
      funding_stage:   { sourceField: 'funding_stage',    collectionName: 'Company Properties' },
      total_funding:   { sourceField: 'total_funding',    collectionName: 'Company Properties' },
      linkedin_url:    { sourceField: 'linkedin_url',     collectionName: 'Company Properties' },
      dataset_tag:     { sourceField: '_dataset_tag',     collectionName: 'Company Properties' },
      // Let AI extract tech stack and summary from description
      description:     { 
        sourceField: 'description',
        collectionName: 'Company Properties',
        extractMemories: true 
      },
    },
  },
  rows: companyRows.map(row => ({ ...row, _dataset_tag: 'legacy-tech-smbs' })),
  chunkSize: 1,
});

// Repeat for contacts with similar pattern
// Repeat for all 4 datasets
```

**Step 1.4: Create Governance Guidelines**

```typescript
// Create marketplace rules
await client.guidelines.create({
  name: 'Sales Collaboration Hub — Marketplace Rules',
  description: 'Core rules for the referral and intel marketplace',
  triggerKeywords: ['referral', 'referral request', 'referral offer', 'intel', 
                    'marketplace', 'commission', 'introduction', 'collaborate'],
  content: `... (from Section 5.1) ...`,
});

// Create outreach quality standards
await client.guidelines.create({
  name: 'Outreach Quality Standards',
  description: 'Email and messaging quality rules for all outreach',
  triggerKeywords: ['email', 'outreach', 'cold email', 'sequence', 'message', 'writing', 'tone'],
  content: `... (from Section 5.2) ...`,
});

// Create vertical ICPs (one per dataset)
// ... (from Section 5.3)
```

### Phase 2: Enrichment (Day 2-3)

**Step 2.1: AI Enrichment Pass**

Run a pipeline that visits each company and:
1. Uses `smartDigest()` to assemble current data
2. Runs `prompt()` with instructions to infer `services_needed` and `icp_match_tags`
3. Memorizes the AI-extracted signals back

```typescript
// For each company in the base dataset
const digest = await client.memory.smartDigest({
  website_url: company.domain,
  type: 'Company',
  token_budget: 1500,
});

const result = await client.ai.prompt({
  context: digest.data?.compiledContext || '',
  instructions: [
    { 
      prompt: `Based on this company profile, determine:
      1. What services does this company likely need? (managed IT, marketing, accounting, CRM consulting, recruiting, etc.)
      2. What signals indicate these needs? (tech stack gaps, hiring patterns, company stage, missing roles)
      3. What ICP tags should this company have? (msp-prospect, needs-marketing, needs-accounting, needs-revops, etc.)
      
      Output as JSON: { services_needed: string[], icp_match_tags: string[], reasoning: string }`,
      maxSteps: 3
    }
  ],
  evaluate: true,
});

// Parse and memorize back
await client.memory.memorize({
  content: `[AI-ENRICHMENT] Services needed: ${services_needed.join(', ')}. ${reasoning}`,
  website_url: company.domain,
  enhanced: true,
  tags: ['enrichment', 'ai-extracted', 'services-needed'],
});
```

**Step 2.2: Verify Data Quality**

```typescript
// Spot-check 20 random companies
const sample = await client.memory.search({
  type: 'Company',
  returnRecords: true,
  pageSize: 20,
});

// For each, verify smartDigest returns useful context
for (const [recordId, props] of Object.entries(sample.data?.records || {})) {
  const digest = await client.memory.smartDigest({
    website_url: props.website?.value,
    type: 'Company',
    token_budget: 1000,
  });
  console.log(`${props.company_name?.value}: ${digest.data?.compiledContext?.substring(0, 200)}...`);
}
```

### Phase 3: Revenue OS Integration (Day 3-7)

**Step 3.1: Update Revenue OS Config**

Add the shared org API key as a secondary data source in Revenue OS configuration. Users connect with:
1. Their OWN Personize API key (for their private agent memory, outreach history)
2. The SHARED org API key (for reading prospect data and collaboration overlays)

**Step 3.2: Add Collaboration Commands**

Add commands/scripts to Revenue OS that let users:
- Search the shared dataset: `recall()` across Company and Contact collections
- Post referral requests: `memorize()` to Referral Request collection
- Post referral offers: `memorize()` to Referral Offer collection  
- Post intel offers: `memorize()` to Intel Offer collection
- Find matches: `recall()` across overlay collections
- Update statuses: `memorize()` with updated properties

**Step 3.3: Add Agent Behaviors**

Configure Revenue OS agents to automatically:
1. **On research:** Check if anyone in the network has intel or offers for this account
2. **On disqualification:** If a prospect isn't a fit for your service, check if they match another service category and auto-suggest posting a referral offer
3. **On nightly scan:** Look for new referral requests matching your service category

### Phase 4: Launch (Day 7+)

**Step 4.1: Seed the Marketplace**

Post 10-20 example referral requests and offers yourself so new users see an active marketplace, not an empty one.

**Step 4.2: Update README**

Add a "Sales Collaboration Hub" section to Revenue OS README:
- What the shared org gives you (60k contacts, 90k companies, 4 verticals)
- How to join (request API key for the shared org)
- How to post referral requests/offers/intel
- How agents interact with the marketplace

**Step 4.3: Community Onboarding**

Create a simple onboarding guide:
1. Clone the repo
2. Set up your own Personize org (for private data)
3. Request access to the shared org
4. Connect both API keys
5. Start prospecting — your agent automatically checks the collaboration hub

---

## 7. User Onboarding Flow

```
User clones Revenue OS repo
         │
         ▼
Sets up their own Personize org (private — their outreach history, sequences, etc.)
         │
         ▼
Requests access to shared org (you approve or auto-approve)
         │
         ▼
Adds shared org API key as secondary connection
         │
         ▼
Runs Revenue OS → Agent instantly has 60k+ contacts to work
         │
         ├── Prospects from base data (Contact + Company)
         ├── Checks collaboration overlays on target accounts
         ├── Finds referral offers → requests warm intros
         ├── Detects misfit prospects → posts referral offers for others
         └── Discovers intel → purchases or trades
         │
         ▼
Community grows → data enriches → everyone's pipeline gets warmer
```

---

## 8. Agent Integration Patterns

### 8.1 Full Account View

When an agent targets a company, pull everything:

```typescript
async function getFullAccountView(companyDomain: string) {
  // Base company data
  const companyDigest = await client.memory.smartDigest({
    website_url: companyDomain,
    type: 'Company',
    token_budget: 2000,
  });

  // All referral requests for this company
  const requests = await client.memory.recall({
    query: `referral requests for ${companyDomain}`,
    collectionIds: ['col_referral_request'],
    limit: 20,
  });

  // All referral offers for this company
  const offers = await client.memory.recall({
    query: `referral offers for ${companyDomain}`,
    collectionIds: ['col_referral_offer'],
    limit: 20,
  });

  // All intel offers for this company
  const intel = await client.memory.recall({
    query: `intel offers for ${companyDomain}`,
    collectionIds: ['col_intel_offer'],
    limit: 20,
  });

  return { companyDigest, requests, offers, intel };
}
```

### 8.2 Find Referral Opportunities (Nightly Scan)

```typescript
// Agent finds accounts where someone is offering intros for your service category
async function findReferralOpportunities(myServiceCategory: string) {
  const opportunities = await client.memory.recall({
    query: `referral offers promoting ${myServiceCategory} services, status active, relationship strong or trusted advisor`,
    collectionIds: ['col_referral_offer'],
    limit: 50,
  });

  // Also find requests FROM people wanting to sell complementary services
  // (potential reciprocal referral partners)
  const potentialPartners = await client.memory.recall({
    query: `referral requests for services related to ${myServiceCategory}, status open`,
    collectionIds: ['col_referral_request'],
    limit: 50,
  });

  return { opportunities, potentialPartners };
}
```

### 8.3 Post a Referral Offer After Disqualification

```typescript
// User's agent talked to a prospect. Not a fit for their service, but detected other needs.
async function postReferralOffer(
  companyDomain: string,
  companyName: string,
  offererEmail: string,
  offererCompany: string,
  details: {
    relationshipContext: string;
    contactsKnown: string[];
    departmentsAccessible: string[];
    servicesCanPromote: string[];
    minCommission: string;
  }
) {
  const offerId = `ro-${offererCompany.toLowerCase().replace(/\s+/g, '')}-${companyDomain.replace('.', '')}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;

  await client.memory.memorize({
    content: `[REFERRAL OFFER] ${offererCompany} (${offererEmail}) offers introductions at ${companyName} (${companyDomain}). 
    Relationship: ${details.relationshipContext}. 
    Contacts known: ${details.contactsKnown.join(', ')}. 
    Departments accessible: ${details.departmentsAccessible.join(', ')}.
    Will promote: ${details.servicesCanPromote.join(', ')}. 
    Min commission: ${details.minCommission}.
    Offer ID: ${offerId}. Status: Active. Posted: ${new Date().toISOString()}.`,
    contentId: offerId,
    enhanced: true,
    tags: ['referral-offer', 'active', `company:${companyDomain}`, `offerer:${offererEmail}`],
  });
}
```

### 8.4 Match Referral Requests to Offers

```typescript
// Run periodically to find matches
async function matchRequestsToOffers() {
  // Get all open requests
  const openRequests = await client.memory.recall({
    query: 'referral requests with status Open',
    collectionIds: ['col_referral_request'],
    limit: 100,
  });

  for (const request of openRequests.data?.results || []) {
    const companyDomain = request.properties?.company_domain;
    const serviceCategory = request.properties?.service_category;

    // Find offers for the same company that accept this service category
    const matchingOffers = await client.memory.recall({
      query: `referral offers for ${companyDomain} promoting ${serviceCategory}, status active`,
      collectionIds: ['col_referral_offer'],
      limit: 10,
    });

    if (matchingOffers.data?.results?.length) {
      // Notify both parties (via Slack, email, or in-app notification)
      console.log(`MATCH: Request ${request.properties?.request_id} ↔ Offer ${matchingOffers.data.results[0].properties?.offer_id}`);
    }
  }
}
```

---

## 9. Matching Engine

### How Matching Works

Matching is semantic, not rigid filtering. The agent uses `recall()` across collections:

```
User A posts: "I want to sell SEO to acme.com"
                    │
                    ▼
Agent searches: recall("referral offers for acme.com that promote marketing or SEO")
                    │
                    ▼
Finds: "CloudFirst MSP has been their IT vendor for 3 years. 
        Knows CEO and VP Ops. Will intro for marketing services. 
        Min 10% commission."
                    │
                    ▼
Agent drafts notification: "Match found for your request at Acme Corp.
CloudFirst MSP (Trusted Advisor) will introduce you to the CEO.
Their terms: 10% of first-year ACV. 
Process: Email mike@cloudfirst.io with context."
```

### Match Quality Scoring

Agents should rank matches by:

1. **Relationship strength:** Trusted Advisor > Strong > Warm > Acquaintance
2. **Department match:** Offer covers requested department
3. **Referral track record:** Higher close rate = better match
4. **Freshness:** Recently refreshed offers > stale ones
5. **Commission alignment:** Offer's min commission ≤ Request's offered commission
6. **Capacity:** Available > Limited > Full

---

## 10. Trust & Reputation System

### Trust Signals (Computed by AI)

| Signal | How It's Measured | Where Stored |
|---|---|---|
| Referral close rate | % of intros that result in closed deals | Referral Offer → `referral_close_rate` |
| Referrals made count | Number of actual intros from this offer | Referral Offer → `referrals_made` |
| Intel buyer satisfaction | Average rating from buyers (1-10) | Intel Offer → `buyer_satisfaction` |
| Intel demand | How many times requested | Intel Offer → `times_requested` |
| Intel verification | AI cross-checks against base data | Intel Offer → `verified_against_base` |
| Freshness discipline | How often they refresh their data | Referral Offer → `last_refreshed` |
| Outcome documentation | Whether they update status after referrals close | Referral Request → `outcome_notes` |

### Trust Rules (Enforced by Governance)

- Stale offers (> 90 days without refresh) get flagged in agent results
- Offers with 0% close rate after 5+ referrals get flagged
- Intel with low buyer satisfaction (< 5/10 after 3+ reviews) gets flagged  
- Users who never update referral request status get deprioritized in matching
- New users start with no track record — the first few referrals are their "proof"

---

## 11. Open Questions & Risks

### Design Decisions Still Needed

| Question | Options | Recommendation |
|---|---|---|
| **Who can join the shared org?** | Open (anyone), Approval-required, Invite-only | Start with approval-required. Vet that they're a real service provider. |
| **Can users see who else is in the org?** | Full transparency, Anonymous until match, Admin-only | Anonymous until match — reduce competition anxiety |
| **Commission payment enforcement** | Honor system, Escrow, Platform-mediated | Honor system initially. Track disputes. Build escrow later if needed. |
| **How to handle competing users?** | Two MSPs targeting the same account | First-mover advantage on referral requests. Offers are separate — company can choose. |
| **Data export rights** | Can users export the shared dataset? | No bulk export. Access via API/SDK only. Prevents scraping. |
| **What happens when a user leaves?** | Their offers/requests stay? Get removed? | Status → Withdrawn on all active offers/requests. Base data stays. |

### Risks

| Risk | Mitigation |
|---|---|
| **Data goes stale** | Auto-expire old records. Bounce detection on contacts. Freshness flags. |
| **Free riders** | Track contribution ratios. Users who only take (prospect) but never give (enrich, refer) get deprioritized. |
| **Bad actors posting fake intel** | Verification against base data. Buyer ratings. Manual review for flagged offers. |
| **Commission disputes** | Clear terms upfront (captured in the records). Audit trail via memory. Escalation process. |
| **Two users email the same contact** | `contacted_by` field on Contact records. Agent checks before sending. Governance rule: "check contacted_by first." |
| **Sensitive data leakage** | Governance restricts what can be shared. No NDA-protected info. No personal data beyond business context. |
| **Apollo data accuracy decay** | Community enrichment improves over time. Bounce detection removes bad emails. Users report changes. |

### Future Enhancements (Not for V1)

- **Leaderboard:** Top referrers, top intel providers, most active enrichers
- **Automated matching notifications:** Slack/email when a new offer matches your request
- **Revenue tracking:** Total network revenue generated via referrals
- **Vertical sub-communities:** Separate governance per vertical for specialized playbooks
- **API for external tools:** Let partners query the marketplace from their own CRM
- **Multi-org federation:** Multiple shared orgs (by geography, by vertical) that can cross-reference

---

## Summary: 5 Collections + 4 Governance Guidelines

### Collections

| # | Collection | Identifier | Entity Type | Records |
|---|---|---|---|---|
| 1 | Contact Properties | `email` | Contact | 60k (Apollo) + community |
| 2 | Company Properties | `websiteUrl` | Company | 90k (Apollo) + community |
| 3 | Referral Request | `contentId` | Contact | N per company (user-created) |
| 4 | Referral Offer | `contentId` | Contact | N per company (user-created) |
| 5 | Intel Offer | `contentId` | Contact | N per company (user-created) |

### Governance

| # | Guideline | Purpose |
|---|---|---|
| 1 | Marketplace Rules | Core rules for referrals, commissions, intel trading |
| 2 | Outreach Quality Standards | Email quality, referral context usage, compliance |
| 3 | ICP — MSP Prospects | Qualifying signals for managed IT dataset |
| 4 | ICP — Marketing Prospects | Qualifying signals for marketing dataset |
| 5 | ICP — Finance Prospects | Qualifying signals for accounting/CFO dataset |
| 6 | ICP — RevOps Prospects | Qualifying signals for CRM/RevOps dataset |

### The One-Line Pitch

> **"Clone the repo. Join the org. Get 60k AI-enriched prospects, a referral marketplace with warm intros and insider intel, and a working AI SDR — in 5 minutes, for free."**
