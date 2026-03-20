# AI Prospecting Agent — Workspace System Reference

> Complete reference for how the multi-agent workspace system works.
> Covers collections, properties, functions, task lifecycle, event flows, and API endpoints.

---

## Table of Contents

1. [Collections & Properties](#1-collections--properties)
2. [Workspace Functions](#2-workspace-functions)
3. [Task Lifecycle](#3-task-lifecycle)
4. [If-This-Then-That Flows](#4-if-this-then-that-flows)
5. [API Endpoints](#5-api-endpoints)

---

## 1. Collections & Properties

The system uses **4 collections**. Workspace coordination lives on the first two (Contacts and Companies). The other two (Outreach Log and Web Research) are supporting data stores.

### 1.1 Contacts Collection

- **Slug:** `contacts`
- **Primary Key:** `email`
- **Description:** Prospecting contacts from CRM, enrichment tools, and inbound
- **Icon:** `user` | **Color:** `#3B82F6`

#### Identity Properties (`autoSystem: false`)

These are set by your code during CRM import or data ingestion. The AI extraction engine will **never** modify them — you have full control over exact values.

| Property Name | System Name | Type | Description |
|---|---|---|---|
| First Name | `first_name` | text | Contact's first name |
| Last Name | `last_name` | text | Contact's last name |
| Email | `email` | text | Primary email address |
| Phone | `phone_number` | text | Direct phone number |
| LinkedIn URL | `linkedin_url` | text | LinkedIn profile URL |
| Source | `source` | options | Where sourced from |
| CRM ID | `crm_id` | text | HubSpot or Salesforce record ID |

**Source options:** `HubSpot`, `Salesforce`, `Apollo`, `ZoomInfo`, `Surfe`, `LinkedIn`, `Inbound`, `Referral`, `CSV`

**Example JSON (as stored):**

```json
{
  "first_name": { "value": "John" },
  "last_name": { "value": "Smith" },
  "email": { "value": "john@acme.com" },
  "phone_number": { "value": "+1-555-0123" },
  "linkedin_url": { "value": "https://linkedin.com/in/johnsmith" },
  "source": { "value": "Apollo" },
  "crm_id": { "value": "hs_12345678" }
}
```

#### AI-Enrichable Properties (`autoSystem: true`)

These are automatically extracted and updated by AI when you `memorize()` unstructured text (emails, meeting notes, enrichment data). AI reads the text, identifies relevant information, and updates these properties.

| Property Name | System Name | Type | updateSemantics | Options | Description |
|---|---|---|---|---|---|
| Company Name | `company_name` | text | — | — | Current employer |
| Company Website | `company_website` | text | — | — | Company domain |
| Job Title | `job_title` | text | — | — | Current role/title |
| Seniority Level | `seniority_level` | options | — | IC, Manager, Director, VP, C-Suite, Founder | Level in org hierarchy |
| Department | `department` | options | — | Engineering, Sales, Marketing, Product, Finance, HR, Operations, Executive | Department within the company |
| Decision Maker | `decision_maker` | boolean | — | — | Can approve purchases |
| ICP Match | `icp_match` | boolean | — | — | Matches ideal customer profile |
| Lead Status | `lead_status` | options | — | New, Researching, Qualified, Contacted, Engaged, Meeting Set, Opportunity, Customer, Disqualified | Current lifecycle status |
| Lead Score | `lead_score` | number | — | — | 0-100 composite score |
| Pain Points | `pain_points` | array | `append` | — | Challenges mentioned or inferred |
| Interests & Topics | `interests_topics` | array | `append` | — | Professional interests |
| Communication Style | `communication_style` | text | — | — | Preferred tone: direct/consultative/technical/casual |
| Sentiment | `sentiment` | options | — | Positive, Neutral, Skeptical, Frustrated | Current sentiment toward us |
| Responsive | `responsive` | boolean | — | — | Whether they've responded |
| Competitors Mentioned | `competitors_mentioned` | array | `append` | — | Competitor products referenced |
| Outreach Stage | `outreach_stage` | options | — | Not Started, Email 1 Sent, Email 2 Sent, Email 3 Sent, Replied, Meeting Booked, Opted Out | Position in outreach sequence |
| Last Contacted | `last_contacted` | date | — | — | Date of most recent outreach |

**Example JSON (as stored):**

```json
{
  "company_name": { "value": "Acme Corp" },
  "company_website": { "value": "acme.com" },
  "job_title": { "value": "VP of Engineering" },
  "seniority_level": { "value": "VP" },
  "department": { "value": "Engineering" },
  "decision_maker": { "value": true },
  "icp_match": { "value": true },
  "lead_status": { "value": "Qualified" },
  "lead_score": { "value": 85 },
  "pain_points": { "value": ["slow deployment cycles", "manual QA bottleneck"] },
  "interests_topics": { "value": ["CI/CD", "developer productivity", "platform engineering"] },
  "communication_style": { "value": "direct" },
  "sentiment": { "value": "Neutral" },
  "responsive": { "value": false },
  "competitors_mentioned": { "value": ["CircleCI", "Jenkins"] },
  "outreach_stage": { "value": "Email 1 Sent" },
  "last_contacted": { "value": "2026-03-15" }
}
```

**Why `updateSemantics: 'append'` matters:** For array properties like `pain_points`, `interests_topics`, and `competitors_mentioned`, the AI **adds** new items it discovers without overwriting existing ones. If a first email mentions "slow deployments" and a later conversation mentions "hiring challenges", both are preserved.

#### Workspace Properties — Shared Coordination Surface

These properties form the **workspace** — the shared surface where multiple agents read and write to coordinate.

**Append-only logs (`autoSystem: true`, `updateSemantics: 'append'`):**

| Property Name | System Name | Type | Description |
|---|---|---|---|
| Context | `context` | text | Current lead state summary. Rewritten each cycle by whichever agent has the latest understanding. The "start here" for anyone engaging with this lead. |
| Updates | `updates` | array | Chronological timeline of everything that happened. Append only — this is how agents and humans see what others have done. |
| Notes | `notes` | array | Knowledge and observations from any contributor. Enrichment data, signal analysis, reply sentiment — all stored here. |

**Context example:**

```json
{
  "context": {
    "value": "Status: POSITIVE REPLY — Lead interested!\nPriority: URGENT — respond within 1 hour.\nSummary: Wants to see a demo of the platform integration.\nNext: Schedule call with sales engineer."
  }
}
```

**Updates array example (each entry):**

```json
{
  "updates": {
    "value": [
      {
        "author": "outreach-agent",
        "type": "outreach",
        "summary": "Email 1/3 sent: \"Saw your Series B — congrats!\" (angle: Recent funding)",
        "timestamp": "2026-03-15T10:30:00Z"
      },
      {
        "author": "engagement-webhook",
        "type": "engagement",
        "summary": "Email OPENED",
        "details": "Subject: Saw your Series B — congrats!",
        "timestamp": "2026-03-15T14:22:00Z"
      },
      {
        "author": "reply-analyzer",
        "type": "engagement",
        "summary": "Positive reply: Wants to see a demo of the platform integration.",
        "timestamp": "2026-03-16T09:15:00Z"
      },
      {
        "author": "task-executor",
        "type": "system",
        "summary": "Task completed: \"Lead interested — schedule call\" — Email sent: \"Following up on your interest\"",
        "timestamp": "2026-03-16T10:00:00Z"
      }
    ]
  }
}
```

**Update types:** `enrichment`, `signal`, `outreach`, `engagement`, `system`, `human`

**Notes array example (each entry):**

```json
{
  "notes": {
    "value": [
      {
        "author": "reply-analyzer",
        "content": "Reply Analysis:\nSentiment: POSITIVE\nSummary: Wants to see a demo\nKey Points: platform integration, timeline Q2\nUrgency: high\nNext Action: Schedule call with sales engineer",
        "category": "reply-analysis",
        "timestamp": "2026-03-16T09:15:00Z"
      },
      {
        "author": "enrichment-agent",
        "content": "LinkedIn shows 3 recent hires in DevOps. Company blog mentions migration from Jenkins to modern CI/CD.",
        "category": "enrichment",
        "timestamp": "2026-03-14T08:00:00Z"
      }
    ]
  }
}
```

**Note categories:** `observation`, `analysis`, `enrichment`, `signal`, `reply-analysis`

**Code-managed state (`autoSystem: false`):**

These are managed exclusively by code. AI extraction will **never** touch them. This protects control flow logic from AI noise.

| Property Name | System Name | Type | Description |
|---|---|---|---|
| Pending Tasks | `pending_tasks` | array | Active tasks only. Managed by `workspace.addTask()` / `completeTask()` / `declineTask()`. |
| Open Issues | `open_issues` | array | Active issues only. Managed by `workspace.raiseIssue()` / `resolveIssue()`. |
| Messages Sent | `messages_sent` | array (`updateSemantics: 'append'`) | Every outreach message sent. The definitive record of what was communicated. |
| Emails Sent | `emails_sent` | number | Count of outreach emails in current sequence. Used for cadence gating. |
| Last Sent At | `last_sent_at` | date | ISO timestamp of most recent email. Used for timing gap checks. |
| Sequence Status | `sequence_status` | options | Current sequence state. Used for deterministic stop-signal checks. |

**Sequence Status options:** `Active`, `Replied`, `Bounced`, `Opted Out`, `Complete`, `Paused`

**Pending Tasks array example (each entry):**

```json
{
  "pending_tasks": {
    "value": [
      {
        "taskId": "t_1710842400000_a3f8k2",
        "title": "Lead interested — schedule call",
        "description": "Reply summary: Wants to see a demo.\nKey points: platform integration, timeline Q2\nSuggested response: Confirm the meeting and propose 2-3 time slots.\n\nAction: Schedule call with sales engineer",
        "owner": "sales-rep",
        "priority": "urgent",
        "createdBy": "reply-analyzer",
        "createdAt": "2026-03-16T09:15:00Z",
        "dueDate": "2026-03-16T10:15:00Z"
      }
    ]
  }
}
```

**Open Issues array example (each entry):**

```json
{
  "open_issues": {
    "value": [
      {
        "issueId": "i_1710842400000_b7k2m9",
        "title": "Lead declined — do not contact",
        "description": "Reply: \"Not interested, please remove me.\" Reason: not interested. Remove from all sequences.",
        "severity": "critical",
        "status": "open",
        "raisedBy": "reply-analyzer",
        "raisedAt": "2026-03-16T09:15:00Z"
      }
    ]
  }
}
```

**Issue severities:** `low`, `medium`, `high`, `critical`
**Issue statuses:** `open`, `investigating`, `resolved`

**Messages Sent array example (each entry):**

```json
{
  "messages_sent": {
    "value": [
      {
        "channel": "email",
        "subject": "Saw your Series B — congrats!",
        "bodyPreview": "Hi John, I noticed Acme just closed a Series B. As you scale your engineering team...",
        "step": 1,
        "angle": "Recent funding",
        "sentBy": "outreach-agent",
        "status": "sent",
        "sentAt": "2026-03-15T10:30:00Z"
      },
      {
        "channel": "email",
        "subject": "Quick follow-up on the CI/CD question",
        "bodyPreview": "Hi John, wanted to circle back on the Jenkins migration you mentioned...",
        "step": 2,
        "angle": "Tech stack migration",
        "sentBy": "outreach-agent",
        "status": "opened",
        "sentAt": "2026-03-18T09:00:00Z"
      }
    ]
  }
}
```

**Message channels:** `email`, `call`, `linkedin`
**Message statuses:** `sent`, `delivered`, `opened`, `clicked`, `replied`, `bounced`

**Sequence state scalars example:**

```json
{
  "emails_sent": { "value": 2 },
  "last_sent_at": { "value": "2026-03-18T09:00:00Z" },
  "sequence_status": { "value": "Active" }
}
```

**Why these are `autoSystem: false`:** If `sequence_status` were `autoSystem: true`, AI might "helpfully" extract "Replied" from a conversation *about* replies — corrupting the outreach engine's stop-signal logic. Same for `emails_sent` — AI guessing "2" from context would break cadence gating. These must be set precisely by code.

---

### 1.2 Companies Collection

- **Slug:** `companies`
- **Primary Key:** `website`
- **Description:** Target accounts with firmographics, buying signals, and health tracking
- **Icon:** `building` | **Color:** `#8B5CF6`

#### Identity Properties (`autoSystem: false`)

| Property Name | System Name | Type | Description |
|---|---|---|---|
| Company Name | `company_name` | text | Legal or common company name |
| Website | `website` | text | Primary company domain |
| Employee Count | `employee_count` | number | Total headcount |
| Annual Revenue | `annual_revenue` | number | Estimated annual revenue in USD |
| Headquarters | `headquarters` | text | City, State/Country of HQ |
| CRM Account ID | `crm_account_id` | text | HubSpot or Salesforce account ID |

**Example JSON:**

```json
{
  "company_name": { "value": "Acme Corp" },
  "website": { "value": "acme.com" },
  "employee_count": { "value": 250 },
  "annual_revenue": { "value": 50000000 },
  "headquarters": { "value": "San Francisco, CA" },
  "crm_account_id": { "value": "sf_001ABC" }
}
```

#### AI-Enrichable Properties (`autoSystem: true`)

| Property Name | System Name | Type | updateSemantics | Options | Description |
|---|---|---|---|---|---|
| Industry | `industry` | text | — | — | Primary industry vertical |
| Funding Stage | `funding_stage` | options | — | Bootstrapped, Seed, Series A, Series B, Series C+, Public | Current funding stage |
| Latest Funding Amount | `latest_funding_amount` | number | — | — | Most recent round amount (USD) |
| Latest Funding Date | `latest_funding_date` | date | — | — | Date of most recent round |
| Technology Stack | `technology_stack` | array | `append` | — | Technologies the company uses |
| Business Model | `business_model` | options | — | B2B, B2C, B2B2C, Marketplace, Platform | Primary business model |
| ICP Fit Score | `icp_fit_score` | number | — | — | 0-100 ICP match score |
| Buying Signals | `buying_signals` | array | `append` | — | Hiring surges, funding, tech adoption, expansion |
| Signal Strength | `signal_strength` | options | — | None, Weak, Moderate, Strong, Very Strong | Aggregate signal strength |
| Key Decision Makers | `key_decision_makers` | array | `append` | — | Names and titles of known decision makers |
| Competitors Using | `competitors_using` | array | `append` | — | Competitor products this company uses |
| Company Summary | `company_summary` | text | — | — | AI-generated summary of relevance |
| Account Status | `account_status` | options | — | New Target, Researching, Prospecting, Engaged, Opportunity, Customer, Churned, Disqualified | Account lifecycle stage |
| Hiring Velocity | `hiring_velocity` | options | — | Stable, Moderate Growth, Rapid Growth, Contracting | Current hiring trend |

**Example JSON:**

```json
{
  "industry": { "value": "Developer Tools" },
  "funding_stage": { "value": "Series B" },
  "latest_funding_amount": { "value": 35000000 },
  "latest_funding_date": { "value": "2026-01-15" },
  "technology_stack": { "value": ["React", "Node.js", "AWS", "Jenkins", "PostgreSQL"] },
  "business_model": { "value": "B2B" },
  "icp_fit_score": { "value": 88 },
  "buying_signals": { "value": ["Series B closed Jan 2026", "12 DevOps job postings", "Blog mentions Jenkins migration"] },
  "signal_strength": { "value": "Strong" },
  "key_decision_makers": { "value": ["John Smith — VP Engineering", "Sarah Lee — CTO"] },
  "competitors_using": { "value": ["Jenkins", "CircleCI"] },
  "company_summary": { "value": "B2B dev tools company, 250 employees, recently raised Series B. Actively hiring DevOps engineers and migrating CI/CD infrastructure." },
  "account_status": { "value": "Prospecting" },
  "hiring_velocity": { "value": "Rapid Growth" }
}
```

#### Account Workspace Properties — Shared Coordination Surface

**Append-only logs (`autoSystem: true`, `updateSemantics: 'append'`):**

| Property Name | System Name | Type | Description |
|---|---|---|---|
| Account Context | `account_context` | text | Current account state summary. Rewritten each strategy evaluation. |
| Account Updates | `account_updates` | array | Chronological timeline of account-level events. |
| Account Notes | `account_notes` | array | Account-level knowledge and observations. |

**Account Updates example:**

```json
{
  "account_updates": {
    "value": [
      {
        "author": "account-strategizer",
        "type": "strategy",
        "summary": "Strategy evaluated: Prospecting / healthy. 3 contacts. Flags: none.",
        "details": "Multi-thread approach: engage VP Engineering first, then CTO if positive signal.",
        "timestamp": "2026-03-15T08:00:00Z"
      },
      {
        "author": "signal-detector",
        "type": "signal",
        "summary": "New buying signal: 12 DevOps job postings detected on LinkedIn.",
        "timestamp": "2026-03-16T06:00:00Z"
      }
    ]
  }
}
```

**Account Update types:** `strategy`, `coordination`, `signal`, `escalation`, `system`, `human`

**Account Notes example:**

```json
{
  "account_notes": {
    "value": [
      {
        "author": "enrichment-agent",
        "content": "Company blog post from March 2026 details migration from Jenkins to a modern CI/CD platform. CTO quoted: 'We need something that scales with our team.'",
        "category": "competitive-intel",
        "timestamp": "2026-03-14T08:00:00Z"
      }
    ]
  }
}
```

**Account Note categories:** `observation`, `analysis`, `competitive-intel`, `strategy`, `coordination`

**Code-managed state (`autoSystem: false`):**

| Property Name | System Name | Type | Description |
|---|---|---|---|
| Account Pending Tasks | `account_pending_tasks` | array | Active account-level tasks only. Code-managed. |
| Account Open Issues | `account_open_issues` | array | Active account-level issues only. Code-managed. |

**Account Strategy (stored as scalar JSON string via `setStrategy()`):**

The `account_strategy` property stores a full strategy document as a JSON string. This is the output of the account strategizer AI.

```json
{
  "account_strategy": {
    "value": "{\"accountStage\":\"Prospecting\",\"accountHealth\":\"healthy\",\"approach\":\"Multi-thread: VP Eng first, then CTO\",\"contactRollup\":[{\"email\":\"john@acme.com\",\"name\":\"John Smith\",\"role\":\"VP of Engineering\",\"sequenceStatus\":\"Email 1 Sent\",\"engagement\":\"Neutral\",\"lastAction\":\"2026-03-15\"},{\"email\":\"sarah@acme.com\",\"name\":\"Sarah Lee\",\"role\":\"CTO\",\"sequenceStatus\":\"Not Started\",\"engagement\":\"Unknown\",\"lastAction\":\"Never\"}],\"coordinationFlags\":[],\"recommendedActions\":[{\"contact\":\"john@acme.com\",\"action\":\"Continue sequence — wait for email 2 timing\",\"rationale\":\"Email 1 sent 3 days ago, on schedule\",\"priority\":\"medium\"},{\"contact\":\"sarah@acme.com\",\"action\":\"Hold outreach until John engages\",\"rationale\":\"Avoid carpet bombing — thread through VP first\",\"priority\":\"low\"}],\"angleBlacklist\":[],\"angleRecommendations\":[\"Jenkins migration\",\"DevOps hiring surge\"],\"strategySummary\":\"Multi-thread approach: engage VP Engineering first, then CTO if positive signal. Use Jenkins migration and hiring surge as primary angles.\",\"generatedAt\":\"2026-03-15T08:00:00Z\"}"
  }
}
```

**Parsed AccountStrategy structure:**

```typescript
interface AccountStrategy {
  accountStage: string;        // "Prospecting", "Engaged", "Opportunity", etc.
  accountHealth: string;       // "healthy", "at_risk", "blocked"
  approach: string;            // High-level strategy description
  contactRollup: Array<{
    email: string;
    name: string;
    role: string;
    sequenceStatus: string;
    engagement: string;
    lastAction: string;
  }>;
  coordinationFlags: string[]; // Edge cases detected (see Section 4)
  recommendedActions: Array<{
    contact?: string;          // email or "account" for account-level
    action: string;
    rationale: string;
    priority: string;
  }>;
  angleBlacklist?: string[];        // Angles to avoid
  angleRecommendations?: string[];  // Angles to use
  strategySummary: string;
  generatedAt: string;              // ISO timestamp
}
```

**Coordination flags the AI detects:**

| Flag | Meaning |
|---|---|
| `carpet_bomb_risk` | Multiple contacts have "Not Started" at a small company — stagger outreach |
| `new_contact_at_advanced_account` | Account is engaged/opportunity but contact has "Not Started" — don't cold email |
| `negative_at_account` | A contact opted out or replied negatively — evaluate if account-level rejection |
| `previous_relationship` | Company has churned/lost deal history — adjust tone to re-engagement |
| `champion_at_risk` | Previously engaged contact shows signs of leaving — stale engagement |
| `account_converted` | Deal closed-won or account became customer — STOP all prospecting |
| `conflicting_signals` | Contacts show mixed sentiments (one positive, one negative) |
| `pending_referral` | A reply mentioned a referral — don't cold-email the referred person |
| `stale_data` | Contacts not updated in 90+ days with zero engagement |
| `negative_company_event` | Company context mentions layoffs, crisis, leadership change |

---

### 1.3 Outreach Log Collection

- **Slug:** `outreach-log`
- **Primary Key:** `contact_email`
- **Description:** Track every outreach touch for feedback loop and sequence management
- **Icon:** `mail` | **Color:** `#10B981`

| Property Name | System Name | Type | autoSystem | Options | Description |
|---|---|---|---|---|---|
| Contact Email | `contact_email` | text | false | — | Email of the recipient |
| Company | `company` | text | true | — | Recipient's company |
| Sequence Step | `sequence_step` | options | false | Email 1, Email 2, Email 3, Call Task, LinkedIn Touch | Which step in sequence |
| Channel | `channel` | options | false | Email, Phone, LinkedIn, SMS | Delivery channel |
| Subject Line | `subject_line` | text | false | — | Email subject used |
| Content Summary | `content_summary` | text | true | — | Brief summary of what was sent |
| Angle Used | `angle_used` | text | true | — | The personalization angle/hook |
| Sent At | `sent_at` | date | false | — | Timestamp of delivery |
| Opened | `opened` | boolean | false | — | Whether email was opened |
| Clicked | `clicked` | boolean | false | — | Whether any link was clicked |
| Replied | `replied` | boolean | false | — | Whether recipient replied |
| Reply Sentiment | `reply_sentiment` | options | true | Positive, Neutral, Negative, Out of Office, Unsubscribe | Sentiment of reply |
| Outcome | `outcome` | options | true | No Response, Opened, Clicked, Replied, Meeting Booked, Rejected, Bounced | Final outcome |

---

### 1.4 Web Research Collection

- **Slug:** `web-research`
- **Primary Key:** `domain`
- **Description:** Tavily web search results for company research
- **Icon:** `search` | **Color:** `#F59E0B`

| Property Name | System Name | Type | autoSystem | updateSemantics | Description |
|---|---|---|---|---|---|
| Domain | `domain` | text | false | — | Company domain researched |
| Company Name | `company_name` | text | false | — | Company name |
| Search Queries | `search_queries` | array | false | — | Tavily queries used |
| Result Count | `result_count` | number | true | — | Number of results returned |
| Top Result URL | `top_result_url` | text | true | — | URL of highest-scoring result |
| AI Summary | `ai_summary` | text | true | — | AI summary of research findings |
| Research Date | `research_date` | date | false | — | When research was performed |
| Source | `source` | options | false | — | Tavily, Exa, Manual |
| Signals Found | `signals_found` | array | true | `append` | Buying signals extracted |
| Personalization Angles | `personalization_angles` | array | true | `append` | Outreach angle ideas |
| Competitors Mentioned | `competitors_mentioned` | array | true | `append` | Competitors in results |
| Key People Mentioned | `key_people_mentioned` | array | true | `append` | Executives mentioned |
| News Headlines | `news_headlines` | array | true | `append` | Top news headlines found |
| Technology References | `technology_references` | array | true | `append` | Technologies mentioned |

---

### 1.5 Understanding `autoSystem: true` vs `autoSystem: false`

| | `autoSystem: true` | `autoSystem: false` |
|---|---|---|
| **Who writes** | AI extraction engine + your code | Your code only |
| **When AI writes** | Automatically during `memorize()` calls | Never |
| **Use for** | Data that benefits from AI interpretation | Data that must be precise |
| **Risk if wrong** | AI might misinterpret — but self-corrects over time | N/A — only your code touches it |
| **Examples** | job_title, sentiment, pain_points | email, crm_id, emails_sent, pending_tasks |

### 1.6 Understanding `updateSemantics: 'append'`

When set on an array property with `autoSystem: true`:
- AI **adds** new items without overwriting existing ones
- If a first email mentions "slow deployments" and a later conversation mentions "hiring challenges", both are preserved in the array
- Without `append`, AI would overwrite the entire array each time

---

## 2. Workspace Functions

### 2.1 Contact Workspace (`workspace`)

**Import:** `import { workspace } from '../lib/workspace.js';`

#### Write Functions (all use `arrayPush` — race-free, no read needed)

##### `workspace.addUpdate(email, update)`

Appends a timestamped entry to the `updates` array.

```typescript
await workspace.addUpdate('john@acme.com', {
  author: 'outreach-agent',
  type: 'outreach',           // enrichment | signal | outreach | engagement | system | human
  summary: 'Email 1/3 sent: "Saw your Series B" (angle: Recent funding)',
  details: 'Optional extra details',
});
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "updates",
  "arrayPush": {
    "items": [{
      "author": "outreach-agent",
      "type": "outreach",
      "summary": "Email 1/3 sent: \"Saw your Series B\" (angle: Recent funding)",
      "timestamp": "2026-03-15T10:30:00Z"
    }]
  },
  "updatedBy": "outreach-agent"
}
```

##### `workspace.addTask(email, task) → taskId`

Creates a new task in `pending_tasks`. Returns the generated task ID.

```typescript
const taskId = await workspace.addTask('john@acme.com', {
  title: 'Lead interested — schedule call',
  description: 'Reply summary: Wants a demo.\nAction: Schedule call with sales engineer',
  status: 'pending',        // accepted but NOT stored (see Section 3)
  owner: 'sales-rep',       // who should act: 'sales-rep' | 'outreach-agent' | 'enrichment-agent'
  createdBy: 'reply-analyzer',
  priority: 'urgent',       // low | medium | high | urgent
  dueDate: new Date(Date.now() + 3600_000).toISOString(),  // optional
});
// taskId = "t_1710842400000_a3f8k2"
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPush": {
    "items": [{
      "taskId": "t_1710842400000_a3f8k2",
      "title": "Lead interested — schedule call",
      "description": "Reply summary: Wants a demo.\nAction: Schedule call with sales engineer",
      "owner": "sales-rep",
      "priority": "urgent",
      "createdBy": "reply-analyzer",
      "createdAt": "2026-03-16T09:15:00Z",
      "dueDate": "2026-03-16T10:15:00Z"
    }]
  },
  "updatedBy": "reply-analyzer"
}
```

**Note:** `status: 'pending'` is accepted in the `WorkspaceTask` input type but is **not stored** in the internal `Task` type. Presence in the array = pending. Absence = done. See Section 3 for why.

##### `workspace.addNote(email, note)`

Appends a timestamped note to the `notes` array.

```typescript
await workspace.addNote('john@acme.com', {
  author: 'reply-analyzer',
  content: 'Reply Analysis:\nSentiment: POSITIVE\nSummary: Wants to see a demo',
  category: 'reply-analysis',  // observation | analysis | enrichment | signal | reply-analysis
});
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "notes",
  "arrayPush": {
    "items": [{
      "author": "reply-analyzer",
      "content": "Reply Analysis:\nSentiment: POSITIVE\nSummary: Wants to see a demo",
      "category": "reply-analysis",
      "timestamp": "2026-03-16T09:15:00Z"
    }]
  },
  "updatedBy": "reply-analyzer"
}
```

##### `workspace.raiseIssue(email, issue) → issueId`

Creates a new issue in `open_issues`. Returns the generated issue ID.

```typescript
const issueId = await workspace.raiseIssue('john@acme.com', {
  title: 'Lead declined — do not contact',
  description: 'Reply: "Not interested." Remove from all sequences.',
  severity: 'critical',    // low | medium | high | critical
  status: 'open',          // open | investigating | resolved | dismissed
  raisedBy: 'reply-analyzer',
});
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "open_issues",
  "arrayPush": {
    "items": [{
      "issueId": "i_1710842400000_b7k2m9",
      "title": "Lead declined — do not contact",
      "description": "Reply: \"Not interested.\" Remove from all sequences.",
      "severity": "critical",
      "status": "open",
      "raisedBy": "reply-analyzer",
      "raisedAt": "2026-03-16T09:15:00Z"
    }]
  },
  "updatedBy": "reply-analyzer"
}
```

##### `workspace.addMessageSent(email, message)`

Appends to `messages_sent` array AND updates scalar sequence state properties.

```typescript
await workspace.addMessageSent('john@acme.com', {
  channel: 'email',         // email | call | linkedin
  subject: 'Saw your Series B — congrats!',
  bodyPreview: 'Hi John, I noticed Acme just closed...',  // first 200 chars
  step: 1,
  angle: 'Recent funding',
  sentBy: 'outreach-agent',
  status: 'sent',           // sent | delivered | opened | clicked | replied | bounced
});
```

**CRUD operations (2 calls):**

1. Push to messages_sent array:
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "messages_sent",
  "arrayPush": {
    "items": [{
      "channel": "email",
      "subject": "Saw your Series B — congrats!",
      "bodyPreview": "Hi John, I noticed Acme just closed...",
      "step": 1,
      "angle": "Recent funding",
      "sentBy": "outreach-agent",
      "status": "sent",
      "sentAt": "2026-03-15T10:30:00Z"
    }]
  },
  "updatedBy": "outreach-agent"
}
```

2. Atomic bulk update of sequence scalars (only for email channel):
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "updates": [
    { "propertyName": "emails_sent", "propertyValue": 1 },
    { "propertyName": "last_sent_at", "propertyValue": "2026-03-15T10:30:00Z" }
  ],
  "updatedBy": "outreach-agent"
}
```

##### `workspace.rewriteContext(email, context, author)`

Overwrites the `context` scalar property with a new summary.

```typescript
await workspace.rewriteContext('john@acme.com', [
  'Status: POSITIVE REPLY — Lead interested!',
  'Priority: URGENT — respond within 1 hour.',
  'Summary: Wants to see a demo of the platform integration.',
  'Next: Schedule call with sales engineer.',
].join('\n'), 'reply-analyzer');
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "context",
  "propertyValue": "Status: POSITIVE REPLY — Lead interested!\nPriority: URGENT — respond within 1 hour.\nSummary: Wants to see a demo of the platform integration.\nNext: Schedule call with sales engineer.",
  "updatedBy": "reply-analyzer"
}
```

#### Read Functions

##### `workspace.getDigest(email, tokenBudget?)`

Returns an AI-compiled summary of the contact with all properties and memories, within the specified token budget.

```typescript
const digest = await workspace.getDigest('john@acme.com', 3000);
// digest.data.compiledContext → AI-summarized profile string
// digest.data.properties → raw property values
```

**SDK call:** `client.memory.smartDigest({ email, type: 'Contact', token_budget: 3000, include_properties: true, include_memories: true })`

##### `workspace.getSequenceState(email)`

Reads the structured sequence state using the `properties()` API. **No semantic search — deterministic and fast. No token budget needed.**

```typescript
const state = await workspace.getSequenceState('john@acme.com');
// Returns:
// {
//   emailsSent: 2,
//   lastSentAt: "2026-03-18T09:00:00Z",
//   lastEngagement: "opened",        // none | opened | clicked | replied | bounced
//   hasReplied: false,
//   hasOptedOut: false,
//   hasDraftAtStep: null              // number if a draft exists at a step
// }
```

**SDK call:** `client.memory.properties({ email, type: 'Contact', propertyNames: ['emails_sent', 'last_sent_at', 'sequence_status', 'messages_sent'] })`

##### `workspace.getOpenTasks(email) → Task[]`

Returns active tasks from `pending_tasks` (filters out completed/declined items).

```typescript
const tasks = await workspace.getOpenTasks('john@acme.com');
// Returns array of { taskId, title, description, owner, priority, createdBy, createdAt, dueDate }
// Only items where status is 'active' or not set
```

##### `workspace.getIssues(email) → Issue[]`

Returns active issues from `open_issues` (filters out resolved items).

```typescript
const issues = await workspace.getIssues('john@acme.com');
// Returns array of { issueId, title, description, severity, status, raisedBy, raisedAt }
// Only items where status is 'open' or 'investigating'
```

##### `workspace.getAllPendingTasks(limit?)`

Cross-record query: finds ALL contacts that have any pending tasks. **Deterministic, no LLM cost.**

```typescript
const result = await workspace.getAllPendingTasks(50);
// result.records → array of { recordId (email), matchedProperties: { pending_tasks: [...] } }
```

**CRUD operation:**
```json
{
  "type": "Contact",
  "conditions": [{ "propertyName": "pending_tasks", "operator": "exists" }],
  "limit": 50
}
```

#### Task Lifecycle Functions

##### `workspace.completeTask(email, taskId, outcome)`

Marks the task as completed in-place via `arrayPatch`. **Race-free — no index lookup needed.** The task stays in the array with `status: 'completed'`, and `getOpenTasks()` filters it out. History preserved by `propertyHistory()`.

```typescript
await workspace.completeTask('john@acme.com', 't_1710842400000_a3f8k2', 'Email sent: "Following up on your interest"');
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPatch": {
    "match": { "taskId": "t_1710842400000_a3f8k2" },
    "set": { "status": "completed", "outcome": "Email sent: \"Following up on your interest\"", "completedAt": "2026-03-16T10:00:00Z" }
  },
  "updatedBy": "task-executor"
}
```

##### `workspace.declineTask(email, taskId, reason, declinedBy)`

Marks the original task as declined via `arrayPatch`, then creates a new `[Escalated]` task owned by `sales-rep`.

```typescript
await workspace.declineTask('john@acme.com', 't_1710842400000_a3f8k2', 'Contact opted out', 'outreach-agent');
```

**Three CRUD operations:**

1. Mark original task declined (race-free — no index needed):
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPatch": {
    "match": { "taskId": "t_1710842400000_a3f8k2" },
    "set": { "status": "declined", "outcome": "Contact opted out", "completedAt": "2026-03-16T10:05:00Z" }
  },
  "updatedBy": "outreach-agent"
}
```

2. Push escalated replacement:
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPush": {
    "items": [{
      "taskId": "t_1710843000000_c9d2e5",
      "title": "[Escalated] Lead interested — schedule call",
      "description": "AI agent (outreach-agent) could not execute this task.\n\nReason: Contact opted out\n\nOriginal task: Lead interested — schedule call\n\nPlease review and either handle manually or provide more context.",
      "owner": "sales-rep",
      "priority": "high",
      "createdBy": "task-executor",
      "createdAt": "2026-03-16T10:05:00Z"
    }]
  },
  "updatedBy": "task-executor"
}
```

3. Also adds an update to the timeline:
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "updates",
  "arrayPush": {
    "items": [{
      "author": "task-executor",
      "type": "system",
      "summary": "Task declined: \"Lead interested — schedule call\" — Contact opted out",
      "timestamp": "2026-03-16T10:05:00Z"
    }]
  },
  "updatedBy": "task-executor"
}
```

##### `workspace.rescheduleTask(email, taskId, newDueDate, reason, rescheduledBy)`

Updates the `dueDate` in-place using `arrayPatch`. **The task stays in the array — no remove/re-add.**

```typescript
await workspace.rescheduleTask(
  'john@acme.com',
  't_1710842400000_a3f8k2',
  '2026-03-25T09:00:00Z',
  'Lead is OOO until March 25',
  'outreach-agent',
);
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPatch": {
    "match": { "taskId": "t_1710842400000_a3f8k2" },
    "set": { "dueDate": "2026-03-25T09:00:00Z" }
  },
  "updatedBy": "outreach-agent"
}
```

Also adds a timeline update about the reschedule.

##### `workspace.resolveIssue(email, issueId, resolution)`

Marks the issue as resolved in-place via `arrayPatch`. **Race-free — no index lookup needed.** The issue stays in the array with `status: 'resolved'`, and `getIssues()` filters it out.

```typescript
await workspace.resolveIssue('john@acme.com', 'i_1710842400000_b7k2m9', 'Email address verified — was a temporary bounce.');
```

**CRUD operation:**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "open_issues",
  "arrayPatch": {
    "match": { "issueId": "i_1710842400000_b7k2m9" },
    "set": { "status": "resolved", "resolution": "Email address verified — was a temporary bounce.", "resolvedAt": "2026-03-17T14:00:00Z" }
  },
  "updatedBy": "system"
}
```

