#!/usr/bin/env npx tsx
/**
 * Fetch weekly team data from GitHub, GitLab, and Jira APIs.
 * TypeScript port of fetch-data.py — same logic, same CSV output.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const DATA_DIR = resolve(SCRIPT_DIR, "..", "data");
const CACHE_DIR = resolve(DATA_DIR, "cache");
const CONFIG_PATH = resolve(DATA_DIR, "team-config.json");

const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const SEVEN_DAYS_AGO = sevenDaysAgo.toISOString().slice(0, 10);
const SEVEN_DAYS_AGO_ISO = `${SEVEN_DAYS_AGO}T00:00:00Z`;

// --- Types ---

interface Engineer {
  name: string;
  github: string;
  gitlab: string;
  jira_account_id: string;
}

interface TeamConfig {
  sprint_name_pattern: string;
  jira: {
    cloud_id: string;
    projects: string[];
  };
  gitlab?: {
    api_url?: string;
  };
  engineers: Engineer[];
}

interface GitHubPr {
  engineer: string;
  number: number;
  title: string;
  repo: string;
  state: string;
  created_at: string;
  merged_at: string;
  html_url: string;
  issue_refs: string;
}

interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  resolution: string;
  resolutiondate: string;
  statuscategorychangedate: string;
  issuetype: string;
  priority: string;
  assignee_id: string;
  assignee_name: string;
  qa_contact_id: string;
  qa_contact_name: string;
  sprint_name: string;
  issuelinks: JiraIssueLink[];
}

interface JiraIssueLink {
  type?: { name?: string };
  outwardIssue?: {
    key?: string;
    fields?: { summary?: string };
  };
}

interface CustomerCase {
  ticket_key: string;
  case_id: string;
  case_url: string;
  customer_name: string;
}

interface GitLabMr {
  engineer: string;
  iid: number;
  title: string;
  project_path: string;
  state: string;
  created_at: string;
  merged_at: string;
  web_url: string;
}

// --- Load config ---

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as TeamConfig;
const engineers = config.engineers;
const jiraConfig = config.jira;
const sprintPattern = new RegExp(config.sprint_name_pattern);

// --- Auth ---

const GITHUB_PAT = process.env.GITHUB_PAT ?? "";
const GITLAB_PAT = process.env.GITLAB_PAT ?? "";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";

// --- HTTP helpers ---

async function githubRequest(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_PAT}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) {
      console.error(`  GitHub error ${res.status}: ${url.slice(0, 80)}`);
      return { items: [] };
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error(`  GitHub error: ${String(e)}`);
    return { items: [] };
  }
}

async function gitlabRequest(url: string): Promise<unknown[]> {
  try {
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": GITLAB_PAT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 100);
      console.error(`  GitLab error ${res.status}: ${body}`);
      return [];
    }
    return (await res.json()) as unknown[];
  } catch (e) {
    console.error(`  GitLab connection error: ${String(e)}`);
    return [];
  }
}

interface JiraSearchResult {
  issues?: Array<{
    key: string;
    fields?: Record<string, unknown>;
  }>;
}

async function jiraRequest(
  jql: string,
  fields: string[],
): Promise<JiraSearchResult> {
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString(
    "base64",
  );
  const base = `https://${jiraConfig.cloud_id}/rest/api/3/search/jql`;
  const params = new URLSearchParams({
    jql,
    maxResults: "100",
    fields: fields.join(","),
  });
  const url = `${base}?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`  Jira error ${res.status}: ${body}`);
      return { issues: [] };
    }
    return (await res.json()) as JiraSearchResult;
  } catch (e) {
    console.error(`  Jira error: ${String(e)}`);
    return { issues: [] };
  }
}

// --- CSV helpers ---

function str(value: unknown): string {
  if (value == null) return "";
  return `${value as string | number}`;
}

function csvEscape(value: string): string {
  value = value.replace(/"/g, '""');
  if (value.includes(",") || value.includes('"')) {
    return `"${value}"`;
  }
  return value;
}

function extractIssueRefs(body: string | null | undefined): string {
  if (!body) return "";
  const refs = new Set<string>();
  const pattern =
    /(?:(?:closes?|fixes?|resolves?)\s*#(\d+))|(?:#(\d+))|(?:\/issues\/(\d+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    for (let i = 1; i <= 3; i++) {
      if (match[i]) refs.add(match[i]);
    }
  }
  return [...refs].sort().join(" ");
}

interface SprintObject {
  state?: string;
  name?: string;
}

function extractSprintName(sprintField: unknown): string {
  if (!Array.isArray(sprintField)) return "";
  const sprints = sprintField as SprintObject[];

  for (const s of sprints) {
    if (s.state === "active" && s.name && sprintPattern.test(s.name)) {
      return s.name;
    }
  }
  for (const s of sprints) {
    if (s.state === "active") return s.name ?? "";
  }
  for (const s of sprints) {
    if (s.state === "future") return s.name ?? "";
  }
  return "";
}

function parseJiraIssue(
  issue: { key: string; fields?: Record<string, unknown> },
  fallbackSprint?: string,
): JiraTicket {
  const f = issue.fields ?? {};
  const assignee = (f.assignee ?? {}) as Record<string, unknown>;
  const qaContact = (f.customfield_10470 ?? {}) as Record<string, unknown>;
  const sprintName = extractSprintName(f.customfield_10020);

  return {
    key: issue.key,
    summary: str(f.summary),
    status: str((f.status as Record<string, unknown> | null)?.name),
    resolution: str((f.resolution as Record<string, unknown> | null)?.name),
    resolutiondate: str(f.resolutiondate),
    statuscategorychangedate: str(f.statuscategorychangedate),
    issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
    priority: str((f.priority as Record<string, unknown> | null)?.name),
    assignee_id: str(assignee?.accountId),
    assignee_name: str(assignee?.displayName),
    qa_contact_id: str(qaContact?.accountId),
    qa_contact_name: str(qaContact?.displayName),
    sprint_name: sprintName || fallbackSprint || "",
    issuelinks: (f.issuelinks ?? []) as JiraIssueLink[],
  };
}

// --- Main ---

async function main(): Promise<void> {
  if (!JIRA_API_TOKEN || !JIRA_EMAIL) {
    console.error(
      "JIRA_API_TOKEN and JIRA_EMAIL environment variables are required.",
    );
    console.error(
      "Get a token from: https://id.atlassian.com/manage-profile/security/api-tokens",
    );
    process.exit(1);
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  // --- GITHUB ---

  console.log("=== Fetching GitHub PRs ===");
  const githubPrs: GitHubPr[] = [];
  const seenPrKeys = new Set<string>();

  for (const eng of engineers) {
    console.log(`  ${eng.name} (${eng.github})...`);

    const mergedQuery = `author:${eng.github} is:pr is:merged merged:${SEVEN_DAYS_AGO}..${TODAY}`;
    const mergedData = await githubRequest(
      `https://api.github.com/search/issues?q=${encodeURIComponent(mergedQuery)}&per_page=100`,
    );
    const mergedItems = (mergedData.items ?? []) as Array<
      Record<string, unknown>
    >;
    for (const pr of mergedItems) {
      const repoUrl = str(pr.repository_url);
      const prNumber = Number(pr.number);
      const key = `${repoUrl}:${prNumber}`;
      const repoParts = repoUrl.split("/");
      const repo =
        repoParts.length >= 2
          ? `${repoParts[repoParts.length - 2]}/${repoParts[repoParts.length - 1]}`
          : "";
      const pullRequest = pr.pull_request as
        | Record<string, unknown>
        | undefined;
      const mergedAt = pullRequest?.merged_at ? str(pullRequest.merged_at) : "";

      githubPrs.push({
        engineer: eng.name,
        number: prNumber,
        title: str(pr.title),
        repo,
        state: "merged",
        created_at: str(pr.created_at),
        merged_at: mergedAt,
        html_url: str(pr.html_url),
        issue_refs: extractIssueRefs(pr.body as string | undefined),
      });
      seenPrKeys.add(key);
    }

    const openQuery = `author:${eng.github} is:open is:pr`;
    const openData = await githubRequest(
      `https://api.github.com/search/issues?q=${encodeURIComponent(openQuery)}&per_page=100`,
    );
    const openItems = (openData.items ?? []) as Array<Record<string, unknown>>;
    for (const pr of openItems) {
      const repoUrl = str(pr.repository_url);
      const prNumber = Number(pr.number);
      const key = `${repoUrl}:${prNumber}`;
      if (seenPrKeys.has(key)) continue;
      const repoParts = repoUrl.split("/");
      const repo =
        repoParts.length >= 2
          ? `${repoParts[repoParts.length - 2]}/${repoParts[repoParts.length - 1]}`
          : "";

      githubPrs.push({
        engineer: eng.name,
        number: prNumber,
        title: str(pr.title),
        repo,
        state: "open",
        created_at: str(pr.created_at),
        merged_at: "",
        html_url: str(pr.html_url),
        issue_refs: extractIssueRefs(pr.body as string | undefined),
      });
      seenPrKeys.add(key);
    }
  }

  console.log(`  Total GitHub PRs: ${githubPrs.length}`);

  const githubCsvLines = [
    "engineer,number,title,repo,state,created_at,merged_at,html_url,issue_refs",
  ];
  for (const pr of githubPrs) {
    githubCsvLines.push(
      `${csvEscape(pr.engineer)},${pr.number},${csvEscape(pr.title)},` +
        `${pr.repo},${pr.state},${pr.created_at},${pr.merged_at},` +
        `${pr.html_url},${pr.issue_refs}`,
    );
  }
  writeFileSync(
    resolve(CACHE_DIR, "github-prs.csv"),
    githubCsvLines.join("\n") + "\n",
  );

  // --- JIRA ---

  console.log("\n=== Fetching Jira Tickets ===");
  const jiraTickets = new Map<string, JiraTicket>();
  let activeSprintName = "";

  const projectsClause = jiraConfig.projects.map((p) => `"${p}"`).join(", ");
  const jiraFields = [
    "summary",
    "status",
    "assignee",
    "resolution",
    "resolutiondate",
    "statuscategorychangedate",
    "issuetype",
    "priority",
    "updated",
    "created",
    "customfield_10470",
    "customfield_10020",
    "issuelinks",
  ];

  for (const eng of engineers) {
    console.log(`  ${eng.name} (${eng.jira_account_id.slice(0, 20)}...)...`);

    const jql =
      `(assignee = "${eng.jira_account_id}" OR cf[10470] = "${eng.jira_account_id}") ` +
      `AND project in (${projectsClause}) ` +
      `AND updated >= -7d ORDER BY updated DESC`;
    const data = await jiraRequest(jql, jiraFields);
    const issues = data.issues ?? [];
    console.log(`    Found ${issues.length} tickets`);

    for (const issue of issues) {
      if (jiraTickets.has(issue.key)) continue;
      const ticket = parseJiraIssue(issue);
      if (
        ticket.sprint_name &&
        sprintPattern.test(ticket.sprint_name) &&
        !activeSprintName
      ) {
        activeSprintName = ticket.sprint_name;
      }
      jiraTickets.set(issue.key, ticket);
    }
  }

  console.log(`  Total unique Jira tickets: ${jiraTickets.size}`);
  console.log(`  Active sprint: ${activeSprintName || "not found"}`);

  if (activeSprintName) {
    console.log(`\n=== Fetching Sprint Backlog: ${activeSprintName} ===`);
    const jql = `sprint = "${activeSprintName}" ORDER BY key ASC`;
    const data = await jiraRequest(jql, jiraFields);
    const sprintIssues = data.issues ?? [];
    console.log(`  Sprint backlog: ${sprintIssues.length} tickets`);

    let added = 0;
    for (const issue of sprintIssues) {
      if (jiraTickets.has(issue.key)) continue;
      jiraTickets.set(issue.key, parseJiraIssue(issue, activeSprintName));
      added++;
    }
    console.log(`  Added ${added} new tickets from sprint backlog`);
  }

  console.log(`  Final Jira ticket count: ${jiraTickets.size}`);

  const jiraCsvLines = [
    "key,summary,status,resolution,resolutiondate,statuscategorychangedate,issuetype,priority,assignee_id,assignee_name,qa_contact_id,qa_contact_name,sprint_name",
  ];
  for (const ticket of jiraTickets.values()) {
    jiraCsvLines.push(
      `${ticket.key},${csvEscape(ticket.summary)},${ticket.status},` +
        `${ticket.resolution},${ticket.resolutiondate},` +
        `${ticket.statuscategorychangedate},${ticket.issuetype},` +
        `${ticket.priority},${ticket.assignee_id},` +
        `${csvEscape(ticket.assignee_name)},${ticket.qa_contact_id},` +
        `${csvEscape(ticket.qa_contact_name)},${ticket.sprint_name}`,
    );
  }
  writeFileSync(
    resolve(CACHE_DIR, "jira-tickets.csv"),
    jiraCsvLines.join("\n") + "\n",
  );

  // --- CUSTOMER ACCOUNTS ---

  console.log("\n=== Extracting Customer Accounts from Issue Links ===");
  const customerCases: CustomerCase[] = [];
  const jiraBase = jiraConfig.cloud_id;

  for (const [key, ticket] of jiraTickets) {
    for (const link of ticket.issuelinks) {
      if (link.type?.name !== "Account") continue;
      const outward = link.outwardIssue;
      if (!outward) continue;
      const accountKey = outward.key ?? "";
      if (!accountKey.startsWith("CIPOE-")) continue;
      const customerName = outward.fields?.summary ?? "";
      customerCases.push({
        ticket_key: key,
        case_id: accountKey,
        case_url: `https://${jiraBase}/browse/${accountKey}`,
        customer_name: customerName,
      });
    }
  }

  const ticketsWithCases = new Set(customerCases.map((c) => c.ticket_key)).size;
  console.log(
    `  Found ${customerCases.length} customer accounts across ${ticketsWithCases} tickets`,
  );

  const customerCsvLines = ["ticket_key,case_id,case_url,customer_name"];
  for (const cc of customerCases) {
    customerCsvLines.push(
      `${cc.ticket_key},${cc.case_id},${cc.case_url},${csvEscape(cc.customer_name)}`,
    );
  }
  writeFileSync(
    resolve(CACHE_DIR, "customer-cases.csv"),
    customerCsvLines.join("\n") + "\n",
  );

  // --- GITLAB ---

  console.log("\n=== Fetching GitLab MRs ===");
  const gitlabMrs: GitLabMr[] = [];
  const GITLAB_API = config.gitlab?.api_url ?? process.env.GITLAB_API_URL ?? "";

  if (!GITLAB_API) {
    console.log(
      "  No GitLab API URL configured (config.gitlab.api_url or GITLAB_API_URL env). Skipping.",
    );
  } else {
    const gitlabBase = GITLAB_API.split("/api/")[0] + "/";

    for (const eng of engineers) {
      console.log(`  ${eng.name} (${eng.gitlab})...`);

      const mergedUrl =
        `${GITLAB_API}/merge_requests?` +
        `author_username=${eng.gitlab}&scope=all&state=merged` +
        `&updated_after=${SEVEN_DAYS_AGO_ISO}&per_page=100`;
      const mergedData = await gitlabRequest(mergedUrl);
      for (const mr of mergedData) {
        const mrObj = mr as Record<string, unknown>;
        const webUrl = str(mrObj.web_url);
        const projectPath = webUrl.includes("/-/")
          ? webUrl.replace(gitlabBase, "").split("/-/")[0]
          : "";
        gitlabMrs.push({
          engineer: eng.name,
          iid: Number(mrObj.iid ?? 0),
          title: str(mrObj.title),
          project_path: projectPath,
          state: "merged",
          created_at: str(mrObj.created_at),
          merged_at: str(mrObj.merged_at),
          web_url: webUrl,
        });
      }

      const openUrl =
        `${GITLAB_API}/merge_requests?` +
        `author_username=${eng.gitlab}&scope=all&state=opened&per_page=100`;
      const openData = await gitlabRequest(openUrl);
      for (const mr of openData) {
        const mrObj = mr as Record<string, unknown>;
        const webUrl = str(mrObj.web_url);
        const projectPath = webUrl.includes("/-/")
          ? webUrl.replace(gitlabBase, "").split("/-/")[0]
          : "";
        gitlabMrs.push({
          engineer: eng.name,
          iid: Number(mrObj.iid ?? 0),
          title: str(mrObj.title),
          project_path: projectPath,
          state: "open",
          created_at: str(mrObj.created_at),
          merged_at: "",
          web_url: webUrl,
        });
      }
    }
  }

  console.log(`  Total GitLab MRs: ${gitlabMrs.length}`);

  const gitlabCsvLines = [
    "engineer,iid,title,project_path,state,created_at,merged_at,web_url",
  ];
  for (const mr of gitlabMrs) {
    gitlabCsvLines.push(
      `${csvEscape(mr.engineer)},${mr.iid},${csvEscape(mr.title)},` +
        `${mr.project_path},${mr.state},${mr.created_at},` +
        `${mr.merged_at},${mr.web_url}`,
    );
  }
  writeFileSync(
    resolve(CACHE_DIR, "gitlab-mrs.csv"),
    gitlabCsvLines.join("\n") + "\n",
  );

  writeFileSync(
    resolve(CACHE_DIR, "last-updated.txt"),
    new Date().toISOString() + "\n",
  );

  // --- Summary ---

  console.log("\n=== Summary ===");
  console.log(`GitHub PRs: ${githubPrs.length}`);
  console.log(`Jira Tickets: ${jiraTickets.size}`);
  console.log(`GitLab MRs: ${gitlabMrs.length}`);
  console.log(`Customer Accounts: ${customerCases.length}`);
  console.log(`Active Sprint: ${activeSprintName || "not found"}`);
  console.log(`Cache saved to: ${CACHE_DIR}`);
}

const isDirectRun = process.argv[1]?.endsWith("fetch-data.ts");
if (isDirectRun) void main();
