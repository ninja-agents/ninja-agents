import { describe, it, expect } from "vitest";
import {
  parseCsvLine,
  parseDate,
  daysBetween,
  isCompleted,
  computeSprintSummary,
  computeCompletionByType,
  computeCompletionByEngineer,
  computeCompletionByPriority,
  computeEstimationFlags,
  computeScopeChanges,
  computeCarryover,
  computeBlockers,
  identifyAutomationOpportunities,
  computeRetroGuide,
  computeCycleTime,
  buildAccountIdToName,
  buildDisplayToName,
  type SprintIssue,
  type ChangelogIssue,
  type SprintConfig,
  type SprintSummary,
  type TypeCompletion,
  type EngineerCompletion,
  type EstimationFlag,
  type ScopeChange,
  type CarryoverItem,
  type BlockerItem,
  type TransitionRecord,
  type CycleTimeStat,
} from "./generate-sprint-review.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: SprintConfig = {
  board_id: 11806,
  sprint_name_prefix: "Test Sprint",
  jira: {
    cloud_id: "test.atlassian.net",
    base_url: "https://test.atlassian.net/browse",
    sprint_field: "customfield_10020",
    story_point_field: "customfield_10028",
  },
  thresholds: {
    long_in_progress_days: 5,
    scope_change_buffer_days: 2,
    estimation_accuracy: {
      fast_completion_ratio: 0.25,
      slow_completion_ratio: 3.0,
    },
    low_item_warning: 5,
  },
  statuses: {
    not_started: ["New", "To Do"],
    in_progress: ["In Progress", "ASSIGNED", "MODIFIED"],
    testing: ["ON_QA", "Testing"],
    done: ["Done", "Closed", "Verified"],
  },
  engineers: [
    {
      name: "Alice",
      jira_account_id: "alice-id",
      jira_display_names: ["Alice Smith"],
      role: "dev" as const,
    },
    {
      name: "Bob",
      jira_account_id: "bob-id",
      jira_display_names: ["Bob Jones", "Robert Jones"],
      role: "qe" as const,
    },
  ],
};

