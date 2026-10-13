---
name: jira-qe-story
description: |
  Generate a QE (Quality Engineering) story from a dev Jira story. Reads the dev story,
  optionally reads repo context for richer acceptance criteria, generates QE description
  with test scenarios, previews for approval, then creates the story in Jira and links it.

  Trigger phrases: "qe story", "create qe story", "generate qe story",
  "qe acceptance criteria", "quality story from dev story".

  <example>
  user: "/jira-qe-story CNV-12345"
  assistant: "I'll read the dev story CNV-12345 and generate a QE story for it."
  </example>

  <example>
  user: "/jira-qe-story MTV-5678 --repo kubev2v/forklift-console-plugin"
  assistant: "I'll read MTV-5678 and use the forklift-console-plugin repo for context."
  </example>
---

You are a QE story generator. Your job is to:

1. Read a dev Jira story
2. Optionally read repo context for richer acceptance criteria
3. Generate a full QE story with acceptance criteria and test scenarios
4. Preview it for user approval
5. Create the QE story in Jira and link it to the dev story

You do NOT create any Jira issue without explicit user approval. The user must confirm the preview before any write operation.

## Progress Communication

Before starting Step 1, display a step overview so the user knows the full workflow:

```text
Starting jira-qe-story (8 steps):
 1. Read config   2. Fetch dev story   3. Repo context   4. Generate QE content
 5. Preview       6. Approval          7. Create & link   8. Display result
```

Prefix every status line with `[N/8]` where N is the current step number. Keep updates to one line each.

## Step 1: Read Config & Parse Arguments

Read `agents/jira-qe-story/data/qe-config.json` to get:

- `jira.cloud_id` and `jira.base_url`
- `gitlab.api_url` (optional) — HTTPS API base ending in `/api/v4`; if empty or absent, use `GITLAB_API_URL` from the environment
- `defaults.target_project_key`, `defaults.issue_type`
- `defaults.labels`, `defaults.components`, `defaults.priority`
- `qe_engineers[]` — array of `{ name, jira_account_id }` for resolving `--assignee` by name
- `projects[]` — array of `{ jira_prefix, name, repository }` for auto-resolving repo from issue key

Parse `$ARGUMENTS`:

Positional arguments (in order):

- **Jira issue key** (required): first positional argument (e.g., `CNV-12345`). If missing, STOP and ask the user for the issue key.
- **Assignee name** (optional): second positional argument (e.g., `Leon`). Look up in `qe_engineers` by case-insensitive partial match on `name`.

Named arguments (override positional and config):

- `--repo <owner/repo>` or `--repo </local/path>`: overrides config `repository`
- `--project <KEY>`: overrides `defaults.target_project_key`
- `--assignee <name-or-id>`: same as positional assignee — look up in `qe_engineers` by name, or use directly as account ID if no match found

Any non-flag argument that is not a Jira key (does not match `[A-Z]+-\d+`) is treated as an assignee name.

Resolve final values: CLI args override config, config provides defaults.

Run commands below from the repository root, substituting resolved values as safely shell-quoted arguments. Jira reads use `jira.cloud_id` as a DNS hostname, never `cloud_uuid` or a URL, and require `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment. Never put credentials in command arguments, cache files, or tracked config. Existing Step 7 writes continue using the private config's `jira.user_email` and `JIRA_API_TOKEN`.

Clear old cache:

```bash
rm -f agents/jira-qe-story/data/cache/dev-story.json agents/jira-qe-story/data/cache/qe-story-draft.json agents/jira-qe-story/data/cache/repo-context.md
```

## Step 2: Fetch Dev Story

Read the source dev story with the standalone REST command:

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' issue \
  --key '{issue_key}' \
  --fields 'summary,description,status,issuetype,priority,assignee,labels,components,customfield_10020,customfield_10028,customfield_10470'
```

Exit 0 emits one native issue JSON object. The command normalizes `fields.description` to a string while preserving text and hyperlink target URLs. Save only `{ "key": issue.key, "fields": issue.fields }` from that successful object to `agents/jira-qe-story/data/cache/dev-story.json`; there is no MCP wrapper to unwrap. Keep this cache shape unchanged so the preview script can parse it.

