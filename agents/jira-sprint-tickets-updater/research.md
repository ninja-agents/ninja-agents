# jira-sprint-tickets-updater Research Log

Iterative dry-run testing of the agent. Each run executes Steps 1–5 (read-only), aborts before applying transitions, and documents findings.

---

## Run 1 (2026-06-11)

### Result: BLOCKED at Step 2

Could not proceed past Step 2 — the agent spec has no instructions for discovering the active sprint.

### Issues Found

1. **CRITICAL — No sprint discovery mechanism**: The spec says "find the active sprint on the board matching `sprint.name_pattern`" but provides NO MCP tool call or algorithm to do this. The Atlassian MCP has no "list sprints for board" endpoint.

2. **No engineers in config**: The sprint-review agent solves sprint discovery by querying a known engineer's tickets and extracting the sprint from `customfield_10020`. The jira-sprint-tickets-updater config has no `engineers` array — it can't use this pattern.

3. **JQL `sprint in openSprints()` is too broad**: Without filtering by sprint name, this returns tickets from ALL open sprints across all projects (CNV has "CNV Perf Sprint 225" active, unrelated to our board).

4. **Sprint name in JQL requires the exact name**: `sprint = "MIG-NET-Frontend Sprint 5"` works but only if you know the sprint number. The config only has the prefix pattern.

### Fixes Applied (before Run 2)

1. Add sprint discovery step to agent spec — query one ticket by board_id and extract sprint from `customfield_10020`, matching by `name_pattern` prefix
2. Add an `engineers` array to config with at least one engineer for sprint discovery (reuse pattern from sprint-review)
3. Alternative: use JQL `sprint in openSprints()` and filter by sprint name in the description field containing the pattern

---

## Run 2 (2026-06-11)

### Input

- Sprint: MIG-NET-Frontend Sprint 3 (id: 67465, board: 11806)
- Tickets fetched: 89 (43 MTV, 16 MTA, 15 OCPBUGS, 14 CNV, 1 CONSOLE)
- Actionable tickets (in from_status): 18 (10 In Progress, 4 ASSIGNED, 4 POST)
- GitHub links found: 6 (5 PRs, 1 issue) across 6 tickets; 12 tickets have no links

### Output

