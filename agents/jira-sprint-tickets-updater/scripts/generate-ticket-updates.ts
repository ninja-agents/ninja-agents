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
  protected_statuses: string[];
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
  assignee: string;
  from_status: string;
  to_status: string;
  transition_id: string;
  reason: string;
  github_url: string;
  link_count: number;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-ticket-updates.ts --config <path> --cache <dir> --output <path> [--sprint <name>]",
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
    for (let ci = 0; ci < line.length; ci++) {
      const char = line[ci];
      if (char === '"') {
        if (inQuotes && line[ci + 1] === '"') {
          current += '"';
          ci++;
        } else {
          inQuotes = !inQuotes;
        }
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

function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function isResolved(state: string): boolean {
  return state === "merged" || state === "closed";
}

function isActive(state: string): boolean {
  return state === "open";
}

function evaluateCondition(
  condition: string,
  states: string[],
  urls: string[],
): boolean {
  switch (condition) {
    case "all_links_resolved":
      return states.length > 0 && states.every(isResolved);
    case "has_active_link":
      return states.some(isActive);
    case "has_open_pr":
      return urls.some(
        (url, i) => url.includes("/pull/") && states[i] === "open",
      );
    default:
      return false;
  }
}

interface SkippedTicket {
  ticket: TicketRow;
  reason: string;
}

function buildTransitions(
  tickets: TicketRow[],
  config: Config,
): { transitions: Transition[]; skipped: SkippedTicket[] } {
  const transitions: Transition[] = [];
  const skipped: SkippedTicket[] = [];

  const protectedStatuses = new Set(config.protected_statuses ?? []);

  for (const ticket of tickets) {
    if (protectedStatuses.has(ticket.status)) {
      skipped.push({
        ticket,
        reason: `protected status "${ticket.status}" — cannot be transitioned`,
      });
      continue;
    }

    const projectKey = extractProjectKey(ticket.key);
    const rules = findMatchingRules(config, projectKey, ticket.issuetype);

    if (rules.length === 0) {
      const project = config.projects[projectKey];
      const reason = !project
        ? `project "${projectKey}" not in config`
        : `no workflow for issue type "${ticket.issuetype}"`;
      skipped.push({ ticket, reason });
      continue;
    }

    const statusMatch = rules.some((r) => r.from === ticket.status);
    if (!statusMatch) {
      skipped.push({
        ticket,
        reason: `status "${ticket.status}" not in rules`,
      });
      continue;
    }

    const urls = ticket.github_urls
      ? ticket.github_urls.split(";").filter(Boolean)
      : [];
    const states = ticket.github_states
      ? ticket.github_states.split(";").filter(Boolean)
      : [];

    if (urls.length === 0) {
      skipped.push({ ticket, reason: "no linked GitHub PR/issue" });
      continue;
    }

    if (states.length === 0 || states.length !== urls.length) {
      skipped.push({
        ticket,
        reason: `GitHub state data incomplete (${String(urls.length)} URLs, ${String(states.length)} states)`,
      });
      continue;
    }

    let matched = false;
    for (const rule of rules) {
      if (
        ticket.status === rule.from &&
        evaluateCondition(rule.condition, states, urls)
      ) {
        transitions.push({
          key: ticket.key,
          summary: ticket.summary,
          assignee: ticket.assignee,
          from_status: ticket.status,
          to_status: rule.to,
          transition_id: rule.transition_id,
          reason: rule.description,
          github_url: urls[0],
          link_count: urls.length,
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      skipped.push({
        ticket,
        reason: `condition not met (links: ${states.join(", ") || "none"})`,
      });
    }
  }

  return { transitions, skipped };
}

function formatOutput(
  transitions: Transition[],
  skipped: SkippedTicket[],
  sprintName?: string,
): string {
  const header = sprintName
    ? `# Proposed Ticket Transitions — ${sprintName}`
    : "# Proposed Ticket Transitions";
  const lines: string[] = [header, ""];

  const total = transitions.length + skipped.length;
  lines.push(
    `${String(total)} tickets analyzed. **${String(transitions.length)}** to transition, **${String(skipped.length)}** skipped.`,
    "",
  );

  if (transitions.length === 0) {
    lines.push(
      "No transitions to apply — all tickets are either already in the target status or have no matching rule.",
    );
    lines.push("");
  } else {
    lines.push(
      "| Ticket | Assignee | Current Status | Target Status | Reason | Link |",
    );
    lines.push(
      "| ------ | -------- | -------------- | ------------- | ------ | ---- |",
    );
    for (const t of transitions) {
      const linkLabel =
        t.link_count > 1
          ? `[${String(t.link_count)} links](${t.github_url})`
          : `[link](${t.github_url})`;
      const link = t.github_url ? linkLabel : "—";
      const assignee = escapeMarkdownCell(t.assignee || "—");
      const reason = escapeMarkdownCell(t.reason);
      lines.push(
        `| ${t.key} | ${assignee} | ${t.from_status} | ${t.to_status} | ${reason} | ${link} |`,
      );
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    const groups = new Map<string, string[]>();
    for (const s of skipped) {
      const existing = groups.get(s.reason) ?? [];
      existing.push(`${s.ticket.key} (${s.ticket.status})`);
      groups.set(s.reason, existing);
    }
    lines.push("### Skipped", "");
    for (const [reason, tickets] of groups) {
      if (tickets.length <= 3) {
        for (const t of tickets) {
          lines.push(`- ${t}: ${reason}`);
        }
      } else {
        lines.push(
          `- **${reason}** (${String(tickets.length)}): ${tickets.join(", ")}`,
        );
      }
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
  const sprintName = args.sprint;
  const output = formatOutput(transitions, skipped, sprintName);

  writeFileSync(outputPath, output);
  console.log(`Output written to ${outputPath}`);
  console.log(
    `${String(transitions.length)} transitions proposed, ${String(skipped.length)} skipped`,
  );
}

main();
