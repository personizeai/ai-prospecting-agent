---
name: cli
description: "Personize CLI assistant — helps users run CLI commands for setup, debugging, memory inspection, governance management, and diagnostics. Use this skill whenever the user asks to verify their setup, debug memory or recall issues, inspect a contact or company record, manage guidelines from the terminal, check their API key or plan, configure MCP in their IDE, filter or search records, test extraction quality, or says things like 'check my setup', 'what does the agent know about X', 'debug recall', 'verify my API key', 'show my guidelines', 'search contacts', 'set up MCP', 'run doctor', or 'help me troubleshoot'."
license: Apache-2.0
compatibility: "Requires @personize/cli (included as devDependency) and PERSONIZE_SECRET_KEY"
metadata: {"author": "personize-ai", "version": "1.0", "emoji": "\U0001F527", "requires": {"env": ["PERSONIZE_SECRET_KEY"]}}
---

# Skill: Personize CLI Assistant

This skill helps users interact with the Personize CLI (`npx personize`) for setup, debugging, memory inspection, governance management, and diagnostics.

## When This Skill is Activated

Whenever the user needs to:
- Verify their setup or troubleshoot issues
- Inspect what the agent knows about a specific contact or company
- Debug recall or memory quality
- Manage guidelines/governance from the terminal
- Search, filter, or query their data
- Configure MCP for their IDE
- Test extraction accuracy

---

## Available Commands

### Setup & Diagnostics

```bash
npx personize doctor                    # Verify API key, plan, connectivity
npx personize auth whoami               # Check authenticated identity
npx personize setup                     # Configure MCP in IDE (Claude Code, Cursor, Windsurf, VS Code)
npx personize setup --status            # Check current IDE config state
```

### Memory Inspection

```bash
npx personize context --email jane@acme.com                      # Full compiled context
npx personize memory properties --email jane@acme.com            # Structured properties
npx personize memory recall --email jane@acme.com --message "recent interactions"
npx personize memory smart-recall --email jane@acme.com --message "buying signals"
npx personize memory property-history --email jane@acme.com --property lead_score
npx personize memory similar --email jane@acme.com --limit 10    # Find lookalikes
```

### Searching & Filtering

```bash
# Zero-cost deterministic filter (no LLM credits)
npx personize filter --collection contacts --gt lead_score=70
npx personize filter --collection contacts --eq outreach_status=pending --logic AND

# LLM-powered natural-language query
npx personize memory query-properties --collection contacts --query "engineering leaders at Series B companies"

# Standard search
npx personize memory search --collection contacts --eq lead_score=80
```

### Guidelines / Governance

```bash
npx personize guidelines list --summary
npx personize guidelines get <id>
npx personize guidelines section <id> --header "Target Industries"
npx personize guidelines fetch "how should I handle competitor mentions"
npx personize guidelines update <id> --mode appendToSection --header "What Works" --value "Subject lines with metrics get 2x opens"
```

### Collections / Schemas

```bash
npx personize collections list
npx personize collections get <id>
npx personize collections add-property <id> --name budget_range --type string --description "Estimated budget"
npx personize evaluate --collection-id <id> --input "Sample text to test extraction..."
```

### Batch Operations & Data Management

```bash
npx personize memory batch --file data/contacts.csv --collection contacts --email-field email
npx personize memory bulk-update --email jane@acme.com --set lead_score=85 --set outreach_status=engaged
npx personize memory delete-record --email jane@acme.com          # Soft-delete (30-day recovery)
npx personize memory cancel-deletion --email jane@acme.com        # Restore within 30 days
```

### AI Prompts

```bash
npx personize prompt --instruction "Summarize this prospect" --context "email:jane@acme.com" --tier pro
npx personize prompt --instruction "Write a cold email" --context "email:jane@acme.com" --evaluate
```

---

## Troubleshooting Map

| User Says | Run This |
|---|---|
| "Is my setup working?" | `npx personize doctor` |
| "What does the agent know about X?" | `npx personize context --email X` |
| "Why did this contact get a low score?" | `npx personize memory properties --email X --properties lead_score,icp_fit,signals` |
| "Show me hot leads" | `npx personize filter --collection contacts --gt lead_score=80` |
| "Debug why recall is empty" | `npx personize doctor` then `npx personize memory recall --email X --message "test"` |
| "Update the ICP" | `npx personize guidelines list` then `npx personize guidelines update <id>` |
| "Find contacts like our best customer" | `npx personize memory similar --email best@co.com` |
| "Set up MCP in my editor" | `npx personize setup` |
| "Clean up test data" | `npx personize memory delete-record --email test@example.com` |

### Global Flags

All commands support: `--format table|json|pretty`, `--api-key <key>`, `--dry-run`, `-q` (quiet), `--fields <fields>`.
