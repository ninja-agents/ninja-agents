# Contributing

This repo is a shared playground -- contributions range from new agents to improvements to existing ones. For initial setup (cloning, token configuration, and launching your IDE), see [README.md](README.md#quick-start).

## Adding a New Agent

Copy the template and fill in your agent's logic:

```bash
cp -r agents/_template agents/your-agent
```

Or run the scaffolding skill in Claude Code:

```bash
/create-agent your-agent-name
```

Both approaches produce the standard layout described in [agents/\_template/README.md](agents/_template/README.md). After creating the agent directory, wire it into both IDEs:

1. Agent spec at `.claude/agents/your-agent.md` (shared source of truth)
2. Skill shortcut at `.claude/skills/your-skill/SKILL.md` (Claude Code)
3. Cursor rule at `.cursor/rules/your-agent.mdc` (Cursor — points to the agent spec)
4. Rows added to the agent tables in `README.md`, `AGENTS.md`, and `CLAUDE.md`

## Coding Standards

The repo enforces ESLint (flat config with `typescript-eslint`) and Prettier at the root. Run checks from the repo root:

```bash
npm run lint          # ESLint with type-checked rules
npm run lint:fix      # auto-fix lint issues
npm run format:check  # Prettier dry-run
npm run format        # Prettier auto-format
```

Key TypeScript conventions enforced by ESLint:

- Add type assertions to `JSON.parse` calls: `JSON.parse(...) as MyType`
- Use `import.meta.dirname` instead of `dirname(fileURLToPath(import.meta.url))`
- Use `String(e)` when interpolating caught errors in template literals
- Mark top-level async calls with `void` when not awaited

Prettier configuration (`prettier.config.mjs`):

- Double quotes, trailing commas, semicolons

All agent dependencies (`@types/node`, `tsx`, `typescript`, `vitest`) are managed in the root `package.json`. The root `tsconfig.json` uses project references to point to each agent's `tsconfig.json`.

## Testing

Agents that include scripts use [Vitest](https://vitest.dev/) for unit tests. Run tests from the repo root:

```bash
npm test                    # run all agent tests
npm run weekly:test         # run only weekly-team-update tests
npm run retro:test          # run only sprint-retro tests
npm run context:test        # run only repo-contextification tests
```

Test files live alongside the source (e.g., `scripts/lib.test.ts`). When adding new scripts, add corresponding test files following the same naming convention.

## Pull Request Process

1. Create a branch from `main` with a descriptive name (e.g., `add-deploy-agent` or `fix-gitlab-scope`)
2. Ensure `npm run lint` and `npm run format:check` pass at the root
3. Run tests for any agents you modified
4. Write a clear commit message in imperative mood that explains the "why" (e.g., "Add sprint-retro agent for sprint retrospective analysis")
5. Open a PR against `main` with a summary of changes

## Commit Conventions

Commit messages use imperative mood and describe the intent, not the mechanics:

```text
Add sprint-retro agent for sprint retrospective analysis
Fix GitLab MCP queries returning empty results without scope param
Improve create-agent skill with patterns from weekly-team-update
```

## Secrets and Tokens

Never commit tokens, secrets, or `.env` files. All tokens resolve from environment variables at runtime. The `.mcp.json` file uses `${VAR_NAME}` syntax, which the IDE resolves from the user's shell environment.

The `.gitignore` blocks `.env` as a safety net, but the standard approach is exported shell variables -- not dotenv files.
