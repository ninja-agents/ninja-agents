#!/usr/bin/env npx tsx
/**
 * Fetch sprint review data from Jira REST API.
 * Discovers the active sprint, fetches all issues and changelogs for cycle time.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const DATA_DIR = resolve(SCRIPT_DIR, "..", "data");
const CACHE_DIR = resolve(DATA_DIR, "cache");
const CONFIG_PATH = resolve(DATA_DIR, "sprint-config.json");

// --- Types ---

interface Engineer {
  name: string;
  jira_account_id: string;
}

interface SprintConfig {
  board_id: number;
  sprint_name_prefix: string;
  jira: {
    cloud_id: string;
    sprint_field: string;
    story_point_field: string;
  };
  statuses: {
    in_progress: string[];
    done: string[];
  };
  engineers: Engineer[];
}

interface SprintObject {
  name?: string;
  state?: string;
  boardId?: number;
  startDate?: string;
  endDate?: string;
}

interface JiraIssue {
  key: string;
  fields?: Record<string, unknown>;
}

interface JiraSearchResult {
  issues?: JiraIssue[];
  total?: number;
  nextPageToken?: string;
}

interface ChangelogItem {
  field?: string;
  toString?: string;
}

interface ChangelogHistory {
  created?: string;
  items?: ChangelogItem[];
}

interface ChangelogResult {
  changelog?: {
    histories?: ChangelogHistory[];
  };
}

// --- Load config ---

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as SprintConfig;

// --- Auth ---

const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";

// --- Helpers ---

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

function getAuth(): string {
  return Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

async function jiraSearch(
  jql: string,
  fields: string[],
  maxResults = 100,
  nextPageToken?: string,
): Promise<JiraSearchResult> {
  const base = `https://${config.jira.cloud_id}/rest/api/3/search/jql`;
  const params = new URLSearchParams({
    jql,
    maxResults: String(maxResults),
    fields: fields.join(","),
  });
  if (nextPageToken) params.set("nextPageToken", nextPageToken);
  const url = `${base}?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${getAuth()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`  Jira search error ${res.status}: ${body}`);
      return { issues: [] };
    }
    return (await res.json()) as JiraSearchResult;
  } catch (e) {
    console.error(`  Jira search error: ${String(e)}`);
    return { issues: [] };
  }
}

async function jiraGetIssue(
  key: string,
  expand: string,
  fields: string[],
): Promise<Record<string, unknown>> {
  const base = `https://${config.jira.cloud_id}/rest/api/3/issue/${key}`;
  const params = new URLSearchParams({
    expand,
    fields: fields.join(","),
  });
  const url = `${base}?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${getAuth()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`  Jira issue error ${res.status} for ${key}: ${body}`);
      return {};
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error(`  Jira issue error for ${key}: ${String(e)}`);
    return {};
  }
}

async function fetchAllIssues(
  jql: string,
  fields: string[],
): Promise<JiraIssue[]> {
  const allIssues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const result = await jiraSearch(jql, fields, 100, nextPageToken);
    const issues = result.issues ?? [];
    allIssues.push(...issues);
    if (issues.length < 100 || !result.nextPageToken) break;
    nextPageToken = result.nextPageToken;
  }
  return allIssues;
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

  // Clear old cache
  for (const f of [
    "sprint-issues.csv",
    "sprint-transitions.csv",
    "sprint-changelog.csv",
    "last-updated.txt",
  ]) {
    try {
      rmSync(resolve(CACHE_DIR, f), { force: true });
    } catch {
      // ignore
    }
  }

  // --- Step 1: Discover Active Sprint ---

  console.log("=== Discovering Active Sprint ===");

  let sprintName = "";
  let sprintStart = "";
  let sprintEnd = "";

  const sprintFields = ["summary", config.jira.sprint_field];

  for (const eng of config.engineers) {
    console.log(
      `  Trying ${eng.name} (${eng.jira_account_id.slice(0, 20)}...)...`,
    );
    const jql = `sprint in openSprints() AND assignee = "${eng.jira_account_id}" ORDER BY updated DESC`;
    const result = await jiraSearch(jql, sprintFields);
    const issues = result.issues ?? [];

    for (const issue of issues) {
      const sprintField = issue.fields?.[config.jira.sprint_field];
      if (!Array.isArray(sprintField)) continue;
      const sprints = sprintField as SprintObject[];
      for (const s of sprints) {
        if (
          s.state === "active" &&
          s.boardId === config.board_id &&
          s.name?.startsWith(config.sprint_name_prefix)
        ) {
          sprintName = s.name;
          sprintStart = s.startDate ?? "";
          sprintEnd = s.endDate ?? "";
          break;
        }
      }
      if (sprintName) break;
    }
    if (sprintName) break;
  }

  if (!sprintName) {
    console.error(
      `No active sprint found for board ${config.board_id}. Verify the board ID in sprint-config.json.`,
    );
    process.exit(1);
  }

  console.log(`  Active sprint: ${sprintName}`);
  console.log(`  Start: ${sprintStart}`);
  console.log(`  End: ${sprintEnd}`);

  // --- Step 2: Fetch All Sprint Issues ---

  console.log("\n=== Fetching Sprint Issues ===");

  const issueFields = [
    "summary",
    "status",
    "assignee",
    "resolution",
    "resolutiondate",
    "issuetype",
    "priority",
    "created",
    "updated",
    config.jira.story_point_field,
    config.jira.sprint_field,
    "labels",
    "customfield_10470",
  ];

  const jql = `sprint = "${sprintName}" ORDER BY status ASC, priority DESC`;
  const allIssues = await fetchAllIssues(jql, issueFields);
  console.log(`  Found ${allIssues.length} issues`);

  if (allIssues.length === 0) {
    console.error(`Sprint '${sprintName}' returned no issues.`);
    process.exit(1);
  }

  // --- Step 3: Fetch Changelogs for Completed Issues ---

  console.log("\n=== Fetching Transition Timestamps ===");

  const doneStatuses = new Set(
    config.statuses.done.map((s) => s.toLowerCase()),
  );
  const inProgressStatuses = new Set(
    config.statuses.in_progress.map((s) => s.toLowerCase()),
  );

  const completedKeys: string[] = [];
  for (const issue of allIssues) {
    const f = issue.fields ?? {};
    const resolution = str(
      (f.resolution as Record<string, unknown> | null)?.name,
    );
    const status = str((f.status as Record<string, unknown> | null)?.name);
    if (
      resolution.toLowerCase() === "done" ||
      doneStatuses.has(status.toLowerCase())
    ) {
      completedKeys.push(issue.key);
    }
  }

  console.log(`  ${completedKeys.length} completed issues to fetch changelogs`);

  const transitions: Array<{ key: string; first_in_progress_date: string }> =
    [];

  for (const key of completedKeys) {
    const data = (await jiraGetIssue(key, "changelog", [
      "summary",
    ])) as ChangelogResult;
    const histories = data.changelog?.histories ?? [];

    let earliestDate = "";
    for (const history of histories) {
      const items = history.items ?? [];
      for (const item of items) {
        if (
          item.field === "status" &&
          item.toString &&
          inProgressStatuses.has(item.toString.toLowerCase())
        ) {
          const created = history.created ?? "";
          if (!earliestDate || created < earliestDate) {
            earliestDate = created;
          }
        }
      }
    }

    if (earliestDate) {
      transitions.push({ key, first_in_progress_date: earliestDate });
    }
  }

  console.log(
    `  Found ${transitions.length} issues with in-progress transitions`,
  );

  // --- Step 4: Save CSVs ---

  console.log("\n=== Saving CSV Files ===");

  // sprint-issues.csv
  const issueLines = [
    "key,summary,status,resolution,resolutiondate,issuetype,priority,assignee_id,assignee_name,story_points,created,updated,sprint_name,sprint_start,sprint_end,labels,qa_contact_id,qa_contact_name",
  ];
  for (const issue of allIssues) {
    const f = issue.fields ?? {};
    const assignee = (f.assignee ?? {}) as Record<string, unknown>;
    const qaContact = (f.customfield_10470 ?? {}) as Record<string, unknown>;
    const sp = f[config.jira.story_point_field];
    const labels = Array.isArray(f.labels)
      ? (f.labels as string[]).join(";")
      : "";

    issueLines.push(
      `${issue.key},${csvEscape(str(f.summary))},${str((f.status as Record<string, unknown> | null)?.name)},` +
        `${str((f.resolution as Record<string, unknown> | null)?.name)},${str(f.resolutiondate)},` +
        `${str((f.issuetype as Record<string, unknown> | null)?.name)},` +
        `${str((f.priority as Record<string, unknown> | null)?.name)},` +
        `${str(assignee?.accountId)},${csvEscape(str(assignee?.displayName))},` +
        `${sp != null ? str(sp) : ""},` +
        `${str(f.created)},${str(f.updated)},` +
        `${csvEscape(sprintName)},${sprintStart},${sprintEnd},` +
        `${csvEscape(labels)},` +
        `${str(qaContact?.accountId)},${csvEscape(str(qaContact?.displayName))}`,
    );
  }
  writeFileSync(
    resolve(CACHE_DIR, "sprint-issues.csv"),
    issueLines.join("\n") + "\n",
  );
  console.log(`  sprint-issues.csv: ${allIssues.length} issues`);

  // sprint-transitions.csv
  const transitionLines = ["key,first_in_progress_date"];
  for (const t of transitions) {
    transitionLines.push(`${t.key},${t.first_in_progress_date}`);
  }
  writeFileSync(
    resolve(CACHE_DIR, "sprint-transitions.csv"),
    transitionLines.join("\n") + "\n",
  );
  console.log(`  sprint-transitions.csv: ${transitions.length} transitions`);

  // sprint-changelog.csv — header only
  writeFileSync(
    resolve(CACHE_DIR, "sprint-changelog.csv"),
    "key,summary,status,resolution,issuetype,assignee_name,story_points,created,updated,sprint_names\n",
  );
  console.log("  sprint-changelog.csv: header only");

  // last-updated.txt
  writeFileSync(
    resolve(CACHE_DIR, "last-updated.txt"),
    new Date().toISOString() + "\n",
  );

  // --- Summary ---

  console.log("\n=== Summary ===");
  console.log(`Sprint: ${sprintName}`);
  console.log(`Issues: ${allIssues.length}`);
  console.log(`Completed: ${completedKeys.length}`);
  console.log(`Transitions: ${transitions.length}`);
  console.log(`Cache saved to: ${CACHE_DIR}`);
}

const isDirectRun = process.argv[1]?.endsWith("fetch-data.ts");
if (isDirectRun) void main();
