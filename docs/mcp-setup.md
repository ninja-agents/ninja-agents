# MCP and Direct API Setup

GitHub is the sole project MCP server. Jira and GitLab access uses direct API commands or existing agent-owned collectors, not additional MCP servers or browser OAuth. The committed manifests contain environment-variable references, never personal tokens.

## Prerequisites

- An AI-powered client: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.com), or [Codex](https://learn.chatgpt.com/docs/codex/cli)
- [Node.js](https://nodejs.org/) 22+ and installed root dependencies (`npm install` during initial setup)
- Credentials and service access for the selected workflow, as described below

## Credentials

Supply credentials through the environment inherited by the client and its child commands. Never put tokens in command arguments, tracked configuration, reports, or chat. A local secret manager can supply these variables without storing token values in shell profiles.

| Source                     | Required environment                                                          | Configuration                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub MCP                 | `GITHUB_PAT`                                                                  | Committed GitHub-only manifests                                                                 |
| Jira REST reads and writes | `JIRA_EMAIL`, `JIRA_API_TOKEN`                                                | Site DNS hostname from `jira.cloud_id` (Slack filing: `jira_filing.cloud_id`), not `cloud_uuid` |
| Optional QE GitLab context | `GITLAB_API_URL` unless `gitlab.api_url` is configured; optional `GITLAB_PAT` | HTTPS API base ending in `/api/v4`                                                              |

Existing per-agent Jira apply scripts and the QE creator additionally use the email in their private `jira.user_email` configuration with `JIRA_API_TOKEN`; preserve that configuration when using those writers. Root `jira-rest` commands use the environment email, not that private setting. Already-direct collectors retain their own documented configuration and credentials.

### GitHub

Create a token at [github.com/settings/tokens](https://github.com/settings/tokens) with access to the repositories and organizations the workflow reads. Classic tokens generally need `repo` and `read:org`; fine-grained tokens need the relevant repository permissions. The GitHub MCP endpoint requires a PAT.

### Jira

Create an API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Supply your account email as `JIRA_EMAIL` and the token as `JIRA_API_TOKEN` for **both reads and writes**. Root commands use Basic authentication over HTTPS. Jira authorization still determines which projects and operations are accessible; `--approved` does not grant server permissions or replace workflow user approval.

### GitLab

For optional QE enrichment, select the existing configured repository and set `gitlab.api_url` in private QE configuration or `GITLAB_API_URL` in the environment. Use your instance's HTTPS `/api/v4` base, without userinfo, query, or fragment. Public reads can run without a token; private repositories may require `GITLAB_PAT` with suitable read API/repository access. The command never falls back to another host or repository.

## Launch and Verify

Launch the client from a shell with the required variables available:

```bash
claude
# Or open the project in Cursor
# Or: codex -m gpt-6-luna
```

- **Claude Code:** use `/mcp`; the project's server list contains **github** only.
- **Cursor:** open Settings > MCP and check the project's **github** connection.
- **Codex:** trust the project so `.codex/config.toml` loads, then use `codex mcp list` or `/mcp`; the project defines **github** only. Select workflows through `$` or `/skills`.

A GitHub read example remains:

```text
mcp__github__search_pull_requests with query: "author:YOUR_USERNAME is:merged"
```

Check credential presence without displaying values:

```bash
test -n "${GITHUB_PAT:-}" && printf 'GITHUB_PAT is set\n'
test -n "${JIRA_EMAIL:-}" && test -n "${JIRA_API_TOKEN:-}" && printf 'Jira credentials are set\n'
test -n "${GITLAB_API_URL:-}" && printf 'GitLab environment base is set\n'
test -n "${GITLAB_PAT:-}" && printf 'GitLab token is set\n'
```

An unset GitLab environment base is acceptable when private QE configuration supplies `gitlab.api_url`. Do not echo tokens when diagnosing authentication.

## Direct API Commands

Run these from the repository root with Node 22+ and installed dependencies. Substitute the selected workflow's site hostname and repository; examples are read-only:

```bash
node --import tsx scripts/jira-rest.ts --help
node --import tsx scripts/jira-rest.ts --site your-site.atlassian.net search --jql 'assignee = currentUser() ORDER BY updated DESC' --fields summary,status --limit 3
node --import tsx scripts/jira-rest.ts --site your-site.atlassian.net issue --key PROJECT-123 --fields summary,description --comments --changelog
node --import tsx scripts/jira-rest.ts --site your-site.atlassian.net user-search --query 'Your Name'
node --import tsx scripts/gitlab-read.ts qe-context --project OWNER/REPO --issue-key PROJECT-123

# Equivalent npm entry points:
npm run jira:rest -- --site your-site.atlassian.net remote-links --key PROJECT-123
npm run gitlab:read -- qe-context --project OWNER/REPO --issue-key PROJECT-123
```

`user-search` returns account objects: use `accountId`, not visible email, for Jira account identifiers. Email visibility is not required.

Commands paginate internally. Search `--limit` is only for deliberately bounded lookups, not a replacement for complete collection. Jira search emits `{issues:[...]}`; issue reads retain native fields with description/comment text normalized from ADF, including status-badge text and negation, and full histories when requested. Workflows adapt these outputs to their existing CSV/JSON cache schemas. Root tools are invoked as standalone commands, never imported between agents.

Required Jira read failures stop the workflow before classification or approval. Optional GitLab context returns exit 3 with `{context:null,warnings:[...]}` on missing configuration/access or source failure; QE records the warning and proceeds without enrichment. Successful reads return exit 0 and one JSON value; diagnostics go to stderr. Neither command executes retrieved source.

Only the existing workflow-specific Jira write actions are available: fix versions, components, transitions, issue creation, and Relates links. They require prior workflow user approval and the mechanical `--approved` flag. Each command performs one mutation; existing per-agent writers and bulk-move operations remain in place. Creation/link payload files must be owned, single-link regular 0600 files in fresh owned 0700 scratch storage, not tracked configs. Do not use verification examples to mutate live Jira.

Successful `link-issues` creation returns `{}` for Jira's bodyless HTTP 201 response, as do bodyless HTTP 204 mutations. `create-issue` still requires a JSON creation response; an empty HTTP 201 is an error, not a created issue key.

## Project Manifests and Private Files

All four project manifests define only GitHub:

| Client or integration | Manifest             |
| --------------------- | -------------------- |
| Claude Code           | `.mcp.json`          |
| Cursor                | `.cursor/mcp.json`   |
| Codex                 | `.codex/config.toml` |
| Plugin integration    | `plugin-mcp.json`    |

The GitHub HTTP endpoint is `https://api.githubcopilot.com/mcp/`. Claude Code and Cursor resolve `${GITHUB_PAT}`; Codex uses `bearer_token_env_var`. No Jira/GitLab MCP setup is required.

**`.codex/config.toml` is tracked.** Its `.gitignore` entry does not make an already tracked file private. Keep it free of literal credentials and personal/internal configuration. Private team configs, caches, generated reports, research logs, and evidence must stay outside publication. Retain the existing exclusions for both legacy `agents/nmstate-cve-verification/data/output/` and current `agents/cve-verification-console-plugins/data/output/` evidence; renaming a workflow does not make its old outputs safe to publish.

## Console Plugin CVE Access

The [console plugin CVE verification agent](../agents/cve-verification-console-plugins/README.md) supports `nmstate-console-plugin` and `networking-console-plugin`. Source-first assessment requires Jira REST read credentials, ART/public source and advisory access, and private writable storage. The selected profile is checked against refreshed Jira technical identity for the requested numeric OCP minor and explicit or previously approved platform. Without explicit selection, exactly one profile must match; ambiguity requires a choice and no match blocks assessment. Mapped GA and pre-GA numeric minors are supported without source lifecycle admission. No cluster, kubeconfig, cluster login, or Jira write operation is needed.

Source assessment needs no registry/image tooling. Separately requested ART image assessment is limited to the selected profile's configured pre-GA streams and additionally requires `skopeo` and a borrowed Quay Basic-auth file, which is not modified or deleted. Image metadata/source-label assessment is not image-layer/runtime dependency verification; neither assessment establishes shipped-release remediation. Supported npm commands are `cve-verification-console-plugins:{art,read-jira,validate,summary,test}`. GitLab is not required.

## Troubleshooting

- **GitHub not listed:** check the client-specific manifest, trust the Codex project where applicable, and restart the client after pulling configuration changes.
- **Authentication failures:** check variable presence without printing values, repository/project access, and token permissions. Restart the client after changing its inherited environment.
- **Jira command rejected before transport:** use a DNS hostname for `--site`, supply both Jira variables, and check supported flags with `--help`. Do not use a URL or cloud UUID as the site.
- **GitLab enrichment unavailable:** check the configured HTTPS `/api/v4` base and access to the selected repository. The command uses MR `scope=all` internally and returns exit 3 rather than partial context on optional-source failure.
- **TypeScript commands unavailable:** check Node 22+ and installed root dependencies. There is no GitLab stdio server to install or browser Jira OAuth login to perform.
