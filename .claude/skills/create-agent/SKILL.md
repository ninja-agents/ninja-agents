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

### 1.2 Data Sources & Tools

Ask:
- **Which MCP servers does it need?** Options:
  - GitHub MCP — PR/commit data from github.com
  - GitLab MCP — MR/commit data from gitlab.cee.redhat.com
  - Atlassian Rovo MCP — Jira ticket data from redhat.atlassian.net
  - None / other (describe)
- **Does it need supporting scripts?** (Python, shell, etc.) or is it prompt-only?

### 1.3 Model & Memory

Ask:
- **Which model?** Options:
  - `opus` — complex reasoning, multi-step workflows, large context (recommended for data-heavy agents)
  - `sonnet` — balanced speed and capability (recommended for most agents)
  - `haiku` — fast and cheap (recommended for simple lookups, exploration, read-only tasks)
- **Memory mode?** Options:
  - `project` — learns across sessions, shared with team via git (recommended for team agents)
  - `user` — personal learning across all projects
  - None — no persistent memory (recommended for stateless/deterministic agents)

### 1.4 Skill Shortcut

Ask:
- **Skill name** — the `/slash-command` name (default: same as agent name)
- **Should Claude auto-invoke this?** Or manual-only via `/command`?
  - Auto-invoke (default) — Claude detects when to use it from conversation
  - Manual-only (`disable-model-invocation: true`) — only runs when user types the command. Recommended for agents with side effects (deploys, sends messages, modifies external systems).

## Phase 2: Generate Files

Create all files below. Use the gathered requirements to fill in content. Follow the best practices in the reference section strictly.

### 2.1 Agent Directory

```bash
mkdir -p agents/{name}/scripts agents/{name}/data/cache agents/{name}/data/output
touch agents/{name}/data/cache/.gitkeep agents/{name}/data/output/.gitkeep
```

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

## Step 1: {Setup/Input}

{Read config, calculate parameters, validate prerequisites.}

## Step 2: {Core Work}

{Main workflow. Be prescriptive with numbered sub-steps.
Batch independent tool calls in parallel.
Include validation checkpoints between major phases.}

## Step 3: {Output/Delivery}

{Generate output, validate, display to user.}

## Rules

1. {Invariant rules that must always hold}
```

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

{Describe the output format.}
```

### 2.4 Agent README — `agents/{name}/README.md`

Generate the agent README:

```markdown
# {Agent Title}

{One-line description.}

## Prerequisites

{List MCP servers, tokens, or tools needed.}

## Usage

### Claude Code

\```bash
/{skill-name}
\```

### Cursor / Manual

{Describe how to use from Cursor or run scripts directly.}

## How It Works

{Numbered workflow steps.}

## Configuration

{Describe any config files, or "No configuration needed."}

## File Layout

\```
agents/{name}/
├── README.md
├── scripts/
└── data/
    ├── cache/
    └── output/
\```
```

### 2.5 Update Index Files

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
   **MCP servers:** {list or "none"}
   ```

2. Add a pointer line to `MEMORY.md`:
   ```
   - [Agent: {name}](agent_{name}.md) — {name} agent scaffolded, invoked via /{skill-name}
   ```

## Phase 4: Review & Next Steps

After generating all files, display:

1. A summary of what was created (list all file paths)
2. The generated agent spec content for review
3. Next steps checklist:
   - [ ] Add any supporting scripts to `agents/{name}/scripts/`
   - [ ] Add MCP tool permissions to `.claude/settings.json` if needed
   - [ ] Test the agent by running `/{skill-name}`
   - [ ] Commit the new agent

---

## Best Practices Reference

These rules govern how you generate the files above. Follow them strictly.

### Agent Spec Best Practices

**Frontmatter:**
- `description` must include natural-language trigger phrases users might say, plus 1-2 `<example>` blocks showing user message → assistant response
- `model` should match the task complexity — don't use opus for simple lookups
- `memory: project` is the default for team-shared agents; omit for stateless agents

**Body — Structure:**
- Start with a role statement: "You are a {role}. Your job is to: 1. ... 2. ... 3. ..."
- Follow with "You do NOT {anti-pattern}" if there's a common mistake to prevent
- Use `## Step N: {Action}` headers — prescriptive verbs, not nouns
- Each step should have clear inputs, actions, and outputs
- End with a `## Rules` section listing invariants as a numbered list

**Body — Workflow Quality:**
- Include validation checkpoints between major phases ("After Step 2, STOP and validate: ...")
- Batch independent tool calls: "Launch ALL of these in a single parallel tool call:"
- Handle errors explicitly: "If X fails: display the error, STOP, ask user how to proceed"
- Specify exact exit conditions — don't leave the agent guessing when it's done
- If the agent produces structured output (reports, CSVs), delegate formatting to a script. The agent should gather data and call the script, not format output itself.

**Body — Tool Usage:**
- Specify exact MCP tool names and parameters, not vague descriptions
- Show the tool call format with field names and example values
- Note required fields that are easy to miss (e.g., GitLab `scope: "all"`)
- For data schemas (CSVs, JSON), specify exact headers and field definitions

**Body — What to Avoid:**
- Don't duplicate content from CLAUDE.md — the agent inherits it automatically
- Don't include narrative explanations — be prescriptive ("Do X", not "You should consider doing X")
- Don't leave decisions to the agent that should be made upfront ("Choose the best format" → specify the format)
- Don't exceed ~500 lines — if the spec is too long, move reference material to supporting files
- Don't hardcode team-specific data — use config files that the agent reads at runtime

### Skill Spec Best Practices

- Description should be concise and keyword-rich for Claude's skill discovery
- Include a `## Usage` section showing the slash command
- Document what the skill does in 3-6 numbered steps
- Document expected output format so users know what to expect
- List critical rules (formatting, privacy, resolution criteria)
- Use `disable-model-invocation: true` for skills with significant side effects

### Directory Structure Best Practices

- Agent directory is self-contained under `agents/{name}/`
- Always create `scripts/`, `data/cache/`, `data/output/` subdirectories
- Always add `.gitkeep` to `cache/` and `output/` so git tracks empty dirs
- All paths in agent/skill specs are relative to the repo root
- Config files go in `agents/{name}/data/` — never hardcode team data in specs
- The `.gitignore` already handles `agents/*/data/cache/*` and `agents/*/data/output/*.md`
