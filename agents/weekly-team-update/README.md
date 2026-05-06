# Weekly Team Update

Generates a leadership-ready weekly status report by querying GitHub, GitLab, and Jira for the last 7 days of activity across all team members.

## Prerequisites

- **GitHub MCP** — for PR and commit data
- **GitLab MCP** (`@zereight/mcp-gitlab`) — for MR data
- **Atlassian Rovo MCP** — for Jira ticket data
- Tokens configured in `.env` at the repo root

## Usage

### Claude Code

```bash
/team-update
```

### Cursor / Manual

Run the scripts directly after populating the CSV cache:

```bash
python3 agents/weekly-team-update/scripts/generate-weekly-report.py --date 2026-05-06
python3 agents/weekly-team-update/scripts/validate-report-links.py
```

## How It Works

1. Reads `data/team-config.json` for engineer usernames and product mappings
2. Fetches data via parallel MCP queries:
   - GitHub PRs (merged + open) for each engineer
   - Jira tickets (assignee + QA contact) for each engineer
   - GitLab MRs (merged + open) for each engineer
3. Saves raw data as CSV in `data/cache/`
4. Runs `scripts/generate-weekly-report.py` for deterministic formatting
5. Validates all links with `scripts/validate-report-links.py`
6. Saves report to `data/output/weekly-update-{date}.md`

The agent does NOT format the report itself — the Python script handles all filtering, nesting, and formatting deterministically.

## Output Format

- **Key Highlights** — auto-generated factual bullets
- **Completed This Week** — by product, then engineer, PRs nested under Jira tickets
- **In Progress** — same structure
- **Blockers & Critical Issues** — real external blockers only

## Setup

The team configuration file contains PII and is gitignored. To set up:

```bash
cp data/team-config.example.json data/team-config.json
# Edit team-config.json with your team's real data
```

## Configuration

Edit `data/team-config.json` to customize:

- **Team name** and report title
- **Jira** cloud ID, filter ID, and base URL
- **Products** with Jira prefixes and tracked repos
- **Engineers** with GitHub/GitLab usernames, Jira account IDs, and product assignments

To find a Jira account ID:
```bash
# In Claude Code:
mcp__atlassian__lookupJiraAccountId with searchString: "user@company.com"
```

## File Layout

```
agents/weekly-team-update/
├── README.md                        # This file
├── scripts/
│   ├── generate-weekly-report.py    # Deterministic report generator
│   └── validate-report-links.py     # Link validation
└── data/
    ├── team-config.example.json     # Template (committed)
    ├── team-config.json             # Real config (gitignored)
    ├── cache/                       # Temporary CSV cache (gitignored)
    └── output/                      # Generated reports (gitignored)
```
