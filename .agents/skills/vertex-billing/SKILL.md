---
name: vertex-billing
description: Query Vertex AI Codex usage and calculate billing breakdown from Cloud Monitoring
user-invocable: true
---

Query Vertex AI token usage from Google Cloud Monitoring and calculate a billing breakdown by model and caching tier.

## Usage

```bash
/vertex-billing
```

Optional arguments: `--from 2026-08-01 --to 2026-08-21`, `--budget 300`, or `--project other-project-id`.

## What This Does

Runs the vertex-billing script which:

1. Authenticates via `gcloud auth print-access-token`
2. Queries `aiplatform.googleapis.com/publisher/online_serving/token_count` from Cloud Monitoring
3. Breaks down tokens by model, type (input/output), and caching tier (5m write, 1h write, cache hit)
4. Applies pricing from `agents/vertex-billing/data/config.json`
5. Outputs a console summary and saves a markdown report

**Time:** ~5 seconds

## Expected Output

A billing report showing:

- **Budget status** — spend vs. cap, remaining budget, projected month-end, safe daily rate
- **Per-model breakdown** — token counts and costs for each Codex model used
- **Daily breakdown** — per-day cost table with daily average and month-end projection
- **Caching analysis** — cache hit rate, write vs. hit tokens, savings vs. no-cache baseline
- **Key metrics** — total input/output tokens, cache efficiency
- **CTT cross-check** — sanity check against consumed_token_throughput metric

Report saved to `agents/vertex-billing/data/output/billing-report.md`.

## How to Run

```bash
npm run vertex-billing -- --from YYYY-MM-DD --to YYYY-MM-DD
```

Defaults: current month to today, project from config.json.

## Critical Rules

1. Requires `gcloud` CLI authenticated with access to the target project
2. Extended thinking tokens (Opus) may not appear in monitoring — the report notes this gap
3. Update pricing in `agents/vertex-billing/data/config.json` when Google changes rates