#### Soft-Delete Functions

##### `workspace.softDelete(email, reason, performedBy)`

Soft-deletes the contact record. All read paths automatically exclude it. 30-day recovery window.

```typescript
await workspace.softDelete('john@acme.com', 'unsubscribe', 'engagement-webhook');
```

##### `workspace.cancelDeletion(email, performedBy)`

Cancels a pending soft-delete within the 30-day window.

```typescript
await workspace.cancelDeletion('john@acme.com', 'admin');
```

---

### 2.2 Account Workspace (`accountWorkspace`)

**Import:** `import { accountWorkspace } from '../lib/account-workspace.js';`

All functions mirror the contact workspace but operate on **Company records keyed by domain**.

| Function | Parameters | Description |
|---|---|---|
| `addUpdate(domain, update)` | `AccountUpdate` | Append to `account_updates` |
| `addTask(domain, task)` | `AccountTask` → taskId | Push to `account_pending_tasks` |
| `addNote(domain, note)` | `AccountNote` | Append to `account_notes` |
| `raiseIssue(domain, issue)` | `AccountIssue` → issueId | Push to `account_open_issues` |
| `setStrategy(domain, strategy)` | `AccountStrategy` | Overwrite `account_strategy` (JSON string) |
| `getDigest(domain, tokenBudget?)` | — | AI-compiled company summary |
| `getStrategy(domain)` | — | Parse and return `AccountStrategy` or null |
| `getOpenTasks(domain)` | — | Read `account_pending_tasks` |
| `getIssues(domain)` | — | Read `account_open_issues` |
| `getUpdates(domain)` | — | Read `account_updates` |
| `getContacts(domain)` | — | Find all contacts at this company |
| `getContactRollup(domain)` | — | All contacts + their workspace states |
| `completeTask(domain, taskId, outcome)` | — | Mark completed in `account_pending_tasks` via arrayPatch |
| `declineTask(domain, taskId, reason, declinedBy)` | — | Mark declined + escalate |
| `rescheduleTask(domain, taskId, newDueDate, reason, rescheduledBy)` | — | Patch dueDate in-place |
| `resolveIssue(domain, issueId, resolution)` | — | Mark resolved in `account_open_issues` via arrayPatch |

