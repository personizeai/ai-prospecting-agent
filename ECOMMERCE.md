# Revenue OS for Ecommerce — Personalized Win-Back & Promotional Campaigns

Revenue OS can replace generic email marketing templates with deeply personalized, AI-generated content for each customer — based on their actual purchase history, style preferences, and behavioral patterns.

**What you get:** Instead of "Hey [first_name], check out our sale!", your customers get emails that reference their specific purchases, infer their style, and recommend products that actually match their taste.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│  YOUR STORE                                                   │
│                                                               │
│  Option A: Export CSVs → data/purchases.csv, products.csv     │
│  Option B: Zapier → memorize purchases in real-time           │
│  Option C: API → POST to Personize webhook on each order      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  REVENUE OS                                                   │
│                                                               │
│  1. sync-ecommerce    → memorize products + purchase history  │
│  2. infer-preferences → style, price tier, segment, affinity  │
│  3. generate variables → headline, paragraphs, CTA,           │
│                          image prompt, product recs            │
│                                                               │
│  Each variable is personal to THIS customer.                  │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  YOUR ESP (Klaviyo / Mailchimp / Braze / SendGrid)            │
│                                                               │
│  Inject variables into your template:                         │
│    {{headline}}, {{short_paragraph}}, {{cta_text}},           │
│    {{product_recommendations}}, {{image_prompt}}              │
│                                                               │
│  You control layout, branding, send timing.                   │
│  We control the words, recommendations, and personalization.  │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Prepare Your Data

Place two CSV files in the `data/` directory:

**`data/purchases.csv`** — Customer purchase history:
```csv
email,product_id,product_name,purchase_date,amount,currency,quantity,category,location,order_id,metadata
sarah@example.com,SKU-1001,Classic White Sneakers,2025-11-15,89.99,USD,1,Footwear,New York,ORD-50001,size:9;color:white
sarah@example.com,SKU-2003,Minimalist Leather Belt,2025-12-02,45.00,USD,1,Accessories,New York,ORD-50102,color:black
```

**`data/products.csv`** — Your product catalog:
```csv
product_id,name,description,category,price,currency,reviews_avg,reviews_count,tags,image_url
SKU-1001,Classic White Sneakers,"Clean all-white leather sneakers...",Footwear,89.99,USD,4.6,342,sneakers;minimal;everyday,https://...
```

Example CSV files are included in `data/` — use them as templates.

### 2. Import Data

```bash
# Via CLI
npx tsx src/pipelines/sync-ecommerce.ts

# Or via MCP tool (if using Claude)
# → ecommerce_sync
```

This will:
- Import your product catalog into the `Products` collection
- Memorize each purchase on the customer's contact record
- Compute aggregate stats: total orders, total spent, favorite categories, first/last purchase dates

### 3. Infer Preferences

```bash
# Via MCP tool
# → ecommerce_infer_preferences with emails: ["sarah@example.com", ...]
```

This analyzes each customer's purchase history and writes:
- **style_preferences** — "minimalist streetwear with earth tones, gravitates toward sustainable materials"
- **price_tier** — Budget / Mid-Range / Premium / Luxury
- **customer_segment** — New / Active / Loyal / VIP / At-Risk / Lapsed / Win-Back
- **product recommendations** — SKUs from your catalog that match their style but they haven't bought yet

### 4. Generate Personalized Variables

```bash
# Via MCP tool
# → ecommerce_generate_variables with email: "sarah@example.com", campaign_type: "winback"
```

Returns structured JSON:

```json
{
  "email": "sarah@example.com",
  "campaignType": "winback",
  "headline": "Your favorite sneakers are back — and they brought friends",
  "subheadline": "We noticed you're into minimalist silhouettes with a retro edge.",
  "shortParagraph": "It's been a few months since you picked up those Classic Whites and the Retro Runners. We've been saving some picks that match your style — clean lines, quality materials, and that understated cool you keep coming back for.",
  "longParagraph": "The Heavyweight Hoodie just dropped in a new slate colorway that pairs perfectly with your sneaker rotation. And since you gravitate toward the $80-130 range, we pulled three pieces that hit your sweet spot without compromise. Over 400 customers have rated the Hoodie 4.9/5 — it's becoming the closet essential of the season.",
  "imagePrompt": "lifestyle photo: person in minimalist white sneakers and earth-tone hoodie walking through sunlit city street, golden hour, clean aesthetic, shot on film",
  "ctaText": "See What's New For You",
  "productRecommendations": ["SKU-3012", "SKU-3005", "SKU-4001"],
  "angle": "Style affinity: minimalist streetwear + retro sneaker collector returning after 3-month gap",
  "subjectLine": "We saved something for you, Sarah",
  "previewText": "3 new picks that match your minimalist style — and they're going fast."
}
```

### 5. Use in Your ESP

Inject these variables into your Klaviyo / Mailchimp / Braze template:

