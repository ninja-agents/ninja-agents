import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface SizingEntry {
  label: string;
  effort: string;
  description: string;
}

interface Project {
  key: string;
  name: string;
  description?: string;
  repos?: string[];
}

interface Config {
  jira: { max_reference_tickets: number };
  sizing_guide: Record<string, SizingEntry>;
  projects?: Project[];
}

interface ReferenceTicket {
  key: string;
  summary: string;
  description: string;
  story_points: number;
  issuetype: string;
  priority: string;
  labels: string[];
  components: string[];
  status: string;
  resolution: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: build-reference.ts --config <path> --cache <dir> --output <path>",
      );
      console.log(
        "\nReads cached Jira tickets JSON, builds a reference summary for SP estimation.",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as Config;
}

function loadTickets(cachePath: string): ReferenceTicket[] {
  if (!existsSync(cachePath)) {
    console.error(`Reference tickets not found: ${cachePath}`);
    process.exit(1);
  }
  const data = JSON.parse(
    readFileSync(cachePath, "utf-8"),
  ) as ReferenceTicket[];
  if (!Array.isArray(data) || data.length === 0) {
    console.error("Reference tickets file is empty or not an array");
    process.exit(2);
  }
  for (const t of data) {
    if (t.story_points < 2) t.story_points = 2;
  }
  return data;
}

function buildReference(tickets: ReferenceTicket[], config: Config): string {
  const lines: string[] = [];
  lines.push("# Story Point Reference Data");
  lines.push("");
  lines.push(`Total reference tickets: ${String(tickets.length)}`);
  lines.push("");

  lines.push("## Sizing Guide");
  lines.push("");
  lines.push("| SP | Size | Effort | Description |");
  lines.push("|----|------|--------|-------------|");
  for (const [sp, info] of Object.entries(config.sizing_guide)) {
    lines.push(
      `| ${sp} | ${info.label} | ${info.effort} | ${info.description} |`,
    );
  }
  lines.push("");

  if (config.projects && config.projects.length > 0) {
    lines.push("## Products");
    lines.push("");
    lines.push("| Project | Description | Repos |");
    lines.push("|---------|-------------|-------|");
    for (const p of config.projects) {
      const repos = p.repos?.join(", ") ?? "-";
      lines.push(
        `| ${p.key} — ${p.name} | ${p.description ?? "-"} | ${repos} |`,
      );
    }
    lines.push("");
  }

  const spGroups: Record<string, ReferenceTicket[]> = {};
  for (const t of tickets) {
    const sp = String(t.story_points);
    if (!spGroups[sp]) spGroups[sp] = [];
    spGroups[sp].push(t);
  }

  lines.push("## Distribution");
  lines.push("");
  lines.push("| SP | Count | % |");
  lines.push("|----|-------|---|");
  const total = tickets.length;
  const allSpValues = Object.keys(spGroups)
    .map(Number)
    .sort((a, b) => a - b);
  for (const sp of allSpValues) {
    const count = spGroups[String(sp)]?.length ?? 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
    const note = ![2, 5, 8, 13, 21].includes(sp) ? " *(legacy)*" : "";
    lines.push(`| ${String(sp)} | ${String(count)} | ${pct}%${note} |`);
  }
  lines.push("");

  lines.push("## By Issue Type");
  lines.push("");
  const typeGroups: Record<string, { total: number; spSum: number }> = {};
  for (const t of tickets) {
    const type = t.issuetype || "Unknown";
    if (!typeGroups[type]) typeGroups[type] = { total: 0, spSum: 0 };
    typeGroups[type].total++;
    typeGroups[type].spSum += t.story_points;
  }
  lines.push("| Type | Count | Avg SP |");
  lines.push("|------|-------|--------|");
  for (const [type, stats] of Object.entries(typeGroups)) {
    const avg =
      stats.total > 0 ? (stats.spSum / stats.total).toFixed(1) : "N/A";
    lines.push(`| ${type} | ${String(stats.total)} | ${avg} |`);
  }
  lines.push("");

  lines.push("## By Project");
  lines.push("");
  const projGroups: Record<string, { total: number; spSum: number }> = {};
  for (const t of tickets) {
    const proj = t.key.replace(/-\d+$/, "");
    if (!projGroups[proj]) projGroups[proj] = { total: 0, spSum: 0 };
    projGroups[proj].total++;
    projGroups[proj].spSum += t.story_points;
  }
  lines.push("| Project | Count | Avg SP |");
  lines.push("|---------|-------|--------|");
  for (const [proj, stats] of Object.entries(projGroups).sort(
    (a, b) => b[1].total - a[1].total,
  )) {
    const avg =
      stats.total > 0 ? (stats.spSum / stats.total).toFixed(1) : "N/A";
    lines.push(`| ${proj} | ${String(stats.total)} | ${avg} |`);
  }
  lines.push("");

  lines.push("## Reference Tickets");
  lines.push("");
  lines.push("| Key | Type | SP | Summary | Labels | Components |");
  lines.push("|-----|------|----|---------|--------|------------|");
  for (const t of tickets) {
    const summary =
      t.summary.length > 80 ? t.summary.slice(0, 77) + "..." : t.summary;
    const labels = t.labels.length > 0 ? t.labels.join("; ") : "-";
    const components = t.components.length > 0 ? t.components.join("; ") : "-";
    lines.push(
      `| ${t.key} | ${t.issuetype} | ${String(t.story_points)} | ${summary} | ${labels} | ${components} |`,
    );
  }

  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    args.config ?? resolve(import.meta.dirname, "../data/config.json");
  const cacheDir = args.cache ?? resolve(import.meta.dirname, "../data/cache");
  const outputPath =
    args.output ??
    resolve(import.meta.dirname, "../data/cache/reference-summary.md");

  const config = loadConfig(configPath);
  const cachePath = resolve(cacheDir, "reference-tickets.json");
  const tickets = loadTickets(cachePath);

  const maxTickets = config.jira.max_reference_tickets;
  const trimmed = tickets.slice(0, maxTickets);
  if (tickets.length > maxTickets) {
    console.warn(
      `Warning: trimmed from ${String(tickets.length)} to ${String(maxTickets)} reference tickets`,
    );
  }

  const reference = buildReference(trimmed, config);
  writeFileSync(outputPath, reference);
  console.log(
    `Reference summary written to ${outputPath} (${String(trimmed.length)} tickets)`,
  );
}

main();
