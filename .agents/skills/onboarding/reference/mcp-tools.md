# MCP Tools Reference (for Skills)

This is a condensed reference of Revenue OS MCP tools (19 total) for use within skills (onboarding, strategy-review). For full documentation with example responses, see `MCP-TOOLS.md` in the repo root.

## Tool Inventory

### Discovery (require APOLLO_API_KEY)

| Tool | Cost | Use When |
|------|------|----------|
| `apollo_search_contacts` | FREE | Finding contacts at a target company. Pass domain + title/seniority filters. |
| `apollo_enrich_contact` | 1 credit | Getting full details on a specific contact (phone, LinkedIn, company data). |
| `apollo_enrich_company` | 1 credit | Getting company firmographics (funding, revenue, tech stack, employees). |
| `discover_and_memorize_contacts` | FREE search | **Primary discovery tool.** Searches Apollo → memorizes to Personize → enrolls in campaign. All-in-one. |

### Research (requires TAVILY_API_KEY)

| Tool | Use When |
|------|----------|
| `research_company` | Researching a company before outreach. Returns AI summary + recent news/funding/hiring signals. |

### Campaigns

| Tool | Use When |
|------|----------|
| `campaign_create` | User wants to start a new outreach campaign. Creates with ICP, cadence, senders, governance. |
| `campaign_list` | User asks "what campaigns do I have?" or needs an overview. |
| `campaign_stats` | User asks "how's campaign X doing?" Returns all stats. |
| `campaign_activate` | Setting a draft campaign to Active. Warns about DRY_RUN. |
| `campaign_pause` | Stopping a campaign. In-flight sequences finish current email. |
| `campaign_enroll` | Adding contacts to a campaign. Handles sender assignment + duplicate prevention. |

### Status & Search

| Tool | Use When |
|------|----------|
| `sender_list` | User asks about sender health, capacity, warmup status. |
| `daily_status` | User asks "how's everything going?" Returns metrics + campaigns + attention items. |
| `daily_brief` | Start of conversation — get context on what happened recently. |
| `search_contacts` | Finding contacts by campaign, status, ICP match, or free-text query. |

### Ecommerce

| Tool | Use When |
|------|----------|
| `ecommerce_sync` | Importing product catalog + purchase history from CSV files in `data/`. No parameters. |
| `ecommerce_infer_preferences` | After sync — analyzes purchase history to infer style, price tier, customer segment per contact. |
| `ecommerce_generate_variables` | Generating personalized email variables (headline, body, CTA, recommendations) for ESP templates. |

## Key Parameters Quick Reference

**apollo_search_contacts:** `domain` (required), `titles`, `seniorities`, `departments`, `per_page`

**discover_and_memorize_contacts:** `domain` (required), `titles`, `seniorities`, `campaign_id`, `max_contacts`

**campaign_create:** `name` (required), `market`, `cadence` (aggressive/standard/enterprise), `daily_cap`, `sender_ids`, `max_emails`, `icp_criteria` (JSON string), `governance_overrides`

**campaign_enroll:** `campaign_id` (required), `emails` (required, string array)

**search_contacts:** `campaign_id`, `lead_status`, `sequence_status`, `icp_match`, `query`, `limit`

**ecommerce_infer_preferences:** `emails` (required, string array)

**ecommerce_generate_variables:** `email` (required), `campaign_type` (winback/post-purchase/promotional/seasonal), `campaign_id`
