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
const CONFIG_PATH = resolve(AGENT_DIR, "data", "sprint-config.json");
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
  id?: number;
  name?: string;
  state?: string;
  boardId?: number;
  startDate?: string;
  endDate?: string;
}

interface SprintTimeSnapshot {
  assigneeId: string;
  qaContactId: string;
  storyPoints: number;
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

async function fetchSprintTimeSnapshot(
  config: SprintConfig,
  issueKey: string,
  sprintEndDate: string,
  currentFields: Record<string, unknown>,
): Promise<SprintTimeSnapshot> {
  const currentAssignee = currentFields.assignee as Record<
    string,
    unknown
  > | null;
  const currentQa = currentFields.customfield_10470 as Record<
    string,
    unknown
  > | null;
  let assigneeId = str(currentAssignee?.accountId);
  let qaContactId = str(currentQa?.accountId);
  let storyPoints =
    (currentFields[config.jira.story_point_field] as number) || 0;

  const auth = jiraAuth(config);
  const url = `https://${config.jira.cloud_id}/rest/api/3/issue/${issueKey}?expand=changelog&fields=summary`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) return { assigneeId, qaContactId, storyPoints };

    const data = (await res.json()) as {
      changelog?: {
        histories?: Array<{
          created?: string;
          items?: Array<{
            field?: string;
            from?: string;
            fromString?: string;
            to?: string;
            toString?: string;
          }>;
        }>;
      };
    };
    const histories = data.changelog?.histories ?? [];

    // Walk backwards from most recent, undoing changes that happened after sprint end
    for (let i = histories.length - 1; i >= 0; i--) {
      const h = histories[i];
      const changeDate = (h.created ?? "").slice(0, 10);
      if (changeDate <= sprintEndDate) break;

      for (const item of h.items ?? []) {
        if (item.field === "assignee") {
          assigneeId = item.from ?? "";
        }
        if (item.field === "Story Points" || item.field === "story_points") {
          const prev = parseFloat(item.fromString ?? "0");
          storyPoints = isNaN(prev) ? 0 : prev;
        }
        if (item.field === "QA Contact") {
          qaContactId = item.from ?? "";
        }
      }
    }
  } catch {
    // fall through — use current values
  }

  return { assigneeId, qaContactId, storyPoints };
}

// --- Sprint report API (Greenhopper) ---

interface SprintReportIssue {
  key: string;
  assigneeAccountId?: string;
  assigneeName?: string;
  currentEstimateStatistic?: {
    statFieldValue?: { value?: number };
  };
  status?: { name?: string };
}

async function lookupSprintId(
  config: SprintConfig,
  sprintName: string,
): Promise<number | null> {
  const auth = jiraAuth(config);
  let startAt = 0;
  for (;;) {
    const url = `https://${config.jira.cloud_id}/rest/agile/1.0/board/${config.board_id}/sprint?state=closed,active&maxResults=50&startAt=${startAt}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        values?: Array<{ id: number; name: string }>;
        isLast?: boolean;
      };
      const values = data.values ?? [];
      const match = values.find((s) => s.name === sprintName);
      if (match) return match.id;
      if (data.isLast || values.length === 0) return null;
      startAt += values.length;
    } catch {
      return null;
    }
  }
}

async function fetchVelocityFromSprintReport(
  config: SprintConfig,
  sprintName: string,
): Promise<VelocitySummary | null> {
  const sprintId = await lookupSprintId(config, sprintName);
  if (!sprintId) {
    console.log(`    Sprint ID not found for "${sprintName}"`);
    return null;
  }
  console.log(`    Sprint ID: ${sprintId}`);

  const auth = jiraAuth(config);
  const url = `https://${config.jira.cloud_id}/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${config.board_id}&sprintId=${sprintId}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`    Sprint report API returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      contents?: {
        completedIssues?: SprintReportIssue[];
        issuesNotCompletedInCurrentSprint?: SprintReportIssue[];
      };
    };

    const completed = data.contents?.completedIssues ?? [];
    const incomplete = data.contents?.issuesNotCompletedInCurrentSprint ?? [];
    const allIssues = [...completed, ...incomplete];

    // Batch-filter out non-deliverable resolutions (Won't Fix, Duplicate, Obsolete, etc.)
    const completedKeys = completed.map((i) => i.key);
    const excludeKeys = new Set<string>();
    if (completedKeys.length > 0) {
      const validResolutions = ["Done", "Done-Errata"];
      const resJql = `key in (${completedKeys.join(",")}) AND resolution NOT IN (${validResolutions.map((r) => `"${r}"`).join(",")}) AND status != Verified`;
      const excludeIssues = await jiraSearchPaginated(config, resJql, [
        "resolution",
        "status",
      ]);
      for (const issue of excludeIssues) {
        excludeKeys.add(issue.key);
      }
      if (excludeKeys.size > 0) {
        console.log(
          `    Excluding ${excludeKeys.size} non-deliverable completions`,
        );
      }
    }

    // Fetch QA contacts for all issues in one batch
    const qaContactMap = new Map<string, string>();
    if (allIssues.length > 0) {
      const allKeys = allIssues.map((i) => i.key);
      const qaJql = `key in (${allKeys.join(",")})`;
      const qaIssues = await jiraSearchPaginated(config, qaJql, [
        "customfield_10470",
      ]);
      for (const issue of qaIssues) {
        const qa = issue.fields?.customfield_10470 as Record<
          string,
          unknown
        > | null;
        const qaId = str(qa?.accountId);
        if (qaId) qaContactMap.set(issue.key, qaId);
      }
    }

    const qeAccountIds = new Set(
      config.engineers
        .filter((e) => e.role === "qe")
        .map((e) => e.jira_account_id),
    );

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

    const processIssue = (issue: SprintReportIssue, isDone: boolean) => {
      const sp = issue.currentEstimateStatistic?.statFieldValue?.value ?? 0;
      const assigneeId = issue.assigneeAccountId ?? "";
      const qaContactId = qaContactMap.get(issue.key) ?? "";

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

      const assigneeEng = config.engineers.find(
        (e) => e.jira_account_id === assigneeId,
      );
      if (assigneeEng) accumulate(assigneeEng.name);

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
    };

    for (const issue of completed) {
      if (excludeKeys.has(issue.key)) continue;
      processIssue(issue, true);
    }
    for (const issue of incomplete) {
      processIssue(issue, false);
    }

    return {
      sprint_name: sprintName,
      total_issues: allIssues.length - excludeKeys.size,
      completed_issues: completedCount,
      total_sp: totalSp,
      completed_sp: completedSp,
      by_engineer: Array.from(engineerMap.entries()).map(([name, d]) => ({
        name,
        ...d,
      })),
      carryover_keys: [],
      retro_recommendations: [],
    };
  } catch (e) {
    console.log(`    Sprint report error: ${String(e)}`);
    return null;
  }
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

