# Production Hardening Guide

This document covers the production-hardening features added to the AI Prospecting Agent: structured LLM outputs, email validation, named cadences, structured logging, health monitoring, and the daily Slack digest.

---

## Structured LLM Output Parsing

All 6 pipeline files now enforce JSON output from the LLM instead of relying on fragile regex parsing.

### How It Works

Every pipeline appends a JSON format instruction to the LLM prompt using `buildJsonInstruction()`. The LLM is told to respond with valid JSON only. The response is then parsed by `parseLLMJson()`, which:

1. **Tries JSON extraction first** — handles bare JSON, code-fenced JSON (` ```json ... ``` `), and JSON embedded in text
2. **Falls back to regex KEY:VALUE parsing** — if JSON parsing fails, the legacy pattern still works (zero-risk rollout)
3. **Validates and coerces fields** — numbers, booleans, arrays, and enum values are type-checked and coerced to the correct type

### Schema Definitions

Each pipeline has a schema in `src/lib/llm-schemas.ts`:

| Schema | Pipeline | Fields |
|--------|----------|--------|
| `OUTREACH_EMAIL_SCHEMA` | `generate-outreach.ts` | subject, body_html, body_text, angle |
| `SIGNAL_ASSESSMENT_SCHEMA` | `detect-signals.ts` | icp_fit_score, signal_strength, buying_window, reasoning, recommended_action |
| `REPLY_ANALYSIS_SCHEMA` | `analyze-reply.ts` | sentiment, summary, key_points, urgency, next_action, suggested_response, return_date, referred_contact |
| `TASK_DECISION_SCHEMA` | `execute-task.ts` | decision, reason, new_due_date, action, subject, body, angle |
| `COMPANY_RESEARCH_SCHEMA` | `research-company.ts` | company_summary, key_news, buying_signals, competitive_landscape, personalization_angles |
| `CONTACT_SOURCING_SCHEMA` | `source-contacts.ts` | roles (array) |

### Usage in Pipelines

```typescript
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import { OUTREACH_EMAIL_SCHEMA, OUTREACH_EMAIL_DEFAULTS } from '../lib/llm-schemas.js';

// In the prompt:
const formatInstruction = buildJsonInstruction(OUTREACH_EMAIL_SCHEMA);
// Append formatInstruction to the end of your prompt

// After getting the LLM response:
const { data, usedFallback, errors } = parseLLMJson(
  llmOutput,
  OUTREACH_EMAIL_SCHEMA,
  OUTREACH_EMAIL_DEFAULTS,
);

if (usedFallback) {
  console.warn('JSON parsing failed, used regex fallback', { errors });
}

const { subject, body_html, body_text, angle } = data;
```

### Type Coercion

The parser handles common LLM quirks automatically:

| LLM Output | Expected Type | Result |
|-------------|--------------|--------|
| `"85"` | `number` | `85` |
| `"yes"` | `boolean` | `true` |
| `"false"` | `boolean` | `false` |
| `"funding, hiring, expansion"` | `string[]` | `["funding", "hiring", "expansion"]` |
| `"OPEN"` | `enum` (case-insensitive) | `"open"` |

### Adding a New Pipeline Schema

1. Define the schema in `src/lib/llm-schemas.ts`:
   ```typescript
   export const MY_SCHEMA: SchemaMap = {
     field_name: {
       description: 'What this field contains',
       type: 'string',  // 'string' | 'number' | 'boolean' | 'string[]'
       required: true,
       // enumValues: ['option1', 'option2'],  // optional
     },
   };

   export const MY_DEFAULTS = {
     field_name: '',
   };
   ```

2. Use `buildJsonInstruction(MY_SCHEMA)` in your prompt
3. Parse with `parseLLMJson(output, MY_SCHEMA, MY_DEFAULTS)`

---

## Email HTML Validation

All outbound email HTML is sanitized before sending using `validateEmailHtml()` in `src/lib/email-html.ts`.

### Allowed Tags

`<p>`, `<b>`, `<i>`, `<strong>`, `<em>`, `<a>`, `<br>`, `<ul>`, `<ol>`, `<li>`

### What Gets Stripped

- **Disallowed tags**: `<div>`, `<span>`, `<img>`, `<table>`, `<tr>`, `<td>`, `<script>`, `<style>` — text content is preserved
- **Inline styles**: `style="..."` attributes
- **Event handlers**: `onclick`, `onmouseover`, etc.
- **Class/ID attributes**: `class="..."`, `id="..."`
- **Dangerous links**: `<a href="javascript:...">` — removed entirely
- **Anchor tags without href**: `<a>text</a>` — text kept, tag removed

### Auto-wrapping

Bare text (no HTML tags) is automatically wrapped in `<p>` tags, split by double newlines.

```typescript
import { validateEmailHtml } from '../lib/email-html.js';

const { valid, sanitized, errors } = validateEmailHtml(llmGeneratedHtml);

if (errors.length > 0) {
  console.warn('HTML sanitization warnings:', errors);
}

// Always use `sanitized` — it's safe to send even if `valid` is false
```

---

## Email Validation

