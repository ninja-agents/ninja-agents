---
name: team-update-local
description: Generate weekly team report using local LLM (LM Studio)
---

Run the local LM Studio report workflow from the repository root. Use Codex's command and file-reading tools for the steps below.

Step 1: Run this command:

```bash
npx tsx agents/weekly-team-update/scripts/run-local.ts
```

Wait for it to finish. If it fails, show the error and stop.

Step 2: Find the output file:

```bash
ls -t agents/weekly-team-update/data/output/weekly-update-*.md | head -1
```

Step 3: Read that file.

Step 4: Print the full file content to the user.

Step 5: Verify no placeholder remains:

```bash
grep -c "SUMMARY_PLACEHOLDER" agents/weekly-team-update/data/output/weekly-update-$(date +%Y-%m-%d).md
```

If the count is 0, say "Report generated successfully." If not, say "Warning: summary placeholder was not replaced."
