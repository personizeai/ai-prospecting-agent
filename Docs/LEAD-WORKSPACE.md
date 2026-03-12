# Lead Workspace — Agent Collaboration Model

The Lead Workspace is a shared, per-contact collaboration surface built on a Personize collection. Every agent — enrichment, outreach, engagement, reply analysis — reads from and writes to the same workspace for each lead. This eliminates direct agent-to-agent communication; agents coordinate implicitly through shared state.

## Setup

Run once to create the collection schema:

```bash
npm run setup:workspace
```

Source: `src/setup/create-workspace-schema.ts`

---

## Schema: 6 Properties

| Property | Type | Mutability | Purpose |
|---|---|---|---|
| `context` | `text` | **Rewritten** by any agent | "Start here" summary. Current lead state, sequence status, recommended next action. Any agent rewrites this when it has a materially updated understanding. |
| `updates` | `array` | **Append-only** | Chronological timeline of everything that happened. Each entry: `{ author, type, summary, details, timestamp }`. Types: `enrichment`, `signal`, `outreach`, `engagement`, `system`, `human`. |
| `tasks` | `array` | **Append + update** | Action items with ownership. Each entry: `{ title, description, status, owner, createdBy, priority, dueDate, outcome }`. A task assigned to an agent **is a handoff**. |
| `notes` | `array` | **Append-only** | Knowledge and observations. Each entry: `{ author, content, category, timestamp }`. Categories: `observation`, `analysis`, `enrichment`, `signal`, `reply-analysis`. |
| `issues` | `array` | **Append + update** | Problems, risks, blockers. Each entry: `{ title, description, severity, status, raisedBy, resolution, timestamp }`. Bounces, opt-outs, spam reports go here. |
| `messages_sent` | `array` | **Append-only** | Every outreach message. Each entry: `{ channel, subject, bodyPreview, step, angle, sentBy, sentAt, status }`. The definitive record of what was communicated. |

---

## Helper Library

**Source:** `src/lib/workspace.ts`

All workspace operations go through this module. Agents never call `client.memory.memorize()` with raw workspace tags directly — they use these typed helpers.

### Write Functions

```typescript
import { workspace } from '../lib/workspace.js';

// Record a timeline event
await workspace.addUpdate(email, {
  author: 'outreach-agent',
  type: 'outreach',          // enrichment | signal | outreach | engagement | system | human
  summary: 'Email 1/3 sent: "Quick question about your pipeline"',
  details: 'Angle: pain-point',
});

// Create a task (= handoff to another agent or human)
await workspace.addTask(email, {
  title: 'Lead interested — schedule call',
  description: 'Reply summary: ...',
  status: 'pending',          // pending | in_progress | done | cancelled
  owner: 'sales-rep',         // who should act on this
  createdBy: 'reply-analyzer',
  priority: 'urgent',         // low | medium | high | urgent
  dueDate: new Date(Date.now() + 3600_000).toISOString(),
});

// Store an observation or analysis
await workspace.addNote(email, {
  author: 'reply-analyzer',
  content: 'Reply Analysis:\nSentiment: POSITIVE\nSummary: Wants a demo...',
  category: 'reply-analysis',  // observation | analysis | enrichment | signal | reply-analysis
});

// Flag a problem or blocker
await workspace.raiseIssue(email, {
  title: 'Email bounced',
  description: 'Email delivery failed. Address may be invalid.',
  severity: 'high',            // low | medium | high | critical
  status: 'open',              // open | investigating | resolved | dismissed
  raisedBy: 'engagement-webhook',
});

// Record a sent message
await workspace.addMessageSent(email, {
  channel: 'email',            // email | call | linkedin
  subject: 'Quick question about your pipeline',
  bodyPreview: 'Hi Sarah, I noticed...',
  step: 1,                     // sequence step number
  angle: 'pain-point',
  sentBy: 'outreach-agent',
  status: 'delivered',         // sent | delivered | opened | clicked | replied | bounced
});

// Rewrite the "start here" context summary
await workspace.rewriteContext(email, [
  'Sequence Status: Email 1/3 sent.',
  'Last Email: "Quick question about your pipeline" (pain-point)',
  'Awaiting: Reply or next step in 3 days',
].join('\n'), 'outreach-agent');
```

### Task Lifecycle Functions

```typescript
// Search for pending tasks across all leads (used by task executor)
const pending = await workspace.getAllPendingTasks(50);

// Mark a task as completed
await workspace.completeTask(email, 'Task title', 'Outcome description');

// Decline a task — records reason + escalates to human as a new [Escalated] task
await workspace.declineTask(email, 'Task title', 'Not enough data to personalize', 'outreach-agent');

// Reschedule a task — records new due date + reason
await workspace.rescheduleTask(email, 'Task title', '2026-01-15', 'Lead is OOO until Jan 15', 'outreach-agent');
```

