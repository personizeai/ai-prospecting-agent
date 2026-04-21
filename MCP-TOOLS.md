# Revenue OS — MCP Tools Reference

19 tools available to AI assistants (Claude, Cowork, OpenClaw, Cursor) via the Revenue OS MCP server.

**Setup:** A `.mcp.json` is included in the repo root. Credentials are read from your `.env` file — no extra configuration needed.

**Required env vars:** `PERSONIZE_SECRET_KEY` (always). `APOLLO_API_KEY` (for discovery/enrichment tools). `TAVILY_API_KEY` (for research tool).

---

## Contact Discovery & Enrichment

### `apollo_search_contacts`

Search Apollo for contacts at a company. **FREE — 0 Apollo credits.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Company domain (e.g., `"acme.com"`) |
| `titles` | string[] | No | Job titles to match (e.g., `["CTO", "VP Engineering"]`) |
| `seniorities` | string[] | No | Seniority levels: `c_suite`, `vp`, `director`, `manager`, `senior`, `entry` |
| `departments` | string[] | No | Departments to filter (e.g., `["engineering", "product"]`) |
| `per_page` | number | No | Results per page, 1-100 (default: 25) |

**Example response:**
```json
{
  "total": 47,
  "page": 1,
  "contacts": [
    {
      "name": "Sarah Chen",
      "title": "Chief Technology Officer",
      "email": "sarah@acme.com",
      "email_status": "verified",
      "linkedin": "https://linkedin.com/in/sarah-chen",
      "seniority": "c_suite",
      "departments": ["engineering"],
      "company": "Acme Corp"
    }
  ]
}
```

---

### `apollo_enrich_contact`

Enrich a contact with Apollo data. **Costs 1 Apollo credit.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | Email address to enrich |

**Example response:**
```json
{
  "name": "Sarah Chen",
  "title": "Chief Technology Officer",
  "email": "sarah@acme.com",
  "linkedin": "https://linkedin.com/in/sarah-chen",
  "phone": "+1-555-123-4567",
  "seniority": "c_suite",
  "departments": ["engineering"],
  "company": {
    "name": "Acme Corp",
    "domain": "acme.com",
    "industry": "Computer Software",
    "employees": 250,
    "funding": "$40M"
  }
}
```

---

### `apollo_enrich_company`

Enrich a company with Apollo data. **Costs 1 Apollo credit.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Company domain (e.g., `"acme.com"`) |

**Example response:**
```json
{
  "name": "Acme Corp",
  "domain": "acme.com",
  "industry": "Computer Software",
  "employees": 250,
  "revenue": "$25M",
  "funding": "$40M",
  "funding_stage": "Series B",
  "founded": 2018,
  "technologies": ["React", "Node.js", "AWS", "PostgreSQL"],
  "keywords": ["developer tools", "API platform", "devops"],
  "location": "San Francisco, CA, United States",
  "description": "Acme Corp builds developer tools for modern engineering teams."
}
```

---

### `discover_and_memorize_contacts`

Search Apollo for contacts at a company, memorize them to Personize, and optionally enroll in a campaign. **All-in-one discovery tool.** Apollo search is FREE (0 credits).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Company domain to search |
| `titles` | string[] | No | Target job titles |
| `seniorities` | string[] | No | Target seniority levels |
| `campaign_id` | string | No | Campaign to enroll qualified contacts in |
| `max_contacts` | number | No | Max contacts to memorize (default: 10) |

**Example response:**
```
Found 12 contacts at acme.com, processed 10:

  ✓ Sarah Chen (CTO) → enrolled in fintech-q2, sender: sp_alice
  ✓ Mike Ross (VP Engineering) → enrolled in fintech-q2, sender: sp_alice
  ✓ Lisa Park (Director of Engineering) → enrolled in fintech-q2, sender: sp_alice
  ✓ James Wu (Senior Engineer) → memorized, not enrolled: ICP score 25 (below 40 threshold)
  ✓ Anna Lee (Product Manager) → memorized, not enrolled: Already in campaign "healthcare-cios"
  ✗ John Doe (no valid email)

Memorized: 5 | Skipped: 1
```

