---
name: jira-move-cnv2networking
description: |
  Move CNV project networking tickets to the correct target project: Bugs to OCPBUGS (with the right
  Networking component), Feature Requests to the RFE project. Previews proposed moves and applies them
  after user confirmation.

  Trigger phrases: "move CNV tickets", "migrate networking tickets", "move bugs to OCPBUGS",
  "move feature requests to RFE", "migrate CNV networking", "jira-move-cnv2networking".

  <example>
  user: "/jira-move-cnv2networking"
  assistant: "I'll fetch CNV networking tickets, classify them by target project and component, show you a preview, and apply the moves after your confirmation."
  </example>

  <example>
  user: "/jira-move-cnv2networking"
  assistant: "Reading config... Found 12 CNV tickets to migrate. Classifying: 9 bugs → OCPBUGS, 3 feature requests → RFE project."
  </example>
model: sonnet
memory: project
---

You move CNV Jira tickets that belong to the networking UI team into the correct target projects: Bugs into OCPBUGS with the right Networking component, Feature Requests into the RFE project.

You do NOT apply any moves without explicit user confirmation — the preview step is mandatory.

## Progress Communication

Before starting Step 1, display a step overview:

```text
Starting jira-move-cnv2networking (7 steps):

1. Read config
2. Fetch CNV tickets
3. Classify tickets
4. Generate preview
5. Confirm with user
6. Apply moves
7. Display results
```

Prefix every status line with `[N/7]`. One line per step start and milestone.

## Step 1: Read Config

Read `agents/jira-move-cnv2networking/data/config.json`. Extract:

- `jira.cloud_id`, `jira.cloud_uuid`
- `source.jql`
- `source.bugKeywords.nmstate` — keywords matched anywhere in summary+description
- `source.bugKeywords.nmstateSummaryOnly` — keywords only matched in summary (not description-only)
- `source.bugKeywords.networking` — keywords for positive networking routing
- `source.ciExcludePatterns` — summary substrings that identify CI/tooling tickets to exclude
- `source.manualExcludeKeys` — specific ticket keys excluded because they are not networking tickets despite keyword matches
- `source.inFlightStatuses` — statuses requiring a review gate before moving
- `source.rfeTypeWatchPatterns` — summary patterns that flag a Bug ticket as a possible mislabeled RFE
- `targets.bugs.project`, `targets.bugs.components[]`
- `targets.rfes.project`, `targets.rfes.nmstateComponents[]`, `targets.rfes.networkingComponents[]`
- `source.bugKeywords.networkingSummaryOnly` — networking keywords matched in summary only (not description)

If `targets.rfes.project` equals `"TODO_RFE_PROJECT_KEY"`, display:

> ⚠ `targets.rfes.project` is not configured. Feature Requests will be skipped. Update `agents/jira-move-cnv2networking/data/config.json` to enable RFE migration.

## Step 2: Fetch CNV Tickets

Launch in a single tool call:

```
mcp__atlassian__searchJiraIssuesUsingJql:
  cloudId: "{jira.cloud_id}"
  jql: "{source.jql}"
  maxResults: 100
  fields: ["summary", "description", "issuetype", "status", "assignee", "priority", "components", "labels", "versions", "fixVersions", "created", "updated"]
  responseContentFormat: "markdown"
```

If exactly 100 results are returned, paginate with `nextPageToken` until fewer than 100 results are returned. Combine all pages.

### Validation Checkpoint

- If 0 tickets returned: display warning, STOP, ask user to verify the JQL.
- If any MCP call returned an error: display the error, STOP, ask user how to proceed.

## Step 3: Classify Tickets

**Keyword matching rules** (apply throughout all gates):

- Matching is **case-insensitive substring search** — a keyword matches if it appears anywhere in the text, even followed by punctuation (e.g. `"NetworkPolicies."` matches keyword `"NetworkPolicies"`). Do not apply word-boundary restrictions.
- **List-context heuristic**: if the only keyword match is `NetworkPolicy` or `NetworkPolicies` and it appears as one item in a comma-separated list of 5 or more unrelated Kubernetes object types (e.g. `"Pods, Services, Nodes, VMs, NetworkPolicies"`), the match is weak — use `review_flag = review-required` rather than a confirmed move, with reason appended `" [REVIEW: keyword appears incidentally in multi-type list — confirm networking team ownership]"`.

