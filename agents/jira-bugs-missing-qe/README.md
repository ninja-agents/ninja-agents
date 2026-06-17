# Jira Bugs Missing QE

Find resolved bug tickets missing a QA Contact, identify who verified each bug from comments and status transitions, and set the QA Contact field after user approval.

## Prerequisites

- **Atlassian Rovo MCP** — configured in `.mcp.json` for Jira access
- **JIRA_API_TOKEN** — env var for updating tickets via REST API (get from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens))
- Tokens must be set as environment variables before launching Claude Code.

## Usage

### Claude Code

```bash
/jira-bugs-missing-qe
```

### Cursor

In Cursor chat, mention `@jira-bugs-missing-qe` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

```bash
# Identify verifiers from cached data
npm run jira-bugs-missing-qe:identify -- --config agents/jira-bugs-missing-qe/data/config.json --cache agents/jira-bugs-missing-qe/data/cache --output agents/jira-bugs-missing-qe/data/output/verifier-preview.md

# Apply QA contacts (after reviewing the preview)
npm run jira-bugs-missing-qe:apply -- --config agents/jira-bugs-missing-qe/data/config.json --cache agents/jira-bugs-missing-qe/data/cache

# Dry run (no changes)
npm run jira-bugs-missing-qe:apply -- --dry-run
```

## How It Works

1. **Read config** — loads JQL filter, detection keywords, and field IDs from `data/config.json`
2. **Fetch bugs** — queries Jira for resolved bugs with empty QA Contact, including comments
3. **Fetch changelogs** — gets status transition history for each bug via individual API calls
4. **Save to cache** — writes structured JSON with comments and changelog data
5. **Identify verifiers** — script scans comments for keywords ("verified", "tested") and changelog for status transitions (to "Verified", "ON_QA")
6. **Preview** — displays proposed QA Contact assignments with evidence for user review
7. **Apply** — sets the QA Contact field on approved tickets via Jira REST API

## Configuration

Edit `data/config.json` to customize:

- `jira.jql` — the JQL filter for finding bugs missing QA Contact
- `detection.comment_keywords` — keywords that indicate someone verified a bug
- `detection.transition_statuses` — status names that indicate QE verification

## File Layout

```
agents/jira-bugs-missing-qe/
├── README.md
├── tsconfig.json
├── scripts/
│   ├── identify-verifiers.ts
│   ├── identify-verifiers.test.ts
│   └── apply-qa-contacts.ts
└── data/
    ├── config.json
    ├── cache/            # temporary data (gitignored)
    └── output/           # generated output (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