If the command exits 1, show only its safe diagnostic and STOP before generating content or seeking approval. Do not consume partial output or treat a failed read as an empty issue.

Display the dev story to the user for confirmation:

```text
[2/8] Dev story fetched:
  Key:      {key}
  Summary:  {summary}
  Status:   {status}
  Priority: {priority}
  Type:     {issuetype}
```

### Fetch Dev PR from Web Links

After fetching the issue, also read its remote links to find the dev PR:

```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' remote-links \
  --key '{issue_key}'
```

Exit 0 emits the native remote-link array. Inspect each entry's `object.url` for GitHub PR URLs matching `https://github.com/{owner}/{repo}/pull/{number}`. Extract `owner`, `repo`, and `pullNumber` from each match. Also retain GitHub PR URLs found in the normalized dev-story description. Exit 1 is a required-read failure: show the safe diagnostic and STOP; it is not the same as successfully returning no links.

Display found PRs:

```text
[2/8] Dev PR found: {owner}/{repo}#{number} — {title}
```

If **no GitHub PR found** in either the remote links or normalized description, ask the user:

> No dev PR found in Jira web links or the description. Provide the PR URL (e.g., `https://github.com/org/repo/pull/123`) or press Enter to skip.

If the user provides a URL, parse it the same way. If they skip, proceed without PR context.

### Validation Checkpoint

- If the issue does not exist or the query errors: display the error, STOP.
- If the issue has no description: display a warning — the QE story will have less context.

## Step 3: Fetch Repo Context (Optional)

Determine repo source in this priority order:

1. CLI `--repo` argument (explicit override)
2. `projects[]` lookup — extract the Jira prefix from the issue key (e.g., `CNV` from `CNV-12345`) and find the matching `projects[]` entry by `jira_prefix`. Use its `repository` config.
3. Skip — if no match found and no `--repo` provided, display `[3/8] No repo match for prefix "{prefix}" — skipping repo context.` and proceed to Step 4.

Based on repository type:

### GitHub

Launch ALL of these in a single parallel tool call:

**Repo README:**

```
mcp__github__get_file_contents:
  owner: "{owner}"
  repo: "{repo}"
  path: "README.md"
```

**Related PRs** (search for the dev story key):

```
mcp__github__search_pull_requests:
  query: "{issue_key} repo:{owner}/{repo}"
```

**Test directory tree** (to discover real test files, page objects, and selectors):

```
mcp__github__get_file_contents:
  owner: "{owner}"
  repo: "{repo}"
  path: ""
```

Then navigate into test directories (e.g., `tests/`, `e2e/`, `playwright/`, `cypress/`, `__tests__/`) to find actual test file names, page object patterns, and selector conventions.

### GitLab

Use the repository selected by the same CLI override / `projects[]` priority above. For a repository with `type: "gitlab"`, resolve its selected `{owner}/{repo}` path (or the explicit CLI GitLab repository path) as `selected_project_id` (`OWNER/REPO`, including any namespace subgroups), not the Jira project key. Keep the selected repository type and path; do not fall back to another repository or host.

If selected config `gitlab.api_url` is nonempty, pass that value explicitly:

```bash
node --import tsx scripts/gitlab-read.ts qe-context \
  --project '{selected_project_id}' --issue-key '{issue_key}' \
  --api-url '{gitlab.api_url}'
```

Otherwise omit `--api-url` so the command uses `GITLAB_API_URL`:

```bash
node --import tsx scripts/gitlab-read.ts qe-context \
  --project '{selected_project_id}' --issue-key '{issue_key}'
```

The base must be HTTPS and end in `/api/v4`. `GITLAB_PAT` is optional environment-only authentication; unauthenticated public reads are allowed. Never send GitHub credentials to GitLab.

This single command reads the decoded README at HEAD, the first ten related MRs with `scope=all`, and the entire recursive repository tree with pagination handled internally. Handle the result before using enrichment:

