---
name: feedback_version_mapping
description: OCPBUGS requires Affects versions on every Bug; CNV versions must be mapped via config.versionMapping.cnvToOcpbugsId; CNV version numbers match OCP version numbers exactly
metadata:
  type: feedback
---

OCPBUGS enforces "Affects versions" as a required field at move time, even though the fields API reports it as `isRequired: false`. Without an explicit version in `targetMandatoryFields`, all moves fail with "Affects versions is required."

**Why:** CNV version names like "CNV v4.21.0" do not exist in OCPBUGS. With `inferFieldDefaults: true`, Jira tries to retain the source value but it's invalid in the target, causing failure. Must use `inferFieldDefaults: false` and supply the mapped OCPBUGS version ID.

**How to apply:**

1. During Step 2 fetch, always request `versions` and `fixVersions` fields.
2. For each ticket: take `versions[0].name` if non-empty, else fall back to `fixVersions[0].name`.
3. Look up in `config.versionMapping.cnvToOcpbugsId` to get the OCPBUGS version ID.
4. Group tickets by resolved version ID; one bulk move call per group.

**Version mapping rule:** CNV versions map 1:1 to OCP versions — just strip the "CNV v" prefix. "CNV v4.21.0" → "4.21.0" (OCPBUGS version ID 21757). "CNV v5.0.0" → "5.0.0" (ID 104855). The full mapping is in `agents/jira-move-cnv2networking/data/config.json` under `versionMapping.cnvToOcpbugsId`.
