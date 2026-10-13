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

1. Runs `agents/sprint-review/scripts/fetch-data.ts`, which reads config and discovers the active sprint directly through Jira REST
2. Fetches sprint issues using the configured custom fields and reads completed-issue changelogs for in-progress transition timestamps
3. Saves issue/transition CSV caches in `agents/sprint-review/data/cache/`; the current scope-change cache is header-only, and the collector does not fetch linked blocker details
4. Runs `generate-sprint-review.ts`, which computes completion, estimation, scope changes from available cache evidence, carryover risk, stalled items, and automation opportunities
5. Writes Key Takeaways — actionable observations for the retro discussion
6. Saves and displays the report

**Time:** ~20-30 seconds

## Expected Output

A markdown report saved to `agents/sprint-review/data/output/sprint-review-{date}.md` with:

- **Key Takeaways** — 3-5 actionable observations with implications
- **Retro Discussion Guide** — what went well, what went less well, what to try next (script-generated)
- **Sprint Summary** — total issues/SP, completed vs. remaining
- **Completion Analysis** — by issue type, engineer, and priority
- **Estimation Accuracy** — SP accuracy, flagged anomalies
- **Cycle Time** — median/avg/min/max days from In Progress to Done, by issue type
- **Scope Changes** — items added/removed mid-sprint
- **Carryover Risk** — unfinished items ranked by risk level
- **Blocker Analysis** — blocked and stalled items
- **Automation Opportunities** — patterns suggesting automation

## Critical Rules

1. Run BEFORE closing the sprint — the agent analyzes the currently active sprint
2. Only `resolution = "Done"` counts as completed
3. The story point field is configured in `jira.story_point_field`; estimation analysis is skipped when no story points are available
4. Engineer data is configured inline in `agents/sprint-review/data/sprint-config.json`
5. Requires Node.js 22+, installed repository-root dependencies, and environment variables `JIRA_EMAIL` and `JIRA_API_TOKEN`; never print their values
6. Follow `.claude/agents/sprint-review.md` for commands and exit handling; do not add root CLI or MCP collection alongside the existing collector. Fatal collection failures STOP before report generation.
