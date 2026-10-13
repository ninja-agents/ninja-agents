---
name: create-agent
description: Scaffold a new agent with best-practice structure, specs, and skill shortcut
argument-hint: [agent-name]
arguments: [name]
user-invocable: true
---

Create a new agent in the ninja-agents playground. Walk the user through requirements, then generate all files following best practices.

## Phase 1: Gather Requirements

If `$name` was provided, use it. Otherwise ask for a name (lowercase, hyphens only).

Use AskUserQuestion to collect the following. You may combine related questions into a single call (up to 4 questions per call). Suggest sensible defaults based on the agent's purpose.

### 1.1 Purpose & Workflow

Ask:

- **What does this agent do?** — one-sentence description of the agent's purpose
- **What are the main steps?** — the high-level workflow (e.g., "fetch data, process it, generate output")
- **What should this agent NOT do?** — common anti-patterns to prevent. Suggest defaults based on the workflow: for script-based agents, suggest "Do NOT format the output yourself — the script handles formatting." For doc-only agents, suggest "Do NOT modify application code."

### 1.2 Data Sources & Scripts

Ask:

- **Which data sources does it need?** Options:
  - GitHub MCP — PR/commit data; GitHub is the sole project MCP server
  - Jira direct REST API — root `scripts/jira-rest.ts` commands or an existing workflow's direct collector
  - GitLab direct REST API — bounded optional QE repository context via `scripts/gitlab-read.ts qe-context`; other MR/commit reporting follows the existing direct collector pattern
  - None / other (describe)
- **What scripting language for supporting scripts?** Options:
  - TypeScript (recommended) — generates `package.json`, `tsconfig.json`, and starter script
  - Python — generates `requirements.txt` and starter script
  - Shell — generates starter `.sh` script
  - None — prompt-only agent, no supporting scripts

**Conditional questions** (only ask when data sources are selected):

- **What data fields does the agent need from each source?** Suggest common defaults per platform. The user can accept defaults or customize:
  - GitHub: `number, title, repo, state, created_at, merged_at, html_url`
  - GitLab: `iid, title, project_path, state, created_at, merged_at, web_url`
  - Jira: `key, summary, status, resolution, issuetype, priority, assignee`
- **Could any data source return 100+ results per query?** Options: Yes / No / Unsure. Default: No for most agents, Yes if Jira is selected and the description mentions "all tickets" or "all issues".
- **Is each source required or optional?** Required-source failures STOP before processing/output or approval. GitLab `qe-context` is optional enrichment only; it cannot supply general MR reporting.

**Conditional question** (only when 2+ data sources selected):

- **Are there dependencies between data sources?** — e.g., "Does fetching from source B depend on results from source A?" Default: No (all sources fetched in parallel as a single batch).

### 1.3 Config & Data

Ask:

- **Does this agent need a config file?** If yes, what does it configure? (e.g., team members, project list, thresholds, API endpoints). Default: yes for data-fetching agents, no for simple tools.
- **Does the agent write any prose output itself** (vs. delegating all formatting to scripts)? If yes, what kind? (e.g., summary bullets, analysis paragraphs, recommendations). A style guide will be generated for any agent-written prose.

### 1.4 Skill & Validation

Ask:

- **Skill name** — the `/slash-command` name (default: same as agent name)
- **Should Claude auto-invoke this?** Or manual-only via `/command`?
  - Auto-invoke (default) — Claude detects when to use it from conversation
  - Manual-only (`disable-model-invocation: true`) — only runs when user types the command. Recommended for agents with side effects (deploys, sends messages, modifies external systems).
- **Does the skill accept an argument?** — e.g., a path, a date, a repo name. If yes: what is the argument and is it required or optional? Default: no. Example: repo-contextification takes an optional `<path-or-owner/repo>` argument.
- **Does the output need validation?** If yes, what kind? (e.g., link checking, schema validation, format verification). Default: yes for agents that produce structured output.

## Phase 2: Generate Files

