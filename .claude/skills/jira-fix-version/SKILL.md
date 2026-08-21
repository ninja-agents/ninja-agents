---
name: jira-fix-version
description: Set fixVersions on resolved Jira tickets by tracing merged PR branches. Fetches tickets, checks GitHub PRs, maps (repo, branch) → fix version, previews, applies after confirmation.
user-invocable: true
disable-model-invocation: true
---

Find resolved Jira tickets (bugs and stories) missing a `fixVersions` field, trace their linked GitHub PRs to determine which branch each fix merged into, map `(repo, branch)` → Jira fix version from config, and set fixVersions after explicit user approval.

## Usage

```bash
/jira-fix-version
```

## What This Does

Launches the `jira-fix-version` agent which:

1. Reads `data/config.json` for the JQL filter and branch-to-version mapping
2. Fetches all Done tickets missing fixVersions (paginated)
3. Fetches remote links for every ticket in parallel to find GitHub PR and issue URLs
4. Resolves GitHub issue links → closing PRs via a single batched GraphQL request
5. Checks each PR's merge status and target branch in parallel
6. Maps `(repo, branch)` → Jira fix version; partial matches are proposed with a warning
7. Generates a grouped preview (by fix version) with confidence indicators and resolution dates
8. Waits for explicit user approval (supports `yes`, `all {version}`, `select`, `abort`)
9. Sets fixVersions on approved tickets sequentially

## Expected Output

A preview grouped by fix version (e.g., "MTA 8.3.0 (69)", "5.0.0 (6)") with ticket links,
summaries, source indicators ([PR] or [Issue→PR]), and resolution dates. After approval, a
summary of updated tickets, any failures, and remaining needs-review items.

## Critical Rules

- Never sets fixVersions without explicit user approval — preview is always shown first
- Skipped tickets (no linked PR) and needs-review tickets (unknown branch) are never modified
- All Jira writes use the cloudId from `config.json`
- GitHub issue resolution requires `GITHUB_PAT` environment variable
