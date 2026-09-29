---
name: team-update
description: Generate a weekly team status report for leadership (7-day window)
user-invocable: true
---

Generate a concise weekly team report for leadership by collecting the last 7 days of activity across all engineers through the repository scripts.

## Usage

```bash
/team-update
```

No arguments needed - automatically queries all data sources and generates the report.

## What This Does

Launches the `weekly-team-update` agent which:

1. **Fetches activity** from GitHub, GitLab, and Jira, including the active Jira sprint backlog and parent hierarchy for weekly work.
2. **Saves data to CSV** in `agents/weekly-team-update/data/cache/` (including `jira-hierarchy.csv`).
3. **Runs `agents/weekly-team-update/scripts/generate-weekly-report.ts`** which deterministically:
   - Filters by date window and resolution
   - Nests PRs under their parent Jira tickets
   - Organizes by product and engineer
   - Generates formatted markdown with placeholders for Highlights and product summaries
4. **Writes Summary** — the agent writes 2–4 completed business Highlights, then compact product bullets with linked Feature and Epic groups for relevant work. Product bullets omit outcomes already in Highlights.
5. **Validates all links** via `agents/weekly-team-update/scripts/validate-report-links.ts`
6. **Saves to file**: `agents/weekly-team-update/data/output/weekly-update-{YYYY-MM-DD}.md`
7. **Displays** the report

**Time:** Varies with Jira parent lookups.

## Expected Output

A weekly report with:

### Summary

- Highlights plus one subsection per configured product
- Linked Feature and Epic groups for interesting weekly work, with no repeated Highlights

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
