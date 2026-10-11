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

Both approaches produce the standard layout described in [agents/\_template/README.md](agents/_template/README.md). After creating the agent directory, wire it into all three clients:

1. Agent spec at `.claude/agents/your-agent.md` (shared source of truth)
2. Skill shortcut at `.claude/skills/your-skill/SKILL.md` (Claude Code)
3. Codex skill at `.agents/skills/your-skill/SKILL.md` with a relative `references/agent-workflow.md` symlink to the agent spec
4. Cursor rule at `.cursor/rules/your-agent.mdc` (Cursor — points to the agent spec)
5. Rows added to the agent tables in `README.md`, `AGENTS.md`, and `CLAUDE.md`

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

All agent dependencies (`@types/node`, `tsx`, `typescript`, `vitest`) are managed in the root `package.json`. The root `tsconfig.json` includes all agent scripts via a glob pattern (`agents/*/scripts/**/*.ts`).

## Testing

Agents that include scripts use [Vitest](https://vitest.dev/) for unit tests. Run tests from the repo root:

```bash
npm test                    # run all agent tests
npm run weekly:test         # run only weekly-team-update tests
npm run sprint-review:test  # run only sprint-review tests
npm run context:test        # run only repo-contextification tests
```

Test files live alongside the source (e.g., `scripts/lib.test.ts`). When adding new scripts, add corresponding test files following the same naming convention.

The NMState CVE workflow uses isolated evidence fixtures: `npm run nmstate-cve-verification:test`. Live build/catalog/ART/repository assessments require no cluster by default; provide a current Jira issue and explicit selection inputs, following the [agent README](agents/nmstate-cve-verification/README.md). Ordinary console-plugin/npm numeric-minor requests use direct `:art --request` public-source evidence for mapped GA and pre-GA streams, independent of lifecycle, without catalog/Quay/tool/registry-auth prerequisites. Branch comparison runs only when explicitly requested; the ordinary validated ART-only offline summary uses null branch/repository selectors and recommends human resolution only for complete unaffected source evidence. Explicit ART image work retains pre-GA/Quay gates; catalog/publisher/payload/repository/deployed routes remain independently requested. After its fresh Jira identity/mapping gate, the build runner selects `--registry-config`, then `REGISTRY_AUTH_FILE`, then a complete nonempty CR/LF/NUL-free `RH_USERNAME`/`RH_TOKEN` pair. Borrowed user-owned regular nonsymlink readable files stay untouched; automatic Podman login targets registry.redhat.io only, token on stdin with suppressed output, 0700 directory/0600 file and finally deletion of only owned credentials on success/incomplete/error. Do not manually create credentials or pre-login for the agent. No credentials/authfile paths are printed/persisted; invalid selected files, partial/unsafe RH config and login failure are fatal without fallback, cleanup failure forces exit 1, and remote denial is not retried or repaired with cluster credentials. Wholly absent registry configuration preserves public selection and a validated inventory blocker with zero registry subprocesses. Catalog's in-memory reader and repository's no-registry behavior stay unchanged. Follow README's validated-only/blocked/branch-only exit-dependent handoff; the branch-only exception requires comparison intent before primary failure, and no rejected output or fabricated empty summary is admitted. Only explicitly requested deployed-source checks require you to prepare/log in to an approved cluster yourself. Do not make live cluster or Jira writes part of the test suite; separately scoped ART public-source, image-labelled and repository dependency outcomes are not runtime scans or ART released-product verdicts.

## Pull Request Process

1. Create a branch from `main` with a descriptive name (e.g., `add-deploy-agent` or `fix-gitlab-scope`)
2. Ensure `npm run lint` and `npm run format:check` pass at the root
3. Run tests for any agents you modified
4. Write a clear commit message in imperative mood that explains the "why" (e.g., "Add sprint-review agent for sprint retrospective analysis")
5. Open a PR against `main` with a summary of changes

## Commit Conventions

Commit messages use imperative mood and describe the intent, not the mechanics:

```text
Add sprint-review agent for sprint retrospective analysis
Fix GitLab MCP queries returning empty results without scope param
Improve create-agent skill with patterns from weekly-team-update
```

## Secrets and Tokens

Never commit tokens, secrets, or `.env` files. All tokens resolve from environment variables at runtime. The `.mcp.json` file uses `${VAR_NAME}` syntax, which the IDE resolves from the user's shell environment.

The `.gitignore` blocks `.env` as a safety net, but the standard approach is exported shell variables -- not dotenv files.
