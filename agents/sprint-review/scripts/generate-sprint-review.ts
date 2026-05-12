import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const __dirname = import.meta.dirname;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SprintIssue {
  key: string;
  summary: string;
  status: string;
  resolution: string;
  resolutiondate: string;
  issuetype: string;
  priority: string;
  assignee_id: string;
  assignee_name: string;
  story_points: number | null;
  created: string;
  updated: string;
  sprint_name: string;
  sprint_start: string;
  sprint_end: string;
  labels: string[];
  qa_contact_id: string;
  qa_contact_name: string;
}

export interface ChangelogIssue {
  key: string;
  summary: string;
  status: string;
  resolution: string;
  issuetype: string;
  assignee_name: string;
  story_points: number | null;
  created: string;
  updated: string;
  sprint_names: string[];
}

export interface SprintConfig {
  board_id: number;
  sprint_name_prefix: string;
  jira: {
    cloud_id: string;
    base_url: string;
    sprint_field: string;
    story_point_field: string;
  };
  thresholds: {
    long_in_progress_days: number;
    scope_change_buffer_days: number;
    estimation_accuracy: {
      fast_completion_ratio: number;
      slow_completion_ratio: number;
    };
    low_item_warning: number;
  };
  statuses: {
    not_started: string[];
    in_progress: string[];
    testing: string[];
    done: string[];
  };
  engineers: {
    name: string;
    jira_account_id: string;
    jira_display_names: string[];
    role: "dev" | "qe";
  }[];
}

export interface SprintSummary {
  sprint_name: string;
  sprint_start: string;
  sprint_end: string;
  days_elapsed: number;
  total_days: number;
  total_issues: number;
  completed_issues: number;
  remaining_issues: number;
  total_sp: number | null;
  completed_sp: number | null;
  remaining_sp: number | null;
}

export interface TypeCompletion {
  type: string;
  total: number;
  completed: number;
  remaining: number;
}

export interface EngineerCompletion {
  name: string;
  assigned: number;
  completed: number;
  remaining: number;
  sp_completed: number;
  sp_remaining: number;
}

export interface EstimationFlag {
  key: string;
  summary: string;
  url: string;
  story_points: number;
  days_taken: number;
  kind: "slow" | "fast";
}

export interface ScopeChange {
  key: string;
  summary: string;
  url: string;
  kind: "added" | "removed";
  date: string;
  story_points: number | null;
  priority: string;
}

export interface CarryoverItem {
  key: string;
  summary: string;
  url: string;
  status: string;
  story_points: number | null;
  priority: string;
  assignee: string;
  risk: "high" | "medium" | "low";
}

export interface BlockerItem {
  key: string;
  summary: string;
  url: string;
  days_stalled: number;
  assignee: string;
  priority: string;
  kind: "stalled";
}

export interface RetroGuide {
  wentWell: string[];
  wentLessWell: string[];
  tryNext: string[];
}

export interface TransitionRecord {
  key: string;
  first_in_progress_date: string;
}