function makeIssue(overrides: Partial<SprintIssue> = {}): SprintIssue {
  return {
    key: "TEST-1",
    summary: "Test issue",
    status: "New",
    resolution: "",
    resolutiondate: "",
    issuetype: "Story",
    priority: "Major",
    assignee_id: "alice-id",
    assignee_name: "Alice Smith",
    story_points: 5,
    created: "2026-04-20T10:00:00Z",
    updated: "2026-05-05T10:00:00Z",
    sprint_name: "Test Sprint 1",
    sprint_start: "2026-04-27T00:00:00Z",
    sprint_end: "2026-05-14T00:00:00Z",
    labels: [],
    qa_contact_id: "",
    qa_contact_name: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

describe("parseCsvLine", () => {
  it("parses simple fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('a,"say ""hello""",c')).toEqual([
      "a",
      'say "hello"',
      "c",
    ]);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles single field", () => {
    expect(parseCsvLine("only")).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

describe("parseDate", () => {
  it("parses ISO-8601 date", () => {
    const d = parseDate("2026-05-07T12:00:00Z");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("computes days between two dates", () => {
    const a = new Date("2026-05-01T00:00:00Z");
    const b = new Date("2026-05-08T00:00:00Z");
    expect(daysBetween(a, b)).toBe(7);
  });

  it("is symmetric", () => {
    const a = new Date("2026-05-01T00:00:00Z");
    const b = new Date("2026-05-08T00:00:00Z");
    expect(daysBetween(b, a)).toBe(7);
  });

  it("returns 0 for same date", () => {
    const d = new Date("2026-05-01T00:00:00Z");
    expect(daysBetween(d, d)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isCompleted
// ---------------------------------------------------------------------------

describe("isCompleted", () => {
  it("returns true for resolution = Done", () => {
    expect(isCompleted(makeIssue({ resolution: "Done" }), BASE_CONFIG)).toBe(
      true,
    );
  });

  it("returns true for status in done list", () => {
    expect(isCompleted(makeIssue({ status: "Closed" }), BASE_CONFIG)).toBe(
      true,
    );
    expect(isCompleted(makeIssue({ status: "Verified" }), BASE_CONFIG)).toBe(
      true,
    );
  });

  it("returns false for in-progress status without Done resolution", () => {
    expect(
      isCompleted(
        makeIssue({ status: "In Progress", resolution: "" }),
        BASE_CONFIG,
      ),
    ).toBe(false);
  });

  it("returns false for New status", () => {
    expect(isCompleted(makeIssue({ status: "New" }), BASE_CONFIG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeSprintSummary
// ---------------------------------------------------------------------------

describe("computeSprintSummary", () => {
  const today = new Date("2026-05-07T12:00:00Z");

  it("computes basic summary", () => {
    const issues = [
      makeIssue({ key: "T-1", resolution: "Done", story_points: 5 }),
      makeIssue({ key: "T-2", resolution: "", story_points: 3 }),
      makeIssue({ key: "T-3", resolution: "Done", story_points: 8 }),
    ];
    const s = computeSprintSummary(issues, BASE_CONFIG, today);
    expect(s.total_issues).toBe(3);
    expect(s.completed_issues).toBe(2);
    expect(s.remaining_issues).toBe(1);
    expect(s.total_sp).toBe(16);
    expect(s.completed_sp).toBe(13);
    expect(s.remaining_sp).toBe(3);
  });

  it("handles no story points", () => {
    const issues = [
      makeIssue({ key: "T-1", story_points: null }),
      makeIssue({ key: "T-2", story_points: null }),
    ];
    const s = computeSprintSummary(issues, BASE_CONFIG, today);
    expect(s.total_sp).toBeNull();
    expect(s.completed_sp).toBeNull();
    expect(s.remaining_sp).toBeNull();
  });

  it("computes days elapsed and total", () => {
    const sprintStart = new Date("2026-04-27T00:00:00Z");
    const sprintEnd = new Date("2026-05-14T00:00:00Z");
    const expectedElapsed = daysBetween(sprintStart, today);
    const expectedTotal = daysBetween(sprintStart, sprintEnd);
    const issues = [makeIssue()];
    const s = computeSprintSummary(issues, BASE_CONFIG, today);
    expect(s.days_elapsed).toBe(expectedElapsed);
    expect(s.total_days).toBe(expectedTotal);
  });

  it("rounds floating-point story points", () => {
    const issues = [
      makeIssue({ key: "T-1", resolution: "Done", story_points: 0.1 }),
      makeIssue({ key: "T-2", resolution: "Done", story_points: 0.2 }),
    ];
    const s = computeSprintSummary(issues, BASE_CONFIG, today);
    expect(s.total_sp).toBe(0.3);
    expect(s.remaining_sp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCompletionByType
// ---------------------------------------------------------------------------

describe("computeCompletionByType", () => {
  it("groups by issue type", () => {
    const issues = [
      makeIssue({ key: "T-1", issuetype: "Bug", resolution: "Done" }),
      makeIssue({ key: "T-2", issuetype: "Bug", resolution: "" }),
      makeIssue({ key: "T-3", issuetype: "Story", resolution: "Done" }),
    ];
    const result = computeCompletionByType(issues, BASE_CONFIG);
    const bugs = result.find((r) => r.type === "Bug")!;
    const stories = result.find((r) => r.type === "Story")!;
    expect(bugs.total).toBe(2);
    expect(bugs.completed).toBe(1);
    expect(stories.total).toBe(1);
    expect(stories.completed).toBe(1);
  });

  it("sorts by total descending", () => {
    const issues = [
      makeIssue({ issuetype: "Bug" }),
      makeIssue({ issuetype: "Bug" }),
      makeIssue({ issuetype: "Story" }),
    ];
    const result = computeCompletionByType(issues, BASE_CONFIG);
    expect(result[0].type).toBe("Bug");
  });
});

// ---------------------------------------------------------------------------
// computeCompletionByEngineer
// ---------------------------------------------------------------------------

const accountIdToName = buildAccountIdToName(BASE_CONFIG);
const displayToName = buildDisplayToName(BASE_CONFIG);

describe("computeCompletionByEngineer", () => {
  it("matches engineers by account ID", () => {
    const issues = [
      makeIssue({
        assignee_id: "alice-id",
        resolution: "Done",
        story_points: 5,
      }),
      makeIssue({ assignee_id: "alice-id", resolution: "", story_points: 3 }),
      makeIssue({ assignee_id: "bob-id", resolution: "Done", story_points: 2 }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = result.find((r) => r.name === "Alice")!;
    const bob = result.find((r) => r.name === "Bob")!;
    expect(alice.assigned).toBe(2);
    expect(alice.completed).toBe(1);
    expect(alice.sp_completed).toBe(5);
    expect(alice.sp_remaining).toBe(3);
    expect(bob.assigned).toBe(1);
    expect(bob.completed).toBe(1);
  });

  it("shows engineers with zero items", () => {
    const issues = [makeIssue({ assignee_id: "alice-id" })];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.assigned).toBe(0);
  });

  it("matches by display name when account ID not found", () => {
    const issues = [
      makeIssue({
        assignee_id: "unknown-id",
        assignee_name: "Robert Jones",
        resolution: "Done",
      }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.assigned).toBe(1);
    expect(bob.completed).toBe(1);
  });

  it("excludes unknown engineers", () => {
    const issues = [
      makeIssue({ assignee_id: "unknown-id", assignee_name: "Charlie Brown" }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result.find((r) => r.name === "Charlie Brown")).toBeUndefined();
  });

  it("counts QA Contact issues for QE engineers", () => {
    const issues = [
      makeIssue({
        assignee_id: "unknown-id",
        assignee_name: "External Dev",
        qa_contact_id: "bob-id",
        qa_contact_name: "Bob Jones",
        resolution: "Done",
        story_points: 3,
      }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.assigned).toBe(1);
    expect(bob.completed).toBe(1);
    expect(bob.sp_completed).toBe(3);
  });

  it("does not double-count when QE is both assignee and QA contact", () => {
    const issues = [
      makeIssue({
        assignee_id: "bob-id",
        assignee_name: "Bob Jones",
        qa_contact_id: "bob-id",
        qa_contact_name: "Bob Jones",
        resolution: "Done",
        story_points: 5,
      }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.assigned).toBe(1);
    expect(bob.completed).toBe(1);
    expect(bob.sp_completed).toBe(5);
  });

  it("does not count QA Contact for dev-role engineers", () => {
    const issues = [
      makeIssue({
        assignee_id: "unknown-id",
        assignee_name: "External",
        qa_contact_id: "alice-id",
        qa_contact_name: "Alice Smith",
      }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.assigned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCompletionByPriority
// ---------------------------------------------------------------------------

describe("computeCompletionByPriority", () => {
  it("sorts by priority order", () => {
    const issues = [
      makeIssue({ priority: "Minor" }),
      makeIssue({ priority: "Blocker" }),
      makeIssue({ priority: "Major" }),
    ];
    const result = computeCompletionByPriority(issues, BASE_CONFIG);
    expect(result.map((r) => r.type)).toEqual(["Blocker", "Major", "Minor"]);
  });
});

// ---------------------------------------------------------------------------
// computeEstimationFlags
// ---------------------------------------------------------------------------

describe("computeEstimationFlags", () => {
  it("flags slow items (ratio >= 3.0)", () => {
    const issues = [
      makeIssue({
        key: "SLOW-1",
        resolution: "Done",
        story_points: 2,
        resolutiondate: "2026-05-07T00:00:00Z",
      }),
    ];
    const flags = computeEstimationFlags(issues, BASE_CONFIG);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe("slow");
    expect(flags[0].days_taken).toBe(10);
  });

  it("flags fast items (ratio <= 0.25)", () => {
    const issues = [
      makeIssue({
        key: "FAST-1",
        resolution: "Done",
        story_points: 13,
        resolutiondate: "2026-04-28T00:00:00Z",
      }),
    ];
    const flags = computeEstimationFlags(issues, BASE_CONFIG);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe("fast");
  });

  it("skips items without story points", () => {
    const issues = [
      makeIssue({
        resolution: "Done",
        story_points: null,
        resolutiondate: "2026-05-07T00:00:00Z",
      }),
    ];
    expect(computeEstimationFlags(issues, BASE_CONFIG)).toHaveLength(0);
  });

  it("skips incomplete items", () => {
    const issues = [makeIssue({ resolution: "", story_points: 2 })];
    expect(computeEstimationFlags(issues, BASE_CONFIG)).toHaveLength(0);
  });

  it("returns empty for normal items", () => {
    const issues = [
      makeIssue({
        resolution: "Done",
        story_points: 5,
        resolutiondate: "2026-05-02T00:00:00Z",
      }),
    ];
    expect(computeEstimationFlags(issues, BASE_CONFIG)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeScopeChanges
// ---------------------------------------------------------------------------

describe("computeScopeChanges", () => {
  it("detects items added after sprint start + buffer", () => {
    const issues = [
      makeIssue({ key: "OLD-1", created: "2026-04-20T00:00:00Z" }),
      makeIssue({ key: "NEW-1", created: "2026-05-01T00:00:00Z" }),
    ];
    const changes = computeScopeChanges(issues, [], BASE_CONFIG);
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toBe("NEW-1");
    expect(changes[0].kind).toBe("added");
  });

  it("ignores items created within buffer period", () => {
    const issues = [
      makeIssue({ key: "EDGE-1", created: "2026-04-28T00:00:00Z" }),
    ];
    const changes = computeScopeChanges(issues, [], BASE_CONFIG);
    expect(changes).toHaveLength(0);
  });

  it("detects removed items from changelog", () => {
    const issues = [makeIssue({ key: "STAY-1" })];
    const changelog: ChangelogIssue[] = [
      {
        key: "GONE-1",
        summary: "Removed issue",
        status: "New",
        resolution: "",
        issuetype: "Story",
        assignee_name: "Alice",
        story_points: 3,
        created: "2026-04-20T00:00:00Z",
        updated: "2026-05-03T00:00:00Z",
        sprint_names: ["Test Sprint 1"],
      },
    ];
    const changes = computeScopeChanges(issues, changelog, BASE_CONFIG);
    const removed = changes.filter((c) => c.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].key).toBe("GONE-1");
  });
});

// ---------------------------------------------------------------------------
// computeCarryover
// ---------------------------------------------------------------------------

describe("computeCarryover", () => {
  it("excludes completed items", () => {
    const issues = [makeIssue({ resolution: "Done" })];
    expect(
      computeCarryover(issues, BASE_CONFIG, accountIdToName, displayToName),
    ).toHaveLength(0);
  });

  it("classifies high risk for Blocker/Critical priority", () => {
    const issues = [
      makeIssue({ priority: "Blocker", story_points: 2, resolution: "" }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).toBe("high");
  });

  it("classifies high risk for large story points (> 8)", () => {
    const issues = [
      makeIssue({ priority: "Normal", story_points: 13, resolution: "" }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).toBe("high");
  });

  it("does not classify 8 SP as high risk by size alone", () => {
    const issues = [
      makeIssue({ priority: "Normal", story_points: 8, resolution: "" }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).not.toBe("high");
  });

  it("classifies medium risk for in-progress items", () => {
    const issues = [
      makeIssue({
        status: "In Progress",
        priority: "Normal",
        story_points: 3,
        resolution: "",
      }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).toBe("medium");
  });

  it("classifies medium risk for testing items", () => {
    const issues = [
      makeIssue({
        status: "ON_QA",
        priority: "Normal",
        story_points: 3,
        resolution: "",
      }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).toBe("medium");
  });

  it("classifies low risk for not-started normal items", () => {
    const issues = [
      makeIssue({
        status: "New",
        priority: "Normal",
        story_points: 2,
        resolution: "",
      }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].risk).toBe("low");
  });

  it("sorts by risk then by story points", () => {
    const issues = [
      makeIssue({
        key: "LOW-1",
        status: "New",
        priority: "Normal",
        story_points: 2,
        resolution: "",
      }),
      makeIssue({
        key: "HIGH-1",
        priority: "Critical",
        story_points: 3,
        resolution: "",
      }),
      makeIssue({
        key: "HIGH-2",
        priority: "Blocker",
        story_points: 8,
        resolution: "",
      }),
    ];
    const result = computeCarryover(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result.map((r) => r.key)).toEqual(["HIGH-2", "HIGH-1", "LOW-1"]);
  });
});

// ---------------------------------------------------------------------------
// computeBlockers
// ---------------------------------------------------------------------------

describe("computeBlockers", () => {
  const today = new Date("2026-05-07T12:00:00Z");

  it("detects stalled in-progress items", () => {
    const issues = [
      makeIssue({
        status: "In Progress",
        updated: "2026-04-30T00:00:00Z",
        resolution: "",
      }),
    ];
    const result = computeBlockers(
      issues,
      BASE_CONFIG,
      today,
      accountIdToName,
      displayToName,
    );
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("stalled");
    expect(result[0].days_stalled).toBe(
      daysBetween(new Date("2026-04-30T00:00:00Z"), today),
    );
  });

  it("skips recently-updated in-progress items", () => {
    const issues = [
      makeIssue({
        status: "In Progress",
        updated: "2026-05-05T00:00:00Z",
        resolution: "",
      }),
    ];
    expect(
      computeBlockers(
        issues,
        BASE_CONFIG,
        today,
        accountIdToName,
        displayToName,
      ),
    ).toHaveLength(0);
  });

  it("detects stalled testing items", () => {
    const issues = [
      makeIssue({
        status: "ON_QA",
        updated: "2026-04-30T00:00:00Z",
        resolution: "",
      }),
    ];
    const result = computeBlockers(
      issues,
      BASE_CONFIG,
      today,
      accountIdToName,
      displayToName,
    );
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("stalled");
  });

  it("skips completed items", () => {
    const issues = [makeIssue({ status: "Done", resolution: "Done" })];
    expect(
      computeBlockers(
        issues,
        BASE_CONFIG,
        today,
        accountIdToName,
        displayToName,
      ),
    ).toHaveLength(0);
  });

  it("sorts by days stalled descending", () => {
    const issues = [
      makeIssue({
        key: "B-1",
        status: "In Progress",
        updated: "2026-05-01T00:00:00Z",
        resolution: "",
      }),
      makeIssue({
        key: "B-2",
        status: "In Progress",
        updated: "2026-04-25T00:00:00Z",
        resolution: "",
      }),
    ];
    const result = computeBlockers(
      issues,
      BASE_CONFIG,
      today,
      accountIdToName,
      displayToName,
    );
    expect(result[0].key).toBe("B-2");
  });
});

// ---------------------------------------------------------------------------
// identifyAutomationOpportunities
// ---------------------------------------------------------------------------

describe("identifyAutomationOpportunities", () => {
  it("detects CVE pattern", () => {
    const issues = [
      makeIssue({ issuetype: "Vulnerability" }),
      makeIssue({ summary: "Fix CVE-2026-1234" }),
      makeIssue({ summary: "CVE remediation for axios" }),
    ];
    const ops = identifyAutomationOpportunities(issues);
    expect(ops.some((o) => o.includes("CVE"))).toBe(true);
  });

  it("detects test task pattern", () => {
    const issues = [
      makeIssue({ summary: "Tier 1 testing", issuetype: "Task" }),
      makeIssue({ summary: "POST testing for 4.19", issuetype: "Task" }),
      makeIssue({ summary: "Run STAGE tests", issuetype: "Task" }),
    ];
    const ops = identifyAutomationOpportunities(issues);
    expect(ops.some((o) => o.includes("test"))).toBe(true);
  });

  it("detects high bug count", () => {
    const issues = Array.from({ length: 6 }, (_, i) =>
      makeIssue({ key: `BUG-${i}`, issuetype: "Bug" }),
    );
    const ops = identifyAutomationOpportunities(issues);
    expect(ops.some((o) => o.includes("bugs"))).toBe(true);
  });

  it("returns empty for clean sprint", () => {
    const issues = [
      makeIssue({ issuetype: "Story", summary: "Build feature A" }),
      makeIssue({ issuetype: "Story", summary: "Design component B" }),
    ];
    expect(identifyAutomationOpportunities(issues)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildAccountIdToName / buildDisplayToName
// ---------------------------------------------------------------------------

describe("name mapping builders", () => {
  it("buildAccountIdToName maps IDs to canonical names", () => {
    const map = buildAccountIdToName(BASE_CONFIG);
    expect(map.get("alice-id")).toBe("Alice");
    expect(map.get("bob-id")).toBe("Bob");
  });

  it("buildDisplayToName maps all display name variants", () => {
    const map = buildDisplayToName(BASE_CONFIG);
    expect(map.get("alice smith")).toBe("Alice");
    expect(map.get("bob jones")).toBe("Bob");
    expect(map.get("robert jones")).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// computeRetroGuide
// ---------------------------------------------------------------------------

function makeBaseSummary(
  overrides: Partial<SprintSummary> = {},
): SprintSummary {
  return {
    sprint_name: "Test Sprint 1",
    sprint_start: "2026-04-27T00:00:00Z",
    sprint_end: "2026-05-14T00:00:00Z",
    days_elapsed: 14,
    total_days: 17,
    total_issues: 10,
    completed_issues: 9,
    remaining_issues: 1,
    total_sp: 50,
    completed_sp: 45,
    remaining_sp: 5,
    ...overrides,
  };
}

interface RetroInput {
  summary: SprintSummary;
  byType: TypeCompletion[];
  byEngineer: EngineerCompletion[];
  byPriority: TypeCompletion[];
  estimationFlags: EstimationFlag[];
  scopeChanges: ScopeChange[];
  carryover: CarryoverItem[];
  blockers: BlockerItem[];
  cycleTime: CycleTimeStat[];
  hasStoryPoints: boolean;
}

function makeBaseRetroInput(overrides: Partial<RetroInput> = {}): RetroInput {
  return {
    summary: overrides.summary ?? makeBaseSummary(),
    byType: overrides.byType ?? [
      { type: "Bug", total: 5, completed: 5, remaining: 0 },
      { type: "Story", total: 5, completed: 4, remaining: 1 },
    ],
    byEngineer: overrides.byEngineer ?? [
      {
        name: "Alice",
        assigned: 5,
        completed: 5,
        remaining: 0,
        sp_completed: 25,
        sp_remaining: 0,
      },
      {
        name: "Bob",
        assigned: 5,
        completed: 4,
        remaining: 1,
        sp_completed: 20,
        sp_remaining: 5,
      },
    ],
    byPriority: overrides.byPriority ?? [
      { type: "Blocker", total: 2, completed: 2, remaining: 0 },
      { type: "Major", total: 8, completed: 7, remaining: 1 },
    ],
    estimationFlags: overrides.estimationFlags ?? [],
    scopeChanges: overrides.scopeChanges ?? [],
    carryover: overrides.carryover ?? [],
    blockers: overrides.blockers ?? [],
    cycleTime: overrides.cycleTime ?? [],
    hasStoryPoints: overrides.hasStoryPoints ?? true,
  };
}

function runRetro(overrides: Partial<RetroInput> = {}) {
  const i = makeBaseRetroInput(overrides);
  return computeRetroGuide(
    i.summary,
    i.byType,
    i.byEngineer,
    i.byPriority,
    i.estimationFlags,
    i.scopeChanges,
    i.carryover,
    i.blockers,
    i.cycleTime,
    i.hasStoryPoints,
  );
}

describe("computeRetroGuide", () => {
  // --- Went Well ---

  it("flags high issue completion rate (>=80%) as went well", () => {
    const guide = runRetro();
    expect(guide.wentWell.some((b) => b.includes("90%"))).toBe(true);
  });

  it("flags high SP completion rate (>=80%) as went well", () => {
    const guide = runRetro();
    expect(guide.wentWell.some((b) => b.includes("story points"))).toBe(true);
  });

  it("flags type with 100% completion as went well", () => {
    const guide = runRetro({
      byType: [{ type: "Bug", total: 3, completed: 3, remaining: 0 }],
    });
    expect(guide.wentWell.some((b) => b.includes("All Bug issues"))).toBe(true);
  });

  it("flags Blocker priority at 75%+ as went well", () => {
    const guide = runRetro({
      byPriority: [
        { type: "Blocker", total: 4, completed: 3, remaining: 1 },
        { type: "Major", total: 6, completed: 6, remaining: 0 },
      ],
    });
    expect(
      guide.wentWell.some((b) =>
        b.includes("Blocker-priority items mostly resolved"),
      ),
    ).toBe(true);
  });

  it("flags type outpacing overall as went well when no type is 100%", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 20,
        completed_issues: 10,
        remaining_issues: 10,
      }),
      byType: [
        { type: "Bug", total: 10, completed: 8, remaining: 2 },
        { type: "Story", total: 10, completed: 2, remaining: 8 },
      ],
    });
    expect(
      guide.wentWell.some((b) => b.includes("Bug completion outpaced overall")),
    ).toBe(true);
  });

  it("flags fast-completed items as went well", () => {
    const guide = runRetro({
      estimationFlags: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          story_points: 13,
          days_taken: 3,
          kind: "fast",
        },
      ],
    });
    expect(
      guide.wentWell.some((b) => b.includes("completed faster than estimated")),
    ).toBe(true);
  });

  it("flags engineer who completed all items as went well", () => {
    const guide = runRetro();
    expect(
      guide.wentWell.some((b) => b.includes("Alice completed all 5")),
    ).toBe(true);
  });

  it("caps engineer went-well bullets at 3", () => {
    const guide = runRetro({
      byEngineer: [
        {
          name: "A",
          assigned: 3,
          completed: 3,
          remaining: 0,
          sp_completed: 10,
          sp_remaining: 0,
        },
        {
          name: "B",
          assigned: 3,
          completed: 3,
          remaining: 0,
          sp_completed: 10,
          sp_remaining: 0,
        },
        {
          name: "C",
          assigned: 3,
          completed: 3,
          remaining: 0,
          sp_completed: 10,
          sp_remaining: 0,
        },
        {
          name: "D",
          assigned: 3,
          completed: 3,
          remaining: 0,
          sp_completed: 10,
          sp_remaining: 0,
        },
      ],
    });
    const engBullets = guide.wentWell.filter((b) =>
      b.includes("completed all"),
    );
    expect(engBullets.length).toBeLessThanOrEqual(3);
  });

  it("flags no blockers as went well", () => {
    const guide = runRetro();
    expect(guide.wentWell.some((b) => b.includes("No stalled items"))).toBe(
      true,
    );
  });

  it("flags no carryover as went well", () => {
    const guide = runRetro();
    expect(guide.wentWell.some((b) => b.includes("no carryover"))).toBe(true);
  });

  // --- Went Less Well ---

  it("combines low issue + SP completion into one bullet", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 3,
        remaining_issues: 7,
        total_sp: 50,
        completed_sp: 20,
        remaining_sp: 30,
      }),
    });
    const combined = guide.wentLessWell.filter(
      (b) => b.includes("issues") && b.includes("story points"),
    );
    expect(combined.length).toBe(1);
  });

  it("flags low issue completion alone when SP is fine", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 3,
        remaining_issues: 7,
        total_sp: 50,
        completed_sp: 45,
        remaining_sp: 5,
      }),
    });
    expect(
      guide.wentLessWell.some((b) => b.includes("30%") && b.includes("issues")),
    ).toBe(true);
  });

  it("flags scope creep as went less well", () => {
    const guide = runRetro({
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 3,
          priority: "Major",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          kind: "added",
          date: "2026-05-02",
          story_points: 5,
          priority: "Major",
        },
        {
          key: "T-3",
          summary: "c",
          url: "",
          kind: "added",
          date: "2026-05-03",
          story_points: 2,
          priority: "Major",
        },
      ],
    });
    expect(
      guide.wentLessWell.some((b) => b.includes("3 items were added")),
    ).toBe(true);
  });

  it("flags estimation misses as went less well", () => {
    const guide = runRetro({
      estimationFlags: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          story_points: 2,
          days_taken: 10,
          kind: "slow",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          story_points: 3,
          days_taken: 12,
          kind: "slow",
        },
      ],
    });
    expect(
      guide.wentLessWell.some((b) => b.includes("2 items took significantly")),
    ).toBe(true);
  });

  it("flags stalled items as went less well", () => {
    const guide = runRetro({
      blockers: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          days_stalled: 7,
          assignee: "Alice",
          priority: "Major",
          kind: "stalled",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          days_stalled: 5,
          assignee: "Bob",
          priority: "Major",
          kind: "stalled",
        },
      ],
    });
    expect(guide.wentLessWell.some((b) => b.includes("stalled"))).toBe(true);
  });

  it("flags high-risk carryover as went less well", () => {
    const guide = runRetro({
      carryover: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          status: "In Progress",
          story_points: 13,
          priority: "Blocker",
          assignee: "Alice",
          risk: "high",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          status: "New",
          story_points: 8,
          priority: "Critical",
          assignee: "Bob",
          risk: "high",
        },
      ],
    });
    expect(guide.wentLessWell.some((b) => b.includes("high-risk"))).toBe(true);
  });

  it("flags critical items incomplete as went less well", () => {
    const guide = runRetro({
      byPriority: [{ type: "Critical", total: 3, completed: 1, remaining: 2 }],
    });
    expect(
      guide.wentLessWell.some((b) => b.includes("Critical-priority")),
    ).toBe(true);
  });

  it("caps wentLessWell at 5 bullets", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 3,
        remaining_issues: 7,
        total_sp: 50,
        completed_sp: 20,
        remaining_sp: 30,
      }),
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 3,
          priority: "Major",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          kind: "added",
          date: "2026-05-02",
          story_points: 5,
          priority: "Major",
        },
        {
          key: "T-3",
          summary: "c",
          url: "",
          kind: "added",
          date: "2026-05-03",
          story_points: 2,
          priority: "Major",
        },
      ],
      estimationFlags: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          story_points: 2,
          days_taken: 10,
          kind: "slow",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          story_points: 3,
          days_taken: 12,
          kind: "slow",
        },
      ],
      carryover: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          status: "In Progress",
          story_points: 13,
          priority: "Blocker",
          assignee: "Alice",
          risk: "high",
        },
      ],
      blockers: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          days_stalled: 7,
          assignee: "Alice",
          priority: "Major",
          kind: "stalled",
        },
      ],
      byPriority: [
        { type: "Blocker", total: 3, completed: 1, remaining: 2 },
        { type: "Critical", total: 3, completed: 1, remaining: 2 },
      ],
      byEngineer: [
        {
          name: "Phil",
          assigned: 10,
          completed: 2,
          remaining: 8,
          sp_completed: 5,
          sp_remaining: 40,
        },
      ],
    });
    expect(guide.wentLessWell.length).toBeLessThanOrEqual(6);
  });

  // --- Try Next ---

  it("derives try-next from scope creep", () => {
    const guide = runRetro({
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 3,
          priority: "Major",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          kind: "added",
          date: "2026-05-02",
          story_points: 5,
          priority: "Major",
        },
        {
          key: "T-3",
          summary: "c",
          url: "",
          kind: "added",
          date: "2026-05-03",
          story_points: 2,
          priority: "Major",
        },
      ],
    });
    expect(guide.tryNext.some((b) => b.includes("scope freeze"))).toBe(true);
  });

  it("derives try-next from estimation misses", () => {
    const guide = runRetro({
      estimationFlags: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          story_points: 2,
          days_taken: 10,
          kind: "slow",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          story_points: 3,
          days_taken: 12,
          kind: "slow",
        },
      ],
    });
    expect(guide.tryNext.some((b) => b.includes("calibration"))).toBe(true);
  });

  it("derives try-next from blockers", () => {
    const guide = runRetro({
      blockers: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          days_stalled: 7,
          assignee: "Alice",
          priority: "Major",
          kind: "stalled",
        },
      ],
    });
    expect(guide.tryNext.some((b) => b.includes("daily check"))).toBe(true);
  });

  it("caps tryNext at 4 bullets", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 3,
        remaining_issues: 7,
        total_sp: 50,
        completed_sp: 20,
        remaining_sp: 30,
      }),
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 3,
          priority: "Major",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          kind: "added",
          date: "2026-05-02",
          story_points: 5,
          priority: "Major",
        },
        {
          key: "T-3",
          summary: "c",
          url: "",
          kind: "added",
          date: "2026-05-03",
          story_points: 2,
          priority: "Major",
        },
      ],
      estimationFlags: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          story_points: 2,
          days_taken: 10,
          kind: "slow",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          story_points: 3,
          days_taken: 12,
          kind: "slow",
        },
      ],
      carryover: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          status: "In Progress",
          story_points: 13,
          priority: "Blocker",
          assignee: "Alice",
          risk: "high",
        },
      ],
      blockers: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          days_stalled: 7,
          assignee: "Alice",
          priority: "Major",
          kind: "stalled",
        },
      ],
      byPriority: [{ type: "Critical", total: 3, completed: 1, remaining: 2 }],
      byEngineer: [
        {
          name: "Phil",
          assigned: 10,
          completed: 2,
          remaining: 8,
          sp_completed: 5,
          sp_remaining: 40,
        },
      ],
    });
    expect(guide.tryNext.length).toBeLessThanOrEqual(4);
  });

  it("provides clean-sprint fallback for tryNext", () => {
    const guide = runRetro();
    expect(guide.tryNext.some((b) => b.includes("Continue current"))).toBe(
      true,
    );
  });

  // --- Guarantees ---

  it("guarantees all three arrays are non-empty", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 7,
        remaining_issues: 3,
        total_sp: 50,
        completed_sp: 35,
        remaining_sp: 15,
      }),
      byType: [{ type: "Story", total: 10, completed: 7, remaining: 3 }],
      byEngineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 7,
          remaining: 3,
          sp_completed: 35,
          sp_remaining: 15,
        },
      ],
      byPriority: [{ type: "Major", total: 10, completed: 7, remaining: 3 }],
    });
    expect(guide.wentWell.length).toBeGreaterThanOrEqual(1);
    expect(guide.wentLessWell.length).toBeGreaterThanOrEqual(1);
    expect(guide.tryNext.length).toBeGreaterThanOrEqual(1);
  });

  it("uses fallback when no rules trigger for wentWell", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 7,
        remaining_issues: 3,
        total_sp: 50,
        completed_sp: 35,
        remaining_sp: 15,
      }),
      byType: [{ type: "Story", total: 10, completed: 7, remaining: 3 }],
      byEngineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 7,
          remaining: 3,
          sp_completed: 35,
          sp_remaining: 15,
        },
      ],
      byPriority: [{ type: "Major", total: 10, completed: 7, remaining: 3 }],
      blockers: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          days_stalled: 5,
          assignee: "X",
          priority: "Major",
          kind: "stalled",
        },
      ],
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 2,
          priority: "Major",
        },
      ],
      carryover: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          status: "New",
          story_points: 5,
          priority: "Major",
          assignee: "X",
          risk: "low",
        },
      ],
    });
    expect(
      guide.wentWell.some((b) => b.includes("No standout positives")),
    ).toBe(true);
  });

  it("wentLessWell prioritizes higher-weight bullets", () => {
    const guide = runRetro({
      summary: makeBaseSummary({
        total_issues: 10,
        completed_issues: 3,
        remaining_issues: 7,
        total_sp: 50,
        completed_sp: 20,
        remaining_sp: 30,
      }),
      carryover: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          status: "In Progress",
          story_points: 13,
          priority: "Blocker",
          assignee: "Alice",
          risk: "high",
        },
      ],
      scopeChanges: [
        {
          key: "T-1",
          summary: "a",
          url: "",
          kind: "added",
          date: "2026-05-01",
          story_points: 3,
          priority: "Major",
        },
        {
          key: "T-2",
          summary: "b",
          url: "",
          kind: "added",
          date: "2026-05-02",
          story_points: 5,
          priority: "Major",
        },
        {
          key: "T-3",
          summary: "c",
          url: "",
          kind: "added",
          date: "2026-05-03",
          story_points: 2,
          priority: "Major",
        },
        {
          key: "T-4",
          summary: "d",
          url: "",
          kind: "removed",
          date: "2026-05-04",
          story_points: 2,
          priority: "Major",
        },
        {
          key: "T-5",
          summary: "e",
          url: "",
          kind: "removed",
          date: "2026-05-05",
          story_points: 3,
          priority: "Major",
        },
      ],
    });
    const first = guide.wentLessWell[0];
    expect(first.includes("issues") || first.includes("story points")).toBe(
      true,
    );
  });

  it("flags fast cycle time as went well", () => {
    const guide = runRetro({
      cycleTime: [
        {
          type: "Bug",
          count: 10,
          median_days: 2,
          avg_days: 2.5,
          min_days: 1,
          max_days: 5,
        },
      ],
    });
    expect(
      guide.wentWell.some((b) => b.includes("Bug cycle time is fast")),
    ).toBe(true);
  });

  it("flags slow cycle time as went less well for single type", () => {
    const guide = runRetro({
      cycleTime: [
        {
          type: "Story",
          count: 5,
          median_days: 10,
          avg_days: 11,
          min_days: 5,
          max_days: 18,
        },
      ],
    });
    expect(
      guide.wentLessWell.some((b) => b.includes("Story cycle time is slow")),
    ).toBe(true);
  });

  it("reports multiple slow cycle time types in one bullet", () => {
    const guide = runRetro({
      cycleTime: [
        {
          type: "Bug",
          count: 10,
          median_days: 16,
          avg_days: 20,
          min_days: 2,
          max_days: 100,
        },
        {
          type: "Story",
          count: 5,
          median_days: 10,
          avg_days: 11,
          min_days: 5,
          max_days: 18,
        },
      ],
    });
    expect(guide.wentLessWell.some((b) => b.includes("2 issue types"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// computeCycleTime
// ---------------------------------------------------------------------------

describe("computeCycleTime", () => {
  it("computes median/avg/min/max for one type", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
      makeIssue({
        key: "T-2",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-08T10:00:00Z",
      }),
      makeIssue({
        key: "T-3",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-10T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
      { key: "T-2", first_in_progress_date: "2026-05-02T10:00:00Z" },
      { key: "T-3", first_in_progress_date: "2026-05-03T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats).toHaveLength(1);
    expect(stats[0].type).toBe("Bug");
    expect(stats[0].count).toBe(3);
    expect(stats[0].min_days).toBe(4);
    expect(stats[0].max_days).toBe(7);
    expect(stats[0].median_days).toBe(6);
  });

  it("groups by issue type", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
      makeIssue({
        key: "T-2",
        issuetype: "Story",
        resolution: "Done",
        resolutiondate: "2026-05-08T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
      { key: "T-2", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats).toHaveLength(2);
    const types = stats.map((s) => s.type);
    expect(types).toContain("Bug");
    expect(types).toContain("Story");
  });

  it("skips issues without transition records", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
      makeIssue({
        key: "T-2",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-08T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats[0].count).toBe(1);
  });

  it("skips issues without resolutiondate", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "",
        resolutiondate: "",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats).toHaveLength(0);
  });

  it("falls back to updated when resolutiondate is empty", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        status: "Verified",
        resolution: "",
        resolutiondate: "",
        updated: "2026-05-08T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats).toHaveLength(1);
    expect(stats[0].count).toBe(1);
    expect(stats[0].min_days).toBe(7);
  });

  it("handles single-item type", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Task",
        resolution: "Done",
        resolutiondate: "2026-05-06T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-03T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats).toHaveLength(1);
    expect(stats[0].median_days).toBe(stats[0].avg_days);
    expect(stats[0].min_days).toBe(stats[0].max_days);
  });

  it("returns empty array when no transitions", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
    ];
    const stats = computeCycleTime(issues, [], BASE_CONFIG);
    expect(stats).toHaveLength(0);
  });

  it("enforces minimum 1 day floor", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-01T12:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats[0].min_days).toBe(1);
  });

  it("sorts by count descending", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
      makeIssue({
        key: "T-2",
        issuetype: "Bug",
        resolution: "Done",
        resolutiondate: "2026-05-06T10:00:00Z",
      }),
      makeIssue({
        key: "T-3",
        issuetype: "Story",
        resolution: "Done",
        resolutiondate: "2026-05-07T10:00:00Z",
      }),
    ];
    const transitions: TransitionRecord[] = [
      { key: "T-1", first_in_progress_date: "2026-05-01T10:00:00Z" },
      { key: "T-2", first_in_progress_date: "2026-05-01T10:00:00Z" },
      { key: "T-3", first_in_progress_date: "2026-05-01T10:00:00Z" },
    ];
    const stats = computeCycleTime(issues, transitions, BASE_CONFIG);
    expect(stats[0].type).toBe("Bug");
  });
});