Outbound email addresses are validated before sending via `src/lib/email-validator.ts`.

### Checks

| Check | Description |
|-------|-------------|
| **Format** | RFC 5322 regex + length limits (254 total, 64 local part) |
| **Consecutive dots** | `user..name@example.com` rejected |
| **Leading/trailing dots** | `.user@example.com` rejected |
| **Disposable domains** | 40+ known disposable email providers (mailinator, guerrillamail, yopmail, etc.) |
| **Role accounts** | `info@`, `sales@`, `admin@`, `noreply@`, `support@`, etc. |

### Where It's Used

- `sendViaGmail()` — throws before sending if email is invalid
- `generateOutreachForContact()` — can be used for early rejection

```typescript
import { isValidEmail, validateEmail } from '../lib/email-validator.js';

// Quick check
if (!isValidEmail(email)) throw new Error('Invalid email');

// Full validation with reason
const result = validateEmail(email);
if (!result.valid) {
  console.warn(`Email rejected: ${result.reason}`);
  // reason: 'invalid_format' | 'too_long' | 'disposable_domain' | 'role_account' | 'missing'
}
```

---

## Named Cadences

Email sequences are no longer hardcoded to 3 emails with fixed timing. The system supports multiple named cadences that are auto-selected based on ICP score.

### Built-in Cadences

| Cadence | Emails | Wait Days | Auto-Selected When |
|---------|--------|-----------|-------------------|
| **Aggressive** | 3 | 2, 3 | ICP score >= 80 |
| **Standard** | 3 | 3, 5 | ICP score 50-79 |
| **Enterprise** | 4 | 5, 7, 10 | ICP score 0-49 |

### How Auto-Selection Works

```
ICP Score 90 → Aggressive (3 emails, fast pace — hot lead, strike while iron is hot)
ICP Score 65 → Standard (3 emails, moderate pace — good fit, standard approach)
ICP Score 30 → Enterprise (4 emails, slow pace — large account, longer sales cycle)
No score     → Standard (default)
```

### Configuration

Edit cadences in `src/config/prospecting.config.ts`:

```typescript
export const CADENCES: Record<string, CadenceDefinition> = {
  aggressive: {
    maxEmails: 3,
    waitDays: [2, 3],       // 2 days after email 1, 3 days after email 2
    label: 'Hot leads (score 80+)',
  },
  standard: {
    maxEmails: 3,
    waitDays: [3, 5],
    label: 'Default cadence',
  },
  enterprise: {
    maxEmails: 4,
    waitDays: [5, 7, 10],   // 4 emails with longer gaps
    label: 'Large accounts — longer runway',
  },
};
```

### Adding a Custom Cadence

1. Add the cadence definition to `CADENCES`
2. Add a score threshold in `CADENCE_RULES.scoreThresholds` (checked top to bottom)
3. Ensure `waitDays.length === maxEmails - 1`

```typescript
// Example: nurture cadence for very low scores
nurture: {
  maxEmails: 5,
  waitDays: [7, 14, 21, 30],
  label: 'Low-priority — monthly nurture',
},
```

### Outreach Sequence Loop

The outreach sequence (`src/trigger/outreach-sequence.ts`) dynamically loops over `cadence.maxEmails`, checking for stop signals before each email and using durable waits (`wait.for({ days })`) between them. The sequence logs which cadence was selected and includes it in all workspace updates.

---

## Structured Logging

A structured JSON logger in `src/lib/logger.ts` replaces `console.log/warn/error` calls.

### Features

- **JSON lines output** (ndjson) — each log line is a parseable JSON object
- **Log levels**: `debug`, `info`, `warn`, `error` — controlled by `LOG_LEVEL` env var (default: `info`)
- **Request ID propagation** via `AsyncLocalStorage` — no dependencies
- **Child loggers** — `logger.child({ pipeline, contactEmail })` for scoped metadata

### Usage

```typescript
import { logger, withContext } from '../lib/logger.js';

// Basic logging
logger.info('Email sent', { contactEmail, step: 2 });
logger.warn('Fallback used', { pipeline: 'outreach' });
logger.error('API failed', { error: err.message });

// Scoped logger
const log = logger.child({ pipeline: 'detect-signals' });
log.info('Processing company', { domain: 'acme.com' });

// Request context (auto-injected into all logs within the scope)
await withContext({ requestId: ctx.run.id, pipeline: 'outreach' }, async () => {
  logger.info('Starting sequence');  // requestId automatically included
});
```

### Output Format

```json
{"timestamp":"2026-03-11T10:00:00.000Z","level":"info","message":"Email sent","contactEmail":"jane@acme.com","step":2,"requestId":"run_abc123","pipeline":"outreach"}
```

---

## Health Checks

Automated health monitoring runs every 15 minutes via `src/trigger/health-check.ts`.

### What Gets Checked

| Check | Healthy | Degraded | Unhealthy |
|-------|---------|----------|-----------|
| **Personize API** | Responds with latency | — | Connection failed |
| **Gmail capacity** | > 20% remaining | < 20% remaining | — |
| **Apollo API key** | Configured | — | Missing |
| **Tavily API key** | Configured | — | Missing |
| **HubSpot API key** | Configured | — | Missing |

