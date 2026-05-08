# Agents

## Project Overview

Ninja Agents is a shared playground for AI agents that help engineering teams with recurring workflows -- weekly status reports, sprint retrospectives, and repository documentation audits. Each agent is a self-contained directory under `agents/` with its own scripts, configuration, and data. Agents run inside Claude Code or Cursor, using MCP servers to query GitHub, GitLab, and Jira.

The repo follows a "data collector + deterministic script" pattern: the AI agent fetches data via MCP tools and saves it as CSV, then a TypeScript script generates the structured output. The agent writes only the prose sections (e.g., Key Highlights, Key Takeaways) that require synthesis.

## Available Agents

| Agent                                                  | Description                                                                     | Docs                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| [weekly-team-update](agents/weekly-team-update/)       | Generates a leadership-ready weekly status report from GitHub, GitLab, and Jira | [README](agents/weekly-team-update/README.md)    |
| [sprint-retro](agents/sprint-retro/)                   | Sprint retrospective analysis from active Jira sprint                           | [README](agents/sprint-retro/README.md)          |
| [repo-contextification](agents/repo-contextification/) | Audit repo docs and AI-readiness, interactively scaffold missing files          | [README](agents/repo-contextification/README.md) |

## IDE Support

This repo works with multiple AI-powered IDEs:

- **Claude Code** -- agent specs in [`.claude/agents/`](.claude/agents/), skills in [`.claude/skills/`](.claude/skills/), project context in [`CLAUDE.md`](CLAUDE.md)
- **Cursor** -- project rules in [`.cursor/rules/`](.cursor/rules/)

## Conventions and Patterns

### Agent Directory Structure

Every agent follows the layout defined in [agents/\_template/](agents/_template/):

```text
agents/{name}/
  README.md           # prerequisites, usage, how it works
  tsconfig.json       # extends root tsconfig
  scripts/            # TypeScript scripts for deterministic output
  data/
    config.json       # agent-specific configuration
    cache/            # temporary CSV data (gitignored)
    output/           # generated reports (gitignored)
```

### Data Flow Pattern

1. Agent spec (`.claude/agents/{name}.md`) defines the step-by-step workflow
2. The AI agent fetches data from MCP servers (GitHub, GitLab, Jira) and writes CSV files to `data/cache/`
3. A TypeScript script reads the CSV cache and generates the structured report in `data/output/`
4. The AI agent writes prose sections that require synthesis (highlights, takeaways)
5. A validation script checks the output for correctness (links, format, data quality)

### Naming Conventions

- Agent directories: lowercase with hyphens (`weekly-team-update`, `sprint-retro`)
- Agent specs: `.claude/agents/{agent-name}.md`
- Skill shortcuts: `.claude/skills/{skill-name}/SKILL.md`
- Cursor rules: `.cursor/rules/{agent-name}.mdc`
- Config files: `data/{descriptive-name}.json` (e.g., `team-config.json`, `sprint-config.json`)
- Cache files: `data/cache/{source}-{type}.csv` (e.g., `github-prs.csv`, `jira-tickets.csv`)

### MCP Tool Requirements

- GitLab queries MUST include `scope: "all"` -- without it, results may be empty
- Jira `cloudId` uses the site URL (`redhat.atlassian.net`), not a UUID
- Only `resolution = "Done"` counts as a completed Jira deliverable
- CSV fields containing commas must be wrapped in double quotes

### TypeScript Conventions

- Target ES2022, `NodeNext` module resolution
- Use `import.meta.dirname` instead of `dirname(fileURLToPath(import.meta.url))`
- Add type assertions to `JSON.parse` calls
- Use `String(e)` for caught errors in template literals
- All agent dependencies are managed in the root `package.json`

## Review Guidelines

When reviewing changes to this repo, check for:

- **Agent isolation** -- each agent is self-contained; no cross-agent imports (shared team config is the exception, accessed via a config path)
- **Deterministic output** -- scripts produce the same output for the same input; non-deterministic prose is clearly separated (Key Highlights, Key Takeaways)
- **No hardcoded data** -- team members, project keys, and board IDs come from config files, not source code
- **No committed secrets** -- tokens resolve from environment variables via `${VAR_NAME}` in `.mcp.json`
- **CSV quoting** -- fields with commas are double-quoted; internal quotes are escaped by doubling
- **Link hygiene** -- all report links use markdown hyperlinks with descriptive text, not bare URLs
- **Lint/format compliance** -- `npm run lint` and `npm run format:check` pass at the repo root

## Contributing a New Agent

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow, or run `/create-agent` in Claude Code to scaffold everything automatically.
