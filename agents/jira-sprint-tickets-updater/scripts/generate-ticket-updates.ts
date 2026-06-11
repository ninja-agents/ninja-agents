import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface TransitionRule {
  from: string;
  to: string;
  condition: string;
  transition_id: string;
  description: string;
}

interface Workflow {
  issue_types: string[];
  transition_rules: TransitionRule[];
}

interface ProjectConfig {
  workflows: Record<string, Workflow>;
}

interface Config {
  jira: { cloud_id: string; board_id: number };
  sprint: { name_pattern: string };
  github_link_fields: string[];
  projects: Record<string, ProjectConfig>;
}

interface TicketRow {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  issuetype: string;
  priority: string;
  resolution: string;
  github_urls: string;
  github_states: string;
}

interface Transition {
  key: string;
  summary: string;
  from_status: string;
  to_status: string;
  transition_id: string;
  reason: string;
  github_url: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-ticket-updates.ts --config <path> --cache <dir> --output <path>",
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

function parseCsv(content: string): TicketRow[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? "").trim();
    });
    return row as unknown as TicketRow;
  });
}

function extractProjectKey(ticketKey: string): string {
  const match = ticketKey.match(/^([A-Z][\w-]*)-\d+$/);
  return match ? match[1] : "";
}

function findMatchingRules(
  config: Config,
  projectKey: string,
  issueType: string,
): TransitionRule[] {
  const project = config.projects[projectKey];
  if (!project) return [];

  for (const workflow of Object.values(project.workflows)) {
    if (workflow.issue_types.includes(issueType)) {
      return workflow.transition_rules;
    }
  }
  return [];
}

function isResolved(state: string): boolean {
  return state === "merged" || state === "closed";
}

function isActive(state: string): boolean {
  return state === "open";
}

function evaluateCondition(condition: string, states: string[]): boolean {
  switch (condition) {
    case "all_links_resolved":
      return states.length > 0 && states.every(isResolved);
    case "has_active_link":
      return states.some(isActive);
    default:
      return false;
  }
}

function buildTransitions(
  tickets: TicketRow[],
  config: Config,
): { transitions: Transition[]; skipped: TicketRow[] } {
  const transitions: Transition[] = [];
  const skipped: TicketRow[] = [];

  for (const ticket of tickets) {
    const projectKey = extractProjectKey(ticket.key);
    const rules = findMatchingRules(config, projectKey, ticket.issuetype);

    if (rules.length === 0) {
      skipped.push(ticket);
      continue;
    }

    const urls = ticket.github_urls
      ? ticket.github_urls.split(";").filter(Boolean)
      : [];
    const states = ticket.github_states
      ? ticket.github_states.split(";").filter(Boolean)
      : [];

    if (urls.length === 0) {
      skipped.push(ticket);
      continue;
    }

    let matched = false;
    for (const rule of rules) {
      if (
        ticket.status === rule.from &&
        evaluateCondition(rule.condition, states)
      ) {
        transitions.push({
          key: ticket.key,
          summary: ticket.summary,
          from_status: ticket.status,
          to_status: rule.to,
          transition_id: rule.transition_id,
          reason: rule.description,
          github_url: urls[0],
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      skipped.push(ticket);
    }
  }

  return { transitions, skipped };
}

function formatOutput(transitions: Transition[], skipped: TicketRow[]): string {
  const lines: string[] = ["# Proposed Ticket Transitions", ""];

  if (transitions.length === 0) {
    lines.push(
      "No transitions to apply — all tickets are either already in the target status or have no matching rule.",
    );
    lines.push("");
  } else {
    lines.push(
      `**${String(transitions.length)} ticket(s) to transition:**`,
      "",
    );
    lines.push("| Ticket | Current Status | Target Status | Reason | Link |");
    lines.push("| ------ | -------------- | ------------- | ------ | ---- |");
    for (const t of transitions) {
      const link = t.github_url ? `[link](${t.github_url})` : "—";
      lines.push(
        `| ${t.key} | ${t.from_status} | ${t.to_status} | ${t.reason} | ${link} |`,
      );
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(`**${String(skipped.length)} ticket(s) skipped:**`, "");
    for (const s of skipped) {
      const hasLinks = s.github_urls && s.github_urls.length > 0;
      const projectKey = extractProjectKey(s.key);
      let reason: string;
      if (!hasLinks) {
        reason = "no linked GitHub PR/issue";
      } else if (!projectKey) {
        reason = "unknown project";
      } else {
        reason = "no matching rule";
      }
      lines.push(`- ${s.key}: ${s.status} (${reason})`);
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
    resolve(import.meta.dirname, "../data/output/proposed-transitions.md");

  const config = loadConfig(configPath);

  const ticketsCsvPath = resolve(cacheDir, "jira-tickets.csv");
  if (!existsSync(ticketsCsvPath)) {
    console.error(`Tickets CSV not found: ${ticketsCsvPath}`);
    process.exit(1);
  }

  const tickets = parseCsv(readFileSync(ticketsCsvPath, "utf-8"));
  if (tickets.length === 0) {
    console.error("No tickets found in CSV");
    process.exit(2);
  }

  const { transitions, skipped } = buildTransitions(tickets, config);
  const output = formatOutput(transitions, skipped);

  writeFileSync(outputPath, output);
  console.log(`Output written to ${outputPath}`);
  console.log(
    `${String(transitions.length)} transitions proposed, ${String(skipped.length)} skipped`,
  );
}

main();
