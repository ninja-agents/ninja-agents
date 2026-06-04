import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const __dirname = import.meta.dirname;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types (shared with sprint-review — copied per agent-isolation convention)
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

export interface EngineerCompletion {
  name: string;
  assigned: number;
  completed: number;
  remaining: number;
  sp_completed: number;
  sp_remaining: number;
}

// ---------------------------------------------------------------------------
// Sprint-planning specific types
// ---------------------------------------------------------------------------

export interface VelocitySummary {
  sprint_name: string;
  total_issues: number;
  completed_issues: number;
  total_sp: number;
  completed_sp: number;
  by_engineer: {
    name: string;
    assigned: number;
    completed: number;
    sp_completed: number;
    sp_remaining: number;
  }[];
  carryover_keys: string[];
  retro_recommendations: string[];
}

export interface VelocityHistory {
  sprints: Record<string, VelocitySummary>;
}

export interface IndividualVelocityAverage {
  name: string;
  role: "dev" | "qe";
  sprints_available: number;
  n1_sp_completed: number | null;
  n2_sp_completed: number | null;
  avg_sp_completed: number | null;
  n1_items_completed: number | null;
  n2_items_completed: number | null;
  avg_items_completed: number | null;
}

export interface CapacityAnalysis {
  target_sp: number;
  target_issues: number;
  velocity_sp: number;
  velocity_issues: number;
  effective_sp: number;
  effective_issues: number;
  dead_items: DeadItem[];
  delta_pct: number;
  status: "ok" | "warning" | "overcommitted";
}

export interface DeadItem {
  key: string;
  summary: string;
  url: string;
  story_points: number | null;
  reason: string;
}

export interface LoadDistributionEntry {
  name: string;
  role: "dev" | "qe";
  target_assigned: number;
  target_sp: number;
  prev_completed: number;
  prev_sp_completed: number;
  load_ratio: number | null;
  risk: "ok" | "heavy" | "extreme" | "absent" | "new";
  baseline_sprints: number;
}

export interface RetroComplianceItem {
  recommendation: string;
  status: "addressed" | "partially" | "not_addressed" | "unknown";
  evidence: string;
}

export interface CarryoverAnalysisItem {
  key: string;
  summary: string;
  url: string;
  status: string;
  story_points: number | null;
  priority: string;
  assignee: string;
}

export interface HygieneFlag {
  key: string;
  summary: string;
  url: string;
  kind: "unassigned" | "no_sp" | "already_done" | "refinement" | "oversized";
  detail: string;
  assignee: string;
}

export interface EngineerProposal {
  name: string;
  role: "dev" | "qe";
  target_items: number;
  target_sp: number;
  avg_sp: number | null;
  load_ratio: number | null;
  risk: string;
  actions: string[];
}

export interface PlanningReport {
  capacity: CapacityAnalysis;
  load: LoadDistributionEntry[];
  individualVelocity: IndividualVelocityAverage[];
  retro: RetroComplianceItem[];
  carryover: CarryoverAnalysisItem[];
  hygiene: HygieneFlag[];
  recommendations: string[];
  engineerProposals: EngineerProposal[];
}

// ---------------------------------------------------------------------------
// Utility functions (shared with sprint-review)
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

export function isCompleted(issue: SprintIssue, config: SprintConfig): boolean {
  return (
    issue.resolution === "Done" || config.statuses.done.includes(issue.status)
  );
}

// ---------------------------------------------------------------------------
// CSV / JSON loading
// ---------------------------------------------------------------------------

