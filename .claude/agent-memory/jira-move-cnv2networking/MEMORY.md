# Agent Memory — jira-move-cnv2networking

- [Bulk Move API — only working move mechanism](feedback_bulk_move_api.md) — editJiraIssue silently fails for cross-project moves; use POST /rest/api/3/bulk/issues/move via curl; confirmed working request format with all gotchas documented
- [Version mapping — OCPBUGS requires Affects versions](feedback_version_mapping.md) — inferFieldDefaults must be false; map CNV version names via config.versionMapping.cnvToOcpbugsId; CNV vX.Y.Z = OCP X.Y.Z (strip "CNV v" prefix)
