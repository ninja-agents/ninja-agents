# Architecture

## System Overview

Ninja Agents is a monorepo of self-contained AI agents that automate recurring engineering workflows. There is no runtime server or deployed application: agents execute inside Claude Code, Cursor, or Codex. GitHub is the sole project MCP server; Jira and GitLab use direct APIs.

```text
AI client + canonical workflow spec
  |-- GitHub MCP ----------------------> GitHub
  |-- agent-owned direct collectors ---> configured APIs
  |-- standalone root API commands ----> Jira / optional QE GitLab
  |       `-- model adapts JSON --------> existing CSV/JSON caches
  `-- deterministic agent scripts -----> reports / previews / evidence
```

## Component Structure

### Repository Layout

```text
ninja-agents/
  agents/                         # Self-contained agent directories
    _template/                    # Skeleton for new agents
    weekly-team-update/           # Weekly status report agent
    sprint-review/                 # Sprint retrospective agent
    repo-contextification/        # Documentation audit agent
  scripts/                        # Standalone jira-rest and gitlab-read commands and tests
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

Agent specs (`.claude/agents/{name}.md`) are the single source of truth for each workflow. All three clients point to the same specs; Codex's relative workflow references retain that canonical source:

```text
.claude/agents/{name}.md     <-- full workflow definition (steps, rules, validation)
  ^
  |-- .claude/skills/{name}/SKILL.md   (Claude Code: skill shortcut, invoked via /command)
  |-- .cursor/rules/{name}.mdc         (Cursor: project rule, invoked via @name in chat)
  |-- .agents/skills/{name}/SKILL.md   (Codex: skill with canonical workflow reference)
```

## Data Flow Pipeline

Reporting agents generally follow a three-phase pipeline; mutation workflows retain their previews and user approval gates, and artifact verification retains its separate evidence contract.

### Phase 1: Data Collection

Existing weekly, sprint-review, sprint-planning, story-point, and CVE collectors access APIs directly. Migrated workflows invoke root `scripts/jira-rest.ts` and optional QE `scripts/gitlab-read.ts`, then the model adapts returned JSON to each workflow's existing CSV/JSON cache schema. GitHub MCP is retained for workflow reads. Root commands are standalone executables, not imports shared between agents.

```text
Agent-owned API collectors ------------------> existing caches / evidence
Root Jira REST command --> model adaptation --> jira-tickets.csv / tickets-data.json
Root GitLab QE context -----------------------> optional repo-context.md enrichment
GitHub MCP -----------------------------------> workflow PR references / diffs
```

Root commands handle pagination internally; explicit Jira search limits are bounded lookups only. Jira ADF descriptions/comments become strings at the API boundary, while other native fields are preserved. Required Jira failures stop collection before classification or approval; optional GitLab failure emits exit 3 with null context and a safe warning so QE can proceed without enrichment. Existing cache quoting and mapping contracts remain unchanged.

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
- **sprint-review**: Key Takeaways (3-5 actionable observations from analysis data)
- **repo-contextification**: full documentation files (README, CONTRIBUTING, AGENTS, ARCHITECTURE)

A validation script then checks the final output for broken links, missing sections, or data quality issues.

### Read-only artifact verification

`cve-verification-console-plugins` performs an ART-only evidence workflow for configured `nmstate-console-plugin` and `networking-console-plugin` profiles using refreshed Jira technical identity, a requested numeric OCP minor, and explicit or previously approved platform. The `components` configuration registry gives each profile its own Jira/minor/platform mappings, lifecycle policy, ART name and private rebase identity, approved public repositories, and lockfile path. Without an explicit selection, exactly one profile must match current Jira for the requested minor; ambiguous matches require a choice and no match blocks assessment. Explicit selections remain subject to refreshed Jira validation. Source assessment runs first, selects the matching successful ART build for that profile, and assesses its approved public source commit, SHA-pinned lockfile, and advisory. Source assessment supports mapped GA and pre-GA numeric minors without lifecycle admission and needs no cluster or kubeconfig. A separately requested image assessment is limited to the selected profile's configured pre-GA ART streams; it inspects immutable image metadata and source labels using `skopeo` and borrowed Quay Basic authentication. It does not inspect image layers; neither assessment establishes bundled/runtime dependency contents or shipped-release remediation. Producers write private sealed reports with the validated registry snapshot, and consumers independently replay-validate each target against its stored profile before producing a summary. Jira access is read-only; no Jira mutation occurs.

ART source prerequisites are Jira read access, ART/public source and advisory access, and private storage. Optional image assessment additionally requires `skopeo` and a borrowed Quay Basic-auth file. See the [agent's scope and evidence contract](agents/cve-verification-console-plugins/README.md).

## Dependencies

### Root Level

| Package                        | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `eslint` + `typescript-eslint` | Linting with type-checked rules (flat config)                |
| `eslint-config-prettier`       | Disables ESLint rules that conflict with Prettier            |
| `prettier`                     | Code formatting (double quotes, trailing commas, semicolons) |
| `typescript`                   | Type checking across all agents via root include glob        |

All dependencies are managed in the root `package.json`. In addition to the linting/formatting tools, the root includes:

| Package       | Purpose                                   |
| ------------- | ----------------------------------------- |
| `tsx`         | TypeScript execution without a build step |
| `vitest`      | Unit testing                              |
| `@types/node` | Node.js type definitions                  |

Runtime dependencies are managed at the root alongside tooling: `@slack/web-api` supports Slack collection and `semver` provides npm version/range semantics for CVE verification. Other scripts use Node.js built-in modules where sufficient. The `tsx` package provides the TypeScript execution environment.

### Service Access

| Service            | Transport                                    | Credentials                                                 |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| GitHub MCP         | HTTP, `https://api.githubcopilot.com/mcp/`   | `GITHUB_PAT`                                                |
| Jira               | Direct HTTPS REST                            | `JIRA_EMAIL` and `JIRA_API_TOKEN` for reads and writes      |
| Optional QE GitLab | Direct HTTPS REST, configured `/api/v4` base | `gitlab.api_url` or `GITLAB_API_URL`; optional `GITLAB_PAT` |

All four project manifests (`.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, `plugin-mcp.json`) define GitHub only. Root Jira commands take a DNS hostname from existing `jira.cloud_id` (Slack: `jira_filing.cloud_id`), never a cloud UUID. Existing per-agent apply/QE writers additionally use private `jira.user_email` with the token. Root commands take credentials only from environment variables and deny redirects.

Writes retain existing user preview/selection approval. Root allowlisted write commands additionally require `--approved`; each invocation performs one mutation, without arbitrary endpoint access. Existing agent-owned writers and bulk-move/poll operations remain in place. See [setup and usage](docs/mcp-setup.md) for configuration, private payload requirements, and safe credential checks.

## Build and Execution

There is no build step or compiled output. TypeScript executes directly through `tsx` with Node.js 22+ and installed root dependencies. The root `tsconfig.json` type-checks `agents/*/scripts/**/*.ts` and standalone root `scripts/**/*.ts` in one program, without build references or generated declaration prerequisites.

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json # type-check all scripts and tests
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
npm run sprint-review:test    # single agent
```