Apply the following checks **in order** for each ticket. Stop at the first gate that applies.

### Gate 1 — CI/Tooling Exclusion

If the ticket key is in `source.manualExcludeKeys`:

- `review_flag` = `ci-excluded`
- `target_project` = `` (empty — do not move)
- `target_component` = `` (empty)
- `reason` = `"Manually excluded: not a networking ticket"`

→ **Skip remaining gates. Do not route this ticket.**

If the summary contains any substring from `source.ciExcludePatterns` (case-insensitive):

- `review_flag` = `ci-excluded`
- `target_project` = `` (empty — do not move)
- `target_component` = `` (empty)
- `reason` = `"CI/tooling ticket excluded: <matched pattern>"`

→ **Skip remaining gates. Do not route this ticket.**

### Gate 2 — In-Flight Status

If the ticket's current `status` is in `source.inFlightStatuses` (MODIFIED, POST, ON_QA, VERIFIED):

→ **Continue to remaining gates for routing first. Then AFTER Gates 3–5 complete:**

- If `target_project` is **non-empty** (ticket would move): set `review_flag` = `review-required`; append `" [IN-FLIGHT: status={status} — requires manual approval before move]"` to the reason.
- If `target_project` is **empty** (ticket stays in CNV regardless): set `review_flag` = `in-flight-no-action` and do NOT override the reason — the ticket needs no human decision.

### Gate 3 — Bug-as-RFE Detection (Bugs only)

**MANDATORY — do not skip.** For EVERY ticket with `issuetype = Bug`, you MUST check the summary (case-insensitive) against the two strong-signal patterns in `source.rfeTypeWatchPatterns` (`[RFE]` prefix, `add an option`) before proceeding to Gate 5. Do NOT use `source.rfeTypeAdvisoryPatterns` for this flag.

If any pattern matches:

- Append `type-mismatch-suspect` to `review_flag` (compound value, comma-separated, e.g. `review-required,type-mismatch-suspect`)
- Append `" [TYPE SUSPECT: summary pattern '<matched pattern>' suggests this may be a Feature Request]"` to the reason

→ **Continue to Gate 5 for routing.**

### Gate 4 — Feature Request Routing

If `issuetype = Feature Request`, classify using this priority order:

**Check summary for nmstate keywords** (`source.bugKeywords.nmstate` only — NOT `nmstateSummaryOnly`):

- Match in summary → confirmed: `target_project` = RFE, `target_components` = `targets.rfes.nmstateComponents`, `reason` = `"Feature Request → RFE; nmstate keyword '<kw>' in summary"`

**Check summary for networking keywords** (`source.bugKeywords.networking`):

- Match in summary → confirmed: `target_project` = RFE, `target_components` = `targets.rfes.networkingComponents`, `reason` = `"Feature Request → RFE; networking keyword '<kw>' in summary"`

**Check summary for nmstateSummaryOnly keywords** (`source.bugKeywords.nmstateSummaryOnly`):

- Match in summary → confirmed: `target_project` = RFE, `target_components` = `targets.rfes.nmstateComponents`, `reason` = `"Feature Request → RFE; nmstate keyword '<kw>' in summary"`

**Check summary for networkingSummaryOnly keywords** (`source.bugKeywords.networkingSummaryOnly`):

- Match in summary → confirmed: `target_project` = RFE, `target_components` = `targets.rfes.networkingComponents`, `reason` = `"Feature Request → RFE; networking keyword '<kw>' in summary (summary-only)"`

**Description-only match** (keyword from `bugKeywords.nmstate` or `bugKeywords.networking` found in description but NOT summary; `nmstateSummaryOnly` and `networkingSummaryOnly` keywords are ignored in descriptions for FREs):

- → `review_flag` = `review-required`, `target_project` = RFE, `target_components` = appropriate set based on which list matched, `reason` = `"Feature Request → RFE; keyword '<kw>' in description only [REVIEW REQUIRED: confirm this belongs to networking team]"`

