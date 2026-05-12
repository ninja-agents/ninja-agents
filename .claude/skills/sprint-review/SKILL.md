---
name: sprint-review
description: Generate a sprint retrospective analysis report from the active Jira sprint
user-invocable: true
---

Analyze the currently active sprint on the configured Jira board and generate a retrospective report to help prepare for the retro meeting.

## Usage

```bash
/sprint-review
```

No arguments needed — automatically queries the active sprint and generates the analysis.

## What This Does

Launches the `sprint-review` agent which:

1. Reads sprint config and discovers the story point custom field
2. Fetches all issues in the active sprint via Jira MCP, plus recently-updated issues for scope change detection
3. Fetches blocker details for any blocked issues (linked issues)
4. Saves data to CSV in `agents/sprint-review/data/cache/`
5. Runs `generate-sprint-review.ts` which computes: completion analysis, estimation accuracy, scope changes, carryover risk, blocker analysis, and automation opportunities
6. Writes Key Takeaways — actionable observations for the retro discussion
7. Saves and displays the report

**Time:** ~20-30 seconds

## Expected Output

A markdown report saved to `agents/sprint-review/data/output/sprint-review-{date}.md` with:

- **Key Takeaways** — 3-5 actionable observations with implications
- **Retro Discussion Guide** — what went well, what went less well, what to try next (script-generated)
- **Sprint Summary** — total issues/SP, completed vs. remaining
- **Completion Analysis** — by issue type, engineer, and priority
- **Estimation Accuracy** — SP accuracy, flagged anomalies
- **Scope Changes** — items added/removed mid-sprint
- **Carryover Risk** — unfinished items ranked by risk level
- **Blocker Analysis** — blocked and stalled items
- **Automation Opportunities** — patterns suggesting automation

## Critical Rules

1. Run BEFORE closing the sprint — the agent analyzes the currently active sprint
2. Only `resolution = "Done"` counts as completed
3. If the story point field can't be discovered, estimation analysis is skipped gracefully
4. Engineer data is configured inline in `agents/sprint-review/data/sprint-config.json`
