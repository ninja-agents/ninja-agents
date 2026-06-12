---
name: slack-forums-analyzer
description: Analyze Slack forum channels to identify UI-related topics and trends
user-invocable: true
disable-model-invocation: true
---

Analyze Slack forum channels to identify UI-related topics, categorize threads by keyword, and generate a summary report with recommendations.

## Usage

```bash
/slack-forums-analyzer
```

## What This Does

Launches the `slack-forums-analyzer` agent which:

1. Reads channel IDs and keyword categories from config
2. Fetches messages from the Slack API and categorizes by keyword (single script call)
3. Writes a summary with recommendations (the only prose the agent produces)
4. Validates the report structure
5. Displays the full categorized report

## Expected Output

A markdown report with:

- Per-category breakdowns (thread counts, key messages, participants)
- Uncategorized threads section
- Agent-written summary with 3-5 key findings and 1-2 recommendations

Saved to `agents/slack-forums-analyzer/data/output/report.md`.

## Critical Rules

- **Read-only** — never posts messages, reactions, or modifies Slack channels
- **Requires Slack tokens** — `SLACK_TOKEN` (xoxc) and `SLACK_COOKIE` (xoxd) env vars must be set
- **Config-driven** — channels and keyword categories come from config, never hardcoded
- **Script-formatted** — the TypeScript script handles fetching and categorization; agent only writes the summary section
