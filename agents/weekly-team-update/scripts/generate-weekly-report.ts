#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const RESET = "\x1b[0m";

const JIRA_GITHUB_REF_RE = /\[([a-zA-Z0-9_-]+)#(\d+)\]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRItem {
  engineer: string;
  number: number;
  title: string;
  repo: string;
  state: string;
  created_at: string;
  merged_at: string;
  url: string;
  source: "github" | "gitlab";
  issue_refs: string[];
  ticket_id?: string;
}

export interface JiraItem {
  engineer: string;
  key: string;
  summary: string;
  status: string;
  resolution: string;
  resolutiondate: string;
  issuetype: string;
  priority: string;
  url: string;
  role: "assignee" | "qa_contact";
  nested_prs: PRItem[];
}

export interface EngineerBlock {
  name: string;
  completed_tickets: JiraItem[];
  completed_prs: PRItem[];
  in_progress_tickets: JiraItem[];
  in_progress_prs: PRItem[];
}

interface TeamConfig {
  team_name: string;
  report_title: string;
  jira: { cloud_id: string; team_filter_id: string; base_url: string; projects: string[] };
  products: { key: string; name: string; jira_prefixes: string[]; repos: string[] }[];
  engineers: {
    name: string;
    directory: string;
    github: string;
    gitlab: string;
    jira_account_id: string;
    jira_display_names: string[];
    role: string;
  }[];
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function loadConfig(configPath: string): TeamConfig {
  if (!existsSync(configPath)) {
    process.stderr.write(`${RED}ERROR: team config not found: ${configPath}${RESET}\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function buildAccountIdToName(config: TeamConfig): Map<string, string> {
  return new Map(config.engineers.map((e) => [e.jira_account_id, e.name]));
}

export function buildJiraDisplayToName(config: TeamConfig): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const e of config.engineers) {
    for (const dn of e.jira_display_names ?? []) {
      mapping.set(dn, e.name);
    }
  }
  return mapping;
}

export function buildTicketIdRe(config: TeamConfig): RegExp {
  const prefixes = new Set<string>();
  for (const p of config.products) {
    for (const prefix of p.jira_prefixes) {
      prefixes.add(prefix);
    }
  }
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  const pattern = `((?:${sorted.join("|")})-\\d+)`;
  return new RegExp(pattern, "g");
}

export function buildRepoToProduct(config: TeamConfig): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const p of config.products) {
    for (const repo of p.repos) {
      mapping.set(repo, p.key);
      const parts = repo.split("/");
      if (parts.length === 2) {
        mapping.set(parts[1], p.key);
      }
    }
  }
  return mapping;
}

export function buildPrefixToProduct(config: TeamConfig): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const p of config.products) {
    for (const prefix of p.jira_prefixes) {
      mapping.set(prefix, p.key);
    }
  }
  return mapping;
}

export function buildOcpbugsSummaryRepoRe(config: TeamConfig): RegExp {
  const repoNames = new Set<string>();
  for (const p of config.products) {
    for (const repo of p.repos) {
      const parts = repo.split("/");
      if (parts.length === 2 && parts[1].length > 3) {
        repoNames.add(parts[1]);
      }
    }
  }
  if (repoNames.size === 0) {
    return /(?!)/;
  }
  const sorted = [...repoNames].sort((a, b) => b.length - a.length);
  const pattern = `\\b(?:${sorted.map(escapeRegExp).join("|")})\\b`;
  return new RegExp(pattern);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// CSV loading
// ---------------------------------------------------------------------------

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function loadCsvFile(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

export function parseDate(s: string): Date | null {
  if (!s || s.trim() === "") return null;
  s = s.trim();

  // Try ISO-8601 variants
  // Remove trailing Z and timezone for uniform parsing
  let normalized = s;

  // Handle "+0000" style (no colon)
  normalized = normalized.replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");

  // Try direct parse
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) {
    return d;
  }

  // Try date-only format
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d2 = new Date(s + "T00:00:00Z");
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function loadGithubPrs(cacheDir: string): PRItem[] {
  const rows = loadCsvFile(resolve(cacheDir, "github-prs.csv"));
  const items: PRItem[] = [];
  for (const r of rows) {
    try {
      const refsStr = r.issue_refs ?? "";
      const refsRaw = refsStr
        ? refsStr
            .replace(/;/g, ",")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
      const refs = refsRaw.map((x) => x.replace(/^#/, ""));
      items.push({
        engineer: r.engineer ?? "",
        number: parseInt(r.number ?? "0", 10),
        title: r.title ?? "",
        repo: r.repo ?? "",
        state: r.state ?? "",
        created_at: r.created_at ?? "",
        merged_at: r.merged_at ?? "",
        url: r.html_url ?? "",
        source: "github",
        issue_refs: refs,
      });
    } catch (e) {
      process.stderr.write(`${YELLOW}WARN: skipping malformed GitHub PR row: ${e}${RESET}\n`);
    }
  }
  return items;
}

export function loadGitlabMrs(cacheDir: string): PRItem[] {
  const rows = loadCsvFile(resolve(cacheDir, "gitlab-mrs.csv"));
  const items: PRItem[] = [];
  for (const r of rows) {
    try {
      items.push({
        engineer: r.engineer ?? "",
        number: parseInt(r.iid ?? "0", 10),
        title: r.title ?? "",
        repo: r.project_path ?? "",
        state: r.state ?? "",
        created_at: r.created_at ?? "",
        merged_at: r.merged_at ?? "",
        url: r.web_url ?? "",
        source: "gitlab",
        issue_refs: [],
      });
    } catch (e) {
      process.stderr.write(`${YELLOW}WARN: skipping malformed GitLab MR row: ${e}${RESET}\n`);
    }
  }
  return items;
}

export function loadJiraTickets(cacheDir: string, config: TeamConfig): JiraItem[] {
  const rows = loadCsvFile(resolve(cacheDir, "jira-tickets.csv"));
  const accountIdToName = buildAccountIdToName(config);
  const jiraDisplayToName = buildJiraDisplayToName(config);
  const items: JiraItem[] = [];
  for (const r of rows) {
    const key = r.key ?? "";
    let url = r.url ?? "";
    if (!url || !url.startsWith("http")) {
      url = `https://redhat.atlassian.net/browse/${key}`;
    }

    let engineer = r.engineer ?? "";
    let role: "assignee" | "qa_contact" = (r.role as "assignee" | "qa_contact") ?? "assignee";

    if (!engineer) {
      const assigneeId = r.assignee_id ?? "";
      const assigneeName = r.assignee_name ?? "";
      const qaId = r.qa_contact_id ?? "";
      const qaName = r.qa_contact_name ?? "";

      if (assigneeId && accountIdToName.has(assigneeId)) {
        engineer = accountIdToName.get(assigneeId)!;
        role = "assignee";
      } else if (assigneeName && jiraDisplayToName.has(assigneeName)) {
        engineer = jiraDisplayToName.get(assigneeName)!;
        role = "assignee";
      } else if (qaId && accountIdToName.has(qaId)) {
        engineer = accountIdToName.get(qaId)!;
        role = "qa_contact";
      } else if (qaName && jiraDisplayToName.has(qaName)) {
        engineer = jiraDisplayToName.get(qaName)!;
        role = "qa_contact";
      } else {
        continue;
      }
    }

    items.push({
      engineer,
      key,
      summary: r.summary ?? "",
      status: r.status ?? "",
      resolution: r.resolution ?? "",
      resolutiondate: r.resolutiondate ?? "",
      issuetype: r.issuetype ?? "",
      priority: r.priority ?? "",
      url,
      role,
      nested_prs: [],
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateData(
  githubPrs: PRItem[],
  _gitlabMrs: PRItem[],
  jiraTickets: JiraItem[],
  config: TeamConfig,
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (githubPrs.length === 0) {
    errors.push("github-prs.csv is empty or missing");
  }
  if (jiraTickets.length === 0) {
    errors.push("jira-tickets.csv is empty or missing");
  }

  const mergedPrs = githubPrs.filter(
    (p) => (p.state === "merged" || p.state === "closed") && p.merged_at,
  );
  if (mergedPrs.length < 5) {
    warnings.push(`Only ${mergedPrs.length} merged GitHub PRs found (expected 10-50)`);
  } else if (mergedPrs.length < 10) {
    warnings.push(`Low GitHub PR count: ${mergedPrs.length} merged (expected 15-50)`);
  }

  const engineerNames = new Set(config.engineers.map((e) => e.name));
  const activeEngineers = new Set<string>();
  for (const p of githubPrs) {
    if (engineerNames.has(p.engineer)) activeEngineers.add(p.engineer);
  }
  for (const m of _gitlabMrs) {
    if (engineerNames.has(m.engineer)) activeEngineers.add(m.engineer);
  }
  for (const t of jiraTickets) {
    if (engineerNames.has(t.engineer)) activeEngineers.add(t.engineer);
  }
  const missing = [...engineerNames].filter((n) => !activeEngineers.has(n));
  if (missing.length > 2) {
    warnings.push(`Engineers with 0 activity: ${missing.sort().join(", ")}`);
  }

  return { warnings, errors };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterCompletedPrs(
  prs: PRItem[],
  windowStart: Date,
  windowEnd: Date,
): PRItem[] {
  return prs.filter((p) => {
    if (p.state !== "merged" && p.state !== "closed") return false;
    if (!p.merged_at) return false;
    const merged = parseDate(p.merged_at);
    return merged !== null && merged >= windowStart && merged <= windowEnd;
  });
}

export function filterOpenPrs(prs: PRItem[]): PRItem[] {
  return prs.filter((p) => p.state === "open" || p.state === "opened");
}

export function filterCompletedJira(
  tickets: JiraItem[],
  windowStart: Date,
  windowEnd: Date,
): JiraItem[] {
  return tickets.filter((t) => {
    if (t.resolution !== "Done") return false;
    const rd = parseDate(t.resolutiondate);
    return rd !== null && rd >= windowStart && rd <= windowEnd;
  });
}

export function filterInProgressJira(tickets: JiraItem[]): JiraItem[] {
  const excludedStatuses = new Set([
    "Done",
    "Closed",
    "Resolved",
    "Verified",
    "New",
  ]);
  const devStatuses = new Set([
    "ASSIGNED",
    "In Progress",
    "Dev Complete",
    "Review",
    "POST",
    "To Do",
    "Release Pending",
  ]);
  const qeStatuses = new Set(["ON_QA"]);

  return tickets.filter((t) => {
    if (excludedStatuses.has(t.status)) return false;
    if (t.issuetype === "Bug" || t.issuetype === "Vulnerability") {
      const relevant = t.role === "qa_contact" ? qeStatuses : devStatuses;
      if (!relevant.has(t.status)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Nesting & product mapping
// ---------------------------------------------------------------------------

export function extractTicketIds(title: string, ticketIdRe: RegExp): string[] {
  const results: string[] = [];
  // Reset lastIndex since the regex has global flag
  ticketIdRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ticketIdRe.exec(title)) !== null) {
    results.push(m[1]);
  }
  return results;
}

function buildGithubRefIndex(
  tickets: JiraItem[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const t of tickets) {
    const m = JIRA_GITHUB_REF_RE.exec(t.summary);
    if (m) {
      const repoName = m[1];
      const issueNum = m[2];
      index.set(`${repoName}|${issueNum}|${t.engineer}`, t.key);
    }
  }
  return index;
}

export function nestPrsUnderTickets(
  completedPrs: PRItem[],
  completedTickets: JiraItem[],
  ticketIdRe: RegExp,
): { tickets: JiraItem[]; orphanPrs: PRItem[] } {
  const ticketMap = new Map(completedTickets.map((t) => [t.key, t]));
  const githubRefIndex = buildGithubRefIndex(completedTickets);
  const orphanPrs: PRItem[] = [];

  for (const pr of completedPrs) {
    const ids = extractTicketIds(pr.title, ticketIdRe);
    let nested = false;
    for (const tid of ids) {
      if (ticketMap.has(tid)) {
        ticketMap.get(tid)!.nested_prs.push(pr);
        pr.ticket_id = tid;
        nested = true;
        break;
      }
    }
    if (nested) continue;

    let matched = false;
    for (const ref of pr.issue_refs) {
      if (ticketMap.has(ref)) {
        ticketMap.get(ref)!.nested_prs.push(pr);
        pr.ticket_id = ref;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const repoName = pr.repo.includes("/") ? pr.repo.split("/").pop()! : pr.repo;
    for (const ref of pr.issue_refs) {
      const ticketKey = githubRefIndex.get(`${repoName}|${ref}|${pr.engineer}`);
      if (ticketKey && ticketMap.has(ticketKey)) {
        ticketMap.get(ticketKey)!.nested_prs.push(pr);
        pr.ticket_id = ticketKey;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    orphanPrs.push(pr);
  }

  return { tickets: [...ticketMap.values()], orphanPrs };
}

export function nestInProgress(
  openPrs: PRItem[],
  ipTickets: JiraItem[],
  ticketIdRe: RegExp,
): { tickets: JiraItem[]; orphanPrs: PRItem[] } {
  return nestPrsUnderTickets(openPrs, ipTickets, ticketIdRe);
}

export function determineProduct(
  item: PRItem | JiraItem,
  config: TeamConfig,
  repoToProduct: Map<string, string>,
  prefixToProduct: Map<string, string>,
  ocpbugsSummaryRe: RegExp,
  ticketIdRe: RegExp,
): string {
  if ("key" in item && "summary" in item && "status" in item && !("source" in item)) {
    // JiraItem
    const jira = item as JiraItem;
    const prefix = jira.key.includes("-") ? jira.key.split("-")[0] : "";

    if (prefix === "OCPBUGS") {
      const m = ocpbugsSummaryRe.exec(jira.summary);
      if (m && repoToProduct.has(m[0])) {
        return repoToProduct.get(m[0])!;
      }
      const titleIds = extractTicketIds(jira.summary, ticketIdRe);
      for (const tid of titleIds) {
        const tidPrefix = tid.split("-")[0];
        if (tidPrefix !== "OCPBUGS" && prefixToProduct.has(tidPrefix)) {
          return prefixToProduct.get(tidPrefix)!;
        }
      }
      for (const pr of jira.nested_prs) {
        if (repoToProduct.has(pr.repo)) return repoToProduct.get(pr.repo)!;
        const prRepoName = pr.repo.includes("/") ? pr.repo.split("/").pop()! : pr.repo;
        if (repoToProduct.has(prRepoName)) return repoToProduct.get(prRepoName)!;
      }
    }

    if (prefixToProduct.has(prefix)) return prefixToProduct.get(prefix)!;
    return "Other";
  }

  // PRItem
  const pr = item as PRItem;
  if (repoToProduct.has(pr.repo)) return repoToProduct.get(pr.repo)!;
  const repoName = pr.repo.includes("/") ? pr.repo.split("/").pop()! : pr.repo;
  if (repoToProduct.has(repoName)) return repoToProduct.get(repoName)!;
  const titleIds = extractTicketIds(pr.title, ticketIdRe);
  for (const tid of titleIds) {
    const tidPrefix = tid.split("-")[0];
    if (prefixToProduct.has(tidPrefix)) return prefixToProduct.get(tidPrefix)!;
  }
  const m = ocpbugsSummaryRe.exec(pr.title);
  if (m && repoToProduct.has(m[0])) return repoToProduct.get(m[0])!;
  return "Other";
}

export function shouldConsolidateTestTasks(
  tickets: JiraItem[],
): { consolidate: boolean; testTickets: JiraItem[]; otherTickets: JiraItem[] } {
  const testPattern = /^\[(?:TIER-\d|POST-UPGRADE|STAGE)/i;
  const testTickets = tickets.filter((t) => testPattern.test(t.summary));
  const otherTickets = tickets.filter((t) => !testPattern.test(t.summary));
  return { consolidate: testTickets.length > 3, testTickets, otherTickets };
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export function organize(
  completedTickets: JiraItem[],
  completedOrphanPrs: PRItem[],
  ipTickets: JiraItem[],
  ipOrphanPrs: PRItem[],
  config: TeamConfig,
  ticketIdRe: RegExp,
): Map<string, Map<string, EngineerBlock>> {
  const repoToProduct = buildRepoToProduct(config);
  const prefixToProduct = buildPrefixToProduct(config);
  const ocpbugsSummaryRe = buildOcpbugsSummaryRepoRe(config);
  const productOrder = [...config.products.map((p) => p.key), "Other"];
  const engineerNames = config.engineers.map((e) => e.name);

  const sections = new Map<string, Map<string, EngineerBlock>>();
  for (const pk of productOrder) {
    sections.set(pk, new Map());
  }

  function getBlock(product: string, engineer: string): EngineerBlock {
    if (!sections.has(product)) {
      sections.set(product, new Map());
    }
    const productMap = sections.get(product)!;
    if (!productMap.has(engineer)) {
      productMap.set(engineer, {
        name: engineer,
        completed_tickets: [],
        completed_prs: [],
        in_progress_tickets: [],
        in_progress_prs: [],
      });
    }
    return productMap.get(engineer)!;
  }

  for (const t of completedTickets) {
    const product = determineProduct(t, config, repoToProduct, prefixToProduct, ocpbugsSummaryRe, ticketIdRe);
    getBlock(product, t.engineer).completed_tickets.push(t);
  }
  for (const p of completedOrphanPrs) {
    const product = determineProduct(p, config, repoToProduct, prefixToProduct, ocpbugsSummaryRe, ticketIdRe);
    getBlock(product, p.engineer).completed_prs.push(p);
  }
  for (const t of ipTickets) {
    const product = determineProduct(t, config, repoToProduct, prefixToProduct, ocpbugsSummaryRe, ticketIdRe);
    getBlock(product, t.engineer).in_progress_tickets.push(t);
  }
  for (const p of ipOrphanPrs) {
    const product = determineProduct(p, config, repoToProduct, prefixToProduct, ocpbugsSummaryRe, ticketIdRe);
    getBlock(product, p.engineer).in_progress_prs.push(p);
  }

  const nameOrder = new Map(engineerNames.map((n, i) => [n, i]));
  for (const [pk, engineers] of sections) {
    const sorted = new Map(
      [...engineers.entries()].sort(
        (a, b) => (nameOrder.get(a[0]) ?? 99) - (nameOrder.get(b[0]) ?? 99),
      ),
    );
    sections.set(pk, sorted);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtDate(datestr: string): string {
  const dt = parseDate(datestr);
  if (!dt) return "";
  const month = MONTH_NAMES[dt.getUTCMonth()];
  const day = dt.getUTCDate();
  return `${month} ${day}`;
}

export function fmtReportDate(d: Date): string {
  const month = FULL_MONTH_NAMES[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

export function fmtPrLink(pr: PRItem, indent: number = 0): string {
  const prefix = "  ".repeat(indent) + "- ";
  const label = pr.source === "github" ? "PR" : "MR";
  const num = pr.source === "github" ? `#${pr.number}` : `!${pr.number}`;
  const mergedStr = pr.merged_at
    ? ` (merged ${fmtDate(pr.merged_at)})`
    : ` (opened ${fmtDate(pr.created_at)})`;
  return `${prefix}[${label} ${num} - ${pr.title}](${pr.url})${mergedStr}`;
}

export function fmtTicketLink(t: JiraItem, completed: boolean = true): string {
  const qaTag = t.role === "qa_contact" ? " (QA)" : "";
  if (completed) {
    return `- [${t.key} - ${t.summary}](${t.url}) (resolved ${fmtDate(t.resolutiondate)})${qaTag}`;
  }
  const statusStr = t.status;
  const prioritySuffix =
    t.priority === "Blocker" || t.priority === "Critical"
      ? `, ${t.priority} priority`
      : "";
  return `- [${t.key} - ${t.summary}](${t.url}) (${statusStr}${prioritySuffix})${qaTag}`;
}

export function fmtTestTaskSummary(testTickets: JiraItem[]): string {
  const versions = new Set<string>();
  for (const t of testTickets) {
    const matches = t.summary.matchAll(/cnv-(\d+\.\d+\.\d+)/gi);
    for (const m of matches) {
      versions.add(m[1]);
    }
  }
  const versionStr = versions.size > 0 ? [...versions].sort().join(", ") : "multiple versions";
  const links = testTickets
    .slice(0, 5)
    .map((t) => `[${t.key}](${t.url})`)
    .join(", ");
  const extra = testTickets.length > 5 ? `, and ${testTickets.length - 5} more` : "";
  return `- ${testTickets.length} CNV release test execution tasks completed — Tier 1/2 testing for CNV ${versionStr} (${links}${extra})`;
}

export function formatCompletedSection(
  sections: Map<string, Map<string, EngineerBlock>>,
  config: TeamConfig,
): string {
  const lines: string[] = [];
  const productNames = new Map(config.products.map((p) => [p.key, p.name]));
  productNames.set("Other", "Cross-Product & General");

  for (const [pk, engineers] of sections) {
    let hasCompleted = false;
    for (const [, block] of engineers) {
      if (block.completed_tickets.length > 0 || block.completed_prs.length > 0) {
        hasCompleted = true;
        break;
      }
    }
    if (!hasCompleted) continue;

    const pn = productNames.get(pk) ?? pk;
    lines.push(pn !== pk ? `\n### ${pk} (${pn})\n` : `\n### ${pk}\n`);

    for (const [engName, block] of engineers) {
      if (block.completed_tickets.length === 0 && block.completed_prs.length === 0) continue;
      lines.push(`**${engName}:**`);

      const { consolidate, testTickets, otherTickets } = shouldConsolidateTestTasks(
        block.completed_tickets,
      );

      for (const t of otherTickets) {
        lines.push(fmtTicketLink(t, true));
        for (const pr of t.nested_prs) {
          lines.push(fmtPrLink(pr, 1));
        }
      }

      if (consolidate && testTickets.length > 0) {
        lines.push(fmtTestTaskSummary(testTickets));
      } else if (testTickets.length > 0) {
        for (const t of testTickets) {
          lines.push(fmtTicketLink(t, true));
        }
      }

      for (const pr of block.completed_prs) {
        lines.push(fmtPrLink(pr, 0));
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatInProgressSection(
  sections: Map<string, Map<string, EngineerBlock>>,
  config: TeamConfig,
): string {
  const lines: string[] = [];
  const productNames = new Map(config.products.map((p) => [p.key, p.name]));
  productNames.set("Other", "Cross-Product & General");

  for (const [pk, engineers] of sections) {
    let hasIp = false;
    for (const [, block] of engineers) {
      if (block.in_progress_tickets.length > 0 || block.in_progress_prs.length > 0) {
        hasIp = true;
        break;
      }
    }
    if (!hasIp) continue;

    const pn = productNames.get(pk) ?? pk;
    lines.push(pn !== pk ? `\n### ${pk} (${pn})\n` : `\n### ${pk}\n`);

    for (const [engName, block] of engineers) {
      if (block.in_progress_tickets.length === 0 && block.in_progress_prs.length === 0) continue;
      lines.push(`**${engName}:**`);

      for (const t of block.in_progress_tickets) {
        lines.push(fmtTicketLink(t, false));
        for (const pr of t.nested_prs) {
          lines.push(fmtPrLink(pr, 1));
        }
      }

      for (const pr of block.in_progress_prs) {
        lines.push(fmtPrLink(pr, 0));
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Key highlights
// ---------------------------------------------------------------------------

function cleanSummary(summary: string): string {
  let s = summary.replace(/^\[(?:UI|QE|RFE|TP)\]\s*/i, "");
  s = s.replace(/^\[(?:UI|QE|RFE|TP)\]\s*/i, "");
  s = s.replace(/^\[tackle2-ui#\d+\]\s*/, "");
  s = s.trim();
  if (s.length > 0 && s[0] === s[0].toUpperCase() && (s.length < 2 || s[1] !== s[1].toUpperCase())) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

function isFillerTicket(summary: string): boolean {
  return /AI Challenge|Polarion test plan/i.test(summary);
}

function extractCveLibs(texts: string[]): string[] {
  const libPatterns: [RegExp, string][] = [
    [/\blodash\b/, "lodash"],
    [/\bimmutable\b/, "immutable"],
    [/\baxios\b/, "axios"],
    [/\bfast-xml-parser\b/, "fast-xml-parser"],
    [/\bqs\b/, "qs"],
    [/\bfollow-redirects\b/, "follow-redirects"],
    [/\breact.router\b/, "react-router"],
  ];
  const found: string[] = [];
  const combined = texts.join(" ").toLowerCase();
  for (const [pattern, name] of libPatterns) {
    if (pattern.test(combined)) {
      found.push(name);
    }
  }
  return found;
}

export interface HighlightData {
  cve: { count: number; products: string[]; libraries: string[] } | null;
  testing: { versions: string[] } | null;
  features: Map<string, string[]>;
  bugs: Map<string, string[]>;
}

export function computeHighlightData(
  sections: Map<string, Map<string, EngineerBlock>>,
): HighlightData {
  let cveCount = 0;
  const cveProducts = new Set<string>();
  const cveTexts: string[] = [];
  const testVersions = new Set<string>();
  const features = new Map<string, string[]>();
  const bugs = new Map<string, string[]>();

  for (const [pk, engineers] of sections) {
    for (const [, block] of engineers) {
      for (const t of block.completed_tickets) {
        const isTest = /^\[(?:TIER|POST|STAGE)/i.test(t.summary);
        const isCve = t.summary.toUpperCase().includes("CVE");
        if (isTest) {
          const matches = t.summary.matchAll(/cnv-(\d+\.\d+\.\d+)/gi);
          for (const m of matches) {
            testVersions.add(m[1]);
          }
        } else if (isCve) {
          cveCount += 1 + t.nested_prs.length;
          cveProducts.add(pk);
          cveTexts.push(t.summary);
          for (const pr of t.nested_prs) {
            cveTexts.push(pr.title);
          }
        } else if (!isFillerTicket(t.summary)) {
          if (t.issuetype === "Story" || t.issuetype === "Epic") {
            if (!features.has(pk)) features.set(pk, []);
            features.get(pk)!.push(cleanSummary(t.summary));
          } else if (t.issuetype === "Bug") {
            if (!bugs.has(pk)) bugs.set(pk, []);
            bugs.get(pk)!.push(cleanSummary(t.summary));
          }
        }
      }

      for (const pr of block.completed_prs) {
        if (pr.title.toUpperCase().includes("CVE")) {
          cveCount++;
          cveProducts.add(pk);
          cveTexts.push(pr.title);
        }
      }
    }
  }

  return {
    cve: cveCount > 0
      ? { count: cveCount, products: [...cveProducts].sort(), libraries: extractCveLibs(cveTexts) }
      : null,
    testing: testVersions.size > 0 ? { versions: [...testVersions].sort() } : null,
    features,
    bugs,
  };
}

export function formatHighlightContext(data: HighlightData): string {
  const lines: string[] = ["--- Highlight Context ---"];
  if (data.cve) {
    const libStr = data.cve.libraries.length > 0 ? ` (${data.cve.libraries.join(", ")})` : "";
    lines.push(`  CVE: ${data.cve.count} fixes across ${data.cve.products.join(", ")}${libStr}`);
  }
  if (data.testing) {
    lines.push(`  Testing: CNV Tier 1/2 for ${data.testing.versions.join(", ")}`);
  }
  const fmtMap = (label: string, m: Map<string, string[]>) => {
    const parts = [...m.entries()].filter(([, v]) => v.length > 0).map(([k, v]) => `${k} (${v.length})`);
    if (parts.length > 0) lines.push(`  ${label}: ${parts.join(", ")}`);
  };
  fmtMap("Features", data.features);
  fmtMap("Bugs", data.bugs);
  return lines.join("\n");
}

export function generateHighlights(
  sections: Map<string, Map<string, EngineerBlock>>,
): string[] {
  const data = computeHighlightData(sections);
  const highlights: string[] = [];

  if (data.cve) {
    const libStr = data.cve.libraries.length > 0 ? ` for ${data.cve.libraries.join(", ")}` : "";
    highlights.push(
      `- CVE remediation across ${data.cve.products.join(" and ")} — ${data.cve.count} fixes shipped${libStr}`,
    );
  }

  if (data.testing) {
    highlights.push(
      `- Completed Tier 1/2 release testing for CNV ${data.testing.versions.join(", ")}`,
    );
  }

  for (const [pk, items] of data.features) {
    if (items.length > 0) {
      const detail = items.slice(0, 3).join("; ");
      highlights.push(`- ${pk} feature delivery: ${detail}`);
    }
  }

  for (const [pk, items] of data.bugs) {
    if (items.length > 0) {
      const detail = items.slice(0, 3).join("; ");
      highlights.push(`- ${pk} quality: ${detail}`);
    }
  }

  return highlights.slice(0, 4);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  date: string;
  cacheDir: string;
  output: string | null;
  config: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    date: "",
    cacheDir: "agents/weekly-team-update/data/cache",
    output: null,
    config: "agents/weekly-team-update/data/team-config.json",
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--date":
        args.date = argv[++i];
        break;
      case "--cache-dir":
        args.cacheDir = argv[++i];
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--config":
        args.config = argv[++i];
        break;
    }
  }

  if (!args.date) {
    process.stderr.write(
      `${RED}ERROR: --date is required (YYYY-MM-DD)${RESET}\n`,
    );
    process.exit(1);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv: string[] = process.argv): void {
  const args = parseArgs(argv);

  const reportDate = new Date(args.date + "T00:00:00Z");
  if (isNaN(reportDate.getTime())) {
    process.stderr.write(
      `${RED}ERROR: invalid date format: ${args.date} (use YYYY-MM-DD)${RESET}\n`,
    );
    process.exit(1);
  }

  const windowStart = new Date(reportDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(reportDate.getTime() + 1 * 24 * 60 * 60 * 1000);
  const cacheDir = args.cacheDir;
  const outputPath =
    args.output ??
    `agents/weekly-team-update/data/output/weekly-update-${args.date}.md`;

  const config = loadConfig(args.config);
  const ticketIdRe = buildTicketIdRe(config);

  // Load data
  console.log(`Loading CSVs from ${cacheDir}/...`);
  const githubPrs = loadGithubPrs(cacheDir);
  const gitlabMrs = loadGitlabMrs(cacheDir);
  const jiraTickets = loadJiraTickets(cacheDir, config);
  const allPrs = [...githubPrs, ...gitlabMrs];

  console.log(`  GitHub PRs: ${githubPrs.length} rows`);
  console.log(`  GitLab MRs: ${gitlabMrs.length} rows`);
  console.log(`  Jira tickets: ${jiraTickets.length} rows`);

  // Validate
  const { warnings, errors } = validateData(githubPrs, gitlabMrs, jiraTickets, config);
  if (errors.length > 0) {
    for (const e of errors) {
      process.stderr.write(`${RED}ERROR: ${e}${RESET}\n`);
    }
    process.stderr.write(
      `\n${RED}Cannot generate report — fix data issues above and retry.${RESET}\n`,
    );
    process.exit(2);
  }

  // Filter
  const completedPrs = filterCompletedPrs(allPrs, windowStart, windowEnd);
  const openPrs = filterOpenPrs(allPrs);
  const completedJira = filterCompletedJira(jiraTickets, windowStart, windowEnd);
  const ipJira = filterInProgressJira(jiraTickets);

  const wsStr = windowStart.toISOString().slice(0, 10);
  const rdStr = reportDate.toISOString().slice(0, 10);
  console.log(`\nFiltered (7-day window ${wsStr} to ${rdStr}):`);
  console.log(`  Completed PRs/MRs: ${completedPrs.length}`);
  console.log(`  Open PRs/MRs: ${openPrs.length}`);
  console.log(`  Jira resolved (Done): ${completedJira.length}`);
  console.log(`  Jira in progress: ${ipJira.length}`);

  if (completedJira.length === 0) {
    warnings.push("0 Jira tickets resolved in window — report may be incomplete");
  }

  // Nest PRs under Jira tickets
  const { tickets: completedTickets, orphanPrs: completedOrphanPrs } =
    nestPrsUnderTickets(completedPrs, completedJira, ticketIdRe);
  const { tickets: ipTickets, orphanPrs: ipOrphanPrs } =
    nestInProgress(openPrs, ipJira, ticketIdRe);

  const nestedCount = completedTickets.reduce((s, t) => s + t.nested_prs.length, 0);
  const ticketsWithPrs = completedTickets.filter((t) => t.nested_prs.length > 0).length;
  console.log(`\nNesting: ${nestedCount} PRs nested under ${ticketsWithPrs} Jira tickets`);

  // Organize by product
  const sections = organize(
    completedTickets,
    completedOrphanPrs,
    ipTickets,
    ipOrphanPrs,
    config,
    ticketIdRe,
  );

  // Compute highlight data (printed to stdout for agent consumption)
  const highlightData = computeHighlightData(sections);

  const reportLines: string[] = [
    `# ${config.report_title}`,
    fmtReportDate(reportDate),
    "",
    "## Key Highlights",
    "<!-- HIGHLIGHTS_PLACEHOLDER -->",
    "- (highlights pending)",
  ];
  reportLines.push("");

  if (warnings.length > 0) {
    reportLines.push("## Data Quality Notes");
    for (const w of warnings) {
      reportLines.push(`- ${w}`);
    }
    reportLines.push("");
  }

  reportLines.push("## Completed This Week");
  reportLines.push(formatCompletedSection(sections, config));

  reportLines.push("## In Progress");
  reportLines.push(formatInProgressSection(sections, config));

  const reportText = reportLines.join("\n") + "\n";

  // Save
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, reportText);
  console.log(`\n${GREEN}Report saved to ${outputPath}${RESET}`);

  // Summary
  const totalCompleted = completedPrs.length + completedJira.length;
  const totalIp = openPrs.length + ipJira.length;
  console.log(`\n--- Report Statistics ---`);
  console.log(`  GitHub PRs merged: ${completedPrs.filter((p) => p.source === "github").length}`);
  console.log(`  GitLab MRs merged: ${completedPrs.filter((p) => p.source === "gitlab").length}`);
  console.log(`  Jira tickets closed (Done): ${completedJira.length}`);
  console.log(`  Total completed items: ${totalCompleted}`);
  console.log(`  Total in-progress items: ${totalIp}`);
  console.log(`  Date range: ${wsStr} to ${rdStr}`);
  console.log(`\n${formatHighlightContext(highlightData)}`);

  if (warnings.length > 0) {
    process.stderr.write(
      `\n${YELLOW}Warnings present — review report before sharing.${RESET}\n`,
    );
    process.exit(3);
  }

  process.exit(0);
}

// Run if executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""));
if (isMain) {
  main();
}