### Read Functions

```typescript
// Full workspace digest — the "start here" for any agent
const digest = await workspace.getDigest(email, 3000);
// Returns: { data: { compiledContext: string } }

// Current sequence progress
const state = await workspace.getSequenceState(email);
// Returns: { emailsSent: number, lastSentAt: string, lastEngagement: string, hasReplied: boolean, hasOptedOut: boolean }

// Open action items
const tasks = await workspace.getOpenTasks(email);

// Message history
const messages = await workspace.getMessageHistory(email);

// Active problems/blockers
const issues = await workspace.getIssues(email);
```

---

## Agent-by-Agent Breakdown

### 1. Outreach Sequence Agent

**Source:** `src/trigger/outreach-sequence.ts`

Manages the full 3-email outreach sequence with durable waits (3 days, then 5 days) between emails.

**Reads before every email:**
- `getSequenceState()` — checks if lead replied, opted out, or bounced
- `getIssues()` — checks for critical issues raised by any other agent

**Writes after every email:**
- `addMessageSent()` — records channel, subject, preview, step, angle, status
- `addUpdate()` — timeline entry: "Email 1/3 sent: subject"
- `rewriteContext()` — updates sequence status and next expected action

**Writes when sequence stops (reply/opt-out/bounce):**
- `addUpdate()` — "Sequence stopped after email N: reason"
- `addTask()` — for replies: "Review reply and respond personally" (urgent, owner: sales-rep)
- `raiseIssue()` — for opt-outs (critical) and bounces (high severity)
- `rewriteContext()` — "Sequence Status: STOPPED (reason)"

**Writes when sequence completes (3/3, no reply):**
- `addTask()` — "Sequence complete — evaluate for next steps" (medium, owner: sales-rep)
- `rewriteContext()` — "Sequence Status: COMPLETE"

### 2. Engagement Webhook

**Source:** `src/trigger/webhooks.ts`

Handles SendGrid email engagement events: open, click, reply, bounce, unsubscribe, spam report.

**For every event:**
- `addUpdate()` — timeline entry: "Email OPENED/CLICKED/etc."

**Reply:**
- `addNote()` — stores reply preview (first 500 chars)
- `rewriteContext()` — "REPLIED — analyzing reply..."
- Triggers `replyHandlerTask` for AI classification
- If no body captured: `addTask()` — "Reply received — check inbox" (urgent)

**Bounce:**
- `raiseIssue()` — "Email bounced" (severity: high)
- `rewriteContext()` — "BOUNCED — email delivery failed"

**Unsubscribe / Spam:**
- `raiseIssue()` — critical severity, "Do NOT send any more emails"
- `rewriteContext()` — "STOPPED (unsubscribe/spamreport)"
- Slack notification

**Open / Click:**
- Reads `getSequenceState()` — only updates context if lead hasn't replied or opted out
- `rewriteContext()` — "Lead OPENED/CLICKED the email. Signal: Interested."

### 3. Reply Analyzer

**Source:** `src/pipelines/analyze-reply.ts`

When a lead replies, this pipeline classifies the reply sentiment and takes action.

**Reads:**
- `getDigest()` — full workspace context (who is this person, what did we send, what do we know)
- `smartGuidelines()` — governance rules for reply handling, brand voice, competitor policy

**Assembles context for AI classification:**
```
## GOVERNANCE
[compiled guidelines]

## LEAD WORKSPACE
[compiled digest]

## INCOMING REPLY
Subject: ...
Body: ...
```

**Classifies into 6 sentiments, then writes:**

| Sentiment | Workspace Writes | CRM | Slack |
|---|---|---|---|
| **POSITIVE** | `addNote` (analysis), `addTask` ("schedule call", urgent, owner: sales-rep), `rewriteContext` ("POSITIVE REPLY — respond in 1 hour") | HubSpot task (CALL, HIGH) | Green alert |
| **QUESTION** | `addNote`, `addTask` ("answer and advance", high, owner: sales-rep), `rewriteContext` ("QUESTION — respond in 4 hours") | HubSpot task (EMAIL, HIGH) | Yellow alert |
| **NEGATIVE** | `addNote`, `raiseIssue` ("do not contact", critical), `addUpdate` ("opted out"), `rewriteContext` ("OPTED OUT") | Updates lead_status → Disqualified | Red alert |
| **OOO** | `addTask` ("reschedule outreach", low, owner: outreach-agent), `rewriteContext` ("OUT OF OFFICE until date") | — | — |
| **REFERRAL** | `addTask` ("follow up with referral", high, owner: sales-rep), `rewriteContext` ("REFERRAL") | HubSpot task (EMAIL, HIGH) | Blue alert |
| **NEUTRAL** | `addTask` ("review ambiguous reply", medium, owner: sales-rep), `rewriteContext` ("needs human review") | — | — |

