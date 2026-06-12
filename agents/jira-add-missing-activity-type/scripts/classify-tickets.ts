import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ActivityType {
  value: string;
  id: string;
}

export interface ClassificationRule {
  activity_type: ActivityType;
  match: {
    issue_types?: string[];
    labels?: string[];
    keywords?: string[];
  };
}

interface Config {
  jira: { cloud_id: string; jql: string; activity_type_field: string };
  classification_rules: ClassificationRule[];
  default_activity_type: ActivityType;
}

interface Ticket {
  key: string;
  summary: string;
  issuetype: string;
  labels: string;
}

interface ClassifiedTicket {
  key: string;
  summary: string;
  issuetype: string;
  labels: string;
  activity_type: string;
  activity_type_id: string;
  matched_rule: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: classify-tickets.ts --config <path> --cache <dir> --output <path>",
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

export function parseCsv(content: string): Ticket[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const keyIdx = headers.indexOf("key");
  const summaryIdx = headers.indexOf("summary");
  const issuetypeIdx = headers.indexOf("issuetype");
  const labelsIdx = headers.indexOf("labels");

  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      key: fields[keyIdx] ?? "",
      summary: fields[summaryIdx] ?? "",
      issuetype: fields[issuetypeIdx] ?? "",
      labels: fields[labelsIdx] ?? "",
    };
  });
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function classifyTicket(
  ticket: Ticket,
  rules: ClassificationRule[],
  defaultType: ActivityType,
): ClassifiedTicket {
  const ticketLabels = ticket.labels
    .split(";")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  const summaryLower = ticket.summary.toLowerCase();
  const issueType = ticket.issuetype;

  for (const rule of rules) {
    const { match } = rule;

    const labelMatch = match.labels?.some((l) =>
      ticketLabels.includes(l.toLowerCase()),
    );
    const keywordMatch = match.keywords?.some((k) =>
      summaryLower.includes(k.toLowerCase()),
    );
    const issueTypeMatch = match.issue_types?.some(
      (t) => t.toLowerCase() === issueType.toLowerCase(),
    );

    if (labelMatch) {
      return {
        ...ticket,
        activity_type: rule.activity_type.value,
        activity_type_id: rule.activity_type.id,
        matched_rule: `label match`,
      };
    }
    if (keywordMatch) {
      return {
        ...ticket,
        activity_type: rule.activity_type.value,
        activity_type_id: rule.activity_type.id,
        matched_rule: `keyword match`,
      };
    }
    if (issueTypeMatch) {
      return {
        ...ticket,
        activity_type: rule.activity_type.value,
        activity_type_id: rule.activity_type.id,
        matched_rule: `issue type match`,
      };
    }
  }

  return {
    ...ticket,
    activity_type: defaultType.value,
    activity_type_id: defaultType.id,
    matched_rule: "default",
  };
}

export function generatePreview(classified: ClassifiedTicket[]): string {
  const lines: string[] = [];
  lines.push("# Activity Type Classification Preview\n");
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push(`Total tickets: ${String(classified.length)}\n`);

  const byType = new Map<string, ClassifiedTicket[]>();
  for (const t of classified) {
    const group = byType.get(t.activity_type) ?? [];
    group.push(t);
    byType.set(t.activity_type, group);
  }

  lines.push("## Summary\n");
  lines.push("| Activity Type | Count |");
  lines.push("|---|---|");
  for (const [type, tickets] of byType) {
    lines.push(`| ${type} | ${String(tickets.length)} |`);
  }
  lines.push("");

  lines.push("## Proposed Assignments\n");
  lines.push("| Ticket | Summary | Issue Type | Activity Type | Matched By |");
  lines.push("|---|---|---|---|---|");
  for (const t of classified) {
    const summary =
      t.summary.length > 60 ? t.summary.slice(0, 60) + "..." : t.summary;
    lines.push(
      `| [${t.key}](https://redhat.atlassian.net/browse/${t.key}) | ${summary} | ${t.issuetype} | ${t.activity_type} | ${t.matched_rule} |`,
    );
  }
  lines.push("");

  const defaults = classified.filter((t) => t.matched_rule === "default");
  if (defaults.length > 0) {
    lines.push("## Defaulted Tickets (review recommended)\n");
    lines.push(
      "These tickets matched no specific rule and were assigned the default Activity Type.\n",
    );
    for (const t of defaults) {
      lines.push(
        `- [${t.key}](https://redhat.atlassian.net/browse/${t.key}): ${t.summary}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    args.config ?? resolve(import.meta.dirname, "../data/config.json");
  const cacheDir = args.cache ?? resolve(import.meta.dirname, "../data/cache");
  const outputPath =
    args.output ??
    resolve(import.meta.dirname, "../data/output/classification-preview.md");

  const config = loadConfig(configPath);

  const csvPath = resolve(cacheDir, "jira-tickets.csv");
  if (!existsSync(csvPath)) {
    console.error(`Ticket cache not found: ${csvPath}`);
    process.exit(1);
  }

  const tickets = parseCsv(readFileSync(csvPath, "utf-8"));
  if (tickets.length === 0) {
    console.error("No tickets found in CSV cache");
    process.exit(2);
  }

  const classified = tickets.map((t) =>
    classifyTicket(
      t,
      config.classification_rules,
      config.default_activity_type,
    ),
  );

  const preview = generatePreview(classified);
  writeFileSync(outputPath, preview);

  const classifiedCsvPath = resolve(cacheDir, "classified-tickets.csv");
  const csvHeader =
    "key,summary,issuetype,labels,activity_type,activity_type_id,matched_rule";
  const csvLines = classified.map((t) => {
    const escapedSummary = t.summary.includes(",")
      ? `"${t.summary.replace(/"/g, '""')}"`
      : t.summary;
    return `${t.key},${escapedSummary},${t.issuetype},${t.labels},${t.activity_type},${t.activity_type_id},${t.matched_rule}`;
  });
  writeFileSync(classifiedCsvPath, [csvHeader, ...csvLines].join("\n"));

  const defaults = classified.filter((t) => t.matched_rule === "default");
  if (defaults.length > 0) {
    console.warn(
      `Warning: ${String(defaults.length)} ticket(s) matched no rule and were assigned the default Activity Type.`,
    );
    process.exit(3);
  }

  console.log(
    `Classified ${String(classified.length)} tickets. Preview: ${outputPath}`,
  );
}

const isDirectRun = process.argv[1]?.endsWith("classify-tickets.ts");
if (isDirectRun) main();
