# Slack Forums Analyzer — Research Log

## Iteration 0 (Baseline)

**Date:** 2026-06-12
**Config:** 3 channels (kubernetes-nmstate, forum-openshift-virtualization, forum-cnv-ui), 5 keyword categories, 30-day lookback
**Results:** 189 messages fetched (35 + 149 + 5). Category distribution: prs-and-code=90, network-ui=55, bugs-and-issues=46, feature-requests=42, nmstate=35, uncategorized=47. Total categorized slots = 268 but only 189 messages — heavy overlap.
**Issues found:**

1. Messages appear in multiple categories (268 category slots for 189 messages = ~42% duplication)
2. "prs-and-code" dominates (90/189) because "PR", "review", "merge" are extremely common in any dev channel
3. "network-ui" keyword "interface" matches non-network contexts (e.g., "user interface")
4. "network-ui" keyword "network" matches everything in #kubernetes-nmstate
5. "feature-requests" keyword "need" and "missing" cause false positives
6. "bugs-and-issues" keyword "issue" matches Jira issue references, not just bugs
7. Message previews truncated at 120 chars — hides actionable content
8. No Jira link extraction (OCPBUGS-NNNNN buried in truncated text)
9. No GitHub/GitLab PR URL extraction
10. No thread grouping — individual messages shown instead of thread summaries

## Iteration 1

**Date:** 2026-06-12
**Changes:** (a) Implemented primary-category assignment — each message goes to ONE category (highest keyword-match-count wins). (b) Removed overly broad keywords: "issue", "need", "missing", "fix", "request", "interface", "network", "PR", "review", "merge". (c) Added domain-specific keywords: "knmstate", "kubernetes-nmstate", "OVN", "ovs", "LinuxBridge", "NNCE", "flaky", "prow.ci".
**Results:** 190 messages. nmstate=31, network-ui=19, bugs-and-issues=11, feature-requests=5, prs-and-code=2, uncategorized=122. Total=190, no overlap (dedup works).
**Issues found:**

1. 64% uncategorized — most #forum-openshift-virtualization messages are general virt support, not network-specific
2. "prs-and-code" too strict (2 messages) — removed "PR"/"review"/"merge" went too far
3. Uncategorized includes relevant messages: "DNS upstream servers", "storage live migration monitoring UI", kubevirtci effort
4. No Jira link extraction yet
5. Preview length still 120 chars — key details hidden
   **Next:** Add "e2e-and-ci" category for test failures. Increase preview length. Start Jira link extraction.

## Iterations 2-3

**Date:** 2026-06-12
**Changes:** (a) Added Jira ticket extraction — Key Jira Tickets section with clickable links. (b) Added GitHub PR/Issue extraction section. (c) Added "e2e-and-ci" category for test failures. (d) Increased preview to 200 chars. (e) Added per-channel breakdown per category. (f) Added reply count tags. (g) Cleaned newlines from previews. (h) Replaced @mentions with @user. (i) Added CUDN, UDN, localnet to network-ui keywords. (j) Removed "prs-and-code" generic keywords (approve, etc.)
**Results:** 190 messages. e2e-and-ci=42, network-ui=24, nmstate=19, bugs-and-issues=7, feature-requests=4, prs-and-code=0, uncategorized=94. Categorized=51%.
**Key findings from the data:**

- 7 Jira tickets extracted: OCPBUGS-74261, OCPBUGS-87013, CNV-82742, CNV-86150, CNV-87617, CNV-88481, CNV-89455
- 7 GitHub PRs from kubernetes-nmstate repo
- kubernetes-nmstate nightly e2e failures are recurring (6+ consecutive days of :failed:)
- CVSS 9.1 security finding on nmstate operator ClusterRole (cluster-admin equivalent)
- CUDN/UDN scaling issues reported by customers (~100 CUDNs causing OVN DB rebuilds)
- Physical networks page missing in 4.21 (OCPBUGS-87013)
- LLDP documentation removed, customers asking why
  **Issues found:**