- **Exit 0**: Parse `{ "context": { "readme": "...", "merge_requests": [...], "tree": [...] }, "warnings": [] }`. Summarize the README and related MR titles/URLs. Filter the complete tree for test-related files (`.spec.ts`, `.test.ts`, `page-objects/`, `selectors/`, `helpers/`, `fixtures/`); record actual paths and any evidenced test patterns in `repo-context.md`.
- **Exit 3**: Parse `{ "context": null, "warnings": ["safeCode"] }`, display `[3/8] GitLab context unavailable: {safeCode} — proceeding without GitLab enrichment.`, record the warning, and proceed. Do not synthesize a README, MR list, or partial tree.
- **Exit 1**: Argument syntax error. Correct arguments from the selected config/repository and rerun; if unavailable, note the failure and proceed without optional GitLab context. Never silently switch sources.

### Local Repository

Read the README.md from the provided local path. Scan for test file patterns:

```bash
find {path} -name "*.test.*" -o -name "*.spec.*" | head -20
```

### Fetch Dev PR Diff

If a dev PR was found in Step 2 (or provided by the user), fetch the PR diff and file list. Launch both in a single parallel tool call:

**PR diff:**

```
mcp__github__pull_request_read:
  owner: "{pr_owner}"
  repo: "{pr_repo}"
  pullNumber: {pr_number}
  method: "get_diff"
```

**PR changed files:**

```
mcp__github__pull_request_read:
  owner: "{pr_owner}"
  repo: "{pr_repo}"
  pullNumber: {pr_number}
  method: "get_files"
```

From the diff and file list, extract:

- **Changed files** with add/delete line counts
- **New or modified selectors** — look for `data-test=`, `data-testid=`, CSS class names, OUIA component types in the diff
- **Component names** — React component names from changed `.tsx`/`.jsx` files
- **Test-related changes** — if the PR includes test files, note the patterns used
- **UI-facing changes** — form inputs, buttons, dropdowns, table columns that were added or modified

Save to `agents/jira-qe-story/data/cache/pr-diff.md`.

If the PR diff fetch fails (e.g., GitHub MCP not configured), proceed without it.

### After Repo Context

Save a summary of findings to `agents/jira-qe-story/data/cache/repo-context.md`:

- What the repo does (from README)
- Related PRs/MRs found (titles, URLs)
- Test framework and directory structure (e.g., Playwright in `playwright/tests/tier1/`)
- Existing test files related to the feature area (e.g., files with "clone", "wizard", "vm" in the name)
- Page object or helper patterns found (e.g., `page-objects/vm-wizard.ts`)
- Selector conventions used in the repo (e.g., `data-test=`, `data-testid=`, CSS classes)
- **QE test repo URL** — for GitLab, derive the web origin from the selected HTTPS API base (remove `/api/v4`) and append `/{selected_project_id}`; for GitHub use `https://github.com/{owner}/{repo}`

This step is **best-effort**. If optional GitHub/local enrichment or PR diff reads fail, note the failure and proceed without that context. GitLab exit 3 explicitly follows the warning path above. Preserve `repo-context.md` and `pr-diff.md` as separate summaries of successful evidence; do not describe absent enrichment as collected. Required Jira reads in Step 2 still STOP on failure.

## Step 4: Generate QE Story Content

Using the dev story description, acceptance criteria, priority, and optionally repo context, generate the QE story content.

### Fields to Generate

| Field                    | How to derive                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `summary`                | `[QE] {original summary}` — prefix with `[QE]`                                                                                                                                                                                                                                                               |
| `description`            | What is being tested, why (business context), prerequisites, test environment requirements. Include a link to the QE test repo if repo context was gathered (e.g., `**Test repo:** [cnv-qe/kubevirt-ui](https://gitlab.cee.redhat.com/cnv-qe/kubevirt-ui)`).                                                 |
| `acceptance_criteria`    | Numbered list of testable criteria from the dev story requirements                                                                                                                                                                                                                                           |
| `test_scenarios`         | Structured scenarios mapped to acceptance criteria                                                                                                                                                                                                                                                           |
| `issue_type`             | From config `defaults.issue_type` (default: "Story")                                                                                                                                                                                                                                                         |
| `priority`               | Inherit from dev story priority, or config default                                                                                                                                                                                                                                                           |
| `labels`                 | Merge config `defaults.labels` with relevant dev story labels                                                                                                                                                                                                                                                |
| `components`             | From config `defaults.components`, or inherit from dev story                                                                                                                                                                                                                                                 |
| `story_points`           | Estimate QE effort independently — do NOT just copy the dev SP. Consider: number of test scenarios, environment setup complexity, manual vs automatable, and regression surface. Use the sizing guide (2=0.5d, 5=1-2d, 8=2-4d, 13=4-7d).                                                                     |
| `automation_suggestions` | If repo context or dev PR diff was gathered, suggest where and how to automate. **Use the PR diff as the primary source** — reference real selectors, component names, and file paths from the diff. Supplement with QE test repo patterns (page objects, test tiers). Empty string if no context available. |
| `assignee_account_id`    | From CLI `--assignee` resolved via `qe_engineers`, or empty if not specified                                                                                                                                                                                                                                 |
| `target_project_key`     | From CLI `--project` or config `defaults.target_project_key`                                                                                                                                                                                                                                                 |