export function loadSprintIssues(csvPath: string): SprintIssue[] {
  if (!existsSync(csvPath)) {
    console.error(`${RED}CSV not found: ${csvPath}${RESET}`);
    process.exit(1);
  }
  const lines = readFileSync(csvPath, "utf-8").trim().split("\n");
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

export function loadVelocitySummary(jsonPath: string): VelocitySummary {
  if (!existsSync(jsonPath)) {
    console.error(`${RED}Velocity file not found: ${jsonPath}${RESET}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(jsonPath, "utf-8")) as VelocitySummary;
}

export function loadVelocityHistory(
  jsonPath: string,
): VelocityHistory | null {
  if (!existsSync(jsonPath)) return null;
  return JSON.parse(readFileSync(jsonPath, "utf-8")) as VelocityHistory;
}

export function computeIndividualVelocityAverages(
  velocityN1: VelocitySummary,
  velocityN2: VelocitySummary | null,
  config: SprintConfig,
): IndividualVelocityAverage[] {
  const n1ByName = new Map(
    velocityN1.by_engineer.map((e) => [e.name, e]),
  );
  const n2ByName = velocityN2
    ? new Map(velocityN2.by_engineer.map((e) => [e.name, e]))
    : null;

  const roleMap = new Map(config.engineers.map((e) => [e.name, e.role]));

  return config.engineers
    .map((eng) => {
      const n1 = n1ByName.get(eng.name);
      const n2 = n2ByName?.get(eng.name) ?? null;

      const n1Sp = n1?.sp_completed ?? null;
      const n2Sp = n2?.sp_completed ?? null;
      const n1Items = n1?.completed ?? null;
      const n2Items = n2?.completed ?? null;

      let sprintsAvailable = 0;
      if (n1Sp !== null) sprintsAvailable++;
      if (n2Sp !== null) sprintsAvailable++;

      let avgSp: number | null = null;
      let avgItems: number | null = null;

      if (n1Sp !== null && n2Sp !== null) {
        avgSp = round2((n1Sp + n2Sp) / 2);
        avgItems = round2(((n1Items ?? 0) + (n2Items ?? 0)) / 2);
      } else if (n1Sp !== null) {
        avgSp = n1Sp;
        avgItems = n1Items;
      } else if (n2Sp !== null) {
        avgSp = n2Sp;
        avgItems = n2Items;
      }

      return {
        name: eng.name,
        role: roleMap.get(eng.name) ?? ("dev" as const),
        sprints_available: sprintsAvailable,
        n1_sp_completed: n1Sp,
        n2_sp_completed: n2Sp,
        avg_sp_completed: avgSp,
        n1_items_completed: n1Items,
        n2_items_completed: n2Items,
        avg_items_completed: avgItems,
      };
    })
    .sort(
      (a, b) => (b.avg_sp_completed ?? 0) - (a.avg_sp_completed ?? 0),
    );
}

function loadConfig(configPath: string): SprintConfig {
  if (!existsSync(configPath)) {
    console.error(`${RED}Config not found: ${configPath}${RESET}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as SprintConfig;
}

// ---------------------------------------------------------------------------
// Engineer load computation (shared logic with sprint-review)
// ---------------------------------------------------------------------------

export function computeEngineerLoad(
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

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function spStr(sp: number | null | undefined): string {
  if (sp === null || sp === undefined) return "N/A";
  return Number.isInteger(sp) ? String(sp) : sp.toFixed(2);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function shortSprintName(name: string, prefix: string): string {
  if (name.startsWith(prefix)) {
    const suffix = name.slice(prefix.length).trim();
    return `Sprint ${suffix}`;
  }
  return name;
}

export function computeCapacityVsVelocity(
  issues: SprintIssue[],
  velocity: VelocitySummary,
  config: SprintConfig,
): CapacityAnalysis {
  const totalSp = round2(issues.reduce((s, i) => s + (i.story_points ?? 0), 0));
  const totalIssues = issues.length;

  const deadItems: DeadItem[] = [];
  for (const i of issues) {
    let reason = "";
    if (isCompleted(i, config)) {
      reason = `Already ${i.resolution || i.status}`;
    } else if (i.resolution === "Duplicate") {
      reason = "Closed as Duplicate";
    }
    if (reason) {
      deadItems.push({
        key: i.key,
        summary: i.summary,
        url: `${config.jira.base_url}/${i.key}`,
        story_points: i.story_points,
        reason,
      });
    }
  }

  const deadSp = round2(
    deadItems.reduce((s, d) => s + (d.story_points ?? 0), 0),
  );
  const effectiveSp = round2(totalSp - deadSp);
  const effectiveIssues = totalIssues - deadItems.length;

  const deltaPct =
    velocity.completed_sp > 0
      ? Math.round(
          ((effectiveSp - velocity.completed_sp) / velocity.completed_sp) * 100,
        )
      : 0;

  let status: "ok" | "warning" | "overcommitted";
  if (deltaPct > 20) {
    status = "overcommitted";
  } else if (deltaPct > 10) {
    status = "warning";
  } else {
    status = "ok";
  }

  return {
    target_sp: totalSp,
    target_issues: totalIssues,
    velocity_sp: velocity.completed_sp,
    velocity_issues: velocity.completed_issues,
    effective_sp: effectiveSp,
    effective_issues: effectiveIssues,
    dead_items: deadItems,
    delta_pct: deltaPct,
    status,
  };
}

export function computeLoadDistribution(
  issues: SprintIssue[],
  velocity: VelocitySummary,
  config: SprintConfig,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
  individualAverages?: IndividualVelocityAverage[],
): LoadDistributionEntry[] {
  const targetLoad = computeEngineerLoad(
    issues,
    config,
    accountIdToName,
    displayToName,
  );

  const velByEngineer = new Map(velocity.by_engineer.map((e) => [e.name, e]));
  const avgByName = individualAverages
    ? new Map(individualAverages.map((a) => [a.name, a]))
    : null;

  const roleMap = new Map(config.engineers.map((e) => [e.name, e.role]));

  return targetLoad.map((t) => {
    const prev = velByEngineer.get(t.name);
    const avg = avgByName?.get(t.name);
    const baselineSp = avg?.avg_sp_completed ?? prev?.sp_completed ?? 0;
    const baselineCompleted =
      avg?.avg_items_completed ?? prev?.completed ?? 0;
    const baselineSprints = avg?.sprints_available ?? (prev ? 1 : 0);
    const totalTargetSp = t.sp_completed + t.sp_remaining;

    let loadRatio: number | null = null;
    if (baselineSp > 0) {
      loadRatio = round2(totalTargetSp / baselineSp);
    }

    const hasPrevData = avg
      ? avg.sprints_available > 0
      : prev !== undefined;

    let risk: "ok" | "heavy" | "extreme" | "absent" | "new";
    if (t.assigned === 0) {
      risk = "absent";
    } else if (!hasPrevData) {
      risk = "new";
    } else if (baselineSp === 0 && totalTargetSp > 0) {
      risk = "extreme";
    } else if (loadRatio !== null && loadRatio > 3) {
      risk = "extreme";
    } else if (loadRatio !== null && loadRatio > 1.5) {
      risk = "heavy";
    } else {
      risk = "ok";
    }

    return {
      name: t.name,
      role: roleMap.get(t.name) ?? "dev",
      target_assigned: t.assigned,
      target_sp: totalTargetSp,
      prev_completed: baselineCompleted,
      prev_sp_completed: baselineSp,
      load_ratio: loadRatio,
      risk,
      baseline_sprints: baselineSprints,
    };
  });
}

export function computeRetroCompliance(
  recommendations: string[],
  issues: SprintIssue[],
  config: SprintConfig,
): RetroComplianceItem[] {
  if (recommendations.length === 0) return [];

  const maxSp = Math.max(
    ...issues
      .filter((i) => !isCompleted(i, config))
      .map((i) => i.story_points ?? 0),
  );
  const oversizedCount = issues.filter(
    (i) => !isCompleted(i, config) && (i.story_points ?? 0) >= 21,
  ).length;
  const largeSp8Count = issues.filter(
    (i) => !isCompleted(i, config) && (i.story_points ?? 0) >= 8,
  ).length;

  return recommendations.map((rec) => {
    const lower = rec.toLowerCase();

    if (lower.includes("decompose") || lower.includes("large item")) {
      if (oversizedCount > 0) {
        return {
          recommendation: rec,
          status: "not_addressed" as const,
          evidence: `${oversizedCount} item(s) >= 21 SP still in sprint (max: ${maxSp} SP)`,
        };
      }
      if (largeSp8Count > 0 && maxSp >= 13) {
        return {
          recommendation: rec,
          status: "partially" as const,
          evidence: `No 21 SP items, but ${largeSp8Count} item(s) >= 8 SP remain (max: ${maxSp} SP)`,
        };
      }
      return {
        recommendation: rec,
        status: "addressed" as const,
        evidence: `Max item size is ${maxSp} SP`,
      };
    }

    if (lower.includes("scope freeze") || lower.includes("scope")) {
      return {
        recommendation: rec,
        status: "unknown" as const,
        evidence: "Cannot verify pre-sprint; monitor during sprint execution",
      };
    }

    if (lower.includes("calibration") || lower.includes("sizing")) {
      return {
        recommendation: rec,
        status: "unknown" as const,
        evidence:
          "Cannot verify from sprint data; check with team if session occurred",
      };
    }

    if (lower.includes("prioritize") && lower.includes("blocker")) {
      const blockerItems = issues.filter(
        (i) =>
          !isCompleted(i, config) &&
          (i.priority === "Blocker" || i.priority === "Critical"),
      );
      if (blockerItems.length === 0) {
        return {
          recommendation: rec,
          status: "addressed" as const,
          evidence: "No Blocker/Critical items in sprint",
        };
      }
      return {
        recommendation: rec,
        status: "unknown" as const,
        evidence: `${blockerItems.length} Blocker/Critical items present; verify they are prioritized in sprint order`,
      };
    }

    return {
      recommendation: rec,
      status: "unknown" as const,
      evidence: "Cannot be verified from sprint data alone",
    };
  });
}

export function computeCarryoverAnalysis(
  issues: SprintIssue[],
  carryoverKeys: string[],
  config: SprintConfig,
  accountIdToName: Map<string, string>,
  displayToName: Map<string, string>,
): CarryoverAnalysisItem[] {
  const keySet = new Set(carryoverKeys);
  return issues
    .filter((i) => keySet.has(i.key))
    .map((i) => ({
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
    }))
    .sort((a, b) => {
      const order: Record<string, number> = {
        Blocker: 0,
        Critical: 1,
        Major: 2,
        Normal: 3,
        Minor: 4,
      };
      return (order[a.priority] ?? 5) - (order[b.priority] ?? 5);
    });
}

export function computePlanningHygiene(
  issues: SprintIssue[],
  config: SprintConfig,
  accountIdToName?: Map<string, string>,
  displayToName?: Map<string, string>,
): HygieneFlag[] {
  const flags: HygieneFlag[] = [];

  const resolveName = (i: SprintIssue): string =>
    (accountIdToName?.get(i.assignee_id) ??
    displayToName?.get(i.assignee_name.toLowerCase()) ??
    i.assignee_name) ||
    "";

  for (const i of issues) {
    const url = `${config.jira.base_url}/${i.key}`;
    const assignee = resolveName(i);

    if (!i.assignee_id && !i.assignee_name) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        kind: "unassigned",
        detail: `${spStr(i.story_points)} SP, ${i.priority} priority`,
        assignee: "",
      });
    }

    if (i.story_points === null && !isCompleted(i, config)) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        kind: "no_sp",
        detail: `${i.priority} priority, assigned to ${i.assignee_name || "Unassigned"}`,
        assignee,
      });
    }

    if (isCompleted(i, config) || i.resolution === "Duplicate") {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        kind: "already_done",
        detail: `Status: ${i.status}, Resolution: ${i.resolution || "none"}`,
        assignee,
      });
    }

    if (
      i.status.toLowerCase().includes("refinement") ||
      i.status.toLowerCase().includes("backlog")
    ) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        kind: "refinement",
        detail: `Status "${i.status}" — not ready for sprint commitment`,
        assignee,
      });
    }

    if (
      i.story_points !== null &&
      i.story_points >= 21 &&
      !isCompleted(i, config)
    ) {
      flags.push({
        key: i.key,
        summary: i.summary,
        url,
        kind: "oversized",
        detail: `${i.story_points} SP — should be decomposed before sprint entry`,
        assignee,
      });
    }
  }

  return flags;
}

