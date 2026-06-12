# Jira Add Missing Activity Type

Finds completed Jira tickets missing the Activity Type field, classifies each ticket based on configurable rules, and updates them after user approval.

## Prerequisites

- **Atlassian Rovo MCP** — Jira read access to `redhat.atlassian.net` (for fetching tickets)
- **`JIRA_API_TOKEN`** — Jira API token for write access ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens))
- **`jira.user_email`** — your Jira email, set in `data/config.json`
- Tokens must be set as environment variables before launching Claude Code.

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
2. **Fetch tickets** — queries Jira for Done tickets with empty Activity Type field (paginated)
3. **Save to CSV** — writes ticket data to `data/cache/jira-tickets.csv`
4. **Classify** — runs `classify-tickets.ts` to match each ticket against rules (labels, keywords, issue type) and generate a preview
5. **Preview & approve** — displays proposed Activity Type assignments; waits for user approval before any changes
6. **Apply updates** — sets the Activity Type field on each approved ticket via the Jira API

## Configuration

Edit `data/config.json` to customize:

- **JQL query** — which tickets to target (default: saved filter 91323 + Done + Activity Type empty)
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
