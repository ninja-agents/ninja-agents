# Story Point Estimation

Estimate story points for unpointed Jira tickets by comparing them against historical team data.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for reads.
- **Existing apply writer** — uses `JIRA_API_TOKEN` with `jira.user_email` from private `data/config.json`.
- **GitHub API token** — `GITHUB_PAT` for the collector's linked-PR context.

The existing collector and writer use direct APIs, not Jira MCP. Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/jira-story-points              # estimate all unpointed backlog tickets
/jira-story-points PROJ-12345    # estimate a specific ticket
```

### Cursor

In Cursor chat, mention `@jira-story-points` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# Sync reference data and fetch targets with the existing direct API collector
node --import tsx agents/jira-story-points/scripts/fetch-data.ts --sync-reference
node --import tsx agents/jira-story-points/scripts/fetch-data.ts --backlog

# Build reference summary from cached tickets (after agent syncs the cache)
npm run jira-story-points:build-reference -- --config agents/jira-story-points/data/config.json

# Validate output
npm run jira-story-points:validate -- agents/jira-story-points/data/cache/reference-summary.md --verbose
```

## How It Works

1. **Read config** — loads JQL filters, sizing guide, and estimation preferences
2. **Sync reference cache** — `scripts/fetch-data.ts --sync-reference` reads historical Done tickets with SP directly from Jira REST, saves as JSON (skips if cache is <7 days old)
3. **Build reference summary** — generates SP distribution, per-type averages, and a full ticket table
4. **Identify targets** — the same collector reads the specified ticket (`--ticket KEY`) or unpointed backlog (`--backlog`) from Jira and collects linked GitHub PR context into `data/cache/target-tickets.json`
5. **Estimate** — Claude compares each target against historical data and suggests SP with reasoning
6. **Preview** — displays proposed estimates for user approval
7. **Apply** — only after explicit user approval, the existing `apply-story-points.ts` writer sets the SP field via Jira REST

If the collector exits 1, display its diagnostic and STOP before estimation. Keep the existing local reference/target cache formats; do not add a second root-CLI collection path.

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
│   ├── fetch-data.ts               # Direct Jira/GitHub API collector
│   ├── build-reference.ts          # generates reference summary from cached JSON
│   ├── build-reference.test.ts     # config and parsing tests
│   ├── validate-output.ts          # validates reference summary completeness
│   └── apply-story-points.ts       # sets SP field via Jira REST API
└── data/
    ├── config.example.json         # template config (committed)
    ├── config.json                 # real config (gitignored)
    ├── cache/                      # cached Jira data (gitignored)
    └── output/                     # generated output (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