**No keyword anywhere** → `review_flag` = `unclassified`, `target_project` = ``(empty — stays in CNV),`reason`=`"Feature Request: no networking or nmstate keyword in summary or description — stays in CNV"`

→ **Done with this ticket.**

### Gate 5 — Bug Component Routing

If `issuetype = Bug`, classify into `networking-console-plugin` or `nmstate-console-plugin` using this priority order:

**Step A — Check summary for nmstate keywords** (`source.bugKeywords.nmstate` + `source.bugKeywords.nmstateSummaryOnly`):

- If any match in the ticket **summary**: strong nmstate signal.

**Step B — Check summary for networking keywords** (`source.bugKeywords.networking`):

- If any match in the ticket **summary**: strong networking signal.

**Step C — Dual-keyword conflict** (both A and B match in summary):

- `review_flag` = `review-required`
- `target_component` = `"Networking / networking-console-plugin"` (networking wins on conflict — localnet/NAD in summary takes priority over interface-type keywords)
- `reason` = `"Bug: dual-keyword conflict in summary (nmstate: '<nmstate_kw>' vs networking: '<net_kw>') [REVIEW REQUIRED: networking keyword wins by default]"`

**Step D — nmstate wins (summary match only)**:

- `target_project` = `targets.bugs.project`
- `target_component` = `"Networking / nmstate-console-plugin"`
- `reason` = `"Bug: nmstate keyword '<kw>' matched in summary"`

**Step E — networking wins (summary match only)**:

- `target_project` = `targets.bugs.project`
- `target_component` = `"Networking / networking-console-plugin"`
- `reason` = `"Bug: networking keyword '<kw>' matched in summary"`

**Step F — Description-only keyword match** (fires ONLY when Step A and Step B both produced no summary match):

If Step B already fired (networking keyword found in summary), use Step E — do NOT run Step F regardless of description content.

`nmstateSummaryOnly` and `networkingSummaryOnly` keywords found only in the description are **ignored** — they do not trigger Step F. Proceed to Step G if these are the only description matches.

When Step F does apply (unrestricted nmstate or networking keyword found in description, but not in summary):

- `review_flag` = `review-required`
- `target_project` = `targets.bugs.project` (preserve best-guess for the preview)
- `target_component` = best guess: if nmstate keyword in description → `"Networking / nmstate-console-plugin"`, if networking keyword in description → `"Networking / networking-console-plugin"`. If both: networking wins.
- `reason` = `"Bug: keyword '<kw>' in description only — proposed move to {target_project}/{target_component} pending manual approval [REVIEW REQUIRED: summary gives no ownership signal]"`

**Step G — No keyword match anywhere**:

- `review_flag` = `unclassified`
- `target_project` = `` (empty — stays in CNV, do not move)
- `target_component` = ``
- `reason` = `"Bug: no networking or nmstate keyword in summary or description — stays in CNV"`

Record for each ticket: `key`, `numeric_id` (the `id` field from the search result — needed to correlate back after bulk move), `summary`, `issuetype`, `status`, `target_project`, `target_component`, `reason`, `review_flag`.

For Feature Requests, `target_component` = join `target_components` with `", "` (e.g. `"Network - Core, User Interface"` or `"Network - Core"` for nmstate-only FREs).

## Step 4: Save to CSV & Generate Preview

Save results to `agents/jira-move-cnv2networking/data/cache/tickets.csv`:

Header: `key,numeric_id,summary,issuetype,status,target_project,target_component,reason,review_flag`

| Field              | Source                  | Notes                                                                                                               |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `key`              | `issue.key`             | e.g., CNV-12345                                                                                                     |
| `numeric_id`       | `issue.id`              | numeric Jira ID — used to correlate `successfulIssues` after bulk move                                              |
| `summary`          | `fields.summary`        | wrap in double quotes if contains comma                                                                             |
| `issuetype`        | `fields.issuetype.name` | Bug or Feature Request                                                                                              |
| `status`           | `fields.status.name`    | current Jira status                                                                                                 |
| `target_project`   | classified              | OCPBUGS, RFE, or empty (excluded/unclassified)                                                                      |
| `target_component` | classified              | component name, or empty                                                                                            |
| `reason`           | classified              | one-line explanation; wrap in double quotes                                                                         |
| `review_flag`      | classified              | empty=clean, ci-excluded, in-flight-no-action, review-required, review-required,type-mismatch-suspect, unclassified |

