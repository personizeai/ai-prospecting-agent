# Task Executor — AI Agent Task Processing

The Task Executor closes the loop on workspace tasks. Agents and humans create tasks via `workspace.addTask()`, and the executor polls for pending tasks every 30 minutes, routes them to the right handler, and acts — or explicitly declines with a reason.

---

## What This Document Teaches You

This doc covers three audiences:

### As a Sales Rep / Non-Technical User
- **How to create a task that AI will execute** — what to write, which fields matter, what good vs. bad task descriptions look like
- **What the AI will do with your task** — when it sends the email, when it declines and why, when it reschedules
- **How to read the result** — where to see what the AI did, what an escalated task means, how to take over when AI declines

### As a Developer
- **How the task routing works** — how tasks get picked up, filtered, deduplicated, and dispatched
- **How to add a new task type** — dedicated handler for a new agent owner (`enrichment-agent`, `scoring-agent`, etc.)
- **How to extend the AI's decision space** — adding new decisions (`CREATE_TASK`) or new execute actions (`trigger_enrichment`, `book_meeting`)
- **How to add context sources** — what `assembleContext()` reads and how to add more signals to the AI prompt
- **Configuration** — cron interval, concurrency, max task age, actionable owners

### As a Product Owner / Auditor
- **What gets logged and where** — every decision is written to the workspace timeline
- **How escalations work** — declined tasks auto-create `[Escalated]` tasks for sales-rep + send Slack alerts
- **How deduplication works** — why the same task is never executed twice
- **How to audit what happened** — reading the workspace after task execution

---

## Why This Exists

Before the task executor, tasks were **write-only**. Agents would create tasks like "Reschedule outreach — lead is OOO until Jan 15" or "Follow up with referral", but nothing picked them up. The `getOpenTasks()` function existed but was never called. Human-created tasks for AI agents (e.g., "engage this lead for holiday deals") had no execution path.

Now:
- Tasks assigned to AI agents get executed automatically
- Tasks the AI can't handle get escalated to humans with clear reasons
- Humans can create tasks for AI agents and they'll be picked up on the next poll
- Every decision is logged — nothing is silently dropped

---

## For Sales Reps: Creating Tasks for the AI

You don't need to write code. To give the AI a task for a lead, add a task to that lead's workspace with the right `owner` field. The AI will pick it up within 30 minutes.

### The Two Fields That Matter Most

