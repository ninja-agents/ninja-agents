# Ninja Agents

<p align="center">
  <img src="logo.png" alt="Ninja Agents logo" width="200">
</p>

A shared playground for AI agents that help engineering teams ship status reports, run sprint retrospectives, and audit repository documentation. Each agent is a self-contained directory under `agents/` with its own scripts, config, and data. Agents run inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Cursor](https://cursor.com) via MCP servers that connect to GitHub, GitLab, and Jira.

## Quick Start

```bash
git clone <repo-url> && cd ninja-agents
npm install           # all dependencies (linting, TypeScript, testing)

# Set tokens as env vars (add to ~/.bashrc or ~/.zshrc to persist)
export GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
export GITLAB_PAT=glpat-xxxxxxxxxxxxxxxxxxxx

# Launch Claude Code and invoke an agent
claude
# then type: /team-update
```

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full token setup guide and troubleshooting.

## Available Agents

| Agent                                                  | Skill                    | Description                                                     |
| ------------------------------------------------------ | ------------------------ | --------------------------------------------------------------- |
| [weekly-team-update](agents/weekly-team-update/)       | `/team-update`           | Weekly team report for leadership from GitHub, GitLab, and Jira |
| [sprint-retro](agents/sprint-retro/)                   | `/sprint-retro`          | Sprint retrospective analysis from active Jira sprint           |
| [repo-contextification](agents/repo-contextification/) | `/repo-contextification` | Audit repo docs and AI-readiness, scaffold missing files        |

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
claude   # launch Claude Code with tokens in your environment
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

1. Copy `agents/_template/` to `agents/your-agent/`
2. Add your scripts, config, and a README
3. Wire it up for Claude Code:
   - Create `.claude/agents/your-agent.md` (agent spec)
   - Create `.claude/skills/your-skill.md` (skill shortcut)
4. Update the agent table in this README and in `AGENTS.md`

See [agents/\_template/README.md](agents/_template/README.md) for the full guide.

## Project Structure

```
ninja-agents/
├── AGENTS.md                          # Agent index (org-required)
├── CLAUDE.md                          # Claude Code project context
├── README.md                          # This file
├── .mcp.json                          # MCP server definitions (uses env vars)
├── .claude/
│   ├── agents/                        # Claude Code agent specs
│   ├── skills/                        # Claude Code skill shortcuts
│   └── settings.json                  # Permission allowlist
├── .cursor/
│   └── rules/                         # Cursor project rules
└── agents/                            # Self-contained agent directories
    ├── _template/                     # Skeleton for new agents
    └── weekly-team-update/            # Weekly team report agent
        ├── README.md
        ├── scripts/
        └── data/
```
