#!/usr/bin/env npx tsx
/**
 * Fetch sprint planning data from Jira REST API.
 * Populates CSV + velocity JSON for generate-sprint-planning-analysis.ts.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const AGENT_DIR = resolve(SCRIPT_DIR, "..");
const CACHE_DIR = resolve(AGENT_DIR, "data", "cache");
const CONFIG_PATH = resolve(
  AGENT_DIR,
  "..",
  "sprint-review",
  "data",
  "sprint-config.json",
);
const VELOCITY_HISTORY_PATH = resolve(CACHE_DIR, "velocity-history.json");

// --- Types ---

interface Engineer {
  name: string;
  jira_account_id: string;
  jira_display_names: string[];
  role: string;
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

interface EngineerVelocity {
  name: string;
  assigned: number;
  completed: number;
  sp_completed: number;
  sp_remaining: number;
}

interface VelocitySummary {
  sprint_name: string;
  total_issues: number;
  completed_issues: number;
  total_sp: number;
  completed_sp: number;
  by_engineer: EngineerVelocity[];
  carryover_keys: string[];
  retro_recommendations: string[];
}

interface VelocityHistory {
  sprints: Record<string, VelocitySummary>;
}

interface JiraSearchResult {
  issues?: Array<{
    key: string;
    fields?: Record<string, unknown>;
  }>;
  nextPageToken?: string;
}

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

// --- Auth ---

const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";

// --- Jira HTTP ---

function jiraAuth(config: SprintConfig): string {
  const email =
    JIRA_EMAIL ||
    (config as unknown as Record<string, Record<string, string>>).jira
      ?.user_email ||
    "";
  return Buffer.from(`${email}:${JIRA_API_TOKEN}`).toString("base64");
}

async function jiraSearch(
  config: SprintConfig,
  jql: string,
  fields: string[],
  maxResults = 100,
  nextPageToken?: string,
): Promise<JiraSearchResult> {
  const auth = jiraAuth(config);
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

async function jiraSearchPaginated(
  config: SprintConfig,
  jql: string,
  fields: string[],
): Promise<JiraSearchResult["issues"]> {
  const allIssues: JiraSearchResult["issues"] = [];
  let nextPageToken: string | undefined;

  for (;;) {
    const result = await jiraSearch(config, jql, fields, 100, nextPageToken);
    const issues = result.issues ?? [];
    allIssues.push(...issues);

    if (issues.length < 100 || !result.nextPageToken) break;
    nextPageToken = result.nextPageToken;
  }

  return allIssues;
}

async function fetchDoneTransitionDate(
  config: SprintConfig,
  issueKey: string,
): Promise<string> {
  const auth = jiraAuth(config);
  const url = `https://${config.jira.cloud_id}/rest/api/3/issue/${issueKey}?expand=changelog&fields=summary`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      changelog?: {
        histories?: Array<{
          created?: string;
          items?: Array<{
            field?: string;
            toString?: string;
          }>;
        }>;
      };
    };
    const doneStatuses = new Set(
      config.statuses.done.map((s) => s.toLowerCase()),
    );
    const histories = data.changelog?.histories ?? [];
    for (let i = histories.length - 1; i >= 0; i--) {
      const h = histories[i];
      for (const item of h.items ?? []) {
        if (
          item.field === "status" &&
          item.toString &&
          doneStatuses.has(item.toString.toLowerCase())
        ) {
          return (h.created ?? "").slice(0, 10);
        }
      }
    }
  } catch {
    // fall through
  }
  return "";
}

// --- Sprint discovery ---

async function discoverSprint(
  config: SprintConfig,
  sprintFunction: string,
): Promise<SprintObject | null> {
  for (const eng of config.engineers) {
    const jql = `sprint in ${sprintFunction}() AND assignee = "${eng.jira_account_id}" ORDER BY updated DESC`;
    const result = await jiraSearch(
      config,
      jql,
      ["summary", config.jira.sprint_field],
      1,
    );
    const issues = result.issues ?? [];
    if (issues.length === 0) continue;

    const sprintField = issues[0].fields?.[config.jira.sprint_field];
    if (!Array.isArray(sprintField)) continue;

    const sprints = sprintField as SprintObject[];
    const stateTarget =
      sprintFunction === "futureSprints" ? "future" : "active";

    const match = sprints.find(
      (s) =>
        s.state === stateTarget &&
        s.name?.startsWith(config.sprint_name_prefix),
    );
    if (match) return match;
  }
  return null;
}

function parseSprintNumber(sprintName: string, prefix: string): number | null {
  const suffix = sprintName.slice(prefix.length).trim();
  const num = parseInt(suffix, 10);
  return isNaN(num) ? null : num;
}

function previousSprintNames(
  prefix: string,
  currentNumber: number,
  count: number,
): string[] {
  const names: string[] = [];
  for (let i = 1; i <= count; i++) {
    const n = currentNumber - i;
    if (n >= 1) names.push(`${prefix} ${n}`);
  }
  return names;
}

// --- Velocity from Jira ---

async function fetchVelocityFromJira(
  config: SprintConfig,
  sprintName: string,
): Promise<VelocitySummary> {
  console.log(`    Fetching from Jira...`);
  const jql = `sprint = "${sprintName}" ORDER BY status ASC, priority DESC`;
  const fields = [
    "summary",
    "status",
    "assignee",
    "resolution",
    "resolutiondate",
    "updated",
    "issuetype",
    "priority",
    config.jira.sprint_field,
    config.jira.story_point_field,
    "customfield_10470",
  ];

  const issues = await jiraSearchPaginated(config, jql, fields);
  if (!issues || issues.length === 0) {
    console.log(`    No issues found for sprint "${sprintName}"`);
    return {
      sprint_name: sprintName,
      total_issues: 0,
      completed_issues: 0,
      total_sp: 0,
      completed_sp: 0,
      by_engineer: [],
      carryover_keys: [],
      retro_recommendations: [],
    };
  }

  // Extract sprint end date from issue data to scope completions
  let sprintEndDate = "";
  for (const issue of issues) {
    const sprintField = issue.fields?.[config.jira.sprint_field];
    if (!Array.isArray(sprintField)) continue;
    const match = (sprintField as SprintObject[]).find(
      (s) => s.name === sprintName,
    );
    if (match?.endDate) {
      sprintEndDate = match.endDate.slice(0, 10);
      break;
    }
  }
  if (sprintEndDate) {
    console.log(`    Sprint end date: ${sprintEndDate}`);
  }

  let totalSp = 0;
  let completedSp = 0;
  let completedCount = 0;

  const engineerMap = new Map<
    string,
    {
      assigned: number;
      completed: number;
      sp_completed: number;
      sp_remaining: number;
    }
  >();

  const qeAccountIds = new Set(
    config.engineers
      .filter((e) => e.role === "qe")
      .map((e) => e.jira_account_id),
  );

  // Pre-fetch changelog transition dates for done issues missing resolutiondate
  const transitionDates = new Map<string, string>();
  if (sprintEndDate) {
    const needChangelog = issues.filter((issue) => {
      const f = issue.fields ?? {};
      const resolution = str(
        (f.resolution as Record<string, unknown> | null)?.name,
      );
      const statusName = str(
        (f.status as Record<string, unknown> | null)?.name,
      );
      const doneByStatus =
        resolution === "Done" || config.statuses.done.includes(statusName);
      return doneByStatus && !str(f.resolutiondate);
    });
    if (needChangelog.length > 0) {
      console.log(
        `    Fetching changelogs for ${needChangelog.length} issues without resolutiondate...`,
      );
      for (const issue of needChangelog) {
        const date = await fetchDoneTransitionDate(config, issue.key);
        if (date) transitionDates.set(issue.key, date);
      }
    }
  }

  for (const issue of issues) {
    const f = issue.fields ?? {};
    const sp = (f[config.jira.story_point_field] as number) || 0;
    const resolution = str(
      (f.resolution as Record<string, unknown> | null)?.name,
    );
    const statusName = str((f.status as Record<string, unknown> | null)?.name);
    const doneByStatus =
      resolution === "Done" || config.statuses.done.includes(statusName);

    let isDone = doneByStatus;
    if (isDone && sprintEndDate) {
      const resDate = str(f.resolutiondate).slice(0, 10);
      const doneDate = resDate || transitionDates.get(issue.key) || "";
      if (doneDate && doneDate > sprintEndDate) {
        isDone = false;
      }
    }

    totalSp += sp;
    if (isDone) {
      completedCount++;
      completedSp += sp;
    }

    const accumulate = (engName: string) => {
      const entry = engineerMap.get(engName) ?? {
        assigned: 0,
        completed: 0,
        sp_completed: 0,
        sp_remaining: 0,
      };
      entry.assigned++;
      if (isDone) {
        entry.completed++;
        entry.sp_completed += sp;
      } else {
        entry.sp_remaining += sp;
      }
      engineerMap.set(engName, entry);
    };

    // Map to engineer by assignee or QA contact
    const assignee = f.assignee as Record<string, unknown> | null;
    const qaContact = f.customfield_10470 as Record<string, unknown> | null;
    const assigneeId = str(assignee?.accountId);
    const qaContactId = str(qaContact?.accountId);

    // Credit assignee
    const assigneeEng = config.engineers.find(
      (e) => e.jira_account_id === assigneeId,
    );
    if (assigneeEng) accumulate(assigneeEng.name);

    // Credit QA contact if they are a QE and not already the assignee
    if (
      qaContactId &&
      qaContactId !== assigneeId &&
      qeAccountIds.has(qaContactId)
    ) {
      const qaEng = config.engineers.find(
        (e) => e.jira_account_id === qaContactId,
      );
      if (qaEng) accumulate(qaEng.name);
    }
  }

  return {
    sprint_name: sprintName,
    total_issues: issues.length,
    completed_issues: completedCount,
    total_sp: totalSp,
    completed_sp: completedSp,
    by_engineer: Array.from(engineerMap.entries()).map(([name, data]) => ({
      name,
      ...data,
    })),
    carryover_keys: [],
    retro_recommendations: [],
  };
}

// --- CSV writing ---

function writeSprintIssuesCsv(
  issues: JiraSearchResult["issues"],
  sprintName: string,
  sprintStart: string,
  sprintEnd: string,
  config: SprintConfig,
): void {
  const header =
    "key,summary,status,resolution,resolutiondate,issuetype,priority,assignee_id,assignee_name,story_points,created,updated,sprint_name,sprint_start,sprint_end,labels,qa_contact_id,qa_contact_name";

  const rows = (issues ?? []).map((issue) => {
    const f = issue.fields ?? {};
    const assignee = (f.assignee ?? {}) as Record<string, unknown>;
    const qaContact = (f.customfield_10470 ?? {}) as Record<string, unknown>;
    const labels = Array.isArray(f.labels)
      ? (f.labels as string[]).join(";")
      : "";
    const sp = f[config.jira.story_point_field];

    return [
      issue.key,
      csvEscape(str(f.summary)),
      str((f.status as Record<string, unknown> | null)?.name),
      str((f.resolution as Record<string, unknown> | null)?.name),
      str(f.resolutiondate),
      str((f.issuetype as Record<string, unknown> | null)?.name),
      str((f.priority as Record<string, unknown> | null)?.name),
      str(assignee.accountId),
      csvEscape(str(assignee.displayName)),
      sp != null ? str(sp) : "",
      str(f.created),
      str(f.updated),
      sprintName,
      sprintStart,
      sprintEnd,
      labels,
      str(qaContact.accountId),
      csvEscape(str(qaContact.displayName)),
    ].join(",");
  });

  writeFileSync(
    resolve(CACHE_DIR, "sprint-issues.csv"),
    [header, ...rows].join("\n") + "\n",
  );
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

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as SprintConfig;

  // Parse CLI args
  const args = process.argv.slice(2);
  let targetSprintName = "";
  let targetSprintStart = "";
  let targetSprintEnd = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sprint" && i + 1 < args.length) {
      targetSprintName = args[++i];
    }
  }

  // Step 1: Determine target sprint
  console.log("=== Step 1: Determine Target Sprint ===");

  if (targetSprintName) {
    console.log(`  Using provided sprint: ${targetSprintName}`);
  } else {
    console.log("  Discovering future sprint...");
    let sprint = await discoverSprint(config, "futureSprints");
    if (!sprint) {
      console.log("  No future sprint found, trying active sprint...");
      sprint = await discoverSprint(config, "openSprints");
    }
    if (!sprint || !sprint.name) {
      console.error(
        `No future or active sprint found for board ${config.board_id}.`,
      );
      process.exit(1);
    }
    targetSprintName = sprint.name;
    targetSprintStart = sprint.startDate ?? "";
    targetSprintEnd = sprint.endDate ?? "";
  }

  console.log(`  Target sprint: ${targetSprintName}`);

  const sprintNumber = parseSprintNumber(
    targetSprintName,
    config.sprint_name_prefix,
  );
  if (sprintNumber === null) {
    console.error(
      `Cannot parse sprint number from "${targetSprintName}" with prefix "${config.sprint_name_prefix}"`,
    );
    process.exit(1);
  }

  const prevSprintNames = previousSprintNames(
    config.sprint_name_prefix,
    sprintNumber,
    4,
  );
  console.log(
    `  Previous sprints to check: ${prevSprintNames.join(", ") || "none"}`,
  );

  // Steps 2-4: Velocity baselines (always fresh from Jira)
  console.log("\n=== Steps 2-4: Velocity Baselines ===");
  const history: VelocityHistory = { sprints: {} };

  for (const prevName of prevSprintNames) {
    console.log(`  ${prevName}: fetching from Jira...`);
    const velocity = await fetchVelocityFromJira(config, prevName);
    history.sprints[prevName] = velocity;
    console.log(
      `    Fetched: ${velocity.completed_issues}/${velocity.total_issues} issues, ${velocity.completed_sp}/${velocity.total_sp} SP`,
    );
  }

  writeFileSync(VELOCITY_HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  console.log("  Velocity history saved.");

  // Write velocity-summary.json (N-1 sprint data)
  const n1SprintName = prevSprintNames[0];
  const velocitySummary: VelocitySummary =
    n1SprintName && history.sprints[n1SprintName]
      ? history.sprints[n1SprintName]
      : {
          sprint_name: n1SprintName ?? "",
          total_issues: 0,
          completed_issues: 0,
          total_sp: 0,
          completed_sp: 0,
          by_engineer: [],
          carryover_keys: [],
          retro_recommendations: [],
        };

  writeFileSync(
    resolve(CACHE_DIR, "velocity-summary.json"),
    JSON.stringify(velocitySummary, null, 2) + "\n",
  );

  // Step 5: Fetch target sprint issues
  console.log("\n=== Step 5: Fetch Target Sprint Issues ===");
  const jql = `sprint = "${targetSprintName}" ORDER BY priority ASC, issuetype ASC`;
  const fields = [
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

  const issues = await jiraSearchPaginated(config, jql, fields);
  console.log(`  Fetched ${issues?.length ?? 0} issues`);

  if (!issues || issues.length === 0) {
    console.error(`Sprint "${targetSprintName}" returned no issues.`);
    process.exit(1);
  }

  // If sprint start/end weren't set (explicit --sprint), extract from first issue
  if (!targetSprintStart && issues[0]?.fields) {
    const sprintField = issues[0].fields[config.jira.sprint_field];
    if (Array.isArray(sprintField)) {
      const sprintObj = (sprintField as SprintObject[]).find(
        (s) => s.name === targetSprintName,
      );
      if (sprintObj) {
        targetSprintStart = sprintObj.startDate ?? "";
        targetSprintEnd = sprintObj.endDate ?? "";
      }
    }
  }

  // Step 6: Save CSV
  console.log("\n=== Step 6: Save Outputs ===");
  writeSprintIssuesCsv(
    issues,
    targetSprintName,
    targetSprintStart,
    targetSprintEnd,
    config,
  );
  console.log(`  sprint-issues.csv: ${issues.length} rows`);
  console.log(`  velocity-summary.json: ${velocitySummary.sprint_name}`);
  console.log(
    `  velocity-history.json: ${Object.keys(history.sprints).length} sprints cached`,
  );

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Target Sprint: ${targetSprintName}`);
  console.log(`Sprint Issues: ${issues.length}`);
  console.log(
    `Velocity Baseline (N-1): ${velocitySummary.completed_sp}/${velocitySummary.total_sp} SP`,
  );
  console.log(`Cache saved to: ${CACHE_DIR}`);
}

const isDirectRun = process.argv[1]?.endsWith("fetch-data.ts");
if (isDirectRun) void main();
