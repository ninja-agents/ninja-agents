# Jira QE Story Generator

Generate a QE (Quality Engineering) story from a dev Jira story with acceptance criteria and test scenarios, then create it in Jira and link it to the original.

## Prerequisites

- **Atlassian Rovo MCP** — for reading dev stories from Jira
- **JIRA_API_TOKEN** — for creating QE stories via the Jira REST API (the Rovo MCP does not support issue creation for all projects). Get one from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- **GitHub MCP** (optional) — for reading repo context from github.com
- **GitLab MCP** (optional) — for reading repo context from gitlab.cee.redhat.com

Tokens must be set as environment variables before launching Claude Code:

```bash
export JIRA_API_TOKEN=ATATT3x...
```

## Usage

### Claude Code

```bash
/jira-qe-story CNV-12345
/jira-qe-story MTV-5678 --repo kubev2v/forklift-console-plugin
/jira-qe-story CNV-12345 --project OCPBUGS --assignee 712020:abc123
```

### Cursor

In Cursor chat, mention `@jira-qe-story` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

Run the preview formatter directly:

```bash
npm run jira-qe-story:preview
```

## How It Works

1. Reads config from `data/qe-config.json` and parses CLI arguments
2. Fetches the dev story from Jira (summary, description, priority, labels, etc.)
3. Optionally fetches repo context (README, related PRs/MRs) for richer acceptance criteria
4. Generates QE story content: description, acceptance criteria, test scenarios
5. Runs the preview formatter script to validate and display the draft
6. Waits for explicit user approval (approve / edit / abort)
7. Creates the QE story in Jira and links it to the dev story via a Clones link
8. Displays the created issue key with a clickable Jira link

## Configuration

Copy `data/qe-config.example.json` to `data/qe-config.json` and fill in your team's values:

- `jira.user_email` — your Jira email (used with `JIRA_API_TOKEN` for REST API auth)
- `defaults.target_project_key` — Jira project for the QE story (e.g., "CNV")
- `defaults.labels` — default labels applied to QE stories
- `qe_engineers` — array of `{ name, jira_account_id }` for resolving `--assignee` by name
- `projects` — array mapping Jira prefixes to repos for auto-resolution

All config values can be overridden via CLI arguments (`--project`, `--assignee`, `--repo`). The `--assignee` flag accepts a name (e.g., `--assignee Leon`) which is matched against the `qe_engineers` list.

## File Layout

```
agents/jira-qe-story/
├── README.md
├── scripts/
│   ├── format-qe-preview.ts       # Preview formatter and validator
│   ├── format-qe-preview.test.ts  # Preview tests
│   ├── create-jira-issue.ts       # Jira REST API issue creation
│   └── create-jira-issue.test.ts  # Creation tests
└── data/
    ├── qe-config.json              # Agent configuration (gitignored)
    ├── qe-config.example.json      # Example config (committed)
    ├── cache/                      # Temporary data (gitignored)
    └── output/                     # Not used by this agent (gitignored)
```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
