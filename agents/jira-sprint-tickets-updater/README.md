# Jira Sprint Tickets Updater

Transition Jira sprint tickets based on the status of their linked GitHub PRs.

## Prerequisites

- **Atlassian Rovo MCP** — Jira ticket data from redhat.atlassian.net
- **GitHub MCP** — PR status checks from github.com
- Tokens must be set as environment variables before launching Claude Code.

## Usage

### Claude Code

```bash
/jira-sprint-tickets-updater
```

### Cursor

In Cursor chat, mention `@jira-sprint-tickets-updater` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
npm run jira-sprint-tickets-updater:generate -- --config agents/jira-sprint-tickets-updater/data/config.json --cache agents/jira-sprint-tickets-updater/data/cache --output agents/jira-sprint-tickets-updater/data/output/proposed-transitions.md
```

## How It Works

1. Reads config for sprint scope, project keys, and transition rules
2. Fetches all tickets in the active sprint from Jira
3. Finds linked GitHub PRs via remote links and ticket fields
4. Checks PR status on GitHub (merged, open, closed)
5. Builds transition proposals by matching ticket status + PR state against rules
6. Displays a preview table of proposed changes and waits for user confirmation
7. Applies approved transitions sequentially and displays a summary

## Configuration

Edit `data/config.json` to customize:

- **`jira.board_id`** — the Jira board to find the active sprint
- **`jira.project_keys`** — which projects to include in the sprint query
- **`sprint.name_pattern`** — prefix or regex to match the sprint name
- **`transition_rules`** — rules mapping `from_status` + `condition` → `to_status`
- **`pr_link_fields`** — where to look for PR URLs on each ticket

### Transition Rules

Each rule has:

- `from_status` — the ticket's current status (must match exactly)
- `to_status` — the target status to transition to
- `condition` — one of: `all_prs_merged`, `has_open_pr`, `any_pr_merged`
- `description` — human-readable explanation (shown in preview)

## File Layout

```
agents/jira-sprint-tickets-updater/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── generate-ticket-updates.ts
│   ├── generate-ticket-updates.test.ts
│   └── validate-output.ts
└── data/
    ├── config.json
    ├── cache/            # temporary data (gitignored)
    └── output/           # generated output (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