Create all files below. Use the gathered requirements to fill in content. Follow the best practices in the reference section strictly.

### 2.1 Agent Directory & Project Files

Create the directory structure:

```bash
mkdir -p agents/{name}/scripts agents/{name}/data/cache agents/{name}/data/output
touch agents/{name}/data/cache/.gitkeep agents/{name}/data/output/.gitkeep
```

**If TypeScript was selected**, also generate:

**`agents/{name}/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "scripts"
  },
  "include": ["scripts/**/*.ts"],
  "exclude": ["dist"]
}
```

**Add scripts to the root `package.json`** — append namespaced scripts for the new agent:

```json
"{name}:{main-script-name}": "tsx agents/{name}/scripts/{main-script}.ts",
"{name}:validate": "tsx agents/{name}/scripts/validate-output.ts",
"{name}:test": "vitest run --dir agents/{name}"
```

Include only scripts that apply. If the agent has no validation script, omit the `"{name}:validate"` entry.

**If Python was selected**, generate:

**`agents/{name}/requirements.txt`:**

```
# Add dependencies here
```

**If Shell was selected**, no project files needed.

### 2.2 Agent Spec — `.claude/agents/{name}.md`

Generate the agent spec with this structure:

```markdown
---
name: { name }
description: "{description with trigger phrases and examples}"
---

{Role statement — one sentence defining what the agent does and doesn't do.}

You do NOT {anti-pattern from Phase 1.1 — e.g., "format the report yourself. The TypeScript script handles all filtering, nesting, and formatting deterministically."}.
```

**If the agent has 5+ steps**, add a Progress Communication section immediately after the role statement:

````markdown
## Progress Communication

Before starting Step 1, display a step overview so the user knows the full workflow:

\```text
Starting {name} ({N} steps):

1.  {Step1} 2. {Step2} 3. {Step3} ...
    \```

Prefix every status line with `[N/{total}]` where N is the current step number. Display a status line when starting each step and at key milestones. Keep updates to one line each — be transparent, not verbose.
````

Then generate the workflow steps:

```markdown
## Step 1: {Setup/Read Config}

{Read config from `agents/{name}/data/config.json` (if applicable).
Calculate parameters (dates, filters, etc.).
Validate prerequisites (required files exist, Node.js 22+ and installed repository-root dependencies are available, selected GitHub MCP tools respond, and required API credential variables are present without printing values).}
```

**If a skill argument was defined**, add conditional handling at the start of Step 1:

```markdown
If `${argument-name}` was provided, use it. Otherwise {default behavior or ask user}.
```

### Data Fetching Steps — MCP and Direct API Templates

Generate the data-fetching step(s) using the batch structure and source-specific templates below. Keep `.claude/agents/{name}.md` canonical; do not create another workflow spec or replace an existing direct collector with a second collection path.

**If no data dependencies exist** (or single data source), generate one batch:

```markdown
## Step 2: Fetch Data

Launch ALL of these in a single parallel tool call:
```

**If data dependencies exist**, generate multiple batches with validation between them:

```markdown
## Step 2: Fetch Data (Batch 1)

Launch ALL of these in a single parallel tool call:

{...tool calls for independent sources...}

**After Batch 1 returns, STOP and validate:**

- {Data-source-specific checks — see below}

Only proceed to Batch 2 after validation passes.

## Step 3: Fetch Data (Batch 2)

Launch ALL of these in a single parallel tool call:

