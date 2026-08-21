#!/usr/bin/env npx tsx
/**
 * Fetch data for jira-story-points agent via direct API calls.
 * Replaces MCP-based Steps 2, 4, and 4.5 of the agent spec.
 *
 * Usage:
 *   npx tsx fetch-data.ts --sync-reference   # sync reference cache (Step 2)
 *   npx tsx fetch-data.ts --ticket CNV-12345  # fetch single target + PR context
 *   npx tsx fetch-data.ts --backlog           # fetch backlog batch + PR context
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const DATA_DIR = resolve(SCRIPT_DIR, "..", "data");
const CACHE_DIR = resolve(DATA_DIR, "cache");
const CONFIG_PATH = resolve(DATA_DIR, "config.json");

// --- Types ---

interface JiraConfig {
  cloud_id: string;
  base_url: string;
  user_email: string;
  story_points_field: string;
  reference_jql: string;
  backlog_jql: string;
  max_reference_tickets: number;
}

interface Config {
  jira: JiraConfig;
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

interface PrInfo {
  url: string;
  files: number;
  additions: number;
  deletions: number;
}

interface PrContext {
  total_files: number;
  total_additions: number;
  total_deletions: number;
  prs: PrInfo[];
}

interface TargetTicket {
  key: string;
  summary: string;
  description: string;
  issuetype: string;
  priority: string;
  labels: string[];
  components: string[];
  status: string;
  story_points: number | null;
  pr_context: PrContext;
}

// --- Auth ---

const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";
const GITHUB_PAT = process.env.GITHUB_PAT ?? "";

// --- HTTP helpers ---

function str(value: unknown): string {
  if (value == null) return "";
  return `${value as string | number}`;
}

function jiraAuth(): string {
  return Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

async function jiraGet(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${jiraAuth()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`  Jira error ${res.status}: ${body}`);
      return {};
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error(`  Jira error: ${String(e)}`);
    return {};
  }
}

async function jiraSearch(
  cloudId: string,
  jql: string,
  fields: string[],
  maxResults: number,
  nextPageToken?: string,
): Promise<{
  issues: Array<Record<string, unknown>>;
  total: number;
  nextPageToken?: string;
}> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(maxResults),
    fields: fields.join(","),
  });
  if (nextPageToken) params.set("nextPageToken", nextPageToken);
  const url = `https://${cloudId}/rest/api/3/search/jql?${params}`;
  const data = await jiraGet(url);
  const issues = (data.issues ?? []) as Array<Record<string, unknown>>;
  const total = (data.total ?? 0) as number;
  return {
    issues,
    total,
    nextPageToken: data.nextPageToken as string | undefined,
  };
}

async function githubGet(url: string): Promise<unknown[]> {
  if (!GITHUB_PAT) return [];
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_PAT}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) {
      console.error(`  GitHub error ${res.status}: ${url.slice(0, 80)}`);
      return [];
    }
    return (await res.json()) as unknown[];
  } catch (e) {
    console.error(`  GitHub error: ${String(e)}`);
    return [];
  }
}

// --- Reference sync ---

function isCacheFresh(): boolean {
  const lastUpdatedPath = resolve(CACHE_DIR, "last-updated.txt");
  if (!existsSync(lastUpdatedPath)) return false;
  const lastUpdated = readFileSync(lastUpdatedPath, "utf-8").trim();
  const lastDate = new Date(lastUpdated);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return lastDate > sevenDaysAgo;
}

async function syncReference(config: Config): Promise<void> {
  const refPath = resolve(CACHE_DIR, "reference-tickets.json");

  if (existsSync(refPath) && isCacheFresh()) {
    const lastUpdated = readFileSync(
      resolve(CACHE_DIR, "last-updated.txt"),
      "utf-8",
    ).trim();
    console.log(
      `Reference cache is fresh (last updated: ${lastUpdated}). Skipping sync.`,
    );
    return;
  }

  console.log("=== Syncing Reference Cache ===");
  const fields = [
    "summary",
    "description",
    "issuetype",
    "priority",
    "labels",
    "components",
    "status",
    "resolution",
    config.jira.story_points_field,
  ];

  const allTickets: ReferenceTicket[] = [];
  const pageSize = 100;
  const maxTickets = config.jira.max_reference_tickets;
  let nextToken: string | undefined;

  while (allTickets.length < maxTickets) {
    const remaining = maxTickets - allTickets.length;
    const batchSize = Math.min(pageSize, remaining);
    console.log(`  Fetching page (${allTickets.length} so far)...`);

    const result = await jiraSearch(
      config.jira.cloud_id,
      config.jira.reference_jql,
      fields,
      batchSize,
      nextToken,
    );

    for (const issue of result.issues) {
      const f = (issue.fields ?? {}) as Record<string, unknown>;
      const spField = f[config.jira.story_points_field];

      allTickets.push({
        key: str(issue.key),
        summary: str(f.summary),
        description: str(f.description),
        story_points: typeof spField === "number" ? spField : 0,
        issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
        priority: str((f.priority as Record<string, unknown> | null)?.name),
        labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
        components: Array.isArray(f.components)
          ? (f.components as Array<Record<string, unknown>>).map((c) =>
              str(c.name),
            )
          : [],
        status: str((f.status as Record<string, unknown> | null)?.name),
        resolution: str((f.resolution as Record<string, unknown> | null)?.name),
      });
    }

    if (result.issues.length < batchSize || !result.nextPageToken) break;
    nextToken = result.nextPageToken;
  }

  writeFileSync(refPath, JSON.stringify(allTickets, null, 2) + "\n");
  writeFileSync(
    resolve(CACHE_DIR, "last-updated.txt"),
    new Date().toISOString() + "\n",
  );

  console.log(`Synced ${allTickets.length} reference tickets to cache.`);
}

// --- PR context ---

async function fetchPrContext(
  cloudId: string,
  ticketKey: string,
): Promise<PrContext> {
  const context: PrContext = {
    total_files: 0,
    total_additions: 0,
    total_deletions: 0,
    prs: [],
  };

  const linksUrl = `https://${cloudId}/rest/api/3/issue/${ticketKey}/remotelink`;
  const linksData = await jiraGet(linksUrl);

  const links = Array.isArray(linksData)
    ? (linksData as Array<Record<string, unknown>>)
    : [];

  const prPattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

  for (const link of links) {
    const linkObj = (link.object ?? link) as Record<string, unknown>;
    const url = str(linkObj.url);
    const match = prPattern.exec(url);
    if (!match) continue;

    const [, owner, repo, number] = match;
    const filesUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`;
    const files = await githubGet(filesUrl);

    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      const f = file as Record<string, unknown>;
      additions += (f.additions as number) ?? 0;
      deletions += (f.deletions as number) ?? 0;
    }

    context.prs.push({
      url,
      files: files.length,
      additions,
      deletions,
    });
    context.total_files += files.length;
    context.total_additions += additions;
    context.total_deletions += deletions;
  }

  return context;
}

function parseTargetTicket(
  issue: Record<string, unknown>,
  spField: string,
): Omit<TargetTicket, "pr_context"> {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const sp = f[spField];
  return {
    key: str(issue.key),
    summary: str(f.summary),
    description: str(f.description),
    issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
    priority: str((f.priority as Record<string, unknown> | null)?.name),
    labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
    components: Array.isArray(f.components)
      ? (f.components as Array<Record<string, unknown>>).map((c) => str(c.name))
      : [],
    status: str((f.status as Record<string, unknown> | null)?.name),
    story_points: typeof sp === "number" ? sp : null,
  };
}

// --- Single ticket ---

async function fetchTicket(config: Config, ticketKey: string): Promise<void> {
  console.log(`=== Fetching Ticket: ${ticketKey} ===`);

  const fields = [
    "summary",
    "description",
    "issuetype",
    "priority",
    "labels",
    "components",
    "status",
    config.jira.story_points_field,
  ].join(",");
  const url = `https://${config.jira.cloud_id}/rest/api/3/issue/${ticketKey}?fields=${fields}`;
  const data = await jiraGet(url);

  if (!data.key) {
    console.error(`Failed to fetch ticket ${ticketKey}`);
    process.exit(1);
  }

  const parsed = parseTargetTicket(data, config.jira.story_points_field);

  if (parsed.story_points !== null && parsed.story_points >= 2) {
    console.log(
      `Ticket ${ticketKey} already has ${parsed.story_points} story points.`,
    );
    writeFileSync(
      resolve(CACHE_DIR, "target-tickets.json"),
      JSON.stringify([], null, 2) + "\n",
    );
    return;
  }

  console.log(`  Fetching PR context for ${ticketKey}...`);
  const prContext = await fetchPrContext(config.jira.cloud_id, ticketKey);
  console.log(`  Found ${prContext.prs.length} linked PR(s).`);

  const target: TargetTicket = { ...parsed, pr_context: prContext };
  writeFileSync(
    resolve(CACHE_DIR, "target-tickets.json"),
    JSON.stringify([target], null, 2) + "\n",
  );
  console.log(`Saved 1 target ticket to cache.`);
}

// --- Backlog batch ---

async function fetchBacklog(config: Config): Promise<void> {
  console.log("=== Fetching Backlog Batch ===");

  const fields = [
    "summary",
    "description",
    "issuetype",
    "priority",
    "labels",
    "components",
    "status",
    "resolution",
    config.jira.story_points_field,
  ];

  const { issues } = await jiraSearch(
    config.jira.cloud_id,
    config.jira.backlog_jql,
    fields,
    10,
  );

  if (issues.length === 0) {
    console.log("No unpointed tickets in the backlog.");
    writeFileSync(
      resolve(CACHE_DIR, "target-tickets.json"),
      JSON.stringify([], null, 2) + "\n",
    );
    return;
  }

  console.log(`  Found ${issues.length} backlog ticket(s).`);

  const validResolutions = new Set(["Done", "Done-Errata", ""]);
  const targets: TargetTicket[] = [];

  for (const issue of issues) {
    const f = (issue.fields ?? {}) as Record<string, unknown>;
    const resolution = str(
      (f.resolution as Record<string, unknown> | null)?.name,
    );

    if (resolution && !validResolutions.has(resolution)) {
      console.log(`  Skipped ${str(issue.key)}: resolution is ${resolution}.`);
      continue;
    }

    const parsed = parseTargetTicket(issue, config.jira.story_points_field);
    console.log(`  Fetching PR context for ${parsed.key}...`);
    const prContext = await fetchPrContext(config.jira.cloud_id, parsed.key);
    console.log(`    Found ${prContext.prs.length} linked PR(s).`);
    targets.push({ ...parsed, pr_context: prContext });
  }

  writeFileSync(
    resolve(CACHE_DIR, "target-tickets.json"),
    JSON.stringify(targets, null, 2) + "\n",
  );
  console.log(`\nSaved ${targets.length} target ticket(s) to cache.`);
}

// --- Main ---

async function main(): Promise<void> {
  if (!JIRA_API_TOKEN || !JIRA_EMAIL) {
    console.error(
      "JIRA_API_TOKEN and JIRA_EMAIL environment variables are required.",
    );
    process.exit(1);
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Config;

  const args = process.argv.slice(2);

  if (args.includes("--sync-reference")) {
    await syncReference(config);
  } else if (args.includes("--backlog")) {
    await fetchBacklog(config);
  } else {
    const ticketIdx = args.indexOf("--ticket");
    if (ticketIdx !== -1 && args[ticketIdx + 1]) {
      await fetchTicket(config, args[ticketIdx + 1]);
    } else {
      console.error(
        "Usage: fetch-data.ts --sync-reference | --ticket KEY | --backlog",
      );
      process.exit(1);
    }
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-data.ts");
if (isDirectRun) void main();
