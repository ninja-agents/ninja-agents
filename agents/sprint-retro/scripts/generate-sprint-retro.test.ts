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
  buildAccountIdToName,
  buildDisplayToName,
  type SprintIssue,
  type ChangelogIssue,
  type SprintConfig,
  type TeamConfig,
} from "./generate-sprint-retro.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: SprintConfig = {
  team_config_path: "",
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
    blocked: ["BLOCKED"],
    not_started: ["New", "To Do"],
    in_progress: ["In Progress", "ASSIGNED", "MODIFIED"],
    done: ["Done", "Closed", "Verified"],
  },
};

const BASE_TEAM: TeamConfig = {
  team_name: "Test Team",
  engineers: [
    {
      name: "Alice",
      jira_account_id: "alice-id",
      jira_display_names: ["Alice Smith"],
      role: "dev",
    },
    {
      name: "Bob",
      jira_account_id: "bob-id",
      jira_display_names: ["Bob Jones", "Robert Jones"],
      role: "qe",
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

describe("computeCompletionByEngineer", () => {
  const accountIdToName = buildAccountIdToName(BASE_TEAM);
  const displayToName = buildDisplayToName(BASE_TEAM);

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
      BASE_TEAM,
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
      BASE_TEAM,
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
      BASE_TEAM,
      accountIdToName,
      displayToName,
    );
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.assigned).toBe(1);
    expect(bob.completed).toBe(1);
  });

  it("creates entry for unknown engineers", () => {
    const issues = [
      makeIssue({ assignee_id: "unknown-id", assignee_name: "Charlie Brown" }),
    ];
    const result = computeCompletionByEngineer(
      issues,
      BASE_CONFIG,
      BASE_TEAM,
      accountIdToName,
      displayToName,
    );
    const charlie = result.find((r) => r.name === "Charlie Brown")!;
    expect(charlie.assigned).toBe(1);
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
    expect(computeCarryover(issues, BASE_CONFIG)).toHaveLength(0);
  });

  it("classifies high risk for Blocker/Critical priority", () => {
    const issues = [
      makeIssue({ priority: "Blocker", story_points: 2, resolution: "" }),
    ];
    const result = computeCarryover(issues, BASE_CONFIG);
    expect(result[0].risk).toBe("high");
  });

  it("classifies high risk for large story points (> 5)", () => {
    const issues = [
      makeIssue({ priority: "Normal", story_points: 8, resolution: "" }),
    ];
    const result = computeCarryover(issues, BASE_CONFIG);
    expect(result[0].risk).toBe("high");
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
    const result = computeCarryover(issues, BASE_CONFIG);
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
    const result = computeCarryover(issues, BASE_CONFIG);
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
    const result = computeCarryover(issues, BASE_CONFIG);
    expect(result.map((r) => r.key)).toEqual(["HIGH-2", "HIGH-1", "LOW-1"]);
  });
});

// ---------------------------------------------------------------------------
// computeBlockers
// ---------------------------------------------------------------------------

describe("computeBlockers", () => {
  const today = new Date("2026-05-07T12:00:00Z");

  it("detects blocked items", () => {
    const issues = [makeIssue({ status: "BLOCKED", resolution: "" })];
    const result = computeBlockers(issues, BASE_CONFIG, today);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("blocked");
  });

  it("detects stalled in-progress items", () => {
    const issues = [
      makeIssue({
        status: "In Progress",
        updated: "2026-04-30T00:00:00Z",
        resolution: "",
      }),
    ];
    const result = computeBlockers(issues, BASE_CONFIG, today);
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
    expect(computeBlockers(issues, BASE_CONFIG, today)).toHaveLength(0);
  });

  it("skips completed items even if blocked status", () => {
    const issues = [makeIssue({ status: "Done", resolution: "Done" })];
    expect(computeBlockers(issues, BASE_CONFIG, today)).toHaveLength(0);
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
    const result = computeBlockers(issues, BASE_CONFIG, today);
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
    const map = buildAccountIdToName(BASE_TEAM);
    expect(map.get("alice-id")).toBe("Alice");
    expect(map.get("bob-id")).toBe("Bob");
  });

  it("buildDisplayToName maps all display name variants", () => {
    const map = buildDisplayToName(BASE_TEAM);
    expect(map.get("alice smith")).toBe("Alice");
    expect(map.get("bob jones")).toBe("Bob");
    expect(map.get("robert jones")).toBe("Bob");
  });
});
