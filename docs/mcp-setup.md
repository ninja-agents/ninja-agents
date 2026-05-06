# MCP Server Setup

This guide walks you through configuring the MCP servers that agents in this repo depend on. The server definitions live in `.mcp.json` (committed to the repo); you only need to supply your personal tokens.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- [Node.js](https://nodejs.org/) 18+ (for the GitLab stdio server)

## Quick Start

```bash
cp .env.example .env
# Edit .env with your tokens (see steps below)
```

Restart Claude Code after editing `.env` — it loads environment variables at startup.

## Token Setup

### 1. GitHub Personal Access Token

Used by the GitHub MCP server for PR and commit data.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Create a **fine-grained** or **classic** token with these scopes:
   - `repo` — read access to repositories
   - `read:org` — read org membership
3. Copy the token into `.env`:
   ```
   GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

### 2. GitLab Personal Access Token

Used by the GitLab MCP server for MR data from `gitlab.cee.redhat.com`.

1. Go to [gitlab.cee.redhat.com/-/profile/personal_access_tokens](https://gitlab.cee.redhat.com/-/profile/personal_access_tokens)
2. Create a token with these scopes:
   - `api` — full API access
   - `read_api` — read-only API access (sufficient if you only need to read)
   - `read_repository` — read repo contents
3. Copy the token into `.env`:
   ```
   GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx
   ```

### 3. Atlassian (no token needed)

The Atlassian Rovo MCP server authenticates via browser OAuth. On first use, Claude Code will open a browser window for you to log in to your Atlassian account. No `.env` entry is needed.

## Verification

After setting up `.env`, restart Claude Code and run:

```
/mcp
```

You should see three servers listed: **github**, **gitlab**, and **atlassian**.

To test each server individually:

```bash
# GitHub — search for your own PRs
mcp__github__search_pull_requests with query: "author:YOUR_USERNAME is:merged"

# GitLab — list your MRs
mcp__gitlab__list_merge_requests with author_username: "YOUR_USERNAME", scope: "all", state: "merged", per_page: 5

# Atlassian — search Jira
mcp__atlassian__searchJiraIssuesUsingJql with jql: "assignee = currentUser() ORDER BY updated DESC", maxResults: 5
```

## How It Works

The MCP servers are defined in `.mcp.json` at the project root:

| Server | Type | Endpoint |
|--------|------|----------|
| **github** | HTTP | `api.githubcopilot.com/mcp/` |
| **gitlab** | stdio | `npx @zereight/mcp-gitlab` |
| **atlassian** | HTTP | `mcp.atlassian.com/v1/mcp` |

Token references in `.mcp.json` use `${VAR_NAME}` syntax, which Claude Code resolves from your environment (including `.env`).

## Troubleshooting

### `/mcp` shows no servers

- Make sure `.mcp.json` exists in the project root (it should be committed to the repo)
- Restart Claude Code after cloning or pulling

### Server shows but tools fail with auth errors

- Check that `.env` has the correct token values
- For Atlassian, try re-authenticating by using an Atlassian MCP tool — it will reopen the browser OAuth flow
- Restart Claude Code after editing `.env`

### GitLab returns empty results

- Always pass `scope: "all"` in GitLab MCP queries — without it, results may be empty
- Verify your token has `api` or `read_api` scope
- Check that `GITLAB_PAT` is set (not `GITLAB_PERSONAL_ACCESS_TOKEN` — the `.mcp.json` maps it for you)

### GitHub token not working

- Classic tokens need the `repo` scope
- Fine-grained tokens need repository access for the orgs you're querying
- The GitHub MCP endpoint (`api.githubcopilot.com`) requires a PAT, not an OAuth token