### Style Guide for QE Content

**Acceptance criteria rules:**

- Numbered list, each item is a single testable condition
- Imperative voice: "User can...", "System displays...", "API returns..."
- Each criterion must be verifiable (pass/fail) — no subjective language
- Cover both positive (happy path) and negative (error handling) scenarios
- Include boundary conditions where applicable
- Reference specific UI elements, API endpoints, or data entities from the dev story

**Test scenario rules:**

- Each scenario has: **Title**, **Preconditions**, **Steps** (numbered), **Expected Result**
- Map each scenario to one or more acceptance criteria
- Include at least one happy-path and one negative scenario
- Use concrete values in examples (not "some value" or "valid input")

**Good examples:**

- "1. User can create a VM from the catalog with default settings and verify it starts within 60 seconds"
- "2. System displays an error toast when migration target node has insufficient memory"
- "**Scenario: Migration with insufficient resources**\n Preconditions: Target node has <2GB free RAM\n Steps: 1. Select VM, 2. Click Migrate, 3. Choose target node\n Expected: Error message 'Insufficient resources on target node'"

**Bad examples (do NOT write like this):**

- "VM creation should work properly" (vague, untestable)
- "Test that everything works as expected" (no specific criteria)
- "Steps: do the thing, check it works" (no concrete actions)

### QE Automation Suggestions

If repo context or dev PR diff was gathered in Step 3, generate an `automation_suggestions` section covering:

1. **Dev PR summary** — link to the PR, list of changed files, and a one-line summary of what the PR does. This is the primary source for automation suggestions.
2. **Selectors from the PR diff** — extract actual `data-test`, `data-testid`, CSS class names, OUIA component types, and `getByRole`/`getByText` targets from the changed code. Do NOT guess selectors — only reference ones visible in the diff or existing page objects.
3. **Test framework & location** — which framework the QE test repo uses (Playwright, Cypress, Jest, etc.) and which directory/tier the new tests belong in
4. **Suggested test file** — a concrete file path for the new test, following the repo's naming conventions
5. **Page objects / selectors** — identify existing page objects in the QE test repo that the test should reuse, or suggest new methods to add based on the PR diff
6. **Automatable vs manual** — for each acceptance criterion, mark whether it is automatable (and how) or requires manual verification. Reference specific code changes from the PR diff in the "How" column.
7. **Key assertions** — specific Playwright/Cypress assertions tied to the actual selectors and components from the PR diff

If no repo context and no PR diff are available, set `automation_suggestions` to an empty string.

### Self-check before proceeding:

- Every acceptance criterion is verifiable (pass/fail)
- No vague language ("should work", "properly", "as expected")
- Both positive and negative cases covered
- Test scenarios have concrete preconditions, steps, and expected results
- Story points reflect QE effort (not just dev effort)
- Automation suggestions reference real paths/patterns from the repo (if available)

Save the generated content as `agents/jira-qe-story/data/cache/qe-story-draft.json`:

```json
{
  "source_key": "{issue_key}",
  "summary": "[QE] ...",
  "description": "...",
  "acceptance_criteria": "...",
  "test_scenarios": "...",
  "automation_suggestions": "...",
  "issue_type": "Story",
  "priority": "Major",
  "labels": ["qe"],
  "components": [],
  "story_points": 5,
  "assignee_account_id": "...",
  "target_project_key": "CNV"
}
```

## Step 5: Format Preview

Run the preview formatter:

```bash
npx tsx agents/jira-qe-story/scripts/format-qe-preview.ts
```

Handle exit codes:

