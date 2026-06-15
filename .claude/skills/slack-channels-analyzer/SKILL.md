---
name: slack-channels-analyzer
description: Analyze Slack channels for Console Networking and NMState UI topics, cross-referenced with GitHub PRs and Jira tickets
user-invocable: true
disable-model-invocation: true
---

Analyze Slack channels to identify Console Networking and NMState UI topics — bugs, feature requests, customer-reported UI issues — cross-referenced with GitHub PRs and Jira tickets.

## Usage

```bash
/slack-channels-analyzer
```

## What This Does

Launches the `slack-channels-analyzer` agent which:

1. Reads channel config and validates Slack credentials
2. Fetches messages from configured Slack channels via `@slack/web-api`
3. Fetches recent PRs and issues from `openshift/networking-console-plugin` via GitHub MCP
4. Fetches Jira tickets from CONSOLE/OCPBUGS/CNV projects via Atlassian MCP
5. Filters Slack threads for **UI relevance only** using LLM reasoning — discards backend-only topics
6. Generates a focused report cross-referencing all three sources

## Expected Output

A markdown report with:

- Executive summary (UI-specific findings)
- Active Jira tickets (status, assignee, priority)
- Recent merged and open PRs on networking-console-plugin
- UI-relevant Slack threads grouped by: bugs, feature requests, customer issues
- Open GitHub issues

Saved to `agents/slack-channels-analyzer/data/output/report.md`.

## Critical Rules

- **UI focus only** — excludes backend OVN/OVS, CI infrastructure, and general virt support topics
- **Read-only** — never posts to Slack, GitHub, or Jira
- **Requires Slack tokens** — `SLACK_TOKEN` (xoxc) and `SLACK_COOKIE` (xoxd) env vars must be set
- **Config-driven** — channels and keywords come from config, never hardcoded
