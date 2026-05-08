# Architecture

## System Overview

Ninja Agents is a monorepo of self-contained AI agents that automate recurring engineering workflows. The system has no runtime server or deployed application -- agents execute inside an AI-powered IDE (Claude Code or Cursor) and interact with external services through MCP (Model Context Protocol) servers.

```text
+------------------+     +-----------+     +------------------+
|   AI IDE         |     | MCP       |     | External         |
|   (Claude Code   |<--->| Servers   |<--->| Services         |
|    or Cursor)    |     |           |     |                  |
|                  |     | - GitHub  |     | - github.com     |
|  Agent Spec      |     | - GitLab  |     | - gitlab.cee.    |
|  (workflow def)  |     | - Jira    |     |   redhat.com     |
|                  |     |           |     | - redhat.         |
|  TypeScript      |     +-----------+     |   atlassian.net  |
|  Scripts         |                       +------------------+
|  (deterministic) |
+------------------+
```

## Component Structure

### Repository Layout

```text
ninja-agents/
  agents/                         # Self-contained agent directories
    _template/                    # Skeleton for new agents
    weekly-team-update/           # Weekly status report agent
    sprint-retro/                 # Sprint retrospective agent
    repo-contextification/        # Documentation audit agent
  .claude/
    agents/                       # Agent specs — shared source of truth for workflows
    skills/                       # Skill shortcuts (Claude Code entry points)
    settings.json                 # MCP tool permission allowlist
  .cursor/
    rules/                        # Project rules (Cursor — point to agent specs)
    mcp.json                      # MCP server config (Cursor — mirrors .mcp.json)
  docs/
    mcp-setup.md                  # Token setup and troubleshooting guide
  .mcp.json                       # MCP server definitions (Claude Code; mirrored by .cursor/mcp.json)
  CLAUDE.md                       # Claude Code project context
  AGENTS.md                       # Agent index and conventions
```

### Agent Internals

Each agent follows the same internal structure:

```text
agents/{name}/
  README.md                       # Usage docs, prerequisites, file layout
  tsconfig.json                   # Extends root tsconfig for per-agent paths
  scripts/
    generate-*.ts                 # Deterministic report generator
    validate-*.ts                 # Output validation (links, format)
    lib.ts                        # Shared types and utilities
    *.test.ts                     # Vitest test files
  data/
    *-config.json                 # Agent-specific configuration
    cache/                        # Temporary CSV files (gitignored)
    output/                       # Generated reports (gitignored)
```

### IDE Wiring

Agent specs (`.claude/agents/{name}.md`) are the single source of truth for each workflow. Both IDEs point to the same specs:

```text
.claude/agents/{name}.md     <-- full workflow definition (steps, rules, validation)
  ^
  |-- .claude/skills/{name}/SKILL.md   (Claude Code: skill shortcut, invoked via /command)
  |-- .cursor/rules/{name}.mdc         (Cursor: project rule, invoked via @name in chat)
```

## Data Flow Pipeline

Every agent follows the same three-phase pipeline:

### Phase 1: Data Collection (AI Agent)

The AI agent executes MCP tool calls to fetch data from external services. Queries run in parallel batches where possible. Results are written as CSV files to `data/cache/`.

```text
GitHub MCP  ----> github-prs.csv
GitLab MCP  ----> gitlab-mrs.csv
Jira MCP    ----> jira-tickets.csv (or sprint-issues.csv)
```

### Phase 2: Deterministic Processing (TypeScript Script)

A TypeScript script reads the cached CSV files, applies business logic (filtering, grouping, nesting, metric computation), and writes a structured markdown report to `data/output/`. The script handles:

- CSV parsing and deduplication
- Team member matching via config
- PR-to-Jira-ticket nesting (via issue references)
- Section formatting with markdown tables, headers, and links
- Placeholder insertion for agent-written prose sections

### Phase 3: Prose Generation (AI Agent)

The AI agent reads the generated report and writes the prose sections that require synthesis:

- **weekly-team-update**: Key Highlights (3-5 theme bullets from completed work)
- **sprint-retro**: Key Takeaways (3-5 actionable observations from analysis data)
- **repo-contextification**: full documentation files (README, CONTRIBUTING, AGENTS, ARCHITECTURE)

A validation script then checks the final output for broken links, missing sections, or data quality issues.

## Dependencies

### Root Level

| Package                        | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `eslint` + `typescript-eslint` | Linting with type-checked rules (flat config)                |
| `eslint-config-prettier`       | Disables ESLint rules that conflict with Prettier            |
| `prettier`                     | Code formatting (double quotes, trailing commas, semicolons) |
| `typescript`                   | Type checking across all agents via project references       |

All dependencies are managed in the root `package.json`. In addition to the linting/formatting tools, the root includes:

| Package       | Purpose                                   |
| ------------- | ----------------------------------------- |
| `tsx`         | TypeScript execution without a build step |
| `vitest`      | Unit testing                              |
| `@types/node` | Node.js type definitions                  |

No runtime dependencies exist -- agents use only Node.js built-in modules (`fs`, `path`). The `tsx` package provides the TypeScript execution environment.

### MCP Servers

| Server             | Transport | Endpoint                     | Auth                 |
| ------------------ | --------- | ---------------------------- | -------------------- |
| GitHub MCP         | HTTP      | `api.githubcopilot.com/mcp/` | `GITHUB_PAT` env var |
| GitLab MCP         | stdio     | `npx @zereight/mcp-gitlab`   | `GITLAB_PAT` env var |
| Atlassian Rovo MCP | HTTP      | `mcp.atlassian.com/v1/mcp`   | Browser OAuth        |

MCP server definitions live in `.mcp.json` (for Claude Code) and `.cursor/mcp.json` (for Cursor). Token references use `${VAR_NAME}` syntax, resolved from the user's shell environment at launch time.

## Build and Execution

There is no build step or compiled output. TypeScript files execute directly via `tsx`. The root `tsconfig.json` uses project references to validate types across all agents:

```bash
npx tsc --build           # type-check all agents
npm run lint              # ESLint across the repo
npm run format:check      # Prettier check
```

Individual agents run their scripts via `npx tsx`:

```bash
npx tsx agents/weekly-team-update/scripts/generate-weekly-report.ts --date 2026-05-08
npx tsx agents/repo-contextification/scripts/audit-repo.ts --repo-path /path/to/repo
```

Tests run from the repo root using Vitest:

```bash
npm test              # all agents
npm run retro:test    # single agent
```
