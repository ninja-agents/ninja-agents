# Jira Add Missing Activity Type

Finds completed Jira tickets missing the Activity Type field, classifies each ticket based on configurable rules, and updates them after user approval.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for root CLI reads.
- **Private config** — `jira.cloud_id` is the Jira DNS hostname; the existing apply writer additionally uses `jira.user_email` from `data/config.json` with `JIRA_API_TOKEN`.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. No Jira MCP server is required. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/jira-add-missing-activity-type
```

### Cursor

In Cursor chat, mention `@jira-add-missing-activity-type` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# After the agent writes jira-tickets.csv to data/cache/:
npm run jira-add-missing-activity-type:classify

# Apply classified activity types to Jira (requires JIRA_API_TOKEN):
npm run jira-add-missing-activity-type:apply -- --cache agents/jira-add-missing-activity-type/data/cache

# Dry run (preview without making changes):
npm run jira-add-missing-activity-type:apply -- --dry-run --cache agents/jira-add-missing-activity-type/data/cache
```

## How It Works

1. **Read config** — loads JQL query, classification rules, and Activity Type field mapping from `data/config.json`
2. **Fetch tickets** — runs `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql '{jira.jql}' --fields summary,issuetype,labels`; the CLI completes pagination internally and returns `{issues:[...]}`
3. **Save to CSV** — the agent maps returned issues to `data/cache/jira-tickets.csv` with header `key,summary,issuetype,labels`, semicolon-joining labels and CSV-quoting commas/quotes
4. **Classify** — runs `classify-tickets.ts` to match each ticket against rules (labels, keywords, issue type) and generate a preview
5. **Preview & approve** — displays proposed Activity Type assignments; waits for user approval before any changes
6. **Apply updates** — the existing `apply-activity-types.ts` REST writer sets the Activity Type field on each approved ticket

Substitute the configured hostname and literal JQL as safely quoted arguments. `npm run jira:rest -- ...` is an alternative root CLI entrypoint. Do not add manual page loops or `--limit` to collection. A required read failure exits 1: display its safe diagnostic and STOP before classification, preview, or approval; never consume partial results.

## Configuration

Edit `data/config.json` to customize:

- **JQL query** — which tickets to target (default: your saved filter + Done + Activity Type empty)
- **Classification rules** — ordered list of rules mapping labels/keywords/issue types to Activity Types
- **Default Activity Type** — fallback for tickets matching no rule (default: Product / Portfolio Work)

### Activity Type Values

| Value                             | Option ID |
| --------------------------------- | --------- |
| Associate Wellness & Development  | 10604     |
| Future Sustainability             | 10606     |
| Incidents & Support               | 10607     |
| Quality / Stability / Reliability | 10608     |
| Security & Compliance             | 10609     |
| Product / Portfolio Work          | 10610     |

## File Layout

```
agents/jira-add-missing-activity-type/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── classify-tickets.ts
│   └── classify-tickets.test.ts
└── data/
    ├── config.json
    ├── cache/          # temporary data (gitignored)
    └── output/         # generated preview (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
