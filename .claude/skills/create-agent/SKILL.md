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

### 1.2 Data Sources & Scripts

Ask:
- **Which MCP servers does it need?** Options:
  - GitHub MCP — PR/commit data from github.com
  - GitLab MCP — MR/commit data from gitlab.cee.redhat.com
  - Atlassian Rovo MCP — Jira ticket data from redhat.atlassian.net
  - None / other (describe)
- **What scripting language for supporting scripts?** Options:
  - TypeScript (recommended) — generates `package.json`, `tsconfig.json`, and starter script
  - Python — generates `requirements.txt` and starter script
  - Shell — generates starter `.sh` script
  - None — prompt-only agent, no supporting scripts

### 1.3 Config & Data

Ask:
- **Does this agent need a config file?** If yes, what does it configure? (e.g., team members, project list, thresholds, API endpoints). Default: yes for data-fetching agents, no for simple tools.
- **Does the agent write any prose output itself** (vs. delegating all formatting to scripts)? If yes, what kind? (e.g., summary bullets, analysis paragraphs, recommendations). A style guide will be generated for any agent-written prose.

### 1.4 Model & Memory

Ask:
- **Which model?** Options:
  - `opus` — complex reasoning, multi-step workflows, large context (recommended for data-heavy agents)
  - `sonnet` — balanced speed and capability (recommended for most agents)
  - `haiku` — fast and cheap (recommended for simple lookups, exploration, read-only tasks)
- **Memory mode?** Options:
  - `project` — learns across sessions, shared with team via git (recommended for team agents)
  - `user` — personal learning across all projects
  - None — no persistent memory (recommended for stateless/deterministic agents)

### 1.5 Skill & Validation

Ask:
- **Skill name** — the `/slash-command` name (default: same as agent name)
- **Should Claude auto-invoke this?** Or manual-only via `/command`?
  - Auto-invoke (default) — Claude detects when to use it from conversation
  - Manual-only (`disable-model-invocation: true`) — only runs when user types the command. Recommended for agents with side effects (deploys, sends messages, modifies external systems).
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

**`agents/{name}/package.json`:**
```json
{
  "name": "{name}",
  "private": true,
  "type": "module",
  "scripts": {
    "{main-script-name}": "tsx scripts/{main-script}.ts",
    "validate": "tsx scripts/validate-output.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.2.0"
  }
}
```

Adjust the `scripts` section: include only scripts that apply. If the agent has no validation script, omit the `"validate"` entry. If no tests, omit `"test"` and `vitest`.

**`agents/{name}/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "scripts",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["scripts/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

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
name: {name}
description: "{description with trigger phrases and examples}"
model: {model}
memory: {memory or omit if none}
---

{Role statement — one sentence defining what the agent does and doesn't do.}

## Step 1: {Setup/Read Config}

{Read config from `agents/{name}/data/config.json` (if applicable).
Calculate parameters (dates, filters, etc.).
Validate prerequisites (required files exist, MCP servers respond).}

## Step 2: {Fetch/Gather Data}

{Main data-gathering workflow. Be prescriptive with numbered sub-steps.
Batch independent tool calls in parallel: "Launch ALL of these in a single parallel tool call:"
Include explicit error handling: "If X fails: display the error, STOP, ask user how to proceed."}

### Validation Checkpoint

After data collection, verify:
- {Expected data is present (e.g., "At least one PR was returned")}
- {Data quality checks (e.g., "No duplicate entries")}

If validation fails, display what's missing and STOP.

## Step 3: {Process/Generate Output}

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
```

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

```markdown
---
name: {skill-name}
description: {One-line description}
user-invocable: true
{disable-model-invocation: true  # if manual-only}
---

{One-sentence description of what happens when invoked.}

## Usage

\```bash
/{skill-name}
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
```

### 2.4 Agent README — `agents/{name}/README.md`

Generate the agent README:

