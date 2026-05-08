---
name: team-update
description: Generate a weekly team status report for leadership (7-day window)
user-invocable: true
---

Generate a concise weekly team report for leadership by querying the last 7 days of activity across all engineers via live MCP queries.

## Usage

```bash
/team-update
```

No arguments needed - automatically queries all data sources and generates the report.

## What This Does

Launches the `weekly-team-update` agent which:

1. **Fetches last 7 days of activity** via parallel MCP queries:
   - Batch 1: GitHub PRs (merged + open) for all engineers + Jira team filter (parallel calls)
   - Batch 2: GitLab MRs (merged + open) for all engineers (parallel calls)
2. **Saves data to CSV** in `agents/weekly-team-update/data/cache/` (github-prs.csv, gitlab-mrs.csv, jira-tickets.csv)
3. **Runs `agents/weekly-team-update/scripts/generate-weekly-report.ts`** which deterministically:
   - Filters by date window and resolution
   - Nests PRs under their parent Jira tickets
   - Organizes by product and engineer
   - Generates formatted markdown (with a placeholder for highlights)
4. **Writes Key Highlights** — the agent reads the completed work and writes polished, leadership-friendly theme summaries
5. **Validates all links** via `agents/weekly-team-update/scripts/validate-report-links.ts`
6. **Saves to file**: `agents/weekly-team-update/data/output/weekly-update-{YYYY-MM-DD}.md`
7. **Displays** the report

**Time:** ~30-40 seconds

## Expected Output

A weekly report with:

### Key Highlights

- 3-5 polished theme summaries written by the agent (active voice, no truncation, leadership-friendly)

### Completed This Week

- Organized by product, then by engineer
- PRs/MRs with merge dates, Jira tickets resolved as Done
- Strict 7-day window: only items merged/resolved in the last 7 days

### In Progress

- Organized by product, then by engineer
- Open PRs with age, Jira tickets with status

### Blockers & Critical Issues (optional)

- Real external blockers only
- Omitted entirely if no blockers exist

## Critical Rules

1. **Link formatting**: All GitHub PRs, commits, and Jira tickets use markdown hyperlinks with descriptions
   - `[MTV-4458 - UI Show MTV metrics](https://redhat.atlassian.net/browse/MTV-4458)`

2. **Jira resolution field**: Only count `resolution = "Done"` as completed deliverables
   - Report separately: tickets closed as "Cannot Reproduce", "Won't Do", etc.

3. **Privacy**: Anonymize personal issues, name individuals only for positive highlights
