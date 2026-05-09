# Repo Contextification

Audit a repository for foundational documentation and AI-readiness, then scaffold missing files in one pass.

## Prerequisites

- [GitHub MCP server](https://github.com/github/github-mcp-server) for auditing remote GitHub repos
- `GITHUB_PAT` environment variable for GitHub access
- Tokens must be set as environment variables before launching your IDE.

For local-only audits, no MCP server is needed.

## Usage

### Claude Code

```bash
/repo-contextification
```

### Cursor

In Cursor chat, mention `@repo-contextification` or ask to "contextify this repo" — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# Run the audit script directly (from repo root)
npm run context:audit -- --repo-path /path/to/repo

# Preview what would be generated (no files written)
npm run context:audit:dry-run -- --repo-path /path/to/repo

# Validate generated docs (checks sections, links, anchors, placeholders)
npm run context:validate -- --repo-path /path/to/repo --verbose

# Run unit tests
npm run context:test
```

## How It Works

1. **Identify target** — specify a local path or GitHub `owner/repo`
2. **Audit existing docs** — scan for README.md, CONTRIBUTING.md, AGENTS.md, ARCHITECTURE.md, .coderabbit.yaml, CLAUDE.md, .cursor/rules/*.mdc
3. **Gap analysis** — present a report with completeness scores and AI-readiness rating
4. **PR research** — fetch recent PRs for context on active development, conventions, and review patterns (cached 24h)
5. **Generate docs** — write all missing/incomplete files in one pass (skips complete files)
6. **AI tooling config** — configure CodeRabbit
7. **Validation** — verify all files exist with expected sections, working links and anchors

## Configuration

No configuration file needed. The agent discovers everything from the target repo.

## File Layout

```
agents/repo-contextification/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── lib.ts                # shared types and utilities
│   ├── lib.test.ts           # unit tests (vitest)
│   ├── audit-repo.ts
│   └── validate-output.ts
└── data/
    ├── cache/              # temporary data (gitignored)
    └── output/             # generated reports (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
