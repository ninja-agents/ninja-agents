# jira-fix-version

Finds resolved Jira tickets (bugs and stories) missing a `fixVersions` field, traces their linked GitHub PRs — and for tickets that link to GitHub issues, finds the PR that closes each issue — to determine which branch each fix landed on, maps `(repo, branch)` → Jira fix version from a config table, and sets `fixVersions` after user confirmation.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for both root CLI reads and approved writes.
- **GitHub MCP** — the sole project MCP server, used for PR details.
- **GitHub API token** — `GITHUB_PAT` for the existing GraphQL issue-to-PR resolver.
- **Private config** — `jira.cloud_id` is the Jira DNS hostname (not a URL or cloud UUID).

Set credentials before launching your IDE; never pass secrets in command arguments or store tokens in config/cache/output. See the [setup guide](../../docs/mcp-setup.md).

## Usage

```
/jira-fix-version
```

Or trigger with: "set fix version", "bugs missing fix version", "stories missing fix version", "assign fix version"

## How It Works

1. Reads `data/config.json` for the JQL filter and branch-to-version mapping
2. Runs `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search --jql '{source.jql}' --fields summary,status,assignee,issuetype,description,resolutiondate`; internal pagination returns every matching ticket
3. Runs the same CLI's `remote-links --key '{key}'` for each ticket; combines each native link's `object.url` with URLs in normalized description text to find GitHub PR and issue references
4. For each linked GitHub issue, searches for the merged PR that closes it
5. Checks each PR's merge status and target branch (`base.ref`) in parallel
6. Maps `(repo, branch)` → Jira fix version from `branchToFixVersion` config
7. Classifies each ticket as `proposed` / `needs_review` / `skipped`
8. Generates a preview `.md` with Jira hyperlinks for all tickets
9. Waits for explicit user approval before making any changes
10. Sequentially runs the root CLI's `set-fix-versions --key '{key}' --versions-json '[{"id":"12345"}]' --approved` for the approved set; all versions for a ticket go in one PUT, using `{name}` only for configured `TODO` IDs
11. Summarizes what was updated, failed, or skipped

Preserve the existing `issues.json`, resolved-PR JSON, and `tickets.csv` caches and preview generator. Approval may cover all proposed tickets, one fix-version group, or a selected subset. `--approved` is only a mechanical guard, never a replacement for that approval. Mutation failures are recorded per ticket and processing continues; required collection failures STOP before preview/approval. Quote resolved arguments safely, do not add manual pagination or a collection limit, and consume only exit-0 read JSON. `npm run jira:rest -- ...` is an alternative root CLI entrypoint.

## Configuration

Copy `data/config.example.json` to `data/config.json` and fill in the values.

### `branchToFixVersion`

Maps `"{owner}/{repo}"` → `"{branch}"` → `{ "id": "...", "name": "..." }`.

The `owner/repo` key must exactly match the `base.repo.full_name` field returned by the GitHub PR API (check with `gh pr view {number} --json baseRefName,baseRepository`).

The `id` is the Jira version's numeric ID. To find it:

1. Go to your Jira project → Project Settings → Versions
2. Click a version — the URL contains the version ID (e.g., `.../versions/12345`)

Set `"id": "TODO"` if the ID is unknown — the approved update uses the configured `name` instead.

Set both `"id": ""` and `"name": ""` to mark a branch as intentionally ignored (e.g., an experimental feature branch that has no Jira fix version). The agent silently skips these branches during classification.

### Cutover Warnings

When a release branch is renamed or a new version cycle starts, add an entry to `upcoming_changes` in your `config.json`:

```json
"upcoming_changes": [
  {
    "date": "2026-08-14",
    "description": "main branch switches from MTA 8.3.0 to MTA 8.4.0 — update branchToFixVersion"
  }
]
```

The agent displays a warning at Step 1 when the date is within 7 days (or up to 30 days past). Remove the entry once the config has been updated.

### Example

```json
{
  "jira": { "cloud_id": "your-site.atlassian.net" },
  "source": {
    "jql": "filter = YOUR_FILTER_ID AND statusCategory = Done AND type in (Bug, Story) AND resolution in (Done, Done-Errata) AND resolved >= -180d AND fixVersion is EMPTY"
  },
  "branchToFixVersion": {
    "konveyor/tackle2-ui": {
      "main": { "id": "12345", "name": "MTA 8.2.0" }
    },
    "openshift/networking-console-plugin": {
      "main": { "id": "67890", "name": "5.0.0" },
      "release-4.21": { "id": "67891", "name": "4.21.z" }
    }
  }
}
```

## Branch → Version Mapping Reference

Look up Jira version IDs at: Jira project → Project Settings → Versions → click a version (ID is in the URL).

| Branch      | Version | Jira ID |
| ----------- | ------- | ------- |
| `main`      | Next    | TODO    |
| `release-N` | N.x.z   | TODO    |

Add your real version IDs to `data/config.json` under `branchToFixVersion`.

## File Layout

```
agents/jira-fix-version/
  data/
    config.json          (gitignored — contains real version IDs)
    config.example.json  (committed — placeholder values)
    cache/               (gitignored — tickets.csv written during run)
    output/              (gitignored — preview.md written during run)
  scripts/
    generate-preview.ts  (CSV → markdown preview generator)
    generate-preview.test.ts
```
