import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TicketRow {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  issuetype: string;
  github_prs: string;
  pr_source: string;
  merged_branches: string;
  fix_version_ids: string;
  fix_version_names: string;
  disposition: string;
  reason: string;
  resolved_date: string;
}

export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-preview.ts --input <csv-path> --output <md-path> --base-url <jira-url>",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

export function parseCsvLine(line: string): string[] {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      if (normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

export function parseCsv(content: string): TicketRow[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const headerCols = parseCsvLine(lines[0].replace(/\r$/, ""));
  const idx = (name: string) => headerCols.indexOf(name);

  const rows: TicketRow[] = [];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.replace(/\r$/, "");
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    rows.push({
      key: cols[idx("key")] ?? "",
      summary: cols[idx("summary")] ?? "",
      status: cols[idx("status")] ?? "",
      assignee: cols[idx("assignee")] ?? "",
      issuetype: cols[idx("issuetype")] ?? "",
      github_prs: cols[idx("github_prs")] ?? "",
      pr_source: cols[idx("pr_source")] ?? "",
      merged_branches: cols[idx("merged_branches")] ?? "",
      fix_version_ids: cols[idx("fix_version_ids")] ?? "",
      fix_version_names: cols[idx("fix_version_names")] ?? "",
      disposition: cols[idx("disposition")] ?? "",
      reason: cols[idx("reason")] ?? "",
      resolved_date: cols[idx("resolved_date")] ?? "",
    });
  }
  return rows;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function joinSemicolons(s: string): string {
  return s.split(";").join(", ");
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const group = map.get(k) ?? [];
    group.push(item);
    map.set(k, group);
  }
  return map;
}

export function generateMarkdown(
  rows: TicketRow[],
  date: string,
  baseUrl: string,
): string {
  const proposed = rows.filter((r) => r.disposition === "proposed");
  const needsReview = rows.filter((r) => r.disposition === "needs_review");
  const skipped = rows.filter((r) => r.disposition === "skipped");

  const ticketLink = (key: string) => `[${key}](${baseUrl}/browse/${key})`;

  const lines: string[] = [
    `# Fix Version Assignment Preview — ${date}`,
    "",
    `| Category | Count |`,
    `|----------|-------|`,
    `| ✅ Proposed | ${proposed.length} |`,
    `| ⚠️ Needs Review | ${needsReview.length} |`,
    `| ⏭️ Skipped | ${skipped.length} |`,
    `| **Total** | **${rows.length}** |`,
    "",
  ];

  if (proposed.length > 0) {
    lines.push(`## ✅ Proposed Updates (${proposed.length})`, "");

    const hasPartial = proposed.some((r) => r.reason);
    if (hasPartial) {
      lines.push(
        "_⚠️ = also merged to branch(es) not in config — those versions were not added._",
        "",
      );
    }

    const grouped = groupBy(proposed, (r) => r.fix_version_names);
    const sortedGroups = [...grouped.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );

    for (const [versionKey, groupRows] of sortedGroups) {
      const versionDisplay = joinSemicolons(versionKey);
      lines.push(`### ${versionDisplay} (${groupRows.length})`, "");
      lines.push(
        `| Ticket | Summary | Branch(es) | Source | Resolved |`,
        `|--------|---------|------------|--------|----------|`,
      );
      for (const r of groupRows) {
        const source =
          r.pr_source === "issue_resolved"
            ? "[Issue→PR]"
            : r.pr_source === "direct"
              ? "[PR]"
              : "";
        const partialFlag = r.reason ? " ⚠️" : "";
        const resolved = r.resolved_date ? r.resolved_date.slice(0, 10) : "";
        lines.push(
          `| ${ticketLink(r.key)} | ${truncate(r.summary, 80)} | ${joinSemicolons(r.merged_branches)} | ${source}${partialFlag} | ${resolved} |`,
        );
      }
      lines.push("");
    }
  }

  if (needsReview.length > 0) {
    lines.push(`## ⚠️ Needs Review (${needsReview.length})`, "");
    lines.push(
      "_Branch not in config — add the missing entry to `branchToFixVersion` to process these._",
      "",
    );
    lines.push(
      `| Ticket | Summary | Merged Branches | Reason |`,
      `|--------|---------|-----------------|--------|`,
    );
    for (const r of needsReview) {
      lines.push(
        `| ${ticketLink(r.key)} | ${truncate(r.summary, 80)} | ${joinSemicolons(r.merged_branches)} | ${truncate(r.reason, 60)} |`,
      );
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(`## ⏭️ Skipped (${skipped.length})`, "");
    lines.push(
      "_Fix version cannot be determined automatically. See tickets.csv for the full list._",
      "",
    );

    const reasonGroups = new Map<string, string[]>();
    for (const r of skipped) {
      const label = r.reason || "unknown";
      const keys = reasonGroups.get(label) ?? [];
      keys.push(r.key);
      reasonGroups.set(label, keys);
    }
    const sortedReasons = [...reasonGroups.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );

    lines.push(`| Reason | Count |`, `|--------|-------|`);
    for (const [reason, keys] of sortedReasons) {
      const count = keys.length;
      const keySuffix = count <= 5 ? ` (${keys.join(", ")})` : "";
      lines.push(`| ${truncate(reason, 50)} | ${count}${keySuffix} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath =
    args.input ?? resolve(import.meta.dirname, "../data/cache/tickets.csv");
  const outputPath =
    args.output ?? resolve(import.meta.dirname, "../data/output/preview.md");
  const baseUrl = args["base-url"] ?? "https://your-site.atlassian.net";

  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const content = readFileSync(inputPath, "utf-8");
  const rows = parseCsv(content);

  if (rows.length === 0) {
    console.error("No ticket rows found in CSV.");
    process.exit(1);
  }

  const proposed = rows.filter((r) => r.disposition === "proposed");
  const needsReview = rows.filter((r) => r.disposition === "needs_review");

  if (proposed.length === 0) {
    console.error(
      `No proposed updates — ${needsReview.length} need review, ${rows.length - needsReview.length} skipped. Add missing branch mappings to config.`,
    );
    process.exit(2);
  }

  const date = new Date().toISOString().slice(0, 10);
  const md = generateMarkdown(rows, date, baseUrl);
  writeFileSync(outputPath, md);

  console.log(
    `Preview written to ${outputPath} — ${rows.length} total: ${proposed.length} proposed, ${needsReview.length} needs review, ${rows.length - proposed.length - needsReview.length} skipped`,
  );

  if (needsReview.length > 0) {
    process.exit(3);
  }
}

const isDirectRun = process.argv[1]?.endsWith("generate-preview.ts");
if (isDirectRun) main();