**Key difference — `getContactRollup(domain)`:**

This is the account workspace's most powerful read. It finds all contacts at the company and reads each one's workspace state in parallel:

```typescript
const rollup = await accountWorkspace.getContactRollup('acme.com');
// rollup.contacts → [{ email, firstName, lastName, jobTitle, leadStatus, outreachStage, leadScore, lastContacted, sentiment }]
// rollup.workspaceStates → { "john@acme.com": { sequenceStatus, emailsSent, pendingTasks, openIssues } }
```

---

## 3. Task Lifecycle — Complete Reference

### 3.1 Task Lifecycle — In-Place Status Updates

**Design decision:** Tasks are completed/declined by patching their `status` field in-place via `arrayPatch`. This avoids a race condition that existed with the previous `arrayRemove`-by-index approach, where concurrent writes could shift indices and cause the wrong task to be removed.

| Approach | How it works | Problem |
|---|---|---|
| **arrayRemove by index** (old) | Read array → find index → remove by index | Race condition: concurrent `arrayPush` between read and remove shifts indices |
| **arrayPatch by match** (current) | Match by `taskId` → set `status: 'completed'` in-place | Race-free. No index lookup. Task stays for debugging. |

**How reads stay clean:** `getOpenTasks()` filters to items where `status` is `'active'` or not set. Completed/declined items remain in the array but are invisible to callers.

