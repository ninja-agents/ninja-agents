---
name: sprint-planning-analysis
description: Sprint planning health-check comparing target sprint against velocity
argument-hint: [sprint-name]
arguments: [sprint_name]
user-invocable: true
---

Analyze a future or upcoming sprint and generate a planning health-check report by comparing the plan against proven velocity from the previous sprint.

## Usage

```bash
/sprint-planning-analysis                              # auto-discovers the next/future sprint
/sprint-planning-analysis "MIG-NET-Frontend Sprint 3"  # analyze a specific sprint
```

## What This Does

Launches the `sprint-planning-analysis` agent which:

1. Runs `agents/sprint-planning-analysis/scripts/fetch-data.ts` to discover the target sprint (from argument or future/active sprint auto-discovery)
2. Builds persistent velocity baselines and fetches fresh target sprint issues directly from Jira REST on every run
3. Preserves sprint lifecycle evidence as `{id, name, state}` objects; never infer lifecycle state from dates or sprint names
4. Saves CSV and velocity JSON caches in `agents/sprint-planning-analysis/data/cache/`
5. Runs `generate-sprint-planning-analysis.ts` which computes: capacity vs. velocity, load distribution, retro compliance, carryover analysis, planning hygiene, and recommendations
6. Writes Key Takeaways — actionable observations for the planning session
7. Saves and displays the report

**Time:** ~15-25 seconds

## Expected Output

A markdown report saved to `agents/sprint-planning-analysis/data/output/sprint-planning-analysis-{date}.md` with:

- **Key Takeaways** — 3-5 actionable observations with implications
- **Capacity vs. Velocity** — remaining SP/issues against historical velocity, plus already-Done target credit and recommended total (script-generated)
- **Load Distribution** — completed/remaining load and additive target after PTO, with QA Contact counting for QE (script-generated)
- **Retro Compliance** — previous retro recommendations checked against the plan (script-generated)
- **Carryover from Previous Sprint** — items carried over with priority and status (script-generated)
- **Planning Hygiene** — unassigned, unestimated, duplicate, oversized unfinished items (script-generated)
- **Recommendations** — actionable items for the planning session (script-generated)
- **Individual DM Recommendations** — copy-paste messages with planned, completed, remaining and recommended total SP (script-generated)

## Critical Rules

1. Works best when a sprint review report exists from the previous sprint (`/sprint-review`)
2. Only `resolution = "Done"` counts as completed (for velocity calculation)
3. Engineer data is configured in `agents/sprint-review/data/sprint-config.json` (shared config)
4. Follow `.claude/agents/sprint-planning-analysis.md` for the existing collector's commands and exit handling; do not introduce another root CLI or MCP collection path
5. Requires Node.js 22+, installed repository-root dependencies, and environment variables `JIRA_EMAIL` and `JIRA_API_TOKEN`; never print their values
6. Fatal collection failures or missing required sprint/velocity caches STOP before report generation; report warnings and data-quality handling retain the canonical workflow's rules
