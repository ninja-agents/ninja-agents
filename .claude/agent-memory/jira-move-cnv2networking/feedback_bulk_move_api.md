---
name: feedback_bulk_move_api
description: The only working mechanism for cross-project Jira moves is the Bulk Move REST API via curl — editJiraIssue silently fails for cross-project moves
metadata:
  type: feedback
---

`mcp__atlassian__editJiraIssue` does NOT perform cross-project moves. It returns HTTP 200 and the original issue unchanged — the ticket stays in CNV. Always use the Jira Bulk Move REST API instead.

**Why:** Discovered during first live run. editJiraIssue wraps PUT /rest/api/3/issue/{key} which cannot change the project field. Cross-project moves require POST /rest/api/3/bulk/issues/move.

**How to apply:** Step 6 of the agent now uses Bash + curl for moves. The `mcp__atlassian__fetch` tool is ARI-only GET and cannot help either. The permission `Bash(curl * redhat.atlassian.net/rest/api/3/*)` is in `.claude/settings.json` to allow these calls.

## Confirmed working request format

```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64 -w0)" \
  -H "Content-Type: application/json" \
  "https://redhat.atlassian.net/rest/api/3/bulk/issues/move" \
  -d '{
    "sendBulkNotification": true,
    "targetToSourcesMapping": {
      "10325,10016": {
        "inferClassificationDefaults": true,
        "inferFieldDefaults": false,
        "inferStatusDefaults": true,
        "issueIdsOrKeys": ["CNV-XXXXX"],
        "targetMandatoryFields": [
          {
            "fields": {
              "versions": {
                "retain": false,
                "type": "version",
                "value": ["<ocpbugsVersionId>"]
              }
            }
          }
        ]
      }
    }
  }'
```

Key rules proven by trial and error:

- Mapping key: `"<projectId>,<issueTypeId>"` — OCPBUGS Bug = `"10325,10016"`
- `sendBulkNotification: true` — false returns 403 (requires special admin permission we don't have)
- `inferFieldDefaults: false` — true causes all tickets to fail because CNV version names don't exist in OCPBUGS
- `inferClassificationDefaults: true` — handles Bug→Bug mapping automatically
- `inferStatusDefaults: true` — maps statuses automatically
- Version value format: `["<versionId>"]` plain string array, NOT `[{"id": "..."}]` (that format is silently rejected with a misleading error)
- Response: HTTP 201 with `{"taskId": "..."}` — async, must poll
- Poll: GET /rest/api/3/task/{taskId} until status = "COMPLETE"
- `result.successfulIssues` = array of numeric issue IDs (not keys)