export interface CycleTimeStat {
  type: string;
  count: number;
  median_days: number;
  avg_days: number;
  min_days: number;
  max_days: number;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(configPath: string): SprintConfig {
  if (!existsSync(configPath)) {
    console.error(`${RED}Config not found: ${configPath}${RESET}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as SprintConfig;
}

export function buildDisplayToName(config: SprintConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const eng of config.engineers) {
    for (const dn of eng.jira_display_names) {
      map.set(dn.toLowerCase(), eng.name);
    }
  }
  return map;
}

export function buildAccountIdToName(
  config: SprintConfig,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const eng of config.engineers) {
    map.set(eng.jira_account_id, eng.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
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

function loadSprintIssues(cachePath: string): SprintIssue[] {
  const filePath = resolve(cachePath, "sprint-issues.csv");
  if (!existsSync(filePath)) {
    console.error(`${RED}sprint-issues.csv not found in ${cachePath}${RESET}`);
    process.exit(1);
  }
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      key: f[0] ?? "",
      summary: f[1] ?? "",
      status: f[2] ?? "",
      resolution: f[3] ?? "",
      resolutiondate: f[4] ?? "",
      issuetype: f[5] ?? "",
      priority: f[6] ?? "",
      assignee_id: f[7] ?? "",
      assignee_name: f[8] ?? "",
      story_points: f[9] ? parseFloat(f[9]) : null,
      created: f[10] ?? "",
      updated: f[11] ?? "",
      sprint_name: f[12] ?? "",
      sprint_start: f[13] ?? "",
      sprint_end: f[14] ?? "",
      labels: (f[15] ?? "").split(";").filter(Boolean),
      qa_contact_id: f[16] ?? "",
      qa_contact_name: f[17] ?? "",
    };
  });
}

function loadChangelogIssues(cachePath: string): ChangelogIssue[] {
  const filePath = resolve(cachePath, "sprint-changelog.csv");
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      key: f[0] ?? "",
      summary: f[1] ?? "",
      status: f[2] ?? "",
      resolution: f[3] ?? "",
      issuetype: f[4] ?? "",
      assignee_name: f[5] ?? "",
      story_points: f[6] ? parseFloat(f[6]) : null,
      created: f[7] ?? "",
      updated: f[8] ?? "",
      sprint_names: (f[9] ?? "").split(";").filter(Boolean),
    };
  });
}

function loadTransitions(cachePath: string): TransitionRecord[] {
  const filePath = resolve(cachePath, "sprint-transitions.csv");
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      key: f[0] ?? "",
      first_in_progress_date: f[1] ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

export function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round(
    Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

export function isCompleted(issue: SprintIssue, config: SprintConfig): boolean {
  return (
    issue.resolution === "Done" || config.statuses.done.includes(issue.status)
  );
}

export function computeSprintSummary(
  issues: SprintIssue[],
  config: SprintConfig,
  today: Date,
): SprintSummary {
  const first = issues[0];
  const sprintStart = parseDate(first?.sprint_start ?? "");
  const sprintEnd = parseDate(first?.sprint_end ?? "");

  const completed = issues.filter((i) => isCompleted(i, config));
  const hasPoints = issues.some((i) => i.story_points !== null);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalSp = hasPoints
    ? round2(issues.reduce((s, i) => s + (i.story_points ?? 0), 0))
    : null;
  const completedSp = hasPoints
    ? round2(completed.reduce((s, i) => s + (i.story_points ?? 0), 0))
    : null;

  return {
    sprint_name: first?.sprint_name ?? "Unknown Sprint",
    sprint_start: first?.sprint_start ?? "",
    sprint_end: first?.sprint_end ?? "",
    days_elapsed: sprintStart ? daysBetween(sprintStart, today) : 0,
    total_days:
      sprintStart && sprintEnd ? daysBetween(sprintStart, sprintEnd) : 0,
    total_issues: issues.length,
    completed_issues: completed.length,
    remaining_issues: issues.length - completed.length,
    total_sp: totalSp,
    completed_sp: completedSp,
    remaining_sp:
      totalSp !== null && completedSp !== null
        ? round2(totalSp - completedSp)
        : null,
  };
}

export function computeCompletionByType(
  issues: SprintIssue[],
  config: SprintConfig,
): TypeCompletion[] {
  const map = new Map<string, { total: number; completed: number }>();
  for (const i of issues) {
    const entry = map.get(i.issuetype) ?? { total: 0, completed: 0 };
    entry.total++;
    if (isCompleted(i, config)) entry.completed++;
    map.set(i.issuetype, entry);
  }
  return [...map.entries()]
    .map(([type, v]) => ({
      type,
      total: v.total,
      completed: v.completed,
      remaining: v.total - v.completed,
    }))
    .sort((a, b) => b.total - a.total);
}

export function computeCompletionByEngineer(
  issues: SprintIssue[],
  config: SprintConfig,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
): EngineerCompletion[] {
  const map = new Map<string, EngineerCompletion>();
  for (const eng of config.engineers) {
    map.set(eng.name, {
      name: eng.name,
      assigned: 0,
      completed: 0,
      remaining: 0,
      sp_completed: 0,
      sp_remaining: 0,
    });
  }

  const qeNames = new Set(
    config.engineers.filter((e) => e.role === "qe").map((e) => e.name),
  );

  const accumulate = (entry: EngineerCompletion, i: SprintIssue) => {
    entry.assigned++;
    if (isCompleted(i, config)) {
      entry.completed++;
      entry.sp_completed += i.story_points ?? 0;
    } else {
      entry.remaining++;
      entry.sp_remaining += i.story_points ?? 0;
    }
  };

  for (const i of issues) {
    const name =
      accountIdToName.get(i.assignee_id) ??
      displayToName.get(i.assignee_name.toLowerCase());
    const entry = name ? map.get(name) : undefined;
    if (entry) accumulate(entry, i);

    const qaName =
      accountIdToName.get(i.qa_contact_id) ??
      displayToName.get(i.qa_contact_name.toLowerCase());
    if (qaName && qeNames.has(qaName) && qaName !== name) {
      const qaEntry = map.get(qaName);
      if (qaEntry) accumulate(qaEntry, i);
    }
  }

  return [...map.values()].sort((a, b) => b.assigned - a.assigned);
}

export function computeCompletionByPriority(
  issues: SprintIssue[],
  config: SprintConfig,
): TypeCompletion[] {
  const map = new Map<string, { total: number; completed: number }>();
  for (const i of issues) {
    const entry = map.get(i.priority) ?? { total: 0, completed: 0 };
    entry.total++;
    if (isCompleted(i, config)) entry.completed++;
    map.set(i.priority, entry);
  }
  const order = [
    "Blocker",
    "Critical",
    "Major",
    "Normal",
    "Minor",
    "Trivial",
    "Undefined",
  ];
  return [...map.entries()]
    .map(([type, v]) => ({
      type,
      total: v.total,
      completed: v.completed,
      remaining: v.total - v.completed,
    }))
    .sort((a, b) => {
      const ai = order.indexOf(a.type);
      const bi = order.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

export function computeEstimationFlags(
  issues: SprintIssue[],
  config: SprintConfig,
): EstimationFlag[] {
  const flags: EstimationFlag[] = [];
  const sprintStart = parseDate(issues[0]?.sprint_start ?? "");
  if (!sprintStart) return flags;

  const { fast_completion_ratio, slow_completion_ratio } =
    config.thresholds.estimation_accuracy;

  for (const i of issues) {
    if (
      !isCompleted(i, config) ||
      i.story_points === null ||
      i.story_points === 0
    )
      continue;
    const resolved = parseDate(i.resolutiondate);
    if (!resolved) continue;
    const days = Math.max(1, daysBetween(sprintStart, resolved));
    const ratio = days / i.story_points;
    const url = `${config.jira.base_url}/${i.key}`;
    if (ratio >= slow_completion_ratio) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        story_points: i.story_points,
        days_taken: days,
        kind: "slow",
      });
    } else if (ratio <= fast_completion_ratio) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        story_points: i.story_points,
        days_taken: days,
        kind: "fast",
      });
    }
  }
  return flags;
}

export function computeScopeChanges(
  issues: SprintIssue[],
  changelog: ChangelogIssue[],
  config: SprintConfig,
): ScopeChange[] {
  const changes: ScopeChange[] = [];
  const sprintStart = parseDate(issues[0]?.sprint_start ?? "");
  if (!sprintStart) return changes;

  const bufferMs =
    config.thresholds.scope_change_buffer_days * 24 * 60 * 60 * 1000;
  const cutoff = new Date(sprintStart.getTime() + bufferMs);

  for (const i of issues) {
    const created = parseDate(i.created);
    if (created && created > cutoff) {
      changes.push({
        key: i.key,
        summary: i.summary,
        url: `${config.jira.base_url}/${i.key}`,
        kind: "added",
        date: i.created.slice(0, 10),
        story_points: i.story_points,
        priority: i.priority,
      });
    }
  }

  const sprintKeys = new Set(issues.map((i) => i.key));
  const sprintName = issues[0]?.sprint_name ?? "";
  for (const c of changelog) {
    if (sprintKeys.has(c.key)) continue;
    if (
      c.sprint_names.some(
        (sn) => sn.includes(sprintName) || sprintName.includes(sn),
      )
    ) {
      changes.push({
        key: c.key,
        summary: c.summary,
        url: `${config.jira.base_url}/${c.key}`,
        kind: "removed",
        date: c.updated.slice(0, 10),
        story_points: c.story_points,
        priority: "",
      });
    }
  }

  return changes;
}

export function computeCarryover(
  issues: SprintIssue[],
  config: SprintConfig,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
): CarryoverItem[] {
  const items: CarryoverItem[] = [];
  const priorityWeight: Record<string, number> = {
    Blocker: 5,
    Critical: 4,
    Major: 3,
    Normal: 2,
    Minor: 1,
    Trivial: 0,
  };

  for (const i of issues) {
    if (isCompleted(i, config)) continue;
    const pw = priorityWeight[i.priority] ?? 2;
    let risk: "high" | "medium" | "low";
    if (pw >= 4 || (i.story_points !== null && i.story_points > 8)) {
      risk = "high";
    } else if (
      config.statuses.in_progress.includes(i.status) ||
      config.statuses.testing.includes(i.status)
    ) {
      risk = "medium";
    } else {
      risk = "low";
    }

    items.push({
      key: i.key,
      summary: i.summary,
      url: `${config.jira.base_url}/${i.key}`,
      status: i.status,
      story_points: i.story_points,
      priority: i.priority,
      assignee:
        accountIdToName.get(i.assignee_id) ??
        displayToName.get(i.assignee_name.toLowerCase()) ??
        i.assignee_name,
      risk,
    });
  }

  return items.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    if (riskOrder[a.risk] !== riskOrder[b.risk])
      return riskOrder[a.risk] - riskOrder[b.risk];
    return (b.story_points ?? 0) - (a.story_points ?? 0);
  });
}

export function computeBlockers(
  issues: SprintIssue[],
  config: SprintConfig,
  today: Date,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
): BlockerItem[] {
  const items: BlockerItem[] = [];

  for (const i of issues) {
    if (isCompleted(i, config)) continue;

    if (
      config.statuses.in_progress.includes(i.status) ||
      config.statuses.testing.includes(i.status)
    ) {
      const updated = parseDate(i.updated);
      if (
        updated &&
        daysBetween(updated, today) >= config.thresholds.long_in_progress_days
      ) {
        items.push({
          key: i.key,
          summary: i.summary,
          url: `${config.jira.base_url}/${i.key}`,
          days_stalled: daysBetween(updated, today),
          assignee:
            accountIdToName.get(i.assignee_id) ??
            displayToName.get(i.assignee_name.toLowerCase()) ??
            i.assignee_name,
          priority: i.priority,
          kind: "stalled",
        });
      }
    }
  }

  return items.sort((a, b) => b.days_stalled - a.days_stalled);
}

export function identifyAutomationOpportunities(
  issues: SprintIssue[],
): string[] {
  const opportunities: string[] = [];

  const cveCount = issues.filter(
    (i) =>
      i.issuetype === "Vulnerability" ||
      i.summary.toLowerCase().includes("cve"),
  ).length;
  if (cveCount >= 3) {
    opportunities.push(
      `${cveCount} CVE/vulnerability issues in this sprint -- consider automated dependency scanning to catch these earlier`,
    );
  }

  const testTasks = issues.filter(
    (i) =>
      /\b(tier|post|stage)\b/i.test(i.summary) ||
      (i.issuetype === "Task" && /\btest/i.test(i.summary)),
  );
  if (testTasks.length >= 3) {
    opportunities.push(
      `${testTasks.length} test execution tasks -- CI/CD automation or a test-runner agent could reduce manual effort`,
    );
  }

  const bugCount = issues.filter((i) => i.issuetype === "Bug").length;
  if (bugCount >= 5) {
    opportunities.push(
      `${bugCount} bugs in the sprint -- a code review agent or lint rules could help catch common issues earlier`,
    );
  }

  const wordFreq = new Map<string, number>();
  for (const i of issues) {
    const words = i.summary.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    for (const w of words) {
      wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    }
  }
  const repeatedPatterns = [...wordFreq.entries()]
    .filter(([, count]) => count >= 4)
    .filter(
      ([word]) =>
        ![
          "with",
          "from",
          "that",
          "this",
          "should",
          "when",
          "after",
          "before",
          "does",
          "have",
        ].includes(word),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [word, count] of repeatedPatterns) {
    opportunities.push(
      `"${word}" appears in ${count} issue summaries -- investigate if these are related tasks that could be batched or templated`,
    );
  }

  return opportunities;
}

// ---------------------------------------------------------------------------
// Cycle Time
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function computeCycleTime(
  issues: SprintIssue[],
  transitions: TransitionRecord[],
  config: SprintConfig,
): CycleTimeStat[] {
  if (transitions.length === 0) return [];

  const transMap = new Map<string, string>();
  for (const t of transitions) {
    transMap.set(t.key, t.first_in_progress_date);
  }

  const byType = new Map<string, number[]>();

  for (const issue of issues) {
    if (!isCompleted(issue, config)) continue;
    const resolved = parseDate(issue.resolutiondate) ?? parseDate(issue.updated);
    if (!resolved) continue;
    const inProgressDate = transMap.get(issue.key);
    if (!inProgressDate) continue;
    const started = parseDate(inProgressDate);
    if (!started) continue;

    const days = Math.max(1, daysBetween(started, resolved));
    const arr = byType.get(issue.issuetype) ?? [];
    arr.push(days);
    byType.set(issue.issuetype, arr);
  }

  const stats: CycleTimeStat[] = [];
  for (const [type, days] of byType) {
    const avg = Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10;
    stats.push({
      type,
      count: days.length,
      median_days: median(days),
      avg_days: avg,
      min_days: Math.min(...days),
      max_days: Math.max(...days),
    });
  }

  return stats.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Retro Discussion Guide
// ---------------------------------------------------------------------------

export function computeRetroGuide(
  summary: SprintSummary,
  byType: TypeCompletion[],
  byEngineer: EngineerCompletion[],
  byPriority: TypeCompletion[],
  estimationFlags: EstimationFlag[],
  scopeChanges: ScopeChange[],
  carryover: CarryoverItem[],
  blockers: BlockerItem[],
  cycleTime: CycleTimeStat[],
  hasStoryPoints: boolean,
): RetroGuide {
  const wentWell: string[] = [];
  const wentLessWell: string[] = [];
  const tryNext: string[] = [];

  const issueCompletionRate =
    summary.total_issues > 0
      ? summary.completed_issues / summary.total_issues
      : 0;
  const spCompletionRate =
    hasStoryPoints && summary.total_sp && summary.total_sp > 0
      ? (summary.completed_sp ?? 0) / summary.total_sp
      : null;

  const added = scopeChanges.filter((s) => s.kind === "added");
  const removed = scopeChanges.filter((s) => s.kind === "removed");
  const slow = estimationFlags.filter((f) => f.kind === "slow");
  const fast = estimationFlags.filter((f) => f.kind === "fast");
  const highRisk = carryover.filter((c) => c.risk === "high");
  const highRiskSp = highRisk.reduce((s, i) => s + (i.story_points ?? 0), 0);

  // --- Went Well ---

  if (issueCompletionRate >= 0.8 && summary.remaining_issues > 0) {
    wentWell.push(
      `Completed ${summary.completed_issues} of ${summary.total_issues} issues (${Math.round(issueCompletionRate * 100)}%) -- strong overall delivery`,
    );
  }

  if (spCompletionRate !== null && spCompletionRate >= 0.8) {
    wentWell.push(
      `Delivered ${spStr(summary.completed_sp)} of ${spStr(summary.total_sp)} story points (${Math.round(spCompletionRate * 100)}%)`,
    );
  }

  let typeWellCount = 0;
  for (const t of byType) {
    if (typeWellCount >= 2) break;
    if (t.total >= 2 && t.completed === t.total) {
      wentWell.push(`All ${t.type} issues completed (${t.total}/${t.total})`);
      typeWellCount++;
    }
  }

  for (const p of byPriority) {
    if (
      (p.type === "Blocker" || p.type === "Critical") &&
      p.total >= 2
    ) {
      const rate = p.completed / p.total;
      if (rate >= 1) {
        wentWell.push(
          `All ${p.type}-priority items completed (${p.completed}/${p.total})`,
        );
      } else if (rate >= 0.75) {
        wentWell.push(
          `${p.type}-priority items mostly resolved (${p.completed}/${p.total}, ${Math.round(rate * 100)}%)`,
        );
      }
    } else if (
      (p.type === "Blocker" || p.type === "Critical") &&
      p.total === 1 &&
      p.completed === 1
    ) {
      wentWell.push(
        `All ${p.type}-priority items completed (${p.completed}/${p.total})`,
      );
    }
  }

  if (typeWellCount === 0 && summary.total_issues > 0) {
    const best = byType
      .filter((t) => t.total >= 3)
      .sort((a, b) => b.completed / b.total - a.completed / a.total)[0];
    if (
      best &&
      best.completed / best.total > issueCompletionRate + 0.1
    ) {
      wentWell.push(
        `${best.type} completion outpaced overall (${Math.round((best.completed / best.total) * 100)}% vs ${Math.round(issueCompletionRate * 100)}% overall)`,
      );
    }
  }

  let engWellCount = 0;
  for (const e of byEngineer) {
    if (e.assigned >= 2 && e.completed === e.assigned && engWellCount < 3) {
      wentWell.push(`${e.name} completed all ${e.assigned} assigned items`);
      engWellCount++;
    }
  }

  if (fast.length > 0) {
    wentWell.push(
      `${fast.length} item${fast.length !== 1 ? "s" : ""} completed faster than estimated -- good execution on well-understood work`,
    );
  }

  if (cycleTime.length > 0) {
    const largest = cycleTime[0];
    if (largest.median_days <= 3) {
      wentWell.push(
        `${largest.type} cycle time is fast (median ${largest.median_days} day${largest.median_days !== 1 ? "s" : ""} from In Progress to Done)`,
      );
    }
  }

  if (blockers.length === 0) {
    wentWell.push("No stalled items detected during the sprint");
  }

  if (scopeChanges.length === 0) {
    wentWell.push(
      "Scope remained stable throughout the sprint -- no mid-sprint additions or removals",
    );
  }

  if (carryover.length === 0) {
    wentWell.push(
      "All sprint items completed -- no carryover into next sprint",
    );
  }

  // --- Went Less Well (collect candidates, then cap at 5) ---

  interface WeightedBullet {
    text: string;
    weight: number;
  }
  const lessCandidates: WeightedBullet[] = [];

  const lowCompletion = issueCompletionRate < 0.6;
  const lowSp = spCompletionRate !== null && spCompletionRate < 0.6;
  if (lowCompletion && lowSp) {
    lessCandidates.push({
      text: `Completed only ${Math.round(issueCompletionRate * 100)}% of issues and ${Math.round(spCompletionRate * 100)}% of story points`,
      weight: 10,
    });
  } else if (lowCompletion) {
    lessCandidates.push({
      text: `Completed only ${Math.round(issueCompletionRate * 100)}% of issues (${summary.completed_issues}/${summary.total_issues})`,
      weight: 10,
    });
  } else if (lowSp && spCompletionRate !== null) {
    lessCandidates.push({
      text: `Delivered only ${Math.round(spCompletionRate * 100)}% of planned story points (${spStr(summary.completed_sp)}/${spStr(summary.total_sp)})`,
      weight: 10,
    });
  }

  const scopeCreep = added.length >= 3;
  if (scopeCreep) {
    const addedSp = added.reduce((s, i) => s + (i.story_points ?? 0), 0);
    lessCandidates.push({
      text: `${added.length} items were added mid-sprint, increasing scope by ${addedSp} story points`,
      weight: 8,
    });
  }

  const estimationMisses = slow.length >= 2;
  if (estimationMisses) {
    lessCandidates.push({
      text: `${slow.length} items took significantly longer than estimated, suggesting sizing inaccuracy`,
      weight: 7,
    });
  }

  const hasHighRiskCarryover = highRisk.length >= 1;
  if (hasHighRiskCarryover) {
    lessCandidates.push({
      text: `${highRisk.length} high-risk item${highRisk.length !== 1 ? "s" : ""} likely to carry over, totaling ${highRiskSp} story points`,
      weight: 9,
    });
  }

  const hasBlockers = blockers.length >= 1;
  if (hasBlockers) {
    const maxDays = Math.max(...blockers.map((b) => b.days_stalled));
    lessCandidates.push({
      text: `${blockers.length} item${blockers.length !== 1 ? "s" : ""} stalled for ${maxDays}+ days without updates`,
      weight: 8,
    });
  }

  let criticalIncomplete = false;
  for (const p of byPriority) {
    if (
      (p.type === "Blocker" || p.type === "Critical") &&
      p.remaining > 0
    ) {
      lessCandidates.push({
        text: `${p.remaining} ${p.type}-priority item${p.remaining !== 1 ? "s" : ""} remain incomplete`,
        weight: p.type === "Blocker" ? 9 : 7,
      });
      criticalIncomplete = true;
    }
  }

  let engOverloadCount = 0;
  let engineerOverload = false;
  for (const e of byEngineer) {
    if (e.assigned >= 3 && e.completed / e.assigned < 0.4) {
      if (engOverloadCount < 2) {
        lessCandidates.push({
          text: `${e.name} completed only ${e.completed}/${e.assigned} items -- may be overloaded or blocked`,
          weight: 6,
        });
        engOverloadCount++;
      }
      engineerOverload = true;
    }
  }

  const itemsRemoved = removed.length >= 2;
  if (itemsRemoved) {
    lessCandidates.push({
      text: `${removed.length} items were removed mid-sprint, suggesting planning instability`,
      weight: 5,
    });
  }

  const slowCycleTypes = cycleTime.filter((ct) => ct.median_days > 7);
  if (slowCycleTypes.length > 0) {
    const allSlow = slowCycleTypes.length === cycleTime.length && cycleTime.length > 1;
    const worst = slowCycleTypes.sort(
      (a, b) => b.median_days - a.median_days,
    )[0];
    lessCandidates.push({
      text:
        slowCycleTypes.length === 1
          ? `${worst.type} cycle time is slow (median ${worst.median_days} days from In Progress to Done)`
          : `Cycle time is slow across ${slowCycleTypes.length} issue types (${slowCycleTypes.map((ct) => `${ct.type}: ${ct.median_days}d`).join(", ")} median)`,
      weight: allSlow ? 8 : 7,
    });
  }

  const MAX_LESS_WELL = 6;
  lessCandidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_LESS_WELL)
    .forEach((c) => wentLessWell.push(c.text));

  // --- Try Next (derived from went-less-well triggers, cap at 4) ---

  interface WeightedAction {
    text: string;
    weight: number;
  }
  const tryCandidates: WeightedAction[] = [];

  if (lowCompletion || lowSp) {
    tryCandidates.push({
      text: "Review sprint capacity during planning -- consider committing to fewer items",
      weight: 10,
    });
  }

  if (scopeCreep) {
    tryCandidates.push({
      text: "Establish a sprint scope freeze after day 2 -- new items go to backlog unless critical",
      weight: 8,
    });
  }

  if (estimationMisses) {
    tryCandidates.push({
      text: "Run a story point calibration session before next sprint planning",
      weight: 7,
    });
  }

  if (hasHighRiskCarryover) {
    tryCandidates.push({
      text: "Decompose large items (8+ SP) into smaller deliverables before committing them to a sprint",
      weight: 9,
    });
  }

  if (hasBlockers) {
    tryCandidates.push({
      text: "Add a daily check for items in progress with no updates for 3+ days",
      weight: 8,
    });
  }

  if (criticalIncomplete) {
    tryCandidates.push({
      text: "Prioritize Blocker/Critical items in the first half of the sprint",
      weight: 7,
    });
  }

  if (engineerOverload) {
    tryCandidates.push({
      text: "Rebalance workload during sprint planning -- cap individual assignments or pair on complex items",
      weight: 6,
    });
  }

  if (slowCycleTypes.length > 0) {
    tryCandidates.push({
      text: "Investigate long cycle times -- check for external dependencies, review handoffs, or consider WIP limits",
      weight: 7,
    });
  }

  const MAX_TRY_NEXT = 4;
  tryCandidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_TRY_NEXT)
    .forEach((c) => tryNext.push(c.text));

  // Fallbacks
  if (wentWell.length === 0) {
    wentWell.push(
      "No standout positives identified from the data -- discuss qualitative wins in the retro",
    );
  }
  if (wentLessWell.length === 0) {
    wentLessWell.push(
      "No significant issues identified from the data -- a smooth sprint",
    );
  }
  if (tryNext.length === 0) {
    tryNext.push(
      "Continue current planning practices -- they produced a clean sprint",
    );
  }

  return { wentWell, wentLessWell, tryNext };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return "0";
  return Math.round((n / total) * 100).toString();
}

function spStr(sp: number | null): string {
  if (sp === null) return "N/A";
  return Number(sp.toFixed(2)).toString();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function formatReport(
  summary: SprintSummary,
  byType: TypeCompletion[],
  byEngineer: EngineerCompletion[],
  byPriority: TypeCompletion[],
  estimationFlags: EstimationFlag[],
  cycleTime: CycleTimeStat[],
  scopeChanges: ScopeChange[],
  carryover: CarryoverItem[],
  blockers: BlockerItem[],
  automationOps: string[],
  hasStoryPoints: boolean,
  retroGuide: RetroGuide,
  warnings: string[],
): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln(`# Sprint Retrospective: ${summary.sprint_name}`);
  ln();
  ln(`Analysis generated: ${formatDate(new Date())}`);
  ln(
    `Sprint period: ${summary.sprint_start.slice(0, 10)} to ${summary.sprint_end.slice(0, 10)} (${summary.days_elapsed} of ${summary.total_days} days elapsed)`,
  );
  ln();

  // Key Takeaways placeholder
  ln("## Key Takeaways");
  ln();
  ln("<!-- TAKEAWAYS_PLACEHOLDER -->");
  ln("- (takeaways pending)");
  ln();

  // Retro Discussion Guide
  ln("## Retro Discussion Guide");
  ln();
  ln("### What went well?");
  ln();
  for (const item of retroGuide.wentWell) {
    ln(`- ${item}`);
  }
  ln();
  ln("### What went less well?");
  ln();
  for (const item of retroGuide.wentLessWell) {
    ln(`- ${item}`);
  }
  ln();
  ln("### What do we want to try next?");
  ln();
  for (const item of retroGuide.tryNext) {
    ln(`- ${item}`);
  }
  ln();

  // Sprint Summary
  ln("## Sprint Summary");
  ln();
  ln("| Metric | Value |");
  ln("|--------|-------|");
  ln(`| Total Issues | ${summary.total_issues} |`);
  ln(
    `| Completed | ${summary.completed_issues} (${pct(summary.completed_issues, summary.total_issues)}%) |`,
  );
  ln(`| Remaining | ${summary.remaining_issues} |`);
  if (hasStoryPoints) {
    ln(`| Story Points Planned | ${spStr(summary.total_sp)} |`);
    ln(
      `| Story Points Completed | ${spStr(summary.completed_sp)} (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%) |`,
    );
    ln(`| Story Points Remaining | ${spStr(summary.remaining_sp)} |`);
  }
  ln();

  // Completion Analysis
  ln("## Completion Analysis");
  ln();
  ln("### By Issue Type");
  ln();
  ln("| Type | Total | Completed | Remaining | % Complete |");
  ln("|------|-------|-----------|-----------|------------|");
  for (const t of byType) {
    ln(
      `| ${t.type} | ${t.total} | ${t.completed} | ${t.remaining} | ${pct(t.completed, t.total)}% |`,
    );
  }
  ln();

  ln("### By Engineer");
  ln();
  if (hasStoryPoints) {
    ln(
      "| Engineer | Assigned | Completed | Remaining | SP Completed | SP Remaining |",
    );
    ln(
      "|----------|----------|-----------|-----------|--------------|--------------|",
    );
    for (const e of byEngineer) {
      ln(
        `| ${e.name} | ${e.assigned} | ${e.completed} | ${e.remaining} | ${e.sp_completed} | ${e.sp_remaining} |`,
      );
    }
  } else {
    ln("| Engineer | Assigned | Completed | Remaining |");
    ln("|----------|----------|-----------|-----------|");
    for (const e of byEngineer) {
      ln(`| ${e.name} | ${e.assigned} | ${e.completed} | ${e.remaining} |`);
    }
  }
  ln();

  ln("### By Priority");
  ln();
  ln("| Priority | Total | Completed | % Complete |");
  ln("|----------|-------|-----------|------------|");
  for (const p of byPriority) {
    ln(
      `| ${p.type} | ${p.total} | ${p.completed} | ${pct(p.completed, p.total)}% |`,
    );
  }
  ln();

  // Estimation Accuracy
  ln("## Estimation Accuracy");
  ln();
  if (!hasStoryPoints) {
    ln(
      "Estimation accuracy analysis unavailable -- no story points assigned to sprint items.",
    );
  } else {
    ln(
      `Overall: ${spStr(summary.completed_sp)} of ${spStr(summary.total_sp)} story points completed (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%)`,
    );
    ln();
    const slow = estimationFlags.filter((f) => f.kind === "slow");
    const fast = estimationFlags.filter((f) => f.kind === "fast");
    if (slow.length > 0) {
      ln("### Items That Took Longer Than Expected");
      ln();
      for (const f of slow) {
        ln(
          `- [${f.key} - ${truncate(f.summary, 60)}](${f.url}) -- ${f.story_points} SP, took ${f.days_taken} days`,
        );
      }
      ln();
    }
    if (fast.length > 0) {
      ln("### Items Completed Faster Than Expected");
      ln();
      for (const f of fast) {
        ln(
          `- [${f.key} - ${truncate(f.summary, 60)}](${f.url}) -- ${f.story_points} SP, completed in ${f.days_taken} day${f.days_taken === 1 ? "" : "s"}`,
        );
      }
      ln();
    }
    if (slow.length === 0 && fast.length === 0) {
      ln("No estimation anomalies detected.");
      ln();
    }
  }

  // Cycle Time
  ln("## Cycle Time");
  ln();
  if (cycleTime.length === 0) {
    ln(
      "Cycle time analysis unavailable -- no transition data collected.",
    );
  } else {
    ln("Days from In Progress to Done, by issue type.");
    ln();
    ln("| Type | Count | Median | Avg | Min | Max |");
    ln("|------|-------|--------|-----|-----|-----|");
    for (const ct of cycleTime) {
      ln(
        `| ${ct.type} | ${ct.count} | ${ct.median_days} | ${ct.avg_days} | ${ct.min_days} | ${ct.max_days} |`,
      );
    }
  }
  ln();

  // Scope Changes
  ln("## Scope Changes");
  ln();
  const added = scopeChanges.filter((s) => s.kind === "added");
  const removed = scopeChanges.filter((s) => s.kind === "removed");
  const addedSp = added.reduce((s, i) => s + (i.story_points ?? 0), 0);
  const removedSp = removed.reduce((s, i) => s + (i.story_points ?? 0), 0);
  if (scopeChanges.length === 0) {
    ln("No scope changes detected.");
  } else {
    ln(
      `${added.length} item${added.length !== 1 ? "s" : ""} added mid-sprint, ${removed.length} item${removed.length !== 1 ? "s" : ""} removed. Net scope change: ${addedSp - removedSp >= 0 ? "+" : ""}${addedSp - removedSp} story points.`,
    );
    ln();
    if (added.length > 0) {
      ln("### Added Mid-Sprint");
      ln();
      for (const s of added) {
        ln(
          `- [${s.key} - ${truncate(s.summary, 60)}](${s.url}) -- added ${s.date}, ${spStr(s.story_points)} SP, ${s.priority} priority`,
        );
      }
      ln();
    }
    if (removed.length > 0) {
      ln("### Removed Mid-Sprint");
      ln();
      for (const s of removed) {
        ln(
          `- [${s.key} - ${truncate(s.summary, 60)}](${s.url}) -- removed ~${s.date}, ${spStr(s.story_points)} SP`,
        );
      }
      ln();
    }
  }
  ln();

  // Carryover Risk
  ln("## Carryover Risk");
  ln();
  if (carryover.length === 0) {
    ln("All items completed -- no carryover expected.");
  } else {
    const carryoverSp = carryover.reduce(
      (s, i) => s + (i.story_points ?? 0),
      0,
    );
    ln(
      `${carryover.length} item${carryover.length !== 1 ? "s" : ""} (${carryoverSp} story points) likely to carry over to next sprint.`,
    );
    ln();
    for (const risk of ["high", "medium", "low"] as const) {
      const items = carryover.filter((c) => c.risk === risk);
      if (items.length === 0) continue;
      ln(`### ${risk.charAt(0).toUpperCase() + risk.slice(1)} Risk`);
      ln();
      for (const c of items) {
        ln(
          `- [${c.key} - ${truncate(c.summary, 60)}](${c.url}) -- ${c.status}, ${spStr(c.story_points)} SP, ${c.priority} priority, assigned to ${c.assignee || "Unassigned"}`,
        );
      }
      ln();
    }
  }
  ln();

  // Stalled Items
  ln("## Stalled Items");
  ln();
  if (blockers.length === 0) {
    ln("No stalled items.");
  } else {
    ln(
      `### Stalled (no updates in ${blockers[0]?.days_stalled ?? "N/A"}+ days)`,
    );
    ln();
    for (const b of blockers) {
      ln(
        `- [${b.key} - ${truncate(b.summary, 60)}](${b.url}) -- last updated ${b.days_stalled} day${b.days_stalled !== 1 ? "s" : ""} ago, assigned to ${b.assignee || "Unassigned"}`,
      );
    }
    ln();
  }
  ln();


  // Automation Opportunities
  ln("## Automation Opportunities");
  ln();
  if (automationOps.length === 0) {
    ln("No obvious automation opportunities detected in this sprint.");
  } else {
    for (const opp of automationOps) {
      ln(`- ${opp}`);
    }
  }
  ln();

  // Warnings
  if (warnings.length > 0) {
    ln("## Data Quality Notes");
    ln();
    for (const w of warnings) {
      ln(`- ${YELLOW}Warning:${RESET} ${w}`);
    }
    ln();
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Retro context (stdout for agent)
// ---------------------------------------------------------------------------

function printRetroContext(
  summary: SprintSummary,
  scopeChanges: ScopeChange[],
  blockers: BlockerItem[],
  estimationFlags: EstimationFlag[],
  carryover: CarryoverItem[],
  cycleTime: CycleTimeStat[],
  hasStoryPoints: boolean,
) {
  const added = scopeChanges.filter((s) => s.kind === "added").length;
  const removed = scopeChanges.filter((s) => s.kind === "removed").length;
  const stalledCount = blockers.length;
  const slow = estimationFlags.filter((f) => f.kind === "slow").length;
  const fast = estimationFlags.filter((f) => f.kind === "fast").length;
  const carryoverSp = carryover.reduce((s, i) => s + (i.story_points ?? 0), 0);
  const topRisk = carryover[0];

  console.log(`\n${BOLD}--- Retro Context ---${RESET}`);
  console.log(
    `  Completion: ${summary.completed_issues}/${summary.total_issues} issues (${pct(summary.completed_issues, summary.total_issues)}%)${hasStoryPoints ? `, ${spStr(summary.completed_sp)}/${spStr(summary.total_sp)} SP (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%)` : ""}`,
  );
  console.log(`  Scope changes: +${added} added, -${removed} removed`);
  console.log(`  Stalled: ${stalledCount} items`);
  if (hasStoryPoints) {
    console.log(
      `  Estimation: ${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}% SP accuracy, ${slow + fast} items flagged (${slow} slow, ${fast} fast)`,
    );
  }
  if (cycleTime.length > 0) {
    const ctSummary = cycleTime
      .map((ct) => `${ct.type}: ${ct.median_days}d median`)
      .join(", ");
    console.log(`  Cycle time: ${ctSummary}`);
  }
  console.log(
    `  Carryover risk: ${carryover.length} items (${carryoverSp} SP)`,
  );
  if (topRisk) {
    console.log(
      `  Top risk: ${topRisk.key} (${spStr(topRisk.story_points)} SP, ${topRisk.priority}, ${topRisk.status})`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-sprint-review.ts --date <YYYY-MM-DD> [--cache-dir <path>] [--config <path>] [--output <path>]",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i]!;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date;
  if (!date) {
    console.error(`${RED}--date is required (YYYY-MM-DD)${RESET}`);
    process.exit(1);
  }

  const today = new Date(date + "T12:00:00Z");
  if (isNaN(today.getTime())) {
    console.error(`${RED}Invalid date: ${date}${RESET}`);
    process.exit(1);
  }

  const configPath =
    args.config ?? resolve(__dirname, "../data/sprint-config.json");
  const cachePath = args["cache-dir"] ?? resolve(__dirname, "../data/cache");
  const config = loadConfig(configPath);
  const accountIdToName = buildAccountIdToName(config);
  const displayToName = buildDisplayToName(config);

  console.log(`${GREEN}Loading sprint data...${RESET}`);

  const issues = loadSprintIssues(cachePath);
  const changelog = loadChangelogIssues(cachePath);
  const transitions = loadTransitions(cachePath);

  const warnings: string[] = [];
  if (issues.length === 0) {
    console.error(
      `${RED}No sprint issues found in cache. Run the agent to fetch data first.${RESET}`,
    );
    process.exit(2);
  }
  if (issues.length < config.thresholds.low_item_warning) {
    warnings.push(
      `Sprint has only ${issues.length} items (threshold: ${config.thresholds.low_item_warning}). Analysis may not be representative.`,
    );
  }

  const hasStoryPoints = issues.some((i) => i.story_points !== null);
  if (!hasStoryPoints) {
    warnings.push(
      "No story points found on any sprint items. Estimation accuracy analysis will be skipped.",
    );
  }

  // Run analysis
  const summary = computeSprintSummary(issues, config, today);
  const byType = computeCompletionByType(issues, config);
  const byEngineer = computeCompletionByEngineer(
    issues,
    config,
    accountIdToName,
    displayToName,
  );
  const byPriority = computeCompletionByPriority(issues, config);
  const estimationFlags = computeEstimationFlags(issues, config);
  const scopeChanges = computeScopeChanges(issues, changelog, config);
  const carryover = computeCarryover(
    issues,
    config,
    accountIdToName,
    displayToName,
  );
  const blockers = computeBlockers(
    issues,
    config,
    today,
    accountIdToName,
    displayToName,
  );
  const automationOps = identifyAutomationOpportunities(issues);
  const cycleTime = computeCycleTime(issues, transitions, config);
  const retroGuide = computeRetroGuide(
    summary,
    byType,
    byEngineer,
    byPriority,
    estimationFlags,
    scopeChanges,
    carryover,
    blockers,
    cycleTime,
    hasStoryPoints,
  );

  // Format report
  const report = formatReport(
    summary,
    byType,
    byEngineer,
    byPriority,
    estimationFlags,
    cycleTime,
    scopeChanges,
    carryover,
    blockers,
    automationOps,
    hasStoryPoints,
    retroGuide,
    warnings,
  );

  // Write output
  const outputPath =
    args.output ?? resolve(__dirname, `../data/output/sprint-review-${date}.md`);
  writeFileSync(outputPath, report);
  console.log(`${GREEN}Report written to ${outputPath}${RESET}`);

  // Print context for agent
  printRetroContext(
    summary,
    scopeChanges,
    blockers,
    estimationFlags,
    carryover,
    cycleTime,
    hasStoryPoints,
  );

  // Exit code
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`${YELLOW}Warning: ${w}${RESET}`);
    process.exit(3);
  }
  process.exit(0);
}

const isDirectRun = process.argv[1]?.endsWith("generate-sprint-review.ts");
if (isDirectRun) main();
