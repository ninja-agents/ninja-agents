# Agent Name

One-line description of what this agent does.

## Prerequisites

List the MCP servers or CLI tools this agent needs:

- **GitHub MCP** — for PR and commit data
- (add or remove as needed)

Tokens must be configured in `.env` at the repo root.

## Usage

### Claude Code

```bash
/your-skill-name
```

### Cursor / Manual

Describe how to use this agent from Cursor (e.g., run scripts directly, use MCP tools manually).

## How It Works

1. Step one
2. Step two
3. Step three

## Configuration

Describe any config files in `data/` that need to be customized, or "No configuration needed."

## File Layout

```
agents/your-agent/
├── README.md           # This file
├── scripts/            # Supporting scripts
│   └── your-script.py
└── data/
    ├── config.json     # Agent configuration
    ├── cache/          # Temporary data (gitignored)
    └── output/         # Generated output (gitignored)
```

## Wiring Up

After creating your agent directory, wire it into the IDE tooling:

1. **Agent spec** — create `.claude/agents/your-agent.md` with:
   - Frontmatter: `name`, `description` (with trigger phrases + examples), `model`, `memory`
   - Body: role statement, numbered `## Step N` sections, `## Rules` section
   - See `.claude/agents/weekly-team-update.md` for a working example

2. **Skill shortcut** — create `.claude/skills/your-skill.md` with:
   - Frontmatter: `skill`, `description`, `user-invocable: true`
   - Body: usage, what it does, expected output

3. **Permissions** — add any MCP tools or bash commands to `.claude/settings.json`

4. **Index files** — add a row to the agent tables in:
   - `AGENTS.md`
   - `README.md`
   - `CLAUDE.md` (Available Skills table)

Or just run `/create-agent your-agent-name` to do all of this automatically.
