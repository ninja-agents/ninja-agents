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

- `jira.cloud_id` — the DNS hostname for `--site`, never `jira.cloud_uuid`
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

Run one command from the repository root, substituting the exact configured values as shell-quoted arguments:

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql '{source.jql}' --fields summary,description,issuetype,status,assignee,priority,components,labels,versions,fixVersions,created,updated
```

Reads require `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment only. Exit 0 emits `{issues:[...]}` after completing pagination internally, including short pages with continuation tokens. Do not add `--limit` to source collection. The CLI normalizes `fields.description` to a string while preserving ADF text and URLs; retain all other returned fields unchanged.

For the existing classifier input, adapt the returned issues into `{issues:{nodes:[{id,key,fields}]}}`: one node per issue, copying its native numeric-ID string `id`, `key` and complete returned `fields`. Save that JSON in the existing private cache; keep the model-as-collector boundary and do not add a new collector. Use the same issue data for the existing `tickets.csv` mapping and version resolution.

### Validation Checkpoint

- If 0 tickets returned: display warning, STOP, ask user to verify the JQL.
- If the command exits 1: display the safe stderr diagnostic and STOP before classifier input, CSV, classification, preview or approval. No partial JSON is usable.

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

## Step 3.5: Duplicate Check for Confirmed FREs

For every ticket classified with `target_project = RFE` and empty `review_flag` (confirmed Feature Requests), search the RFE project on the same Jira instance for existing tickets on the same topic.

Run all searches in parallel (one per confirmed FRE):

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql 'project = RFE AND text ~ "<2-4 key terms from CNV summary>" AND statusCategory != Done' --fields summary,status --limit 3
```

Escape backslashes and double quotes in extracted terms for the JQL string literal, then shell-quote the complete JQL argument. The explicit limit preserves this lookup's maximum of three results; consume the returned `issues` array. If any duplicate lookup exits 1, display its safe stderr diagnostic and STOP before completing the preview or seeking approval; do not treat failed lookups as no duplicates.

Extract 2-4 meaningful domain-specific terms from the CNV ticket summary (e.g. `"nmstate-topology"` from "nmstate-topology not giving much useful info"). Avoid generic words like "UI", "user", "option", "add".

- If results are returned: set `possible_duplicate` = `"<top-match-key>: <truncated summary>"` (key + first 60 chars of summary).
- If no results: set `possible_duplicate` = `""` (empty).

## Step 4: Save to CSV & Generate Preview

Save results to `agents/jira-move-cnv2networking/data/cache/tickets.csv`:

Header: `key,numeric_id,summary,issuetype,status,target_project,target_component,reason,review_flag,possible_duplicate`

| Field                | Source                  | Notes                                                                                                               |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `key`                | `issue.key`             | e.g., CNV-12345                                                                                                     |
| `numeric_id`         | `issue.id`              | numeric Jira ID — used to correlate `successfulIssues` after bulk move                                              |
| `summary`            | `fields.summary`        | wrap in double quotes if contains comma                                                                             |
| `issuetype`          | `fields.issuetype.name` | Bug or Feature Request                                                                                              |
| `status`             | `fields.status.name`    | current Jira status                                                                                                 |
| `target_project`     | classified              | OCPBUGS, RFE, or empty (excluded/unclassified)                                                                      |
| `target_component`   | classified              | component name, or empty                                                                                            |
| `reason`             | classified              | one-line explanation; wrap in double quotes                                                                         |
| `review_flag`        | classified              | empty=clean, ci-excluded, in-flight-no-action, review-required, review-required,type-mismatch-suspect, unclassified |
| `possible_duplicate` | Step 3.5                | empty, or `"RFE-XXXX: <summary>"` if a possible duplicate was found in the RFE project                              |

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

The preview has five sections:

1. **Confirmed moves** — tickets ready to move (no `review_flag`); FREs with a possible duplicate appear in a highlighted subsection
2. **Flagged for review** — tickets needing human decision before moving
3. **CI/tooling excluded** — tickets excluded from migration entirely
4. **Unclassified** — tickets with no keyword match
5. **In-flight / no action** — in-flight tickets with no keyword match

If any confirmed FRE has a non-empty `possible_duplicate`, display this warning before the confirmation prompt:

> ⚠ **N FRE(s) have possible duplicates in RFE** — verify before moving. Use `select` to include only tickets you've confirmed are not duplicates.

Then ask:

> **Apply the N confirmed moves? (yes / select specific keys / abort)**

- `yes` → apply only the confirmed (non-flagged) tickets
- `select` → ask which specific keys to include (flagged tickets can be explicitly included here)
- `abort` → STOP, display "No changes made."

## Step 6: Apply Moves

Use the existing Jira Bulk Move REST API via Bash + curl for cross-project moves. The Bash permission `Bash(curl * redhat.atlassian.net/rest/api/3/*)` in `.claude/settings.json` enables this. Auth uses the `JIRA_EMAIL` and `JIRA_API_TOKEN` environment variables. Require the explicit Step 5 approval before any mutation; the post-move component update below is part of those same approved moves.

Skip any ticket with `review_flag` set unless the user explicitly included it in a `select` response.

### Step 6a — Resolve OCPBUGS version ID for each ticket

OCPBUGS requires "Affects versions" on every Bug. CNV version names (e.g. "CNV v4.21.0") do not exist in OCPBUGS, so they must be mapped to OCPBUGS version IDs using `config.versionMapping.cnvToOcpbugsId`. The target version name is the CNV name without the `CNV v` prefix (for example, `CNV v4.21.0` maps to `4.21.0`); use the configured target ID rather than deriving an ID from the name.

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

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' issue --key '{numericId}' --fields summary,project
```

Use the native returned `key` and `fields.project` to identify the new key/project. If this read exits 1, display the safe stderr diagnostic and STOP further processing rather than guessing the new key or issuing a component mutation. Report the already confirmed successful move by numeric ID with a new-key lookup warning; a read failure does not undo the move.

Record: old CNV key → new OCPBUGS key.

### Step 6e — Set component on the new key

For each successfully moved ticket:

- For OCPBUGS bugs: set the single `target_component` string.
- For RFE feature requests: set each entry from `target_components` (the list resolved during Gate 4 — either `targets.rfes.nmstateComponents` or `targets.rfes.networkingComponents`).

Build a JSON array containing exactly one `{name: string}` object per approved component: `[{"name":"{target_component}"}]` for an OCPBUGS bug, or one entry per `target_components` item for an RFE. Pass the serialized array as a single shell-quoted argument:

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' set-components --key '{newKey}' --components-json '{approved components JSON array}' --approved
```

Only include `--approved` after the real Step 5 confirmation covering that ticket and its proposed components. The flag is a mechanical guard, not user approval. Invoke one mutation per ticket, sequentially; exit 0 returns native JSON (or `{}` for 204). If a component update exits 1, log its safe stderr diagnostic, record outcome `moved` with a component-update warning, and continue with the remaining approved tickets. Do not mark an already successful move as failed or imply rollback.

Track each ticket's outcome: `moved` (bulk move confirmed, with any new-key/component warning recorded separately) or `failed` (version mapping missing or bulk move rejected for this ticket).

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
