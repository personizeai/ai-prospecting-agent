---
name: agent-playbook
type: guideline
tags: [playbook, agent-operations, rgas-loop, universal]
---

# Agent Operating Playbook

> Canonical playbook for any agent operating with Personize memory + governance.
> Loaded once per session via `context_retrieve(contextNames=['agent-playbook'])`.
> Repo-specific CLAUDE.md files reference this; they do not duplicate it.

---

## Session Startup

Run these steps on the very first user message, before responding:

1. `personize_md()` — MUST be first. Reveals org identity, collections, available tools,
   capabilities, and any teammate handoffs. This is the README for the session.

2. `memory_retrieve(query='agent preferences, active work, working style, past decisions,
   what is set up', about='self', generate_answer=true)` — Load your own persistent memory:
   what has been configured, what is working, decisions already made.

3. `context_retrieve(message='<session intent>', types=['guideline'])` — Load all
   governance rules before acting. Pass the user's first message (or a summary of it)
   as the query.

4. Any repo-specific startup reads defined in the repo's CLAUDE.md (e.g., PLAN.md,
   STATUS.md, project-specific state files).

5. Report to the user: current state, any blockers, and what you will do this session.

**Invariant:** Never act before completing steps 1–3. Stale assumptions produce incorrect
outputs that are expensive to undo.

---

## The Core Loop — RECALL → GOVERN → ACT → STORE

Every substantive agent turn follows this four-stage loop. The loop enforces that agents
always ground their work in what the org actually knows (Recall), always apply the rules
that govern the task (Govern), only then execute (Act), and always leave an auditable
trace (Store). Skipping any stage breaks the loop's safety properties: acting without
recall fabricates context; acting without governance bypasses policy; not storing breaks
the audit trail and degrades future recall.

---

### 1. Recall

**What:** Retrieve everything the org knows that is relevant to the entities and task at
hand before forming any plan.

**When:** At the start of every substantive turn — before writing, deciding, or proposing
an action.

**Which tools:**

- `memory_retrieve(query=..., email=...)` — Retrieve facts about a specific person or
  company. Use when the user mentions a name, email address, domain, or record ID.
- `memory_retrieve(query=..., about='self', generate_answer=true)` — Retrieve accumulated
  self-knowledge: preferences, working style, past decisions, what has been configured.
  Use when no specific record is mentioned.
- `memory_find_similar(query=...)` — Surface semantically similar records when you do not
  have an exact identifier. Use before importing or creating a record to detect duplicates.
- `memory_filter_by_property(type=..., conditions=[...])` — Zero-credit property scan.
  Use to list records in a known collection filtered by status, type, or flag.

**Pitfalls:**

- Do not proceed if recall returns nothing for a record you are about to act on — report
  the gap instead and ask the user to provide or confirm the missing context.
- Do not infer facts from conversation history alone; facts must be anchored in Personize
  memory to be treated as reliable.
- `memory_retrieve` with `generate_answer=true` synthesizes an answer from stored
  memories — use this when you need a reasoned summary, not raw records.

---

### 2. Govern

**What:** Load the guidelines, policies, and rules that apply to the task before executing
any action.

**When:** After Recall, before Act — every time. Not just on the first turn of a session.
New tasks may require different guidelines than the previous task.

**Which tools:**

- `context_retrieve(message=..., types=['guideline'])` — Primary governance tool. Returns
  org guidelines, playbooks, policies, and references relevant to the user's intent.
  Pass the user's message (or a concise description of the task) as `message`.
- `context_retrieve(message=..., contextNames=['<slug>'])` — Load a specific named
  guideline by its slug when you know exactly which one applies.
- `context_manage_read(guidelineId=..., header='## ...')` — Read a specific section of a
  long guideline without loading the whole document.

**Pitfalls:**

- Never assume a rule applies from memory — retrieve it. Guidelines are versioned and
  may have changed since the last session.
- If two guidelines conflict, do not pick one silently — surface the conflict to the user
  and ask which takes precedence before acting.
- If no guideline covers the task and the task is high-stakes, escalate rather than
  improvise.

---

### 3. Act

