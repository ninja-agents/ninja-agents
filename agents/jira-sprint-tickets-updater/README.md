# Jira Sprint Tickets Updater

Transition Jira sprint tickets based on the status of their linked GitHub PRs.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for root CLI reads and approved transitions.
- **GitHub MCP** — the sole project MCP server, for linked PR/issue status checks.
- **Private config** — `jira.cloud_id` is the Jira DNS hostname (not a URL or cloud UUID), with engineer account IDs, project workflow rules, and sprint name matching.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. See the [setup guide](../../docs/mcp-setup.md).

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

1. Reads config for engineers, project workflows, sprint matching, and transition rules
2. Discovers the active sprint using `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search` with the first engineer's account-ID/openSprints JQL, `--fields summary,customfield_10020 --limit 1`
3. Uses the same CLI's `search` for the configured sprint/project scope with `--fields summary,status,assignee,resolution,issuetype,priority,updated,created,description,customfield_10020,customfield_10028`; ticket pagination is internal and unbounded
4. Finds GitHub PR/issue URLs through Jira `remote-links` and normalized description text, then checks their states using GitHub MCP
5. Preserves `data/cache/jira-tickets.csv` with header `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states`; the existing script generates proposals from configured rules
6. Displays the complete preview and waits for explicit user approval/selection
7. Sequentially reads `transitions --key '{key}'`, selecting the configured ID only if its destination exactly matches the target; otherwise falls back to the case-sensitive destination name, or skips if unavailable
8. Applies the selected returned ID through `transition --key '{key}' --transition-id '{chosen_id}' --approved`, continuing after per-ticket mutation failures and reporting successful, failed, and skipped outcomes

Quote resolved arguments safely; `npm run jira:rest -- ...` is an alternative root CLI entrypoint. `--limit 1` is only for sprint discovery, never ticket collection. Required Jira/GitHub read failures STOP before further processing; consume only successful complete results. `--approved` is a mechanical guard, not a replacement for the preview's real approval. Protected statuses and the prohibition on backward transitions remain enforced; the workflow never creates or deletes tickets.

## Configuration

Edit `data/config.json` to customize:

- **`jira.cloud_id`** — DNS hostname for Jira REST commands
- **`engineers[].jira_account_id`** — roster used for active-sprint discovery
- **`projects.<key>.workflows.<type>`** — per-project workflow maps containing issue types and transition rules
- **`sprint.name_pattern`** — sprint name matching
- **`github_link_fields`** — remote links and description fields used for GitHub references
- **`protected_statuses`** — statuses that must never be moved backward

### Transition Rules

Each rule has:

- `from` — the ticket's current status (must match exactly)
- `to` — the target destination status (case-sensitive)
- `transition_id` — preferred ID, accepted only when its returned destination matches `to`
- `condition` — `all_links_resolved`, `has_active_link`, or `has_open_pr`
- `description` — human-readable explanation shown in the preview

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
