---
name: create-agent
description: Scaffold a new Ninja Agents workflow for Claude Code, Cursor, and Codex.
---

# Create an agent

Read the [Claude scaffolding workflow](../../../.claude/skills/create-agent/SKILL.md) as the source for the agent directory, scripts, configuration, Claude agent spec and skill, Cursor rule, validation, and index updates. Carry the user's requested agent name and requirements through that workflow.

For Codex, also create `.agents/skills/{skill-name}/SKILL.md` with valid `name` and `description` frontmatter. Its body must load and follow the detailed `.claude/agents/{name}.md` workflow. Add a relative `references/agent-workflow.md` symlink to that spec, following the existing skills in this repository.

Do not create `.Codex/` files or a second agent spec. Update README, CONTRIBUTING, AGENTS, and the MCP setup guide as needed to show all three clients. Use `.codex/config.toml` for project MCP configuration; keep credentials in environment variables. Verify the new skill is discoverable, its workflow link resolves, and the generated scripts and repository checks pass.
