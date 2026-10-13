# jira-move-cnv2networking

Move CNV project networking tickets to the correct target projects: Bugs → OCPBUGS, Feature Requests → RFE project.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for root CLI reads, approved component updates, and the existing bulk-move/task-polling REST calls.
- **Private config** — `jira.cloud_id` is the Jira DNS hostname (not a URL or cloud UUID), with target projects/components and version mappings configured.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. No Jira MCP server is required. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/jira-move-cnv2networking
```

### Cursor

In Cursor chat, mention `@jira-move-cnv2networking` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual (scripts)

```bash
# After the agent has saved tickets.csv:
npm run jira-move-cnv2networking:generate

# Run tests:
npm run jira-move-cnv2networking:test
```

## How It Works

1. Reads `data/config.json` for source JQL and target project/component settings
2. Runs `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql '{source.jql}' --fields summary,description,issuetype,status,assignee,priority,components,labels,versions,fixVersions,created,updated`; pagination is internal and descriptions are normalized text
3. Adapts `{issues:[...]}` to the existing classifier envelope `{issues:{nodes:[{id,key,fields}]}}` in the private cache, preserving numeric IDs and native fields
4. Classifies with the existing ordered gates and configured keywords:
   - **Bug** → proposed OCPBUGS component `Networking / nmstate-console-plugin` or `Networking / networking-console-plugin`, based on ownership evidence
   - **Feature Request** → proposed RFE components from `targets.rfes.nmstateComponents` or `targets.rfes.networkingComponents`
   - Unclassified tickets stay in CNV; exclusions, in-flight tickets, conflicts, and description-only matches retain their skip/review flags
5. Checks possible RFE duplicates using the root CLI's `search --fields summary,status --limit 3`, then saves the existing `data/cache/tickets.csv` and runs `generate-preview.ts`
6. Displays the complete preview and waits for explicit confirmation; flagged tickets require explicit selection
7. Uses the existing REST bulk-move operations grouped by resolved version ID, polling each task to completion before the next group; there is no clone+link fallback
8. Looks up each confirmed moved ticket by numeric ID with `issue --fields summary,project`, then sequentially applies approved components with `set-components --components-json '[{"name":"approved component"}]' --approved`
9. Reports moved, failed, and skipped outcomes; a component failure records `moved` with a warning, not a rollback

Use safely quoted configured values and literal JQL; do not limit source collection or add manual page loops. `npm run jira:rest -- ...` is an alternative root CLI entrypoint. Required reads must exit 0: on exit 1, display the safe diagnostic and STOP before further processing. A post-move lookup failure still reports the already confirmed move by numeric ID with a warning. `--approved` is a mechanical guard, not a substitute for the preview's user confirmation.

## Configuration

Edit `data/config.json` to customize:

- `source.jql` — the JQL that finds tickets to migrate
- `source.bugKeywords.nmstate` — keywords that route a bug to `nmstate-console-plugin`
- `targets.bugs.project` — target project for bugs (default: `OCPBUGS`)
- `targets.rfes.project` — target project for Feature Requests (set this before first use)
- `targets.rfes.nmstateComponents` / `targets.rfes.networkingComponents` — approved component sets for each Feature Request route

## File Layout

```
agents/jira-move-cnv2networking/
├── README.md
├── tsconfig.json
├── data/
│   ├── config.json
│   ├── cache/          # tickets.csv (gitignored)
│   └── output/         # preview.md (gitignored)
└── scripts/
    ├── generate-preview.ts
    └── generate-preview.test.ts
```

> Cache and output directories are gitignored via the repo-level `.gitignore`.
