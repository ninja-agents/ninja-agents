#!/usr/bin/env npx tsx
/**
 * Fetch sprint planning data from Jira and sprint-review reports.
 * Populates CSV + velocity JSON for generate-sprint-planning-analysis.ts.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const AGENT_DIR = resolve(SCRIPT_DIR, "..");
const CACHE_DIR = resolve(AGENT_DIR, "data", "cache");
const SPRINT_REVIEW_OUTPUT_DIR = resolve(
  AGENT_DIR,
  "..",
  "sprint-review",
  "data",
  "output",
);
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

// --- Velocity from sprint-review reports ---

function findSprintReviewReport(sprintName: string): string | null {
  if (!existsSync(SPRINT_REVIEW_OUTPUT_DIR)) return null;

  const files = readdirSync(SPRINT_REVIEW_OUTPUT_DIR).filter(
    (f) => f.startsWith("sprint-review-") && f.endsWith(".md"),
  );

  for (const file of files.reverse()) {
    const path = resolve(SPRINT_REVIEW_OUTPUT_DIR, file);
    const content = readFileSync(path, "utf-8");
    if (content.includes(sprintName)) return path;
  }
  return null;
}

function parseReportVelocity(
  reportPath: string,
  sprintName: string,
  config: SprintConfig,
): VelocitySummary | null {
  const content = readFileSync(reportPath, "utf-8");
  const lines = content.split("\n");

  let totalIssues = 0;
  let completedIssues = 0;
  let totalSp = 0;
  let completedSp = 0;

  // Parse Sprint Summary table
  for (const line of lines) {
    const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (!match) continue;
    const [, key, value] = match;
    const cleanKey = key.trim();
    const numMatch = value.trim().match(/^([\d.]+)/);
    if (!numMatch) continue;
    const num = parseFloat(numMatch[1]);

    if (cleanKey === "Total Issues") totalIssues = num;
    else if (cleanKey === "Completed") completedIssues = num;
    else if (cleanKey === "Story Points Planned") totalSp = num;
    else if (cleanKey === "Story Points Completed") completedSp = num;
  }

  if (totalIssues === 0) return null;

  // Parse By Engineer table
  const byEngineer: EngineerVelocity[] = [];
  let inEngineerTable = false;
  for (const line of lines) {
    if (line.includes("| Engineer") && line.includes("| Assigned")) {
      inEngineerTable = true;
      continue;
    }
    if (inEngineerTable && line.match(/^\|[-\s|]+\|$/)) continue;
    if (inEngineerTable && line.startsWith("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cols.length >= 5) {
        const displayName = cols[0];
        const configEng = config.engineers.find(
          (e) =>
            e.name === displayName ||
            e.jira_display_names.includes(displayName),
        );
        byEngineer.push({
          name: configEng?.name ?? displayName,
          assigned: parseInt(cols[1], 10) || 0,
          completed: parseInt(cols[2], 10) || 0,
          sp_completed: parseFloat(cols[4]) || 0,
          sp_remaining: parseFloat(cols[5]) || 0,
        });
      }
    } else if (inEngineerTable) {
      inEngineerTable = false;
    }
  }

  // Parse carryover keys from Carryover Risk section
  const carryoverKeys: string[] = [];
  let inCarryover = false;
  for (const line of lines) {
    if (line.startsWith("## Carryover Risk")) {
      inCarryover = true;
      continue;
    }
    if (inCarryover && line.startsWith("## ")) break;
    if (inCarryover) {
      const keyMatch = line.match(/\[([A-Z]+-\d+)/);
      if (keyMatch) carryoverKeys.push(keyMatch[1]);
    }
  }

  // Parse retro recommendations from "What do we want to try next?" section
  const retroRecs: string[] = [];
  let inRetro = false;
  for (const line of lines) {
    if (line.includes("What do we want to try next?")) {
      inRetro = true;
      continue;
    }
    if (inRetro && line.startsWith("## ")) break;
    if (inRetro && line.startsWith("- ")) {
      retroRecs.push(line.slice(2).trim());
    }
  }

  return {
    sprint_name: sprintName,
    total_issues: totalIssues,
    completed_issues: completedIssues,
    total_sp: totalSp,
    completed_sp: completedSp,
    by_engineer: byEngineer,
    carryover_keys: carryoverKeys,
    retro_recommendations: retroRecs,
  };
}

// --- Velocity from Jira (fallback) ---

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
    "issuetype",
    "priority",
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

  for (const issue of issues) {
    const f = issue.fields ?? {};
    const sp = (f[config.jira.story_point_field] as number) || 0;
    const resolution = str(
      (f.resolution as Record<string, unknown> | null)?.name,
    );
    const isDone = resolution === "Done" || resolution === "Done-Errata";

    totalSp += sp;
    if (isDone) {
      completedCount++;
      completedSp += sp;
    }

    // Map to engineer by assignee or QA contact
    const assignee = f.assignee as Record<string, unknown> | null;
    const qaContact = f.customfield_10470 as Record<string, unknown> | null;
    const assigneeId = str(assignee?.accountId);
    const qaContactId = str(qaContact?.accountId);

    const matchEngIds = [assigneeId, qaContactId].filter(Boolean);
    for (const engId of matchEngIds) {
      const configEng = config.engineers.find(
        (e) => e.jira_account_id === engId,
      );
      if (!configEng) continue;
      const entry = engineerMap.get(configEng.name) ?? {
        assigned: 0,
        completed: 0,
        sp_completed: 0,
        sp_remaining: 0,
      };

      if (engId === assigneeId) {
        entry.assigned++;
        if (isDone) {
          entry.completed++;
          entry.sp_completed += sp;
        } else {
          entry.sp_remaining += sp;
        }
      }
      engineerMap.set(configEng.name, entry);
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

// --- Velocity history management ---

function loadVelocityHistory(): VelocityHistory {
  if (!existsSync(VELOCITY_HISTORY_PATH)) return { sprints: {} };
  try {
    return JSON.parse(
      readFileSync(VELOCITY_HISTORY_PATH, "utf-8"),
    ) as VelocityHistory;
  } catch {
    return { sprints: {} };
  }
}

function saveVelocityHistory(history: VelocityHistory): void {
  writeFileSync(VELOCITY_HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
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
    3,
  );
  console.log(
    `  Previous sprints to check: ${prevSprintNames.join(", ") || "none"}`,
  );

  // Steps 2-4: Velocity baselines
  console.log("\n=== Steps 2-4: Velocity Baselines ===");
  const history = loadVelocityHistory();

  for (const prevName of prevSprintNames) {
    if (history.sprints[prevName]) {
      console.log(`  ${prevName}: cached`);
      continue;
    }

    console.log(`  ${prevName}: not cached, fetching...`);

    // Option A: sprint-review report
    const reportPath = findSprintReviewReport(prevName);
    if (reportPath) {
      console.log(`    Found sprint-review report: ${reportPath}`);
      const velocity = parseReportVelocity(reportPath, prevName, config);
      if (velocity && velocity.total_issues > 0) {
        history.sprints[prevName] = velocity;
        console.log(
          `    Parsed: ${velocity.completed_issues}/${velocity.total_issues} issues, ${velocity.completed_sp}/${velocity.total_sp} SP`,
        );
        continue;
      }
      console.log("    Could not parse report, falling back to Jira...");
    }

    // Option B: Jira fallback
    const velocity = await fetchVelocityFromJira(config, prevName);
    history.sprints[prevName] = velocity;
    console.log(
      `    Fetched: ${velocity.completed_issues}/${velocity.total_issues} issues, ${velocity.completed_sp}/${velocity.total_sp} SP`,
    );
  }

  saveVelocityHistory(history);
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