**`owner`** — who should act on this task:
- `'outreach-agent'` — AI sends a personalized email
- `'sales-rep'` — you need to do this (AI won't pick it up)
- `'enrichment-agent'` — AI researches and enriches the contact

**`description`** — plain English instruction to the AI. Be specific. The more context you give, the better the output.

### Good vs. Bad Task Descriptions

| Instead of this... | Write this |
|---|---|
| "Send email" | "Send a warm follow-up referencing their Analytics module purchase and our current 30% upgrade offer. Seasonal angle — end of quarter." |
| "Re-engage lead" | "Lead went cold after 3 emails. Try one more touch with a relevant case study from a similar company in the fintech space." |
| "Check on this lead" | "Lead attended our webinar last week. Reference the session on AI automation and ask if they'd like a 1:1 demo." |
| "Follow up" | "Lead asked about pricing in a previous reply but we never responded. Address their pricing question directly and offer a call." |

The AI reads your description as a natural-language instruction. It also reads everything it knows about the lead (past purchases, previous emails, company signals) — so you don't need to repeat facts already in the workspace.

### What the AI Will Do

After picking up your task, the AI will:

1. Check for blockers (opted out, bounced, critical issues) — if found, it declines immediately and you'll get a Slack alert
2. Read the full lead profile: past purchases, engagement history, previous emails sent, company signals, governance rules
3. Decide what to do:
   - **Execute** — sends the email it generates, logs everything in the workspace
   - **Decline** — can't do it (no data, governance conflict, needs human judgment) → creates an `[Escalated]` task for you + Slack alert with the reason
   - **Reschedule** — wrong timing (too soon after last email, lead is OOO) → pushes the task to the right date automatically
   - **Skip** — already done or no longer relevant → marks complete with a reason

### When AI Will Decline (and You'll Get a Slack Alert)

- Lead has opted out or unsubscribed
- Email bounced — address invalid
- A critical issue is open in the workspace
- The task requires human judgment (e.g., "call and negotiate pricing")
- Not enough personalization data to do the task well
- Task conflicts with governance rules (e.g., sending to a competitor's employee)

When declined, the workspace automatically creates an `[Escalated]` task assigned to `sales-rep` with the full reason. You take it from there.

### How to Read What the AI Did

After execution, open the lead's workspace and check:

- **Updates (timeline)** — see exactly what the AI did: "Task completed: Engaged for New Year deals — Email sent: 'Happy New Year, Sarah...'"
- **Messages Sent** — the full email: subject, body preview, angle used
- **Tasks** — your original task marked ✅ done, or ❌ declined with reason
- **Context** — the "start here" summary, updated to reflect the new state

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Trigger.dev Cron (every 30 min)                                │
│  task-executor (scheduled parent)                               │
│                                                                 │
│  1. workspace.getAllPendingTasks()                               │
│  2. Parse JSON, filter: status=pending, owner=agent             │
│  3. Check for existing completion records (dedup)               │
│  4. Trigger child task per pending task                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  execute-workspace-task (child, concurrency: 3)                 │
│                                                                 │
│  1. Mark in-progress (addUpdate)                                │
│  2. Route by owner:                                             │
│     ├── outreach-agent → handleOutreachTask()                   │
│     └── * → handleGenericTask() (AI interpretation)             │
│  3. Act on decision:                                            │
│     ├── EXECUTE → completeTask() + addUpdate()                  │
│     ├── DECLINE → declineTask() + Slack alert                   │
│     ├── RESCHEDULE → rescheduleTask() + addTask(new date)       │
│     └── SKIP → completeTask("Skipped: reason")                  │
└─────────────────────────────────────────────────────────────────┘
```

**Source files:**
- `src/trigger/task-executor.ts` — Trigger.dev scheduled parent + child task
- `src/pipelines/execute-task.ts` — Handler logic (outreach, generic, routing)
- `src/lib/workspace.ts` — New helpers: `getAllPendingTasks`, `completeTask`, `declineTask`, `rescheduleTask`
- `src/config/prospecting.config.ts` — `TASK_EXECUTOR_CONFIG`

---

## The 4 Decisions

Every task results in exactly one of these decisions:

### EXECUTE

The agent has enough context and the task is actionable. It does the work.

**What happens:**
- Task handler performs the action (sends email, adds note, triggers enrichment)
- `completeTask()` writes a completion record (prevents re-execution on next poll)
- `addUpdate()` logs "Task completed: title — outcome" in the timeline

**Example:** Task "Reschedule outreach — lead is OOO until Jan 15" with `owner: 'outreach-agent'`. The executor checks the due date, sees it's past Jan 15, generates a new email, and sends it.

### DECLINE

The agent cannot execute the task. This is not a failure — it's a deliberate decision.

**Reasons to decline:**
- Lead has opted out or bounced (pre-flight check)
- Critical issue is open for this lead
- Not enough data to personalize (e.g., no company info, no past interactions)
- Task conflicts with governance rules (e.g., "send cold email" but lead is a customer)
- Task requires human judgment that AI can't substitute
- Email generation failed (contact not qualified or sequence already complete)

**What happens:**
- `declineTask()` records the decline reason
- `declineTask()` automatically creates an `[Escalated]` task assigned to `sales-rep` with full context
- `addUpdate()` logs the decline in the timeline
- Slack notification: "Task Declined — Contact: X, Task: Y, Reason: Z"
- The original task is NOT re-picked-up (decline record acts as dedup)

**Example:** Task "Engage lead for product demo" but the lead opted out last week. Pre-flight catches this and declines: "Lead has opted out — do not contact."

### RESCHEDULE

The task is valid but the timing is wrong.

**Reasons to reschedule:**
- Lead is OOO and the return date hasn't passed yet
- Last email was sent too recently (respecting cadence)
- AI determines a better send window exists (e.g., "lead is more active mid-week")
- Task due date is in the future

**What happens:**
- `rescheduleTask()` records the original title, new due date, and reason
- `addTask()` re-creates the task with the new `dueDate`
- `addUpdate()` logs the reschedule in the timeline
- The rescheduled task will be picked up again after the new due date

**Example:** Task "Follow up after conference" with `dueDate: '2026-03-20'`. Today is March 10. The executor reschedules: "Due date is in the future. Will retry after 2026-03-20."

### SKIP

The task is already done, duplicated, or no longer relevant.

**Reasons to skip:**
- A completion record already exists for this exact task (dedup)
- Workspace state shows the action was already taken (e.g., email already sent)
- The task is superseded by a newer task or state change

**What happens:**
- `completeTask()` records "Skipped: reason" (prevents re-pickup)
- `addUpdate()` logs the skip in the timeline
- No Slack notification (not actionable)

---

## Task Routing

### Outreach Agent Tasks (`owner: 'outreach-agent'`)

Handled by `handleOutreachTask()` in `src/pipelines/execute-task.ts`.

1. **Pre-flight check:** `getSequenceState()` + `getIssues()` — blockers → DECLINE
2. **OOO reschedule check:** If task title includes "reschedule" and `dueDate` is future → RESCHEDULE
3. **Generate email:** `generateOutreachForContact()` — uses `assembleContext()` which reads:
   - `smartDigest()` — full contact profile including past purchases, experiences
   - `recall()` — company info, buying signals, account status
   - `recall()` — previous outreach history
   - `smartGuidelines()` — brand voice, playbook, ICP definition
4. **Send:** `sendAndLog()` (respects `DRY_RUN`)
5. **Record:** `addMessageSent()` with `sentBy: 'task-executor'`

### Generic / Custom Tasks (all other agent owners)

Handled by `handleGenericTask()` in `src/pipelines/execute-task.ts`.

This is the handler for **human-created tasks** like "Engage this lead for New Year deals using past purchases." It uses AI to interpret what needs to be done — there is **no fixed list of task types**. The AI reasons freely over the task description + full workspace context.

1. **Pre-flight check:** same as outreach — opt-out, bounce, critical issues → DECLINE
2. **Assemble context:** `assembleContext()` — builds a full context block:
   - `smartGuidelines()` — brand voice, playbook, ICP definition, governance rules
   - `smartDigest()` — contact profile: past purchases, preferences, engagement history
   - `recall()` — company info, buying signals, account status
   - `recall()` — previous outreach: every email sent, subject lines, angles used
3. **AI evaluation:** `client.ai.prompt()` receives the task + everything above. The AI outputs:
   - `DECISION`: EXECUTE, DECLINE, RESCHEDULE, or SKIP
   - `REASON`: plain-language explanation
   - `NEW_DUE_DATE`: if rescheduling
   - `ACTION`: send_email, add_note, or notify_slack (if executing)
   - `SUBJECT`, `BODY`, `ANGLE`: full generated content (if sending email)
4. **Execute action:** based on AI's recommendation — it can send a personalized email it wrote itself, add a note, or ping Slack
5. **Record:** all workspace writes as appropriate

**The AI sees everything** — past purchases, engagement history, company signals, previous emails, governance rules. It uses all of this to decide whether and how to execute the task. The task description is treated as a natural-language instruction, not mapped to a predefined type.

#### What "context" means in practice

When a human writes "Engage this lead for New Year deals using past purchases", the AI prompt receives something like:

```
## GOVERNANCE
- Brand voice: warm, direct, non-pushy
- Do not mention competitors
- Max 2 follow-ups after no reply
- ICP: VP+ at mid-market SaaS

## LEAD WORKSPACE
Sequence Status: Complete (3/3 emails sent, no reply)
Last Email: "Following up one more time" (angle: social-proof)
Past Purchases: Enterprise plan (2023), Add-on: Analytics module (2024)
Company: Acme Corp — 200 employees, SaaS, Series B
Signals: Opened 2 of 3 emails, clicked pricing page link

## TASK
Title: Engage lead for New Year deals — reference past purchases
Description: Send a personalized email about our New Year promotion...
Priority: high
Created by: sales-rep
```

The AI then decides: "I have enough context. I'll send a warm email referencing their Analytics module purchase and offer a New Year upgrade deal." It generates the full subject and body inline.

---

## Extending the Task Executor

### Adding a New Task Type (Dedicated Handler)

To add a handler for a specific agent owner (e.g., `enrichment-agent`, `scoring-agent`), add a `case` to the router in `src/pipelines/execute-task.ts`:

```typescript
// In executeTask() switch:
case 'enrichment-agent':
  result = await handleEnrichmentTask(contactEmail, task, dryRun);
  break;
case 'scoring-agent':
  result = await handleScoringTask(contactEmail, task, dryRun);
  break;
```

Each handler receives `(contactEmail, task, dryRun)` and must return a `TaskResult`:
```typescript
{ decision: 'execute' | 'decline' | 'reschedule' | 'skip', outcome: string, newDueDate?: string }
```

Any owner not in the switch falls through to `handleGenericTask()` (AI interpretation).

Also add the owner to `actionableOwners` in `src/config/prospecting.config.ts`:
```typescript
actionableOwners: ['outreach-agent', 'enrichment-agent', 'scoring-agent', ...]
```

---

### Giving AI More Decision Power (CREATE_TASK)

Currently the AI can decide: `EXECUTE | DECLINE | RESCHEDULE | SKIP`. You can extend this with a `CREATE_TASK` decision — the AI reasons over the workspace, decides it shouldn't act directly, and instead spawns a new task with a specific instruction and due date.

**Use cases:**
- "Not the right time to email — create a follow-up task for next quarter review"
- "Lead is mid-sequence — create a task to check reply status in 5 days"
- "Needs enrichment before outreach — create an enrichment task first"

**How to add it — in `src/pipelines/execute-task.ts`:**

Step 1: Add to the `TaskDecision` type:
```typescript
export type TaskDecision = 'execute' | 'decline' | 'reschedule' | 'skip' | 'create_task';
```

Step 2: Add `CREATE_TASK` to the AI prompt in `handleGenericTask()`:
```
DECISION: CREATE_TASK
Meaning: You should not act directly. Instead, create a new follow-up task with a specific instruction.

If DECISION is CREATE_TASK, also output:
NEW_TASK_TITLE: [short title for the new task]
NEW_TASK_DESCRIPTION: [what the next agent/human should do]
NEW_TASK_OWNER: [outreach-agent | sales-rep | enrichment-agent]
NEW_TASK_DUE_DATE: [YYYY-MM-DD]
NEW_TASK_PRIORITY: [low | medium | high | urgent]
```

Step 3: Parse and handle in `handleGenericTask()`:
```typescript
if (decision === 'create_task') {
  const newTitle = output.match(/NEW_TASK_TITLE:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const newDesc  = output.match(/NEW_TASK_DESCRIPTION:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const newOwner = output.match(/NEW_TASK_OWNER:\s*([^\n]+)/i)?.[1]?.trim() || 'sales-rep';
  const newDue   = output.match(/NEW_TASK_DUE_DATE:\s*([^\n]+)/i)?.[1]?.trim();
  const newPri   = output.match(/NEW_TASK_PRIORITY:\s*([^\n]+)/i)?.[1]?.trim() || 'medium';

  await workspace.addTask(contactEmail, {
    title: newTitle,
    description: newDesc,
    status: 'pending',
    owner: newOwner,
    createdBy: 'task-executor',
    priority: newPri as any,
    dueDate: newDue ? new Date(newDue).toISOString() : undefined,
  });

  return { decision: 'create_task' as any, outcome: `Created follow-up task: "${newTitle}" (owner: ${newOwner}, due: ${newDue})` };
}
```

Step 4: Handle in `executeTask()` router (the master switch after the handler returns):
```typescript
case 'create_task':
  await workspace.completeTask(contactEmail, task.title, `Delegated: ${result.outcome}`);
  await workspace.addUpdate(contactEmail, {
    author: 'task-executor',
    type: 'system',
    summary: `Task delegated: "${task.title}" → ${result.outcome}`,
  });
  break;
```

---

### Current AI Decision Space (Summary)

| Decision | When AI uses it | What happens |
|---|---|---|
| `EXECUTE` | Has context + task is actionable now | Sends email / adds note / pings Slack |
| `DECLINE` | Blocker exists, governance conflict, or needs human | Escalates → `[Escalated]` task for sales-rep + Slack |
| `RESCHEDULE` | Valid task, wrong timing (OOO, too soon) | Re-creates task with new due date |
| `SKIP` | Already done, duplicate, or irrelevant | Marks complete with reason, no action |
| `CREATE_TASK` *(to add)* | Should act later, or needs prerequisite work first | Spawns a new pending task with specific instruction |

The AI's **action space on EXECUTE** is already flexible:
- `send_email` — generates and sends a full personalized email
- `add_note` — writes an observation or analysis to the workspace
- `notify_slack` — pings the team with a message

You can extend this too — add `create_crm_task`, `trigger_enrichment`, `book_meeting`, etc. by parsing additional `ACTION` values in the handler.

---

## Configuration

In `src/config/prospecting.config.ts`:

```typescript
export const TASK_EXECUTOR_CONFIG = {
  maxTasksPerRun: 20,           // Max tasks per 30-min cycle
  actionableOwners: [            // Owners the executor will handle
    'outreach-agent',
    'enrichment-agent',
    'signal-agent',
    'reply-analyzer',
  ],
  enableGenericTaskHandler: true, // AI interpretation for unknown owners
  concurrencyLimit: 3,           // Parallel child tasks
  maxTaskAgeDays: 30,            // Skip tasks older than this
};
```

**To add a new agent owner:** Add it to `actionableOwners`. Any task with that owner will be routed to `handleGenericTask()` (AI interpretation) unless you add a specific handler in `executeTask()`.

---

## Deduplication

Tasks in Personize don't have unique IDs. The executor prevents re-execution by:

1. **Before executing:** Recalls completion/decline/reschedule records matching the task title + contact email
2. **After executing:** Writes a typed record (`task_completion`, `task_declined`, or `task_rescheduled`) with the task title
3. **On next poll:** The parent task finds the completion record and skips the task

Records are tagged with `workspace:task-completions` for recall.

---

## Failure Handling

If the child task fails after retries:

1. `onFailure` callback fires
2. Calls `workspace.declineTask()` — escalates to human: "Execution failed after retries: error message"
3. Calls `reportFailure()` — Slack alert via the standard error handler
4. The decline record prevents the failed task from being retried on the next poll cycle

---

## Human → AI Task Examples

### "Engage lead for New Year deals using past purchases"

```typescript
await workspace.addTask('sarah@example.com', {
  title: 'Engage lead for New Year deals — reference past purchases',
  description: 'Send a personalized email about our New Year promotion. Reference their past purchases and how the deals relate to what they previously bought. Warm, seasonal tone.',
  status: 'pending',
  owner: 'outreach-agent',
  createdBy: 'sales-rep',
  priority: 'high',
  dueDate: new Date('2026-12-26').toISOString(),
});
```

**What the executor does:**
1. Picks up on next poll (after Dec 26)
2. Pre-flight: checks blockers — all clear
3. `assembleContext()` reads full profile via `smartDigest()` — surfaces past purchases, preferences
4. AI interprets: "Send a New Year email referencing their purchase of X, offering Y% off related products"
5. Generates email with seasonal angle + personalized product references
6. Sends and records in workspace

### "Re-engage cold lead with case study"

```typescript
await workspace.addTask('john@acme.com', {
  title: 'Re-engage with relevant case study',
  description: 'This lead went cold after 3 emails. Send one more email sharing a case study relevant to their industry/role. Do not be pushy.',
  status: 'pending',
  owner: 'outreach-agent',
  createdBy: 'sales-rep',
  priority: 'medium',
});
```

**What the executor might do:**
- If the lead has not opted out and enough time has passed → EXECUTE (generates case-study-angled email)
- If the lead has a critical issue open → DECLINE ("Critical issue open — lead reported spam")
- If last email was 2 days ago → RESCHEDULE ("Too soon — last email sent 2 days ago. Rescheduling to next week.")

### "Research and enrich this contact"

```typescript
await workspace.addTask('new@prospect.io', {
  title: 'Research and enrich contact',
  description: 'New lead from conference. Find their role, company details, and any signals. Enrich via Apollo.',
  status: 'pending',
  owner: 'enrichment-agent',
  createdBy: 'sales-rep',
  priority: 'high',
});
```

**What happens:** Routed to `handleGenericTask()` → AI decides to execute → adds enrichment note. (For full Apollo enrichment, a dedicated handler can be added later.)

---

## Workspace State After Task Execution

After the executor processes a task, the workspace reflects the full history:

```
TIMELINE (updates):
  [10:00] sales-rep: Created task "Engage lead for New Year deals"
  [10:30] task-executor: Picking up task "Engage lead for New Year deals"
  [10:31] task-executor: Task completed — Email sent: "Happy New Year, Sarah — exclusive deal on..."

TASKS:
  ✅ "Engage lead for New Year deals" — done (completed by task-executor)

MESSAGES:
  Email: "Happy New Year, Sarah — exclusive deal on..." (step: 0, angle: seasonal + past purchases)

CONTEXT:
  Last action: Task-executed email sent (New Year deals). Awaiting reply.

TASK COMPLETIONS:
  { type: "task_completion", taskTitle: "Engage lead for New Year deals", outcome: "Email sent: ..." }
```

If the task was **declined**, the workspace shows:

```
TIMELINE:
  [10:30] task-executor: Picking up task "Engage lead for New Year deals"
  [10:30] task-executor: Task declined — "Lead has opted out — do not contact."

TASKS:
  ❌ "Engage lead for New Year deals" — declined
  🔔 "[Escalated] Engage lead for New Year deals" — pending (owner: sales-rep)
      "AI agent (outreach-agent) could not execute this task. Reason: Lead has opted out..."

TASK COMPLETIONS:
  { type: "task_declined", taskTitle: "Engage lead for New Year deals", reason: "Lead has opted out..." }
```