{...tool calls for dependent sources...}
```

**Include these platform-specific blocks** based on selected sources:

For **GitHub MCP**:

````markdown
**GitHub {PRs/commits/etc.}** — one query per {entity}:

\```
mcp**github**search_pull_requests:
query: "author:{username} is:merged merged:{seven_days_ago}..{today}"
\```
````

For **GitLab direct REST — optional QE context only**:

````markdown
**Optional GitLab QE repository context** — use the selected `projects[]` repository or approved CLI override, never a fallback host/repository:

\```bash
node --import tsx scripts/gitlab-read.ts qe-context \
 --project '{selected_owner/repo}' --issue-key '{issue_key}' \
 --api-url '{gitlab.api_url}'
\```

If `gitlab.api_url` is empty/absent, omit `--api-url` and use `GITLAB_API_URL` from the environment. The base must be HTTPS ending in `/api/v4`, with no userinfo, query, or fragment. `GITLAB_PAT` is optional; public reads may be unauthenticated.

- **Exit 0**: one JSON value `{context:{readme,merge_requests,tree},warnings:[]}`. README is decoded UTF-8; `merge_requests` contains only the first ten issue-key-related MRs (`scope=all`, `per_page=10`), not arbitrary MR/commit reporting. The recursive tree is completely paginated internally.
- **Exit 3**: `{context:null,warnings:[safe_code]}` for absent base/access or any optional-source failure. Log the warning and proceed without GitLab enrichment; do not claim partial or absent context was collected.
- **Exit 1**: argument syntax error. STOP and correct the invocation rather than treating a broken command as successful enrichment.
````

For **other GitLab REST purposes**, reuse the direct collector design in `agents/weekly-team-update/scripts/fetch-data.ts`: configuration/env API base, optional `GITLAB_PAT` in `PRIVATE-TOKEN`, and `scope=all` for every MR query. Implement the required reads, field mapping, pagination, and required-vs-optional failure handling in the new agent's own collector before invoking it. Do not import between agents, add an unsupported root CLI action, or use `qe-context` as a general reporting substitute. Leave already-direct weekly and sprint collectors in place.

For **Jira direct REST**:

````markdown
**Jira tickets** — run from the repository root with resolved values as safely shell-quoted arguments:

\```bash
node --import tsx scripts/jira-rest.ts --site '{jira.cloud_id}' search \
 --jql '{JQL query based on agent purpose}' \
 --fields 'summary,status,assignee,resolution,resolutiondate,issuetype,priority,updated,created'
\```

`npm run jira:rest -- --site '{jira.cloud_id}' search ...` is the equivalent invocation. `--site` is the existing config's DNS hostname, not a URL or `cloud_uuid` (Slack uses `jira_filing.cloud_id`). Both reads and approved root CLI writes require `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment. Never place credentials in argv, caches, tracked config, or output.

Search emits `{issues:[...]}` after internal pagination. Map native `issue.key` and `issue.fields` into the workflow's defined cache schema. `fields.description` and comment bodies are normalized strings, preserving paragraph boundaries, mentions, and link URLs; other fields remain native JSON. No results is `{issues:[]}` with exit 0, not a transport failure.

Only select supported reads needed by the workflow:

| Action after `--site HOST` | Arguments                                                                | JSON output                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `search`                   | `--jql STRING --fields COMMA_LIST`                                       | `{issues:[...]}`; use optional `--limit POSITIVE_INT` only for explicitly bounded 1/3-result lookups            |
| `issue`                    | `--key KEY_OR_NUMERIC_ID --fields COMMA_LIST [--comments] [--changelog]` | Native issue; flags fetch complete comments in `fields.comment.comments` and histories in `changelog.histories` |
| `remote-links`             | `--key KEY_OR_NUMERIC_ID`                                                | Native array; referenced URL is `object.url`                                                                    |
| `transitions`              | `--key KEY_OR_NUMERIC_ID`                                                | `{transitions:[...]}`                                                                                           |
| `issue-link-types`         | No additional arguments                                                  | Native `issueLinkTypes` response                                                                                |
| `user-search`              | `--query STRING`                                                         | Complete user array; use `accountId`, not visibility of email                                                   |

Each read emits exactly one complete JSON value on stdout. Exit 1 means a required read failed; report only safe diagnostics and STOP before classification, output, or approval. Never process partial results or ask the model to page API results.
````

Adapt supported commands, fields, and query patterns to the agent's actual purpose. Do not invent endpoints, flags, or generic write actions.

### Approval-Gated Jira Writes

