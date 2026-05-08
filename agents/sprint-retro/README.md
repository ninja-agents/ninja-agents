# Sprint Retrospective Analysis

Analyze the currently active Jira sprint and generate a data-driven retrospective report with completion metrics, estimation accuracy, scope changes, blockers, carryover risk, and actionable recommendations.

## Prerequisites

- **Atlassian Rovo MCP** — for Jira sprint data from redhat.atlassian.net

Tokens must be set as environment variables before launching Claude Code.

## Usage

### Claude Code

```bash
/sprint-retro
```

### Manual

Run the analysis script directly (requires cached CSV data):

```bash
cd agents/sprint-retro
npm install
npm run generate -- --date 2026-05-07
```

## How It Works

1. Reads sprint config (`data/sprint-config.json`) and shared team config
2. Discovers the story point custom field by querying a sample issue
3. Fetches all issues in the active sprint via Jira JQL
4. Fetches recently-updated issues to detect scope changes
5. Saves data to CSV cache files
6. Runs the TypeScript analysis script which computes metrics and generates the report
7. Agent writes Key Takeaways section with actionable observations
8. Displays the final report

## Setup

The sprint configuration file contains internal IDs and is gitignored. To set up:

```bash
cp data/sprint-config.example.json data/sprint-config.json
# Edit sprint-config.json with your team's real data
```

Also ensure `agents/weekly-team-update/data/team-config.json` exists (see that agent's README).

## Configuration

Edit `data/sprint-config.json` to customize:

- **board_id** — your Jira Scrum board ID
- **jira.project_key** — the Jira project key (e.g., "CNV")
- **jira.story_point_fields** — ordered list of candidate custom field IDs to try for story points
- **thresholds** — analysis parameters (days before "stalled", estimation ratios, etc.)
- **statuses** — status groupings for your Jira workflow (blocked, not_started, in_progress, done)

Engineer data is shared from `agents/weekly-team-update/data/team-config.json` — edit that file to add/remove team members.

## File Layout

```
agents/sprint-retro/
├── README.md
├── package.json
├── tsconfig.json
├── scripts/
│   └── generate-sprint-retro.ts    # Analysis engine
└── data/
    ├── sprint-config.example.json  # Template (committed)
    ├── sprint-config.json          # Real config (gitignored)
    ├── cache/                      # Temporary data (gitignored)
    └── output/                     # Generated reports (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
