# jira-move-cnv2networking

Move CNV project networking tickets to the correct target projects: Bugs → OCPBUGS, Feature Requests → RFE project.

## Prerequisites

- Atlassian Rovo MCP connected to `redhat.atlassian.net`
- Tokens must be set as environment variables before launching Claude Code

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
2. Fetches CNV tickets matching `component in ("CNV User Interface", "CNV User Experience")` that are not Done
3. Classifies each ticket:
   - **Bug** → OCPBUGS; NNCP/NMState keywords → `Networking / nmstate-console-plugin`, otherwise `Networking / networking-console-plugin`
   - **Feature Request** → RFE project, component `Network - Core`
4. Saves classified tickets to `data/cache/tickets.csv`
5. Runs `generate-preview.ts` to build a markdown preview table
6. Displays the preview and asks for confirmation
7. Applies moves sequentially (Jira REST PUT, with clone+link fallback)
8. Reports outcomes

## Configuration

Edit `data/config.json` to customize:

- `source.jql` — the JQL that finds tickets to migrate
- `source.bugKeywords.nmstate` — keywords that route a bug to `nmstate-console-plugin`
- `targets.bugs.project` — target project for bugs (default: `OCPBUGS`)
- `targets.rfes.project` — target project for Feature Requests (set this before first use)
- `targets.rfes.component` — target component for Feature Requests (default: `Network - Core`)

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