// --- Velocity history persistence ---

function loadExistingHistory(): VelocityHistory {
  try {
    const raw = readFileSync(VELOCITY_HISTORY_PATH, "utf-8");
    const data = JSON.parse(raw) as VelocityHistory;
    if (data.sprints && typeof data.sprints === "object") return data;
  } catch {
    // File doesn't exist or invalid — start fresh
  }
  return { sprints: {} };
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
    const validResolutions = ["Done", "Done-Errata"];
    const needChangelog = issues.filter((issue) => {
      const f = issue.fields ?? {};
      const resolution = str(
        (f.resolution as Record<string, unknown> | null)?.name,
      );
      const statusName = str(
        (f.status as Record<string, unknown> | null)?.name,
      );
      const isDoneByResolution = validResolutions.includes(resolution);
      const isDoneByStatus = statusName === "Verified" && !resolution;
      return (isDoneByResolution || isDoneByStatus) && !str(f.resolutiondate);
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

  // Fetch sprint-time snapshots for issues updated after sprint end
  const snapshots = new Map<string, SprintTimeSnapshot>();
  if (sprintEndDate) {
    const staleIssues = issues.filter((issue) => {
      const updated = str(issue.fields?.updated).slice(0, 10);
      return updated > sprintEndDate;
    });
    if (staleIssues.length > 0) {
      console.log(
        `    ${staleIssues.length}/${issues.length} issues updated after sprint end — fetching changelogs...`,
      );
      for (const issue of staleIssues) {
        const snapshot = await fetchSprintTimeSnapshot(
          config,
          issue.key,
          sprintEndDate,
          issue.fields ?? {},
        );
        snapshots.set(issue.key, snapshot);
      }
    }
  }

  for (const issue of issues) {
    const f = issue.fields ?? {};
    const snapshot = snapshots.get(issue.key);
    const sp =
      snapshot?.storyPoints ??
      ((f[config.jira.story_point_field] as number) || 0);
    const resolution = str(
      (f.resolution as Record<string, unknown> | null)?.name,
    );
    const statusName = str((f.status as Record<string, unknown> | null)?.name);

    const validResolutions = ["Done", "Done-Errata"];
    const isDoneByResolution = validResolutions.includes(resolution);
    const isDoneByStatus = statusName === "Verified" && !resolution;
    const doneByStatus = isDoneByResolution || isDoneByStatus;

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

    // Use sprint-time snapshot values when available, current values otherwise
    const assignee = f.assignee as Record<string, unknown> | null;
    const qaContact = f.customfield_10470 as Record<string, unknown> | null;
    const assigneeId = snapshot?.assigneeId ?? str(assignee?.accountId);
    const qaContactId = snapshot?.qaContactId ?? str(qaContact?.accountId);

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

  // Steps 2-4: Velocity baselines (append-only — only fetch missing sprints)
  console.log("\n=== Steps 2-4: Velocity Baselines ===");
  const forceRefresh = process.argv.includes("--fresh");
  const history: VelocityHistory = forceRefresh
    ? { sprints: {} }
    : loadExistingHistory();

  if (forceRefresh) {
    console.log("  --fresh flag: re-fetching all sprints from Jira");
  }

  for (const prevName of prevSprintNames) {
    if (history.sprints[prevName] && !forceRefresh) {
      console.log(
        `  ${prevName}: using cached data (${history.sprints[prevName].completed_sp} SP completed)`,
      );
      continue;
    }
    console.log(`  ${prevName}: fetching via Sprint Report API...`);
    let velocity = await fetchVelocityFromSprintReport(config, prevName);
    if (!velocity) {
      console.log(`    Falling back to JQL search...`);
      velocity = await fetchVelocityFromJira(config, prevName);
    }
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