export function generateRecommendations(report: PlanningReport): string[] {
  const recs: string[] = [];

  if (report.capacity.dead_items.length > 0) {
    const deadSp = round2(
      report.capacity.dead_items.reduce((s, d) => s + (d.story_points ?? 0), 0),
    );
    const keys = report.capacity.dead_items.map((d) => d.key).join(", ");
    recs.push(
      `**Remove dead items** — ${keys} (${deadSp} SP) are already done/duplicate and inflate sprint metrics`,
    );
  }

  const extremeLoad = report.load.filter((l) => l.risk === "extreme");
  for (const eng of extremeLoad) {
    recs.push(
      `**Rebalance ${eng.name}'s load** — ${eng.target_sp} SP assigned vs. ${eng.prev_sp_completed} SP completed last sprint (${eng.load_ratio !== null ? eng.load_ratio + "x" : "no baseline"})`,
    );
  }

  const heavyLoad = report.load.filter((l) => l.risk === "heavy");
  if (heavyLoad.length > 0) {
    const names = heavyLoad.map((l) => l.name).join(", ");
    recs.push(
      `**Review load for ${names}** — assigned > 2x their previous sprint output`,
    );
  }

  const absent = report.load.filter((l) => l.risk === "absent");
  if (absent.length > 0) {
    const names = absent.map((l) => l.name).join(", ");
    recs.push(
      `**Confirm team roster** — ${names} ha${absent.length > 1 ? "ve" : "s"} zero items in this sprint`,
    );
  }

  const unassigned = report.hygiene.filter((h) => h.kind === "unassigned");
  if (unassigned.length > 0) {
    recs.push(
      `**Assign or defer ${unassigned.length} unassigned item(s)** — ownerless items will likely sit idle`,
    );
  }

  const noSp = report.hygiene.filter((h) => h.kind === "no_sp");
  if (noSp.length > 0) {
    const keys = noSp.map((h) => h.key).join(", ");
    recs.push(
      `**Size ${noSp.length} unsized item(s)** (${keys}) — missing SP prevents capacity planning`,
    );
  }

  const oversized = report.hygiene.filter((h) => h.kind === "oversized");
  if (oversized.length > 0) {
    const keys = oversized.map((h) => h.key).join(", ");
    recs.push(
      `**Decompose oversized item(s)** (${keys}) — 21+ SP items should be broken into smaller deliverables`,
    );
  }

  if (report.capacity.status === "overcommitted") {
    const trimSp = Math.round(
      report.capacity.effective_sp - report.capacity.velocity_sp * 1.1,
    );
    recs.push(
      `**Trim ~${trimSp} SP** to align with proven velocity (~${Math.round(report.capacity.velocity_sp * 1.1)} SP target including 10% stretch)`,
    );
  }

  const notAddressed = report.retro.filter((r) => r.status === "not_addressed");
  if (notAddressed.length > 0) {
    recs.push(
      `**Address retro action items** — ${notAddressed.length} recommendation(s) from last sprint not yet reflected in the plan`,
    );
  }

  return recs;
}