1. prs-and-code has 0 matches — keywords too strict after cleanup
2. Still 49% uncategorized — many #forum-openshift-virtualization messages are general virt support (not networking)
3. Uncategorized includes potentially relevant: "storage live migration monitoring UI", "compliance operator for virt hardening", "MTV dual-stack IPv4/IPv6"
4. Thread grouping not implemented yet — multiple nightly e2e failure messages show as separate entries instead of one thread
5. No weekly trend distribution
   **Next:** Implement thread grouping (collapse by thread_ts). Remove prs-and-code (too sparse). Add "customer-questions" category to capture support queries. Add weekly distribution.

## Iterations 4-6

**Date:** 2026-06-12
**Changes:** (a) Implemented thread grouping — messages grouped by thread_ts, sorted by reply count. (b) Added "customer-questions" category with IHAC, TAM, TSE, how-to keywords. (c) Added weekly activity histogram. (d) Added LLDP, LACP, Egress IP to network-ui keywords. (e) Added kubevirtci to e2e-and-ci. (f) Removed prs-and-code generic keywords. (g) Increased preview to 250 chars. (h) Added thread count to category headers. (i) Show top 10 threads instead of 5.
**Results:** 190 messages. customer-questions=56, network-ui=22, nmstate=18, e2e-and-ci=15, bugs-and-issues=7, feature-requests=4, uncategorized=68. Categorized=64%.
**Key improvements:**

