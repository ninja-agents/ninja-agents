# Jira QE Story Generator

Generate a QE (Quality Engineering) story from a dev Jira story with acceptance criteria and test scenarios, then create it in Jira and link it to the original.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for root CLI reads.
- **Existing QE writer** — uses `JIRA_API_TOKEN` with `jira.user_email` from private `data/qe-config.json` for approved creation/update, linking, and comments.
- **GitHub MCP** (optional) — the sole project MCP server, for GitHub repository context and PR diffs.
- **GitLab REST context** (optional) — select the repository from `--repo` or `projects[]`; use `gitlab.api_url` from private config or `GITLAB_API_URL`, an HTTPS API base ending in `/api/v4`. Set `GITLAB_PAT` in the environment if access requires it; public unauthenticated reads are allowed.

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. No Jira or GitLab MCP server is required. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/jira-qe-story PROJ-12345
/jira-qe-story PROJ-5678 --repo org/your-repo
/jira-qe-story PROJ-12345 --project BUGS --assignee 712020:abc123
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
2. Reads the dev story through `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' issue --key '{issue_key}' --fields summary,description,status,issuetype,priority,assignee,labels,components,customfield_10020,customfield_10028,customfield_10470`; saves the native `{key,fields}` as `data/cache/dev-story.json`, with description text/URLs normalized
3. Reads Jira `remote-links` for PR references, then optionally collects GitHub context/diffs, local repository evidence, or GitLab README/MRs/full tree via `node --import tsx scripts/gitlab-read.ts qe-context --project '{selected_project_id}' --issue-key '{issue_key}' [--api-url '{gitlab.api_url}']`; keeps `repo-context.md` and `pr-diff.md` as separate evidence summaries
4. Generates QE story content: description, acceptance criteria, test scenarios
5. Runs the preview formatter script to validate and display the draft
6. Waits for explicit user approval (approve / edit / abort)
7. Uses the existing `create-jira-issue.ts` REST writer and `qe-story-draft.json` to create/update the approved QE story, retain its Cloners link behavior, and post automation suggestions
8. Displays the created issue key with a clickable Jira link

`--site` comes from the configured DNS hostname `jira.cloud_id`, never a URL or cloud UUID; quote resolved arguments safely. `npm run jira:rest -- ...` and `npm run gitlab:read -- ...` are alternative root CLI entrypoints. The commands paginate internally; do not add a second collector or manual page loops. Any required Jira read failure exits 1 and STOPs before content generation or approval.

GitLab enrichment is optional: exit 0 returns `{context:{readme,merge_requests,tree},warnings:[]}`; exit 3 returns `{context:null,warnings:[safeCode]}`. Display and record that warning, then proceed without GitLab enrichment, never with fabricated or partial context. Omit `--api-url` to use `GITLAB_API_URL`; do not switch hosts/repositories on failure. GitHub/local enrichment failures also remain best-effort. The draft preview and explicit approve/edit/abort gate remain mandatory before the existing writer runs.

## Configuration

Copy `data/qe-config.example.json` to `data/qe-config.json` and fill in your team's values:

- `jira.user_email` — your Jira email (used with `JIRA_API_TOKEN` for REST API auth)
- `jira.cloud_id` — DNS hostname used for root CLI reads with environment-only `JIRA_EMAIL` / `JIRA_API_TOKEN`
- `gitlab.api_url` — optional HTTPS `/api/v4` base; falls back to `GITLAB_API_URL` when empty or absent
- `defaults.target_project_key` — Jira project for the QE story (e.g., "PROJ")
- `defaults.labels` — default labels applied to QE stories
- `qe_engineers` — array of `{ name, jira_account_id }` for resolving `--assignee` by name
- `projects` — array mapping Jira prefixes to repos for auto-resolution

`--project`, `--assignee`, and `--repo` override the corresponding selections. The `--assignee` flag accepts a name (e.g., `--assignee Alice`) matched against `qe_engineers`; credentials are never CLI overrides.

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