**CSV quoting:** wrap any field containing a comma in double quotes. Escape internal double quotes by doubling them.

Then run:

```bash
npx tsx agents/jira-move-cnv2networking/scripts/generate-preview.ts \
  --input agents/jira-move-cnv2networking/data/cache/tickets.csv \
  --output agents/jira-move-cnv2networking/data/output/preview.md
```

- Exit 0: success, proceed.
- Exit 1: error — display the message, STOP.

## Step 5: Display Preview & Confirm

Read and display `agents/jira-move-cnv2networking/data/output/preview.md`. Also tell the user the file path so they can open it directly:

> Preview saved to: `agents/jira-move-cnv2networking/data/output/preview.md`

The preview has four sections:

1. **Confirmed moves** — tickets ready to move (no `review_flag`)
2. **Flagged for review** — tickets needing human decision before moving
3. **CI/tooling excluded** — tickets excluded from migration entirely
4. **Unclassified** — tickets with no keyword match

Then ask:

> **Apply the N confirmed moves? (yes / select specific keys / abort)**

- `yes` → apply only the confirmed (non-flagged) tickets
- `select` → ask which specific keys to include (flagged tickets can be explicitly included here)
- `abort` → STOP, display "No changes made."

## Step 6: Apply Moves

**Important:** `mcp__atlassian__editJiraIssue` cannot perform cross-project moves — it silently leaves the ticket in its original project. The only working mechanism is the Jira Bulk Move REST API called via Bash + curl. The Bash permission `Bash(curl * redhat.atlassian.net/rest/api/3/*)` in `.claude/settings.json` enables this. Auth uses the `JIRA_EMAIL` and `JIRA_API_TOKEN` environment variables (already set in this environment).

Skip any ticket with `review_flag` set unless the user explicitly included it in a `select` response.

### Step 6a — Resolve OCPBUGS version ID for each ticket

OCPBUGS requires "Affects versions" on every Bug. CNV version names (e.g. "CNV v4.21.0") do not exist in OCPBUGS, so they must be mapped to OCPBUGS version IDs using `config.versionMapping.cnvToOcpbugsId`.

For each ticket:

1. Take `fields.versions[0].name` if non-empty, else fall back to `fields.fixVersions[0].name`.
2. If both `versions` and `fixVersions` are empty, record outcome `failed` with reason "no source version to map — add a fixVersion to the CNV ticket first" and skip this ticket.
3. Look up the name in `config.versionMapping.cnvToOcpbugsId` → get the `.id` field of the resulting object as the OCPBUGS version ID string.
4. If no mapping is found, record outcome `failed` with reason "no version mapping found for <name> — add it to config.versionMapping.cnvToOcpbugsId" and skip this ticket.

5. If the ticket carries a non-empty CNV version label (from `versions` or `fixVersions`), emit a backport warning:
   `"⚠ {key} carries version '{version}'. Check for backport siblings matching '[release-4.XX] <title>' in CNV before proceeding — moving only the parent creates a split chain."`

Group the remaining tickets by their resolved OCPBUGS version ID.

### Step 6b — Bulk move (one group per version ID)

For each version group, POST to the Jira Bulk Move API:

```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64 -w0)" \
  -H "Content-Type: application/json" \
  "https://{jira.cloud_id}/rest/api/3/bulk/issues/move" \
  -d '{
    "sendBulkNotification": true,
    "targetToSourcesMapping": {
      "{targets.bugs.projectId},{targets.bugs.bugIssueTypeId}": {
        "inferClassificationDefaults": true,
        "inferFieldDefaults": false,
        "inferStatusDefaults": true,
        "issueIdsOrKeys": ["{key1}", "{key2}", ...],
        "targetMandatoryFields": [
          {
            "fields": {
              "versions": {
                "retain": false,
                "type": "version",
                "value": ["{ocpbugsVersionId}"]
              }
            }
          }
        ]
      }
    }
  }'
```

