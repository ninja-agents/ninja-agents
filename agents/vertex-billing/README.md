# Vertex Billing

Query Vertex AI Claude usage from Google Cloud Monitoring and calculate costs.

## Prerequisites

- **gcloud CLI** — authenticated with access to the target GCP project
- No MCP servers required

## Usage

```bash
# Current month (default)
npm run vertex-billing

# Custom date range
npm run vertex-billing -- --from 2026-08-01 --to 2026-08-21

# With budget tracking (or set monthly_budget in config.json)
npm run vertex-billing -- --budget 300

# Different project
npm run vertex-billing -- --project my-other-project
```

### Options

| Flag        | Default                         | Description                     |
| ----------- | ------------------------------- | ------------------------------- |
| `--from`    | First of current month          | Start date (YYYY-MM-DD)         |
| `--to`      | Today                           | End date inclusive (YYYY-MM-DD) |
| `--project` | From config.json                | GCP project ID                  |
| `--budget`  | From config.json                | Monthly budget cap in dollars   |
| `--output`  | `data/output/billing-report.md` | Output path                     |

### Accuracy Notes

- Monitoring metrics can lag **~24 hours** behind actual usage
- Extended thinking tokens (Opus) may not appear in metrics
- The metered total should be treated as a **lower bound** of actual spend

## How It Works

1. Gets an access token via `gcloud auth print-access-token`
2. Queries `aiplatform.googleapis.com/publisher/online_serving/token_count` from Cloud Monitoring
3. Breaks down tokens by model, type (input/output), and caching tier (write/hit/none)
4. Applies pricing from `data/config.json` to calculate costs
5. Outputs a console summary and markdown report

## Configuration

Edit `data/config.json` to update:

- `gcp.project_id` — default GCP project
- `gcp.monthly_budget` — default monthly budget cap (dollars)
- `pricing` — per-model rates ($/MTok) from [Google Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing#claude-models)

## File Layout

```
agents/vertex-billing/
├── README.md
├── scripts/
│   └── vertex-billing.ts
└── data/
    ├── config.json         # Project ID and pricing rates
    ├── cache/              # (unused)
    └── output/
        └── billing-report.md
```
