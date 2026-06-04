# Sprint Planning Health-Check

Analyzes a future or upcoming Jira sprint by comparing the plan against proven velocity from the past 2 sprints. Produces a health-check report with capacity analysis, load distribution, individual velocity averages, retro compliance checks, carryover tracking, planning hygiene flags, and actionable recommendations. Past sprint velocity data is persistently cached to avoid re-fetching from Jira on subsequent runs.

## Prerequisites

- [Atlassian Rovo MCP](https://www.npmjs.com/package/@anthropic-ai/mcp-atlassian) configured with access to your Jira instance
- Shared sprint config at `agents/sprint-review/data/sprint-config.json` (see `sprint-config.example.json` in the sprint-review agent)

## Usage

### Claude Code

```bash
/sprint-planning-analysis                              # auto-discovers the next/future sprint
/sprint-planning-analysis "MIG-NET-Frontend Sprint 3"  # analyze a specific sprint
```

### Cursor

Mention `@sprint-planning-analysis` in chat, or describe what you need:

> "Analyze the upcoming sprint planning health"

### Manual

```bash
npx tsx agents/sprint-planning-analysis/scripts/generate-sprint-planning-analysis.ts \
  --date 2026-05-18 \
  --target-csv agents/sprint-planning-analysis/data/cache/sprint-issues.csv \
  --velocity-file agents/sprint-planning-analysis/data/cache/velocity-summary.json \
  --velocity-history agents/sprint-planning-analysis/data/cache/velocity-history.json \
  --config agents/sprint-review/data/sprint-config.json
```

## How It Works

1. **Read config** — loads shared `sprint-config.json` and determines the target sprint (from argument or auto-discovery via Jira)
2. **Find velocity baseline (N-1)** — checks velocity history cache, then sprint review report, CSV cache, or queries Jira as fallback; writes `velocity-summary.json` and upserts into `velocity-history.json`
3. **Find velocity baseline (N-2)** — checks velocity history cache first; fetches from Jira only if not cached; upserts into `velocity-history.json`
4. **Fetch target sprint** — queries Jira for all issues in the target sprint and saves to CSV
5. **Generate report** — TypeScript script computes capacity vs. velocity, load distribution, individual velocity averages (2-sprint), retro compliance, carryover analysis, planning hygiene, and recommendations
6. **Write takeaways** — agent writes 3-5 Key Takeaway bullets synthesizing the analysis
7. **Display** — shows the report to the user

## Configuration

This agent uses the same config as `sprint-review`:

```
agents/sprint-review/data/sprint-config.json
```

See the sprint-review agent's `sprint-config.example.json` for the schema. Key fields:

- `board_id` — Jira Scrum board ID
- `engineers[]` — team roster with `jira_account_id`, `jira_display_names`, and `role` (dev/qe)
- `statuses` — status group mappings (not_started, in_progress, testing, done)
- `thresholds` — configurable analysis thresholds

## File Layout

```
agents/sprint-planning-analysis/
├── README.md
├── scripts/
│   ├── generate-sprint-planning-analysis.ts       # analysis engine
│   └── generate-sprint-planning-analysis.test.ts  # unit tests
└── data/
    ├── cache/
    │   ├── sprint-issues.csv             # target sprint issues (rebuilt each run)
    │   ├── velocity-summary.json         # N-1 sprint velocity (rebuilt each run)
    │   └── velocity-history.json         # persistent multi-sprint velocity cache
    └── output/
        └── sprint-planning-analysis-{date}.md     # health-check report
```