For workflows that already authorize external mutations, retain their preview/selection/per-item user-approval gates. Do not add write scope just because a root action exists. Keep existing per-agent REST apply/QE writers and their private `jira.user_email` plus `JIRA_API_TOKEN` behavior; the root CLI is not a replacement for them.

The root CLI permits only these single-mutation actions, each with `--site HOST` and `--approved`. That flag is a mechanical transport guard, never a substitute for explicit user approval:

| Action             | Required arguments                       | Allowed payload                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `set-fix-versions` | `--key KEY --versions-json JSON_ARRAY`   | Nonempty exact `{id:string}` or `{name:string}` entries; names only for configured TODO IDs; all approved versions in one PUT                                                                                                  |
| `set-components`   | `--key KEY --components-json JSON_ARRAY` | Nonempty exact `{name:string}` entries                                                                                                                                                                                         |
| `transition`       | `--key KEY --transition-id ID`           | Chosen ID after the workflow's configured-ID/destination-name checks                                                                                                                                                           |
| `create-issue`     | `--body-file FILE`                       | Exactly `{fields:{project:{key},issuetype:{name},summary,description,components,labels}}`; description is ADF `{version:1,type:"doc",content:[...]}`, components are `[{name}]`, labels are `string[]`; preserve approved text |
| `link-issues`      | `--body-file FILE`                       | Exactly `{type:{name:"Relates"},inwardIssue:{key},outwardIssue:{key}}`                                                                                                                                                         |

Request-body files must be owned single-link regular `0600` files, created exclusively without following symlinks in fresh owned `0700` scratch storage, never tracked configs/caches. For approved Slack filing, preserve every template line/URL as one ADF paragraph per line. Successful mutation returns native JSON or `{}` for 204 and exit 0; failure exits 1. Preserve per-item failure summaries and continuation rules; never fabricate rollback or successful writes. No arbitrary endpoint/method/body tunnel is supported.

### Pagination Subsection

Generate a short source-specific contract, not manual API page loops:

- Jira root commands own search, comment, changelog, and user pagination. Invoke once and consume the completed output; omit `--limit` for full collection.
- Optional GitLab `qe-context` owns recursive-tree pagination; its ten-MR lookup is intentionally bounded.
- Other direct collectors implement their own pagination and return complete data before processing. Describe the collector's actual completeness guarantees, not an unimplemented loop in the spec.
- Retain the supported GitHub tool's paging contract where needed; do not copy Jira page-token templates into MCP calls.
- State expected data volume and any deliberate bounds so maintainers can distinguish full collection from lookups.

### Validation Checkpoint

Generate data-source-specific checks based on selected sources:

```markdown
### Validation Checkpoint

After data collection, verify:
```

Include the relevant checks from this list:

- **GitHub**: `- Count total PRs returned. If < 5: display warning, ask user whether to retry or proceed.`
- **GitLab QE context**: `- Exit 3 with context:null is an accepted optional-source warning; proceed without enrichment. Exit 1 is an invocation error and STOPs.`
- **Other GitLab collectors**: `- Check the collector's exit status and complete output; required failures STOP, explicitly optional failures are reported without fabricated data. An empty successful result is not proof of missing scope=all.`
- **Jira**: `- Check every required REST command succeeded. On exit 1 STOP before classification/output/approval. If ALL successful queries returned 0 tickets combined, keep the workflow's no-tickets STOP message.`
- **General**: `- If a required MCP call or direct collector fails, display safe diagnostics and STOP before dependent work. Never print token values or raw credential-bearing responses.`

```markdown
If validation fails, display what's missing and STOP.
```

### Save to CSV Step (if Data Sources + Scripts)

**If the agent uses data sources and has TypeScript/Python scripts**, generate a "Save to CSV" step between data fetching and processing. Use the data fields from Phase 1.2 and the command's actual JSON output:

