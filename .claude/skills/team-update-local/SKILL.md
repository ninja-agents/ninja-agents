---
name: team-update-local
description: Generate weekly team report using local LLM (LM Studio)
user-invocable: true
---

Run the standalone weekly team update pipeline using the local LLM for summary generation.

```bash
npx tsx agents/weekly-team-update/scripts/run-local.ts
```

This fetches data from GitHub/GitLab/Jira, generates the report, writes the summary via LM Studio, and validates links. Requires `GITHUB_PAT`, `GITLAB_PAT`, `JIRA_API_TOKEN`, `JIRA_EMAIL` env vars and LM Studio running on localhost:1234.

When done, read and display the output file.
