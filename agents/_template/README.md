# Agent Name

One-line description of what this agent does.

## Prerequisites

List only the direct API sources and GitHub MCP tools this agent actually uses:

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **GitHub MCP** — the sole project MCP server; include only when this agent uses GitHub tools.
- **Jira REST** — root commands require environment-only `JIRA_EMAIL` and `JIRA_API_TOKEN` for reads and approved writes. `--site` comes from private config's `jira.cloud_id` DNS hostname (Slack filing uses `jira_filing.cloud_id`), not a URL or cloud UUID.
- **Existing per-agent Jira writer** (if applicable) — retain its `JIRA_API_TOKEN` plus private `jira.user_email` authentication; do not replace it with a new writer.
- **GitLab REST** (if used) — reuse existing direct collectors; the root `gitlab-read.ts` exposes optional QE context only, with HTTPS `/api/v4` base from `gitlab.api_url` or `GITLAB_API_URL` and optional environment-only `GITLAB_PAT` for public reads.

Remove unused prerequisite bullets. Set credentials before launching your IDE, never in command arguments or tracked config/cache/output, and never print secret values. No Jira/GitLab MCP server, browser OAuth, or stdio server is required. See the [setup guide](../../docs/mcp-setup.md).

Reuse existing direct collectors when available. Otherwise, supported root commands include:

```bash
node --import tsx scripts/jira-rest.ts --site your-site.atlassian.net search --jql 'project = PROJ' --fields summary
# Alternative: npm run jira:rest -- --site your-site.atlassian.net search --jql 'project = PROJ' --fields summary
node --import tsx scripts/gitlab-read.ts qe-context --project owner/repo --issue-key PROJ-123
```

Root command pagination is internal; keep each agent's existing private cache format. Required Jira read failures STOP before output or approval, without partial results. Optional GitLab exit 3 returns `{context:null,warnings:[safeCode]}`: note the warning and proceed without enrichment. Use only supported writes after the workflow's existing explicit approval; the CLI's `--approved` guard never substitutes for user approval.

## Usage

### Claude Code

```bash
/your-skill-name
```

### Cursor / Manual

Describe how to use this agent from Cursor (e.g., run scripts directly or use the configured GitHub MCP tools).

For TypeScript agents, scripts can be run directly:

```bash
npm run your-agent:generate -- --date 2026-01-01
```

## How It Works

1. Step one
2. Step two
3. Step three

## Configuration

Edit `data/config.json` to customize the agent's behavior.

Or, if no configuration: "No configuration needed."

## File Layout

```
agents/your-agent/
├── README.md           # This file
├── scripts/            # Supporting scripts
│   ├── your-script.ts
│   └── validate-output.ts  # Output validation
└── data/
    ├── config.json     # Agent configuration
    ├── cache/          # Temporary data (gitignored)
    └── output/         # Generated output (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).

## Wiring Up

After creating your agent directory, wire it into both IDEs:

### Shared (required for both IDEs)

1. **Agent spec** — create `.claude/agents/your-agent.md` with:
   - Frontmatter: `name`, `description` (with trigger phrases + examples), `model`, `memory`
   - Body: role statement, numbered `## Step N` sections, validation checkpoints, `## Rules` section
   - See `.claude/agents/weekly-team-update.md` for a working example

2. **Index files** — add a row to the agent tables in:
   - `AGENTS.md`
   - `README.md`
   - `CLAUDE.md` (Available Skills table)

### Claude Code

3. **Skill shortcut** — create `.claude/skills/your-skill/SKILL.md` with:
   - Frontmatter: `name`, `description`, `user-invocable: true`
   - Body: usage, what it does, expected output, critical rules

4. **Permissions** — add only the narrowly scoped GitHub MCP tools or script commands required by the agent to `.claude/settings.json`; never add Jira/GitLab MCP entries or blanket permissions.

### Cursor

5. **Cursor rule** — create `.cursor/rules/your-agent.mdc` with:
   - Frontmatter: `description` (purpose + trigger phrases), `alwaysApply: false`
   - Body: point to `.claude/agents/your-agent.md` as the source of truth
   - See existing `.cursor/rules/weekly-team-update.mdc` for the pattern

In Claude Code, run `/create-agent your-agent-name` to scaffold all of this automatically. In Cursor, copy `agents/_template/` and follow the steps above.