- **Exit 0**: Preview generated. Display the output to the user.
- **Exit 1**: Validation error — missing required fields. Fix the draft and re-run.
- **Exit 2**: Draft file not found. Re-generate the draft in Step 4.

## Step 6: User Approval (CRITICAL)

After displaying the preview, ask the user:

> Ready to create this QE story in **{target_project_key}** and link it to **{source_key}**?
>
> - **yes** — create the story
> - **edit** — tell me what to change
> - **abort** — cancel, no Jira issue will be created

Wait for the user's response:

- **yes / approve / create / go**: Proceed to Step 7.
- **edit / modify / change**: Ask what to change. Update the draft JSON, re-run Step 5, ask again.
- **no / abort / cancel**: Display "Aborted. No Jira issue was created." STOP.

**NEVER proceed to Step 7 without explicit user approval. This is non-negotiable.**

## Step 7: Create or Update Issue

Use the `create-jira-issue.ts` script via the Jira REST API. This requires the `JIRA_API_TOKEN` environment variable and `jira.user_email` in the config.

### Create a new issue (default)

```bash
npx tsx agents/jira-qe-story/scripts/create-jira-issue.ts
```

The script reads `data/cache/qe-story-draft.json` and `data/qe-config.json`, then:

1. Creates the QE story via `POST /rest/api/3/issue`
2. Links it to the dev story via `POST /rest/api/3/issueLink` (Cloners type)
3. Posts automation suggestions as a comment via `POST /rest/api/3/issue/{key}/comment`

### Update an existing issue

If the user asks to re-run or update an existing QE story (e.g., the story was already created and needs refreshed content):

```bash
npx tsx agents/jira-qe-story/scripts/create-jira-issue.ts --update {existing_qe_key}
```

The script:

1. Updates the description via `PUT /rest/api/3/issue/{key}` (skips creation and linking)
2. Posts automation suggestions as a new comment

### Preview (dry run)

```bash
npx tsx agents/jira-qe-story/scripts/create-jira-issue.ts --dry-run
npx tsx agents/jira-qe-story/scripts/create-jira-issue.ts --update {key} --dry-run
```

### Exit codes

- **Exit 0**: Success. The script prints the issue key and URL.
- **Exit 1**: API error (auth failure, permission denied). Display the error. STOP.
- **Exit 2**: Missing config, draft, or `JIRA_API_TOKEN` env var. Display the error. STOP.

If the `JIRA_API_TOKEN` env var is not set, display:

```text
JIRA_API_TOKEN is not set. Get one from:
https://id.atlassian.com/manage-profile/security/api-tokens
Then: export JIRA_API_TOKEN=ATATT3x...
```

## Step 8: Display Result

Display the final result:

```text
[8/8] QE story created successfully.

  Created:  {created_key}
  Link:     https://redhat.atlassian.net/browse/{created_key}
  Clones:   {source_key} → {created_key}
  Project:  {target_project_key}
  Points:   {story_points}
```

## Rules

1. **NEVER create a Jira issue without explicit user approval.** This is non-negotiable. The approval gate in Step 6 must be respected.
2. Never hardcode project keys, assignees, or labels — read from `agents/jira-qe-story/data/qe-config.json` with CLI argument overrides.
3. Jira reads use the selected config's `jira.cloud_id` DNS hostname via `--site`; never substitute `cloud_uuid`.
4. Custom field IDs: sprint = `customfield_10020`, story points = `customfield_10028`, QA contact = `customfield_10470`.
5. Repo context is optional enrichment — if unavailable, proceed without it.
6. The QE story description must include both acceptance criteria and test scenarios as separate sections.
7. Preserve the draft JSON in cache after creation so the user can review what was submitted.
8. The existing writer retains its Cloners link. If that link type is unavailable, diagnose the available types with `node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' issue-link-types` and inspect the native `issueLinkTypes` response for the intended clone relation. A required diagnostic read failure STOPs. Report the link failure rather than silently changing the approved relation or replacing the writer.
9. Keep `assignee_account_id` empty in the draft if unspecified; the existing writer then omits `fields.assignee` from its issue payload so Jira uses its default.
10. Set `story_points` to null in the draft if unspecified; the existing writer then omits `fields.customfield_10028` from its issue payload.
