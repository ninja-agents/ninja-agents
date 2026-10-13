# Jira Bugs Missing QE

Find resolved bug tickets missing a QA Contact, identify who verified each bug from comments and status transitions, and set the QA Contact field after user approval.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for root CLI reads.
- **Private config** — `jira.cloud_id` is the Jira DNS hostname; the existing QA-contact/comment writer additionally uses `jira.user_email` from `data/config.json` with `JIRA_API_TOKEN`.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. No Jira MCP server is required. See the [setup guide](../../docs/mcp-setup.md).

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
2. **Fetch bugs** — runs `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql '{jira.jql}' --fields summary` for every matching key, with internal pagination
3. **Fetch complete evidence** — for each key, runs the same CLI's `issue --key '{key}' --fields summary --comments --changelog` in batches of at most ten; it pages both history endpoints and normalizes comment bodies to text
4. **Save to cache** — preserves `data/cache/tickets-data.json` as `[{key,summary,comments,changelog}]`; comments retain display name/account ID/body/created, and changelogs flatten only status items with author/account ID/from/to/created
5. **Identify verifiers** — script scans comments for keywords ("verified", "tested") and changelog for status transitions (to "Verified", "ON_QA")
6. **Preview** — displays proposed QA Contact assignments with evidence for user review
7. **Apply** — the existing `apply-qa-contacts.ts` REST writer updates approved tickets and adds its existing assignment comments; unmatched tickets remain skipped

Substitute the configured DNS hostname (not a URL or cloud UUID) and literal JQL as safely quoted arguments. `npm run jira:rest -- ...` is an alternative root CLI entrypoint. Do not rely on truncated embedded comments or expanded history, add manual page loops, or limit ticket collection. Any required read failure exits 1: display its safe diagnostic and STOP before identification, preview, or approval; never consume partial evidence.

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
