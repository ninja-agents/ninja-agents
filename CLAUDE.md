# Ninja Agents

A shared playground for AI agents that help engineering teams. Each agent lives in its own directory under `agents/`.

## Project Structure

- `agents/{name}/` — self-contained agent directories (scripts, data, config, README)
- `.claude/agents/` — Claude Code agent specs (wiring into agent directories)
- `.claude/skills/` — Claude Code skill shortcuts
- `.mcp.json` — MCP server definitions for Claude Code (committed, no secrets; tokens resolve from env vars)
- `.cursor/mcp.json` — MCP server definitions for Cursor (mirrors `.mcp.json`)
- `.cursor/rules/` — Cursor rules that point to `.claude/agents/` specs

## Adding a New Agent

1. Create `agents/{your-agent}/` with a README, scripts, and data
2. Wire it up in `.claude/agents/{your-agent}.md` (agent spec) and `.claude/skills/{your-skill}.md` (skill shortcut)
3. See `agents/_template/` for the expected structure

## MCP Servers

Agents in this repo may use these MCP servers:

| Server                                                                          | Purpose                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------- |
| [GitHub MCP](https://github.com/github/github-mcp-server)                       | PR and commit data from github.com            |
| [@zereight/mcp-gitlab](https://www.npmjs.com/package/@zereight/mcp-gitlab)      | MR and commit data from gitlab.cee.redhat.com |
| [Atlassian Rovo MCP](https://www.npmjs.com/package/@anthropic-ai/mcp-atlassian) | Jira ticket data from redhat.atlassian.net    |

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

## Available Skills

| Skill                    | Description                                                 | Agent                   |
| ------------------------ | ----------------------------------------------------------- | ----------------------- |
| `/team-update`           | Weekly team report for leadership (7-day window)            | `weekly-team-update`    |
| `/create-agent`          | Scaffold a new agent with best-practice structure and specs | — (interactive)         |
| `/sprint-retro`          | Sprint retrospective analysis from active Jira sprint       | `sprint-retro`          |
| `/repo-contextification` | Audit repo docs and AI-readiness, scaffold missing files    | `repo-contextification` |

## Linting & Formatting

The repo uses ESLint (flat config) + Prettier at the root. Run from the repo root:

```bash
npm run lint          # ESLint with type-checked rules
npm run lint:fix      # auto-fix
npm run format:check  # Prettier dry-run
npm run format        # Prettier auto-format
```

TypeScript conventions enforced by ESLint:

- Add type assertions to `JSON.parse` calls: `JSON.parse(...) as MyType`
- Use `import.meta.dirname` instead of `dirname(fileURLToPath(import.meta.url))`
- Use `String(e)` when interpolating caught errors in template literals
- Mark top-level async calls with `void` when not awaited
- `@types/node` is in the root devDependencies (shared by all agents)

## Rules

- Never commit tokens or secrets
- All links in reports use markdown hyperlinks with descriptive text
- Only `resolution = "Done"` counts as a completed Jira deliverable
