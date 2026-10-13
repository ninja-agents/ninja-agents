---
name: slack-channels-analyzer
description: Analyze Slack channels for Console Networking and NMState UI topics, cross-referenced with GitHub PRs and Jira tickets
user-invocable: true
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
4. Reads Jira via `node --import tsx scripts/jira-rest.ts --site '{jira_filing.cloud_id}' search` and `issue`, with the configured fields and queries in `.claude/agents/slack-channels-analyzer.md`
5. Filters Slack threads for **UI relevance only**, performs project/component dedup and a required cross-project lexical Jira text search, and discards backend-only topics
6. Generates a focused report; optional Jira filing happens only after explicit per-item file/skip/edit approval

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
- **No Slack or GitHub writes** — never post to Slack; Jira issue creation and displayed `Relates` links require explicit per-item **file** approval. After **edit**, show the revised item and ask again. `--approved` is only a mechanical guard, not approval.
- **Runtime and credentials** — Node.js 22+, installed repository-root dependencies, `SLACK_TOKEN` (xoxc), `SLACK_COOKIE` (xoxd), `JIRA_EMAIL`, and `JIRA_API_TOKEN` are required; never print credential values
- **Jira REST contract** — `jira_filing.cloud_id` is a DNS hostname, not a URL/UUID. Root commands own pagination; read their complete native JSON, not manual pages. Any required Jira read failure STOPs before saving the focused report or filing.
- **Cross-project discovery** — always run the second Jira-only `text ~` JQL search without project restriction, escaping backslashes and quotes in the extracted 2–3 terms. This is lexical search, not semantic-search equivalence.
- **Config-driven** — channels, keywords, Jira routing, and labels come from config; follow the canonical spec's fields, private request-body files, ADF text preservation, and approval gates without adding operations