| Template Variable | Source |
|---|---|
| `{{headline}}` | `headline` |
| `{{subheadline}}` | `subheadline` |
| `{{body_short}}` | `shortParagraph` |
| `{{body_long}}` | `longParagraph` |
| `{{cta_text}}` | `ctaText` |
| `{{subject}}` | `subjectLine` |
| `{{preview}}` | `previewText` |
| `{{image_prompt}}` | Feed to DALL-E / Midjourney for hero image |
| `{{product_1}}, {{product_2}}, ...` | Look up `productRecommendations` SKUs |

---

## Campaign Types

Revenue OS supports 4 ecommerce campaign types, each with a different generation strategy:

| Type | Trigger | Tone | Example |
|---|---|---|---|
| **winback** | Customer hasn't purchased in 60+ days | Warm, personal, "we missed you" | Re-engage lapsed customers |
| **post-purchase** | Customer just bought something | Helpful, complementary recs | Cross-sell after order |
| **promotional** | Scheduled sale or new arrivals | Curated, style-matched | Black Friday, seasonal drops |
| **seasonal** | Calendar event or season change | Occasion-relevant, personal | Summer collection, holiday gifts |

Each type adjusts the AI prompt to generate appropriate tone, urgency, and content structure.

---

## Agent Modes

Three ecommerce agent modes are pre-configured in `src/config/agent-modes.ts`:

- **`ecommerce-winback`** — Re-engage lapsed customers. 3-email sequence: "we miss you" → social proof → incentive.
- **`post-purchase`** — Cross-sell after purchase. 3-4 emails: order tips → complementary products → review request → replenishment.
- **`cart-abandonment`** — Recover abandoned carts. 3 emails: reminder → objection handling → final incentive.

Set via `AGENT_MODE=ecommerce-winback` in `.env`, or per-campaign via the `agent_mode` property.

---

## Real-Time Integration via Zapier

Instead of CSV batch imports, you can memorize purchases in real-time:

1. **Trigger:** New order in Shopify / WooCommerce / BigCommerce
2. **Action:** Personize → Memorize Record
   - Email: `{{customer_email}}`
   - Collection: `contacts`
   - Content: `[PURCHASE] {{product_name}} — ${{amount}} on {{date}}`
   - Properties: `total_orders`, `total_spent`, `last_purchase_date`, `purchased_product_ids`

Revenue OS's event-driven webhook (`src/trigger/personize-webhook.ts`) can then auto-enroll new purchases into campaigns, score customers, and trigger outreach sequences.

---

## MCP Tools Reference

Three new MCP tools are available for ecommerce workflows:

| Tool | What It Does |
|---|---|
| `ecommerce_sync` | Import products + purchases from CSV. Computes customer aggregates. |
| `ecommerce_infer_preferences` | Analyze purchase history → write style, price tier, segment to contact. |
| `ecommerce_generate_variables` | Generate personalized email variables for any campaign type. |

These work alongside all existing Revenue OS tools (campaigns, senders, daily status, etc.).

---

## Data Schema

### Products Collection (new)

| Property | Type | Description |
|---|---|---|
| `product_id` | text | Unique SKU |
| `name` | text | Product name |
| `description` | text | Full description |
| `category` | text | Product category |
| `price` | number | Price |
| `reviews_avg` | number | Average rating (0-5) |
| `reviews_count` | number | Number of reviews |
| `tags_list` | array | Tags for matching |

### Ecommerce Properties on Contacts (new)

| Property | Type | Description |
|---|---|---|
| `total_orders` | number | Lifetime order count |
| `total_spent` | number | Lifetime spend (USD) |
| `last_purchase_date` | date | Most recent purchase |
| `first_purchase_date` | date | First-ever purchase |
| `favorite_categories` | array | Top categories by frequency |
| `style_preferences` | text | AI-inferred style profile |
| `price_tier` | options | Budget / Mid-Range / Premium / Luxury |
| `customer_segment` | options | New / Active / Loyal / VIP / At-Risk / Lapsed / Win-Back |
| `purchased_product_ids` | array | SKUs purchased (for dedup) |

---

## Full Pipeline: Batch Win-Back Campaign

```bash
# 1. Export purchases + products from your store as CSV
# 2. Place in data/

# 3. Import everything
npx tsx src/pipelines/sync-ecommerce.ts

# 4. Create a win-back campaign
npm run ros -- campaign:create --name "Spring Win-Back 2026" --cadence standard --daily-cap 50

# 5. The outreach engine picks up enrolled customers and generates
#    personalized emails using their purchase history + preferences.
#    Set AGENT_MODE=ecommerce-winback in .env for win-back playbook.

# 6. Or generate variables for your own ESP:
#    Use ecommerce_generate_variables MCP tool per customer
```

---

## Compared to Generic Email Marketing

| | Generic ESP | Revenue OS |
|---|---|---|
| **Personalization** | First name + segment | Purchase history, style inference, product matching |
| **Content** | Same template for segment | Unique copy per customer |
| **Recommendations** | Collaborative filtering | AI reasoning over purchase patterns + catalog |
| **Image** | Same hero for everyone | AI image prompt per customer aesthetic |
| **Learning** | A/B test subject lines | Weekly angle-to-outcome analysis across all variables |
| **Cost** | $500-2K/mo for ESP + content team | $50-200/mo in API costs |
