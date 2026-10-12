# Ninja Agents

![Ninja Agents logo](logo.png)

A shared playground for AI agents that help engineering teams ship status reports, run sprint retrospectives, and audit repository documentation. Each agent is a self-contained directory under `agents/` with its own scripts, config, and data. Agents run inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.com), or [Codex](https://learn.chatgpt.com/docs/codex/cli) via MCP servers that connect to GitHub, GitLab, and Jira.

> **Note:** These agents are opinionated — they encode our team's specific workflows, naming conventions, and tooling choices. They work well for us but may need adaptation for your team.

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

# Or launch Codex with a model of your choice
codex -m gpt-6-luna
# then select $team-update with the $ skill picker
```

After reviewing the weekly report, use `/team-update-publish` in Claude Code, `$team-update-publish` in Codex, or ask Cursor to publish the approved summary. The skill previews the single-file change before asking permission to push it to the configured fork and open a PR.

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full token setup guide and troubleshooting.

## Available Agents

| Agent                                                                        | Claude Code                         | Cursor                              | Description                                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [weekly-team-update](agents/weekly-team-update/)                             | `/team-update`                      | `@weekly-team-update`               | Weekly team report for leadership from GitHub, GitLab, and Jira                                                |
| [sprint-review](agents/sprint-review/)                                       | `/sprint-review`                    | `@sprint-review`                    | Sprint retrospective analysis from active Jira sprint                                                          |
| [sprint-planning-analysis](agents/sprint-planning-analysis/)                 | `/sprint-planning-analysis`         | `@sprint-planning-analysis`         | Sprint planning health-check against velocity baseline                                                         |
| [repo-contextification](agents/repo-contextification/)                       | `/repo-contextification`            | `@repo-contextification`            | Audit repo docs and AI-readiness, scaffold missing files                                                       |
| [jira-qe-story](agents/jira-qe-story/)                                       | `/jira-qe-story`                    | `@jira-qe-story`                    | Generate QE story from dev Jira story, create in Jira with link                                                |
| [jira-sprint-tickets-updater](agents/jira-sprint-tickets-updater/)           | `/jira-sprint-tickets-updater`      | `@jira-sprint-tickets-updater`      | Transition sprint tickets based on linked GitHub PR status                                                     |
| [slack-channels-analyzer](agents/slack-channels-analyzer/)                   | `/slack-channels-analyzer`          | `@slack-channels-analyzer`          | Analyze Slack channels for UI-related topics and trends                                                        |
| [jira-add-missing-activity-type](agents/jira-add-missing-activity-type/)     | `/jira-add-missing-activity-type`   | `@jira-add-missing-activity-type`   | Add missing Activity Type to completed Jira tickets                                                            |
| [jira-story-points](agents/jira-story-points/)                               | `/jira-story-points`                | `@jira-story-points`                | Estimate story points using historical team data                                                               |
| [jira-bugs-missing-qe](agents/jira-bugs-missing-qe/)                         | `/jira-bugs-missing-qe`             | `@jira-bugs-missing-qe`             | Find resolved bugs missing QA Contact, identify and set verifier                                               |
| [jira-move-cnv2networking](agents/jira-move-cnv2networking/)                 | `/jira-move-cnv2networking`         | `@jira-move-cnv2networking`         | Move CNV networking tickets to OCPBUGS or the RFE project                                                      |
| [jira-fix-version](agents/jira-fix-version/)                                 | `/jira-fix-version`                 | `@jira-fix-version`                 | Set fixVersions on resolved tickets by tracing merged PR branches                                              |
| [cve-verification-console-plugins](agents/cve-verification-console-plugins/) | `/cve-verification-console-plugins` | `@cve-verification-console-plugins` | NMState/networking plugin ART public-source assessment; optional pre-GA image metadata/source-label assessment |
| _(scaffold a new agent)_                                                     | `/create-agent`                     | copy `agents/_template/`            | Scaffold a new agent with best-practice structure and specs                                                    |

Each agent has its own README with setup and usage instructions.

Codex skills use the same names as the Claude commands in the table. Select a skill with `$` or `/skills`; for example, choose `$team-update` for the weekly report. Where a detailed workflow exists in `.claude/agents/`, the Codex skill links to it so both clients follow the same steps.

For CVE checks, invoke `/cve-verification-console-plugins <jira-key-or-url>` (Claude Code), `$cve-verification-console-plugins` (Codex), or `@cve-verification-console-plugins` (Cursor). The configured profiles are `nmstate-console-plugin` and `networking-console-plugin`. Without an explicit selection, the workflow selects a profile only when exactly one matches the current Jira component for the requested numeric OCP minor; ambiguous matches require a choice, and no match blocks assessment. An explicit selection is also checked against refreshed Jira. Using an explicit or previously approved platform, the workflow runs the selected profile's ART public-source assessment first. Source assessment works on mapped GA or pre-GA numeric minors without lifecycle admission. It requires Jira read access, ART/public source and advisory access, and private storage; it does not require a cluster or kubeconfig. A separately requested image assessment is available only for the selected profile's configured pre-GA ART streams and additionally requires `skopeo` plus a borrowed Quay Basic-auth file. Reports are scoped to the evidence actually inspected: image metadata and source labels do not establish bundled/runtime dependency contents or shipped-release remediation. Only complete, applicable, unaffected source evidence can support a scoped human resolution recommendation. The workflow is read-only with respect to Jira. See the [agent README](agents/cve-verification-console-plugins/README.md) for the supported `cve-verification-console-plugins:{art,read-jira,validate,summary,test}` npm commands.

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
# For Codex: codex -m gpt-6-luna
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

1. Run `/create-agent` in Claude Code, `$create-agent` in Codex, or copy `agents/_template/` manually
2. Add your scripts, config, and a README
3. Wire it into all three clients:
   - Create `.claude/agents/your-agent.md` (agent spec — shared source of truth)
   - Create `.claude/skills/your-skill/SKILL.md` (Claude Code skill shortcut)
   - Create `.agents/skills/your-skill/SKILL.md` with a reference link to the agent spec (Codex skill)
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
├── .codex/config.toml                 # MCP server definitions (Codex)
├── .agents/skills/                   # Codex skills linked to the agent specs
├── .claude/
│   ├── agents/                        # Agent specs (shared source of truth)
│   ├── skills/                        # Skill shortcuts (Claude Code)
│   └── settings.json                  # Permission allowlist (Claude Code)
├── .cursor/
│   ├── mcp.json                       # MCP server config (Cursor)
│   └── rules/                         # Project rules (Cursor)
└── agents/                            # Self-contained agent directories
    ├── _template/                     # Skeleton for new agents
    ├── weekly-team-update/
    ├── sprint-review/
    ├── sprint-planning-analysis/
    ├── repo-contextification/
    ├── slack-channels-analyzer/
    ├── jira-qe-story/
    ├── jira-sprint-tickets-updater/
    ├── jira-story-points/
    ├── jira-bugs-missing-qe/
    ├── jira-add-missing-activity-type/
    ├── jira-move-cnv2networking/
    ├── jira-fix-version/
    └── cve-verification-console-plugins/
```
