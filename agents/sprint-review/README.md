# Sprint Retrospective Analysis

Analyze the currently active Jira sprint and generate a data-driven retrospective report with completion metrics, estimation accuracy, scope changes, blockers, carryover risk, and actionable recommendations.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for reads.
- **Private sprint config** — `data/sprint-config.json`, copied from the example.

The existing collector reads Jira directly; no Jira MCP server is required. Set credentials before launching your IDE, never in command arguments or report/cache files. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/sprint-review
```

### Cursor

In Cursor chat, mention `@sprint-review` or ask for a "sprint retrospective" — the rule activates automatically and walks through the full workflow.

### Manual

Fetch the CSV cache, then run the analysis script:

```bash
node --import tsx agents/sprint-review/scripts/fetch-data.ts
npm run sprint-review:generate -- --date 2026-05-07
```

## How It Works

1. Reads sprint config (`data/sprint-config.json`)
2. Runs `scripts/fetch-data.ts` against the Jira REST API to discover the active sprint, using the configured story point field
3. Fetches active-sprint issues and completed-issue changelogs for cycle time analysis
4. Writes a header-only scope-change cache; recently updated issues and linked blocker details are not collected
5. Saves normalized data to this agent's CSV cache files
6. Runs the TypeScript analysis script which computes metrics, cycle time, the Retro Discussion Guide, and generates the report
7. Agent writes Key Takeaways section with actionable observations
8. Displays the final report

If the collector exits 1, display its diagnostic and STOP before analysis; do not proceed with empty data or route collection through a second root-CLI path.

## Setup

The sprint configuration file contains internal IDs and is gitignored. To set up:

```bash
cp agents/sprint-review/data/sprint-config.example.json agents/sprint-review/data/sprint-config.json
# Edit the private sprint-config.json with your team's real data
```

## Configuration

Edit `data/sprint-config.json` to customize:

- **board_id** — your Jira Scrum board ID
- **jira.project_key** — the Jira project key (e.g., "PROJ")
- **jira.story_point_fields** — ordered list of candidate custom field IDs to try for story points
- **thresholds** — analysis parameters (days before "stalled", estimation ratios, etc.)
- **statuses** — status groupings for your Jira workflow (blocked, not_started, in_progress, done)
- **engineers** — team members with `name`, `jira_account_id`, and `jira_display_names`

## File Layout

```
agents/sprint-review/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── fetch-data.ts               # Direct Jira REST collector
│   └── generate-sprint-review.ts    # Analysis engine
└── data/
    ├── sprint-config.example.json  # Template (committed)
    ├── sprint-config.json          # Real config (gitignored)
    ├── cache/                      # Temporary data (gitignored)
    └── output/                     # Generated reports (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
