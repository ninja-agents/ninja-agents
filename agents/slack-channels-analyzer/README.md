# Slack Channels Analyzer

Analyze Slack channels to identify UI-related topics, categorize threads by keyword, and surface trends with actionable recommendations.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Slack credentials** — `SLACK_TOKEN` and `SLACK_COOKIE` in the environment for the existing read-only Slack collector.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for required dedup/detail reads and optional approved filing.
- **Private config** — channels and `jira_filing` routing, with `jira_filing.cloud_id` as a DNS hostname (not a URL or cloud UUID).
- **Local plugin repositories** — used by the canonical workflow to research affected UI code and link GitHub source context.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. GitHub is the sole project MCP server; Jira access uses the root REST CLI. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/slack-channels-analyzer
```

### Cursor

In Cursor chat, mention `@slack-channels-analyzer` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# Fetch messages from Slack and generate the categorized report
npm run slack-channels-analyzer:generate -- --config agents/slack-channels-analyzer/data/config.json --output agents/slack-channels-analyzer/data/output/report.md

# Validate output
npm run slack-channels-analyzer:validate -- agents/slack-channels-analyzer/data/output/report.md --verbose

# Run tests
npm run slack-channels-analyzer:test
```

## How It Works

1. **Read config** — loads channel IDs, keyword categories, and lookback period from `data/config.json`
2. **Fetch Slack data** — the existing TypeScript script reads Slack through `@slack/web-api` with token/cookie auth; the canonical workflow uses `--format json` and reads the generated `report.json`
3. **Filter & classify** — the agent keeps UI-relevant threads and determines issue type/component ownership
4. **Deduplicate in Jira** — runs `node --import tsx scripts/jira-rest.ts --site '{jira_filing.cloud_id}' search` for project/component matches and a second required cross-project query OR-ing `text ~ "<term>"` for 2–3 extracted terms; also reads tracker details/backports and broad open bugs through `issue`/`search`
5. **Research & re-check** — examines local plugin code and verifies that filing candidates are real UI issues rather than backend problems or existing trackers
6. **Generate focused report** — preserves Slack/GitHub/Jira links, tracker/version coverage, filing templates, and an agent-written executive summary; validates and displays the full report
7. **Optional filing** — presents each issue's complete payload and related Relates links for individual **file / skip / edit** approval; edits require a new preview and approval
8. **Apply approved item** — uses root CLI `create-issue --body-file ... --approved`, then `link-issues --body-file ... --approved` only for approved Relates links; each call performs one mutation, with failures/warnings recorded per item

Cross-project discovery is **lexical Jira text search**, not semantic-search equivalence. Escape backslashes/quotes in JQL literals separately from shell quoting. The CLI completes pagination internally and returns `{issues:[...]}`; do not add manual page loops or limits. Every Jira read is required: exit 1 STOPs before further classification, focused-report output, or filing approval; a failed query is not proof that no duplicate exists. `npm run jira:rest -- ...` is an alternative root CLI entrypoint.

Filing body files contain only approved data and must be owned single-link regular `0600` files under fresh owned `0700` scratch storage, never tracked configs or repository cache files. Convert each approved description/template line to one ADF paragraph, retaining all text and URLs. `--approved` is a mechanical guard, not user approval; process items sequentially. A failed link does not roll back a created issue. Remove scratch bodies after recording results.

**Never post to Slack.** After Jira creation, suggest a reply for the user to post themselves.

## Configuration

Copy the example config and customize:

```bash
cp agents/slack-channels-analyzer/data/config.example.json agents/slack-channels-analyzer/data/config.json
```

Edit `data/config.json` to customize:

- **channels** — which Slack channels to analyze (array of `{ id, name }`)
- **keywords** — category names mapped to keyword arrays for message classification
- **lookback_days** — how many days of history to analyze (default: 30)
- **jira_filing** — Jira DNS hostname, bug/feature routing, component sets, and labels for deduplication and per-item approved filing

## File Layout

```
agents/slack-channels-analyzer/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── generate-report.ts
│   ├── generate-report.test.ts
│   └── validate-output.ts
└── data/
    ├── config.example.json  # starter config (committed)
    ├── config.json          # your config (gitignored)
    ├── cache/               # temporary data (gitignored)
    └── output/              # generated reports (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
