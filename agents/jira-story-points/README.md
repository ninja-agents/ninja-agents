# Story Point Estimation

Estimate story points for unpointed Jira tickets by comparing them against historical team data.

## Prerequisites

- **Atlassian Rovo MCP** — for Jira ticket queries (read-only)
- **JIRA_API_TOKEN** — for setting fields and adding comments via REST API (get from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens))
- Tokens must be set as environment variables before launching Claude Code

## Usage

### Claude Code

```bash
/jira-story-points              # estimate all unpointed backlog tickets
/jira-story-points CNV-12345    # estimate a specific ticket
```

### Cursor

In Cursor chat, mention `@jira-story-points` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# Build reference summary from cached tickets (after agent syncs the cache)
npm run jira-story-points:build-reference -- --config agents/jira-story-points/data/config.json

# Validate output
npm run jira-story-points:validate -- agents/jira-story-points/data/cache/reference-summary.md --verbose
```

## How It Works

1. **Read config** — loads JQL filters, sizing guide, and estimation preferences
2. **Sync reference cache** — fetches historical Done tickets with SP from Jira, saves as JSON (skips if cache is <7 days old)
3. **Build reference summary** — generates SP distribution, per-type averages, and a full ticket table
4. **Identify targets** — fetches the specified ticket or finds unpointed backlog tickets
5. **Estimate** — Claude compares each target against historical data and suggests SP with reasoning
6. **Preview** — displays proposed estimates for user approval
7. **Apply** — adds a Jira comment with justification (skips if comment already exists) and sets the SP field via REST API

## Configuration

Copy the example config and customize:

```bash
cp agents/jira-story-points/data/config.example.json agents/jira-story-points/data/config.json
```

Edit `data/config.json` to set your Jira site, team filter, JQL queries, and projects. The real config is gitignored.

## File Layout

```
agents/jira-story-points/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── build-reference.ts          # generates reference summary from cached JSON
│   ├── build-reference.test.ts     # config and parsing tests
│   ├── validate-output.ts          # validates reference summary completeness
│   └── apply-story-points.ts       # sets SP field + comment via Jira REST API
└── data/
    ├── config.example.json         # template config (committed)
    ├── config.json                 # real config (gitignored)
    ├── cache/                      # cached Jira data (gitignored)
    └── output/                     # generated output (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