**ICP filtering:** When `campaign_id` is provided and the campaign has `icp_criteria` set, each contact is scored against the criteria before enrollment. Contacts scoring below 40 are memorized to Personize but not enrolled in the campaign. Contacts without a campaign_id are always memorized regardless of ICP score.

---

## Web Research

### `research_company`

Research a company via Tavily web search. Returns AI summary + recent news, funding, hiring signals.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `company` | string | Yes | Company name or domain |
| `query` | string | No | Specific research query (default: `"[company] news funding hiring product launch recent"`) |

**Example response:**
```json
{
  "query": "Acme Corp news funding hiring product launch recent",
  "ai_summary": "Acme Corp recently raised a $40M Series B led by Sequoia Capital. The company is expanding its engineering team with 15 open positions and launched a new API platform for enterprise developers.",
  "top_results": [
    {
      "title": "Acme Corp Raises $40M Series B to Scale Developer Tools",
      "url": "https://techcrunch.com/2026/03/15/acme-corp-series-b",
      "content": "Acme Corp, the developer tools startup, announced a $40M Series B round...",
      "published": "2026-03-15"
    }
  ]
}
```

---

## Campaign Management

### `campaign_create`

Create a new outreach campaign.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Campaign name (ID auto-generated from name) |
| `market` | string | No | Target market description (e.g., `"US Enterprise Fintech"`) |
| `cadence` | `"aggressive"` \| `"standard"` \| `"enterprise"` | No | Cadence preset (default: `"standard"`) |
| `daily_cap` | number | No | Max emails per day, 0 = unlimited (default: 0) |
| `sender_ids` | string[] | No | Sender profile IDs to allocate to this campaign |
| `max_emails` | number | No | Max emails in sequence (default: 3) |
| `icp_criteria` | string | No | JSON ICP criteria for webhook auto-enrollment (e.g., `'{"industries":["fintech"],"seniorities":["c_suite","vp"]}'`) |
| `governance_overrides` | string[] | No | Guideline IDs for campaign-specific governance |

**Example response:**
```
Campaign "Fintech CTOs Q2" created (ID: fintech-ctos-q2). Status: Draft.
To activate: use campaign_activate tool.
To enroll contacts: use campaign_enroll tool.
```

---

### `campaign_list`

List all campaigns with status and stats. **No parameters.**

**Example response:**
```json
[
  {
    "id": "fintech-ctos-q2",
    "name": "Fintech CTOs Q2",
    "status": "Active",
    "market": "US Enterprise Fintech",
    "enrolled": 89,
    "reached": 47,
    "emails_sent": 112,
    "replies": 6,
    "positive_replies": 3,
    "reply_rate": "13%",
    "meetings": 1
  },
  {
    "id": "healthcare-cios",
    "name": "Healthcare CIOs",
    "status": "Draft",
    "market": "US Healthcare",
    "enrolled": 0,
    "reached": 0,
    "emails_sent": 0,
    "replies": 0,
    "positive_replies": 0,
    "reply_rate": "0%",
    "meetings": 0
  }
]
```

---

### `campaign_stats`

Get detailed stats for a specific campaign.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | Yes | Campaign ID |

**Example response:**
```json
{
  "campaign": {
    "id": "fintech-ctos-q2",
    "name": "Fintech CTOs Q2",
    "status": "Active",
    "market": "US Enterprise Fintech",
    "cadence": "standard",
    "daily_cap": 30,
    "senders": ["sp_alice"]
  },
  "stats": {
    "contacts_enrolled": 89,
    "contacts_reached": 47,
    "emails_sent": 112,
    "replies": 6,
    "positive_replies": 3,
    "meetings_booked": 1,
    "bounced": 2,
    "opted_out": 1,
    "emails_sent_today": 12,
    "reply_rate": "13%",
    "positive_rate": "6%"
  }
}
```

---

### `campaign_activate`

Set a campaign to Active. The outreach engine will start processing it on the next scheduler cycle (10am + 2pm UTC, Mon-Fri).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | Yes | Campaign ID to activate |

**Example response:**
```
Campaign "fintech-ctos-q2" is now Active.
⚠️ DRY_RUN is enabled — emails will be generated but NOT sent. Set DRY_RUN=false in .env to go live.
```