**What:** Execute the intended work — write content, update a record, call an external
service, propose a plan — fully grounded in what Recall and Govern returned.

**When:** Only after Recall and Govern are complete.

**Safety gate:** If the project configures a safety gate (e.g., a DRY_RUN flag, a
confirmation step, a human-in-the-loop approval), respect it. Show exactly what you would
do and wait for explicit authorization before proceeding with irreversible actions.

**Ambiguity rule:** If the user's intent is unclear, or if Recall returns conflicting
facts, or if Govern returns no applicable rule for a high-stakes action — **flag and ask,
do not guess and act**.

**High-stakes actions that always require explicit authorization before executing:**

- Irreversible record mutations (bulk delete, bulk opt-out, bulk stage change)
- First activation of any process that sends content, makes payments, or modifies
  external systems
- Changes to shared governance documents (guidelines, playbooks, policies)
- Any action that cannot be rolled back in under 5 minutes

**Pitfalls:**

- Do not fabricate facts, contact details, or records. If recall returned nothing, say so.
- Do not silently downgrade a high-stakes action to a low-stakes one to avoid asking.
- Do not re-use outputs from a prior session turn as if they are current — re-recall if
  the context of the task has changed.

---

### 4. Store

**What:** Persist the outputs, decisions, and learnings from the Act stage so they are
available in future sessions and to other agents operating in the same workspace.

**When:** After every Act that produces a meaningful output, decision, or state change.
The rule is: if you would want to remember this next session, store it now.

**Which tools:**

- `memory_save(content=..., email=..., enhanced=true)` — Store an atomic fact about a
  specific person or company. Use for: actions taken, replies received, stage changes,
  key decisions about a record.
- `memory_save(content=..., about='self')` — Store self-learning: what worked, what
  did not, preferences confirmed, decisions made about your own configuration.
- `memory_update_property(email=..., propertyName=..., operation='set', value=...)` —
  Update a specific property on a record. Use for structured state: stage, status,
  boolean flags, numeric counts.
- `context_save(type='guideline', instruction=..., material=...)` — Save reusable org
  knowledge as a guideline. Use for documents, playbooks, team decisions, and policies
  that apply beyond a single record.
- `memory_batch_store(items=[...])` — For 5+ records in a single store operation.
  Never loop individual `memory_save` calls for bulk writes.

**Pitfalls:**

- Do not store raw conversation text verbatim as a memory — atomize it into one-sentence
  facts. Exception: use `context_save` (or the Notebook pattern if available) when the
  exact wording must be preserved.
- Do not skip Store because the action "seemed minor" — incomplete audit trails compound
  into unreliable recall within a few sessions.
- For bulk operations (importing, syncing, backfilling 5+ records), call
  `personize_cookbook` for a proven batch recipe before writing a loop.

---

## Tool Routing — When to Use Which

| Signal | Tool | Key Parameters |
|--------|------|----------------|
| Specific person or company mentioned | `memory_retrieve` | `email=` or `website_url=`; add `generate_answer=true` for synthesis |
| No specific record; load self-state | `memory_retrieve` | `about='self'`, `generate_answer=true` |
| "How do we…", "what's our policy…", "show me the playbook" | `context_retrieve` | `message=<user query>`, `types=['guideline']` |
| Load a specific named guideline | `context_retrieve` | `contextNames=['<slug>']` |
| "I prefer…", "remember for me…", "my working style" | `memory_save` | `about='self'`, `content=<one-sentence fact>` |
| "Our team decided…", "new policy…", "org-wide rule" | `context_save` | `type='guideline'`, `instruction=`, `material=` |
| Save a fact about a record | `memory_save` | `email=` or `website_url=`, `enhanced=true` |
| Update a property on a record | `memory_update_property` | `propertyName=`, `operation='set'`, `value=` |
| Check for duplicate before creating | `memory_find_similar` | `query=<name or description>` |
| List records by status or type | `memory_filter_by_property` | `type=`, `conditions=[...]` — zero credit cost |
| Save a document or reusable template | `context_save` | `aiExtraction=false` to store verbatim |
| 5+ records: import, sync, backfill, dedupe | `personize_cookbook` | Describe the operation; get a batch recipe |
| Read a section of a long guideline | `context_manage_read` | `guidelineId=`, `header='## Section Name'` |
| Create a new guideline document | `context_manage_create` | `name=`, `value=`, `agentDocType='guideline'` |
| Update a section of an existing guideline | `context_manage_update` | `guidelineId=`, `updateMode='section'` |