**Always (except negative):** Updates contact properties — `responsive`, `sentiment`, `lead_status`, `outreach_stage`.

### 4. Email Delivery (HubSpot)

**Source:** `src/delivery/hubspot-deliver.ts`

Records sent emails via raw `memorize()` with structured content and tags (`generated`, `outreach`, `sequence:email-N`, `sent`).

### 5. CRM Sync

**Source:** `src/pipelines/sync-hubspot.ts`

Writes contact and company memories from HubSpot into Personize. Tags everything with `crm`, `hubspot`.

### 6. Email Generator

**Source:** `src/pipelines/generate-outreach.ts`

Reads only — uses `smartDigest()` and `recall()` to assemble personalization context before generating each email.

### 7. Task Executor (NEW)

**Source:** `src/trigger/task-executor.ts` + `src/pipelines/execute-task.ts`

Scheduled every 30 minutes. Polls for pending tasks assigned to AI agents, executes them, and handles failures gracefully. See [TASK-EXECUTOR.md](TASK-EXECUTOR.md) for full details.

**Polls:**
- `getAllPendingTasks()` — finds pending tasks across all leads

**For each task, makes one of 4 decisions:**
- **EXECUTE** — does the work, marks done with outcome
- **DECLINE** — can't do it, escalates to human with reason, sends Slack alert
- **RESCHEDULE** — wrong timing, pushes due date, re-creates the task
- **SKIP** — already done or irrelevant, marks as completed

**Writes:**
- `completeTask()` — completion record (prevents re-execution)
- `declineTask()` — decline record + creates `[Escalated]` task for sales-rep
- `rescheduleTask()` — reschedule record + new task with updated due date
- `addUpdate()` — timeline entries for all decisions
- `addMessageSent()` — if it sends an email

---

## Key Patterns

### Tasks = Handoffs (with AI Autonomy)

A task is how one agent delegates work to another agent or a human. The `owner` field determines who should act:

- `owner: 'sales-rep'` — Human needs to take action (reply, call, review)
- `owner: 'outreach-agent'` — Task executor picks up and handles outreach
- `owner: 'enrichment-agent'` — Task executor triggers enrichment

**Humans can create tasks for AI agents.** The Task Executor polls every 30 minutes and picks up any pending task whose owner matches an agent name. You don't need to trigger anything manually — just add the task and the agent will act on the next cycle.

#### Human → AI Task Delegation

When a human adds a task like "Engage this lead for New Year deals, reference his past Analytics module purchase and our current 30% upgrade offer":

1. The Task Executor picks it up on the next 30-minute poll
2. It runs a **pre-flight check** — if the lead has opted out, bounced, or has a critical issue open, it declines immediately and escalates back to you via Slack
3. It calls `assembleContext()` — reads governance rules, the lead's full profile (past purchases, experiences, preferences), company signals, and every email previously sent
4. It passes **all of that context + your task description** to an AI prompt — there is no fixed list of task types; the AI reads your instruction as natural language and reasons over it
5. The AI decides: EXECUTE, DECLINE, RESCHEDULE, or SKIP — and generates the full email (subject, body, personalization angle) if executing
6. The result is written back to the workspace: task marked done, email logged in `messages_sent`, timeline updated

**The AI does not need structured input.** Plain-language task descriptions work. The richer the description, the better the output.

#### What tasks AI agents can and cannot do

| Task description | What happens |
|---|---|
| "Engage for New Year deals using past purchases" | AI reads purchase history, generates seasonal email referencing what they bought |
| "Re-engage cold lead with a case study" | AI selects a relevant angle from profile, writes case-study email |
| "Follow up after the conference — mention their talk on AI" | AI uses the signal/note about the conference, writes personalized follow-up |
| "Research and enrich this contact" | Routed to generic handler → AI adds a note (full enrichment requires dedicated handler) |
| "Call the lead and negotiate pricing" | AI declines — requires human judgment, escalates to sales-rep |
| "Send email" (no context) | AI may decline — not enough personalization data in the task description |

**AI agents can decline tasks.** If the agent doesn't have enough context, the lead has blockers (opted out, bounced), or the task conflicts with governance rules, it will decline and escalate to a human via Slack with a clear reason. A declined task creates an `[Escalated]` task assigned to `sales-rep` automatically.

