# Sprint Planning Health-Check

Analyzes a future or upcoming Jira sprint by comparing the plan against proven velocity from the past 3 sprints. Produces a health-check report with capacity analysis, load distribution, individual velocity averages, retro compliance checks, carryover tracking, planning hygiene flags, and actionable recommendations. Past sprint velocity data is persistently cached to avoid re-fetching from Jira on subsequent runs.

## Prerequisites

- **Node.js 22+ and installed root dependencies** — run commands from the repository root.
- **Jira REST credentials** — `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment for reads.
- **Shared private sprint config** — `agents/sprint-review/data/sprint-config.json` (see the sprint-review example).

The existing collector reads Jira directly; no Jira MCP server is required. Set credentials before launching your IDE, never in command arguments or report/cache files. See the [setup guide](../../docs/mcp-setup.md).

## Usage

### Claude Code

```bash
/sprint-planning-analysis                              # auto-discovers the next/future sprint
/sprint-planning-analysis "Your Team Sprint 3"  # analyze a specific sprint
```

### Cursor

Mention `@sprint-planning-analysis` in chat, or describe what you need:

> "Analyze the upcoming sprint planning health"

### Manual

```bash
node --import tsx agents/sprint-planning-analysis/scripts/fetch-data.ts
# Or select a sprint: node --import tsx agents/sprint-planning-analysis/scripts/fetch-data.ts --sprint "Your Team Sprint 3"
npx tsx agents/sprint-planning-analysis/scripts/generate-sprint-planning-analysis.ts \
  --date 2026-05-18 \
  --target-csv agents/sprint-planning-analysis/data/cache/sprint-issues.csv \
  --velocity-file agents/sprint-planning-analysis/data/cache/velocity-summary.json \
  --velocity-history agents/sprint-planning-analysis/data/cache/velocity-history.json \
  --config agents/sprint-review/data/sprint-config.json
```

## How It Works

1. **Read config** — `scripts/fetch-data.ts` loads shared `sprint-config.json` and determines the target sprint through the Jira REST API (from argument or auto-discovery)
2. **Find velocity baseline (N-1)** — the collector checks velocity history cache, then sprint review report, CSV cache, or Jira REST as fallback; writes `velocity-summary.json` and upserts into `velocity-history.json`
3. **Find velocity baselines (N-2, N-3)** — checks velocity history cache first; fetches directly from Jira only if not cached; upserts into `velocity-history.json`
4. **Fetch target sprint** — fetches fresh target-sprint issues directly from Jira each run and saves to this agent's CSV cache
5. **Generate report** — TypeScript script computes capacity vs. velocity, load distribution, individual velocity averages (3-sprint), retro compliance, carryover analysis, planning hygiene, and recommendations
6. **Write takeaways** — agent writes 3-5 Key Takeaway bullets synthesizing the analysis
7. **Display** — shows the report to the user

If the collector exits 1, display its diagnostic and STOP before analysis; do not proceed with empty data or introduce a second root-CLI collection path.

### Completed-work credit

Recommendations retain work already completed in the **target sprint**. Only exact
`resolution = "Done"` earns credit, regardless of status or completion date;
completed work stays recorded in that sprint. Duplicate-resolution issues are
excluded from eligible load and recommended for removal. Historical velocity
and previous-sprint caches are unchanged.

- **Individual recommended total SP** = historical average × available capacity
  (PTO or shorter sprint), rounded to two decimals, **plus already-Done target SP**.
  Credit is added after the capacity adjustment, never reduced for PTO.
- **Remaining load ratio** = unfinished target SP ÷ adjusted historical capacity.
  Rebalancing and defer amounts apply only to unfinished work.
- **Team recommended total SP** = existing team historical average + target Done
  SP, counting each issue once. Team risk and the 10% stretch compare remaining
  work to historical velocity; the stretch does not multiply completed credit.
- Existing ownership applies: assignee plus a distinct configured QE QA contact
  may each receive individual credit; team totals still count the issue once.
- Without history, reports show **no baseline**, not a sustainable capacity.
  Known zero capacity with unfinished work is extreme; completed work alone is not.

Example: 20 SP average + 6 SP already Done recommends **26 total SP**, leaving
20 SP of capacity for unfinished work. At 50% availability, it recommends
**16 total SP** (10 remaining capacity + 6 Done), not 13 SP.

### Planning DMs

Each eligible engineer's primary DM contains two sentences: planned SP, historical
average with a chronological per-sprint breakdown, and “let's plan accordingly”.
Historical zero values remain `0`; missing sprint entries remain `-`. Engineers
without a velocity baseline do not receive a primary DM.

Completed credit, PTO/shorter-sprint capacity adjustments, recommendations and
risks remain in the detailed report sections. Tech-lead direct-report bullets
retain their detailed credit, remaining work, capacity, recommendations and risk.

Eligible primary DMs get a separate drop/keep question for unfinished,
non-Duplicate items with full target membership and more than one distinct
started Jira sprint ID. Only `closed` and `active` memberships count; all `future`
memberships, including an upcoming target, are excluded independently of the
velocity lookback. Each linked item lists only its started-sprint count and names.
Ownership follows the assignee plus a distinct configured QE QA contact; a tech
lead does not inherit direct-report items. Known zero historical averages remain
eligible; engineers without a baseline receive neither message.

The collector appends `sprint_history` as CSV-escaped JSON of normalized
`{id, name, state}` memberships, including future ones, without changing the
original 18 fields. IDs must be positive safe integers; names are trimmed; state
must be exactly `closed`, `active` or `future`. Repeated IDs must agree on both name
and state or the entire history is unknown. Old 18-column caches, ID/name-only
histories and malformed/absent lifecycle evidence still load, but a coverage
warning requests a Jira refresh when unfinished items lack usable full
target-sprint membership. State is never inferred from dates, names, target
membership, carryover or velocity.
These questions request an engineer decision only: no issues are removed and no
SP, capacity, recommendations or primary DM wording change.

## Configuration

This agent uses the same config as `sprint-review`:

```
agents/sprint-review/data/sprint-config.json
```

See the sprint-review agent's `sprint-config.example.json` for the schema. Key fields:

- `board_id` — Jira Scrum board ID
- `engineers[]` — team roster with `jira_account_id`, `jira_display_names`, and `role` (dev/qe)
- `statuses` — status group mappings (not_started, in_progress, testing, done)
- `thresholds` — configurable analysis thresholds

## File Layout

```
agents/sprint-planning-analysis/
├── README.md
├── scripts/
│   ├── fetch-data.ts                              # Direct Jira REST collector
│   ├── generate-sprint-planning-analysis.ts       # analysis engine
│   └── generate-sprint-planning-analysis.test.ts  # unit tests
└── data/
    ├── cache/
    │   ├── sprint-issues.csv             # target sprint issues (rebuilt each run)
    │   ├── velocity-summary.json         # N-1 sprint velocity (rebuilt each run)
    │   └── velocity-history.json         # persistent multi-sprint velocity cache
    └── output/
        └── sprint-planning-analysis-{date}.md     # health-check report
```