**Decision rule — `context_save` vs `memory_save`:**
- `context_save` for documents and reusable material that applies across records or sessions.
- `memory_save` for atomic facts about specific records or self.

---

## Three-Scope Memory

Personize memory has three visibility scopes. Pick the right one when saving.

| Scope | How to Save | Who Sees It | When to Use |
|-------|------------|-------------|-------------|
| **Self** (user-private) | `memory_save(about='self')` | Only the current user | Personal preferences, working style, your own config decisions |
| **Record** (org-shared) | `memory_save(email=...)` or `memory_save(website_url=...)` | All teammates | Facts about contacts, companies, deals — shared org knowledge |
| **Workspace** (org-shared) | `memory_save(type='workspace'` or `'project'` or `'campaign'` or `'task'` `)` | All teammates | Shared project state, campaign status, task tracking, team decisions |

**Principle:** When in doubt between self and workspace, ask whether a teammate running
the same task next week would need this information. If yes, use workspace or record scope.

---

## Hard Rules

These rules are universal across all repos and agents using this playbook.

1. **Opt-outs are immediate and permanent.** When a record indicates an opt-out (by any
   label the project uses), update the opt-out flag in Personize immediately. Never
   contact or include that record in future actions. No exceptions, no expiry.

2. **Ambiguous intent means flag, not act.** If the user's instruction is unclear, or if
   recall and governance do not provide enough information to act with confidence, surface
   the ambiguity and ask. Do not make a best-guess action on unclear input.

3. **Everything is logged.** Every action taken, content sent, stage change, and decision
   made must be stored in Personize. The audit trail is not optional.

4. **Must not fabricate without memory evidence.** If recall returns no evidence for a
   fact, state that you do not know. Do not infer a fact from conversational context alone
   and present it as a stored truth.

5. **Respect the project's safety gate.** If the project configures a safety gate (e.g.,
   a DRY_RUN flag, a confirmation step), treat it as a hard constraint. Show the intended
   action and wait for explicit authorization before executing any irreversible operation.

6. **High-risk actions require explicit authorization.** Bulk deletes, first activations,
   policy changes, and any action that cannot be rolled back — always confirm with the
   user before proceeding.

---

## When to Escalate

Stop and surface to the user (do not continue acting) when:

- Two guidelines conflict and neither is clearly subordinate to the other.
- Recall returns no data for a record you are about to take a high-stakes action on.
- The task requires capabilities or permissions not available in the current session.
- The intended action is irreversible and authorization is ambiguous or absent.
- The user's intent is unclear after one clarifying question.
- An unexpected error occurs during Act — do not retry silently; report and ask.

---

## Anti-Patterns

**Do not:**

- **Assume without Recall.** Proceeding on conversational context without `memory_retrieve`
  means you are inventing the org's knowledge state.
- **Act without Govern.** Even if you remember a rule from a previous session, re-load it.
  Guidelines evolve; stale rules produce non-compliant actions.
- **Silently skip Store.** "I'll remember this" does not persist across sessions.
  Personize memory is the only memory that survives a context reset.
- **Loop individual saves for bulk data.** Call `personize_cookbook` for any operation
  involving 5+ records.
- **Treat DRY_RUN (or any safety gate) as optional.** It exists to prevent irreversible
  actions. Bypassing it — even "just to test" — defeats its purpose.
- **Fabricate a record to fill a gap.** If a contact, company, or document does not exist
  in Personize, say so and ask the user to provide it.
- **Interpret silence as approval.** No response to a confirmation prompt is not a "yes".
  Wait for an explicit signal before executing high-stakes actions.
- **Duplicate this playbook in repo-specific CLAUDE.md files.** Extend it; never
  copy-paste it. Changes to the canonical playbook propagate automatically via
  `context_retrieve(contextNames=['agent-playbook'])`.