```markdown
## Step N: Save to CSV

Save results to `agents/{name}/data/cache/` using these exact schemas.

### {source}-{data-type}.csv

Header: `{comma-separated field names from Phase 1.2}`

| Field      | Source                   | Notes                                    |
| ---------- | ------------------------ | ---------------------------------------- |
| `{field1}` | {JSON path or API field} | {type, quoting rule, or "empty if none"} |
| `{field2}` | {JSON path or API field} | {notes}                                  |

<!-- TODO: Define dedup rules. Example from weekly-team-update:
"If the same PR appears in both merged and open searches, keep the merged version."
If your agent fetches overlapping data sets, specify which version wins. -->

**CSV quoting:** wrap any field containing a comma in double quotes. Escape internal double quotes by doubling them.

### last-updated.txt

Write current ISO-8601 timestamp.
```

Generate one CSV schema subsection per data source. Use the field names the user confirmed in Phase 1.2.

### Processing Step

````markdown
## Step N: {Process/Generate Output}

{Call the processing script with explicit arguments.
Document exact command, arguments, and exit codes.}

\```bash
npx tsx agents/{name}/scripts/{main-script}.ts {--args}
\```

Handle exit codes:

- **Exit 0**: Success. Proceed.
- **Exit 1**: Error. Display the message. STOP.
- **Exit 2**: Data quality problem. Display. Ask user to retry or proceed.
- **Exit 3**: Warnings. Output was generated. Note warnings, proceed.
````

**If the agent writes prose output**, add a dedicated step with this structure:

    ## Step N: Write {Section Name}

    {What the agent writes and where it goes.}

    ### Style Guide

    **Format rules:**
    - {Specific formatting rules — voice, tense, structure}
    - {Length constraints — bullet count, word limits}
    - {Content rules — what to include/exclude}

    **Good examples:**
    - {Example of well-written output}
    - {Another example}

    **Bad examples (do NOT write like this):**
    - {Counter-example showing a common mistake}
    - {Another counter-example}

    ### Self-check before proceeding:
    - {Checklist item matching each format rule}

See `weekly-team-update.md` Step 6.5 for a complete style guide example.

**If validation was requested**, add a validation step:

    ## Step N: Validate Output

    ```bash
    npx tsx agents/{name}/scripts/validate-output.ts {output-path} --verbose
    ```

    - Exit 0: Validation passed. Proceed.
    - Exit 1: Errors found. Fix them and re-run validation.

Always end with a display/delivery step and a Rules section:

    ## Step N: Display Result

    {Read and display the output file, or present results to the user.}

    ## Rules

    1. {Invariant rules that must always hold}
    2. Never hardcode data that belongs in config — read from `agents/{name}/data/config.json`.
    3. {Error handling rule — when to STOP vs. warn and continue}
    4. {Data integrity rules — deduplication, quoting, encoding}

### 2.3 Skill Spec — `.claude/skills/{skill-name}/SKILL.md`

Create the skill directory and generate the skill spec:

```bash
mkdir -p .claude/skills/{skill-name}
```

````markdown
---
name: {skill-name}
description: {One-line description}
{argument-hint: [{argument-description}]  # if skill accepts an argument}
{arguments: [{argument-name}]             # if skill accepts an argument}
user-invocable: true
{disable-model-invocation: true  # if manual-only}
---

{One-sentence description of what happens when invoked.}

## Usage

\```bash
/{skill-name} {<argument-description> # if skill accepts an argument}
\```

## What This Does

Launches the `{name}` agent which:

1. {Step summary}
2. {Step summary}
3. {Step summary}

## Expected Output

{Describe the output format — sections, structure, where it's saved.}

## Critical Rules

{List 2-4 rules the user should know about — formatting, privacy, resolution criteria, etc.}
````

### 2.4 Agent README — `agents/{name}/README.md`

Generate the agent README:

````markdown
# {Agent Title}

{One-line description.}

## Prerequisites

{List only selected prerequisites: GitHub is the sole project MCP server.
Require Node.js 22+ and installed repository-root dependencies for TypeScript/root CLI commands.
Jira root reads AND writes require JIRA_EMAIL/JIRA_API_TOKEN from the environment and the selected config's jira.cloud_id DNS hostname; existing REST writers may additionally require private jira.user_email.
GitLab REST uses configured gitlab.api_url or GITLAB_API_URL, with optional GITLAB_PAT; qe-context is optional enrichment, not arbitrary MR reporting.
Include: "Credentials must be available as environment variables before launching the client; never print their values or commit them."}

## Usage

### Claude Code

\```bash
/{skill-name}
\```

### Cursor

In Cursor chat, mention `@{name}` or describe what you need — the rule activates automatically and walks through the full workflow.

### Manual

{If scripts exist: show how to run them directly (e.g., `npm run generate -- --date 2026-01-01`).
If prompt-only: describe how to invoke the agent manually.}

## How It Works

{Numbered workflow steps matching the agent spec phases.}

## Configuration

{If config file exists: describe the config file location, structure, and how to customize.
Example: "Edit `data/config.json` to customize team members, projects, and thresholds."
If no config: "No configuration needed."}

## File Layout

\```
agents/{name}/
├── README.md
├── tsconfig.json # if TypeScript
├── scripts/
│ ├── {main-script}.ts
│ └── validate-output.ts # if validation
└── data/
├── config.json # if config file
├── cache/ # temporary data (gitignored)
└── output/ # generated output (gitignored)
\```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
````

### 2.5 Config File (if applicable)

If the user said the agent needs a config file, generate a starter config:

**`agents/{name}/data/config.json`:**

Structure the config following the pattern from `weekly-team-update/data/team-config.json`:

- Top-level keys for major sections (team, projects, thresholds, etc.)
- Arrays of objects for lists of things (members, repos, products)
- Each object has a human-readable `"name"` and a machine `"key"`
- Populate with realistic placeholder values based on what the user described

Example skeleton:

```json
{
  "name": "My Agent Config",
  "projects": [
    { "key": "PROJ", "name": "Project Name", "repos": ["org/repo"] }
  ],
  "engineers": [{ "name": "Jane Doe", "username": "jdoe" }]
}
```

The agent spec must reference this file by path and never hardcode any values from it.

### 2.6 Starter Scripts (if scripts were requested)

Generate runnable starter scripts tailored to the agent's workflow. Each script must:

- Parse CLI arguments using a simple arg-parsing loop
- Use exit codes consistently (0 = success, 1 = error, 2 = data quality issue, 3 = warnings)
- Print a usage message with `--help`
- Be immediately runnable after `npm install` — no placeholder-only code

**Main script** — generates the agent's primary output:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface Config {
  // Define config shape based on agents/{name}/data/config.json
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log("Usage: {main-script}.ts --config <path> --output <path>");
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as Config;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    args.config ?? resolve(import.meta.dirname, "../data/config.json");
  const config = loadConfig(configPath);

  // TODO: Load cached data, process, generate output
  const output = `# {Agent Title} Output\n\nGenerated on ${new Date().toISOString()}\n`;

  if (args.output) {
    writeFileSync(args.output, output);
    console.log(`Output written to ${args.output}`);
  } else {
    console.log(output);
  }
}

