# Slack Channels Analyzer

Analyze Slack channels to identify UI-related topics, categorize threads by keyword, and surface trends with actionable recommendations.

## Prerequisites

- **Slack credentials** — `SLACK_TOKEN` (xoxc-...) and `SLACK_COOKIE` (xoxd-...) from the Slack desktop app.

Tokens must be set as environment variables before launching Claude Code:

```bash
export SLACK_TOKEN=xoxc-...
export SLACK_COOKIE=xoxd-...
```

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
2. **Fetch & generate report** — TypeScript script fetches messages from the Slack API (using `@slack/web-api` with xoxc/cookie auth), categorizes by keywords, and produces a structured report
3. **Write summary** — agent adds a Summary & Recommendations section with key findings
4. **Validate** — checks report structure and completeness
5. **Display** — presents the full report

## Configuration

Copy the example config and customize:

```bash
cp data/config.example.json data/config.json
```

Edit `data/config.json` to customize:

- **channels** — which Slack channels to analyze (array of `{ id, name }`)
- **keywords** — category names mapped to keyword arrays for message classification
- **lookback_days** — how many days of history to analyze (default: 30)

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
