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
