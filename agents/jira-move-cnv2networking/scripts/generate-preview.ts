import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface TicketRow {
  key: string;
  numeric_id: string;
  summary: string;
  issuetype: string;
  status: string;
  target_project: string;
  target_component: string;
  reason: string;
  review_flag: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-preview.ts --input <csv-path> --output <md-path>",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function parseCsv(content: string): TicketRow[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];
  const rows: TicketRow[] = [];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.replace(/\r$/, "");
    const cols = splitCsvLine(line);
    if (cols.length < 6) continue;
    rows.push({
      key: cols[0],
      numeric_id: cols[1],
      summary: cols[2],
      issuetype: cols[3],
      status: cols[4],
      target_project: cols[5],
      target_component: cols[6],
      reason: cols[7] ?? "",
      review_flag: cols[8] ?? "",
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      if (line[i + 1] === '"') {
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

const JIRA_BASE_URL = "https://redhat.atlassian.net/browse";

function jiraLink(key: string): string {
  return `[${key}](${JIRA_BASE_URL}/${key})`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function generateMarkdown(rows: TicketRow[]): string {
  const confirmed = rows.filter((r) => !r.review_flag && r.target_project);
  const inFlightNoAction = rows.filter((r) =>
    r.review_flag.split(",").includes("in-flight-no-action"),
  );
  const flagged = rows.filter(
    (r) =>
      r.review_flag &&
      !r.review_flag.split(",").includes("ci-excluded") &&
      !r.review_flag.split(",").includes("unclassified") &&
      !r.review_flag.split(",").includes("in-flight-no-action"),
  );
  const unclassified = rows.filter((r) =>
    r.review_flag.split(",").includes("unclassified"),
  );
  const excluded = rows.filter((r) =>
    r.review_flag.split(",").includes("ci-excluded"),
  );

  const confirmedBugs = confirmed.filter((r) => r.issuetype === "Bug");
  const confirmedRfes = confirmed.filter((r) => r.issuetype !== "Bug");

  const lines: string[] = [
    `# CNV → Networking Migration Preview`,
    "",
    `| Category | Count |`,
    `|----------|-------|`,
    `| ✅ Confirmed moves | ${confirmed.length} |`,
    `| ⚠️ Flagged for review | ${flagged.length} |`,
    `| ❓ Unclassified | ${unclassified.length} |`,
    `| 🚫 CI/tooling excluded | ${excluded.length} |`,
    `| ⏸ In-flight / no action | ${inFlightNoAction.length} |`,
    `| **Total fetched** | **${rows.length}** |`,
    "",
  ];

  // Section 1: Confirmed moves
  if (confirmed.length > 0) {
    lines.push(`## ✅ Confirmed Moves (${confirmed.length})`, "");

    if (confirmedBugs.length > 0) {
      lines.push(`### Bugs → OCPBUGS (${confirmedBugs.length})`, "");
      lines.push(
        `| CNV Key | Summary | Status | Target Component | Why |`,
        `|---------|---------|--------|-----------------|-----|`,
      );
      for (const r of confirmedBugs) {
        lines.push(
          `| ${jiraLink(r.key)} | ${truncate(r.summary, 55)} | ${r.status} | ${r.target_component} | ${truncate(r.reason, 50)} |`,
        );
      }
      lines.push("");
    }

    if (confirmedRfes.length > 0) {
      const rfeProject = confirmedRfes[0]?.target_project ?? "RFE";
      lines.push(
        `### Feature Requests → ${rfeProject} (${confirmedRfes.length})`,
        "",
      );
      lines.push(
        `| CNV Key | Summary | Status | Component | Why |`,
        `|---------|---------|--------|-----------|-----|`,
      );
      for (const r of confirmedRfes) {
        lines.push(
          `| ${jiraLink(r.key)} | ${truncate(r.summary, 55)} | ${r.status} | ${r.target_component || "—"} | ${truncate(r.reason, 50)} |`,
        );
      }
      lines.push("");
    }
  }

  // Section 2: Flagged for review
  if (flagged.length > 0) {
    lines.push(`## ⚠️ Flagged for Review (${flagged.length})`, "");
    lines.push(
      "_These tickets will NOT be moved automatically. Use `select` to include specific keys._",
      "",
    );
    lines.push(
      `| CNV Key | Summary | Status | Flag | Why |`,
      `|---------|---------|--------|------|-----|`,
    );
    for (const r of flagged) {
      const flags = r.review_flag.split(",").join(", ");
      lines.push(
        `| ${jiraLink(r.key)} | ${truncate(r.summary, 50)} | ${r.status} | ${flags} | ${truncate(r.reason, 60)} |`,
      );
    }
    lines.push("");
  }

  // Section 3: Unclassified
  if (unclassified.length > 0) {
    lines.push(
      `## ❓ Unclassified — No Keyword Match (${unclassified.length})`,
      "",
    );
    lines.push(
      "_No nmstate or networking keyword found. Manual triage required._",
      "",
    );
    lines.push(
      `| CNV Key | Summary | Status | Why |`,
      `|---------|---------|--------|-----|`,
    );
    for (const r of unclassified) {
      lines.push(
        `| ${jiraLink(r.key)} | ${truncate(r.summary, 65)} | ${r.status} | ${truncate(r.reason, 60)} |`,
      );
    }
    lines.push("");
  }

  // Section 4: CI excluded
  if (excluded.length > 0) {
    lines.push(`## 🚫 CI/Tooling Excluded (${excluded.length})`, "");
    lines.push("_These tickets will never be moved by this agent._", "");
    lines.push(
      `| CNV Key | Summary | Status | Reason |`,
      `|---------|---------|--------|--------|`,
    );
    for (const r of excluded) {
      lines.push(
        `| ${jiraLink(r.key)} | ${truncate(r.summary, 60)} | ${r.status} | ${truncate(r.reason, 55)} |`,
      );
    }
    lines.push("");
  }

  // Section 5: In-flight / no action
  if (inFlightNoAction.length > 0) {
    lines.push(`## ⏸ In-flight / No Action (${inFlightNoAction.length})`, "");
    lines.push(
      `_${inFlightNoAction.length} in-flight ticket(s) with no networking keyword — they stay in CNV regardless and require no decision._`,
      "",
    );
  }

  // Reasoning section
  if (rows.length > 0) {
    lines.push(`## Reasoning`, "");
    for (const r of rows) {
      const flag = r.review_flag ? ` \`[${r.review_flag}]\`` : "";
      lines.push(`- **${jiraLink(r.key)}**${flag}: ${r.reason}`);
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

  const md = generateMarkdown(rows);
  writeFileSync(outputPath, md);

  const confirmed = rows.filter(
    (r) => !r.review_flag && r.target_project,
  ).length;
  const flagged = rows.filter(
    (r) =>
      r.review_flag &&
      r.review_flag !== "ci-excluded" &&
      r.review_flag !== "unclassified",
  ).length;
  const excluded = rows.filter((r) => r.review_flag === "ci-excluded").length;
  const unclassified = rows.filter(
    (r) => r.review_flag === "unclassified",
  ).length;

  const inFlight = rows.filter((r) =>
    r.review_flag.split(",").includes("in-flight-no-action"),
  ).length;
  console.log(
    `Preview written to ${outputPath} — ${rows.length} total: ${confirmed} confirmed, ${flagged} flagged, ${unclassified} unclassified, ${excluded} excluded, ${inFlight} in-flight/no-action`,
  );
}

main();