main();
```

**Validation script** (if validation was requested):

```typescript
import { readFileSync, existsSync } from "node:fs";

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: validate-output.ts <file> [--verbose]");
    process.exit(0);
  }

  const [inputPath] = args;
  const verbose = args.includes("--verbose");

  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const content = readFileSync(inputPath, "utf-8");
  const errors: string[] = [];
  const warnings: string[] = [];

  // TODO: Add validation checks specific to this agent's output
  // Example: check for required sections, valid links, data completeness

  if (content.trim().length === 0) {
    errors.push("Output file is empty");
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) found:`);
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (verbose) {
    console.log("✓ Validation passed");
  }
}

main();
```

Adapt both scripts to the agent's actual workflow — replace placeholders with real logic where the agent's purpose makes it obvious (e.g., a CSV-processing agent should have CSV loading scaffolded). Keep the scripts under 100 lines each at scaffolding time.

**Starter test file** (TypeScript agents only) — generate `agents/{name}/scripts/{main-script}.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("{main-script}", () => {
  describe("config loading", () => {
    it("loads a valid config file", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      expect(config).toBeDefined();
      // TODO: Add assertions for required config fields
    });
  });

  // TODO: Add tests for data parsing, CSV handling, output generation
});
```

Keep the test file under 50 lines at scaffolding time. Use patterns from `agents/sprint-review/scripts/generate-sprint-review.test.ts` for helper functions and test structure. The test should be immediately runnable with `npm run {name}:test`.

