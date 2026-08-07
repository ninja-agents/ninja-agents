---
name: jira-move-cnv2networking
description: Move CNV networking tickets to the correct target project (Bugs to OCPBUGS, Feature Requests to RFE)
user-invocable: true
disable-model-invocation: true
---

Move CNV Jira tickets for the networking UI team to their target projects, preview proposed moves, and apply after confirmation.

## Usage

```bash
/jira-move-cnv2networking
```

## What This Does

Launches the `jira-move-cnv2networking` agent which:

1. Reads config (source JQL, target projects and components)
2. Fetches CNV tickets matching the networking UI filter
3. Classifies each ticket: Bugs → OCPBUGS with nmstate or networking component; Feature Requests → RFE project
4. Generates and displays a preview table
5. Asks for confirmation before applying any changes
6. Applies moves sequentially (PUT then clone+link fallback)
7. Reports outcomes per ticket

## Expected Output

A markdown preview table grouped by target project, showing CNV key → target project and component. After confirmation, a terse results summary with per-ticket status.

## Critical Rules

- Never applies moves without explicit user confirmation
- Feature Requests are skipped if `targets.rfes.project` is not configured in `config.json`
- Bugs are routed to `nmstate-console-plugin` if NNCP/NMState keywords appear in the ticket; otherwise to `networking-console-plugin`
- Clone+link fallback is used automatically if Jira's cross-project PUT is rejected
