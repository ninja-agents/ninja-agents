# Weekly Team Update

Generates a leadership-ready weekly status report by querying GitHub, GitLab, and Jira for the last 7 days of activity across all team members.

## Prerequisites

- **GitHub MCP** — for PR and commit data
- **GitLab MCP** (`@zereight/mcp-gitlab`) — for MR data
- **Atlassian Rovo MCP** — for Jira ticket data
- Tokens set as environment variables — see [MCP setup guide](../../docs/mcp-setup.md)

## Usage

### Claude Code

```bash
/team-update
```

### Cursor

In Cursor chat, mention `@weekly-team-update` or ask for a "weekly team report" — the rule activates automatically and walks through the full workflow.

### Manual

Run the scripts directly after populating the CSV cache:

```bash
npx tsx agents/weekly-team-update/scripts/generate-weekly-report.ts --date 2026-05-06
npx tsx agents/weekly-team-update/scripts/validate-report-links.ts
```

## How It Works

1. Reads `data/team-config.json` for engineer usernames and product mappings
2. Fetches data via parallel MCP queries:
   - GitHub PRs (merged + open) for each engineer
   - Jira tickets (assignee + QA contact) for each engineer
   - GitLab MRs (merged + open) for each engineer
3. Saves raw data as CSV in `data/cache/`
4. Runs `scripts/generate-weekly-report.ts` for deterministic formatting (body sections)
5. Agent writes Key Highlights — polished theme summaries derived from the completed work data
6. Validates all links with `scripts/validate-report-links.ts`
7. Saves report to `data/output/weekly-update-{date}.md`

The agent writes only the Key Highlights section. All other sections are generated deterministically by the TypeScript script.

## Output Format

- **Key Highlights** — agent-written theme summaries (active voice, leadership-friendly)
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
- **Engineers** with GitHub/GitLab usernames and Jira account IDs (product is inferred from work item data)

To find a Jira account ID:

```bash
# In Claude Code:
mcp__atlassian__lookupJiraAccountId with searchString: "user@company.com"
```

## File Layout

```
agents/weekly-team-update/
├── README.md                        # This file
├── package.json                     # Dependencies (tsx, vitest, typescript)
├── tsconfig.json                    # TypeScript config
├── scripts/
│   ├── generate-weekly-report.ts    # Deterministic report generator
│   ├── validate-report-links.ts     # Link validation
│   └── __tests__/                   # Vitest test suites
└── data/
    ├── team-config.example.json     # Template (committed)
    ├── team-config.json             # Real config (gitignored)
    ├── cache/                       # Temporary CSV cache (gitignored)
    └── output/                      # Generated reports (gitignored)
```
