import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  team_config_path: string;
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
    estimation_accuracy: { fast_completion_ratio: number; slow_completion_ratio: number };
    low_item_warning: number;
  };
  statuses: {
    blocked: string[];
    not_started: string[];
    in_progress: string[];
    done: string[];
  };
}

export interface TeamConfig {
  team_name: string;
  engineers: { name: string; jira_account_id: string; jira_display_names: string[]; role: string }[];
}

interface SprintSummary {
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

interface TypeCompletion {
  type: string;
  total: number;
  completed: number;
  remaining: number;
}

interface EngineerCompletion {
  name: string;
  assigned: number;
  completed: number;
  remaining: number;
  sp_completed: number;
  sp_remaining: number;
}

interface EstimationFlag {
  key: string;
  summary: string;
  url: string;
  story_points: number;
  days_taken: number;
  kind: "slow" | "fast";
}

interface ScopeChange {
  key: string;
  summary: string;
  url: string;
  kind: "added" | "removed";
  date: string;
  story_points: number | null;
  priority: string;
}

interface CarryoverItem {
  key: string;
  summary: string;
  url: string;
  status: string;
  story_points: number | null;
  priority: string;
  assignee: string;
  risk: "high" | "medium" | "low";
}

interface BlockerItem {
  key: string;
  summary: string;
  url: string;
  days_stalled: number;
  assignee: string;
  priority: string;
  kind: "blocked" | "stalled";
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(configPath: string): SprintConfig {
  if (!existsSync(configPath)) {
    console.error(`${RED}Config not found: ${configPath}${RESET}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function loadTeamConfig(sprintConfig: SprintConfig, configDir: string): TeamConfig {
  const teamPath = resolve(configDir, sprintConfig.team_config_path);
  if (!existsSync(teamPath)) {
    console.error(`${RED}Team config not found: ${teamPath}${RESET}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(teamPath, "utf-8"));
}

export function buildDisplayToName(team: TeamConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const eng of team.engineers) {
    for (const dn of eng.jira_display_names) {
      map.set(dn.toLowerCase(), eng.name);
    }
  }
  return map;
}

export function buildAccountIdToName(team: TeamConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const eng of team.engineers) {
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

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

export function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

export function isCompleted(issue: SprintIssue, config: SprintConfig): boolean {
  return issue.resolution === "Done" || config.statuses.done.includes(issue.status);
}

export function computeSprintSummary(issues: SprintIssue[], config: SprintConfig, today: Date): SprintSummary {
  const first = issues[0];
  const sprintStart = parseDate(first?.sprint_start ?? "");
  const sprintEnd = parseDate(first?.sprint_end ?? "");

  const completed = issues.filter((i) => isCompleted(i, config));
  const hasPoints = issues.some((i) => i.story_points !== null);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalSp = hasPoints ? round2(issues.reduce((s, i) => s + (i.story_points ?? 0), 0)) : null;
  const completedSp = hasPoints ? round2(completed.reduce((s, i) => s + (i.story_points ?? 0), 0)) : null;

  return {
    sprint_name: first?.sprint_name ?? "Unknown Sprint",
    sprint_start: first?.sprint_start ?? "",
    sprint_end: first?.sprint_end ?? "",
    days_elapsed: sprintStart ? daysBetween(sprintStart, today) : 0,
    total_days: sprintStart && sprintEnd ? daysBetween(sprintStart, sprintEnd) : 0,
    total_issues: issues.length,
    completed_issues: completed.length,
    remaining_issues: issues.length - completed.length,
    total_sp: totalSp,
    completed_sp: completedSp,
    remaining_sp: totalSp !== null && completedSp !== null ? round2(totalSp - completedSp) : null,
  };
}

export function computeCompletionByType(issues: SprintIssue[], config: SprintConfig): TypeCompletion[] {
  const map = new Map<string, { total: number; completed: number }>();
  for (const i of issues) {
    const entry = map.get(i.issuetype) ?? { total: 0, completed: 0 };
    entry.total++;
    if (isCompleted(i, config)) entry.completed++;
    map.set(i.issuetype, entry);
  }
  return [...map.entries()]
    .map(([type, v]) => ({ type, total: v.total, completed: v.completed, remaining: v.total - v.completed }))
    .sort((a, b) => b.total - a.total);
}

export function computeCompletionByEngineer(
  issues: SprintIssue[],
  config: SprintConfig,
  team: TeamConfig,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
): EngineerCompletion[] {
  const map = new Map<string, EngineerCompletion>();
  for (const eng of team.engineers) {
    map.set(eng.name, { name: eng.name, assigned: 0, completed: 0, remaining: 0, sp_completed: 0, sp_remaining: 0 });
  }

  for (const i of issues) {
    const name =
      accountIdToName.get(i.assignee_id) ?? displayToName.get(i.assignee_name.toLowerCase()) ?? i.assignee_name;
    if (!name) continue;
    let entry = map.get(name);
    if (!entry) {
      entry = { name, assigned: 0, completed: 0, remaining: 0, sp_completed: 0, sp_remaining: 0 };
      map.set(name, entry);
    }
    entry.assigned++;
    if (isCompleted(i, config)) {
      entry.completed++;
      entry.sp_completed += i.story_points ?? 0;
    } else {
      entry.remaining++;
      entry.sp_remaining += i.story_points ?? 0;
    }
  }

  return [...map.values()].sort((a, b) => b.assigned - a.assigned);
}

export function computeCompletionByPriority(issues: SprintIssue[], config: SprintConfig): TypeCompletion[] {
  const map = new Map<string, { total: number; completed: number }>();
  for (const i of issues) {
    const entry = map.get(i.priority) ?? { total: 0, completed: 0 };
    entry.total++;
    if (isCompleted(i, config)) entry.completed++;
    map.set(i.priority, entry);
  }
  const order = ["Blocker", "Critical", "Major", "Normal", "Minor", "Trivial", "Undefined"];
  return [...map.entries()]
    .map(([type, v]) => ({ type, total: v.total, completed: v.completed, remaining: v.total - v.completed }))
    .sort((a, b) => {
      const ai = order.indexOf(a.type);
      const bi = order.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

export function computeEstimationFlags(issues: SprintIssue[], config: SprintConfig): EstimationFlag[] {
  const flags: EstimationFlag[] = [];
  const sprintStart = parseDate(issues[0]?.sprint_start ?? "");
  if (!sprintStart) return flags;

  const { fast_completion_ratio, slow_completion_ratio } = config.thresholds.estimation_accuracy;

  for (const i of issues) {
    if (!isCompleted(i, config) || i.story_points === null || i.story_points === 0) continue;
    const resolved = parseDate(i.resolutiondate);
    if (!resolved) continue;
    const days = Math.max(1, daysBetween(sprintStart, resolved));
    const ratio = days / i.story_points;
    const url = `${config.jira.base_url}/${i.key}`;
    if (ratio >= slow_completion_ratio) {
      flags.push({ key: i.key, summary: i.summary, url, story_points: i.story_points, days_taken: days, kind: "slow" });
    } else if (ratio <= fast_completion_ratio) {
      flags.push({ key: i.key, summary: i.summary, url, story_points: i.story_points, days_taken: days, kind: "fast" });
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

  const bufferMs = config.thresholds.scope_change_buffer_days * 24 * 60 * 60 * 1000;
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
    if (c.sprint_names.some((sn) => sn.includes(sprintName) || sprintName.includes(sn))) {
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

export function computeCarryover(issues: SprintIssue[], config: SprintConfig): CarryoverItem[] {
  const items: CarryoverItem[] = [];
  const priorityWeight: Record<string, number> = { Blocker: 5, Critical: 4, Major: 3, Normal: 2, Minor: 1, Trivial: 0 };

  for (const i of issues) {
    if (isCompleted(i, config)) continue;
    const pw = priorityWeight[i.priority] ?? 2;
    let risk: "high" | "medium" | "low";
    if (pw >= 4 || (i.story_points !== null && i.story_points > 5)) {
      risk = "high";
    } else if (config.statuses.in_progress.includes(i.status)) {
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
      assignee: i.assignee_name,
      risk,
    });
  }

  return items.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    if (riskOrder[a.risk] !== riskOrder[b.risk]) return riskOrder[a.risk] - riskOrder[b.risk];
    return (b.story_points ?? 0) - (a.story_points ?? 0);
  });
}

export function computeBlockers(issues: SprintIssue[], config: SprintConfig, today: Date): BlockerItem[] {
  const items: BlockerItem[] = [];

  for (const i of issues) {
    if (isCompleted(i, config)) continue;

    if (config.statuses.blocked.includes(i.status)) {
      const updated = parseDate(i.updated);
      items.push({
        key: i.key,
        summary: i.summary,
        url: `${config.jira.base_url}/${i.key}`,
        days_stalled: updated ? daysBetween(updated, today) : 0,
        assignee: i.assignee_name,
        priority: i.priority,
        kind: "blocked",
      });
    } else if (config.statuses.in_progress.includes(i.status)) {
      const updated = parseDate(i.updated);
      if (updated && daysBetween(updated, today) >= config.thresholds.long_in_progress_days) {
        items.push({
          key: i.key,
          summary: i.summary,
          url: `${config.jira.base_url}/${i.key}`,
          days_stalled: daysBetween(updated, today),
          assignee: i.assignee_name,
          priority: i.priority,
          kind: "stalled",
        });
      }
    }
  }

  return items.sort((a, b) => b.days_stalled - a.days_stalled);
}

export function identifyAutomationOpportunities(issues: SprintIssue[]): string[] {
  const opportunities: string[] = [];

  const cveCount = issues.filter(
    (i) => i.issuetype === "Vulnerability" || i.summary.toLowerCase().includes("cve"),
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
    .filter(([word]) => !["with", "from", "that", "this", "should", "when", "after", "before", "does", "have"].includes(word))
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
  scopeChanges: ScopeChange[],
  carryover: CarryoverItem[],
  blockers: BlockerItem[],
  automationOps: string[],
  hasStoryPoints: boolean,
  warnings: string[],
): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln(`# Sprint Retrospective: ${summary.sprint_name}`);
  ln();
  ln(`Analysis generated: ${formatDate(new Date())}`);
  ln(`Sprint period: ${summary.sprint_start.slice(0, 10)} to ${summary.sprint_end.slice(0, 10)} (${summary.days_elapsed} of ${summary.total_days} days elapsed)`);
  ln();

  // Key Takeaways placeholder
  ln("## Key Takeaways");
  ln();
  ln("<!-- TAKEAWAYS_PLACEHOLDER -->");
  ln("- (takeaways pending)");
  ln();

  // Sprint Summary
  ln("## Sprint Summary");
  ln();
  ln("| Metric | Value |");
  ln("|--------|-------|");
  ln(`| Total Issues | ${summary.total_issues} |`);
  ln(`| Completed | ${summary.completed_issues} (${pct(summary.completed_issues, summary.total_issues)}%) |`);
  ln(`| Remaining | ${summary.remaining_issues} |`);
  if (hasStoryPoints) {
    ln(`| Story Points Planned | ${spStr(summary.total_sp)} |`);
    ln(`| Story Points Completed | ${spStr(summary.completed_sp)} (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%) |`);
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
    ln(`| ${t.type} | ${t.total} | ${t.completed} | ${t.remaining} | ${pct(t.completed, t.total)}% |`);
  }
  ln();

  ln("### By Engineer");
  ln();
  if (hasStoryPoints) {
    ln("| Engineer | Assigned | Completed | Remaining | SP Completed | SP Remaining |");
    ln("|----------|----------|-----------|-----------|--------------|--------------|");
    for (const e of byEngineer) {
      ln(`| ${e.name} | ${e.assigned} | ${e.completed} | ${e.remaining} | ${e.sp_completed} | ${e.sp_remaining} |`);
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
    ln(`| ${p.type} | ${p.total} | ${p.completed} | ${pct(p.completed, p.total)}% |`);
  }
  ln();

  // Estimation Accuracy
  ln("## Estimation Accuracy");
  ln();
  if (!hasStoryPoints) {
    ln("Estimation accuracy analysis unavailable -- no story points assigned to sprint items.");
  } else {
    ln(`Overall: ${spStr(summary.completed_sp)} of ${spStr(summary.total_sp)} story points completed (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%)`);
    ln();
    const slow = estimationFlags.filter((f) => f.kind === "slow");
    const fast = estimationFlags.filter((f) => f.kind === "fast");
    if (slow.length > 0) {
      ln("### Items That Took Longer Than Expected");
      ln();
      for (const f of slow) {
        ln(`- [${f.key} - ${truncate(f.summary, 60)}](${f.url}) -- ${f.story_points} SP, took ${f.days_taken} days`);
      }
      ln();
    }
    if (fast.length > 0) {
      ln("### Items Completed Faster Than Expected");
      ln();
      for (const f of fast) {
        ln(`- [${f.key} - ${truncate(f.summary, 60)}](${f.url}) -- ${f.story_points} SP, completed in ${f.days_taken} day${f.days_taken === 1 ? "" : "s"}`);
      }
      ln();
    }
    if (slow.length === 0 && fast.length === 0) {
      ln("No estimation anomalies detected.");
      ln();
    }
  }

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
    ln(`${added.length} item${added.length !== 1 ? "s" : ""} added mid-sprint, ${removed.length} item${removed.length !== 1 ? "s" : ""} removed. Net scope change: ${addedSp - removedSp >= 0 ? "+" : ""}${addedSp - removedSp} story points.`);
    ln();
    if (added.length > 0) {
      ln("### Added Mid-Sprint");
      ln();
      for (const s of added) {
        ln(`- [${s.key} - ${truncate(s.summary, 60)}](${s.url}) -- added ${s.date}, ${spStr(s.story_points)} SP, ${s.priority} priority`);
      }
      ln();
    }
    if (removed.length > 0) {
      ln("### Removed Mid-Sprint");
      ln();
      for (const s of removed) {
        ln(`- [${s.key} - ${truncate(s.summary, 60)}](${s.url}) -- removed ~${s.date}, ${spStr(s.story_points)} SP`);
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
    const carryoverSp = carryover.reduce((s, i) => s + (i.story_points ?? 0), 0);
    ln(`${carryover.length} item${carryover.length !== 1 ? "s" : ""} (${carryoverSp} story points) likely to carry over to next sprint.`);
    ln();
    for (const risk of ["high", "medium", "low"] as const) {
      const items = carryover.filter((c) => c.risk === risk);
      if (items.length === 0) continue;
      ln(`### ${risk.charAt(0).toUpperCase() + risk.slice(1)} Risk`);
      ln();
      for (const c of items) {
        ln(`- [${c.key} - ${truncate(c.summary, 60)}](${c.url}) -- ${c.status}, ${spStr(c.story_points)} SP, ${c.priority} priority, assigned to ${c.assignee || "Unassigned"}`);
      }
      ln();
    }
  }
  ln();

  // Blocker Analysis
  ln("## Blocker Analysis");
  ln();
  const blocked = blockers.filter((b) => b.kind === "blocked");
  const stalled = blockers.filter((b) => b.kind === "stalled");
  if (blockers.length === 0) {
    ln("No blocked or stalled items.");
  } else {
    if (blocked.length > 0) {
      ln("### Currently Blocked");
      ln();
      for (const b of blocked) {
        ln(`- [${b.key} - ${truncate(b.summary, 60)}](${b.url}) -- blocked for ${b.days_stalled} day${b.days_stalled !== 1 ? "s" : ""}, assigned to ${b.assignee || "Unassigned"}, ${b.priority} priority`);
      }
      ln();
    }
    if (stalled.length > 0) {
      ln(`### Stalled (no updates in ${stalled[0]?.days_stalled ?? "N/A"}+ days)`);
      ln();
      for (const b of stalled) {
        ln(`- [${b.key} - ${truncate(b.summary, 60)}](${b.url}) -- last updated ${b.days_stalled} day${b.days_stalled !== 1 ? "s" : ""} ago, assigned to ${b.assignee || "Unassigned"}`);
      }
      ln();
    }
  }
  ln();

  // Time Distribution
  ln("## Time Distribution");
  ln();
  ln("See **Completion Analysis > By Engineer** above for detailed workload distribution.");
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
  hasStoryPoints: boolean,
) {
  const added = scopeChanges.filter((s) => s.kind === "added").length;
  const removed = scopeChanges.filter((s) => s.kind === "removed").length;
  const blockedCount = blockers.filter((b) => b.kind === "blocked").length;
  const stalledCount = blockers.filter((b) => b.kind === "stalled").length;
  const slow = estimationFlags.filter((f) => f.kind === "slow").length;
  const fast = estimationFlags.filter((f) => f.kind === "fast").length;
  const carryoverSp = carryover.reduce((s, i) => s + (i.story_points ?? 0), 0);
  const topRisk = carryover[0];

  console.log(`\n${BOLD}--- Retro Context ---${RESET}`);
  console.log(`  Completion: ${summary.completed_issues}/${summary.total_issues} issues (${pct(summary.completed_issues, summary.total_issues)}%)${hasStoryPoints ? `, ${spStr(summary.completed_sp)}/${spStr(summary.total_sp)} SP (${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}%)` : ""}`);
  console.log(`  Scope changes: +${added} added, -${removed} removed`);
  console.log(`  Blockers: ${blockedCount} blocked, ${stalledCount} stalled`);
  if (hasStoryPoints) {
    console.log(`  Estimation: ${summary.total_sp ? pct(summary.completed_sp ?? 0, summary.total_sp) : "N/A"}% SP accuracy, ${slow + fast} items flagged (${slow} slow, ${fast} fast)`);
  }
  console.log(`  Carryover risk: ${carryover.length} items (${carryoverSp} SP)`);
  if (topRisk) {
    console.log(`  Top risk: ${topRisk.key} (${spStr(topRisk.story_points)} SP, ${topRisk.priority}, ${topRisk.status})`);
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
      console.log("Usage: generate-sprint-retro.ts --date <YYYY-MM-DD> [--cache-dir <path>] [--config <path>] [--output <path>]");
      process.exit(0);
    }
    if (argv[i]!.startsWith("--") && i + 1 < argv.length) {
      args[argv[i]!.slice(2)] = argv[++i]!;
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

  const configPath = args.config ?? resolve(__dirname, "../data/sprint-config.json");
  const cachePath = args["cache-dir"] ?? resolve(__dirname, "../data/cache");
  const config = loadConfig(configPath);
  const team = loadTeamConfig(config, dirname(configPath));
  const accountIdToName = buildAccountIdToName(team);
  const displayToName = buildDisplayToName(team);

  console.log(`${GREEN}Loading sprint data...${RESET}`);

  const issues = loadSprintIssues(cachePath);
  const changelog = loadChangelogIssues(cachePath);

  const warnings: string[] = [];
  if (issues.length === 0) {
    console.error(`${RED}No sprint issues found in cache. Run the agent to fetch data first.${RESET}`);
    process.exit(2);
  }
  if (issues.length < config.thresholds.low_item_warning) {
    warnings.push(`Sprint has only ${issues.length} items (threshold: ${config.thresholds.low_item_warning}). Analysis may not be representative.`);
  }

  const hasStoryPoints = issues.some((i) => i.story_points !== null);
  if (!hasStoryPoints) {
    warnings.push("No story points found on any sprint items. Estimation accuracy analysis will be skipped.");
  }

  // Run analysis
  const summary = computeSprintSummary(issues, config, today);
  const byType = computeCompletionByType(issues, config);
  const byEngineer = computeCompletionByEngineer(issues, config, team, accountIdToName, displayToName);
  const byPriority = computeCompletionByPriority(issues, config);
  const estimationFlags = computeEstimationFlags(issues, config);
  const scopeChanges = computeScopeChanges(issues, changelog, config);
  const carryover = computeCarryover(issues, config);
  const blockers = computeBlockers(issues, config, today);
  const automationOps = identifyAutomationOpportunities(issues);

  // Format report
  const report = formatReport(
    summary, byType, byEngineer, byPriority, estimationFlags,
    scopeChanges, carryover, blockers, automationOps, hasStoryPoints, warnings,
  );

  // Write output
  const outputPath = args.output ?? resolve(__dirname, `../data/output/sprint-retro-${date}.md`);
  writeFileSync(outputPath, report);
  console.log(`${GREEN}Report written to ${outputPath}${RESET}`);

  // Print context for agent
  printRetroContext(summary, scopeChanges, blockers, estimationFlags, carryover, hasStoryPoints);

  // Exit code
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`${YELLOW}Warning: ${w}${RESET}`);
    process.exit(3);
  }
  process.exit(0);
}

const isDirectRun = process.argv[1]?.endsWith("generate-sprint-retro.ts");
if (isDirectRun) main();
