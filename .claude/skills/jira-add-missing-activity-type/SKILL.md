---
name: jira-add-missing-activity-type
description: Add missing Activity Type field to completed Jira tickets based on classification rules
user-invocable: true
disable-model-invocation: true
---

Finds Jira tickets with status Done that are missing the Activity Type field, classifies each into the correct type, and updates them after user approval.

## Usage

```bash
/jira-add-missing-activity-type
```

## What This Does

Launches the `jira-add-missing-activity-type` agent which:

1. Reads classification rules and JQL from config
2. Fetches all Done tickets missing the Activity Type field
3. Classifies each ticket based on issue type, labels, and summary keywords
4. Displays a preview table with proposed Activity Type assignments
5. Applies updates to Jira after user approval

## Expected Output

- Summary table of Activity Type counts
- Full preview table: ticket key (linked), issue type, proposed Activity Type, match reason
- Flagged "defaulted" tickets that matched no specific rule
- After approval: per-ticket update confirmation and final count

## Critical Rules

- Never updates tickets without showing preview and getting explicit user approval
- Never overwrites existing Activity Type values — only fills in empty ones
- Classification rules are priority-ordered (first match wins) and configurable in `agents/jira-add-missing-activity-type/data/config.json`
- Activity Type field is `customfield_10464` (Jira dropdown)
