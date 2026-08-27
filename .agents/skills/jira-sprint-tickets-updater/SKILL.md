---
name: jira-sprint-tickets-updater
description: Transition Jira sprint tickets based on linked GitHub PR status. Fetches sprint tickets, checks PR states, previews changes, applies after confirmation.
user-invocable: true
disable-model-invocation: true
---

Transition Jira sprint tickets based on the status of their linked GitHub PRs.

## Usage

```bash
/jira-sprint-tickets-updater
```

## What This Does

Launches the `jira-sprint-tickets-updater` agent which:

1. Reads config for sprint scope, project keys, and transition rules
2. Fetches all tickets in the active sprint from Jira
3. Finds linked GitHub PRs via remote links and ticket fields
4. Checks PR status on GitHub (merged, open, closed)
5. Proposes status transitions based on configured rules
6. Previews changes and waits for user confirmation
7. Applies approved transitions and displays a summary

## Expected Output

A preview table of proposed transitions (ticket key, current status, target status, linked PR), followed by a summary of applied changes after user approval.

## Critical Rules

- **Never modifies tickets without user confirmation** — preview is always shown first
- Only transitions status — never creates, deletes, or modifies other ticket fields
- Transition rules are defined in `agents/jira-sprint-tickets-updater/data/config.json`
- Requires both Atlassian and GitHub MCP servers to be configured