### Alerting

- **Healthy**: No alert (no spam)
- **Degraded**: Slack alert with specific failing checks
- **Unhealthy**: Slack alert with details

### Programmatic Access

```typescript
import { runHealthCheck } from '../lib/health.js';

const result = await runHealthCheck();
// result.status: 'healthy' | 'degraded' | 'unhealthy'
// result.checks: { personize: { status, latency_ms }, gmail: { ... }, ... }
```

---

## Daily Slack Digest

A daily operations dashboard posts to Slack at **9am UTC, Monday-Friday** via `src/trigger/daily-digest.ts`.

### What's Included

- **Outreach stats**: emails sent (by step), replies (by sentiment), sequences completed, opt-outs
- **Pipeline activity**: signals detected, contacts enriched, companies researched
- **Health status**: all service checks with pass/fail indicators
- **Needs attention**: positive replies awaiting follow-up, questions needing responses
- **Gmail capacity**: remaining sends per sender

### Triggering Manually

The daily digest can be triggered on-demand from the Trigger.dev dashboard by running the `daily-operations-digest` task.

---

## Email Format Governance

A governance variable (`email-format-examples`) provides the LLM with:

- Required HTML structure (allowed/forbidden tags)
- 3 email examples (cold open, follow-up, final touch)
- Anti-patterns to avoid (walls of text, multiple CTAs, invented stats, generic language)

This is loaded automatically via `smartGuidelines()` when generating outreach emails, ensuring consistent email quality without hardcoding rules in the pipeline code.

---

## Email Delivery Providers

The agent supports four delivery providers, selected via the `EMAIL_PROVIDER` environment variable. All providers share the same send-and-log orchestrator in `src/delivery/hubspot-deliver.ts` — only the actual send call differs.

### Provider Comparison

| Provider | `EMAIL_PROVIDER` value | Deliverability | Setup effort | Best for |
|---|---|---|---|---|
| **Smartlead** | `smartlead` (default) | Managed — Smartlead owns warmup and mailbox rotation | Low — API key + campaign ID | New setups, teams that don't want to manage deliverability |
| **SendGrid** | `sendgrid` | Self-managed — you own domain warmup | Medium — domain auth required | Teams with existing SendGrid setup |
| **Gmail API** | `gmail` | Self-managed — tied to Google Workspace mailbox age | High — OAuth per sender | Teams with existing Gmail sequences |
| **Manual HubSpot** | `manual-hubspot` | N/A — human sends | None | High-value accounts, teams requiring human review |

### How the Router Works

`sendAndLog()` in `hubspot-deliver.ts` reads `EMAIL_PROVIDER` and dispatches to the right sender. Regardless of provider, it always:

1. Calls the provider-specific send function (or creates a HubSpot task for `manual-hubspot`)
2. Logs the email activity in HubSpot (`createHubSpotEmail` for sent, `createHubSpotTask` for draft)
3. Memorizes the outcome in Personize so the sequence knows what step was last handled

### Sent vs. Draft in Personize Memory

- **Sent providers** write `[OUTREACH SENT — Email N]` — the sequence advances normally after the durable wait.
- **`manual-hubspot`** writes `[OUTREACH DRAFT — Email N]` — the sequence pauses at that step and will not generate the next email until a `SENT` record appears (i.e., the human sent the email and the record was updated).

### Adding a New Provider

1. Create `src/delivery/your-provider.ts` — export a function returning `{ messageId, senderEmail }`
2. Add the provider name to `EmailProvider` type in `prospecting.config.ts`
3. Add the config block (API key etc.) to `prospecting.config.ts`
4. Add a branch in `sendAndLog()` in `hubspot-deliver.ts`

---

## Gmail OAuth Configuration

The Gmail OAuth redirect URI is now configurable via environment variables:

```bash
# Default: http://localhost:3847/oauth2callback
GMAIL_AUTH_PORT=3847
GMAIL_AUTH_REDIRECT_URI=http://localhost:3847/oauth2callback
```

This allows running the OAuth flow on different ports or behind a reverse proxy.

---

## Test Coverage

Extensive automated tests across unit and integration suites:

```bash
# Unit tests (all pipelines, utilities, configs)
npm test

# Integration tests (end-to-end pipeline flows)
npm run test:integration

# Both
npm run test:all
```

### Test Categories

| Suite | Tests | Covers |
|-------|-------|--------|
| Email HTML validation | 18 | Tag allowlisting, stripping, auto-wrapping, XSS prevention |
| Email validation | 20+ | RFC format, disposable domains, role accounts |
| LLM output parsing | 15 | JSON extraction, regex fallback, type coercion, enum validation |
| Cadence selection | 12 | Score thresholds, boundaries, structural validity |
| Integration: outreach | 10+ | Full outreach pipeline with JSON parsing + HTML validation |
| Integration: signals | 10+ | Signal detection with type coercion and enum validation |
| Integration: replies | 10+ | All 6 sentiment paths with field extraction |
| Existing unit tests | 180+ | Gmail multi-sender, HubSpot sync, reply classification, workspace, etc. |
