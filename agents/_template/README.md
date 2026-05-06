# Agent Name

One-line description of what this agent does.

## Prerequisites

List the MCP servers or CLI tools this agent needs:

- **GitHub MCP** — for PR data
- (add or remove as needed)

## Usage

### Claude Code

```bash
/your-skill-name
```

### Cursor

Describe how to use this agent from Cursor (e.g., run scripts directly, use MCP tools manually).

## How It Works

Brief description of the agent's workflow.

## Configuration

Describe any config files in `data/` that need to be customized.

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

## Wiring Up for Claude Code

1. Create `.claude/agents/your-agent.md` with the agent spec (model, description, workflow steps)
2. Create `.claude/skills/your-skill.md` with the skill shortcut
3. Add any needed MCP tool permissions to `.claude/settings.json`
4. Update the agent table in `README.md` and `AGENTS.md`
