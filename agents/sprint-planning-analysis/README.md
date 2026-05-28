# Sprint Planning Health-Check

Analyzes a future or upcoming Jira sprint by comparing the plan against proven velocity from the previous sprint. Produces a health-check report with capacity analysis, load distribution, retro compliance checks, carryover tracking, planning hygiene flags, and actionable recommendations.

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
  --config agents/sprint-review/data/sprint-config.json
```

## How It Works

1. **Read config** — loads shared `sprint-config.json` and determines the target sprint (from argument or auto-discovery via Jira)
2. **Find velocity baseline** — checks for a sprint review report, CSV cache, or queries Jira as fallback; writes `velocity-summary.json`
3. **Fetch target sprint** — queries Jira for all issues in the target sprint and saves to CSV
4. **Generate report** — TypeScript script computes capacity vs. velocity, load distribution, retro compliance, carryover analysis, planning hygiene, and recommendations
5. **Write takeaways** — agent writes 3-5 Key Takeaway bullets synthesizing the analysis
6. **Display** — shows the report to the user

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
    ├── cache/                            # temporary data (gitignored)
    │   ├── sprint-issues.csv             # target sprint issues
    │   └── velocity-summary.json         # previous sprint velocity
    └── output/                           # generated reports (gitignored)
        └── sprint-planning-analysis-{date}.md     # health-check report
```
