# MCP Server Setup

This guide walks you through configuring the MCP servers that agents in this repo depend on. The server definitions are committed to the repo; you only need to supply your personal tokens as environment variables when launching your IDE.

## Prerequisites

- An AI-powered IDE: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Cursor](https://cursor.com)
- [Node.js](https://nodejs.org/) 18+ (for the GitLab stdio server)

## Quick Start

```bash
export GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
export GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx

claude          # Claude Code
# or open the project in Cursor
```

You can add these exports to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) so they persist across sessions.

## Token Setup

### 1. GitHub Personal Access Token

Used by the GitHub MCP server for PR and commit data.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Create a **fine-grained** or **classic** token with these scopes:
   - `repo` — read access to repositories
   - `read:org` — read org membership
3. Export the token:
   ```bash
   export GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

### 2. GitLab Personal Access Token

Used by the GitLab MCP server for MR data from `gitlab.cee.redhat.com`.

1. Go to [gitlab.cee.redhat.com/-/profile/personal_access_tokens](https://gitlab.cee.redhat.com/-/profile/personal_access_tokens)
2. Create a token with these scopes:
   - `api` — full API access
   - `read_api` — read-only API access (sufficient if you only need to read)
   - `read_repository` — read repo contents
3. Export the token:
   ```bash
   export GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx
   ```

### 3. Atlassian (no token needed)

The Atlassian Rovo MCP server authenticates via browser OAuth. On first use, your IDE will open a browser window for you to log in to your Atlassian account. No environment variable is needed.

## Verification

After exporting your tokens, launch your IDE and verify the MCP servers are connected.

**Claude Code:**

```
/mcp
```

You should see three servers listed: **github**, **gitlab**, and **atlassian**.

**Cursor:**

Open the MCP settings (Cursor Settings > MCP) and verify the three servers show a green status indicator.

To test each server, ask your IDE to run a simple query:

```bash
# GitHub — search for your own PRs
mcp__github__search_pull_requests with query: "author:YOUR_USERNAME is:merged"

# GitLab — list your MRs
mcp__gitlab__list_merge_requests with author_username: "YOUR_USERNAME", scope: "all", state: "merged", per_page: 5

# Atlassian — search Jira
mcp__atlassian__searchJiraIssuesUsingJql with jql: "assignee = currentUser() ORDER BY updated DESC", maxResults: 5
```

## How It Works

MCP server definitions live in two files (one per IDE):

| IDE         | Config File        |
| ----------- | ------------------ |
| Claude Code | `.mcp.json`        |
| Cursor      | `.cursor/mcp.json` |

Both files define the same three servers:

| Server        | Type  | Endpoint                     |
| ------------- | ----- | ---------------------------- |
| **github**    | HTTP  | `api.githubcopilot.com/mcp/` |
| **gitlab**    | stdio | `npx @zereight/mcp-gitlab`   |
| **atlassian** | HTTP  | `mcp.atlassian.com/v1/mcp`   |

Token references use `${VAR_NAME}` syntax, which both IDEs resolve from your environment variables.

## Troubleshooting

### MCP servers not showing up

- Make sure `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor) exists in the project
- Restart your IDE after cloning or pulling

### Server shows but tools fail with auth errors

- Check that the required environment variables are set: `echo $GITHUB_PAT`
- For Atlassian, try re-authenticating by using an Atlassian MCP tool — it will reopen the browser OAuth flow
- Restart your IDE after changing environment variables

### GitLab returns empty results

- Always pass `scope: "all"` in GitLab MCP queries — without it, results may be empty
- Verify your token has `api` or `read_api` scope
- Check that `GITLAB_PAT` is set (not `GITLAB_PERSONAL_ACCESS_TOKEN` — the MCP config maps it for you)

### GitHub token not working

- Classic tokens need the `repo` scope
- Fine-grained tokens need repository access for the orgs you're querying
- The GitHub MCP endpoint (`api.githubcopilot.com`) requires a PAT, not an OAuth token
