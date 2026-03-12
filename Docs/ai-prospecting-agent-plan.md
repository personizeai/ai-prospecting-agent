# AI Prospecting Agent — Implementation Plan

> A full end-to-end outbound prospecting agent powered by Personize.
> Monitors companies, detects buying signals, sources contacts, writes personalized outreach, and enrolls them in sequences — while your reps sleep.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Schema Design](#2-schema-design)
3. [Governance Setup](#3-governance-setup)
4. [Phase 1 — Data Ingestion](#4-phase-1--data-ingestion)
5. [Phase 2 — Signal Detection & Scoring](#5-phase-2--signal-detection--scoring)
6. [Phase 3 — Contact Sourcing & Enrichment](#6-phase-3--contact-sourcing--enrichment)
7. [Phase 4 — Outreach Generation](#7-phase-4--outreach-generation)
8. [Phase 5 — Sequence Enrollment & Delivery](#8-phase-5--sequence-enrollment--delivery)
9. [Phase 6 — Feedback Loop & Optimization](#9-phase-6--feedback-loop--optimization)
10. [Wiring & Integration Patterns](#10-wiring--integration-patterns)
11. [Autopilot Deployment with Trigger.dev](#11-autopilot-deployment-with-triggerdev) **(no servers needed)**
12. [Rate Limits & Cost Planning](#12-rate-limits--cost-planning)
13. [Implementation Timeline](#13-implementation-timeline)

---

## 1. Architecture Overview

The agent follows Personize's **10-step agentic loop**, running continuously:

```
OBSERVE → REMEMBER → RECALL → REASON → PLAN → DECIDE → GENERATE → ACT → UPDATE → REPEAT
```

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES (OBSERVE)                       │
│                                                                     │
│  HubSpot CRM ────┐                                                 │
│  Salesforce CRM ──┤                                                 │
│  Apollo/ZoomInfo ─┼── memorizeBatch() ──► PERSONIZE UNIFIED MEMORY  │
│  Surfe ───────────┤                           │                     │
│  LinkedIn ────────┘                           │                     │
│                                               │                     │
│  Intent Data ─────┐                           │                     │
│  (Bombora/G2/     │                           │                     │
│   6sense)         ├── memorize() ─────────────┘                     │
│  News/Funding ────┤   (with extractMemories)                        │
│  Job Postings ────┘                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                     INTELLIGENCE LAYER (RECALL + REASON)            │
│                                                                     │
│  smartGuidelines() ──► ICP rules, brand voice, playbooks            │
│  smartDigest()     ──► Full company + contact context                │
│  recall()          ──► Semantic search for signals + history         │
│  prompt()          ──► Multi-step reasoning + scoring + generation   │
├─────────────────────────────────────────────────────────────────────┤
│                     OUTPUT LAYER (GENERATE + ACT)                   │
│                                                                     │
│  Personalized Emails ──► HubSpot Sequences / SendGrid               │
│  Call Task Scripts   ──► HubSpot Tasks / Salesforce Activities       │
│  Slack Alerts        ──► Rep notifications for high-priority targets │
│  CRM Updates         ──► Lead status, scores, notes via API         │
├─────────────────────────────────────────────────────────────────────┤
│                     FEEDBACK (UPDATE)                                │
│                                                                     │
│  memorize() ◄── What was sent, open/click/reply data, outcomes      │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Dependencies

```bash
npm install @personize/sdk @trigger.dev/sdk dotenv
# Optional delivery integrations:
npm install @sendgrid/mail @slack/web-api @hubspot/api-client jsforce
```

### Project Setup

```typescript
// src/config.ts
import { Personize } from '@personize/sdk';
import 'dotenv/config';

export const client = new Personize({
  secretKey: process.env.PERSONIZE_SECRET_KEY!,
});

// Verify auth + read plan limits on startup
export async function verifySetup() {
  const me = await client.me();
  console.log(`Org: ${me.data?.organization}`);
  console.log(`Rate limit: ${me.data?.plan?.limits?.maxApiCallsPerMinute}/min`);
  console.log(`Monthly limit: ${me.data?.plan?.limits?.maxApiCallsPerMonth}/mo`);
  return me.data;
}
```

---

## 2. Schema Design

Three collections power the prospecting agent. Create these in the Personize web app or via SDK.

### Collection: Contacts

> People you're prospecting, enriched from CRM + Apollo + conversations.

| Property | systemName | Type | Auto | Update | Description |
|---|---|---|---|---|---|
| First Name | `first_name` | text | false | replace | Contact's first name |
| Last Name | `last_name` | text | false | replace | Contact's last name |
| Email | `email` | text | false | replace | Primary email address |
| Phone | `phone_number` | text | false | replace | Direct phone number |
| LinkedIn URL | `linkedin_url` | text | false | replace | LinkedIn profile URL |
| Company Name | `company_name` | text | true | replace | Current employer |
| Company Website | `company_website` | text | true | replace | Company domain |
| Job Title | `job_title` | text | true | replace | Current role/title |
| Seniority Level | `seniority_level` | options | true | replace | IC, Manager, Director, VP, C-Suite, Founder |
| Department | `department` | options | true | replace | Engineering, Sales, Marketing, Product, Finance, HR, Operations, Executive |
| Decision Maker | `decision_maker` | boolean | true | replace | Whether this person can approve purchases |
| ICP Match | `icp_match` | boolean | true | replace | Whether this contact matches our ideal customer profile |
| Lead Status | `lead_status` | options | true | replace | New, Researching, Qualified, Contacted, Engaged, Meeting Set, Opportunity, Customer, Disqualified |
| Lead Score | `lead_score` | number | true | replace | 0-100 score based on ICP fit + engagement + signals |
| Pain Points | `pain_points` | array | true | append | Specific challenges, frustrations, or needs mentioned or inferred |
| Interests & Topics | `interests_topics` | array | true | append | Professional interests, topics they engage with |
| Communication Style | `communication_style` | text | true | replace | Preferred tone: direct/consultative/technical/casual |
| Sentiment | `sentiment` | options | true | replace | Positive, Neutral, Skeptical, Frustrated |
| Responsive | `responsive` | boolean | true | replace | Whether they've responded to any outreach |
| Competitors Mentioned | `competitors_mentioned` | array | true | append | Competitor products/services this contact has referenced |
| Outreach Stage | `outreach_stage` | options | true | replace | Not Started, Email 1 Sent, Email 2 Sent, Email 3 Sent, Replied, Meeting Booked, Opted Out |
| Last Contacted | `last_contacted` | date | true | replace | Date of most recent outreach attempt |
| Source | `source` | options | false | replace | HubSpot, Salesforce, Apollo, ZoomInfo, Surfe, LinkedIn, Inbound, Referral |
| CRM ID | `crm_id` | text | false | replace | HubSpot or Salesforce record ID for writeback |

### Collection: Companies

> Target accounts with firmographics, signals, and health tracking.

| Property | systemName | Type | Auto | Update | Description |
|---|---|---|---|---|---|
| Company Name | `company_name` | text | false | replace | Legal or common company name |
| Website | `website` | text | false | replace | Primary domain |
| Industry | `industry` | text | true | replace | Primary industry vertical |
| Employee Count | `employee_count` | number | false | replace | Total headcount |
| Annual Revenue | `annual_revenue` | number | false | replace | Estimated annual revenue in USD |
| Headquarters | `headquarters` | text | false | replace | City, State/Country of HQ |
| Funding Stage | `funding_stage` | options | true | replace | Bootstrapped, Seed, Series A, Series B, Series C+, Public |
| Latest Funding Amount | `latest_funding_amount` | number | true | replace | Most recent funding round amount in USD |
| Latest Funding Date | `latest_funding_date` | date | true | replace | Date of most recent funding round |
| Technology Stack | `technology_stack` | array | true | append | Technologies, tools, and platforms the company uses |
| Business Model | `business_model` | options | true | replace | B2B, B2C, B2B2C, Marketplace, Platform |
| ICP Fit Score | `icp_fit_score` | number | true | replace | 0-100 score of how well this company matches your ICP |
| Buying Signals | `buying_signals` | array | true | append | Observed signals: hiring surges, new funding, tech adoption, job postings, expansion |
| Signal Strength | `signal_strength` | options | true | replace | None, Weak, Moderate, Strong, Very Strong |
| Key Decision Makers | `key_decision_makers` | array | true | append | Names and titles of known decision makers |
| Competitors Using | `competitors_using` | array | true | append | Competitor products this company currently uses |
| Company Summary | `company_summary` | text | true | replace | AI-generated summary of what the company does, recent activity, and relevance |
| Account Status | `account_status` | options | true | replace | New Target, Researching, Prospecting, Engaged, Opportunity, Customer, Churned, Disqualified |
| Hiring Velocity | `hiring_velocity` | options | true | replace | Stable, Moderate Growth, Rapid Growth, Contracting |
| CRM Account ID | `crm_account_id` | text | false | replace | HubSpot or Salesforce account ID for writeback |

### Collection: Outreach Log

> Track every outreach touch for feedback loop and sequence management.

| Property | systemName | Type | Auto | Update | Description |
|---|---|---|---|---|---|
| Contact Email | `contact_email` | text | false | replace | Email of the recipient |
| Company | `company` | text | true | replace | Recipient's company |
| Sequence Step | `sequence_step` | options | false | replace | Email 1, Email 2, Email 3, Call Task, LinkedIn Touch |
| Channel | `channel` | options | false | replace | Email, Phone, LinkedIn, SMS |
| Subject Line | `subject_line` | text | false | replace | Email subject used |
| Content Summary | `content_summary` | text | true | replace | Brief summary of what was sent |
| Angle Used | `angle_used` | text | true | replace | The personalization angle/hook used |
| Sent At | `sent_at` | date | false | replace | Timestamp of delivery |
| Opened | `opened` | boolean | false | replace | Whether the email was opened |
| Clicked | `clicked` | boolean | false | replace | Whether any link was clicked |
| Replied | `replied` | boolean | false | replace | Whether the recipient replied |
| Reply Sentiment | `reply_sentiment` | options | true | replace | Positive, Neutral, Negative, Out of Office, Unsubscribe |
| Outcome | `outcome` | options | true | replace | No Response, Opened, Clicked, Replied, Meeting Booked, Rejected, Bounced |

### Create Collections via SDK

```typescript
// src/setup/create-schemas.ts
import { client } from '../config';

async function createSchemas() {
  // List existing to avoid duplicates
  const existing = await client.collections.list();
  const existingSlugs = existing.data?.map((c: any) => c.slug) || [];

  if (!existingSlugs.includes('contacts')) {
    await client.collections.create({
      name: 'Contacts',
      slug: 'contacts',
      description: 'Prospecting contacts from CRM, enrichment tools, and inbound',
      icon: 'user',
      color: '#3B82F6',
      primaryKeyField: 'email',
      properties: [
        { propertyName: 'First Name', systemName: 'first_name', type: 'text', autoSystem: false, description: "Contact's first name" },
        { propertyName: 'Last Name', systemName: 'last_name', type: 'text', autoSystem: false, description: "Contact's last name" },
        { propertyName: 'Job Title', systemName: 'job_title', type: 'text', autoSystem: true, description: 'Current role/title at their company' },
        { propertyName: 'Seniority Level', systemName: 'seniority_level', type: 'options', autoSystem: true, options: ['IC', 'Manager', 'Director', 'VP', 'C-Suite', 'Founder'], description: 'Level in org hierarchy' },
        { propertyName: 'Decision Maker', systemName: 'decision_maker', type: 'boolean', autoSystem: true, description: 'Whether this person can approve purchases' },
        { propertyName: 'ICP Match', systemName: 'icp_match', type: 'boolean', autoSystem: true, description: 'Whether this contact matches our ideal customer profile' },
        { propertyName: 'Lead Score', systemName: 'lead_score', type: 'number', autoSystem: true, description: '0-100 composite score based on ICP fit, engagement signals, and buying intent' },
        { propertyName: 'Pain Points', systemName: 'pain_points', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Specific challenges, frustrations, or needs mentioned or inferred from conversations and activity' },
        { propertyName: 'Outreach Stage', systemName: 'outreach_stage', type: 'options', autoSystem: true, options: ['Not Started', 'Email 1 Sent', 'Email 2 Sent', 'Email 3 Sent', 'Replied', 'Meeting Booked', 'Opted Out'], description: 'Current position in the outreach sequence' },
        { propertyName: 'Source', systemName: 'source', type: 'options', autoSystem: false, options: ['HubSpot', 'Salesforce', 'Apollo', 'ZoomInfo', 'Surfe', 'LinkedIn', 'Inbound', 'Referral'], description: 'Where this contact was sourced from' },
        { propertyName: 'CRM ID', systemName: 'crm_id', type: 'text', autoSystem: false, description: 'HubSpot or Salesforce record ID for writeback' },
        // ... add remaining properties following the schema table above
      ],
    });
    console.log('Created Contacts collection');
  }

  if (!existingSlugs.includes('companies')) {
    await client.collections.create({
      name: 'Companies',
      slug: 'companies',
      description: 'Target accounts with firmographics, buying signals, and health tracking',
      icon: 'building',
      color: '#8B5CF6',
      primaryKeyField: 'website',
      properties: [
        { propertyName: 'Company Name', systemName: 'company_name', type: 'text', autoSystem: false, description: 'Legal or common company name' },
        { propertyName: 'Website', systemName: 'website', type: 'text', autoSystem: false, description: 'Primary company domain' },
        { propertyName: 'Industry', systemName: 'industry', type: 'text', autoSystem: true, description: 'Primary industry vertical' },
        { propertyName: 'Employee Count', systemName: 'employee_count', type: 'number', autoSystem: false, description: 'Total headcount' },
        { propertyName: 'ICP Fit Score', systemName: 'icp_fit_score', type: 'number', autoSystem: true, description: '0-100 score of how well this company matches the ideal customer profile' },
        { propertyName: 'Buying Signals', systemName: 'buying_signals', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Observed signals: hiring surges, new funding, tech adoption, job postings, expansion' },
        { propertyName: 'Signal Strength', systemName: 'signal_strength', type: 'options', autoSystem: true, options: ['None', 'Weak', 'Moderate', 'Strong', 'Very Strong'], description: 'Aggregate strength of all buying signals detected' },
        { propertyName: 'Account Status', systemName: 'account_status', type: 'options', autoSystem: true, options: ['New Target', 'Researching', 'Prospecting', 'Engaged', 'Opportunity', 'Customer', 'Churned', 'Disqualified'], description: 'Current stage in the account lifecycle' },
        { propertyName: 'CRM Account ID', systemName: 'crm_account_id', type: 'text', autoSystem: false, description: 'HubSpot or Salesforce account ID' },
        // ... add remaining properties following the schema table above
      ],
    });
    console.log('Created Companies collection');
  }

  if (!existingSlugs.includes('outreach-log')) {
    await client.collections.create({
      name: 'Outreach Log',
      slug: 'outreach-log',
      description: 'Track every outreach touch for feedback loop and sequence management',
      icon: 'mail',
      color: '#10B981',
      primaryKeyField: 'contact_email',
      properties: [
        { propertyName: 'Contact Email', systemName: 'contact_email', type: 'text', autoSystem: false, description: 'Email of the recipient' },
        { propertyName: 'Company', systemName: 'company', type: 'text', autoSystem: true, description: "Recipient's company" },
        { propertyName: 'Sequence Step', systemName: 'sequence_step', type: 'options', autoSystem: false, options: ['Email 1', 'Email 2', 'Email 3', 'Call Task', 'LinkedIn Touch'], description: 'Which step in the outreach sequence' },
        { propertyName: 'Channel', systemName: 'channel', type: 'options', autoSystem: false, options: ['Email', 'Phone', 'LinkedIn', 'SMS'], description: 'Delivery channel used' },
        { propertyName: 'Subject Line', systemName: 'subject_line', type: 'text', autoSystem: false, description: 'Email subject used' },
        { propertyName: 'Content Summary', systemName: 'content_summary', type: 'text', autoSystem: true, description: 'Brief summary of what was sent' },
        { propertyName: 'Angle Used', systemName: 'angle_used', type: 'text', autoSystem: true, description: 'The personalization angle/hook used' },
        { propertyName: 'Sent At', systemName: 'sent_at', type: 'date', autoSystem: false, description: 'Timestamp of delivery' },
        { propertyName: 'Opened', systemName: 'opened', type: 'boolean', autoSystem: false, description: 'Whether the email was opened' },
        { propertyName: 'Clicked', systemName: 'clicked', type: 'boolean', autoSystem: false, description: 'Whether any link was clicked' },
        { propertyName: 'Replied', systemName: 'replied', type: 'boolean', autoSystem: false, description: 'Whether the recipient replied' },
        { propertyName: 'Reply Sentiment', systemName: 'reply_sentiment', type: 'options', autoSystem: true, options: ['Positive', 'Neutral', 'Negative', 'Out of Office', 'Unsubscribe'], description: 'Sentiment of the reply' },
        { propertyName: 'Outcome', systemName: 'outcome', type: 'options', autoSystem: true, options: ['No Response', 'Opened', 'Clicked', 'Replied', 'Meeting Booked', 'Rejected', 'Bounced'], description: 'Final outcome of this outreach touch' },
      ],
    });
    console.log('Created Outreach Log collection');
  }
}

createSchemas().catch(console.error);
```

---

## 3. Governance Setup

Governance variables are the rules every agent follows. Create these before generating any outreach.

### Variable 1: `icp-definition`

```typescript
await client.guidelines.create({
  name: 'ICP Definition',
  slug: 'icp-definition',
  content: `
## Ideal Customer Profile

### Company Criteria
- Industry: B2B SaaS, Technology, Professional Services
- Employee count: 50-2,000
- Annual revenue: $5M-$500M
- Growth stage: Series A through Series C+, or profitable and scaling
- Tech stack: Uses CRM (HubSpot or Salesforce), has a sales team of 5+

### Contact Criteria
- Title: VP Sales, VP Revenue, Head of Sales, CRO, VP Business Development, Director of Sales Ops, Revenue Operations Manager
- Seniority: Director, VP, or C-Suite
- Department: Sales, Revenue, Business Development, Sales Operations

### Disqualification Criteria
- Companies with <20 employees (too small for ROI)
- Companies already using [your product] (existing customers)
- Government/non-profit (different sales motion)
- No sales team or outbound motion

### Scoring Weights
- ICP fit (firmographics): 40%
- Buying signals (timing): 30%
- Engagement signals (behavior): 20%
- Champion potential (title + seniority): 10%
  `.trim(),
  triggerKeywords: ['icp', 'ideal customer', 'qualification', 'scoring', 'target', 'fit'],
});
```

### Variable 2: `brand-voice`

```typescript
await client.guidelines.create({
  name: 'Brand Voice',
  slug: 'brand-voice',
  content: `
## Brand Voice for Outbound

### Tone
- Confident but not arrogant
- Conversational, not corporate
- Direct — get to the point in the first sentence
- Knowledgeable — reference specifics, not generics

### Rules
- NEVER start with "I hope this email finds you well" or "I'm reaching out because"
- NEVER use "synergy", "leverage", "touch base", "circle back"
- NEVER claim results or case studies that aren't provided in context
- First sentence must be about THEM, not us
- Keep emails under 150 words for first touch, under 120 for follow-ups
- One clear CTA per email — never two asks
- Sign off with first name only, no title spam

### Personalization Rules
- Reference at least ONE specific fact about the person or company
- The fact must come from memory context — never invented
- If no specific facts available, use industry-level relevance instead
- Don't over-personalize: mentioning their dog's name is creepy, mentioning their recent Series B is relevant
  `.trim(),
  triggerKeywords: ['voice', 'tone', 'writing', 'email', 'outreach', 'style', 'brand'],
});
```

### Variable 3: `outreach-playbook`

```typescript
await client.guidelines.create({
  name: 'Outreach Playbook',
  slug: 'outreach-playbook',
  content: `
## Outreach Sequence Rules

### Sequence Structure
- 3 emails maximum per contact per sequence
- Email 1: Specific observation + value prop + soft CTA (e.g., "worth a look?")
- Email 2: New angle/insight + their situation + medium CTA (e.g., "open to a quick call?")
- Email 3: Brief + final reason + binary CTA (e.g., "yes or no — should I stop reaching out?")

### Timing
- Minimum 3 business days between emails
- Never send on weekends or holidays
- Best send windows: Tue-Thu, 8-10am or 2-4pm recipient's timezone
- If they reply at any point, stop the sequence — human takes over

### Channel Rules
- Email is default for cold outreach
- LinkedIn connection request only AFTER Email 1 (not simultaneously)
- Phone call task created only for contacts scored 80+ who opened Email 1
- SMS never used for cold outreach

### Opt-Out
- Every email must include an unsubscribe mechanism
- If someone replies "not interested" or "remove me", immediately mark as Opted Out
- Never re-enroll an opted-out contact

### Escalation
- If a contact opens all 3 emails but doesn't reply → notify rep on Slack
- If a contact replies with interest → notify rep immediately + create HubSpot task
- If a contact replies negatively → log it, do not follow up
  `.trim(),
  triggerKeywords: ['sequence', 'outreach', 'cadence', 'email', 'timing', 'playbook', 'rules'],
});
```

### Variable 4: `signal-definitions`

```typescript
await client.guidelines.create({
  name: 'Signal Definitions',
  slug: 'signal-definitions',
  content: `
## Buying Signal Definitions

### Strong Signals (Score +30)
- New funding round announced in last 90 days
- Hiring 3+ sales/revenue roles simultaneously
- New CRO/VP Sales hired in last 60 days
- Competitor contract renewal coming up (known from intel)
- Published content about scaling sales/revenue operations

### Moderate Signals (Score +15)
- Job posting for sales ops or revenue ops roles
- Company headcount grew 20%+ in last 6 months
- Expanded to new market/geography
- Mentioned pain points we solve in public content
- Attended relevant industry event or webinar

### Weak Signals (Score +5)
- General hiring activity
- Website traffic increase
- Social media engagement on sales-related topics
- Industry trend affecting their vertical

### Negative Signals (Score -20)
- Recent layoffs (especially in sales)
- Funding round failed or down round
- Just signed with a competitor (wait 12 months)
- Company in acquisition talks
- Contact left the company
  `.trim(),
  triggerKeywords: ['signal', 'buying', 'intent', 'trigger', 'scoring', 'timing'],
});
```

### Variable 5: `competitor-policy`

```typescript
await client.guidelines.create({
  name: 'Competitor Policy',
  slug: 'competitor-policy',
  content: `
## Competitor Handling Rules

### Known Competitors
- [Competitor A]: Strengths — [X]. Our advantage — [Y].
- [Competitor B]: Strengths — [X]. Our advantage — [Y].
- [Competitor C]: Strengths — [X]. Our advantage — [Y].

### Rules
- NEVER badmouth competitors in outreach
- NEVER make comparison claims without verified data
- If a prospect uses a competitor, acknowledge it: "I know you're using [X]..."
- Position as complementary or as a better fit for their specific situation
- Only mention competitors if the prospect brought them up first (visible in memory context)
- When displacing: focus on what we do differently, not what they do wrong
  `.trim(),
  triggerKeywords: ['competitor', 'competitive', 'displacement', 'alternative', 'vs', 'compare'],
});
```

---

## 4. Phase 1 — Data Ingestion

### Pipeline 1A: CRM Sync (HubSpot)

Runs on schedule. Pulls contacts and companies from HubSpot into Personize memory.

```typescript
// src/pipelines/sync-hubspot.ts
import { client } from '../config';
import { Client as HubSpotClient } from '@hubspot/api-client';

const hubspot = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN! });

async function syncHubSpotContacts() {
  // Fetch contacts from a specific list or all recent
  const response = await hubspot.crm.contacts.basicApi.getPage(100, undefined, [
    'firstname', 'lastname', 'email', 'jobtitle', 'phone',
    'company', 'hs_lead_status', 'lifecyclestage',
  ]);

  const records = response.results.map((contact) => ({
    email: contact.properties.email!,
    content: [
      `Name: ${contact.properties.firstname} ${contact.properties.lastname}`,
      `Title: ${contact.properties.jobtitle || 'Unknown'}`,
      `Company: ${contact.properties.company || 'Unknown'}`,
      `Phone: ${contact.properties.phone || 'N/A'}`,
      `HubSpot Status: ${contact.properties.hs_lead_status || 'New'}`,
      `Lifecycle Stage: ${contact.properties.lifecyclestage || 'subscriber'}`,
    ].join('\n'),
    collectionName: 'contacts',
    properties: {
      first_name: { value: contact.properties.firstname || '', extractMemories: false },
      last_name: { value: contact.properties.lastname || '', extractMemories: false },
      job_title: { value: contact.properties.jobtitle || '', extractMemories: false },
      phone_number: { value: contact.properties.phone || '', extractMemories: false },
      company_name: { value: contact.properties.company || '', extractMemories: false },
      source: { value: 'HubSpot', extractMemories: false },
      crm_id: { value: String(contact.id), extractMemories: false },
    },
    tags: ['crm', 'hubspot', 'sync'],
  }));

  // Batch memorize — max ~50 per batch to stay within rate limits
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    await client.memory.memorizeBatch({ records: batch, enhanced: true });
    console.log(`Synced contacts ${i + 1}-${i + batch.length}`);
    await new Promise((r) => setTimeout(r, 2000)); // Rate limit pause
  }
}

async function syncHubSpotCompanies() {
  const response = await hubspot.crm.companies.basicApi.getPage(100, undefined, [
    'name', 'domain', 'industry', 'numberofemployees',
    'annualrevenue', 'city', 'state', 'country',
  ]);

  const records = response.results.map((company) => ({
    website_url: company.properties.domain || '',
    content: [
      `Company: ${company.properties.name}`,
      `Industry: ${company.properties.industry || 'Unknown'}`,
      `Employees: ${company.properties.numberofemployees || 'Unknown'}`,
      `Revenue: ${company.properties.annualrevenue || 'Unknown'}`,
      `Location: ${[company.properties.city, company.properties.state, company.properties.country].filter(Boolean).join(', ')}`,
    ].join('\n'),
    collectionName: 'companies',
    properties: {
      company_name: { value: company.properties.name || '', extractMemories: false },
      website: { value: company.properties.domain || '', extractMemories: false },
      industry: { value: company.properties.industry || '', extractMemories: false },
      employee_count: { value: Number(company.properties.numberofemployees) || 0, extractMemories: false },
      annual_revenue: { value: Number(company.properties.annualrevenue) || 0, extractMemories: false },
      crm_account_id: { value: String(company.id), extractMemories: false },
    },
    tags: ['crm', 'hubspot', 'company', 'sync'],
  }));

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    await client.memory.memorizeBatch({ records: batch, enhanced: true });
    console.log(`Synced companies ${i + 1}-${i + batch.length}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function syncHubSpot() {
  console.log('--- Syncing HubSpot Contacts ---');
  await syncHubSpotContacts();
  console.log('--- Syncing HubSpot Companies ---');
  await syncHubSpotCompanies();
  console.log('--- HubSpot Sync Complete ---');
}
```

### Pipeline 1B: CRM Sync (Salesforce)

Same pattern, different client:

```typescript
// src/pipelines/sync-salesforce.ts
import { client } from '../config';
import jsforce from 'jsforce';

const sf = new jsforce.Connection({
  loginUrl: process.env.SF_LOGIN_URL,
});

async function syncSalesforceContacts() {
  await sf.login(process.env.SF_USERNAME!, process.env.SF_PASSWORD! + process.env.SF_TOKEN!);

  const result = await sf.query(
    `SELECT Id, FirstName, LastName, Email, Title, Phone, Account.Name, Account.Website,
            LeadSource, Status
     FROM Contact
     WHERE LastModifiedDate >= LAST_N_DAYS:7
     LIMIT 500`
  );

  const records = result.records.map((c: any) => ({
    email: c.Email,
    content: `Name: ${c.FirstName} ${c.LastName}\nTitle: ${c.Title}\nCompany: ${c.Account?.Name}\nSource: Salesforce`,
    collectionName: 'contacts',
    properties: {
      first_name: { value: c.FirstName || '', extractMemories: false },
      last_name: { value: c.LastName || '', extractMemories: false },
      job_title: { value: c.Title || '', extractMemories: false },
      phone_number: { value: c.Phone || '', extractMemories: false },
      company_name: { value: c.Account?.Name || '', extractMemories: false },
      company_website: { value: c.Account?.Website || '', extractMemories: false },
      source: { value: 'Salesforce', extractMemories: false },
      crm_id: { value: c.Id, extractMemories: false },
    },
    tags: ['crm', 'salesforce', 'sync'],
  }));

  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    await client.memory.memorizeBatch({ records: batch, enhanced: true });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export { syncSalesforceContacts };
```

### Pipeline 1C: Enrichment Ingestion (Apollo/ZoomInfo)

When enrichment data arrives (via API or webhook), memorize it:

```typescript
// src/pipelines/ingest-enrichment.ts
import { client } from '../config';

interface EnrichmentData {
  email: string;
  company_domain: string;
  title: string;
  seniority: string;
  department: string;
  linkedin_url: string;
  company_name: string;
  company_size: number;
  company_industry: string;
  technologies: string[];
  funding_stage: string;
  funding_amount: number;
  source: 'Apollo' | 'ZoomInfo' | 'Surfe' | 'Clearbit';
}

export async function ingestEnrichment(data: EnrichmentData) {
  // Memorize contact enrichment
  await client.memory.memorize({
    email: data.email,
    content: [
      `[ENRICHMENT from ${data.source}]`,
      `Name: (see properties)`,
      `Title: ${data.title} (${data.seniority})`,
      `Department: ${data.department}`,
      `Company: ${data.company_name} | ${data.company_domain}`,
      `Company Size: ${data.company_size} employees`,
      `Industry: ${data.company_industry}`,
      `Tech Stack: ${data.technologies.join(', ')}`,
      `Funding: ${data.funding_stage} ($${data.funding_amount?.toLocaleString() || 'N/A'})`,
      `LinkedIn: ${data.linkedin_url}`,
    ].join('\n'),
    enhanced: true,
    tags: ['enrichment', data.source.toLowerCase()],
  });

  // Memorize company data separately
  if (data.company_domain) {
    await client.memory.memorize({
      website_url: data.company_domain,
      content: [
        `[ENRICHMENT from ${data.source}]`,
        `Company: ${data.company_name}`,
        `Industry: ${data.company_industry}`,
        `Size: ${data.company_size} employees`,
        `Funding: ${data.funding_stage} ($${data.funding_amount?.toLocaleString() || 'N/A'})`,
        `Technologies: ${data.technologies.join(', ')}`,
      ].join('\n'),
      enhanced: true,
      tags: ['enrichment', 'company', data.source.toLowerCase()],
    });
  }
}
```

### Pipeline 1D: Signal Ingestion

Ingest external buying signals from intent data providers, news, and job boards:

```typescript
// src/pipelines/ingest-signals.ts
import { client } from '../config';

interface Signal {
  company_domain: string;
  company_name: string;
  signal_type: 'funding' | 'hiring' | 'intent' | 'news' | 'job_posting' | 'tech_adoption';
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  source: string;
  detected_at: string;
}

export async function ingestSignal(signal: Signal) {
  await client.memory.memorize({
    website_url: signal.company_domain,
    content: [
      `[BUYING SIGNAL DETECTED — ${signal.signal_type.toUpperCase()}]`,
      `Company: ${signal.company_name} (${signal.company_domain})`,
      `Signal: ${signal.description}`,
      `Strength: ${signal.strength}`,
      `Source: ${signal.source}`,
      `Detected: ${signal.detected_at}`,
    ].join('\n'),
    enhanced: true, // AI will extract into buying_signals, signal_strength properties
    tags: ['signal', signal.signal_type, signal.strength],
  });

  console.log(`Signal ingested: ${signal.signal_type} for ${signal.company_name} (${signal.strength})`);
}

// Batch ingest from an intent data provider export
export async function ingestSignalBatch(signals: Signal[]) {
  for (const signal of signals) {
    await ingestSignal(signal);
    await new Promise((r) => setTimeout(r, 500)); // Gentle rate limiting
  }
}
```

---

## 5. Phase 2 — Signal Detection & Scoring

This pipeline runs daily. It scans all target companies, assesses buying signals, scores them, and identifies which are in a buying window.

```typescript
// src/pipelines/detect-signals.ts
import { client } from '../config';

export async function detectAndScoreSignals() {
  // OBSERVE — find all target companies
  const companies = await client.memory.search({
    type: 'Company',
    limit: 200,
  });

  if (!companies.data?.length) {
    console.log('No companies found. Run CRM sync first.');
    return;
  }

  const hotAccounts: any[] = [];

  for (const company of companies.data) {
    const domain = company.website_url || company.email;
    if (!domain) continue;

    // RECALL — get full company context + governance
    const [guidelines, digest] = await Promise.all([
      client.ai.smartGuidelines({
        message: 'ICP scoring criteria and buying signal definitions',
        mode: 'fast',
      }),
      client.memory.smartDigest({
        website_url: domain,
        type: 'Company',
        token_budget: 2000,
      }),
    ]);

    const context = [
      guidelines.data?.compiledContext || '',
      digest.data?.compiledContext || '',
    ].join('\n\n---\n\n');

    // REASON — score this company
    const result = await client.ai.prompt({
      context,
      instructions: [
        {
          prompt: `Assess this company as a prospecting target. Output exactly:
ICP_FIT_SCORE: [0-100]
SIGNAL_STRENGTH: [None|Weak|Moderate|Strong|Very Strong]
BUYING_WINDOW: [Yes|No]
REASONING: [2-3 sentences explaining the score]
RECOMMENDED_ACTION: [Skip|Monitor|Research|Prospect Now]`,
          maxSteps: 3,
        },
      ],
    });

    const output = String(result.data || '');
    const score = parseInt(output.match(/ICP_FIT_SCORE:\s*(\d+)/)?.[1] || '0');
    const strength = output.match(/SIGNAL_STRENGTH:\s*(\w[\w\s]*)/)?.[1]?.trim() || 'None';
    const buyingWindow = output.match(/BUYING_WINDOW:\s*(Yes|No)/i)?.[1] || 'No';
    const action = output.match(/RECOMMENDED_ACTION:\s*(.+)/)?.[1]?.trim() || 'Skip';

    // UPDATE — store the assessment
    await client.memory.memorize({
      website_url: domain,
      content: `[SIGNAL ASSESSMENT ${new Date().toISOString().split('T')[0]}]\n${output}`,
      enhanced: true,
      tags: ['assessment', 'signal-detection'],
    });

    if (buyingWindow === 'Yes' || score >= 70) {
      hotAccounts.push({
        company: company.name || domain,
        domain,
        score,
        strength,
        action,
      });
    }

    await new Promise((r) => setTimeout(r, 2000)); // Rate limiting
  }

  console.log(`\n=== HOT ACCOUNTS (${hotAccounts.length}) ===`);
  hotAccounts
    .sort((a, b) => b.score - a.score)
    .forEach((a) => console.log(`  ${a.score} | ${a.strength} | ${a.company} → ${a.action}`));

  return hotAccounts;
}
```

---

## 6. Phase 3 — Contact Sourcing & Enrichment

When a company enters the buying window, find the right contacts. This pipeline queries enrichment APIs and memorizes the results.

```typescript
// src/pipelines/source-contacts.ts
import { client } from '../config';

interface HotAccount {
  company: string;
  domain: string;
  score: number;
}

export async function sourceContactsForAccount(account: HotAccount) {
  // RECALL — what do we know about this company + who do we want?
  const [guidelines, companyDigest] = await Promise.all([
    client.ai.smartGuidelines({
      message: 'ICP contact criteria: titles, seniority, departments to target',
      mode: 'fast',
    }),
    client.memory.smartDigest({
      website_url: account.domain,
      type: 'Company',
      token_budget: 1500,
    }),
  ]);

  // Check if we already have contacts at this company
  const existingContacts = await client.memory.recall({
    message: `contacts at ${account.company} ${account.domain}`,
    type: 'Contact',
    limit: 10,
  });

  const context = [
    guidelines.data?.compiledContext || '',
    companyDigest.data?.compiledContext || '',
    existingContacts.data?.length
      ? `EXISTING CONTACTS:\n${existingContacts.data.map((c: any) => `- ${c.email}: ${c.content?.substring(0, 100)}`).join('\n')}`
      : 'No existing contacts at this company.',
  ].join('\n\n---\n\n');

  // REASON — decide what roles to source
  const planResult = await client.ai.prompt({
    context,
    instructions: [
      {
        prompt: `Based on the company context and ICP criteria, list the 3-5 specific roles we should target at this company. For each role, output:
ROLE: [exact title to search for]
PRIORITY: [1-5, 1 being highest]
REASON: [why this role matters for our sale]

Only list roles we don't already have contacts for.`,
        maxSteps: 2,
      },
    ],
  });

  console.log(`Sourcing plan for ${account.company}:`);
  console.log(String(planResult.data || ''));

  // ACT — call enrichment API (Apollo example)
  // In production, replace this with your actual Apollo/ZoomInfo API call
  const rolesToSearch = String(planResult.data || '')
    .split('\n')
    .filter((l) => l.startsWith('ROLE:'))
    .map((l) => l.replace('ROLE:', '').trim());

  for (const role of rolesToSearch) {
    console.log(`  Searching Apollo for "${role}" at ${account.domain}...`);

    // --- Replace with actual Apollo API call ---
    // const apolloResults = await apollo.peopleSearch({
    //   organization_domains: [account.domain],
    //   person_titles: [role],
    //   per_page: 3,
    // });
    //
    // for (const person of apolloResults.people) {
    //   await ingestEnrichment({
    //     email: person.email,
    //     company_domain: account.domain,
    //     title: person.title,
    //     seniority: person.seniority,
    //     department: person.departments?.[0] || '',
    //     linkedin_url: person.linkedin_url,
    //     company_name: account.company,
    //     company_size: person.organization?.estimated_num_employees || 0,
    //     company_industry: person.organization?.industry || '',
    //     technologies: person.organization?.technology_names || [],
    //     funding_stage: '',
    //     funding_amount: 0,
    //     source: 'Apollo',
    //   });
    // }
    // ---
  }

  // UPDATE — mark company as being prospected
  await client.memory.memorize({
    website_url: account.domain,
    content: `[CONTACT SOURCING] Initiated contact sourcing on ${new Date().toISOString().split('T')[0]}. Roles targeted: ${rolesToSearch.join(', ')}`,
    enhanced: true,
    tags: ['sourcing', 'pipeline-activity'],
  });
}

export async function sourceContactsForHotAccounts(hotAccounts: HotAccount[]) {
  for (const account of hotAccounts) {
    await sourceContactsForAccount(account);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
```

---

## 7. Phase 4 — Outreach Generation

The core generation engine. Creates personalized 3-email sequences with call task scripts.

```typescript
// src/pipelines/generate-outreach.ts
import { client } from '../config';

// State is tracked in Personize memory (not filesystem — works in serverless)
// Each sent email is memorized with tags like 'sequence:email-1', 'sequence:email-2'
// The recall below checks how many have been sent and when the last one was sent.

async function getOutreachState(email: string): Promise<{ emailsSent: number; lastSentAt: string }> {
  const history = await client.memory.recall({
    message: `outreach sequence emails sent to ${email}`,
    limit: 10,
  });

  let emailsSent = 0;
  let lastSentAt = '';

  for (const item of history.data || []) {
    const content = item.content || '';
    const match = content.match(/\[OUTREACH SENT — Email (\d)\]/);
    if (match) {
      emailsSent = Math.max(emailsSent, parseInt(match[1]));
      const dateMatch = content.match(/Date:\s*(.+)/);
      if (dateMatch) {
        const sentDate = dateMatch[1].trim();
        if (!lastSentAt || sentDate > lastSentAt) lastSentAt = sentDate;
      }
    }
  }

  return { emailsSent, lastSentAt };
}

async function assembleContext(email: string): Promise<string> {
  const [guidelines, contactDigest, companyContext, previousOutreach] = await Promise.all([
    client.ai.smartGuidelines({
      message: 'brand voice, outreach playbook, ICP definition, competitor policy',
      mode: 'full',
    }),
    client.memory.smartDigest({
      email,
      type: 'Contact',
      token_budget: 2000,
    }),
    // Cross-entity: get company context too
    client.memory.recall({
      message: `company information, buying signals, account status for the company of ${email}`,
      type: 'Company',
      limit: 5,
    }),
    client.memory.recall({
      message: `previous outreach, emails sent, responses from ${email}`,
      limit: 5,
    }),
  ]);

  return [
    '## GOVERNANCE\n' + (guidelines.data?.compiledContext || ''),
    '## CONTACT PROFILE\n' + (contactDigest.data?.compiledContext || ''),
    '## COMPANY CONTEXT\n' + (companyContext.data?.map((r: any) => r.content).join('\n') || 'No company data.'),
    '## PREVIOUS OUTREACH\n' + (previousOutreach.data?.map((r: any) => r.content).join('\n') || 'No previous outreach.'),
  ].join('\n\n---\n\n');
}

export async function generateOutreachForContact(email: string, dryRun = true) {
  const contactState = await getOutreachState(email);

  // Check if sequence is complete
  if (contactState.emailsSent >= 3) {
    console.log(`${email}: Sequence complete (3/3 sent). Skipping.`);
    return null;
  }

  // Check timing gap (only applies when NOT using Trigger.dev's wait.for() durable waits)
  if (contactState.lastSentAt) {
    const daysSince = (Date.now() - new Date(contactState.lastSentAt).getTime()) / (1000 * 60 * 60 * 24);
    const minGap = contactState.emailsSent === 1 ? 3 : 5; // 3 days after email 1, 5 after email 2
    if (daysSince < minGap) {
      console.log(`${email}: Too soon (${daysSince.toFixed(1)}d < ${minGap}d). Skipping.`);
      return null;
    }
  }

  const nextStep = contactState.emailsSent + 1;
  console.log(`${email}: Generating Email ${nextStep}/3...`);

  // RECALL — full context assembly
  const context = await assembleContext(email);

  // GENERATE — personalized email
  const result = await client.ai.prompt({
    context,
    instructions: [
      {
        prompt: `Analyze the contact and company. Identify: their role, likely pain points, strongest personalization angle, and what buying signals exist. If previous emails were sent, note what angles were used so we don't repeat.`,
        maxSteps: 2,
      },
      {
        prompt: `Generate Email ${nextStep} of 3 for this prospect. This is a cold outreach sequence.
${nextStep === 1 ? 'Email 1: Specific observation about them/their company + our value prop + soft CTA. Max 150 words.' : ''}
${nextStep === 2 ? 'Email 2: Different angle/insight than Email 1 + how it relates to their situation + medium CTA. Max 120 words. Reference Email 1 existence but don\'t repeat its content.' : ''}
${nextStep === 3 ? 'Email 3: Brief and direct. One final compelling reason + binary yes/no CTA. Max 100 words.' : ''}

Output exactly:
SUBJECT: [subject line, plain text, under 60 chars]
BODY_HTML: [email body with <p>, <b>, <i>, <a> tags]
BODY_TEXT: [plain text version]
ANGLE: [1-sentence description of the personalization angle used]`,
        maxSteps: 3,
      },
    ],
    evaluate: true,
    evaluationCriteria: 'Email must: (1) reference at least 1 specific fact about the contact/company from context, (2) follow brand voice guidelines, (3) have a single clear CTA, (4) stay within word limit, (5) not repeat angles from previous emails, (6) not invent any claims or stats.',
  });

  const output = String(result.data || '');
  const subject = output.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() || '';
  const bodyHtml = output.match(/BODY_HTML:\s*([\s\S]+?)(?=\nBODY_TEXT:)/i)?.[1]?.trim() || '';
  const bodyText = output.match(/BODY_TEXT:\s*([\s\S]+?)(?=\nANGLE:)/i)?.[1]?.trim() || '';
  const angle = output.match(/ANGLE:\s*(.+)/i)?.[1]?.trim() || '';

  if (dryRun) {
    console.log('\n--- DRY RUN ---');
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Angle: ${angle}`);
    console.log(`Body:\n${bodyText}`);
    console.log('--- END DRY RUN ---\n');
  }

  return { email, step: nextStep, subject, bodyHtml, bodyText, angle };
}

// Also generate a call task script for high-scoring contacts
export async function generateCallScript(email: string) {
  const context = await assembleContext(email);

  const result = await client.ai.prompt({
    context,
    instructions: [
      {
        prompt: `Generate a 30-second cold call opening script for this prospect. Include:
OPENER: [first 2 sentences — who you are + why calling]
HOOK: [1 sentence connecting to their specific situation]
ASK: [1 sentence — the meeting request]
OBJECTION_HANDLERS: [2-3 common objections with 1-sentence responses]

Keep it conversational, not scripted-sounding. Reference specific facts from their profile.`,
        maxSteps: 3,
      },
    ],
  });

  return String(result.data || '');
}
```

---

## 8. Phase 5 — Sequence Enrollment & Delivery

### Deliver via HubSpot

```typescript
// src/delivery/hubspot-deliver.ts
import { Client as HubSpotClient } from '@hubspot/api-client';
import { client } from '../config';

const hubspot = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN! });

interface GeneratedEmail {
  email: string;
  step: number;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  angle: string;
}

// Option A: Create an email engagement in HubSpot (logged, not sent via HubSpot)
export async function createHubSpotEmail(generated: GeneratedEmail, contactId: string) {
  await hubspot.crm.objects.emails.basicApi.create({
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_email_direction: 'EMAIL',
      hs_email_subject: generated.subject,
      hs_email_text: generated.bodyText,
      hs_email_html: generated.bodyHtml,
      hs_email_status: 'SEND', // or 'DRAFT' for review
    },
    associations: [
      {
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 198 }],
      },
    ],
  });
}

// Option B: Create a task for the rep to review and send
export async function createHubSpotTask(generated: GeneratedEmail, contactId: string, ownerId: string) {
  await hubspot.crm.objects.tasks.basicApi.create({
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_task_subject: `Review & Send: Email ${generated.step} to ${generated.email}`,
      hs_task_body: [
        `**Subject:** ${generated.subject}`,
        `**Angle:** ${generated.angle}`,
        `**Email Body:**`,
        generated.bodyText,
        '',
        `---`,
        `Generated by AI Prospecting Agent. Review and send.`,
      ].join('\n'),
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'HIGH',
      hubspot_owner_id: ownerId,
      hs_task_type: 'EMAIL',
    },
    associations: [
      {
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }],
      },
    ],
  });
}

// Option C: Send directly via SendGrid, log in HubSpot
export async function sendAndLog(generated: GeneratedEmail, contactId: string) {
  // Send via SendGrid (see delivery/sendgrid.ts)
  // await sendViaSendGrid(generated);

  // Log in HubSpot
  await createHubSpotEmail(generated, contactId);

  // Close the feedback loop — memorize what was sent
  await client.memory.memorize({
    email: generated.email,
    content: [
      `[OUTREACH SENT — Email ${generated.step}]`,
      `Date: ${new Date().toISOString()}`,
      `Subject: ${generated.subject}`,
      `Angle: ${generated.angle}`,
      `Body: ${generated.bodyText}`,
    ].join('\n'),
    enhanced: true,
    tags: ['generated', 'outreach', `sequence:email-${generated.step}`, 'sent'],
  });
}
```

### Deliver via SendGrid

```typescript
// src/delivery/sendgrid.ts
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

interface GeneratedEmail {
  email: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export async function sendViaSendGrid(generated: GeneratedEmail) {
  await sgMail.send({
    to: generated.email,
    from: {
      email: process.env.SENDER_EMAIL!,
      name: process.env.SENDER_NAME!,
    },
    subject: generated.subject,
    html: generated.bodyHtml,
    text: generated.bodyText,
    trackingSettings: {
      openTracking: { enable: true },
      clickTracking: { enable: true },
    },
  });
}
```

### Notify Reps via Slack

```typescript
// src/delivery/slack-notify.ts

export async function notifyRepOnSlack(
  webhookUrl: string,
  message: { company: string; contact: string; reason: string; action: string }
) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🎯 Hot Prospect Alert` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Company:*\n${message.company}` },
            { type: 'mrkdwn', text: `*Contact:*\n${message.contact}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Why now:*\n${message.reason}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Recommended action:*\n${message.action}` },
        },
      ],
    }),
  });
}
```

---

## 9. Phase 6 — Feedback Loop & Optimization

### Webhook: Ingest Email Engagement Events

```typescript
// src/webhooks/engagement-webhook.ts
import { client } from '../config';
import { notifyRepOnSlack } from '../delivery/slack-notify';

// Express route to receive SendGrid/HubSpot engagement webhooks
export async function handleEngagementWebhook(req: any, res: any) {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const email = event.email || event.recipient;
    const eventType = event.event; // 'open', 'click', 'bounce', 'reply'

    if (!email) continue;

    await client.memory.memorize({
      email,
      content: [
        `[EMAIL ENGAGEMENT — ${eventType.toUpperCase()}]`,
        `Date: ${new Date().toISOString()}`,
        `Event: ${eventType}`,
        event.url ? `Link clicked: ${event.url}` : '',
        event.subject ? `Subject: ${event.subject}` : '',
      ].filter(Boolean).join('\n'),
      enhanced: true,
      tags: ['engagement', eventType],
    });

    // If they replied, alert the rep and stop the sequence
    if (eventType === 'reply') {
      // Pull contact context to fill in the company name
      const digest = await client.memory.smartDigest({ email, type: 'Contact', token_budget: 500 });
      const companyMatch = (digest.data?.compiledContext || '').match(/company[:\s]+([^\n,]+)/i);

      await notifyRepOnSlack(process.env.SLACK_WEBHOOK_URL!, {
        company: companyMatch?.[1]?.trim() || 'Unknown',
        contact: email,
        reason: 'Prospect replied to outreach sequence',
        action: 'Check inbox and respond personally within 1 hour',
      });
    }
  }

  res.json({ ok: true });
}
```

### Weekly Performance Report

```typescript
// src/pipelines/weekly-report.ts
import { client } from '../config';

export async function generateWeeklyReport() {
  // Search for all outreach activity in the last 7 days
  const recentOutreach = await client.memory.search({
    type: 'Contact',
    query: 'outreach sent last 7 days',
    limit: 500,
  });

  const engagements = await client.memory.recall({
    message: 'email engagement opens clicks replies bounces last 7 days',
    limit: 200,
  });

  const context = [
    `OUTREACH ACTIVITY (last 7 days): ${recentOutreach.data?.length || 0} records`,
    recentOutreach.data?.map((r: any) => r.content).join('\n') || '',
    `ENGAGEMENT DATA: ${engagements.data?.length || 0} events`,
    engagements.data?.map((r: any) => r.content).join('\n') || '',
  ].join('\n\n');

  const report = await client.ai.prompt({
    context,
    instructions: [
      {
        prompt: `Generate a weekly prospecting performance report. Include:
SUMMARY: [2-3 sentence overview]
EMAILS_SENT: [count]
OPEN_RATE: [percentage or "insufficient data"]
REPLY_RATE: [percentage or "insufficient data"]
TOP_PERFORMING_ANGLES: [which personalization approaches got the best engagement]
HOT_PROSPECTS: [contacts showing the most engagement]
RECOMMENDATIONS: [2-3 specific improvements for next week]`,
        maxSteps: 3,
      },
    ],
  });

  return String(report.data || '');
}
```

---

## 10. Wiring & Integration Patterns

### Webhook Receiver (for CRM events)

```typescript
// src/server.ts — OPTIONAL: only needed if you want a standalone webhook server
// With Trigger.dev, webhooks are handled as tasks (see Section 11) — you don't need this file.
// This is here as an alternative for teams who prefer a traditional Express server.
import express from 'express';
import { client } from './config';
import { ingestSignal } from './pipelines/ingest-signals';
import { ingestEnrichment } from './pipelines/ingest-enrichment';
import { handleEngagementWebhook } from './webhooks/engagement-webhook';

const app = express();
app.use(express.json());

// HubSpot webhook — contact/company updates
app.post('/webhooks/hubspot', async (req, res) => {
  for (const event of req.body) {
    const { objectType, objectId, propertyName, propertyValue } = event;

    if (objectType === 'CONTACT') {
      // Re-sync this contact
      // await syncSingleHubSpotContact(objectId);
    }

    if (objectType === 'DEAL' && propertyName === 'dealstage') {
      // Deal stage changed — potential signal
      await client.memory.memorize({
        content: `[CRM EVENT] Deal ${objectId} stage changed to: ${propertyValue}`,
        enhanced: true,
        tags: ['crm', 'hubspot', 'deal-update'],
      });
    }
  }
  res.json({ ok: true });
});

// Enrichment webhook — Apollo/ZoomInfo results
app.post('/webhooks/enrichment', async (req, res) => {
  const { contacts, source } = req.body;
  for (const contact of contacts) {
    await ingestEnrichment(contact);
  }
  res.json({ ok: true });
});

// Signal webhook — intent data, news alerts
app.post('/webhooks/signals', async (req, res) => {
  await ingestSignal(req.body);
  res.json({ ok: true });
});

// Engagement webhook — SendGrid/HubSpot open/click/reply
app.post('/webhooks/engagement', handleEngagementWebhook);

app.listen(3000, () => console.log('Prospecting agent webhook server running on :3000'));
```

### Graceful Degradation

Every integration wraps Personize calls in try/catch with fallback:

```typescript
async function personalizeOrFallback(email: string, fallbackSubject: string, fallbackBody: string) {
  try {
    const result = await generateOutreachForContact(email, false);
    if (result) return result;
  } catch (error) {
    console.error(`Personize failed for ${email}, using fallback:`, error);
  }

  // Fallback — generic but functional
  return {
    email,
    step: 1,
    subject: fallbackSubject,
    bodyHtml: `<p>${fallbackBody}</p>`,
    bodyText: fallbackBody,
    angle: 'generic-fallback',
  };
}
```

---

## 11. Autopilot Deployment with Trigger.dev

> **No servers. No cron jobs. No GitHub Actions. No infrastructure to manage.**
>
> Trigger.dev is a managed serverless platform. You write your tasks in TypeScript, deploy with one command, and they run on autopilot forever — with scheduling, retries, a monitoring dashboard, and durable waits (the agent can "sleep" for 3 days between emails without you paying for idle time).

### Why Trigger.dev (Not Servers)

| You Avoid | Trigger.dev Handles It |
|---|---|
| Setting up a server | Serverless — runs in their cloud |
| Installing Node.js, PM2, etc. | Just `npx trigger.dev deploy` |
| Managing uptime / restarts | Auto-retries with exponential backoff |
| Writing cron job logic | Built-in cron scheduling |
| Paying for idle time | Billed only when code runs; `wait.for()` is free |
| Building a monitoring dashboard | Dashboard shows every run, logs, errors |
| Handling webhook endpoints | Built-in webhook triggers |

### Step 1: One-Time Setup (5 minutes)

```bash
# 1. Create a Trigger.dev account at https://cloud.trigger.dev (free tier available)

# 2. Initialize in your project
cd ai-prospecting-agent
npx trigger.dev@latest init

# 3. Add your API keys in the Trigger.dev dashboard:
#    Settings → Environment Variables → Add:
#    - PERSONIZE_SECRET_KEY
#    - HUBSPOT_ACCESS_TOKEN
#    - SENDGRID_API_KEY
#    - SLACK_WEBHOOK_URL
#    - DRY_RUN=true  (set to "false" when ready to go live)
```

### Trigger.dev Configuration

```typescript
// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_your_project_id", // from Trigger.dev dashboard
  runtime: "node",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 60000,
      factor: 2,
    },
  },
  dirs: ["src/trigger"],
});
```

### Step 2: Convert Pipelines to Trigger.dev Tasks

Each pipeline becomes a Trigger.dev task with its own schedule. They run independently.

> **Two outreach modes are provided below:**
> - **`outreach-engine.ts`** — scheduler-driven: runs on cron, fires individual tasks per contact, each task sends one email. Good for high-throughput batch processing.
> - **`outreach-sequence.ts`** — durable sequence: one long-running task per contact that sends all 3 emails with `wait.for()` pauses between them. Good for simpler flow with built-in timing.
>
> **Pick one approach**, not both. The durable sequence (`fullSequenceTask`) is recommended for most teams — it's simpler and the timing logic is handled by Trigger.dev's wait system instead of manual checks.

```typescript
// src/trigger/crm-sync.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { syncHubSpot } from '../pipelines/sync-hubspot';

// Runs every hour on weekdays — keeps CRM data fresh
export const crmSyncTask = schedules.task({
  id: "crm-sync",
  cron: "0 * * * 1-5",  // Every hour, Mon-Fri
  retry: { maxAttempts: 3, minTimeoutInMs: 30_000 },
  run: async () => {
    await syncHubSpot();
    // await syncSalesforceContacts(); // uncomment if using Salesforce
    return { synced: true, timestamp: new Date().toISOString() };
  },
});
```

```typescript
// src/trigger/signal-detection.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { detectAndScoreSignals } from '../pipelines/detect-signals';
import { sourceContactsForHotAccounts } from '../pipelines/source-contacts';

// Runs every morning at 8am UTC — scores accounts and sources contacts
export const signalDetectionTask = schedules.task({
  id: "signal-detection",
  cron: "0 8 * * 1-5",  // 8am UTC, Mon-Fri (adjust to your timezone)
  retry: { maxAttempts: 2 },
  run: async () => {
    // Score all accounts
    const hotAccounts = await detectAndScoreSignals();

    // Source contacts for any newly-hot accounts
    if (hotAccounts?.length) {
      await sourceContactsForHotAccounts(hotAccounts);
    }

    return {
      hotAccounts: hotAccounts?.length || 0,
      timestamp: new Date().toISOString(),
    };
  },
});
```

```typescript
// src/trigger/outreach-engine.ts
import { schedules, task, wait } from "@trigger.dev/sdk/v3";
import { client } from '../config';
import { generateOutreachForContact } from '../pipelines/generate-outreach';
import { sendAndLog } from '../delivery/hubspot-deliver';

// Master outreach scheduler — runs twice daily (10am and 2pm UTC)
export const outreachScheduler = schedules.task({
  id: "outreach-scheduler",
  cron: "0 10,14 * * 1-5",  // 10am and 2pm UTC, Mon-Fri
  retry: { maxAttempts: 2 },
  run: async () => {
    const contacts = await client.memory.search({
      type: 'Contact',
      query: 'qualified contacts ready for outreach, not opted out',
      limit: 50,
    });

    let processed = 0;
    for (const contact of contacts.data || []) {
      if (!contact.email) continue;

      // Fire off each contact as a separate child task (parallel, isolated retries)
      await processContactTask.trigger({
        email: contact.email,
        crmId: contact.crm_id || '',
      });
      processed++;
    }

    return { contactsQueued: processed };
  },
});

// Individual contact outreach — runs per contact, with built-in durable waits
const processContactTask = task({
  id: "process-contact-outreach",
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000 },
  queue: {
    concurrencyLimit: 5, // Max 5 contacts processed simultaneously
  },
  run: async ({ email, crmId }: { email: string; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';

    const generated = await generateOutreachForContact(email, dryRun);
    if (!generated) return { email, status: 'skipped' };

    if (!dryRun) {
      await sendAndLog(generated, crmId);
    }

    return { email, step: generated.step, subject: generated.subject, dryRun };
  },
});
```

```typescript
// src/trigger/outreach-sequence.ts
import { task, wait } from "@trigger.dev/sdk/v3";
import { client } from '../config';
import { generateOutreachForContact } from '../pipelines/generate-outreach';
import { sendAndLog } from '../delivery/hubspot-deliver';

// Full 3-email sequence as a single durable task
// This task "sleeps" between emails — Trigger.dev checkpoints it, no cost during wait
export const fullSequenceTask = task({
  id: "full-outreach-sequence",
  retry: { maxAttempts: 2 },
  run: async ({ email, crmId }: { email: string; crmId: string }) => {
    const dryRun = process.env.DRY_RUN !== 'false';
    const results: any[] = [];

    // --- EMAIL 1 ---
    const email1 = await generateOutreachForContact(email, dryRun);
    if (!email1) return { email, status: 'skipped', reason: 'not qualified' };
    if (!dryRun) await sendAndLog(email1, crmId);
    results.push({ step: 1, subject: email1.subject });

    // Check if they replied before Email 2
    // wait.for() is FREE — Trigger.dev checkpoints your task and resumes after 3 days
    await wait.for({ days: 3 });

    // Check for reply before continuing
    const reply1 = await client.memory.recall({
      message: `reply or response from ${email} in the last 3 days`,
      limit: 3,
    });
    if (reply1.data?.some((r: any) => r.content?.includes('REPLY') || r.content?.includes('replied'))) {
      return { email, status: 'replied_after_email_1', results };
    }

    // --- EMAIL 2 ---
    const email2 = await generateOutreachForContact(email, dryRun);
    if (!email2) return { email, status: 'sequence_stopped', results };
    if (!dryRun) await sendAndLog(email2, crmId);
    results.push({ step: 2, subject: email2.subject });

    // Wait 5 days before Email 3
    await wait.for({ days: 5 });

    // Check for reply before Email 3
    const reply2 = await client.memory.recall({
      message: `reply or response from ${email} in the last 5 days`,
      limit: 3,
    });
    if (reply2.data?.some((r: any) => r.content?.includes('REPLY') || r.content?.includes('replied'))) {
      return { email, status: 'replied_after_email_2', results };
    }

    // --- EMAIL 3 ---
    const email3 = await generateOutreachForContact(email, dryRun);
    if (!email3) return { email, status: 'sequence_stopped', results };
    if (!dryRun) await sendAndLog(email3, crmId);
    results.push({ step: 3, subject: email3.subject });

    return { email, status: 'sequence_complete', results };
  },
});
```

```typescript
// src/trigger/weekly-report.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { generateWeeklyReport } from '../pipelines/weekly-report';

// Runs every Friday at 4pm UTC
export const weeklyReportTask = schedules.task({
  id: "weekly-report",
  cron: "0 16 * * 5",  // 4pm UTC, Fridays
  run: async () => {
    const report = await generateWeeklyReport();
    // Send to Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*Weekly Prospecting Report*\n\n${report}`,
        }),
      });
    }
    return { report };
  },
});
```

```typescript
// src/trigger/error-handler.ts
import { task } from "@trigger.dev/sdk/v3";

// Global failure handler — sends Slack alert when any task fails
export const errorAlertTask = task({
  id: "error-alert",
  run: async ({ taskId, error, runId }: { taskId: string; error: string; runId: string }) => {
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `⚠️ *Pipeline Error*\nTask: \`${taskId}\`\nRun: \`${runId}\`\nError: ${error}`,
        }),
      });
    }
  },
});
```

### Step 3: Webhook Tasks (for Real-Time Events)

```typescript
// src/trigger/webhooks.ts
import { task } from "@trigger.dev/sdk/v3";
import { client } from '../config';
import { ingestSignal } from '../pipelines/ingest-signals';

// HubSpot CRM update — triggered by webhook
export const hubspotWebhookTask = task({
  id: "hubspot-webhook",
  retry: { maxAttempts: 3 },
  run: async (payload: { objectType: string; objectId: string; propertyName: string; propertyValue: string }) => {
    if (payload.objectType === 'DEAL' && payload.propertyName === 'dealstage') {
      await client.memory.memorize({
        content: `[CRM EVENT] Deal ${payload.objectId} stage changed to: ${payload.propertyValue}`,
        enhanced: true,
        tags: ['crm', 'hubspot', 'deal-update'],
      });
    }
    return { processed: true };
  },
});

// Email engagement (open/click/reply) — triggered by SendGrid webhook
export const engagementWebhookTask = task({
  id: "engagement-webhook",
  retry: { maxAttempts: 3 },
  run: async (payload: { email: string; event: string; url?: string; subject?: string }) => {
    await client.memory.memorize({
      email: payload.email,
      content: [
        `[EMAIL ENGAGEMENT — ${payload.event.toUpperCase()}]`,
        `Date: ${new Date().toISOString()}`,
        `Event: ${payload.event}`,
        payload.url ? `Link clicked: ${payload.url}` : '',
      ].filter(Boolean).join('\n'),
      enhanced: true,
      tags: ['engagement', payload.event],
    });

    // If they replied — alert rep immediately
    if (payload.event === 'reply') {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🔥 *Reply received!*\nFrom: ${payload.email}\nAction: Respond personally within 1 hour`,
        }),
      });
    }

    return { processed: true };
  },
});
```

### Step 4: Deploy (One Command)

```bash
# Test locally first
npx trigger.dev@latest dev

# When ready — deploy to production. That's it. It runs forever.
npx trigger.dev@latest deploy
```

After deploying, your Trigger.dev dashboard shows:

```
┌──────────────────────────────────────────────────────────────┐
│  TRIGGER.DEV DASHBOARD                                       │
│                                                              │
│  Scheduled Tasks:                                            │
│  ✅ crm-sync              Every hour, Mon-Fri                │
│  ✅ signal-detection       8am UTC daily                     │
│  ✅ outreach-scheduler     10am + 2pm UTC daily              │
│  ✅ weekly-report          4pm UTC Fridays                   │
│                                                              │
│  Recent Runs:                                                │
│  ✅ crm-sync              2 min ago     12s    synced: true  │
│  ✅ signal-detection       6 hrs ago    4m32s  hot: 7        │
│  ⏳ full-outreach-sequence  waiting     (day 2 of 3)         │
│  ✅ process-contact        6 hrs ago    8s     step: 1       │
│  ❌ process-contact        6 hrs ago    3s     → retrying    │
│                                                              │
│  [View Logs]  [Pause Schedule]  [Trigger Manual Run]         │
└──────────────────────────────────────────────────────────────┘
```

### How it Works Day-to-Day

Here's what happens **without you touching anything**:

| Time | What Runs | What Happens |
|---|---|---|
| Every hour | `crm-sync` | Pulls latest contacts + companies from HubSpot into Personize memory |
| 8am daily | `signal-detection` | Scores all accounts, finds buying windows, sources contacts for hot ones |
| 10am + 2pm | `outreach-scheduler` | Finds qualified contacts, generates personalized emails, sends or creates review tasks |
| Continuous | `full-outreach-sequence` | Each contact gets a 3-email sequence with 3-day and 5-day waits between emails, automatically checks for replies before continuing |
| Real-time | `engagement-webhook` | When someone opens/clicks/replies, it's memorized + rep gets Slack alert on replies |
| Fridays 4pm | `weekly-report` | AI-generated performance report sent to Slack |

### Managing It (No Code Needed After Deploy)

| What You Want | How To Do It |
|---|---|
| Pause everything | Dashboard → click "Pause" on any schedule |
| See what happened | Dashboard → click any run → see full logs |
| Change the schedule | Edit the `cron` string → `npx trigger.dev deploy` |
| Update ICP or brand voice | Update governance variables in Personize dashboard (no redeploy) |
| Go from dry-run to live | Dashboard → Environment Variables → set `DRY_RUN=false` |
| Add more contacts | Just add them to HubSpot — next sync picks them up automatically |
| Something broke | Dashboard shows the error + auto-retries. Slack alert notifies you. |

---

## 12. Rate Limits & Cost Planning

### API Call Budget

Each contact through the full pipeline uses approximately:

| Step | API Calls | Notes |
|---|---|---|
| CRM sync (`memorizeBatch`) | ~1 per 50 records | Batched |
| Signal detection | ~4 per company | guidelines + digest + prompt + memorize |
| Contact sourcing | ~5 per company | guidelines + digest + recall + prompt + memorize |
| Outreach generation | ~6 per contact | guidelines + digest + 2x recall + prompt + memorize |
| Delivery + feedback | ~2 per contact | memorize sent + memorize engagement |
| **Total per contact** | **~13 calls** | From signal to send |

### Throughput Estimates

Always call `client.me()` to get your actual limits. Example:

| Plan | Rate Limit | Contacts/min | Contacts/day (8hr) |
|---|---|---|---|
| Starter | 60/min | ~4 | ~2,000 |
| Growth | 200/min | ~15 | ~7,200 |
| Scale | 600/min | ~46 | ~22,000 |

### Cost Optimization

- Use `mode: 'fast'` for `smartGuidelines()` (free, ~200ms)
- Use `token_budget: 1500` for `smartDigest()` (not 3000 unless needed)
- Use `tier: 'basic'` for high-volume scoring; `tier: 'pro'` for outreach generation
- Batch CRM syncs with `memorizeBatch()` instead of individual `memorize()` calls
- Use `sessionId` for multi-step workflows to deduplicate context (30-50% token savings)

---

## 13. Implementation Timeline

### Week 1: Foundation

- [ ] Install `@personize/sdk`, configure auth, verify with `client.me()`
- [ ] Create all 3 collections (Contacts, Companies, Outreach Log) in Personize
- [ ] Create all 5 governance variables (ICP, brand voice, playbook, signals, competitors)
- [ ] Build and test HubSpot CRM sync pipeline
- [ ] Run initial sync — verify data appears in Personize dashboard

### Week 2: Intelligence Layer

- [ ] Build signal ingestion pipeline (start with manual/CSV, then connect live sources)
- [ ] Build signal detection & scoring pipeline
- [ ] Run scoring against synced companies — review output, tune ICP governance
- [ ] Build enrichment ingestion pipeline (connect Apollo or ZoomInfo)
- [ ] Build contact sourcing pipeline — test with 5 hot accounts

### Week 3: Outreach Engine

- [ ] Build outreach generation pipeline
- [ ] Run in DRY_RUN mode — review 20+ generated sequences
- [ ] Tune brand voice and playbook governance based on output quality
- [ ] Build call script generation
- [ ] Build HubSpot delivery integration (tasks or emails)
- [ ] Build SendGrid delivery integration
- [ ] Build Slack notification for hot prospects

### Week 4: Deploy to Autopilot & Go-Live

- [ ] Create Trigger.dev account, run `npx trigger.dev@latest init`
- [ ] Convert all pipelines to Trigger.dev tasks (code provided in Section 11)
- [ ] Add all environment variables to Trigger.dev dashboard
- [ ] Test locally with `npx trigger.dev dev`
- [ ] Deploy to production with `npx trigger.dev deploy` (one command)
- [ ] Run full pipeline in DRY_RUN mode — review outputs in Trigger.dev dashboard
- [ ] Review generated emails with sales team
- [ ] Set `DRY_RUN=false` in Trigger.dev dashboard for a small segment (10-20 contacts)
- [ ] Monitor via Trigger.dev dashboard + Slack alerts

### Ongoing (No Code Needed)

- [ ] Review weekly report in Slack every Friday
- [ ] Tune governance variables in Personize dashboard (ICP, brand voice, playbook)
- [ ] Monitor Trigger.dev dashboard for errors or anomalies
- [ ] Expand to Salesforce sync (if applicable)
- [ ] A/B test different angles by updating governance variables
- [ ] Add LinkedIn touch generation as a new Trigger.dev task

---

## Project Structure

```
ai-prospecting-agent/
├── src/
│   ├── config.ts                      # Personize client + env setup
│   ├── trigger/                       # Trigger.dev tasks (the autopilot brain)
│   │   ├── crm-sync.ts               # Scheduled: hourly CRM sync
│   │   ├── signal-detection.ts        # Scheduled: daily signal scoring
│   │   ├── outreach-engine.ts         # Scheduled: twice-daily outreach
│   │   ├── outreach-sequence.ts       # Durable: 3-email sequence with waits
│   │   ├── weekly-report.ts           # Scheduled: Friday performance report
│   │   ├── webhooks.ts               # Real-time: CRM + engagement events
│   │   └── error-handler.ts          # Global: Slack error alerts
│   ├── pipelines/                     # Core logic (called by triggers)
│   │   ├── sync-hubspot.ts            # HubSpot CRM sync
│   │   ├── sync-salesforce.ts         # Salesforce CRM sync
│   │   ├── ingest-enrichment.ts       # Apollo/ZoomInfo data ingestion
│   │   ├── ingest-signals.ts          # Buying signal ingestion
│   │   ├── detect-signals.ts          # Signal detection + scoring
│   │   ├── source-contacts.ts         # Contact sourcing for hot accounts
│   │   ├── generate-outreach.ts       # Personalized email + call scripts
│   │   └── weekly-report.ts           # Performance reporting
│   ├── delivery/                      # Output channels
│   │   ├── hubspot-deliver.ts         # HubSpot email/task creation
│   │   ├── sendgrid.ts               # SendGrid email sending
│   │   └── slack-notify.ts           # Slack rep notifications
│   └── setup/                         # One-time setup scripts
│       ├── create-schemas.ts          # Collection creation
│       └── create-governance.ts       # Governance variable creation
├── .env                               # Local dev keys (never commit)
├── trigger.config.ts                  # Trigger.dev configuration
├── package.json
└── tsconfig.json
```

---

## Environment Variables

Set these in the **Trigger.dev dashboard** (Settings → Environment Variables) — not in a file:

| Variable | Where to Get It | Required? |
|---|---|---|
| `PERSONIZE_SECRET_KEY` | Personize dashboard → Settings → API Keys | Yes |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot → Settings → Private Apps → Create App | Yes |
| `SENDGRID_API_KEY` | SendGrid → Settings → API Keys | Yes (for email delivery) |
| `SLACK_WEBHOOK_URL` | Slack → Apps → Incoming Webhooks | Yes (for alerts) |
| `SENDER_EMAIL` | Your outreach email address | Yes |
| `SENDER_NAME` | Your name or company name | Yes |
| `DRY_RUN` | Set to `true` initially, `false` when ready | Yes |
| `SF_LOGIN_URL` | `https://login.salesforce.com` (or `https://test.salesforce.com` for sandbox) | Only if using Salesforce |
| `SF_USERNAME` | Salesforce login | Only if using Salesforce |
| `SF_PASSWORD` | Salesforce password | Only if using Salesforce |
| `SF_TOKEN` | Salesforce security token | Only if using Salesforce |

For local development, create a `.env` file with the same variables (never commit it to git).

---

## Key Decisions for You

Before building, you need to decide:

1. **CRM primary**: HubSpot or Salesforce as the source of truth? (Plan supports both)
2. **Enrichment provider**: Apollo, ZoomInfo, Surfe, or multiple?
3. **Signal sources**: Do you have intent data (Bombora, G2, 6sense) or starting with manual signals?
4. **Delivery mode**: Agent sends directly, or creates tasks for reps to review first?
5. **ICP specifics**: Fill in the actual ICP definition, brand voice, and competitor details
6. **Budget**: Which Personize plan — determines throughput capacity

---

## Quick-Start Cheat Sheet (For Non-Technical Users)

If you're working with a developer, hand them this plan. If you're doing it yourself, here's the shortest path:

```
1. Sign up:     Personize (personize.ai) + Trigger.dev (cloud.trigger.dev)
2. Clone:       Copy the code from this plan into a project folder
3. Configure:   Add your API keys to Trigger.dev dashboard
4. Set rules:   Create governance variables in Personize (ICP, brand voice, playbook)
5. Test:        npx trigger.dev dev  (runs locally, DRY_RUN mode)
6. Deploy:      npx trigger.dev deploy  (goes to autopilot)
7. Monitor:     Check Trigger.dev dashboard + Slack alerts
8. Tune:        Update governance variables in Personize — no redeploy needed
```

**Total managed services (no servers):**
- **Personize** — AI memory, governance, and generation engine
- **Trigger.dev** — Runs your pipelines on schedule, handles retries and waits
- **SendGrid** — Sends the emails
- **Slack** — Receives alerts and reports

**You never manage**: servers, databases, cron jobs, uptime, scaling, or infrastructure.
