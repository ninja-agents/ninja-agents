# Ninja Agents

<p align="center">
  <img src="logo.png" alt="Ninja Agents logo" width="200">
</p>

A shared playground for AI agents that help engineering teams ship status reports, run sprint retrospectives, and audit repository documentation. Each agent is a self-contained directory under `agents/` with its own scripts, config, and data. Agents run inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Cursor](https://cursor.com) via MCP servers that connect to GitHub, GitLab, and Jira.

## Overview

The repo follows a "data collector + deterministic script" pattern: the AI agent fetches data from external services (GitHub, GitLab, Jira) via MCP tool calls and saves it as CSV, then a TypeScript script generates the structured output. The agent writes only the prose sections (e.g., Key Highlights, Key Takeaways) that require synthesis. Each agent is self-contained — no cross-agent imports, shared team config accessed via config path — and all dependencies are managed in the root `package.json`. TypeScript files execute directly via `tsx` with no build step.

## Quick Start

```bash
git clone <repo-url> && cd ninja-agents
npm install           # all dependencies (linting, TypeScript, testing)

# Set tokens as env vars (add to ~/.bashrc or ~/.zshrc to persist)
export GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
export GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx

# Launch your IDE and invoke an agent
claude                # Claude Code
# then type: /team-update

# Or open the project in Cursor
# then ask: @weekly-team-update or "generate a weekly team report"
```

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full token setup guide and troubleshooting.

## Available Agents

| Agent                                                  | Claude Code              | Cursor                   | Description                                                     |
| ------------------------------------------------------ | ------------------------ | ------------------------ | --------------------------------------------------------------- |
| [weekly-team-update](agents/weekly-team-update/)       | `/team-update`           | `@weekly-team-update`    | Weekly team report for leadership from GitHub, GitLab, and Jira |
| [sprint-review](agents/sprint-review/)                   | `/sprint-review`          | `@sprint-review`          | Sprint retrospective analysis from active Jira sprint           |
| [repo-contextification](agents/repo-contextification/) | `/repo-contextification` | `@repo-contextification` | Audit repo docs and AI-readiness, scaffold missing files        |
| _(scaffold a new agent)_                               | `/create-agent`          | copy `agents/_template/` | Scaffold a new agent with best-practice structure and specs     |

Each agent has its own README with setup and usage instructions.

## Prerequisites

You need an AI-powered IDE plus MCP servers for the agents you want to use:

| Data Source | MCP Server                                                                      | CLI Alternative |
| ----------- | ------------------------------------------------------------------------------- | --------------- |
| **Jira**    | [Atlassian Rovo MCP](https://www.npmjs.com/package/@anthropic-ai/mcp-atlassian) | N/A             |
| **GitHub**  | [GitHub MCP](https://github.com/github/github-mcp-server)                       | `gh` CLI        |
| **GitLab**  | [@zereight/mcp-gitlab](https://www.npmjs.com/package/@zereight/mcp-gitlab)      | `glab` CLI      |

### Token Setup

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full step-by-step guide. The short version:

```bash
export GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
export GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx
claude   # Claude Code — or open the project in Cursor
```

## Contributing a New Agent

Each agent is a self-contained directory under `agents/`:

```
agents/your-agent/
├── README.md        # What it does, how to use it, prerequisites
├── scripts/         # Supporting scripts (Python, shell, etc.)
└── data/            # Config, cache, output
```

To add a new agent:

1. Run `/create-agent` in Claude Code, or copy `agents/_template/` manually
2. Add your scripts, config, and a README
3. Wire it into both IDEs:
   - Create `.claude/agents/your-agent.md` (agent spec — shared source of truth)
   - Create `.claude/skills/your-skill/SKILL.md` (Claude Code skill shortcut)
   - Create `.cursor/rules/your-agent.mdc` (Cursor rule — points to the agent spec)
4. Update the agent table in this README and in `AGENTS.md`

See [agents/\_template/README.md](agents/_template/README.md) for the full guide.

## Project Structure

```
ninja-agents/
├── AGENTS.md                          # Agent index and conventions
├── CLAUDE.md                          # Claude Code project context
├── README.md                          # This file
├── .mcp.json                          # MCP server definitions (Claude Code)
├── .claude/
│   ├── agents/                        # Agent specs (shared source of truth)
│   ├── skills/                        # Skill shortcuts (Claude Code)
│   └── settings.json                  # Permission allowlist (Claude Code)
├── .cursor/
│   ├── mcp.json                       # MCP server config (Cursor)
│   └── rules/                         # Project rules (Cursor)
└── agents/                            # Self-contained agent directories
    ├── _template/                     # Skeleton for new agents
    ├── weekly-team-update/            # Weekly team report agent
    ├── sprint-review/                  # Sprint retrospective agent
    └── repo-contextification/         # Documentation audit agent
```
