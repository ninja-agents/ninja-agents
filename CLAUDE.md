# Ninja Agents

AI agents for engineering teams. This project contains reusable Claude Code agents that query GitHub, GitLab, and Jira to generate team intelligence.

## Prerequisites

Before running any agent, ensure these MCP servers are configured in Claude Code:

- **GitHub MCP** — for PR and commit data from github.com
- **GitLab MCP** (`@zereight/mcp-gitlab`) — for MR and commit data from gitlab.cee.redhat.com
- **Atlassian Rovo MCP** — for Jira ticket data from redhat.atlassian.net

Tokens are loaded from `.env` (copy from `.env.example`). Never commit `.env`.

## Team Configuration

All team-specific data lives in `data/team-config.json`:
- Engineer names, GitHub/GitLab usernames, Jira account IDs
- Product areas with repo and Jira prefix mappings
- Jira cloud ID and filter configuration

Agents read this file at runtime — no team data is hardcoded in agent specs or scripts.

## Available Skills

| Skill | Description | Time |
|-------|-------------|------|
| `/team-update` | Weekly team report for leadership (7-day window) | ~30-40s |

## MCP Tool Patterns

### GitHub (search PRs)
```
mcp__github__search_pull_requests:
  query: "author:{username} is:merged merged:{7_days_ago}..{today}"
```

### GitLab (list MRs)
```
mcp__gitlab__list_merge_requests:
  author_username: {username}
  scope: "all"              # REQUIRED — without this, results may be empty
  state: "merged"
  updated_after: {7_days_ago}  # ISO-8601: YYYY-MM-DDT00:00:00Z
  per_page: 100
```

### Jira (search with JQL)
```
mcp__atlassian__searchJiraIssuesUsingJql:
  cloudId: "redhat.atlassian.net"
  jql: '(assignee = "{account_id}" OR cf[10470] = "{account_id}") AND project in (...) AND updated >= -7d'
  maxResults: 100
  fields: ["summary", "status", "assignee", "resolution", "resolutiondate", "issuetype", "priority", "updated", "created", "customfield_10470"]
```

## Output Formatting Rules

- **All links use markdown hyperlinks with descriptive text:**
  - Jira: `[MTV-4458 - UI Show MTV metrics](https://redhat.atlassian.net/browse/MTV-4458)`
  - GitHub PR: `[PR #123 - Add VM wizard](https://github.com/org/repo/pull/123)`
  - GitLab MR: `[MR !456 - Fix migration](https://gitlab.cee.redhat.com/org/repo/-/merge_requests/456)`

- **Jira resolution field matters:**
  - Only `resolution = "Done"` counts as a completed deliverable
  - "Cannot Reproduce", "Won't Do", "Duplicate" are NOT deliverables

## Workflow: Weekly Team Report

The `/team-update` skill launches the `weekly-team-update` agent which:

1. Reads `data/team-config.json` for engineer usernames
2. Fetches data in 2 parallel batches:
   - Batch 1: GitHub PRs (merged + open) + Jira tickets (18 parallel queries)
   - Batch 2: GitLab MRs (merged + open) (12 parallel queries)
3. Saves results as CSV in `data/cache/team-wide/`
4. Runs `python3 scripts/generate-weekly-report.py` for deterministic formatting
5. Validates links with `python3 scripts/validate-report-links.py`
6. Saves report to `data/team-wide/weekly-update-{date}.md`

**The agent does NOT format the report itself** — the Python script handles all filtering, nesting, and formatting deterministically.
