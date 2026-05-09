---
name: repo-contextification
description: Audit a repository for foundational docs (README, CONTRIBUTING, AGENTS, ARCHITECTURE) and AI tooling config, then scaffold missing files in one pass
user-invocable: true
disable-model-invocation: true
---

Audit a repository for documentation completeness and AI-readiness, then scaffold missing files in one pass. Skips already-complete files.

## Usage

```bash
/repo-contextification
```

## What This Does

Launches the `repo-contextification` agent which:

1. Identifies the target repo (local or GitHub)
2. Scans for required documentation files and checks their completeness
3. Presents a gap analysis with AI-readiness score
4. Reads the codebase deeply to understand patterns and conventions
5. Generates all missing docs and AI tooling config in one pass
6. Validates all generated files for completeness and link integrity
7. Runs two review rounds to improve content quality and accuracy, then suggests agent improvements

## Expected Output

- Gap analysis report showing present/missing files with completeness scores
- Generated documentation files: README.md, CONTRIBUTING.md, AGENTS.md, ARCHITECTURE.md
- AI tooling config: .coderabbit.yaml
- Final summary with updated AI-readiness score

## Critical Rules

- Generates all files in one pass — no per-file approval prompts
- Never fabricates architectural details — asks when unsure
- Preserves existing content when updating files
- No secrets, internal URLs, or PII in generated documentation