export function generateEngineerProposals(
  report: PlanningReport,
): EngineerProposal[] {
  const hygieneByEngineer = new Map<string, HygieneFlag[]>();
  for (const h of report.hygiene) {
    if (!h.assignee) continue;
    const list = hygieneByEngineer.get(h.assignee) ?? [];
    list.push(h);
    hygieneByEngineer.set(h.assignee, list);
  }

  const carryoverByEngineer = new Map<string, CarryoverAnalysisItem[]>();
  for (const c of report.carryover) {
    if (!c.assignee) continue;
    const list = carryoverByEngineer.get(c.assignee) ?? [];
    list.push(c);
    carryoverByEngineer.set(c.assignee, list);
  }

  const avgByName = new Map(
    report.individualVelocity.map((v) => [v.name, v]),
  );

  return report.load
    .filter((l) => l.target_assigned > 0)
    .map((l) => {
      const actions: string[] = [];
      const avg = avgByName.get(l.name);
      const avgSp = avg?.avg_sp_completed ?? null;

      if (
        l.risk === "extreme" &&
        avgSp !== null &&
        avgSp > 0
      ) {
        const trimTo = Math.round(avgSp);
        const trimBy = Math.round(l.target_sp - avgSp);
        actions.push(
          `Defer or reassign ~${trimBy} SP to reach sustainable load (~${trimTo} SP)`,
        );
      } else if (l.risk === "heavy" && avgSp !== null && avgSp > 0) {
        const trimTo = Math.round(avgSp);
        const trimBy = Math.round(l.target_sp - avgSp);
        actions.push(
          `Consider deferring ~${trimBy} SP to align with your avg output (~${trimTo} SP)`,
        );
      }

      const hygiene = hygieneByEngineer.get(l.name) ?? [];
      const unsized = hygiene.filter((h) => h.kind === "no_sp");
      if (unsized.length > 0) {
        const keys = unsized.map((h) => h.key).join(", ");
        actions.push(
          `Size ${unsized.length} unsized item(s): ${keys}`,
        );
      }

      const oversized = hygiene.filter((h) => h.kind === "oversized");
      for (const h of oversized) {
        actions.push(`Decompose ${h.key} (${h.detail})`);
      }

      const refinement = hygiene.filter((h) => h.kind === "refinement");
      if (refinement.length > 0) {
        const keys = refinement.map((h) => h.key).join(", ");
        actions.push(
          `${refinement.length} item(s) still in refinement — confirm sprint-ready: ${keys}`,
        );
      }

      const carryover = carryoverByEngineer.get(l.name) ?? [];
      if (carryover.length > 0) {
        const carryoverSp = carryover.reduce(
          (s, c) => s + (c.story_points ?? 0),
          0,
        );
        const critical = carryover.filter(
          (c) => c.priority === "Blocker" || c.priority === "Critical",
        );
        if (critical.length > 0) {
          const keys = critical.map((c) => c.key).join(", ");
          actions.push(
            `${critical.length} Critical/Blocker carryover item(s) — prioritize first: ${keys}`,
          );
        }
        actions.push(
          `${carryover.length} carryover items (${carryoverSp} SP) from last sprint — review which to keep vs. defer`,
        );
      }

      if (actions.length === 0) {
        actions.push("Load looks good — no specific actions needed");
      }

      return {
        name: l.name,
        role: l.role,
        target_items: l.target_assigned,
        target_sp: l.target_sp,
        avg_sp: avgSp,
        load_ratio: l.load_ratio,
        risk: l.risk,
        actions,
      };
    });
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatReport(
  sprintName: string,
  date: string,
  velocity: VelocitySummary,
  velocityN2: VelocitySummary | null,
  report: PlanningReport,
  config: SprintConfig,
  warnings: string[],
): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln(`# Sprint Planning Health-Check: ${sprintName}`);
  ln();
  ln(`Analysis generated: ${date}`);
  if (velocityN2) {
    const avgSp = round2(
      (velocity.completed_sp + velocityN2.completed_sp) / 2,
    );
    ln(
      `Velocity baseline: ${velocityN2.sprint_name}, ${velocity.sprint_name} (2-sprint avg: ${spStr(avgSp)} SP completed)`,
    );
  } else {
    ln(
      `Velocity baseline: ${velocity.sprint_name} (${spStr(velocity.completed_sp)} SP completed, ${velocity.completed_issues} of ${velocity.total_issues} issues)`,
    );
  }
  ln();

  // Key Takeaways placeholder
  ln("## Key Takeaways");
  ln();
  ln("<!-- TAKEAWAYS_PLACEHOLDER -->");
  ln("- (takeaways pending)");
  ln();

  // Capacity vs. Velocity
  ln("## Capacity vs. Velocity");
  ln();
  const velocityColHeader = velocityN2
    ? "2-Sprint Avg (Velocity)"
    : "Previous Sprint (Velocity)";
  ln(`| Metric | Target Sprint | ${velocityColHeader} | Delta |`);
  ln("|--------|--------------|---------------------------|-------|");
  ln(
    `| Story Points | ${spStr(report.capacity.target_sp)} | ${spStr(report.capacity.velocity_sp)} | ${report.capacity.delta_pct > 0 ? "+" : ""}${report.capacity.delta_pct}% |`,
  );
  ln(
    `| Issues | ${report.capacity.target_issues} | ${report.capacity.velocity_issues} | ${report.capacity.target_issues > report.capacity.velocity_issues ? "+" : ""}${report.capacity.target_issues - report.capacity.velocity_issues} |`,
  );
  ln();

  if (report.capacity.dead_items.length > 0) {
    const deadSp = round2(
      report.capacity.dead_items.reduce((s, d) => s + (d.story_points ?? 0), 0),
    );
    ln(
      `**Effective load**: ${spStr(report.capacity.effective_sp)} SP / ${report.capacity.effective_issues} issues (after removing ${report.capacity.dead_items.length} already-done/duplicate items totaling ${spStr(deadSp)} SP)`,
    );
    ln();
    ln("| Remove | Key | SP | Reason |");
    ln("|--------|-----|-----|--------|");
    for (const d of report.capacity.dead_items) {
      ln(
        `| Yes | [${d.key}](${d.url}) | ${spStr(d.story_points)} | ${d.reason} |`,
      );
    }
    ln();
  }

  const statusLabel =
    report.capacity.status === "ok"
      ? "On track"
      : report.capacity.status === "warning"
        ? `Slightly above velocity (+${report.capacity.delta_pct}%)`
        : `Overcommitted (+${report.capacity.delta_pct}%)`;
  ln(`**Verdict: ${statusLabel}**`);
  ln();

  // Load Distribution
  const maxBaseline = Math.max(...report.load.map((l) => l.baseline_sprints), 0);
  const baselineLabel = maxBaseline >= 2 ? "Avg" : "Prev";
  ln("## Load Distribution");
  ln();
  ln(
    `| Engineer | Role | Target Items | Target SP | ${baselineLabel} Completed | ${baselineLabel} SP | Load Ratio | Risk |`,
  );
  ln(
    "|----------|------|-------------|-----------|---------------|---------|-----------|------|",
  );
  for (const l of report.load) {
    const ratioStr = l.load_ratio !== null ? `${l.load_ratio}x` : "no baseline";
    const riskStr =
      l.risk === "ok"
        ? "OK"
        : l.risk === "heavy"
          ? "**HIGH**"
          : l.risk === "extreme"
            ? "**EXTREME**"
            : l.risk === "absent"
              ? "**ABSENT**"
              : "New";
    ln(
      `| ${l.name} | ${l.role.toUpperCase()} | ${l.target_assigned} | ${l.target_sp} | ${l.prev_completed} | ${l.prev_sp_completed} | ${ratioStr} | ${riskStr} |`,
    );
  }
  ln();
  if (velocityN2) {
    ln(
      `*Baseline: 2-sprint average (${velocityN2.sprint_name}, ${velocity.sprint_name})*`,
    );
  } else {
    ln(`*Baseline: ${velocity.sprint_name} (1 previous sprint available)*`);
  }
  ln();

  // Individual Velocity
  if (report.individualVelocity.length > 0) {
    const hasN2 = report.individualVelocity.some(
      (v) => v.n2_sp_completed !== null,
    );

    if (hasN2) {
      const n2Full = velocityN2?.sprint_name ?? "Sprint N-2";
      const n1Full = velocity.sprint_name;
      const n2Short = shortSprintName(n2Full, config.sprint_name_prefix);
      const n1Short = shortSprintName(n1Full, config.sprint_name_prefix);
      ln(`## Individual Velocity (2-Sprint Average)`);
      ln();
      ln(`Based on ${n2Full} and ${n1Full}:`);
      ln();
      ln(
        `| Engineer | Role | ${n2Short} SP | ${n1Short} SP | Avg SP | ${n2Short} Items | ${n1Short} Items | Avg Items |`,
      );
      ln(
        "|----------|------|------------|------------|--------|---------------|---------------|-----------|",
      );
      for (const v of report.individualVelocity) {
        ln(
          `| ${v.name} | ${v.role.toUpperCase()} | ${v.n2_sp_completed !== null ? spStr(v.n2_sp_completed) : "-"} | ${v.n1_sp_completed !== null ? spStr(v.n1_sp_completed) : "-"} | ${v.avg_sp_completed !== null ? spStr(v.avg_sp_completed) : "-"} | ${v.n2_items_completed !== null ? v.n2_items_completed : "-"} | ${v.n1_items_completed !== null ? v.n1_items_completed : "-"} | ${v.avg_items_completed !== null ? v.avg_items_completed : "-"} |`,
        );
      }
    } else {
      ln(`## Individual Velocity (1 Sprint Available)`);
      ln();
      ln(
        `Based on ${velocity.sprint_name} (only 1 previous sprint available):`,
      );
      ln();
      ln("| Engineer | Role | SP Completed | Items Completed |");
      ln("|----------|------|-------------|----------------|");
      for (const v of report.individualVelocity) {
        ln(
          `| ${v.name} | ${v.role.toUpperCase()} | ${v.n1_sp_completed !== null ? spStr(v.n1_sp_completed) : "-"} | ${v.n1_items_completed !== null ? v.n1_items_completed : "-"} |`,
        );
      }
    }
    ln();
  }

  // Retro Compliance
  if (report.retro.length > 0) {
    ln("## Retro Compliance");
    ln();
    ln("Recommendations from the previous sprint's retrospective:");
    ln();
    ln("| # | Recommendation | Status | Evidence |");
    ln("|---|---------------|--------|----------|");
    report.retro.forEach((r, idx) => {
      const statusEmoji =
        r.status === "addressed"
          ? "Addressed"
          : r.status === "partially"
            ? "Partially"
            : r.status === "not_addressed"
              ? "**Not addressed**"
              : "Unknown";
      ln(
        `| ${idx + 1} | ${truncate(r.recommendation, 80)} | ${statusEmoji} | ${r.evidence} |`,
      );
    });
    ln();
  }

  // Carryover
  if (report.carryover.length > 0) {
    const carryoverSp = round2(
      report.carryover.reduce((s, c) => s + (c.story_points ?? 0), 0),
    );
    ln("## Carryover from Previous Sprint");
    ln();
    ln(
      `${report.carryover.length} items (${spStr(carryoverSp)} SP) carried over from the previous sprint:`,
    );
    ln();
    ln("| Key | SP | Priority | Status | Assignee | Summary |");
    ln("|-----|-----|---------|--------|----------|---------|");
    for (const c of report.carryover) {
      ln(
        `| [${c.key}](${c.url}) | ${spStr(c.story_points)} | ${c.priority} | ${c.status} | ${c.assignee} | ${truncate(c.summary, 55)} |`,
      );
    }
    ln();
  }

  // Planning Hygiene
  if (report.hygiene.length > 0) {
    ln("## Planning Hygiene");
    ln();

    const counts = {
      unassigned: report.hygiene.filter((h) => h.kind === "unassigned").length,
      no_sp: report.hygiene.filter((h) => h.kind === "no_sp").length,
      already_done: report.hygiene.filter((h) => h.kind === "already_done")
        .length,
      refinement: report.hygiene.filter((h) => h.kind === "refinement").length,
      oversized: report.hygiene.filter((h) => h.kind === "oversized").length,
    };

    const parts: string[] = [];
    if (counts.unassigned > 0) parts.push(`${counts.unassigned} unassigned`);
    if (counts.no_sp > 0) parts.push(`${counts.no_sp} unsized`);
    if (counts.already_done > 0)
      parts.push(`${counts.already_done} already done`);
    if (counts.refinement > 0) parts.push(`${counts.refinement} not refined`);
    if (counts.oversized > 0) parts.push(`${counts.oversized} oversized`);
    ln(`${report.hygiene.length} issues flagged: ${parts.join(", ")}`);
    ln();

    ln("| Key | Flag | Detail | Summary |");
    ln("|-----|------|--------|---------|");
    for (const h of report.hygiene) {
      const kindLabel =
        h.kind === "unassigned"
          ? "Unassigned"
          : h.kind === "no_sp"
            ? "No SP"
            : h.kind === "already_done"
              ? "Already done"
              : h.kind === "refinement"
                ? "Not refined"
                : "Oversized";
      ln(
        `| [${h.key}](${h.url}) | ${kindLabel} | ${h.detail} | ${truncate(h.summary, 50)} |`,
      );
    }
    ln();
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    ln("## Recommendations");
    ln();
    for (const r of report.recommendations) {
      ln(`- ${r}`);
    }
    ln();
  }

  // Per-Engineer Proposals
  if (report.engineerProposals.length > 0) {
    ln("## Per-Engineer Proposals");
    ln();
    for (const p of report.engineerProposals) {
      const riskLabel =
        p.risk === "extreme"
          ? "EXTREME"
          : p.risk === "heavy"
            ? "HIGH"
            : p.risk === "absent"
              ? "ABSENT"
              : p.risk === "new"
                ? "NEW"
                : "OK";
      const avgStr =
        p.avg_sp !== null ? `${spStr(p.avg_sp)} SP avg` : "no baseline";
      const ratioStr =
        p.load_ratio !== null ? ` | ${p.load_ratio}x` : "";
      ln(`### ${p.name} (${p.role.toUpperCase()}) — ${riskLabel}`);
      ln();
      ln(
        `${p.target_items} items / ${p.target_sp} SP target | ${avgStr}${ratioStr}`,
      );
      ln();
      for (const a of p.actions) {
        ln(`- [ ] ${a}`);
      }
      ln();
    }
  }

  // Warnings
  if (warnings.length > 0) {
    ln("## Data Quality Notes");
    ln();
    for (const w of warnings) {
      ln(`- Warning: ${w}`);
    }
    ln();
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Planning context (stdout for agent)
// ---------------------------------------------------------------------------

function printPlanningContext(
  capacity: CapacityAnalysis,
  load: LoadDistributionEntry[],
  retro: RetroComplianceItem[],
  carryover: CarryoverAnalysisItem[],
  hygiene: HygieneFlag[],
  velocity: VelocitySummary,
  velocityN2: VelocitySummary | null,
) {
  const extreme = load.filter((l) => l.risk === "extreme");
  const heavy = load.filter((l) => l.risk === "heavy");
  const absent = load.filter((l) => l.risk === "absent");
  const notAddressed = retro.filter((r) => r.status === "not_addressed");
  const carryoverSp = round2(
    carryover.reduce((s, c) => s + (c.story_points ?? 0), 0),
  );

  console.log(`\n${BOLD}--- Planning Context ---${RESET}`);
  if (velocityN2) {
    const avgSp = round2(
      (velocity.completed_sp + velocityN2.completed_sp) / 2,
    );
    console.log(
      `  Velocity baseline: 2-sprint avg (${velocityN2.sprint_name}: ${spStr(velocityN2.completed_sp)} SP, ${velocity.sprint_name}: ${spStr(velocity.completed_sp)} SP, avg: ${spStr(avgSp)} SP)`,
    );
  } else {
    console.log(
      `  Velocity baseline: ${velocity.sprint_name} (${spStr(velocity.completed_sp)} SP)`,
    );
  }
  console.log(
    `  Capacity: ${spStr(capacity.effective_sp)} SP effective vs ${spStr(capacity.velocity_sp)} SP velocity (${capacity.delta_pct > 0 ? "+" : ""}${capacity.delta_pct}%) — ${capacity.status}`,
  );
  console.log(
    `  Dead items: ${capacity.dead_items.length} (${spStr(round2(capacity.dead_items.reduce((s, d) => s + (d.story_points ?? 0), 0)))} SP)`,
  );
  console.log(
    `  Load risks: ${extreme.length} extreme, ${heavy.length} heavy, ${absent.length} absent`,
  );
  if (extreme.length > 0) {
    console.log(
      `  Top overload: ${extreme[0].name} (${extreme[0].target_sp} SP target, ${extreme[0].prev_sp_completed} SP baseline)`,
    );
  }
  console.log(
    `  Carryover: ${carryover.length} items (${spStr(carryoverSp)} SP)`,
  );
  console.log(
    `  Retro compliance: ${notAddressed.length} not addressed, ${retro.filter((r) => r.status === "unknown").length} unknown`,
  );
  console.log(
    `  Hygiene flags: ${hygiene.length} (${hygiene.filter((h) => h.kind === "unassigned").length} unassigned, ${hygiene.filter((h) => h.kind === "no_sp").length} unsized, ${hygiene.filter((h) => h.kind === "already_done").length} done, ${hygiene.filter((h) => h.kind === "oversized").length} oversized)`,
  );
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
        "Usage: generate-sprint-planning-analysis.ts --date <YYYY-MM-DD> [--target-csv <path>] [--velocity-file <path>] [--velocity-history <path>] [--config <path>] [--output <path>]",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i]!;
    }
  }
  return args;
}

