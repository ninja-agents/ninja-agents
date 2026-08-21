import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// ── Types ──

interface TokenSeries {
  model: string;
  type: string;
  caching: string;
  tokens: number;
}

interface ModelPricing {
  input: number;
  output: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
}

interface Config {
  gcp: { project_id: string; monthly_budget?: number };
  pricing: Record<string, ModelPricing>;
}

interface LineItem {
  model: string;
  label: string;
  tokens: number;
  rate: number;
  cost: number;
}

interface DayCost {
  date: string;
  input: number;
  output: number;
  cache: number;
  total: number;
}

interface MonitoringPoint {
  interval: { startTime: string; endTime: string };
  value: { int64Value?: string; doubleValue?: number };
}

interface MonitoringTimeSeries {
  metric: { labels: Record<string, string> };
  resource: { labels: Record<string, string> };
  points: MonitoringPoint[];
}

interface MonitoringResponse {
  timeSeries?: MonitoringTimeSeries[];
  error?: { code: number; message: string };
}

// ── Helpers ──

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        [
          "Usage: vertex-billing.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--project ID] [--budget N] [--output PATH]",
          "",
          "Options:",
          "  --from      Start date (default: first of current month)",
          "  --to        End date inclusive (default: today)",
          "  --project   GCP project ID (default: from config.json)",
          "  --budget    Monthly budget cap in dollars (default: from config.json)",
          "  --output    Output markdown path (default: data/output/billing-report.md)",
          "",
          "Requires: gcloud CLI authenticated with access to the target project.",
        ].join("\n"),
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function getAccessToken(): string {
  return execSync("gcloud auth print-access-token", {
    encoding: "utf-8",
  }).trim();
}

