---
name: team-update-publish
description: Publish only the approved Summary from a weekly team report through the configured fork and open a PR.
---

# Publish an approved team update summary

Use this separately from `/team-update`, after the user has reviewed its report. Work from the `ninja-agents` repository root. Do not regenerate or rewrite the approved report.

## 1. Select and validate the source

- Use the specific `agents/weekly-team-update/data/output/weekly-update-YYYY-MM-DD.md` report the user approved. If the approved file is unclear, identify the candidate and confirm it before preparing a PR.
- Run `npx tsx agents/weekly-team-update/scripts/validate-report-links.ts <report> --verbose`. Stop on broken links or an incomplete report.
- Read `publishing.github_repository` (the PR base) and `publishing.github_fork` (the only push destination) from the gitignored `agents/weekly-team-update/data/team-config.json`. Require two distinct, real `OWNER/REPO` values, not example placeholders. Never put either value in tracked files or the PR description.
- Use `gh` to verify the configured fork's parent is the configured base and the authenticated user can push to the fork. If unavailable, report the missing prerequisite. Do not push report branches to the base repository.

## 2. Prepare the exact file for review

1. Clone the fork into a fresh temporary directory with `GIT_CONFIG_GLOBAL=/dev/null git -c credential.helper='!gh auth git-credential' clone https://github.com/<configured fork>.git <temporary-checkout>`. Add the configured base as an `upstream` HTTPS remote, fetch `upstream/main` with the same Git settings, and check out that commit for the report. The Git settings avoid local SSH URL rewrites. Keep this repository's working tree untouched.
2. Run `npx tsx agents/weekly-team-update/scripts/prepare-summary.ts <report> <temporary-checkout>` from the `ninja-agents` root. The helper copies only `## Summary`, including Highlights and product subsections, to `reports/YYYY/YYYY-MM-DD/vme/cx/mnf.md`. The folder date is the Friday in the source report's Monday-Sunday week. It fails if that file already exists; stop and ask for direction in that case.
3. Mark only the target file with `git add -N`, then run `git diff --check` and display the complete proposed file, its target path, `git diff -- <target>`, and `git status --short --untracked-files=all` from the temporary checkout. Verify that the target file is the only change. Run any Markdown checks that apply to reports in the destination repository. If a check requires edits, show the issue and wait for a revised approved report.
4. Ask: `Push this exact summary file to <configured fork> and open a PR against <configured base>?` Show both actual repositories in the prompt and wait for explicit approval. An earlier approval of the report alone does not approve the push.

## 3. Publish after approval

1. Refresh `upstream/main` and stop if the target file has appeared since preview. Stop if branch `report-YYYY-MM-DD-vme-cx-mnf` already exists on the fork (`origin`).
2. Create that branch from the refreshed `upstream/main`, stage only the target `mnf.md`, run `git diff --cached --check`, and verify the staged path list contains exactly that file.
3. Make exactly one commit for the PR, titled `VME CX: Migrations & Networking Frontend weekly status for YYYY-MM-DD`, where the date is the week-ending Friday. Verify `origin` is the configured fork, then push the branch there over HTTPS with `GIT_CONFIG_GLOBAL=/dev/null git -c credential.helper='!gh auth git-credential' push -u origin <branch>`.
4. Open the PR against `main` of the configured base with `gh pr create --repo <base> --base main --head <fork-owner>:<branch>`, the same title, and a manager-facing description that names the VME CX Migrations & Networking Frontend team and the actual week-ending Friday, such as `Weekly highlights and product updates for the VME CX Migrations & Networking Frontend team, covering the week ending October 2, 2026.` Do not mention the local source report, its filename, the extraction workflow, or approval mechanics in the commit message, PR title, or PR description.
5. Report the PR link and verify its head repository is the configured fork, it has exactly one commit, and its changed-file list contains only the target `mnf.md`. Do not merge the PR.

## Revising an open PR

Keep the PR at exactly one commit. For a requested revision on a branch created by this workflow, first verify its head repository is the configured fork, its remote head still matches the commit you expect, and the branch has no unrelated changes. Amend the sole commit, or squash this workflow's existing commits into one, then push to the fork with an explicit `--force-with-lease` for the verified remote head. Stop if the remote branch changed unexpectedly; never overwrite another contributor's work. Keep the public wording generic as above.

If any step fails, report the error and the state reached. Never publish the rest of the report or replace an existing weekly file without new direction.
