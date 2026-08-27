---
name: jira-qe-story
description: Generate a QE story from a dev Jira story with acceptance criteria and test scenarios, then create it in Jira
argument-hint: [<JIRA-KEY> [--repo owner/repo] [--project KEY] [--assignee ID]]
arguments: [jira_key]
user-invocable: true
disable-model-invocation: true
---

Generate a QE (Quality Engineering) story from a dev Jira story, preview it for approval, then create it in Jira and link it to the original.

## Usage

```bash
/jira-qe-story CNV-12345
/jira-qe-story MTV-5678 --repo kubev2v/forklift-console-plugin
/jira-qe-story CNV-12345 --project OCPBUGS --assignee 712020:abc123
```

## What This Does

Launches the `jira-qe-story` agent which:

1. Reads config and parses arguments (Jira key required)
2. Fetches the dev story from Jira
3. Optionally fetches repo context (README, related PRs/MRs) for richer criteria
4. Generates QE story content: description, acceptance criteria, test scenarios
5. Formats and displays a preview
6. Waits for explicit user approval before creating anything
7. Creates the QE story in Jira and links it to the dev story (Clones link)
8. Displays the result with a link to the created issue

## Expected Output

A new Jira story in the target project with:

- Summary prefixed with `[QE]`
- Description with acceptance criteria and test scenarios
- Clones link to the original dev story
- Labels, priority, and story points from config/arguments

## Critical Rules

1. **No Jira issue is created without explicit user approval** — the agent always previews first
2. Config-driven defaults (project, assignee, labels) can be overridden via CLI arguments
3. Repo context is optional — the agent works fine without it
4. Only the Jira issue key argument is required; everything else has defaults