**Where does history go?**
1. `propertyHistory()` — automatic CRUD audit trail. Every patch is recorded with timestamp and `updatedBy`.
2. `updates` array — human-readable timeline entry added by the caller (e.g., "Task completed: title — outcome").
3. The task itself — `outcome`, `completedAt`, and `status` fields preserved in the array for debugging.

### 3.2 Task Shape (What's Actually Stored)

```typescript
// Input type (what callers pass):
interface WorkspaceTask {
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  owner: string;
  createdBy: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  outcome?: string;
}

// Storage type (what's in the array):
interface Task {
  taskId: string;           // generated: "t_1710842400000_a3f8k2"
  title: string;
  description: string;
  owner: string;            // determines who acts
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdBy: string;        // which agent created it
  createdAt: string;        // ISO timestamp
  dueDate?: string;         // optional deadline
  status?: 'active' | 'completed' | 'declined';  // set by lifecycle functions
  outcome?: string;         // set on completion/decline
  completedAt?: string;     // set on completion/decline
}
```

### 3.3 Who Creates Tasks and When

| Creator Agent | Trigger Event | Task Title | Owner | Priority | Due Date |
|---|---|---|---|---|---|
| `reply-analyzer` | Positive reply | "Lead interested — schedule call" | `sales-rep` | urgent | +1 hour |
| `reply-analyzer` | Question reply | "Lead asked a question — answer and advance" | `sales-rep` | high | +4 hours |
| `reply-analyzer` | OOO auto-reply | "Reschedule outreach — lead is OOO until {date}" | `outreach-agent` | low | return date |
| `reply-analyzer` | Referral reply | "Follow up with referral: {name}" | `sales-rep` | high | +24 hours |
| `reply-analyzer` | Neutral reply | "Review ambiguous reply" | `sales-rep` | medium | none |
| `outreach-agent` | Reply detected mid-sequence | "Review reply and respond personally" | `sales-rep` | urgent | +1 hour |
| `outreach-agent` | Sequence complete, no reply | "Sequence complete — evaluate for next steps" | `sales-rep` | medium | none |
| `account-strategizer` | Strategy evaluation (account-level action) | varies | `sales-rep` | varies | varies |
| `account-strategizer` | Strategy evaluation (contact-level action) | varies | auto-detected* | varies | varies |
| `analyze-call` | Meeting booked | "Meeting booked — prepare" | `sales-rep` | urgent | varies |
| `analyze-call` | Callback requested | "Callback requested for {date}" | `outreach-agent` | high | requested date |
| `analyze-call` | Wrong person | "Find correct contact" | `sales-rep` | medium | varies |
| `analyze-call` | Voicemail/no answer | "Retry call" | `outreach-agent` | low | +2 days |
| `analyze-call` | Neutral call outcome | "Review call transcript" | `sales-rep` | medium | none |
| `engagement-webhook` | Reply without body captured | "Reply received — check inbox and respond" | `sales-rep` | urgent | +1 hour |
| `linkedin-event` | LinkedIn engagement | varies | varies | varies | varies |