---

### `campaign_pause`

Pause a campaign. Stops new outreach. In-flight sequences complete their current email but won't send the next.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | Yes | Campaign ID to pause |

**Example response:**
```
Campaign "fintech-ctos-q2" paused.
```

---

### `campaign_enroll`

Enroll contacts in a campaign. Assigns a sender from the campaign's pool, sets `campaign_id` on each contact, prevents duplicate enrollment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | Yes | Campaign ID |
| `emails` | string[] | Yes | Email addresses to enroll |

**Example response:**
```
✓ sarah@acme.com → sender: sp_alice
✓ mike@techco.com → sender: sp_alice
✗ lisa@bigcorp.com — Already in campaign "healthcare-cios"
✗ old@invalid.com — Campaign "fintech-ctos-q2" not found
```

---

## Sender & Status

### `sender_list`

List all sender profiles with health, capacity, and warmup status. **No parameters.**

**Example response:**
```json
[
  {
    "id": "sp_alice",
    "name": "Alice Smith",
    "persona": "technical",
    "active": true,
    "health": 94,
    "daily_limit": 15,
    "sent_today": 8,
    "remaining": 7,
    "warming_up": true,
    "warmup_day": 5,
    "lifetime": { "sent": 47, "bounced": 2, "replies": 6 }
  },
  {
    "id": "sp_bob",
    "name": "Bob Johnson",
    "persona": "executive",
    "active": false,
    "health": 28,
    "daily_limit": 0,
    "sent_today": 0,
    "remaining": 0,
    "warming_up": false,
    "lifetime": { "sent": 312, "bounced": 45, "replies": 18 },
    "pause_reason": "Auto-paused: health score 28 (45 bounces / 312 sent)"
  }
]
```

---

### `daily_status`

Get today's metrics, campaign summary, and items needing attention. **No parameters.**

**Example response:**
```json
{
  "outreach": {
    "emailsSent": 23,
    "byStep": { "Email 1": 12, "Email 2": 8, "Email 3": 3 },
    "sequencesCompleted": 3,
    "optedOut": 0
  },
  "replies": {
    "total": 4,
    "bySentiment": { "positive": 2, "question": 1, "negative": 1 }
  },
  "pipeline": {
    "signalsDetected": 5,
    "contactsEnriched": 12,
    "companiesResearched": 3
  },
  "capacity": {
    "gmailRemaining": 77,
    "gmailTotal": 100
  },
  "needs_attention": [
    { "type": "positive_reply", "description": "2 positive replies awaiting follow-up", "priority": "high" }
  ],
  "active_campaigns": [
    { "name": "Fintech CTOs Q2", "id": "fintech-ctos-q2", "enrolled": 89, "reached": 47, "replies": 6, "positive": 3 }
  ],
  "dry_run": true
}
```

---

### `daily_brief`

Read the latest daily brief (same content posted to Slack by the daily digest). Useful at the start of a conversation for instant context. **No parameters.**

**Example response:**
```
[DAILY BRIEF 2026-04-03]
📊 *Prospecting Agent — Daily Report*

*Outreach*
• Emails sent: 23 (12 Email 1, 8 Email 2, 3 Email 3)
• Replies: 4 (2 positive, 1 question, 1 negative)
• Sequences completed: 3
• Opted out: 0

*Pipeline Activity*
• Signals detected: 5
• Contacts enriched: 12
• Companies researched: 3

*Pipeline Health*
• Personize: ✅ (120ms)
• Gmail capacity: 77/100 remaining
• Apollo: ✅ 847 credits remaining
• Tavily: ✅ OK

*Campaigns*
• 🟢 Fintech CTOs Q2: 47 reached, 6 replies (13%), 3 positive (6%)

🔴 2 positive replies awaiting follow-up
```

---

## Ecommerce

### `ecommerce_sync`

Import ecommerce data (product catalog + purchase history) from CSV files. Memorizes products to the Products collection and purchases to customer Contact records. Computes aggregate stats (total orders, total spent, categories) per customer. **No parameters** — reads from `data/products.csv` and `data/purchases.csv`.