- Transitions proposed: 1
  - MTA-7026: ASSIGNED → POST (open GitHub issue #3287)
- Skipped: 17
  - 4x POST tickets: PRs still open (correct — `all_links_resolved` requires merged)
  - 1x In Progress with open PR: correct — `all_links_resolved` requires merged
  - 12x no GitHub links

### Issues Found

1. **"Vulnerability" issue type not in config** — OCPBUGS-87092 is type "Vulnerability" but bugzilla workflow only has `["Bug"]`. Skipped as "no matching rule" instead of matching the bugzilla workflow.
2. **Preview missing sprint context** — the output file doesn't include the sprint name. The user has no context about which sprint this is for.
3. **Non-GitHub remote links** — OCPBUGS-87092 had 4 remote links but only 1 was a GitHub PR. The others were CVE/security advisory URLs. Agent spec mentions filtering for `/pull/` and `/issues/` patterns but this is easy to miss.
4. **Agent wrote the CSV manually** — the agent spec doesn't clearly separate "agent writes CSV" from "script reads CSV". In practice, the agent must construct the CSV itself from the MCP responses, which is error-prone. The spec should be more explicit about CSV writing being the agent's responsibility.

### Fixes Applied (before Run 3)

1. Add "Vulnerability" to OCPBUGS and MTA bugzilla `issue_types`
2. Update TypeScript script to accept and display sprint name in the output header

---

## Run 3 (2026-06-11)

### Input

Same CSV as Run 2 (same sprint data). Config updated: Vulnerability type added. Script updated: --sprint flag, improved skip reasons.

### Output

- Header now shows: "Proposed Ticket Transitions — MIG-NET-Frontend Sprint 3" ✅
- Transitions proposed: 1 (same as Run 2 — MTA-7026: ASSIGNED → POST)
- Skip reasons now specific:
  - `condition not met (links: open)` — 5 tickets with open PRs/issues
  - `no linked GitHub PR/issue` — 12 tickets
  - No more ambiguous "no matching rule" ✅

### Issues Found

1. **Skip reason granularity is good** — distinguishes "no links", "condition not met (links: open)", "no workflow for issue type", "project not in config", "status not in rules"
2. **OCPBUGS-87092 (Vulnerability)** now correctly matches bugzilla workflow, but condition still not met (PR is open). Config fix verified ✅
3. **The script only processes "actionable" tickets** — the CSV only has 18 tickets, not all 89. The agent spec should clarify whether to include ALL sprint tickets in CSV or only those in actionable statuses. Currently the agent decides which to include.
4. **`--sprint` flag works** but is not documented in the README or help text fully

### Fixes Applied (before Run 4)

1. Clarify in agent spec that CSV should include ALL tickets in actionable statuses (matching any `from` status in any rule), not all 89 tickets
2. Test with a synthetic CSV that has merged PRs to verify the transition logic end-to-end

---

## Run 4 (2026-06-11)

### Synthetic Test Data (13 scenarios)

| Ticket        | Status      | Type          | Links             | Expected                      |
| ------------- | ----------- | ------------- | ----------------- | ----------------------------- |
| CNV-10001     | In Progress | Story         | 1 merged PR       | → Dev Complete ✅             |
| CNV-10002     | In Progress | Story         | 1 open PR         | Skipped ✅                    |
| CNV-10003     | In Progress | Story         | 2 merged PRs      | → Dev Complete ✅             |
| CNV-10004     | In Progress | Story         | 1 merged + 1 open | Skipped (not all resolved) ✅ |
| MTV-10001     | In Progress | Bug           | 1 merged PR       | → Dev Complete ✅             |
| OCPBUGS-10001 | ASSIGNED    | Bug           | 1 open PR         | → POST ✅                     |
| OCPBUGS-10002 | POST        | Bug           | 1 merged PR       | → MODIFIED ✅                 |
| OCPBUGS-10003 | POST        | Bug           | 1 closed issue    | → MODIFIED ✅                 |
| OCPBUGS-10004 | POST        | Vulnerability | 1 merged PR       | → MODIFIED ✅                 |
| MTA-10001     | ASSIGNED    | Bug           | 1 open issue      | → POST ✅                     |
| MTA-10002     | In Progress | Story         | none              | Skipped ✅                    |
| MTA-10003     | In Progress | Epic          | 1 closed issue    | → Dev Complete ✅             |
| CONSOLE-10001 | In Progress | Story         | 1 merged PR       | → Dev Complete ✅             |

### Result: ALL 13 scenarios pass

10 transitions proposed, 3 correctly skipped. Key validations:

- `all_links_resolved` requires ALL links resolved (CNV-10004 with mixed states correctly skipped)
- Closed GitHub issues count as "resolved" (OCPBUGS-10003, MTA-10003)
- Vulnerability type now matches bugzilla workflow (OCPBUGS-10004)
- MTA dual workflows work: Bug→bugzilla, Epic→standard

### Issues Found

1. **Output only shows first link** — CNV-10003 has 2 PRs but only the first is shown in the Link column. Should show all or at least indicate "2 PRs".
2. **Summary column missing from preview table** — helps identify tickets at a glance
3. **No total ticket count** — the preview shows "10 to transition, 3 skipped" but doesn't say "out of 13 total"

### Fixes Applied (before Run 5)

1. Show link count in parentheses when multiple links: `[2 links](first-url)`
2. Add total count to the output header

---

## Run 5 (2026-06-11)

### Result

Same synthetic data as Run 4. Output improvements verified:

- Total count: "13 tickets analyzed. **10** to transition, **3** skipped." ✅
- Multi-link display: CNV-10003 shows `[2 links]` ✅
- All 13 scenarios still pass ✅

### Issues Found

1. **Skipped section could group by reason** — 12 "no linked PR/issue" tickets cluttering the output. Group them: "12 tickets skipped (no linked GitHub PR/issue): CNV-74265, CNV-89525, ..."
2. **No assignee in preview** — knowing who owns the ticket helps decide whether to approve

### Fixes Applied (before Run 6)

1. Group skipped tickets by reason for cleaner output
2. Add assignee column to the transition table

---

## Run 6 (2026-06-11)

### Input

Real sprint data (MIG-NET-Frontend Sprint 3), 18 actionable tickets with assignees.

### Output

```
18 tickets analyzed. **1** to transition, **17** skipped.

| Ticket   | Assignee | Current | Target | Reason                     | Link |
|----------|----------|---------|--------|----------------------------|------|
| MTA-7026 | sshveta  | ASSIGNED| POST   | PR opened or issue created | link |

Skipped (grouped):
- condition not met (links: open) (5): OCPBUGS-86858, OCPBUGS-87092, ...
- no linked GitHub PR/issue (12): CNV-74265, CNV-89525, ...
```

### Improvements Verified

- Assignee column shows who owns each ticket ✅
- Grouped skip reasons — compact, scannable ✅
- Total count at top ✅
- Sprint name in header ✅

### Issues Found

1. **Agent spec Step 3 is the bottleneck** — fetching remote links for ALL 89 tickets (one MCP call per ticket) is expensive. Should only fetch for tickets in actionable statuses.
2. **Agent spec doesn't mention filtering to actionable tickets** — it says "for each ticket, fetch its remote links" implying ALL tickets. But the CSV only needs actionable ones.
3. **Validate script should check the output** — `validate-output.ts` exists but was never run in this test cycle.

### Fixes Applied (before Run 7)

1. Update agent spec Step 3 to only fetch remote links for tickets in actionable statuses (matching any `from` status in transition rules)
2. Run validate-output.ts against the output

---

## Run 7 (2026-06-11)

### Edge Case: All-done sprint + skip reason priority fix

Tested with 3 tickets all in done statuses (Closed, Verified, Dev Complete). Found skip reason priority was wrong — "no linked GitHub PR/issue" was shown for tickets whose real problem was "status not in rules".

**Fix**: Reordered skip checks — status relevance before link check. After fix:

```
- CNV-10001 (Closed): status "Closed" not in rules  ✅
- CNV-10002 (Verified): status "Verified" not in rules  ✅
- MTV-10003 (Dev Complete): status "Dev Complete" not in rules  ✅
```

---

## Run 8 (2026-06-11)

### Edge Case: Special characters in CSV

Tested with commas, double quotes, pipe chars, and backslashes in summaries. CSV parsing handled all correctly. 3/3 transitions proposed.

---

## Run 9 (2026-06-11)

### Edge Case: Validation on broken output

Empty file correctly caught with 2 errors: "Output file is empty" and "Missing required heading". Exit code 1.

---

## Run 10 (2026-06-11)

### Final Integration Test

Real sprint data, all improvements applied, validation included.

**Result:**

```
18 tickets analyzed. **1** to transition, **17** skipped.
✓ Validation passed
```

**New finding**: MTV-4738 (Bug, status "ASSIGNED") is correctly identified as having an inconsistent state — MTV uses the standard workflow (no ASSIGNED status), so skipped as `status "ASSIGNED" not in rules`. This is a real data quality signal the user should investigate.

**Skip reason breakdown** (now 3 distinct reasons, grouped):

- condition not met (links: open): 5 tickets
- no linked GitHub PR/issue: 11 tickets
- status not in rules: 1 ticket (MTV-4738)

---

## Summary of All Improvements

### Issues Found and Fixed (10 runs)

| Run | Issue                                        | Severity | Fix                                                                             |
| --- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| 1   | No sprint discovery mechanism                | CRITICAL | Added sprint discovery step using engineer lookup + customfield_10020           |
| 1   | No engineers in config                       | CRITICAL | Added `engineers` array to config                                               |
| 2   | "Vulnerability" issue type missing           | Medium   | Added to OCPBUGS and MTA bugzilla issue_types                                   |
| 2   | Preview missing sprint name                  | Low      | Added `--sprint` flag to script, header display                                 |
| 3   | Skip reason "no matching rule" ambiguous     | Medium   | Distinct reasons: status not in rules, condition not met, no links, no workflow |
| 4   | Only first link shown for multi-link tickets | Low      | Show `[N links]` when multiple                                                  |
| 4   | No total ticket count                        | Low      | Added summary line: "N analyzed, M to transition, K skipped"                    |
| 5   | Skipped list too verbose                     | Low      | Grouped by reason with counts                                                   |
| 5   | No assignee in preview                       | Low      | Added Assignee column                                                           |
| 6   | Fetching links for ALL tickets wasteful      | Medium   | Agent spec updated: filter to actionable statuses before fetching               |
| 7   | Skip reason priority wrong                   | Medium   | Check status relevance before link existence                                    |

### Files Modified

- `agents/jira-sprint-tickets-updater/data/config.json` — added engineers, Vulnerability type
- `agents/jira-sprint-tickets-updater/scripts/generate-ticket-updates.ts` — skip reasons, assignee column, grouped output, sprint name, link count, status priority fix
- `.claude/agents/jira-sprint-tickets-updater.md` — sprint discovery step, actionable ticket filter, script args

### Remaining Known Issues (after runs 1-10)

1. **Agent writes CSV manually** — error-prone, could be scripted
2. **No rate limit handling** in Step 6 (sequential mitigates but doesn't solve)
3. **MTV-4738 "ASSIGNED" status** in standard workflow — real data inconsistency the agent correctly flags
4. **Cache cleared before sprint validation** — minor, could validate sprint first

---

## Runs 11-20: Deep Testing

Focus: script edge cases, validation coverage, config gaps, agent spec clarity, test suite expansion.

---

## Run 11 (2026-06-11)

### 3 Critical Bugs Fixed

| Bug                         | Description                                                                                                               | Fix                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Empty states false positive | `[].every(isResolved)` returns `true` in JS — ticket with URLs but no states would incorrectly match `all_links_resolved` | Added URL/state count mismatch guard: skip with "GitHub state data incomplete (N URLs, M states)" |
| Pipe chars break table      | Summary containing `\|` corrupts markdown table output                                                                    | Added `escapeMarkdownCell()` — replaces `\|` with `\\\|`                                          |
| CSV escaped quotes          | Parser didn't handle doubled quotes (`""`) inside quoted fields                                                           | Fixed parser loop to detect `""` and emit single `"`                                              |

### Test Results (5 scenarios)

- CNV-30001: Escaped quotes in CSV parsed correctly ✅
- CNV-30002: Pipe char in summary doesn't break table ✅
- CNV-30003: URL with empty state caught as "incomplete" ✅
- CNV-30004: URL/state count mismatch caught ✅
- CNV-30005: Normal case still works ✅

---

## Run 12 (2026-06-11)

### Validation Script Improvements

Added 3 new checks to `validate-output.ts`:

1. **Summary line format** — verifies "N tickets analyzed. **M** to transition, **K** skipped" exists and counts add up
2. **Table row structure** — checks rows starting with `| KEY-\d+ |` have valid pipe structure
3. **Contradiction detection** — flags "No transitions to apply" text when table rows exist

Validated against last good output ✅. Tested with intentionally broken output (missing summary) — correctly caught with exit 1 ✅.

---

## Run 13 (2026-06-11)

### Config Gap: MTV Missing Epic Type

MTV config only had Story/Task/Sub-task/Bug/Feature Request. An MTV Epic would be silently skipped as "no workflow for issue type Epic".

**Fix**: Added "Epic" to MTV and CNV standard workflow `issue_types`.

---

## Run 14 (2026-06-11)

### Project Key Extraction Edge Cases

| Key           | Extracted | Result                                                             |
| ------------- | --------- | ------------------------------------------------------------------ |
| CNV-1         | CNV       | ✅ Works (single digit)                                            |
| OCPBUGS-99999 | OCPBUGS   | ✅ Works (large number)                                            |
| A-1           | A         | ✅ Extracted correctly, skipped as "project A not in config"       |
| MTV-OCP-123   | MTV-OCP   | ✅ Extracted correctly, skipped as "project MTV-OCP not in config" |

All edge cases handled correctly by regex `/^([A-Z][\w-]*)-\d+$/`.

---

## Run 15 (2026-06-11)

### Rule Priority with Overlapping Conditions

Tested OCPBUGS tickets in POST status with various link states:

| Ticket                   | Links           | Condition Match              | Result        |
| ------------------------ | --------------- | ---------------------------- | ------------- |
| OCPBUGS-50001            | open + merged   | `all_links_resolved` = false | Skipped ✅    |
| OCPBUGS-50002            | merged + merged | `all_links_resolved` = true  | → MODIFIED ✅ |
| OCPBUGS-50003 (ASSIGNED) | open + merged   | `has_active_link` = true     | → POST ✅     |

First-matching-rule behavior is correct for current config. No overlapping rules exist for the same from_status.

---

## Run 16 (2026-06-11)

### Full Pipeline with All Fixes (Real Data)

Real sprint data, all improvements applied. Result identical to Run 10 but with improved validation:

- Script: 1 transition, 17 skipped
- Validation: ✅ passed
- 3 distinct skip reasons grouped correctly

---

## Run 17 (2026-06-11)

### Agent Spec Step 6 Clarity Fix

Step 6 said "verify it matches the target status name" without explaining how. Updated to explicit 3-step lookup:

1. By ID → verify `transition.to.name` matches
2. Fallback by name → find `transition.to.name` match
3. Not found → skip with warning message

---

## Run 18 (2026-06-11)

### Test Suite Expansion

Added 6 integration tests (total now 8):

- Merged PR → transition proposed ✅
- Open PR → skipped ✅
- Mixed resolved/open → skipped (all_links_resolved requires ALL) ✅
- URL/state count mismatch → caught ✅
- OCPBUGS bugzilla workflow → MODIFIED ✅
- Closed GitHub issue → treated as resolved ✅

Tests run the actual script via `execFileSync` with synthetic CSV — true integration tests.

---

## Run 19 (2026-06-11)

### Lint Fix

Fixed `require()` import in test file — replaced with top-level `writeFileSync` import. Lint clean, 8/8 tests pass.

---

## Run 20 (2026-06-11)

### Final Integration

All 3 checks pass in sequence:

1. `generate-ticket-updates.ts` — 1 transition, 17 skipped ✅
2. `validate-output.ts` — validation passed ✅
3. `vitest` — 8/8 tests passed ✅

---

## Summary of All Improvements (Runs 1-20)

### Issues Found and Fixed

| Run | Issue                                   | Severity | Fix                                                                |
| --- | --------------------------------------- | -------- | ------------------------------------------------------------------ |
| 1   | No sprint discovery mechanism           | CRITICAL | Added sprint discovery step using engineer lookup                  |
| 1   | No engineers in config                  | CRITICAL | Added `engineers` array to config                                  |
| 2   | "Vulnerability" issue type missing      | Medium   | Added to OCPBUGS and MTA bugzilla issue_types                      |
| 2   | Preview missing sprint name             | Low      | Added `--sprint` flag                                              |
| 3   | Skip reason ambiguous                   | Medium   | Distinct reasons: status not in rules, condition not met, no links |
| 4   | Only first link shown for multi-link    | Low      | Show `[N links]` when multiple                                     |
| 4   | No total ticket count                   | Low      | Added summary line                                                 |
| 5   | Skipped list too verbose                | Low      | Grouped by reason                                                  |
| 5   | No assignee in preview                  | Low      | Added Assignee column                                              |
| 6   | Fetching links for ALL tickets wasteful | Medium   | Agent spec: filter to actionable statuses                          |
| 7   | Skip reason priority wrong              | Medium   | Check status before links                                          |
| 11  | Empty states false positive             | CRITICAL | URL/state count mismatch guard                                     |
| 11  | Pipe chars break table                  | Medium   | `escapeMarkdownCell()`                                             |
| 11  | CSV escaped quotes broken               | Medium   | Fixed parser for doubled quotes                                    |
| 12  | Validation too shallow                  | Medium   | Added summary/table/contradiction checks                           |
| 13  | MTV missing Epic type                   | Low      | Added Epic to CNV/MTV config                                       |
| 17  | Step 6 transition lookup vague          | Medium   | Explicit 3-step lookup order                                       |
| 18  | No integration tests                    | Medium   | Added 6 integration tests (total 8)                                |

### Final State

- **Config**: 5 projects, 2 workflow types, 7 transition rules, verified against live Jira
- **Script**: 323 lines, handles edge cases (quotes, pipes, mismatched data, empty states)
- **Validation**: Checks heading, summary counts, table structure, bare URLs, contradictions
- **Tests**: 8 tests (2 config, 6 integration) — all pass
- **Agent spec**: Sprint discovery, actionable filtering, explicit transition lookup, OCPBUGS MODIFIED cap

### Remaining Known Issues (after runs 1-20)

1. **Agent writes CSV manually** — the agent constructs CSV from MCP responses; error-prone but hard to automate
2. **Description GitHub URL extraction** — spec mentions checking description but is agent responsibility (not script)
3. **Step 5 "select" subset handling** — spec defines it but untestable without a live agent run
4. **Step 7 summary format** — untestable without live agent run (agent writes prose, not script)
5. **Cache cleared before sprint validation** — minor ordering issue in Step 1

---

## Runs 21-30: Agent Execution Testing

Focus: run full agent workflow as subagent, observe how it follows the spec, find spec ambiguities and gaps in the agent-to-script handoff.

---

## Run 21 (2026-06-11)

### Method

Full subagent execution of agent spec Steps 1-5, abort at Step 5.

### Result

1 transition proposed (MTA-7026: ASSIGNED → POST), 88 skipped. Agent wrote ALL 89 tickets to CSV (not just actionable).

### Issues Found

1. **CRITICAL — Sprint ID quoting in JQL**: Spec says `sprint = "{sprint_id}"` with quotes but Jira expects unquoted integers. Agent got 0 results on first attempt, had to retry with unquoted ID. A conforming agent would halt at validation.

2. **CSV scope ambiguity**: Spec says "Save results to CSV" but doesn't clarify whether ALL 89 tickets or only 18 actionable ones. Agent wrote all 89 → script skipped 71 with "status not in rules". Clutters the output.

3. **Description ADF format**: Spec says check descriptions for GitHub URLs but descriptions come back as ADF JSON, not plain text. Agent had to parse ADF to find URLs — spec doesn't address this.

4. **[3/7] link count message scope**: `{tickets_without_links}` ambiguous — actionable-only or all? Agent used actionable-only (correct).

5. **Large result sets**: 89-ticket query exceeded MCP output limits (332K chars) — saved to temp file. Spec doesn't account for this.

6. **Non-GitHub remote links silently ignored**: Worked correctly but spec could note this explicitly.

### Fixes Applied (before Run 22)

1. Fix JQL: unquote sprint ID — `sprint = {sprint_id}` not `sprint = "{sprint_id}"`
2. Clarify CSV scope: only include tickets in actionable statuses
3. Note ADF format handling in spec Step 3

---

## Run 22 (2026-06-11)

### Result

All 3 fixes verified:

- JQL unquoted sprint ID: first-attempt success, no retry ✅
- CSV: 18 actionable tickets (not 89) ✅
- Non-GitHub links silently ignored, ADF description search worked ✅

### Output

18 tickets analyzed. 1 to transition (MTA-7026: ASSIGNED → POST), 17 skipped.

- 9 condition not met (links: open)
- 8 no linked GitHub PR/issue

No remaining issues found in this run. The spec was followed without ambiguity.

---

## Run 23 (2026-06-11)

### Sprint Discovery Fallback

Tested second engineer (Phillip Bailey) for sprint discovery. Found "MIG-NET-Frontend Sprint 3" successfully.

**Spec issues fixed:**

- Clarified "no match" means either (a) 0 issues returned OR (b) no active sprint matching pattern
- Added fallback logging: `[1/7] No matching sprint for {name}, trying next...`
- Changed "try the next engineer" to "iterate through ALL engineers"

---

## Run 24 (2026-06-11)

### CSV Writing Accuracy

Agent wrote 5 tickets to CSV with various quoting challenges:

- `MTV "5.0.0"` → correctly doubled quotes: `"MTV ""5.0.0"""`
- `"Something wrong happened"` → correctly escaped
- Fields without special chars → correctly unquoted
- Empty fields → empty between commas

All 5 tickets parsed correctly by the script. No quoting issues found.

---

## Run 25 (2026-06-11)

### Unknown Project Handling

Tested with tickets from UNKNOWN and RHEL projects (not in config). Script correctly:

- Skipped with `project "UNKNOWN" not in config`
- Processed known-project tickets alongside unknown ones
- No interference between unknown and known projects

---

## Run 26 (2026-06-11)

### Validation Script Edge Cases

Tested validation against intentionally broken outputs:

- Count mismatch (5 != 3 + 1): caught ✅
- Contradiction ("no transitions" + table rows): caught ✅
- Both exit code 1

---

## Run 27 (2026-06-11)

### Scale Test (30 tickets)

25 transitions proposed, 5 skipped. Preview table is readable at scale. Validation passes. Minor note: the "Reason" column is repetitive for same-rule transitions, but acceptable.

---

## Run 28 (2026-06-11)

### Step 6 Transition ID Verification

Verified transition IDs against live Jira for MTA-7026 and OCPBUGS-86858:

- MTA transition ID "31" (POST): confirmed ✅
- OCPBUGS transition ID "91" (MODIFIED): confirmed ✅
- MTA and OCPBUGS share identical transition IDs (same Bugzilla workflow scheme)
- All transitions are global (`isGlobal: true`), no workflow guards

---

## Run 29 (2026-06-11)

### Full End-to-End Integration (A- grade)

Clean run, all fixes applied:

- 89 tickets fetched → 18 actionable → 10 with links → 1 transition proposed
- All status lines correct per spec
- CSV had exactly 18 rows (actionable only)
- Script produced clean output, validation passed

**One minor gap found:** Step 2 JQL `fields` array didn't include `"description"` — needed for description-based GitHub URL extraction in Step 3. Fixed.

### Fixes Applied (before Run 30)

1. Added `"description"` to Step 2 JQL fields list

---

## Run 30 (2026-06-11)

### Final Integration — PASSED

89 → 18 → 10 → 1 transition. Validation passed. Spec followed without ambiguity.

Agent verdict: **Production ready.**

---

## Summary of All Improvements (Runs 1-30)

### Issues Found and Fixed

| Run     | Issue                                   | Severity | Fix                                                                |
| ------- | --------------------------------------- | -------- | ------------------------------------------------------------------ |
| 1       | No sprint discovery mechanism           | CRITICAL | Added sprint discovery step using engineer lookup                  |
| 1       | No engineers in config                  | CRITICAL | Added `engineers` array to config                                  |
| 2       | "Vulnerability" issue type missing      | Medium   | Added to OCPBUGS and MTA bugzilla issue_types                      |
| 2       | Preview missing sprint name             | Low      | Added `--sprint` flag                                              |
| 3       | Skip reason ambiguous                   | Medium   | Distinct reasons: status not in rules, condition not met, no links |
| 4       | Only first link shown for multi-link    | Low      | Show `[N links]` when multiple                                     |
| 4       | No total ticket count                   | Low      | Added summary line                                                 |
| 5       | Skipped list too verbose                | Low      | Grouped by reason                                                  |
| 5       | No assignee in preview                  | Low      | Added Assignee column                                              |
| 6       | Fetching links for ALL tickets wasteful | Medium   | Agent spec: filter to actionable statuses                          |
| 7       | Skip reason priority wrong              | Medium   | Check status before links                                          |
| 11      | Empty states false positive             | CRITICAL | URL/state count mismatch guard                                     |
| 11      | Pipe chars break table                  | Medium   | `escapeMarkdownCell()`                                             |
| 11      | CSV escaped quotes broken               | Medium   | Fixed parser for doubled quotes                                    |
| 12      | Validation too shallow                  | Medium   | Added summary/table/contradiction checks                           |
| 13      | MTV/CNV missing Epic type               | Low      | Added Epic to config                                               |
| 17      | Step 6 transition lookup vague          | Medium   | Explicit 3-step lookup order                                       |
| 18      | No integration tests                    | Medium   | Added 6 integration tests (total 8)                                |
| 21      | Sprint ID quoting in JQL                | CRITICAL | Changed to unquoted `sprint = {sprint_id}`                         |
| 21      | CSV includes all 89 tickets             | Medium   | Clarified: only actionable tickets in CSV                          |
| 21      | Description ADF format not noted        | Low      | Added ADF handling note in spec                                    |
| 23      | Sprint fallback logic unclear           | Medium   | Clarified no-match conditions, iterate ALL engineers               |
| 29      | Description field not in JQL            | Low      | Added `"description"` to Step 2 fields list                        |
| dry run | CNV/MTV Bugs use bugzilla workflow      | Medium   | Added bugzilla workflow to CNV and MTV config                      |

### Final State

- **Config**: 5 projects, dual workflows (standard + bugzilla) for CNV/MTV/MTA, verified transition IDs
- **Script**: Handles edge cases (quotes, pipes, mismatched states, empty data, unknown projects)
- **Validation**: Checks heading, summary counts, table structure, bare URLs, contradictions
- **Tests**: 8 tests (2 config, 6 integration) — all pass
- **Agent spec**: Sprint discovery with fallback, actionable filtering, explicit transition lookup, description URL search, ADF handling, OCPBUGS MODIFIED cap
- **Subagent verdict**: A- clarity grade, production ready after 30 runs of iterative improvement