*Auto-detection from action text: if action mentions "email/outreach/send" → `outreach-agent`; "enrich/research" → `enrichment-agent`; otherwise → `sales-rep`.

### 3.4 How Tasks Are Discovered

The **task executor scheduler** runs every 30 minutes (`cron: "*/30 * * * *"`):

```
Step 1: workspace.getAllPendingTasks(limit)
        → filterByProperty({ conditions: [{ propertyName: 'pending_tasks', operator: 'exists' }] })
        → Returns all contacts that have ANY pending tasks (deterministic, no LLM cost)

Step 2: For each contact's tasks, filter by owner:
        → Only pick up AI-owned tasks (owner in TASK_EXECUTOR_CONFIG.actionableOwners)
        → Skip 'sales-rep' tasks (human-only)
        → Skip stale tasks (older than maxTaskAgeDays)

Step 3: Trigger child Trigger.dev task for each actionable task
        → executeWorkspaceTask.trigger({ contactEmail, taskId, task })
        → Concurrency limited by TASK_EXECUTOR_CONFIG.concurrencyLimit
```

### 3.5 The Four Decisions

When a task is picked up for execution, it is routed by owner:
- `outreach-agent` → `handleOutreachTask()` (deterministic: preflight → generate email → send)
- Everything else → `handleGenericTask()` (AI evaluates with full workspace context + governance)