- Thread grouping works — nightly e2e failures now show as individual threads sorted by reply count instead of duplicate messages
- customer-questions absorbed 56 messages from the old uncategorized pool (mostly #forum-openshift-virtualization support)
- Weekly histogram shows activity trending up (20→33→49→56→32)
- Preview at 250 chars captures much more actionable content
  **Key findings from the data:**
- Top customer concern: CUDN/UDN scaling (~100 CUDNs causing OVN DB rebuilds) — 16 replies
- "Virtual Machine Networks" feature creating VLANs doesn't work correctly with DHCP — 109 replies, major thread
- OCP 4.21/4.22 docs for UDN/CUDN networking reported as incorrect — 60 replies
- OVS Egress IP + CUDN success story from Texas A&M — 29 replies
- Node network mapping dropdown missing in some 4.21 environments — 16 replies
- nmstate operator not auto-installed in 4.22.0-rc.5 — 10 replies
- LLDP documentation removed, customers asking why — 14 replies
- Security audit CVSS 9.1 finding on nmstate ClusterRole — 12 replies
- kubevirtci replacement effort underway — 8 replies
  **Issues found:**

1. customer-questions is too dominant (56/190) — absorbs general virt questions that aren't networking-related
2. Some uncategorized threads are highly relevant: "netapp nvme over tcp" (33 replies), "Network Observability Operator" (18 replies)
3. e2e-and-ci nightly failures are repetitive — could consolidate into a single "streak" entry
4. No priority/severity signal — bugs and customer issues should be ranked
   **Next:** Narrow customer-questions to networking-specific customer queries. Add "Network Observability" to network-ui. Consolidate consecutive nightly e2e failures into streaks. Add category priority ordering (bugs first).

## Iterations 7-10

**Date:** 2026-06-12
**Changes:** (a) Implemented category priority ordering via config (bugs first, then nmstate, network-ui, e2e, features, customers). (b) Consolidated nightly e2e failures into streaks — 13 consecutive failures collapsed to 1 line. (c) Renamed customer-questions to customer-networking, narrowed keywords to IHAC/customer/support case only. (d) Added Network Observability, network mapping, Virtual Machine Networks to network-ui keywords. (e) Improved Slack link rendering — convert `<url|text>` to `[text](url)`. (f) Added block-character histogram for weekly activity. (g) Preview increased to 300 chars. (h) Cleaned up double-spaces and `<#channel>` references in previews.
**Results:** 190 messages. bugs-and-issues=7, nmstate=19, network-ui=22, e2e-and-ci=15 (3 threads after consolidation), feature-requests=4, customer-networking=48, uncategorized=75. Categorized=61%.
**Key improvements:**

- Category priority ordering makes the report scannable — bugs and nmstate first
- E2e streak consolidation: "13 consecutive failures from 2026-05-25 to 2026-06-09" — immediately actionable
- customer-networking still too broad (48 messages) — captures general virt customer Qs, not just networking
- Slack link rendering makes Jira/GitHub URLs readable in previews
  **Key findings consolidated across all iterations:**

### Critical Action Items

1. **CVSS 9.1 security finding** — kubernetes-nmstate operator ClusterRole has cluster-admin equivalent permissions via wildcard RBAC (12 replies)
2. **13-day nightly e2e failure streak** — periodic-knmstate-e2e-handler failing since May 25, root cause: missing COPR repo (74 replies on main thread)
3. **Physical networks page missing in 4.21** — OCPBUGS-87013, verification blocked (9 replies)
4. **NNCP liveness probe timeout** — OCPBUGS-74261, no workaround other than delete/recreate (17 replies)

### Customer-Reported Networking Issues

5. **CUDN/UDN scaling** — ~100 CUDNs causing OVN DB rebuilds, no scale testing data available (16 replies)
6. **Virtual Machine Networks DHCP broken** — VLAN created via UI doesn't get DHCP IP, NAD works fine (109 replies)
7. **OCP Virt docs for UDN incorrect** — claims UDN works under multus, actually doesn't (60 replies)
8. **Network disconnection during upgrades** — VMs lose connection 30-60s during network operator upgrades 4.17→4.18 (19 replies)
9. **Node network mapping dropdown missing** — two 4.21 environments, one missing the dropdown (16 replies)

### Feature/Enhancement Requests

10. **LLDP documentation removed** — customers asking why, no explanation given (14 replies)
11. **RFE request for new UI feature** — brainstorming doc being assembled (link in thread)
12. **kubevirtci replacement effort** — initiative to ditch kubevirtci dependency (8 replies)
13. **NMState operator not auto-installed in 4.22.0-rc.5** — regression? (10 replies)

### Jira Tickets to Track

- [OCPBUGS-87013](https://redhat.atlassian.net/browse/OCPBUGS-87013) — Physical networks page missing in 4.21
- [OCPBUGS-74261](https://redhat.atlassian.net/browse/OCPBUGS-74261) — NNCP liveness probe timeout
- [CNV-88481](https://redhat.atlassian.net/browse/CNV-88481) — Windows 11 golden image validation checkup UI
- [CNV-89455](https://redhat.atlassian.net/browse/CNV-89455) — Update self-validation golden image from Win 11 to Win Server 2022
- [CNV-82742](https://redhat.atlassian.net/browse/CNV-82742) — Planned for 4.23/5.0 (UI changes needed)

## Iteration 11 (Run 1/5)

**Date:** 2026-06-15
**Changes since last run:** Added Step 5 (local code research) with view module mapping table. Added Step 4 backport analysis with version coverage map. Added Code Context section to filing templates. Added Backport Suggestions section to report. Updated step count from 6 to 7.
**Results:** 311 messages fetched (4 channels), 152 threads, 27 UI-relevant threads (18% filter rate), 2 Needs Filing candidates, 1 Backport Suggestion (OCPBUGS-87013 → 4.21).
**Issues found:**

1. **False positive: custom logos thread included** — Thread #6 (43 replies, #forum-ocp-console) about custom logos breaking NetObserv is a console-operator issue, not networking-console-plugin. Included because it mentions `networking-console-plugin` as a pre-registered plugin, but the bug is in the console operator's logo validation.
2. **NF-1 component routing may be wrong** — "Node network mapping dropdown missing" was routed to nmstate-console-plugin, but the "Create Virtual Machine Network" wizard might live in networking-console-plugin's NAD creation flow. The view module mapping table doesn't have an explicit entry for "Virtual Machine Networks / Create VM Network wizard" — it's unclear whether this is in `nads/` (networking-console-plugin) or `physical-networks/` (nmstate-console-plugin).
3. **Missing threads from Jira search** — The agent didn't surface OCPBUGS-87865 (nmstate-console-plugin TLS cert expiry), OCPBUGS-85606 (React error #31 MultiNetworkPolicy), OCPBUGS-86249 (Services edit pod selector blank page), OCPBUGS-86519 (nmstate nginx memory leak), OCPBUGS-83752 (NNCP single interface next button disabled). These are open bugs in the component but weren't discussed in Slack — the agent only processes Slack threads, not standalone Jira search results.
4. **Rovo search noise** — Jira Rovo search returned Google Summer of Code confluence pages as top results. JQL was more effective.
5. **Severity criteria already in spec but agent didn't cite them** — The spec defines HIGH (>20 replies or customer-facing), MEDIUM (5-20 replies), LOW (<5 replies) at line 228, but the agent's suggestion #5 claims they're missing.
6. **Code Context quality varies** — NF-1 Code Context pointed to `src/views/physical-networks/` with generic file names, NF-2 pointed to `src/views/nads/` correctly. Code research was surface-level — no git log output or feature flag results included.

**Next:**

- Add explicit entry for "Virtual Machine Networks / Create VM Network wizard" to the view module mapping table (clarify which repo owns it) ✅ Done
- Add instruction to EXCLUDE threads that mention networking-console-plugin only incidentally ✅ Done
- Add standalone Jira bug surfacing — "Open Bugs (no Slack activity)" section ✅ Done
- Strengthen Code Context instructions — require actual command output ✅ Done

## Iteration 12 (Run 2/5)

**Date:** 2026-06-15
**Changes since last run:** (a) Added EXCLUDE rule for incidental plugin mentions. (b) Added "Virtual Machine Networks / Create VM Network wizard" to view module mapping table → networking-console-plugin src/views/nads/. (c) Strengthened Code Context to require actual git log and grep output. (d) Added "Standalone Jira Bug Scan" for open bugs not discussed in Slack.
**Results:** 311 messages, 152 threads, 15 UI-relevant (down from 27 — tighter filter), 2 Needs Filing, 14 open bugs (no Slack activity), 0 Backport Suggestions.
**Improvements confirmed:**

1. ✅ **False positive eliminated** — custom logos thread (43 replies) correctly excluded by the incidental-mention rule
2. ✅ **Component routing fixed** — both NF-1 and NF-2 correctly target networking-console-plugin (not nmstate-console-plugin)
3. ✅ **Code Context has real output** — filing templates include actual git log commits (`1bf4df7`, `77e630d`) and real feature flags (`FLAG_NET_ATTACH_DEF`, `FLAG_KUBEVIRT`)
4. ✅ **Open Bugs section works** — 14 open bugs surfaced (7 per component), including Critical CVE OCPBUGS-87092 and Major LLDP crash OCPBUGS-87822
5. ✅ **Report structure much improved** — clear sections, clickable links, severity tags, triage context

**Issues found:**

1. **Thread #3 (VMs lose connection during upgrades) included but shouldn't be** — this is a backend networking issue during OCP upgrades, not a console UI bug. The thread was included as "Customer-Reported UI Problems" but the agent's own triage notes say "not a UI bug" — contradictory inclusion.
2. **Thread #CNV-87617 too vague** — "A user asks for an update on CNV-87617" with no description of what the bug is. The filing template should require at least a 1-sentence summary of the Jira issue, not just "update requested."
3. **CNV-88481 and CNV-89455 are kubevirt-plugin issues, not networking** — these are about the self-validation checkup golden image UI, which lives in kubevirt-plugin, not networking-console-plugin or nmstate-console-plugin. They should be excluded unless the feature request specifically involves the networking plugin.
4. **Backport analysis didn't fire** — OCPBUGS-87013 is Verified and covers 4.21.z, so no gap was detected. But the earlier Slack thread (Run 1) noted QA couldn't verify because no image existed — the backport analysis should have flagged the ART build gap.
5. **No "networking-console-plugin registration" thread** — the 10-reply thread about how networking-console-plugin gets registered (OpenShift 5.0 / netobserv) was not included. It's borderline but informative for the team.
6. **Report could use a "Recent PRs" section** — the previous manual run included a merged PRs table from GitHub. The agent spec doesn't require it but it adds useful context.

**Next:**

- Tighten Customer-Reported UI Problems to exclude purely backend networking issues (upgrades, OVN) ✅ Done
- Exclude CNV UI issues targeting kubevirt-plugin ✅ Done
- Add instruction for 1-sentence Jira summary when referencing trackers ✅ Done

## Iteration 13 (Run 3/5)

**Date:** 2026-06-15
**Changes since last run:** (a) Added EXCLUDE rules for backend OCP upgrade connectivity issues and kubevirt-plugin features. (b) Added instruction to include 1-sentence Jira summary via getJiraIssue when thread only references a key.
**Results:** 311 messages, 152 threads, 14 UI-relevant (down from 15 — tighter filter). 2 Needs Filing, 13 open bugs (no Slack), 0 Backport Suggestions.
**Improvements confirmed:**

1. ✅ **CNV-87617 excluded** — fetched Jira summary ("Stats collection causes lock contention during live migration") → not networking UI → correctly filtered
2. ✅ **CNV-88481/89455 excluded** — kubevirt-plugin feature, not networking plugin
3. ✅ **VM connectivity loss during upgrades excluded** — backend networking issue, not UI
4. ✅ **Jira summaries enriched** — OCPBUGS-49690 now shows "networking-console-plugin pods should run on control plane nodes" instead of just "update on KEY"
5. ✅ **NF-2 Code Context improved** — includes hypothesis about FLAG_KUBEVIRT explaining environment-specific behavior: "if FLAG_KUBEVIRT is not detected, the Virtual Machine Networks page is hidden entirely"
6. ✅ **Report very clean** — 14 threads, well-organized, all links clickable, severity consistent

**Issues found:**

1. **Thread #12 (RBAC security audit) still included as INFO** — borderline. It's backend RBAC, not UI, but shared in #kubernetes-nmstate. The agent correctly tagged it `INFO` and noted "No UI action required unless RBAC changes affect plugin permissions." This is acceptable as-is.
2. **Thread #9 (nightly e2e failures) is CI infrastructure** — 74 replies about COPR repo missing for epel-9-aarch64. This is CI, not UI. The EXCLUDE rule says "CI infrastructure with no UI test component" — the agent included it because it affects merge velocity which indirectly impacts the plugin. Borderline but reasonable given the 74-reply engagement.
3. **Open Bugs section lists OCPBUGS-82108 (i18n strings)** — very minor UI polish issue. Could be filtered by priority to keep the section focused on impactful bugs.
4. **UDN docs thread (#14 in previous run, now absent?)** — the 60-reply UDN docs thread appears to be categorized under NMState-Specific but it's actually about OCP Virt docs. The category is debatable but the content is correct.
5. **No "Recent PRs" section** — the agent doesn't produce it because it's not in the spec. This would be a nice addition.

**Assessment:** The report quality is now very good. The filter is tight, false positives are eliminated, and the Code Context is actionable. Two minor improvements remain: (1) add a "Recent PRs" section, (2) consider filtering the Open Bugs section by priority (exclude Undefined/Low).

**Next:**

- Add "Recent PRs" section to the report template ✅ Done

## Iteration 14 (Run 4/5)

**Date:** 2026-06-15
**Changes since last run:** Added "Recent networking-console-plugin PRs" section to report template with Merged PRs and Open PRs tables.
**Results:** 312 messages, ~100 threads categorized, 14 UI-relevant. 3 Needs Filing (2 bugs + 1 feature), 13 open bugs (no Slack), 12 merged PRs, 3 open PRs. 0 Backport Suggestions.
**Improvements confirmed:**

1. ✅ **Recent PRs section generated** — 12 merged PRs with Jira links, 3 open PRs. Well-formatted tables with correct GitHub and Jira links.
2. ✅ **All previous EXCLUDE rules held** — CNV kubevirt-plugin features excluded, incidental mentions excluded, upgrade connectivity excluded.
3. ✅ **Report is comprehensive** — covers Slack threads, Jira bugs, GitHub PRs, and filing templates with Code Context.

**Issues found:**

1. **NF-3 is a dedup miss** — the OVS bridge + CUDN + EgressIP feature request (29 replies) was classified as "Needs Filing" despite CONSOLE-5348, CNV-89500, CONSOLE-5349, and HPUX-1719 already covering this exact request. The Jira dedup in Step 4 failed because: (a) the JQL search for feature requests targets CNV project but the existing tickets are in CONSOLE project, and (b) Rovo search was skipped to avoid noise. **Fix: the Rovo search should NOT be skipped — it caught CONSOLE-5348 in Run 1. Instead, add instruction to always run Rovo search as secondary, and filter out Confluence noise (only consider results with type "issue").**
2. **Code Context was shallow** — the agent reported "No sibling repos available" despite `../networking-console-plugin` and `../nmstate-console-plugin` existing at `/home/rlavi/Projects/`. The agent may have used a relative path from a different working directory, or failed to check the absolute path. **Fix: add explicit absolute path instruction to Step 5.**
3. **GitHub MCP sort issue** — `mcp__github__list_pull_requests` with `sort: updated` returned old PRs. The agent worked around with `gh` CLI. The spec should document this workaround.

**Next:**

- Fix Rovo search: always run it, filter to type=issue only ✅ Done
- Add absolute path guidance to Step 5 for sibling repos ✅ Done
- Document `gh` CLI fallback for PR fetching ✅ Done

## Iteration 15 (Run 5/5 — Final)

**Date:** 2026-06-15
**Changes since last run:** (a) Made Rovo search mandatory with type=issue filter. (b) Added absolute path fallback for sibling repos in Step 5. (c) Added `gh` CLI fallback for PR fetching.
**Results:** 312 messages, 12 UI-relevant threads. 2 Needs Filing, 13 open bugs (no Slack), 10 merged PRs, 3 open PRs, 0 Backport Suggestions.
**All 3 Run 4 fixes confirmed:**

1. ✅ **OVS bridge dedup FIXED** — Rovo search found CONSOLE-5348, CNV-89500, CONSOLE-5349, HPUX-1719. Thread moved from "Needs Filing" to "Feature Requests" as TRACKING. This was the primary dedup miss from Run 4.
2. ✅ **Code Context uses real output** — sibling repo found via absolute path `/home/rlavi/Projects/networking-console-plugin`. Filing templates include actual `git log` output and feature flag grep results.
3. ✅ **PR fetching via MCP tool worked** — returned current data with most recent PR merged 2026-06-15.

**Remaining minor issues (acceptable):**

1. Rovo search Confluence noise — filtered correctly by type=issue but wastes API quota. Not fixable without server-side filtering.
2. nmstate-console-plugin sibling repo not tested this run (no NMState NF candidates).
3. Open Bugs section includes low-priority ART/i18n tickets — could add priority filtering for focus.

## Summary of All Iterations (11-15)

### Fixes Applied Across 5 Runs

| Run | Issues Found                                                                                          | Fixes Applied                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | False positive (custom logos), wrong component routing, shallow Code Context, no standalone Jira scan | +EXCLUDE incidental mentions, +view module table entry, +require actual command output, +standalone Jira bug scan |
| 2   | Backend upgrade thread included, CNV kubevirt-plugin features included, vague Jira references         | +EXCLUDE backend upgrades, +EXCLUDE kubevirt-plugin features, +require 1-sentence Jira summary                    |
| 3   | No Recent PRs section                                                                                 | +Recent PRs section in report template                                                                            |
| 4   | OVS feature request dedup miss, shallow Code Context (no sibling repo), GitHub MCP sort issue         | +mandatory Rovo search with type=issue filter, +absolute path for sibling repos, +gh CLI fallback                 |
| 5   | Clean run — all fixes confirmed                                                                       | None needed                                                                                                       |

### Report Quality Progression

| Metric                | Run 1   | Run 2   | Run 3 | Run 4                 | Run 5       |
| --------------------- | ------- | ------- | ----- | --------------------- | ----------- |
| UI-relevant threads   | 27      | 15      | 14    | 14                    | 12          |
| False positives       | 3       | 1       | 0     | 1 (dedup miss)        | 0           |
| Needs Filing accuracy | 2/2     | 2/2     | 2/2   | 2/3 (1 was duplicate) | 2/2         |
| Code Context quality  | Guessed | Partial | Good  | Missed (no repo)      | Real output |
| Recent PRs            | ❌      | ❌      | ❌    | ✅ 12+3               | ✅ 10+3     |
| Open Bugs (no Slack)  | ❌      | ✅ 14   | ✅ 13 | ✅ 13                 | ✅ 13       |

### Final Agent Spec Quality Assessment

The agent spec is now mature. Key strengths:

- **Tight UI-relevance filter** — 7 EXCLUDE rules eliminate backend networking, CI, kubevirt-plugin, and incidental mentions
- **Reliable Jira dedup** — JQL + mandatory Rovo search (filtered to issues) catches tickets across projects
- **Rich filing templates** — Code Context with actual git log, feature flags, and GitHub links
- **Comprehensive report** — Slack threads + Jira bugs + GitHub PRs + filing templates in a single actionable document
- **Backport analysis** — version coverage map with gap detection (not triggered in these runs but implemented)
- [CNV-87617](https://redhat.atlassian.net/browse/CNV-87617) — Bug update requested
- [CNV-86150](https://redhat.atlassian.net/browse/CNV-86150) — CVE-2026-7374 fix version unclear

**Issues remaining:**

1. customer-networking still too broad — 48 messages include non-networking virt questions
2. 75 uncategorized messages — some are networking-relevant (netapp nvme, Network Observability Operator, DNS upstream servers)
3. Report would benefit from an executive summary at the top

## Iterations 11-30 (Final Polish)

**Date:** 2026-06-12
**Changes:** (a) Added Executive Summary section at top of report with CI health, bug count, hot threads ranked by reply count. (b) Improved Slack markup cleaning in previews — `<#channel>`, `<url|text>` → markdown. (c) Final lint/format/test pass — all clean.
**Final results:** 190 messages. bugs-and-issues=7, nmstate=19, network-ui=22, e2e-and-ci=15 (3 after streak consolidation), feature-requests=4, customer-networking=48, uncategorized=75. Categorized=61%.
**Verification:** ESLint clean, Prettier clean, 3/3 tests passing.

---

## Final Report Quality Assessment

### What the report does well

- Executive summary gives a 10-second read of the state of things
- Jira tickets and GitHub PRs extracted as clickable links
- E2e failure streaks consolidated (13 failures → 1 line)
- Threads sorted by engagement (reply count) surface the important discussions
- Category priority ordering puts bugs and nmstate first
- Per-channel source attribution tells you where each topic originated
- Weekly activity histogram shows volume trends

### Known limitations

- 39% of messages remain uncategorized — mostly general OpenShift Virt support questions not networking-specific
- customer-networking is broad — captures all "customer" mentions, not just networking-related
- Reply counts come from thread parents only (would need conversations.replies API for full thread data)
- Keyword matching is exact substring — "bridge" matches "Cambridge", "NIC" matches "Munich"

### Recommendations for future improvement

1. Add word-boundary matching to reduce false positives
2. Use conversations.replies API to fetch full thread content for better categorization
3. Add a "stale threads" section for unanswered questions older than 7 days
4. Consider adding more channels: #forum-ocp-networking, #forum-sdn, #team-cnv-networking
