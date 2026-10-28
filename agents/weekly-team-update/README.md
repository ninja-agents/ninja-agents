# Weekly Team Update

Generates a leadership-ready weekly status report by querying GitHub, GitLab, and Jira for the last 7 days of activity across all team members.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for reads.
- **GitHub and GitLab API tokens** — `GITHUB_PAT` and `GITLAB_PAT` in the environment for the existing direct collector.
- **GitLab API base** — `gitlab.api_url` in private team config, or `GITLAB_API_URL`.

The report collector uses direct APIs, not MCP. GitHub is the sole project MCP server for workflows that use it, including the separate publish workflow. Set credentials before launching your IDE; never pass secrets in command arguments or print their values. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/team-update
```

After reviewing the generated report, run `/team-update-publish` to preview its Summary and, after explicit approval, push it to the configured fork and open a PR containing only that section in the configured GitHub repository.

In Codex, select `$team-update-publish`. In Cursor, ask to publish the approved weekly team summary.

### Cursor

In Cursor chat, mention `@weekly-team-update` or ask for a "weekly team report" — the rule activates automatically and walks through the full workflow.

### Manual

Fetch the CSV cache, then run the report scripts:

```bash
node --import tsx agents/weekly-team-update/scripts/fetch-data.ts
npx tsx agents/weekly-team-update/scripts/generate-weekly-report.ts --date 2026-05-06
npx tsx agents/weekly-team-update/scripts/validate-report-links.ts
```

## How It Works

1. Reads `data/team-config.json` for engineer usernames and product mappings
2. Runs `scripts/fetch-data.ts`, which collects directly from the GitHub, Jira, and GitLab APIs:
   - GitHub PRs (merged + open) for each engineer
   - Jira tickets (assignee + QA contact, updated in last 7 days) for each engineer
   - Jira sprint backlog (all tickets in the active sprint, regardless of update date) to ensure In Progress items are never missed
   - GitLab MRs (merged + open) for each engineer, with `scope=all`
3. Merges per-engineer and sprint-based Jira results (dedup by key), follows Jira parent links for weekly work and PR references, and saves normalized CSVs in `data/cache/`
4. Runs `scripts/generate-weekly-report.ts` for deterministic formatting (body sections)
5. Agent writes Highlights and product summaries using the generated context; product summaries group relevant work under linked Features and Epics
6. Validates all links with `scripts/validate-report-links.ts`
7. Saves report to `data/output/weekly-update-{date}.md`

The agent writes Highlights and the product Summary. All other sections are generated deterministically by the TypeScript script.

If the collector exits 1, display its diagnostic and STOP before report generation; do not substitute empty data or add a second root-CLI collection path.

The collector spaces sequential GitHub requests at least 2.1 seconds apart across engineers. HTTP 429 and rate-limit HTTP 403 responses trigger up to three retries: it honors `Retry-After` and primary quota reset headers, waits at least 60 seconds, and doubles the cooldown after each retry. Other GitHub HTTP errors, transport errors, and exhausted retries exit 1 before replacing the GitHub PR cache; failed queries never count as empty activity. Diagnostics include the failed URL and response body. See [GitHub's rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit).

## Output Format

- **Summary > Highlights** — agent-written completed business outcomes
- **Summary > Products** — compact activity grouped under linked Jira Features and Epics, without repeating Highlights
- **Completed This Week** — by product, then engineer, PRs nested under Jira tickets
- **In Progress** — same structure
- **Blockers & Critical Issues** — real external blockers only

## Setup

The team configuration file contains PII and is gitignored. To set up:

```bash
cp agents/weekly-team-update/data/team-config.example.json agents/weekly-team-update/data/team-config.json
# Edit the private team-config.json with your team's real data
```

## Configuration

Edit `data/team-config.json` to customize:

- **Team name** and report title
- **Publishing destination and fork** in `publishing.github_repository` and `publishing.github_fork` (`OWNER/REPO`); the real values stay in the gitignored `team-config.json`
- **Jira** cloud ID, filter ID, and base URL
- **Products** with Jira prefixes and tracked repos
- **Engineers** with GitHub/GitLab usernames and Jira account IDs (product is inferred from work item data)

To find a Jira account ID, use the root CLI with the DNS hostname from `jira.cloud_id` (not a URL or cloud UUID):

```bash
node --import tsx scripts/jira-rest.ts --site your-site.atlassian.net user-search --query "Jane Doe"
# Equivalent: npm run jira:rest -- --site your-site.atlassian.net user-search --query "Jane Doe"
```

Read `accountId` from the returned user array. Search by name or email, but email visibility is not required: the stable `accountId`, not an email field, is used in team config. The command handles pagination internally and requires the same environment-only Jira credentials.

## File Layout

```
agents/weekly-team-update/
├── README.md                        # This file
├── tsconfig.json                    # TypeScript config (extends root)
├── scripts/
│   ├── fetch-data.ts               # Direct GitHub, Jira, and GitLab API collector
│   ├── generate-weekly-report.ts    # Deterministic report generator
│   ├── validate-report-links.ts     # Link validation
│   └── __tests__/                   # Vitest test suites
└── data/
    ├── team-config.example.json     # Template (committed)
    ├── team-config.json             # Real config (gitignored)
    ├── cache/                       # Temporary CSV cache (gitignored)
    └── output/                      # Generated reports (gitignored)
```