The AI (or deterministic handler) returns one of four decisions:

#### EXECUTE — Task is done

```
What happens:
  1. workspace.completeTask(email, taskId, outcome)
     → arrayPatch: match by taskId, set status='completed', outcome, completedAt
     → Task stays in array but getOpenTasks() filters it out
  2. workspace.addUpdate(email, { type: 'system', summary: 'Task completed: "title" — outcome' })
     → Logs completion to the timeline

CRUD calls:
  arrayPatch   → /memory/update  (marks task completed in pending_tasks)
  arrayPush    → /memory/update  (appends to updates timeline)

Result: Task marked completed. Visible in propertyHistory + updates array + task itself.
```

#### DECLINE — Can't do it, escalate to human

```
What happens:
  1. workspace.declineTask(email, taskId, reason, declinedBy)
     → arrayPatch: match by taskId, set status='declined', outcome=reason, completedAt
     → workspace.addTask() with title "[Escalated] {original title}"
       → owner: 'sales-rep' (so AI won't re-pick it)
       → priority: 'high'
       → description includes the reason and original task details
     → workspace.addUpdate() logs the decline
  2. notifySlack('Task Declined... Escalated to sales rep.')

CRUD calls:
  arrayPatch   → /memory/update  (marks original declined)
  arrayPush    → /memory/update  (creates escalated replacement)
  arrayPush    → /memory/update  (timeline update)

Result: Original task marked declined. New "[Escalated]" task created for human. Slack notified.
```

#### RESCHEDULE — Not now, change the date

```
What happens:
  1. workspace.rescheduleTask(email, taskId, newDueDate, reason, rescheduledBy)
     → arrayPatch: match by taskId, set new dueDate
     → Task STAYS in the array with updated dueDate
     → workspace.addUpdate() logs the reschedule
  2. Next scheduler run (30 min later) will pick it up again and re-evaluate

CRUD calls:
  arrayPatch   → /memory/update  (updates dueDate in-place)
  arrayPush    → /memory/update  (timeline update)

Result: Task stays in array with new date. No remove, no re-create.
```

#### SKIP — Already done or irrelevant

```
What happens:
  1. workspace.completeTask(email, taskId, 'Skipped: {reason}')
     → Same as EXECUTE — task marked completed with 'Skipped' outcome
  2. workspace.addUpdate(email, { type: 'system', summary: 'Task skipped: "title" — reason' })

CRUD calls:
  arrayPatch   → /memory/update  (marks task completed with skip reason)
  arrayPush    → /memory/update  (timeline update)

Result: Task marked completed. Outcome string records why it was skipped.
```

### 3.6 Failure Safety

If the Trigger.dev child task **crashes after all retries**:

```typescript
onFailure: async (payload, error) => {
  // Auto-decline so the task doesn't stay stuck
  await workspace.declineTask(
    payload.contactEmail,
    payload.taskId,
    `Execution failed after retries: ${error.message}`,
    payload.task.owner,
  );
  // This creates an [Escalated] task for sales-rep
};
```

### 3.7 Concurrency Safety

| Operation | CRUD Method | Race-Safe? | How |
|---|---|---|---|
| Create task | `arrayPush` | Yes | Append-only, no read needed |
| Complete/Skip | `arrayPatch` | Yes | Match by `taskId`, set status in-place. No index lookup. |
| Decline | `arrayPatch` + `arrayPush` | Yes | Patch original, push escalated. Both race-free. |
| Reschedule | `arrayPatch` | Yes | Match by `taskId`, update dueDate in-place. No read needed. |

All task lifecycle operations use `arrayPatch` with match-by-ID, eliminating the previous race condition where concurrent writes could shift array indices between read and remove.

---

## 4. If-This-Then-That Flows

Every event in the system triggers a chain of workspace operations. Here is every flow:

### 4.1 Email Sent (Outreach Sequence)

```
TRIGGER: Outreach engine sends an email to a contact
SOURCE:  outreach-sequence.ts → generateOutreachForContact()

THEN:
  1. workspace.addMessageSent(email, { channel: 'email', step, angle, ... })
     → arrayPush to messages_sent
     → Scalar update: emails_sent = step number
     → Scalar update: last_sent_at = now

  2. workspace.addUpdate(email, { author: 'outreach-agent', type: 'outreach', summary: 'Email N/3 sent: "subject"' })
     → arrayPush to updates

  3. workspace.rewriteContext(email, 'Status: Email N sent. Waiting for engagement.')
     → Scalar overwrite of context
```

### 4.2 Email Opened

```
TRIGGER: SendGrid webhook fires 'open' event
SOURCE:  webhooks.ts → engagementWebhookTask

THEN:
  1. workspace.addUpdate(email, { type: 'engagement', summary: 'Email OPENED' })
     → arrayPush to updates

  2. IF not already replied or opted out:
     workspace.rewriteContext(email, 'Email N sent. Lead OPENED the email. Signal: Interested.')
     → Scalar overwrite of context
```

### 4.3 Link Clicked

```
TRIGGER: SendGrid webhook fires 'click' event
SOURCE:  webhooks.ts → engagementWebhookTask

THEN:
  1. workspace.addUpdate(email, { type: 'engagement', summary: 'Email CLICKED — clicked: {url}' })
     → arrayPush to updates

  2. IF not already replied or opted out:
     workspace.rewriteContext(email, 'Lead CLICKED: {url}. Signal: Interested.')
     → Scalar overwrite of context
```

### 4.4 Reply Received