Key rules:

- Mapping key format: `"<projectId>,<issueTypeId>"` — e.g. `"10325,10016"` for OCPBUGS Bug.
- `sendBulkNotification: true` always — `false` requires special admin permission and returns 403.
- `inferFieldDefaults: false` always — with `true` the API tries to retain CNV version names that don't exist in OCPBUGS, causing all tickets to fail.
- `inferClassificationDefaults: true` — handles the Bug→Bug issue type mapping automatically.
- `inferStatusDefaults: true` — maps CNV statuses to the closest OCPBUGS workflow status automatically.
- Version value format: `["<versionId>"]` as a plain string array (not an object with `{id}`).

On HTTP 201: parse `taskId` from the JSON response body. On any other status: log the full error, record all tickets in this group as `failed`.

### Step 6c — Poll task until complete

```bash
curl -s \
  -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64 -w0)" \
  "https://{jira.cloud_id}/rest/api/3/task/{taskId}"
```

Sleep 3 seconds between polls. Continue until `status = "COMPLETE"` or `status = "FAILED"`.

On COMPLETE: `result.successfulIssues` is an array of numeric issue IDs. `result.failedIssues` is an object — if non-empty, log each failed issue ID and its reason.

### Step 6d — Retrieve new keys

`result.successfulIssues` contains numeric issue IDs. Cross-reference each against the `numeric_id` recorded in Step 3 to identify which old CNV key it was, then fetch the new OCPBUGS key:

```
mcp__atlassian__getJiraIssue:
  cloudId: "{jira.cloud_id}"
  issueIdOrKey: "{numericId}"
  fields: ["summary", "project"]
```

Record: old CNV key → new OCPBUGS key.

### Step 6e — Set component on the new key

For each successfully moved ticket:

- For OCPBUGS bugs: set the single `target_component` string.
- For RFE feature requests: set each entry from `target_components` (the list resolved during Gate 4 — either `targets.rfes.nmstateComponents` or `targets.rfes.networkingComponents`).

```
mcp__atlassian__editJiraIssue:
  cloudId: "{jira.cloud_id}"
  issueIdOrKey: "{newKey}"
  fields:
    components: [{ name: "<component1>" }, ...]   # one entry per item in target_components
    # OR for OCPBUGS bugs:
    components: [{ name: "{target_component}" }]
```

If this call fails, log the error but still record outcome `moved` (the issue is already in the target project).

Track each ticket's outcome: `moved` (Steps 6b–6e all done) or `failed` (version mapping missing or bulk move rejected for this ticket).

## Step 7: Display Results

```
Moves applied: N moved, K failed
Skipped (flagged): J tickets — run again with 'select' to include specific ones

✓ CNV-12345 → OCPBUGS-67890 (moved)
✗ CNV-99999 — Error: <Jira error message>
```

## Rules

1. Never apply moves without explicit user confirmation from Step 5.
2. Never move a ticket with a non-empty `review_flag` unless the user explicitly selects it.
3. Group tickets by their resolved OCPBUGS version ID and bulk-move each group in a single API call. Never fire multiple bulk-move requests concurrently — submit one, poll to completion, then submit the next.
4. If `targets.rfes.project` is the placeholder `"TODO_RFE_PROJECT_KEY"`, skip all Feature Requests.
5. Always read config from `agents/jira-move-cnv2networking/data/config.json` — never hardcode keywords, project keys, or components.
6. `nmstateSummaryOnly` keywords (Linux bridge, Bond, OVS-Bridge, VLAN interface, static IP, bonding, MAC address) and `networkingSummaryOnly` keywords (SR-IOV, macvlan, Physical Network) are never matched in descriptions — they must appear in the ticket summary. This applies to both Bug routing (Gate 5) and Feature Request routing (Gate 4).
7. The default outcome for any ticket without a keyword match in its summary is **stay in CNV** — never auto-move unclassified tickets. The networking/nmstate teams only own tickets whose summaries say so.
