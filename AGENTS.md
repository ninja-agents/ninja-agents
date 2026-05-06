# Agents

This repository is a shared playground for AI agents that help engineering teams. Team members can contribute agents, try out ideas, and share useful automation.

## Available Agents

| Agent | Description | Docs |
|-------|-------------|------|
| [weekly-team-update](agents/weekly-team-update/) | Generates a leadership-ready weekly status report from GitHub, GitLab, and Jira | [README](agents/weekly-team-update/README.md) |

## IDE Support

This repo works with multiple AI-powered IDEs:

- **Claude Code** — agent specs in [`.claude/agents/`](.claude/agents/), skills in [`.claude/skills/`](.claude/skills/), project context in [`CLAUDE.md`](CLAUDE.md)
- **Cursor** — project rules in [`.cursor/rules/`](.cursor/rules/)

## Contributing a New Agent

See [`agents/_template/`](agents/_template/) for the expected structure and conventions.
