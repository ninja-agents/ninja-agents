# Ninja Agents

AI agents for engineering teams, powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Prerequisites

You need **Claude Code** installed plus the following MCP servers (or CLI equivalents):

| Data Source | MCP Server | CLI Alternative |
|-------------|-----------|-----------------|
| **Jira** | [Atlassian Rovo MCP](https://www.npmjs.com/package/@anthropic-ai/mcp-atlassian) | N/A |
| **GitHub** | [GitHub MCP](https://github.com/github/github-mcp-server) | `gh` CLI |
| **GitLab** | [@zereight/mcp-gitlab](https://www.npmjs.com/package/@zereight/mcp-gitlab) | `glab` CLI |

### Token Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your tokens:
   - **GitHub**: [Create token](https://github.com/settings/tokens) with `repo`, `read:org` scopes
   - **GitLab**: [Create token](https://gitlab.cee.redhat.com/-/profile/personal_access_tokens) with `api`, `read_api`, `read_repository` scopes
   - **Jira**: [Create token](https://id.atlassian.com/manage-profile/security/api-tokens)

3. Configure MCP servers in Claude Code:
   ```bash
   claude mcp list    # verify servers are connected
   ```

## Quick Start

```bash
# Clone the repo
git clone <repo-url> && cd ninja-agents

# Set up tokens
cp .env.example .env
# Edit .env with your actual tokens

# Open Claude Code in this directory
claude

# Run the weekly team report
/team-update
```

## Available Agents

### Weekly Team Report (`/team-update`)

Generates a leadership-ready weekly status report by querying GitHub, GitLab, and Jira for the last 7 days of activity across all team members.

**What it does:**
1. Fetches merged PRs, open PRs, and Jira tickets for each engineer (parallel MCP queries)
2. Saves raw data as CSV files in `data/cache/team-wide/`
3. Runs `scripts/generate-weekly-report.py` to produce a formatted markdown report
4. Validates all links in the report
5. Saves the final report to `data/team-wide/weekly-update-YYYY-MM-DD.md`

**Output format:**
- Key Highlights (auto-generated)
- Completed This Week (by product, then by engineer, PRs nested under Jira tickets)
- In Progress (same structure)
- Blockers & Critical Issues

**Time:** ~30-40 seconds

## Configuration

### Team Config (`data/team-config.json`)

This is the main file you need to customize for your team. It defines:

- **Team name** and report title
- **Jira** cloud ID, filter ID, and base URL
- **Products** with Jira prefixes and tracked GitHub/GitLab repos
- **Engineers** with their GitHub username, GitLab username, Jira account ID, and product assignments

The included config is a working example for the Migrations & Networking Frontend team. To adapt it for your team:

1. Update `team_name` and `report_title`
2. Update `jira` section with your Jira instance details
3. Replace `products` with your product areas and repos
4. Replace `engineers` with your team members

To find a team member's Jira account ID, use:
```bash
# In Claude Code:
mcp__atlassian__lookupJiraAccountId with searchString: "user@company.com"
```

## Adding New Agents

To add a new agent:

1. Create an agent spec in `.claude/agents/your-agent.md`
2. Create a skill file in `.claude/skills/your-skill.md` for easy invocation
3. Add any supporting scripts in `scripts/`
4. Update this README

See the weekly-team-update agent as a reference for the agent spec format.

## Project Structure

```
ninja-agents/
├── CLAUDE.md                    # Instructions for Claude Code
├── README.md                    # This file
├── .env.example                 # Token template (copy to .env)
├── .claude/
│   ├── agents/                  # Agent specifications
│   │   └── weekly-team-update.md
│   ├── skills/                  # Skill shortcuts
│   │   └── team-update.md
│   └── settings.json            # Permission allowlist
├── scripts/                     # Supporting scripts
│   ├── generate-weekly-report.py
│   └── validate-report-links.py
└── data/
    ├── team-config.json         # Team configuration (customize this)
    ├── cache/team-wide/         # Temporary CSV cache
    └── team-wide/               # Generated reports
```