```
TRIGGER: SendGrid webhook fires 'reply' event
SOURCE:  webhooks.ts → engagementWebhookTask → replyHandlerTask → analyzeReply()

THEN:
  1. workspace.addUpdate(email, { type: 'engagement', summary: 'Email REPLY' })
  2. workspace.addNote(email, { content: 'Reply received. Preview: ...', category: 'reply-analysis' })
  3. workspace.rewriteContext(email, 'Sequence Status: REPLIED — analyzing reply...')

  4. AI classifies reply sentiment → handleAnalyzedReply() →

     IF sentiment = POSITIVE:
       → workspace.addNote(email, { content: 'Reply Analysis: POSITIVE...', category: 'reply-analysis' })
       → workspace.addTask(email, { title: 'Lead interested — schedule call', owner: 'sales-rep', priority: 'urgent', dueDate: +1hr })
       → workspace.rewriteContext(email, 'Status: POSITIVE REPLY — Lead interested!')
       → createHubSpotFollowUpTask() (CRM task)
       → notifySlack('Positive reply!')

     IF sentiment = QUESTION:
       → workspace.addNote(email, { ... })
       → workspace.addTask(email, { title: 'Lead asked a question', owner: 'sales-rep', priority: 'high', dueDate: +4hr })
       → workspace.rewriteContext(email, 'Status: QUESTION — Lead engaged, needs more info.')
       → createHubSpotFollowUpTask()
       → notifySlack('Question from lead')

     IF sentiment = NEGATIVE:
       → workspace.raiseIssue(email, { title: 'Lead declined — do not contact', severity: 'critical' })
       → workspace.addUpdate(email, { summary: 'Negative reply. Marked as opted out.' })
       → workspace.rewriteContext(email, 'Status: OPTED OUT — Negative reply received.')
       → client.memory.memorize() with { lead_status: 'Disqualified', outreach_stage: 'Opted Out' }
       → notifySlack('Negative reply')
       (No task created — sequence stops permanently)

     IF sentiment = OOO:
       → workspace.addTask(email, { title: 'Reschedule outreach — OOO until {date}', owner: 'outreach-agent', priority: 'low', dueDate: return_date })
       → workspace.rewriteContext(email, 'Status: OUT OF OFFICE until {date}.')
       (Task executor will pick this up and reschedule the sequence)

     IF sentiment = REFERRAL:
       → workspace.addTask(email, { title: 'Follow up with referral: {name}', owner: 'sales-rep', priority: 'high', dueDate: +24hr })
       → workspace.rewriteContext(email, 'Status: REFERRAL — Lead redirected to another person.')
       → createHubSpotFollowUpTask()
       → notifySlack('Referral received')

     IF sentiment = NEUTRAL:
       → workspace.addTask(email, { title: 'Review ambiguous reply', owner: 'sales-rep', priority: 'medium' })
       → workspace.rewriteContext(email, 'Status: UNCLEAR — Ambiguous reply, needs human review.')

  5. IF account strategy enabled:
     → evaluateAccountStrategy(domain)
     → Re-evaluates the entire account based on the new reply signal
```

### 4.5 Email Bounced

```
TRIGGER: SendGrid webhook fires 'bounce' event
SOURCE:  webhooks.ts → engagementWebhookTask

THEN:
  1. workspace.addUpdate(email, { type: 'engagement', summary: 'Email BOUNCE' })
  2. workspace.raiseIssue(email, { title: 'Email bounced', severity: 'high', raisedBy: 'engagement-webhook' })
  3. workspace.rewriteContext(email, 'Status: BOUNCED — email delivery failed.')
```

### 4.6 Unsubscribe / Spam Report

```
TRIGGER: SendGrid webhook fires 'unsubscribe' or 'spamreport' event
SOURCE:  webhooks.ts → engagementWebhookTask

THEN:
  1. workspace.softDelete(email, reason, 'engagement-webhook')
     → /memory/delete-record
     → ALL read paths now automatically exclude this record (404 on reads)
     → 30-day recovery window via cancelDeletion()

  2. workspace.rewriteContext(email, 'Status: STOPPED (unsubscribe). Do not contact again.')
  3. notifySlack('Unsubscribe / SPAM REPORT from {email} — record soft-deleted')
```

### 4.7 Sequence Complete (No Reply)

```
TRIGGER: All 3 emails sent, no stop-signal detected
SOURCE:  outreach-sequence.ts → fullSequenceTask

THEN:
  1. IF LinkedIn enabled:
     → Generate and send LinkedIn connection request
  2. IF call enabled and ICP score high enough:
     → Generate call script and execute call

  3. workspace.addTask(email, { title: 'Sequence complete — evaluate for next steps', owner: 'sales-rep', priority: 'medium' })
     → description includes what multi-channel actions were taken

  4. workspace.rewriteContext(email, 'Status: COMPLETE (3/3 emails, no reply).')
```

### 4.8 Sequence Stopped Mid-Way

```
TRIGGER: Stop signal detected before next email in sequence
SOURCE:  outreach-sequence.ts → shouldStopSequence() + recordSequenceStopped()

IF reason = 'replied':
  → workspace.addUpdate(email, { summary: 'Sequence stopped after email N: replied' })
  → workspace.addTask(email, { title: 'Review reply and respond personally', owner: 'sales-rep', priority: 'urgent', dueDate: +1hr })
  → notifySlack('Reply detected!')

IF reason = 'opted_out' or 'not_interested':
  → workspace.addUpdate(email, { summary: 'Sequence stopped: opted out' })
  → workspace.raiseIssue(email, { title: 'Lead opted out of communications', severity: 'critical' })

IF reason = 'bounced':
  → workspace.addUpdate(email, { summary: 'Sequence stopped: bounced' })
  → workspace.raiseIssue(email, { title: 'Email bounced — invalid address', severity: 'high' })

ALWAYS:
  → workspace.rewriteContext(email, 'Sequence Status: STOPPED ({reason}) after email {N}.')
```

### 4.9 Call Completed

```
TRIGGER: AI voice call finishes
SOURCE:  analyze-call.ts → analyzeCall()

THEN:
  1. Memorize full call transcript to Personize memory
  2. AI classifies call outcome →

     IF outcome = INTERESTED or MEETING_BOOKED:
       → workspace.addTask(email, { title: 'Meeting booked — prepare', owner: 'sales-rep', priority: 'urgent' })
       → workspace.addNote(email, { content: 'Call analysis: INTERESTED...', category: 'analysis' })
       → createHubSpotFollowUpTask()
       → notifySlack('Meeting booked!')

     IF outcome = CALLBACK_REQUESTED:
       → workspace.addTask(email, { title: 'Callback requested for {date}', owner: 'outreach-agent', priority: 'high', dueDate: requested_date })

     IF outcome = NOT_INTERESTED:
       → workspace.raiseIssue(email, { title: 'Lead declined on call', severity: 'critical' })
       → workspace.addTask(email, { title: 'Remove from sequences', owner: 'sales-rep', priority: 'high' })

     IF outcome = WRONG_PERSON:
       → workspace.raiseIssue(email, { title: 'Wrong contact reached', severity: 'medium' })
       → workspace.addTask(email, { title: 'Find correct contact at company', owner: 'sales-rep', priority: 'medium' })

     IF outcome = VOICEMAIL or NO_ANSWER:
       → workspace.addTask(email, { title: 'Retry call', owner: 'outreach-agent', priority: 'low', dueDate: +2days })

     IF outcome = NEUTRAL:
       → workspace.addTask(email, { title: 'Review call transcript', owner: 'sales-rep', priority: 'medium' })

  3. workspace.rewriteContext(email, 'Call completed: {outcome}. {summary}')
  4. IF account strategy enabled → evaluateAccountStrategy(domain)
```

### 4.10 Account Strategy Evaluation

```
TRIGGER: Triggered after reply analysis, signal detection, or on schedule
SOURCE:  account-strategy.ts → evaluateAccountStrategy(domain)

THEN:
  1. GATHER (in parallel):
     → accountWorkspace.getDigest(domain)         // company profile + memories
     → accountWorkspace.getStrategy(domain)        // previous strategy
     → accountWorkspace.getIssues(domain)          // active account issues
     → accountWorkspace.getContactRollup(domain)   // all contacts + workspace states
     → client.ai.smartGuidelines()                 // governance rules

  2. AI evaluates: account stage, health, coordination flags, recommended actions

  3. PERSIST:
     → accountWorkspace.setStrategy(domain, strategy)
     → accountWorkspace.addUpdate(domain, { type: 'strategy', summary: 'Strategy evaluated...' })

  4. CREATE TASKS from recommended actions:
     → For each action targeting a specific contact:
       workspace.addTask(contactEmail, { title: action, owner: auto-detected, ... })
     → For account-level actions:
       accountWorkspace.addTask(domain, { title: action, owner: 'sales-rep', ... })
```

### 4.11 Task Execution (Every 30 Minutes)

