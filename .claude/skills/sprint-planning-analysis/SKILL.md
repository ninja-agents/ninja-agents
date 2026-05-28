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

1. Reads sprint config and determines the target sprint (from argument or auto-discovery)
2. Finds velocity baseline from the most recent sprint review report, CSV cache, or Jira fallback
3. Fetches target sprint issues via Jira MCP
4. Saves data to CSV and velocity JSON in `agents/sprint-planning-analysis/data/cache/`
5. Runs `generate-sprint-planning-analysis.ts` which computes: capacity vs. velocity, load distribution, retro compliance, carryover analysis, planning hygiene, and recommendations
6. Writes Key Takeaways — actionable observations for the planning session
7. Saves and displays the report

**Time:** ~15-25 seconds

## Expected Output

A markdown report saved to `agents/sprint-planning-analysis/data/output/sprint-planning-analysis-{date}.md` with:

- **Key Takeaways** — 3-5 actionable observations with implications
- **Capacity vs. Velocity** — SP/issue count compared to previous sprint (script-generated)
- **Load Distribution** — per-engineer workload vs. previous output, with QA Contact counting for QE (script-generated)
- **Retro Compliance** — previous retro recommendations checked against the plan (script-generated)
- **Carryover from Previous Sprint** — items carried over with priority and status (script-generated)
- **Planning Hygiene** — unassigned, unestimated, already-done, oversized items (script-generated)
- **Recommendations** — actionable items for the planning session (script-generated)

## Critical Rules

1. Works best when a sprint review report exists from the previous sprint (`/sprint-review`)
2. Only `resolution = "Done"` counts as completed (for velocity calculation)
3. Engineer data is configured in `agents/sprint-review/data/sprint-config.json` (shared config)
4. If no velocity baseline is found, the agent queries Jira for the previous sprint's data
