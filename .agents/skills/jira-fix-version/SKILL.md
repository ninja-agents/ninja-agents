---
name: jira-fix-version
description: Set fixVersions on resolved Jira tickets by tracing merged PR branches. Fetches tickets, checks GitHub PRs, maps (repo, branch) → fix version, previews, applies after confirmation.
---

# jira-fix-version

Read [the complete workflow](references/agent-workflow.md) and follow its steps from the repository root. Pass any user-supplied arguments into the workflow.

Use equivalent Codex tools for shell, file, and MCP operations. Follow [AGENTS.md](../../../AGENTS.md) for repository rules. For Jira writes, show the prescribed preview and wait for explicit approval; use the repository's REST API scripts rather than Jira MCP edit tools. If a required external tool or credential is unavailable, stop at that step and report the missing prerequisite.