```
TRIGGER: Cron schedule — every 30 minutes
SOURCE:  task-executor.ts → taskExecutorScheduler

THEN:
  1. workspace.getAllPendingTasks(limit)
     → filterByProperty: find all contacts with pending_tasks

  2. For each contact's tasks:
     → Filter: only AI-owned tasks, skip sales-rep, skip stale
     → executeWorkspaceTask.trigger({ contactEmail, taskId, task })

  3. For each triggered task:
     → workspace.addUpdate(email, { summary: 'Picking up task: "title"' })

     → Route by owner:
       IF owner = 'outreach-agent' → handleOutreachTask()
         → preflight check (opted out? bounced? critical issue?)
         → IF blocked → DECLINE
         → IF OOO reschedule → RESCHEDULE
         → generate email → send → addMessageSent → EXECUTE

       ELSE → handleGenericTask()
         → preflight check
         → assembleContext (governance + contact + company + outreach history)
         → AI decides: EXECUTE / DECLINE / RESCHEDULE / SKIP
         → IF EXECUTE + send_email → send email + addMessageSent
         → IF EXECUTE + notify_slack → send Slack notification
         → IF EXECUTE + default → add a note with AI output

     → Apply decision:
       EXECUTE    → completeTask (arrayPatch status='completed') + addUpdate
       DECLINE    → declineTask (arrayPatch status='declined' + new [Escalated] task) + notifySlack
       RESCHEDULE → rescheduleTask (arrayPatch dueDate) + addUpdate
       SKIP       → completeTask with "Skipped: reason" (arrayPatch) + addUpdate

  4. IF task execution crashes after retries:
     → onFailure: declineTask (auto-escalate to sales-rep)
```

### 4.12 HubSpot CRM Webhook

```
TRIGGER: HubSpot webhook fires (deal stage change)
SOURCE:  webhooks.ts → hubspotWebhookTask

THEN:
  → client.memory.memorize({ content: '[CRM EVENT] Deal stage changed to: {stage}' })
  (Stored in memory for future context assembly)
```

### 4.13 Reply Without Body (Webhook Edge Case)

```
TRIGGER: Reply event where payload.body is empty/null
SOURCE:  webhooks.ts → engagementWebhookTask

THEN:
  1. workspace.addNote(email, { content: 'Reply received. Body not captured — check inbox.' })
  2. workspace.rewriteContext(email, 'Sequence Status: REPLIED — analyzing reply...')
  3. workspace.addTask(email, { title: 'Reply received — check inbox and respond', owner: 'sales-rep', priority: 'urgent', dueDate: +1hr })
  4. notifySlack('Reply received! Action: Check inbox — reply body not captured')
  (No AI analysis — goes straight to human)
```

---

## 5. API Endpoints

### 5.1 Memory CRUD API (Direct HTTP)

Base URL: `https://api.personize.ai/api/v1/memory/`
Auth: `Bearer {PERSONIZE_SECRET_KEY}`
Method: All `POST`

| Endpoint | Function | Used For |
|---|---|---|
| `/memory/update` | `memoryCrud.update()` | Write single property: scalar, arrayPush, arrayRemove, arrayPatch |
| `/memory/bulk-update` | `memoryCrud.bulkUpdate()` | Atomic multi-property update on one record |
| `/memory/filter-by-property` | `memoryCrud.filterByProperty()` | Deterministic query — find records by conditions |
| `/memory/property-history` | `memoryCrud.propertyHistory()` | Audit trail — who changed what and when |
| `/memory/delete-record` | `memoryCrud.deleteRecord()` | Soft-delete (30-day recovery window) |
| `/memory/cancel-deletion` | `memoryCrud.cancelDeletion()` | Undo a soft-delete within 30 days |

#### `/memory/update` — Request body variants

**Scalar write (overwrite value):**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "emails_sent",
  "propertyValue": 2,
  "updatedBy": "outreach-agent"
}
```

**arrayPush (append to array — race-free, no read needed):**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPush": {
    "items": [{ "taskId": "t_123", "title": "...", "owner": "sales-rep", "priority": "urgent", "createdBy": "reply-analyzer", "createdAt": "2026-03-16T09:15:00Z" }],
    "unique": false
  },
  "updatedBy": "reply-analyzer"
}
```

**arrayPatch (update item in-place by match — used for completeTask, declineTask, resolveIssue, rescheduleTask):**
```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "propertyName": "pending_tasks",
  "arrayPatch": {
    "match": { "taskId": "t_1710842400000_a3f8k2" },
    "set": { "dueDate": "2026-03-25T09:00:00Z" }
  },
  "updatedBy": "outreach-agent"
}
```

#### `/memory/update` — Response

```json
{
  "success": true,
  "data": {
    "success": true,
    "previousValue": 1,
    "newValue": 2,
    "version": 5,
    "stores": {
      "snapshot": "updated",
      "lancedb": "updated",
      "freeform": "skipped"
    }
  }
}
```

#### `/memory/filter-by-property` — Request

```json
{
  "type": "Contact",
  "conditions": [
    { "propertyName": "pending_tasks", "operator": "exists" }
  ],
  "logic": "AND",
  "limit": 50
}
```

**Available operators:** `equals`, `notEquals`, `contains`, `gt`, `lt`, `gte`, `lte`, `exists`, `isEmpty`

#### `/memory/filter-by-property` — Response

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "recordId": "john@acme.com",
        "type": "Contact",
        "matchedProperties": {
          "pending_tasks": [
            { "taskId": "t_123", "title": "...", "owner": "sales-rep" }
          ]
        },
        "lastUpdatedAt": 1710842400000
      }
    ],
    "totalMatched": 1,
    "nextToken": null
  }
}
```

#### `/memory/property-history` — Request

```json
{
  "recordId": "john@acme.com",
  "propertyName": "pending_tasks",
  "from": "2026-03-01T00:00:00Z",
  "to": "2026-03-19T23:59:59Z",
  "limit": 20
}
```

#### `/memory/property-history` — Response

```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "entryId": "ph_001",
        "propertyName": "pending_tasks",
        "propertyValue": [{ "taskId": "t_123", "title": "Lead interested — schedule call" }],
        "collectionId": "contacts",
        "updatedBy": "reply-analyzer",
        "createdAt": "2026-03-16T09:15:00Z",
        "source": "arrayPush"
      },
      {
        "entryId": "ph_002",
        "propertyName": "pending_tasks",
        "propertyValue": [],
        "collectionId": "contacts",
        "updatedBy": "task-executor",
        "createdAt": "2026-03-16T10:00:00Z",
        "source": "arrayRemove"
      }
    ],
    "nextToken": null
  }
}
```

#### `/memory/delete-record` — Request

```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "reason": "unsubscribe",
  "performedBy": "engagement-webhook"
}
```

#### `/memory/cancel-deletion` — Request

```json
{
  "recordId": "john@acme.com",
  "type": "Contact",
  "performedBy": "admin"
}
```

### 5.2 Personize SDK Methods

These are native SDK calls through the `client` object.

| Method | Used For | Where |
|---|---|---|
| `client.memory.properties({ email, type, propertyNames, nonEmpty })` | Read specific properties from a record — lightweight, no LLM cost | `readProperty()`, `readProperties()`, `getSequenceState()`, `getContactRollup()` |
| `client.memory.smartDigest({ email, type, token_budget, include_properties, include_memories })` | Read a record's full AI-compiled summary within token budget | `getDigest()` |
| `client.memory.search({ websiteUrl, type, returnRecords })` | Find records by attribute (e.g., all contacts at a domain) | `accountWorkspace.getContacts(domain)` |
| `client.memory.memorize({ email, content, collectionName, properties, tags })` | Store unstructured text + properties (triggers AI extraction for `autoSystem: true`) | Reply analysis, enrichment, call transcripts |
| `client.ai.prompt({ context, instructions })` | AI inference with context + governance | `handleGenericTask()` — AI evaluates task |
| `client.ai.smartGuidelines({ message, mode })` | Fetch relevant governance rules | Reply analysis, account strategy, outreach generation |
| `client.collections.list()` | List existing collections | Schema setup |
| `client.collections.create({ name, slug, properties, ... })` | Create collection with property schema | Schema setup |

### 5.3 Endpoint Usage by Lifecycle Stage

| Stage | Endpoints Used |
|---|---|
| **Create task** | `/memory/update` (arrayPush) |
| **Find tasks** | `/memory/filter-by-property` |
| **Read properties** | `client.memory.properties()` |
| **Read full context** | `client.memory.smartDigest()` |
| **AI decision** | `client.ai.prompt()` + `client.ai.smartGuidelines()` |
| **Complete task** | `/memory/update` (arrayPatch → status='completed') |
| **Decline task** | `/memory/update` (arrayPatch → status='declined') + `/memory/update` (arrayPush escalated) |
| **Reschedule task** | `/memory/update` (arrayPatch → dueDate) |
| **Skip task** | `/memory/update` (arrayPatch → status='completed', outcome='Skipped') |
| **Audit** | `/memory/property-history` |
| **Opt-out** | `/memory/delete-record` |
| **Undo opt-out** | `/memory/cancel-deletion` |