function deriveN2SprintName(
  sprintName: string,
  prefix: string,
): string | null {
  const suffix = sprintName.slice(prefix.length).trim();
  const num = parseInt(suffix, 10);
  if (isNaN(num) || num <= 2) return null;
  return `${prefix} ${num - 2}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date;
  if (!date) {
    console.error(`${RED}--date is required (YYYY-MM-DD)${RESET}`);
    process.exit(1);
  }

  const configPath =
    args.config ??
    resolve(__dirname, "../../sprint-review/data/sprint-config.json");
  const targetCsv =
    args["target-csv"] ?? resolve(__dirname, "../data/cache/sprint-issues.csv");
  const velocityFile =
    args["velocity-file"] ??
    resolve(__dirname, "../data/cache/velocity-summary.json");
  const velocityHistoryFile =
    args["velocity-history"] ??
    resolve(__dirname, "../data/cache/velocity-history.json");
  const config = loadConfig(configPath);
  const accountIdToName = buildAccountIdToName(config);
  const displayToName = buildDisplayToName(config);

  console.log(`${GREEN}Loading sprint planning data...${RESET}`);

  const issues = loadSprintIssues(targetCsv);
  const velocity = loadVelocitySummary(velocityFile);

  const warnings: string[] = [];
  if (issues.length === 0) {
    console.error(
      `${RED}No sprint issues found. Run the agent to fetch data first.${RESET}`,
    );
    process.exit(2);
  }
  if (issues.length < config.thresholds.low_item_warning) {
    warnings.push(
      `Sprint has only ${issues.length} items (threshold: ${config.thresholds.low_item_warning}). Analysis may not be representative.`,
    );
  }

  const sprintName = issues[0]?.sprint_name ?? "Unknown Sprint";

  // Load N-2 velocity from history
  const history = loadVelocityHistory(velocityHistoryFile);
  const n2SprintName = deriveN2SprintName(
    sprintName,
    config.sprint_name_prefix,
  );
  const velocityN2 =
    n2SprintName && history ? (history.sprints[n2SprintName] ?? null) : null;

  if (velocityN2) {
    console.log(
      `${GREEN}Using 2-sprint velocity baseline: ${velocity.sprint_name}, ${velocityN2.sprint_name}${RESET}`,
    );
  } else {
    console.log(
      `${YELLOW}Using single-sprint velocity baseline: ${velocity.sprint_name}${RESET}`,
    );
  }

  // Compute individual velocity averages
  const individualVelocity = computeIndividualVelocityAverages(
    velocity,
    velocityN2,
    config,
  );

  // Run analysis
  const capacity = computeCapacityVsVelocity(issues, velocity, config);
  const load = computeLoadDistribution(
    issues,
    velocity,
    config,
    accountIdToName,
    displayToName,
    individualVelocity,
  );
  const retro = computeRetroCompliance(
    velocity.retro_recommendations,
    issues,
    config,
  );
  const carryover = computeCarryoverAnalysis(
    issues,
    velocity.carryover_keys,
    config,
    accountIdToName,
    displayToName,
  );
  const hygiene = computePlanningHygiene(
    issues,
    config,
    accountIdToName,
    displayToName,
  );

  const planningReport: PlanningReport = {
    capacity,
    load,
    individualVelocity,
    retro,
    carryover,
    hygiene,
    recommendations: [],
    engineerProposals: [],
  };
  planningReport.recommendations = generateRecommendations(planningReport);
  planningReport.engineerProposals = generateEngineerProposals(planningReport);

  // Format report
  const report = formatReport(
    sprintName,
    date,
    velocity,
    velocityN2,
    planningReport,
    config,
    warnings,
  );

  // Write output
  const outputPath =
    args.output ??
    resolve(__dirname, `../data/output/sprint-planning-analysis-${date}.md`);
  writeFileSync(outputPath, report);
  console.log(`${GREEN}Report written to ${outputPath}${RESET}`);

  // Print context for agent
  printPlanningContext(
    capacity,
    load,
    retro,
    carryover,
    hygiene,
    velocity,
    velocityN2,
  );

  // Exit code
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`${YELLOW}Warning: ${w}${RESET}`);
    process.exit(3);
  }
  process.exit(0);
}

const isDirectRun = process.argv[1]?.endsWith(
  "generate-sprint-planning-analysis.ts",
);
if (isDirectRun) main();