**Example response:**
```
Ecommerce sync complete:
  Products imported: 247
  Purchases memorized: 1,832
  Customers updated: 456

Next step: run ecommerce_infer_preferences to analyze customer preferences.
```

---

### `ecommerce_infer_preferences`

Analyze customers' purchase history and infer style preferences, price tier, segment, and product recommendations. Writes inferred properties back to each contact record.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `emails` | string[] | Yes | Customer email addresses to analyze |

**Example response:**
```
Preference inference complete:
  Processed: 50
  Inferred: 43
  Skipped (no data): 7

Customer profiles now have: style_preferences, price_tier, customer_segment.
These properties are automatically used by outreach generation for personalization.
```

**Properties written per customer:**
- `style_preferences` (text) — AI-inferred style profile: aesthetic, color preferences, brand affinity, price sensitivity
- `price_tier` (options) — Budget, Mid-Range, Premium, or Luxury
- `customer_segment` (options) — New, Active, Loyal, VIP, At-Risk, Lapsed, Win-Back

---

### `ecommerce_generate_variables`

Generate personalized email variables for an ecommerce customer, ready to inject into any ESP template (Klaviyo, Mailchimp, Braze). Uses purchase history + inferred preferences for deep personalization.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | Customer email address |
| `campaign_type` | `"winback"` \| `"post-purchase"` \| `"promotional"` \| `"seasonal"` | No | Campaign type (default: `"winback"`) |
| `campaign_id` | string | No | Campaign ID for campaign-specific governance |

**Example response:**
```json
{
  "headline": "We found something you'll love, Sarah",
  "body_paragraph_1": "Based on your recent purchases in activewear and running shoes, we thought you'd want to see our new spring collection.",
  "body_paragraph_2": "Your favorite brands just dropped new styles — including 3 items in your preferred price range.",
  "cta_text": "Shop Your Picks",
  "cta_url": "https://store.example.com/recommended?customer=sarah",
  "image_prompt": "Athletic woman in spring activewear, running outdoors, bright natural lighting",
  "product_recommendations": [
    { "product_id": "SKU-1234", "name": "CloudRun Pro Shoes", "price": 129, "reason": "Matches your running gear purchases" },
    { "product_id": "SKU-5678", "name": "BreatheFit Tank", "price": 45, "reason": "Top-rated in your preferred category" }
  ],
  "personalization_notes": "Customer is a Loyal segment, Premium price tier. Last purchase was 45 days ago (approaching At-Risk). Win-back framing recommended."
}
```

---

## Contact Search

### `search_contacts`

Search and filter contacts in Personize memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | No | Filter by campaign |
| `lead_status` | string | No | Filter by status: `New`, `Researching`, `Qualified`, `Contacted`, `Engaged`, `Meeting Set`, `Opportunity`, `Customer`, `Disqualified` |
| `sequence_status` | string | No | Filter by sequence: `Active`, `Replied`, `Bounced`, `Opted Out`, `Complete`, `Paused` |
| `icp_match` | boolean | No | Filter by ICP match |
| `query` | string | No | Free-text semantic search across contact memories |
| `limit` | number | No | Max results (default: 20) |

**Example (filter by campaign + replied):**
```json
{
  "total": 3,
  "contacts": [
    {
      "email": "sarah@acme.com",
      "name": "Sarah Chen",
      "title": "CTO",
      "company": "Acme Corp",
      "status": "Engaged",
      "sequence": "Replied",
      "campaign": "fintech-ctos-q2",
      "score": 82,
      "sentiment": "Positive"
    }
  ]
}
```

**Example (free-text search):**

Use `query` without filters for semantic search:
```
query: "contacts who mentioned pricing or budget"
```

---

## Notes

- All tools return JSON in the `content[0].text` field (MCP standard format)
- If a required API key is missing (Apollo, Tavily), the tool returns an error message instead of failing
- Campaign stats are read from stored properties (0 compute cost per query)
- The `discover_and_memorize_contacts` tool is the primary "find and add leads" tool — it combines Apollo search + Personize memorize + campaign enrollment in one call
- DRY_RUN mode affects outreach delivery only, not MCP tools. All tools work in both modes.
