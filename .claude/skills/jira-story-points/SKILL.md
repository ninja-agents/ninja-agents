---
name: jira-story-points
description: Estimate story points for unpointed Jira tickets using historical team data
argument-hint: [<ticket-key>]
arguments: [ticket_key]
user-invocable: true
disable-model-invocation: true
---

Estimate story points for Jira tickets by comparing them against historical team data.

## Usage

```bash
/jira-story-points              # find and estimate all unpointed backlog tickets
/jira-story-points CNV-12345    # estimate a specific ticket
```

## What This Does

Launches the `jira-story-points` agent which:

1. Reads config (JQL filters, sizing guide, estimation preferences)
2. Syncs a reference cache of historical Done tickets with SP values (skips if fresh)
3. Builds a reference summary with SP distribution and per-type averages
4. Identifies target tickets (specific key or unpointed backlog tickets)
5. Estimates SP by comparing targets against historical data using Claude's reasoning
6. Previews estimates with reasoning for user approval
7. Adds a Jira comment with justification and sets the SP field

## Expected Output

- A table of proposed SP estimates with confidence levels and similar ticket references
- Per-ticket reasoning explaining why the suggested SP fits
- After approval: Jira comments added and SP fields set on each ticket

## Critical Rules

- Never updates a ticket without explicit user approval — preview is mandatory
- Never overrides existing story points — only estimates unpointed tickets
- Only suggests Fibonacci values: 2, 5, 8, 13, 21
- Recommends breaking down any ticket estimated at 21 SP