### 2.7 Update Index Files

Append a row to each of these tables:

**`AGENTS.md`** — Available Agents table:

```
| [{name}](agents/{name}/) | {description} | [README](agents/{name}/README.md) |
```

**`README.md`** — Available Agents table:

```
| [{name}](agents/{name}/) | `/{skill-name}` | {description} |
```

**`CLAUDE.md`** — Available Skills table:

```
| `/{skill-name}` | {description} | `{name}` |
```

**`.cursor/rules/ninja-agents.mdc`** — Available Workflows table:

```
| `@{name}` | {description} |
```

**`.cursor/rules/{name}.mdc`** — create a thin pointer rule:

```markdown
---
description: "{description}. Use when the user asks for {trigger phrases}."
alwaysApply: false
---

# {Title}

Read `.claude/agents/{name}.md` and follow the complete workflow described there.

The agent spec contains all steps, GitHub MCP/direct API command examples, CSV schemas, validation checkpoints, style guides, and rules. It is the single source of truth for this workflow.
```

**If TypeScript**, keep scripts under `agents/{name}/scripts/`. The root `tsconfig.json` already includes `agents/*/scripts/**/*.ts`; no root project reference is needed. Keep agent-specific compiler options in its own `tsconfig.json`, extending the root configuration.

## Phase 3: Install & Verify

If TypeScript or Python scripts were generated, install dependencies:

**TypeScript:**

```bash
npm install
```

**Python:**

```bash
pip install -r agents/{name}/requirements.txt
```

Verify the starter script compiles and runs without errors:

```bash
npx tsx agents/{name}/scripts/{main-script}.ts --help  # or equivalent dry-run
```

If the script errors, fix the issue before proceeding. The user should have a runnable skeleton.

Then run linting and formatting from the repo root to ensure the new code follows project conventions:

```bash
npm run lint        # ESLint — fix any errors before proceeding
npm run format      # Prettier — auto-format all new files
```

If ESLint reports errors, fix them (common issues: add type assertions to `JSON.parse` calls, use `String(e)` in catch blocks instead of interpolating `unknown` directly).

## Phase 4: Review & Next Steps

After generating all files, display:

1. A summary of what was created (list all file paths)
2. The generated agent spec content for review
3. Next steps checklist:
   - [ ] Flesh out the starter script in `agents/{name}/scripts/`
   - [ ] Flesh out the config file in `agents/{name}/data/config.json` (if applicable)
   - [ ] Add only needed GitHub MCP permissions to `.claude/settings.json`; do not restore removed Jira/GitLab servers or grant blanket command/write permissions
   - [ ] Write tests (run with `npm run {name}:test` from the repo root)
   - [ ] Test the agent by running `/{skill-name}` (Claude Code) or `@{name}` (Cursor)
   - [ ] Commit the new agent

---

## Best Practices Quick Reference

Quality rules for generated files. The Phase 2 templates above show _what_ to generate — this section captures _how well_.

### Agent Spec

