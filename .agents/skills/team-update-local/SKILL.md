---
name: team-update-local
description: Generate weekly team report using local LLM (LM Studio)
user-invocable: true
---

You MUST execute the steps below. Do NOT describe or explain them — run them.

Step 1: Use the Bash tool to run this command:

```bash
npx tsx agents/weekly-team-update/scripts/run-local.ts
```

Wait for it to finish. If it fails, show the error and stop.

Step 2: Use the Bash tool to find the output file:

```bash
ls -t agents/weekly-team-update/data/output/weekly-update-*.md | head -1
```

Step 3: Use the Read tool to read that file.

Step 4: Print the full file content to the user.

Step 5: Use the Bash tool to verify no placeholder remains:

```bash
grep -c "SUMMARY_PLACEHOLDER" agents/weekly-team-update/data/output/weekly-update-$(date +%Y-%m-%d).md
```

If the count is 0, say "Report generated successfully." If not, say "Warning: summary placeholder was not replaced."