```markdown
# {Agent Title}

{One-line description.}

## Prerequisites

{List MCP servers, tokens, or tools needed.
Include: "Tokens must be set as environment variables before launching Claude Code."}

## Usage

### Claude Code

\```bash
/{skill-name}
\```

### Cursor / Manual

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
├── package.json        # if TypeScript
├── tsconfig.json       # if TypeScript
├── scripts/
│   ├── {main-script}.ts
│   └── validate-output.ts  # if validation
└── data/
    ├── config.json     # if config file
    ├── cache/          # temporary data (gitignored)
    └── output/         # generated output (gitignored)
\```

> Cache and output directories are gitignored via the repo-level `.gitignore`
> (`agents/*/data/cache/*` and `agents/*/data/output/*.md`).
```

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
  "engineers": [
    { "name": "Jane Doe", "username": "jdoe" }
  ]
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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config ?? resolve(__dirname, "../data/config.json");
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

## Phase 3: Save Memory

Save a **project** memory so future conversations know this agent exists. Write to the memory system at `/home/rlavi/.claude/projects/-home-rlavi-Projects-ninja-agents/memory/`:

1. Create `agent_{name}.md` with frontmatter:
   ```markdown
   ---
   name: agent-{name}
   description: "{name}" agent was scaffolded — {one-line purpose}
   type: project
   ---

   Agent "{name}" was created on {today's date}.

   **What it does:** {one-sentence description from Phase 1}
   **Skill:** `/{skill-name}`
   **Model:** {model}
   **Scripts:** {language or "none"}
   **MCP servers:** {list or "none"}
   **Config:** `agents/{name}/data/config.json` or "none"
   ```

2. Add a pointer line to `MEMORY.md`:
   ```
   - [Agent: {name}](agent_{name}.md) — {name} agent scaffolded, invoked via /{skill-name}
   ```

## Phase 4: Install & Verify

If TypeScript or Python scripts were generated, install dependencies:

**TypeScript:**
```bash
npm --prefix agents/{name} install
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

## Phase 5: Review & Next Steps

After generating all files, display:

1. A summary of what was created (list all file paths)
2. The generated agent spec content for review
3. Next steps checklist:
   - [ ] Flesh out the starter script in `agents/{name}/scripts/`
   - [ ] Flesh out the config file in `agents/{name}/data/config.json` (if applicable)
   - [ ] Add MCP tool permissions to `.claude/settings.json` if needed
   - [ ] Write tests (run with `npm test` from `agents/{name}/`)
   - [ ] Test the agent by running `/{skill-name}`
   - [ ] Commit the new agent

---

## Best Practices Quick Reference

Quality rules for generated files. The Phase 2 templates above show *what* to generate — this section captures *how well*.

### Agent Spec

- `description` frontmatter must include trigger phrases + 1-2 `<example>` blocks
- Role statement first, then `## Step N` sections (prescriptive verbs), then `## Rules`
- Include "You do NOT {anti-pattern}" if there's a common mistake to prevent
- Batch independent tool calls: "Launch ALL of these in a single parallel tool call:"
- Handle errors explicitly: "If X fails: display the error, STOP, ask user how to proceed"
- Specify exact MCP tool names and parameters — show field names and example values
- Note required fields that are easy to miss (e.g., GitLab `scope: "all"`)
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
- TypeScript agents: `package.json` + `tsconfig.json` at agent root
- Python agents: `requirements.txt` at agent root
- Config files in `agents/{name}/data/` — never hardcode team data in specs

### Validation

- Every agent with structured output gets a validation step
- Validate BEFORE displaying results — never show unvalidated output
- Exit 0 = pass, exit 1 = errors found

### Testing

- Include `vitest` (TS) or `pytest` (Python) in devDependencies
- Tests live in `agents/{name}/scripts/` as `*.test.ts` or `test_*.py`
- At minimum, test config loading and data parsing
- Scaffolding doesn't need tests immediately — the checklist reminds the user