- `description` frontmatter must include trigger phrases + 1-2 `<example>` blocks
- Role statement first, then `## Step N` sections (prescriptive verbs), then `## Rules`
- Include "You do NOT {anti-pattern}" if there's a common mistake to prevent
- Batch independent tool calls: "Launch ALL of these in a single parallel tool call:"
- Handle errors explicitly: "If X fails: display the error, STOP, ask user how to proceed"
- Specify exact supported GitHub MCP tool names or direct API commands/flags — show field names and safely quoted values, never credentials
- Note required fields that are easy to miss (e.g., GitLab MR query `scope=all`)
- For data schemas, specify exact headers and field definitions
- Delegate structured output formatting to scripts — the agent gathers data and calls scripts
- Be prescriptive, not narrative ("Do X", not "You should consider doing X")
- Don't leave decisions to the agent that should be made upfront
- Don't duplicate CLAUDE.md content — the agent inherits it automatically
- Stay under ~500 lines — move reference material to supporting files if needed

### Style Guides (for agent-written prose)

- Must include: format rules, 2-3 good examples, 2-3 bad examples, self-check list
- Keep focused — 10-15 rules max
- Self-check list mirrors the format rules so the agent verifies its own output

### Skill Spec

- Concise, keyword-rich description for Claude's skill discovery
- `## Usage`, `## What This Does` (3-6 steps), `## Expected Output`, `## Critical Rules`
- Use `disable-model-invocation: true` for skills with significant side effects

### Directory & Files

- Self-contained under `agents/{name}/` — all paths relative to repo root
- The `.gitignore` already handles `agents/*/data/cache/*` and `agents/*/data/output/*.md`
- TypeScript agents: `tsconfig.json` at agent root (dependencies and scripts in root `package.json`)
- Python agents: `requirements.txt` at agent root
- Config files in `agents/{name}/data/` — never hardcode team data in specs

### TypeScript & Linting Conventions

The repo uses ESLint (flat config) + Prettier at the root. All generated TypeScript must pass `npm run lint` and `npm run format` from the repo root.

- `@types/node` is already in the root devDependencies — no per-agent install needed
- Keep scripts under `agents/{name}/scripts/` for automatic root compiler inclusion; do not add build references
- Always add type assertions to `JSON.parse` calls: `JSON.parse(...) as MyType`
- Use `import.meta.dirname` instead of the `dirname(fileURLToPath(import.meta.url))` pattern (Node 22+)
- Use `String(e)` when interpolating caught errors in template literals (ESLint `restrict-template-expressions`)
- Mark top-level async calls with `void` when not awaited (ESLint `no-floating-promises`)

### Validation

- Every agent with structured output gets a validation step
- Validate BEFORE displaying results — never show unvalidated output
- Exit 0 = pass, exit 1 = errors found

### Data Schema & Deduplication

- Define exact CSV headers with a field-mapping table (see `weekly-team-update.md` Step 4)
- Specify quoting rules: wrap comma-containing fields in double quotes, escape internal quotes by doubling
- Document dedup rules explicitly: which version wins when duplicates appear across queries (e.g., "keep merged over open")
- Include source-field mapping for each CSV column (JSON path → CSV field)
- One CSV file per data source — don't mix GitHub and Jira data in the same file

### Pagination

- Jira root CLI and bounded optional GitLab `qe-context` own pagination internally; generated specs invoke once, with no manual page-token loops
- For other direct collectors, implement and document the actual complete-collection contract before referencing the collector; never invent root actions
- State expected volume and deliberate bounds; root Jira `--limit` is for bounded lookups, not report truncation
- Consume complete successful output before proceeding; required-source failure STOPs, optional QE GitLab exit 3 proceeds with a warning and null context

### Batch Parallelism

- Group independent tool calls into explicit batches: "Launch ALL of these in a single parallel tool call:"
- Add a validation checkpoint between dependent batches — never proceed to Batch 2 without validating Batch 1
- Number batches (Batch 1, Batch 2) and state the dependency: "Only proceed to Batch 2 after Batch 1 validation passes."
- Within a batch, one query per entity per data source (e.g., one `search_pull_requests` call per engineer)

### Testing

- Include `vitest` (TS) or `pytest` (Python) in devDependencies
- Tests live in `agents/{name}/scripts/` as `*.test.ts` or `test_*.py`
- At minimum, test config loading and data parsing
- Generate a starter test file at scaffolding time (see Phase 2.6) — runnable immediately with `npm run {name}:test`