### Issues = Stop Signals

Critical issues raised by any agent will stop the outreach sequence. The outreach agent checks for open critical issues before every email:

```typescript
const issues = await workspace.getIssues(contactEmail);
for (const item of issues.data || []) {
  const content = (item.content || '').toUpperCase();
  if (content.includes('"STATUS":"OPEN"') && content.includes('"SEVERITY":"CRITICAL"')) {
    return { stop: true, reason: 'critical_issue' };
  }
}
```

### Context = Living Summary

The `context` property is not append-only — it gets **rewritten** by whichever agent has the most current understanding. This means any agent reading it gets the latest state without parsing the full timeline.

### Tagging Convention

Every workspace write uses structured tags for recall:

```
workspace:updates    workspace:tasks         workspace:notes
workspace:issues     workspace:messages      workspace:context
workspace:task-completions
source:{agent-name}  priority:{level}        category:{type}
severity:{level}     channel:{type}          step:{number}
declined             rescheduled
```

---

## Data Flow: Complete Sequence Lifecycle

```
1. CRM Sync writes contact data to memory
2. Enrichment adds company/person research as notes
3. Signal detection scores the account

4. Outreach Agent starts sequence:
   ├── Reads: getSequenceState(), getIssues()
   ├── Generates email using smartDigest() + recall()
   ├── Sends email
   ├── Writes: addMessageSent(), addUpdate(), rewriteContext()
   ├── Waits 3 days (durable)
   │
   ├── [If open/click detected by Engagement Webhook]
   │   └── Writes: addUpdate(), rewriteContext("Lead OPENED")
   │
   ├── Reads: getSequenceState(), getIssues() (checks stop signals)
   ├── Sends email 2...
   ├── Waits 5 days (durable)
   │
   ├── [If reply detected by Engagement Webhook]
   │   ├── Writes: addNote(reply preview), addUpdate(), rewriteContext("REPLIED")
   │   └── Triggers Reply Analyzer
   │       ├── Reads: getDigest(), smartGuidelines()
   │       ├── Classifies sentiment via AI
   │       └── Writes: addNote(analysis), addTask(handoff), rewriteContext(status)
   │
   ├── Reads: getSequenceState() → hasReplied = true → STOP
   └── Writes: addUpdate("stopped: replied"), addTask("respond personally")

5. Sales rep sees the task, reads workspace context, responds

--- OR ---

5b. Task Executor picks up agent-owned tasks every 30 min:
    ├── Reads: getAllPendingTasks() → filters by owner + status
    ├── For each task:
    │   ├── Pre-flight: getSequenceState() + getIssues() (check blockers)
    │   ├── Routes by owner → outreach handler or generic AI handler
    │   ├── Generic handler: assembleContext() → AI evaluates task → decides action
    │   │
    │   ├── [EXECUTE] Sends email / adds note / notifies Slack
    │   │   └── Writes: completeTask(), addUpdate(), addMessageSent()
    │   │
    │   ├── [DECLINE] Can't do it (no data, blockers, governance conflict)
    │   │   └── Writes: declineTask() → creates [Escalated] task for sales-rep
    │   │   └── Notifies Slack: "Task declined — reason"
    │   │
    │   ├── [RESCHEDULE] Wrong timing (too soon, OOO, better window)
    │   │   └── Writes: rescheduleTask() + addTask() with new dueDate
    │   │
    │   └── [SKIP] Already done or irrelevant
    │       └── Writes: completeTask("Skipped: reason")

6. Human creates a custom task for AI:
   ├── Example: "Engage lead for New Year deals using past purchases"
   ├── owner: 'outreach-agent', priority: 'high'
   ├── Task Executor picks it up on next poll
   ├── Reads smartDigest() → gets past purchases, experiences, signals
   ├── AI interprets the task description → generates personalized email
   └── Sends email referencing past purchases + New Year angle
```

---

## Implementation Notes

- **Storage:** All workspace writes use `client.memory.memorize()` with `enhanced: true` and structured tags. The workspace helpers serialize data as JSON strings.
- **Retrieval:** Read functions use `client.memory.recall()` (semantic search) and `client.memory.smartDigest()` (compiled summary). There is no direct collection query — everything goes through Personize's AI-powered retrieval.
- **Sequence state parsing:** `getSequenceState()` parses both structured JSON messages and legacy `[OUTREACH SENT]` format for backward compatibility.
- **Durable waits:** The outreach sequence uses Trigger.dev's `wait.for()` for 3-day and 5-day waits between emails. These are checkpointed — no compute cost during the wait.