async function queryMonitoring(
  projectId: string,
  token: string,
  metricType: string,
  startTime: string,
  endTime: string,
  alignmentPeriod: number,
): Promise<MonitoringTimeSeries[]> {
  const filter = `metric.type="${metricType}"`;
  const params = new URLSearchParams({
    filter,
    "interval.startTime": startTime,
    "interval.endTime": endTime,
    "aggregation.alignmentPeriod": `${alignmentPeriod}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
  });

  const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await resp.json()) as MonitoringResponse;
  if (data.error) {
    throw new Error(
      `Monitoring API error ${data.error.code}: ${data.error.message}`,
    );
  }
  return data.timeSeries ?? [];
}

function pointValue(pt: MonitoringPoint): number {
  return Number(pt.value.int64Value ?? pt.value.doubleValue ?? 0);
}

function sumPoints(points: MonitoringPoint[]): number {
  return points.reduce((sum, pt) => sum + pointValue(pt), 0);
}

function tokenCost(tokens: number, pricePerMTok: number): number {
  return (tokens / 1_000_000) * pricePerMTok;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pad(
  s: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  return align === "right" ? s.padStart(width) : s.padEnd(width);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ── Token type classification ──

interface TokenBreakdown {
  inputNocache: number;
  outputNocache: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  inputCached: number;
  outputCached: number;
}

function classifyTokens(tokensByKey: Map<string, number>): TokenBreakdown {
  return {
    inputNocache: tokensByKey.get("false:input") ?? 0,
    outputNocache: tokensByKey.get("false:output") ?? 0,
    cacheWrite5m: tokensByKey.get("true:cache_write_input") ?? 0,
    cacheWrite1h: tokensByKey.get("true:cache_write_1h_input") ?? 0,
    cacheRead: tokensByKey.get("true:cache_read_input") ?? 0,
    inputCached: tokensByKey.get("true:input") ?? 0,
    outputCached: tokensByKey.get("true:output") ?? 0,
  };
}

// CTT cost-weight formula (empirically verified to ±2%)
function expectedCTT(bd: TokenBreakdown): number {
  return (
    bd.cacheRead * 0.1 +
    (bd.cacheWrite5m + bd.cacheWrite1h) * 1.25 +
    (bd.inputNocache + bd.inputCached) * 1 +
    (bd.outputNocache + bd.outputCached) * 5
  );
}

// ── Daily breakdown ──

function buildDailyCosts(
  dailySeries: MonitoringTimeSeries[],
  config: Config,
): DayCost[] {
  // Group points by (date, model, caching:type)
  const dayModelTokens = new Map<string, Map<string, Map<string, number>>>();

  for (const ts of dailySeries) {
    const model = ts.resource.labels.model_user_id ?? "unknown";
    const type = ts.metric.labels.type ?? "unknown";
    const caching = ts.metric.labels.explicit_caching ?? "false";
    const key = `${caching}:${type}`;

    for (const pt of ts.points) {
      const date = pt.interval.endTime.slice(0, 10);
      const val = pointValue(pt);
      if (val <= 0) continue;

      if (!dayModelTokens.has(date)) dayModelTokens.set(date, new Map());
      const modelMap = dayModelTokens.get(date)!;
      if (!modelMap.has(model)) modelMap.set(model, new Map());
      const tokenMap = modelMap.get(model)!;
      tokenMap.set(key, (tokenMap.get(key) ?? 0) + val);
    }
  }

  const days: DayCost[] = [];

  for (const [date, modelMap] of dayModelTokens) {
    let dayInput = 0;
    let dayOutput = 0;
    let dayCache = 0;

    for (const [model, tokenMap] of modelMap) {
      const pricing = config.pricing[model];
      if (!pricing) continue;

      const bd = classifyTokens(tokenMap);
      dayInput +=
        tokenCost(bd.inputNocache, pricing.input) +
        tokenCost(bd.inputCached, pricing.input);
      dayOutput +=
        tokenCost(bd.outputNocache, pricing.output) +
        tokenCost(bd.outputCached, pricing.output);
      dayCache +=
        tokenCost(bd.cacheWrite5m, pricing.cache_write_5m) +
        tokenCost(bd.cacheWrite1h, pricing.cache_write_1h) +
        tokenCost(bd.cacheRead, pricing.cache_read);
    }

    days.push({
      date,
      input: dayInput,
      output: dayOutput,
      cache: dayCache,
      total: dayInput + dayOutput + dayCache,
    });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Main ──

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(import.meta.dirname, "../data/config.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;

  const projectId = args.project ?? config.gcp.project_id;
  const budget = args.budget
    ? parseFloat(args.budget)
    : (config.gcp.monthly_budget ?? null);

  const now = new Date();
  const fromDate =
    args.from ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const toDate = args.to ?? now.toISOString().slice(0, 10);

  const startTime = `${fromDate}T00:00:00Z`;
  const endTime = `${toDate}T23:59:59Z`;
  const periodSeconds = Math.ceil(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000,
  );

  console.log(`Querying Vertex AI billing for project ${projectId}`);
  console.log(`Period: ${fromDate} → ${toDate}`);
  if (budget !== null) console.log(`Budget: ${fmtDollars(budget)}`);
  console.log();

  const accessToken = getAccessToken();

  // Query token counts — full period + daily breakdown in parallel
  const [tokenSeries, dailySeries, cttSeries] = await Promise.all([
    queryMonitoring(
      projectId,
      accessToken,
      "aiplatform.googleapis.com/publisher/online_serving/token_count",
      startTime,
      endTime,
      periodSeconds,
    ),
    queryMonitoring(
      projectId,
      accessToken,
      "aiplatform.googleapis.com/publisher/online_serving/token_count",
      startTime,
      endTime,
      86400,
    ),
    queryMonitoring(
      projectId,
      accessToken,
      "aiplatform.googleapis.com/publisher/online_serving/consumed_token_throughput",
      startTime,
      endTime,
      periodSeconds,
    ),
  ]);

  // Parse full-period token data
  const entries: TokenSeries[] = [];
  for (const ts of tokenSeries) {
    const model = ts.resource.labels.model_user_id ?? "unknown";
    const type = ts.metric.labels.type ?? "unknown";
    const caching = ts.metric.labels.explicit_caching ?? "false";
    const tokens = sumPoints(ts.points);
    if (tokens > 0) {
      entries.push({ model, type, caching, tokens });
    }
  }

  if (entries.length === 0) {
    console.error("No token usage data found for this period.");
    process.exit(1);
  }

  // Group by model
  const byModel = new Map<string, TokenSeries[]>();
  for (const e of entries) {
    const group = byModel.get(e.model) ?? [];
    group.push(e);
    byModel.set(e.model, group);
  }

  // Calculate costs per model
  let grandTotal = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheHitTokens = 0;
  let totalCacheWriteTokens = 0;
  let hypotheticalNoCacheCost = 0;

  const modelSummaries: {
    model: string;
    items: LineItem[];
    subtotal: number;
    totalTokens: number;
    breakdown: TokenBreakdown;
  }[] = [];

  const sortedModels = [...byModel.entries()].sort(
    (a, b) =>
      b[1].reduce((s, e) => s + e.tokens, 0) -
      a[1].reduce((s, e) => s + e.tokens, 0),
  );

  for (const [model, series] of sortedModels) {
    const pricing = config.pricing[model];
    if (!pricing) {
      console.warn(
        `No pricing config for model "${model}" — skipping cost calculation`,
      );
      continue;
    }

    const items: LineItem[] = [];
    const tokensByKey = new Map<string, number>();
    for (const s of series) {
      const key = `${s.caching}:${s.type}`;
      tokensByKey.set(key, (tokensByKey.get(key) ?? 0) + s.tokens);
    }

    const bd = classifyTokens(tokensByKey);

    const addItem = (label: string, tokens: number, rate: number) => {
      if (tokens > 0) {
        const c = tokenCost(tokens, rate);
        items.push({ model, label, tokens, rate, cost: c });
        grandTotal += c;
      }
    };

    addItem("Input (no cache)", bd.inputNocache, pricing.input);
    addItem("Output (no cache)", bd.outputNocache, pricing.output);
    addItem("Cache Write (5m)", bd.cacheWrite5m, pricing.cache_write_5m);
    addItem("Cache Write (1h)", bd.cacheWrite1h, pricing.cache_write_1h);
    addItem("Cache Hit (read)", bd.cacheRead, pricing.cache_read);
    addItem("Input (cached req)", bd.inputCached, pricing.input);
    addItem("Output (cached req)", bd.outputCached, pricing.output);

    const modelTotal = items.reduce((s, i) => s + i.cost, 0);
    const modelTokens = items.reduce((s, i) => s + i.tokens, 0);

    totalInputTokens +=
      bd.inputNocache +
      bd.inputCached +
      bd.cacheWrite5m +
      bd.cacheWrite1h +
      bd.cacheRead;
    totalOutputTokens += bd.outputNocache + bd.outputCached;
    totalCacheHitTokens += bd.cacheRead;
    totalCacheWriteTokens += bd.cacheWrite5m + bd.cacheWrite1h;

    const allInput =
      bd.inputNocache +
      bd.inputCached +
      bd.cacheWrite5m +
      bd.cacheWrite1h +
      bd.cacheRead;
    const allOutput = bd.outputNocache + bd.outputCached;
    hypotheticalNoCacheCost +=
      tokenCost(allInput, pricing.input) + tokenCost(allOutput, pricing.output);

    modelSummaries.push({
      model,
      items,
      subtotal: modelTotal,
      totalTokens: modelTokens,
      breakdown: bd,
    });
  }

  // Cross-validate with consumed_token_throughput
  let cttWarning: string | null = null;
  if (cttSeries.length > 0 && modelSummaries.length > 0) {
    for (const ms of modelSummaries) {
      if (ms.subtotal < 1) continue;
      const expected = expectedCTT(ms.breakdown);
      const actual = cttSeries
        .filter((ts) => ts.resource.labels.model_user_id === ms.model)
        .reduce((sum, ts) => sum + sumPoints(ts.points), 0);

      if (actual > 0 && expected > 0) {
        const divergence = Math.abs(actual - expected) / expected;
        if (divergence > 0.05) {
          cttWarning = `CTT cross-check: ${ms.model} diverges ${(divergence * 100).toFixed(1)}% from expected (actual ${fmtTokens(actual)} vs expected ${fmtTokens(expected)}). Untracked tokens (e.g. extended thinking) may be contributing.`;
        }
      }
    }
  }

  // Build daily costs
  const dailyCosts = buildDailyCosts(dailySeries, config);

  // Projection — use calendar days elapsed, not just days with data
  const fromParts = fromDate.split("-").map(Number);
  const calendarDaysElapsed = Math.max(
    1,
    Math.ceil(
      (new Date(toDate).getTime() - new Date(fromDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1,
  );
  const totalDaysInMonth = daysInMonth(fromParts[0], fromParts[1]);
  const dailyAvg = grandTotal / calendarDaysElapsed;
  const projectedMonthEnd = dailyAvg * totalDaysInMonth;

  // ── Console output ──
  const divider = "=".repeat(72);
  const lines: string[] = [];

  lines.push(divider);
  lines.push(`VERTEX AI BILLING REPORT — ${fromDate} to ${toDate}`);
  lines.push(`Project: ${projectId}`);
  lines.push(divider);

  // Budget section
  if (budget !== null) {
    const remaining = budget - grandTotal;
    const pctUsed = (grandTotal / budget) * 100;
    lines.push("");
    lines.push("BUDGET");
    lines.push(`  Monthly cap:              ${fmtDollars(budget)}`);
    lines.push(`  Metered spend:            ${fmtDollars(grandTotal)}`);
    lines.push(
      `  Remaining (est.):         ${fmtDollars(Math.max(0, remaining))} (${(100 - pctUsed).toFixed(1)}%)`,
    );
    lines.push(
      `  Projected month-end:      ${fmtDollars(projectedMonthEnd)}${projectedMonthEnd > budget ? " ⚠ OVER BUDGET" : ""}`,
    );
    lines.push(`  Daily average:            ${fmtDollars(dailyAvg)}/day`);
    lines.push(
      `  Safe daily rate:          ${fmtDollars(budget / totalDaysInMonth)}/day`,
    );
  }

  // Per-model breakdown
  for (const ms of modelSummaries) {
    const pct =
      grandTotal > 0 ? ((ms.subtotal / grandTotal) * 100).toFixed(1) : "0";
    lines.push("");
    lines.push(`▸ ${ms.model} (${pct}% of total)`);
    lines.push(
      `  ${pad("Token Type", 26)} ${pad("Tokens", 14, "right")} ${pad("Rate", 12, "right")} ${pad("Cost", 10, "right")}`,
    );
    lines.push(
      `  ${"-".repeat(26)} ${"-".repeat(14)} ${"-".repeat(12)} ${"-".repeat(10)}`,
    );

    for (const item of ms.items) {
      lines.push(
        `  ${pad(item.label, 26)} ${pad(fmtTokens(item.tokens), 14, "right")} ${pad(fmtDollars(item.rate) + "/MTok", 12, "right")} ${pad(fmtDollars(item.cost), 10, "right")}`,
      );
    }
    lines.push(
      `  ${" ".repeat(26)} ${" ".repeat(14)} ${" ".repeat(12)} ${"─".repeat(10)}`,
    );
    lines.push(
      `  ${pad("Subtotal", 26)} ${" ".repeat(14)} ${" ".repeat(12)} ${pad(fmtDollars(ms.subtotal), 10, "right")}`,
    );
  }

  lines.push("");
  lines.push(divider);
  lines.push(
    `  ${pad("METERED TOTAL", 26)} ${" ".repeat(14)} ${" ".repeat(12)} ${pad(fmtDollars(grandTotal), 10, "right")}`,
  );
  lines.push(divider);

  // Daily breakdown
  if (dailyCosts.length > 0) {
    lines.push("");
    lines.push("DAILY BREAKDOWN");
    lines.push(
      `  ${pad("Date", 12)} ${pad("Input", 10, "right")} ${pad("Output", 10, "right")} ${pad("Cache", 10, "right")} ${pad("Total", 10, "right")}`,
    );
    lines.push(
      `  ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`,
    );

    for (const day of dailyCosts) {
      lines.push(
        `  ${pad(day.date, 12)} ${pad(fmtDollars(day.input), 10, "right")} ${pad(fmtDollars(day.output), 10, "right")} ${pad(fmtDollars(day.cache), 10, "right")} ${pad(fmtDollars(day.total), 10, "right")}`,
      );
    }

    lines.push(
      `  ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`,
    );
    lines.push(
      `  ${pad("Daily avg", 12)} ${" ".repeat(10)} ${" ".repeat(10)} ${" ".repeat(10)} ${pad(fmtDollars(dailyAvg), 10, "right")}`,
    );
    lines.push(
      `  ${pad("Projected", 12)} ${" ".repeat(10)} ${" ".repeat(10)} ${" ".repeat(10)} ${pad(fmtDollars(projectedMonthEnd), 10, "right")}`,
    );
  }

  // Stats
  const cacheHitRate =
    totalInputTokens > 0
      ? ((totalCacheHitTokens / totalInputTokens) * 100).toFixed(1)
      : "0";
  const savings = hypotheticalNoCacheCost - grandTotal;

  lines.push("");
  lines.push("KEY METRICS");
  lines.push(`  Total input tokens:       ${fmtTokens(totalInputTokens)}`);
  lines.push(`  Total output tokens:      ${fmtTokens(totalOutputTokens)}`);
  lines.push(`  Cache hit rate:           ${cacheHitRate}%`);
  lines.push(`  Cache hit tokens:         ${fmtTokens(totalCacheHitTokens)}`);
  lines.push(`  Cache write tokens:       ${fmtTokens(totalCacheWriteTokens)}`);
  lines.push(
    `  Without caching:          ${fmtDollars(hypotheticalNoCacheCost)}`,
  );
  lines.push(
    `  Caching savings:          ${fmtDollars(savings)} (${hypotheticalNoCacheCost > 0 ? ((savings / hypotheticalNoCacheCost) * 100).toFixed(0) : 0}% reduction)`,
  );

  if (cttWarning) {
    lines.push("");
    lines.push(`⚠ ${cttWarning}`);
  }

  lines.push("");
  lines.push(
    "NOTE: Metered total is a lower bound. Monitoring metrics can lag ~24 hours,",
  );
  lines.push(
    "and extended thinking tokens (Opus) may not be tracked. Both contribute to",
  );
  lines.push("a gap between this total and your actual bill.");

  const output = lines.join("\n");
  console.log(output);

  // ── Write markdown report ──
  const outputPath =
    args.output ??
    resolve(import.meta.dirname, "../data/output/billing-report.md");
  const md = generateMarkdown(
    fromDate,
    toDate,
    projectId,
    budget,
    modelSummaries,
    grandTotal,
    dailyCosts,
    {
      totalInputTokens,
      totalOutputTokens,
      totalCacheHitTokens,
      totalCacheWriteTokens,
      cacheHitRate,
      hypotheticalNoCacheCost,
      savings,
      dailyAvg,
      projectedMonthEnd,
      totalDaysInMonth,
    },
    cttWarning,
  );
  writeFileSync(outputPath, md);
  console.log(`\nReport written to ${outputPath}`);
}

function generateMarkdown(
  fromDate: string,
  toDate: string,
  projectId: string,
  budget: number | null,
  modelSummaries: {
    model: string;
    items: LineItem[];
    subtotal: number;
  }[],
  grandTotal: number,
  dailyCosts: DayCost[],
  stats: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheHitTokens: number;
    totalCacheWriteTokens: number;
    cacheHitRate: string;
    hypotheticalNoCacheCost: number;
    savings: number;
    dailyAvg: number;
    projectedMonthEnd: number;
    totalDaysInMonth: number;
  },
  cttWarning: string | null,
): string {
  const lines: string[] = [];

  lines.push(`# Vertex AI Billing Report`);
  lines.push("");
  lines.push(`**Period:** ${fromDate} to ${toDate}`);
  lines.push(`**Project:** ${projectId}`);
  lines.push(`**Metered Total:** ${fmtDollars(grandTotal)}`);
  if (budget !== null) {
    const remaining = Math.max(0, budget - grandTotal);
    lines.push(`**Budget:** ${fmtDollars(budget)}`);
    lines.push(`**Remaining (est.):** ${fmtDollars(remaining)}`);
    lines.push(
      `**Projected month-end:** ${fmtDollars(stats.projectedMonthEnd)}${stats.projectedMonthEnd > budget ? " ⚠ OVER BUDGET" : ""}`,
    );
  }
  lines.push("");

  // Budget summary table
  if (budget !== null) {
    lines.push("## Budget Status");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Monthly cap | ${fmtDollars(budget)} |`);
    lines.push(`| Metered spend | ${fmtDollars(grandTotal)} |`);
    lines.push(
      `| Remaining (est.) | ${fmtDollars(Math.max(0, budget - grandTotal))} |`,
    );
    lines.push(`| Daily average | ${fmtDollars(stats.dailyAvg)}/day |`);
    lines.push(
      `| Safe daily rate | ${fmtDollars(budget / stats.totalDaysInMonth)}/day |`,
    );
    lines.push(
      `| Projected month-end | ${fmtDollars(stats.projectedMonthEnd)} |`,
    );
    lines.push("");
  }

  lines.push("## Breakdown by Model");
  lines.push("");

  for (const ms of modelSummaries) {
    const pct =
      grandTotal > 0 ? ((ms.subtotal / grandTotal) * 100).toFixed(1) : "0";
    lines.push(`### ${ms.model} (${pct}% — ${fmtDollars(ms.subtotal)})`);
    lines.push("");
    lines.push("| Token Type | Tokens | Rate | Cost |");
    lines.push("|------------|--------|------|------|");

    for (const item of ms.items) {
      lines.push(
        `| ${item.label} | ${fmtTokens(item.tokens)} | ${fmtDollars(item.rate)}/MTok | ${fmtDollars(item.cost)} |`,
      );
    }
    lines.push("");
  }

  // Daily breakdown
  if (dailyCosts.length > 0) {
    lines.push("## Daily Breakdown");
    lines.push("");
    lines.push("| Date | Input | Output | Cache | Total |");
    lines.push("|------|-------|--------|-------|-------|");

    for (const day of dailyCosts) {
      lines.push(
        `| ${day.date} | ${fmtDollars(day.input)} | ${fmtDollars(day.output)} | ${fmtDollars(day.cache)} | ${fmtDollars(day.total)} |`,
      );
    }

    lines.push(`| **Daily avg** | | | | **${fmtDollars(stats.dailyAvg)}** |`);
    lines.push(
      `| **Projected** | | | | **${fmtDollars(stats.projectedMonthEnd)}** |`,
    );
    lines.push("");
  }

  lines.push("## Key Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total input tokens | ${fmtTokens(stats.totalInputTokens)} |`);
  lines.push(`| Total output tokens | ${fmtTokens(stats.totalOutputTokens)} |`);
  lines.push(`| Cache hit rate | ${stats.cacheHitRate}% |`);
  lines.push(`| Cache hit tokens | ${fmtTokens(stats.totalCacheHitTokens)} |`);
  lines.push(
    `| Cache write tokens | ${fmtTokens(stats.totalCacheWriteTokens)} |`,
  );
  lines.push(
    `| Without caching | ${fmtDollars(stats.hypotheticalNoCacheCost)} |`,
  );
  lines.push(
    `| Caching savings | ${fmtDollars(stats.savings)} (${stats.hypotheticalNoCacheCost > 0 ? ((stats.savings / stats.hypotheticalNoCacheCost) * 100).toFixed(0) : 0}% reduction) |`,
  );
  lines.push("");

  if (cttWarning) {
    lines.push(`> ⚠ ${cttWarning}`);
    lines.push("");
  }

  lines.push(
    "> **Note:** Metered total is a lower bound. Monitoring metrics can lag ~24 hours,",
  );
  lines.push(
    "> and extended thinking tokens (Opus) may not be tracked. Both contribute to a",
  );
  lines.push("> gap between this total and your actual bill.");
  lines.push("");

  return lines.join("\n");
}

const isDirectRun = process.argv[1]?.endsWith("vertex-billing.ts");
if (isDirectRun)
  main().catch((e) => {
    console.error(`Error: ${String(e)}`);
    process.exit(1);
  });
