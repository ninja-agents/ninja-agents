---
name: repo-contextification
description: Audit a repository for foundational docs (README, CONTRIBUTING, AGENTS, ARCHITECTURE) and AI tooling config, then scaffold missing files in one pass
---

# repo-contextification

Read [the complete workflow](references/agent-workflow.md) and follow its steps from the repository root. Pass any user-supplied arguments into the workflow.

Use equivalent Codex tools for shell, file, and MCP operations. Follow [AGENTS.md](../../../AGENTS.md) for repository rules. For Jira writes, show the prescribed preview and wait for explicit approval; use the repository's REST API scripts rather than Jira MCP edit tools. If a required external tool or credential is unavailable, stop at that step and report the missing prerequisite.
