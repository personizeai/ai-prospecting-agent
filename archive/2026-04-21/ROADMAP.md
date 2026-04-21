# Roadmap

> Want to work on something? Comment on the linked issue or open a new one. We love PRs!

## Recently Shipped

- [x] **Campaign Management** — first-class Campaign entity with ICP targeting, cadence config, sender pools, governance overrides, daily caps, A/B variant schema, and aggregate stats
- [x] **MCP Server** — 16 tools for AI assistants (Claude, Cowork, OpenClaw): Apollo search/enrich, Tavily research, campaign CRUD, contact discovery + enrollment, sender health, daily status
- [x] **Campaign CLI** — `npm run ros` commands for campaign:create, list, stats, activate, pause, enroll, sender:list, status
- [x] **Campaign-Aware Outreach** — outreach engine queries per campaign, respects daily caps, loads campaign governance, passes campaign context through entire pipeline
- [x] **Event-Driven Architecture** — Personize webhook receives memorize events, scores ICP, matches to campaigns, auto-enrolls with sender assignment
- [x] **Learning Loop** — weekly angle-to-outcome analysis, playbook suggestions, posted to Slack + memorized for Claude
- [x] **Auto-Pause Underperformers** — daily digest checks campaign health, auto-pauses if reply rate < 1% after 50+ contacts reached
- [x] **Campaign Analytics** — daily time-series snapshots per campaign, daily brief memorized for Claude context
- [x] **Outreach Attribution** — campaign_id + variant on outreach-log for per-campaign angle performance analysis
- [x] **Ecommerce Engine** — Product catalog sync, purchase history import, AI preference inference (style, price tier, segment), personalized email variables for ESPs (Klaviyo, Mailchimp, Braze)
- [x] **Ecommerce MCP Tools** — 3 tools: `ecommerce_sync`, `ecommerce_infer_preferences`, `ecommerce_generate_variables`
- [x] **AI-powered reply classification** — intent classification (6 types), sentiment analysis, auto-routing
- [x] **Sender Profiles** — stable IDs, health tracking, warmup ramp, email rotation, persona matching

## In Progress

- [ ] Dashboard campaign views and analytics charts
- [ ] A/B testing logic — variant assignment during enrollment, variant-aware governance routing, per-variant stats
- [ ] Revenue attribution — deal/pipeline tracking with CRM writeback

## Up Next

### Campaign Intelligence
- [ ] **Campaign templates** — preset governance + ICP + cadence bundles for quick launch — [claim this](../../issues/new?title=feat:+campaign+templates&labels=help+wanted,campaign)
- [ ] **Campaign cloning** — duplicate a winning campaign for a new market — [claim this](../../issues/new?title=feat:+campaign+cloning&labels=help+wanted,campaign)
- [ ] **Per-campaign scheduling** — custom send times per campaign instead of global 10am/2pm — [claim this](../../issues/new?title=feat:+per-campaign+scheduling&labels=help+wanted,campaign)
- [ ] **Cross-campaign analytics** — compare campaigns side-by-side — [claim this](../../issues/new?title=feat:+cross-campaign+analytics&labels=help+wanted,campaign)

### New Data Connectors
- [ ] **Clearbit** enrichment integration — [claim this](../../issues/new?title=feat:+Clearbit+connector&labels=help+wanted,connector)
- [ ] **ZoomInfo** enrichment integration — [claim this](../../issues/new?title=feat:+ZoomInfo+connector&labels=help+wanted,connector)
- [ ] **LinkedIn Sales Navigator** data source — [claim this](../../issues/new?title=feat:+LinkedIn+connector&labels=help+wanted,connector)
- [ ] **Lusha** contact enrichment — [claim this](../../issues/new?title=feat:+Lusha+connector&labels=help+wanted,connector)

### New Outreach Channels
- [ ] **SMS via Twilio** — [claim this](../../issues/new?title=feat:+Twilio+SMS+channel&labels=help+wanted,channel)
- [ ] **WhatsApp Business** — [claim this](../../issues/new?title=feat:+WhatsApp+channel&labels=help+wanted,channel)

### New CRM Integrations
- [ ] **Pipedrive** sync — [claim this](../../issues/new?title=feat:+Pipedrive+CRM+sync&labels=help+wanted,crm)
- [ ] **Zoho CRM** sync — [claim this](../../issues/new?title=feat:+Zoho+CRM+sync&labels=help+wanted,crm)
- [ ] **Attio** sync — [claim this](../../issues/new?title=feat:+Attio+CRM+sync&labels=help+wanted,crm)
- [ ] **Close.com** sync — [claim this](../../issues/new?title=feat:+Close+CRM+sync&labels=help+wanted,crm)

### Pipeline Improvements
- [ ] Multi-language outreach support — [claim this](../../issues/new?title=feat:+multi-language+outreach&labels=help+wanted,pipeline)
- [ ] Custom cadence builder UI — [claim this](../../issues/new?title=feat:+cadence+builder+UI&labels=help+wanted,pipeline)
- [ ] Meeting booking integration (Calendly, Cal.com) — [claim this](../../issues/new?title=feat:+meeting+booking&labels=help+wanted,pipeline)

### MCP Server Extensions
- [ ] **Trigger outreach sequence** — MCP tool to start sequence for a contact — [claim this](../../issues/new?title=feat:+MCP+trigger+outreach&labels=help+wanted,mcp)
- [ ] **Account workspace** — MCP tool to read/write account strategy — [claim this](../../issues/new?title=feat:+MCP+account+workspace&labels=help+wanted,mcp)
- [ ] **Create sender profile** — MCP tool for sender management — [claim this](../../issues/new?title=feat:+MCP+create+sender&labels=help+wanted,mcp)
- [ ] **Generate call script** — MCP tool for voice call preparation — [claim this](../../issues/new?title=feat:+MCP+call+scripts&labels=help+wanted,mcp)
- [ ] **Signal detection** — MCP tool to run signal scan on specific accounts — [claim this](../../issues/new?title=feat:+MCP+signal+scan&labels=help+wanted,mcp)

### Developer Experience
- [ ] Docker Compose one-click setup — [claim this](../../issues/new?title=feat:+Docker+Compose+setup&labels=good+first+issue)
- [ ] Terraform/Pulumi deploy templates — [claim this](../../issues/new?title=feat:+IaC+deploy+templates&labels=help+wanted)

---

**Have an idea not listed here?** [Open a feature request](../../issues/new?labels=feature+request) — we read every one.
