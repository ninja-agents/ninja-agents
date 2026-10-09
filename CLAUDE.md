# Ninja Agents

A shared playground for AI agents that help engineering teams. Each agent lives in its own directory under `agents/`.

> **Cursor users:** see `.cursor/rules/` for project rules and `.cursor/mcp.json` for MCP config.

## Quick Reference

- **Stack:** TypeScript (ES2022, `tsx`, no build step), Vitest, ESLint + Prettier
- **Agents:** `agents/{name}/` — self-contained directories (scripts, data, config, README)
- **Agent specs:** `.claude/agents/{name}.md` (shared source of truth for workflows)
- **Skills:** `.claude/skills/{name}/SKILL.md` — invoke via `/skill-name`
- **MCP config:** `.mcp.json` (tokens from env vars, never committed)

## Key Rules

- Never commit tokens or secrets — tokens resolve from `$GITHUB_PAT`, `$GITLAB_PAT` env vars
- GitLab queries MUST include `scope: "all"` or results may be empty
- Jira `cloudId` uses site URL (`redhat.atlassian.net`)
- Only `resolution = "Done"` counts as a completed Jira deliverable
- All report links use markdown hyperlinks with descriptive text
- Add type assertions to `JSON.parse` calls; use `import.meta.dirname`; use `String(e)` for caught errors

## Commands

```bash
npm run lint          # ESLint
npm run format:check  # Prettier dry-run
npm test              # all agent tests
```

## CVE Verification

`/nmstate-cve-verification <jira-key-or-url>` follows the [NMState CVE verification workflow](.claude/agents/nmstate-cve-verification.md): release-associated artifact/source verification without a cluster by default, explicit deployed_source for installed-image checks. Also available as `$nmstate-cve-verification` in Codex and `@nmstate-cve-verification` in Cursor. Publisher product mapping/platform/source evidence is required; no runtime scan or Jira closure claim.

## Full Context

See [AGENTS.md](AGENTS.md) for conventions, patterns, MCP tool usage, and review guidelines. See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and data flow. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.
