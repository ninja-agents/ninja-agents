# Agent Name

One-line description of what this agent does.

## Prerequisites

List the MCP servers or CLI tools this agent needs:

- **GitHub MCP** — for PR and commit data
- (add or remove as needed)

Tokens must be set as environment variables before launching Claude Code — see [MCP setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/your-skill-name
```

### Cursor / Manual

Describe how to use this agent from Cursor (e.g., run scripts directly, use MCP tools manually).

For TypeScript agents, scripts can be run directly:

```bash
cd agents/your-agent
npm install
npm run generate -- --date 2026-01-01
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
├── package.json        # Dependencies and scripts (TypeScript agents)
├── tsconfig.json       # TypeScript config
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

After creating your agent directory, wire it into the IDE tooling:

1. **Agent spec** — create `.claude/agents/your-agent.md` with:
   - Frontmatter: `name`, `description` (with trigger phrases + examples), `model`, `memory`
   - Body: role statement, numbered `## Step N` sections, validation checkpoints, `## Rules` section
   - See `.claude/agents/weekly-team-update.md` for a working example

2. **Skill shortcut** — create `.claude/skills/your-skill/SKILL.md` with:
   - Frontmatter: `name`, `description`, `user-invocable: true`
   - Body: usage, what it does, expected output, critical rules

3. **Permissions** — add any MCP tools or bash commands to `.claude/settings.json`

4. **Index files** — add a row to the agent tables in:
   - `AGENTS.md`
   - `README.md`
   - `CLAUDE.md` (Available Skills table)

Or just run `/create-agent your-agent-name` to do all of this automatically.
