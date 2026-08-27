---
name: jira-bugs-missing-qe
description: Find resolved bugs missing QA Contact, identify verifiers from comments and transitions, preview and apply assignments
user-invocable: true
disable-model-invocation: true
---

Find resolved bugs with empty QA Contact field, identify who verified each bug by analyzing comments and status transitions, and set the QA Contact after user approval.

## Usage

```bash
/jira-bugs-missing-qe
```

## What This Does

Launches the `jira-bugs-missing-qe` agent which:

1. Reads config for JQL filter, detection keywords, and field IDs
2. Fetches resolved bugs missing QA Contact from Jira
3. Fetches changelogs for each bug to detect status transitions
4. Saves ticket data (comments + changelogs) to JSON cache
5. Runs identification script to match verifiers via keywords and transitions
6. Previews proposed QA Contact assignments for user approval
7. Applies approved assignments via Jira REST API

## Expected Output

A preview table showing each bug, the proposed QA Contact, and the evidence (comment keyword match or status transition). Unmatched bugs are listed separately and skipped. After approval, tickets are updated and a summary is displayed.

## Critical Rules

- Never assigns a QA Contact without user approval — preview is mandatory
- Skips tickets where no verifier can be identified — never guesses
- Comment keyword matching takes priority over changelog transitions
- Requires `JIRA_API_TOKEN` env var for the apply step
