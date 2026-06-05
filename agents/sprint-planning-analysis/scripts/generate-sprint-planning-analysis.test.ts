import { describe, it, expect } from "vitest";
import {
  parseCsvLine,
  parseDate,
  daysBetween,
  isCompleted,
  computeEngineerLoad,
  computeCapacityVsVelocity,
  computeLoadDistribution,
  computeRetroCompliance,
  computeCarryoverAnalysis,
  computePlanningHygiene,
  generateRecommendations,
  computeIndividualVelocityAverages,
  generateEngineerProposals,
  buildAccountIdToName,
  buildDisplayToName,
  type SprintIssue,
  type SprintConfig,
  type VelocitySummary,
  type PlanningReport,
  type IndividualVelocityAverage,
} from "./generate-sprint-planning-analysis.js";

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
    sprint_name: "Test Sprint 2",
    sprint_start: "2026-05-15T00:00:00Z",
    sprint_end: "2026-06-01T00:00:00Z",
    labels: [],
    qa_contact_id: "",
    qa_contact_name: "",
    ...overrides,
  };
}

function makeVelocity(
  overrides: Partial<VelocitySummary> = {},
): VelocitySummary {
  return {
    sprint_name: "Test Sprint 1",
    total_issues: 50,
    completed_issues: 40,
    total_sp: 200,
    completed_sp: 160,
    by_engineer: [
      {
        name: "Alice",
        assigned: 20,
        completed: 16,
        sp_completed: 80,
        sp_remaining: 20,
      },
      {
        name: "Bob",
        assigned: 30,
        completed: 24,
        sp_completed: 80,
        sp_remaining: 20,
      },
    ],
    carryover_keys: ["TEST-100", "TEST-101"],
    retro_recommendations: [
      "Decompose large items (8+ SP) before committing",
      "Establish a sprint scope freeze after day 2",
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Utility functions (smoke tests — full coverage in sprint-review)
// ---------------------------------------------------------------------------

describe("parseCsvLine", () => {
  it("parses simple fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
});

describe("parseDate", () => {
  it("parses ISO dates", () => {
    const d = parseDate("2026-05-14T00:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString().startsWith("2026-05-14")).toBe(true);
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("returns correct day count", () => {
    const a = new Date("2026-05-01T00:00:00Z");
    const b = new Date("2026-05-10T00:00:00Z");
    expect(daysBetween(a, b)).toBe(9);
  });
});

describe("isCompleted", () => {
  it("returns true for Done resolution", () => {
    expect(isCompleted(makeIssue({ resolution: "Done" }), BASE_CONFIG)).toBe(
      true,
    );
  });

  it("returns true for done status", () => {
    expect(isCompleted(makeIssue({ status: "Closed" }), BASE_CONFIG)).toBe(
      true,
    );
  });

  it("returns false for in-progress", () => {
    expect(isCompleted(makeIssue({ status: "In Progress" }), BASE_CONFIG)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// computeEngineerLoad
// ---------------------------------------------------------------------------

describe("computeEngineerLoad", () => {
  const accountIdToName = buildAccountIdToName(BASE_CONFIG);
  const displayToName = buildDisplayToName(BASE_CONFIG);

  it("counts assignee items for dev", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 5 }),
      makeIssue({ key: "T-2", assignee_id: "alice-id", story_points: 3 }),
    ];
    const load = computeEngineerLoad(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = load.find((e) => e.name === "Alice")!;
    expect(alice.assigned).toBe(2);
    expect(alice.sp_remaining).toBe(8);
  });

  it("counts QA contact items for QE", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        assignee_id: "alice-id",
        qa_contact_id: "bob-id",
        story_points: 5,
      }),
    ];
    const load = computeEngineerLoad(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = load.find((e) => e.name === "Bob")!;
    expect(bob.assigned).toBe(1);
    expect(bob.sp_remaining).toBe(5);
  });

  it("does not double-count when assignee is also QA contact", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        assignee_id: "bob-id",
        assignee_name: "Bob Jones",
        qa_contact_id: "bob-id",
        story_points: 5,
      }),
    ];
    const load = computeEngineerLoad(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = load.find((e) => e.name === "Bob")!;
    expect(bob.assigned).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeCapacityVsVelocity
// ---------------------------------------------------------------------------

describe("computeCapacityVsVelocity", () => {
  const velocity = makeVelocity({ completed_sp: 100, completed_issues: 40 });

  it("marks ok when within 10% of velocity", () => {
    const issues = [
      makeIssue({ story_points: 50 }),
      makeIssue({ story_points: 55 }),
    ];
    const result = computeCapacityVsVelocity(issues, velocity, BASE_CONFIG);
    expect(result.status).toBe("ok");
    expect(result.target_sp).toBe(105);
  });

  it("marks warning between 10-20% over velocity", () => {
    const issues = Array.from({ length: 3 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 40 }),
    );
    const result = computeCapacityVsVelocity(issues, velocity, BASE_CONFIG);
    expect(result.status).toBe("warning");
    expect(result.delta_pct).toBe(20);
  });

  it("marks overcommitted above 20% over velocity", () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 30 }),
    );
    const result = computeCapacityVsVelocity(issues, velocity, BASE_CONFIG);
    expect(result.status).toBe("overcommitted");
    expect(result.delta_pct).toBe(50);
  });

  it("detects dead items (already done)", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        story_points: 10,
        status: "Closed",
        resolution: "Done",
      }),
      makeIssue({ key: "T-2", story_points: 90 }),
    ];
    const result = computeCapacityVsVelocity(issues, velocity, BASE_CONFIG);
    expect(result.dead_items).toHaveLength(1);
    expect(result.dead_items[0].key).toBe("T-1");
    expect(result.effective_sp).toBe(90);
  });

  it("detects dead items (duplicate resolution)", () => {
    const issues = [
      makeIssue({ key: "T-1", story_points: 21, resolution: "Duplicate" }),
    ];
    const result = computeCapacityVsVelocity(issues, velocity, BASE_CONFIG);
    expect(result.dead_items).toHaveLength(1);
    expect(result.dead_items[0].reason).toBe("Closed as Duplicate");
  });

  it("uses 2-sprint average when velocityN2 provided", () => {
    const vel = makeVelocity({ completed_sp: 100, completed_issues: 40 });
    const velN2 = makeVelocity({
      sprint_name: "Test Sprint 0",
      completed_sp: 200,
      completed_issues: 60,
    });
    const issues = [
      makeIssue({ story_points: 75 }),
      makeIssue({ key: "T-2", story_points: 75 }),
    ];
    const result = computeCapacityVsVelocity(issues, vel, BASE_CONFIG, velN2);
    expect(result.velocity_sp).toBe(150);
    expect(result.velocity_issues).toBe(50);
    expect(result.target_sp).toBe(150);
    expect(result.delta_pct).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("falls back to N-1 when velocityN2 is null", () => {
    const vel = makeVelocity({ completed_sp: 100, completed_issues: 40 });
    const issues = [makeIssue({ story_points: 100 })];
    const result = computeCapacityVsVelocity(issues, vel, BASE_CONFIG, null);
    expect(result.velocity_sp).toBe(100);
    expect(result.velocity_issues).toBe(40);
  });

  it("computes correct overcommit delta with 2-sprint average", () => {
    const vel = makeVelocity({ completed_sp: 126, completed_issues: 26 });
    const velN2 = makeVelocity({
      sprint_name: "Test Sprint 0",
      completed_sp: 290,
      completed_issues: 66,
    });
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 66 }),
    );
    const result = computeCapacityVsVelocity(issues, vel, BASE_CONFIG, velN2);
    expect(result.velocity_sp).toBe(208);
    expect(result.velocity_issues).toBe(46);
    expect(result.status).toBe("overcommitted");
    expect(result.delta_pct).toBe(59);
  });
});

// ---------------------------------------------------------------------------
// computeLoadDistribution
// ---------------------------------------------------------------------------

describe("computeLoadDistribution", () => {
  const accountIdToName = buildAccountIdToName(BASE_CONFIG);
  const displayToName = buildDisplayToName(BASE_CONFIG);

  it("returns ok for reasonable load", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 40 }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 40,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
      ],
    });
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.risk).toBe("ok");
    expect(alice.load_ratio).toBe(1);
  });

  it("flags heavy when load > 1.5x previous", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 100 }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 40,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 5,
          completed: 4,
          sp_completed: 20,
          sp_remaining: 5,
        },
      ],
    });
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.risk).toBe("heavy");
    expect(alice.load_ratio).toBe(2.5);
  });

  it("flags extreme when load > 3x or no previous output", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 100 }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 4,
          completed: 1,
          sp_completed: 8,
          sp_remaining: 20,
        },
        {
          name: "Bob",
          assigned: 5,
          completed: 4,
          sp_completed: 20,
          sp_remaining: 5,
        },
      ],
    });
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.risk).toBe("extreme");
  });

  it("flags absent when engineer has 0 items", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 10 }),
    ];
    const velocity = makeVelocity();
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = load.find((l) => l.name === "Bob")!;
    expect(bob.risk).toBe("absent");
  });

  it("includes QA contact items for QE in load", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        assignee_id: "alice-id",
        qa_contact_id: "bob-id",
        story_points: 5,
      }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 40,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
      ],
    });
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const bob = load.find((l) => l.name === "Bob")!;
    expect(bob.target_assigned).toBe(1);
    expect(bob.target_sp).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeRetroCompliance
// ---------------------------------------------------------------------------

describe("computeRetroCompliance", () => {
  it("flags not_addressed when oversized items exist", () => {
    const issues = [makeIssue({ key: "T-1", story_points: 21 })];
    const result = computeRetroCompliance(
      ["Decompose large items (8+ SP) before committing"],
      issues,
      BASE_CONFIG,
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("not_addressed");
  });

  it("flags addressed when no oversized items", () => {
    const issues = [makeIssue({ key: "T-1", story_points: 5 })];
    const result = computeRetroCompliance(
      ["Decompose large items (8+ SP) before committing"],
      issues,
      BASE_CONFIG,
    );
    expect(result[0].status).toBe("addressed");
  });

  it("flags unknown for scope freeze recommendation", () => {
    const issues = [makeIssue()];
    const result = computeRetroCompliance(
      ["Establish a sprint scope freeze after day 2"],
      issues,
      BASE_CONFIG,
    );
    expect(result[0].status).toBe("unknown");
  });

  it("returns empty for no recommendations", () => {
    const result = computeRetroCompliance([], [makeIssue()], BASE_CONFIG);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeCarryoverAnalysis
// ---------------------------------------------------------------------------

describe("computeCarryoverAnalysis", () => {
  const accountIdToName = buildAccountIdToName(BASE_CONFIG);
  const displayToName = buildDisplayToName(BASE_CONFIG);

  it("identifies matching carryover keys", () => {
    const issues = [
      makeIssue({ key: "TEST-100", priority: "Blocker", story_points: 13 }),
      makeIssue({ key: "TEST-200" }),
    ];
    const result = computeCarryoverAnalysis(
      issues,
      ["TEST-100", "TEST-101"],
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("TEST-100");
  });

  it("returns empty when no carryover keys match", () => {
    const issues = [makeIssue({ key: "TEST-200" })];
    const result = computeCarryoverAnalysis(
      issues,
      ["TEST-100"],
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result).toHaveLength(0);
  });

  it("sorts by priority", () => {
    const issues = [
      makeIssue({ key: "T-2", priority: "Normal" }),
      makeIssue({ key: "T-1", priority: "Blocker" }),
    ];
    const result = computeCarryoverAnalysis(
      issues,
      ["T-1", "T-2"],
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    expect(result[0].key).toBe("T-1");
    expect(result[1].key).toBe("T-2");
  });
});

// ---------------------------------------------------------------------------
// computePlanningHygiene
// ---------------------------------------------------------------------------

describe("computePlanningHygiene", () => {
  it("flags unassigned items", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "", assignee_name: "" }),
    ];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "unassigned")).toBe(true);
  });

  it("flags items without story points", () => {
    const issues = [makeIssue({ key: "T-1", story_points: null })];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "no_sp")).toBe(true);
  });

  it("flags already done items", () => {
    const issues = [
      makeIssue({ key: "T-1", status: "Closed", resolution: "Done" }),
    ];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "already_done")).toBe(true);
  });

  it("flags items in refinement status", () => {
    const issues = [makeIssue({ key: "T-1", status: "Refinement" })];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "refinement")).toBe(true);
  });

  it("flags oversized items (>= 21 SP)", () => {
    const issues = [makeIssue({ key: "T-1", story_points: 21 })];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "oversized")).toBe(true);
  });

  it("does not flag oversized for completed items", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        story_points: 21,
        status: "Closed",
        resolution: "Done",
      }),
    ];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "oversized")).toBe(false);
  });

  it("does not flag no_sp for completed items", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        story_points: null,
        status: "Done",
        resolution: "Done",
      }),
    ];
    const flags = computePlanningHygiene(issues, BASE_CONFIG);
    expect(flags.some((f) => f.kind === "no_sp")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateRecommendations
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  function makeReport(overrides: Partial<PlanningReport> = {}): PlanningReport {
    return {
      capacity: {
        target_sp: 200,
        target_issues: 50,
        velocity_sp: 160,
        velocity_issues: 40,
        effective_sp: 200,
        effective_issues: 50,
        dead_items: [],
        delta_pct: 25,
        status: "overcommitted",
      },
      load: [],
      individualVelocity: [],
      retro: [],
      carryover: [],
      hygiene: [],
      recommendations: [],
      engineerProposals: [],
      ...overrides,
    };
  }

  it("recommends removing dead items", () => {
    const report = makeReport({
      capacity: {
        ...makeReport().capacity,
        dead_items: [
          {
            key: "T-1",
            summary: "Done item",
            url: "https://test/T-1",
            story_points: 21,
            reason: "Already Done",
          },
        ],
      },
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("Remove dead items"))).toBe(true);
  });

  it("recommends rebalancing extreme load", () => {
    const report = makeReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          prev_completed: 1,
          prev_sp_completed: 8,
          load_ratio: 12.5,
          risk: "extreme",
          baseline_sprints: 1,
        },
      ],
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("Rebalance Alice"))).toBe(true);
  });

  it("recommends trimming SP when overcommitted", () => {
    const report = makeReport();
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("Trim"))).toBe(true);
  });

  it("recommends assigning unassigned items", () => {
    const report = makeReport({
      hygiene: [
        {
          key: "T-1",
          summary: "Unowned",
          url: "https://test/T-1",
          kind: "unassigned",
          detail: "2 SP",
        },
      ],
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("unassigned"))).toBe(true);
  });

  it("uses '2-sprint avg' label when baseline_sprints >= 2", () => {
    const report = makeReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: 2.5,
          risk: "extreme",
          baseline_sprints: 2,
        },
      ],
    });
    const recs = generateRecommendations(report);
    const rebalance = recs.find((r) => r.includes("Rebalance Alice"))!;
    expect(rebalance).toContain("2-sprint avg");
    expect(rebalance).not.toContain("last sprint");
  });

  it("uses 'last sprint' label when baseline_sprints is 1", () => {
    const report = makeReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: 2.5,
          risk: "extreme",
          baseline_sprints: 1,
        },
      ],
    });
    const recs = generateRecommendations(report);
    const rebalance = recs.find((r) => r.includes("Rebalance Alice"))!;
    expect(rebalance).toContain("completed last sprint");
  });

  it("recommends addressing retro items", () => {
    const report = makeReport({
      retro: [
        {
          recommendation: "Decompose large items",
          status: "not_addressed",
          evidence: "2 items >= 21 SP",
        },
      ],
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("retro action items"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeIndividualVelocityAverages
// ---------------------------------------------------------------------------

describe("computeIndividualVelocityAverages", () => {
  it("averages SP across two sprints", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
        {
          name: "Bob",
          assigned: 30,
          completed: 24,
          sp_completed: 60,
          sp_remaining: 20,
        },
      ],
    });
    const n2 = makeVelocity({
      sprint_name: "Test Sprint 0",
      by_engineer: [
        {
          name: "Alice",
          assigned: 15,
          completed: 12,
          sp_completed: 60,
          sp_remaining: 15,
        },
        {
          name: "Bob",
          assigned: 25,
          completed: 18,
          sp_completed: 40,
          sp_remaining: 10,
        },
      ],
    });
    const result = computeIndividualVelocityAverages(n1, n2, BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(2);
    expect(alice.n1_sp_completed).toBe(80);
    expect(alice.n2_sp_completed).toBe(60);
    expect(alice.avg_sp_completed).toBe(70);
    expect(alice.avg_items_completed).toBe(14);
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.avg_sp_completed).toBe(50);
    expect(bob.avg_items_completed).toBe(21);
  });

  it("uses N-1 only when N-2 is null", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
        {
          name: "Bob",
          assigned: 30,
          completed: 24,
          sp_completed: 60,
          sp_remaining: 20,
        },
      ],
    });
    const result = computeIndividualVelocityAverages(n1, null, BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(1);
    expect(alice.avg_sp_completed).toBe(80);
    expect(alice.n2_sp_completed).toBeNull();
  });

  it("handles engineer absent from N-2", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
        {
          name: "Bob",
          assigned: 10,
          completed: 8,
          sp_completed: 40,
          sp_remaining: 10,
        },
      ],
    });
    const n2 = makeVelocity({
      sprint_name: "Test Sprint 0",
      by_engineer: [
        {
          name: "Alice",
          assigned: 15,
          completed: 12,
          sp_completed: 60,
          sp_remaining: 15,
        },
      ],
    });
    const result = computeIndividualVelocityAverages(n1, n2, BASE_CONFIG);
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.sprints_available).toBe(1);
    expect(bob.avg_sp_completed).toBe(40);
    expect(bob.n2_sp_completed).toBeNull();
  });

  it("handles engineer absent from both sprints", () => {
    const n1 = makeVelocity({ by_engineer: [] });
    const n2 = makeVelocity({ sprint_name: "Test Sprint 0", by_engineer: [] });
    const result = computeIndividualVelocityAverages(n1, n2, BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(0);
    expect(alice.avg_sp_completed).toBeNull();
  });

  it("includes QE role correctly", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Bob",
          assigned: 30,
          completed: 24,
          sp_completed: 60,
          sp_remaining: 20,
        },
      ],
    });
    const result = computeIndividualVelocityAverages(n1, null, BASE_CONFIG);
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.role).toBe("qe");
  });

  it("sorts by avg_sp_completed descending", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 30,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
      ],
    });
    const result = computeIndividualVelocityAverages(n1, null, BASE_CONFIG);
    expect(result[0].name).toBe("Bob");
    expect(result[1].name).toBe("Alice");
  });
});

// ---------------------------------------------------------------------------
// computeLoadDistribution with averaged baseline
// ---------------------------------------------------------------------------

describe("computeLoadDistribution with individualAverages", () => {
  const accountIdToName = buildAccountIdToName(BASE_CONFIG);
  const displayToName = buildDisplayToName(BASE_CONFIG);

  it("uses averaged SP as baseline when provided", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 70 }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 80,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
      ],
    });
    const averages: IndividualVelocityAverage[] = [
      {
        name: "Alice",
        role: "dev",
        sprints_available: 2,
        n1_sp_completed: 80,
        n2_sp_completed: 60,
        avg_sp_completed: 70,
        n1_items_completed: 16,
        n2_items_completed: 12,
        avg_items_completed: 14,
      },
      {
        name: "Bob",
        role: "qe",
        sprints_available: 2,
        n1_sp_completed: 80,
        n2_sp_completed: 40,
        avg_sp_completed: 60,
        n1_items_completed: 24,
        n2_items_completed: 18,
        avg_items_completed: 21,
      },
    ];
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
      averages,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.prev_sp_completed).toBe(70);
    expect(alice.load_ratio).toBe(1);
    expect(alice.baseline_sprints).toBe(2);
  });

  it("falls back to N-1 when no averages provided", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 40 }),
    ];
    const velocity = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 10,
          completed: 8,
          sp_completed: 40,
          sp_remaining: 10,
        },
        {
          name: "Bob",
          assigned: 20,
          completed: 16,
          sp_completed: 80,
          sp_remaining: 20,
        },
      ],
    });
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.prev_sp_completed).toBe(40);
    expect(alice.load_ratio).toBe(1);
    expect(alice.baseline_sprints).toBe(1);
  });

  it("sets baseline_sprints from individualAverages", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "alice-id", story_points: 10 }),
    ];
    const velocity = makeVelocity();
    const averages: IndividualVelocityAverage[] = [
      {
        name: "Alice",
        role: "dev",
        sprints_available: 1,
        n1_sp_completed: 80,
        n2_sp_completed: null,
        avg_sp_completed: 80,
        n1_items_completed: 16,
        n2_items_completed: null,
        avg_items_completed: 16,
      },
      {
        name: "Bob",
        role: "qe",
        sprints_available: 0,
        n1_sp_completed: null,
        n2_sp_completed: null,
        avg_sp_completed: null,
        n1_items_completed: null,
        n2_items_completed: null,
        avg_items_completed: null,
      },
    ];
    const load = computeLoadDistribution(
      issues,
      velocity,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
      averages,
    );
    const alice = load.find((l) => l.name === "Alice")!;
    expect(alice.baseline_sprints).toBe(1);
    const bob = load.find((l) => l.name === "Bob")!;
    expect(bob.baseline_sprints).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computePlanningHygiene — assignee field
// ---------------------------------------------------------------------------

describe("computePlanningHygiene assignee", () => {
  const accountIdToName = buildAccountIdToName(BASE_CONFIG);
  const displayToName = buildDisplayToName(BASE_CONFIG);

  it("populates assignee from account ID map", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        story_points: null,
        assignee_id: "alice-id",
        assignee_name: "Alice Smith",
      }),
    ];
    const flags = computePlanningHygiene(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const noSp = flags.find((f) => f.kind === "no_sp")!;
    expect(noSp.assignee).toBe("Alice");
  });

  it("sets empty assignee for unassigned items", () => {
    const issues = [
      makeIssue({ key: "T-1", assignee_id: "", assignee_name: "" }),
    ];
    const flags = computePlanningHygiene(
      issues,
      BASE_CONFIG,
      accountIdToName,
      displayToName,
    );
    const unassigned = flags.find((f) => f.kind === "unassigned")!;
    expect(unassigned.assignee).toBe("");
  });
});

// ---------------------------------------------------------------------------
// generateEngineerProposals
// ---------------------------------------------------------------------------

describe("generateEngineerProposals", () => {
  function makeFullReport(
    overrides: Partial<PlanningReport> = {},
  ): PlanningReport {
    return {
      capacity: {
        target_sp: 200,
        target_issues: 50,
        velocity_sp: 160,
        velocity_issues: 40,
        effective_sp: 200,
        effective_issues: 50,
        dead_items: [],
        delta_pct: 25,
        status: "overcommitted",
      },
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: 2.5,
          risk: "heavy",
          baseline_sprints: 2,
        },
        {
          name: "Bob",
          role: "qe",
          target_assigned: 5,
          target_sp: 20,
          prev_completed: 16,
          prev_sp_completed: 60,
          load_ratio: 0.33,
          risk: "ok",
          baseline_sprints: 2,
        },
      ],
      individualVelocity: [
        {
          name: "Alice",
          role: "dev",
          sprints_available: 2,
          n1_sp_completed: 40,
          n2_sp_completed: 40,
          avg_sp_completed: 40,
          n1_items_completed: 8,
          n2_items_completed: 8,
          avg_items_completed: 8,
        },
        {
          name: "Bob",
          role: "qe",
          sprints_available: 2,
          n1_sp_completed: 60,
          n2_sp_completed: 60,
          avg_sp_completed: 60,
          n1_items_completed: 16,
          n2_items_completed: 16,
          avg_items_completed: 16,
        },
      ],
      retro: [],
      carryover: [],
      hygiene: [],
      recommendations: [],
      engineerProposals: [],
      ...overrides,
    };
  }

  it("generates proposals for engineers with items", () => {
    const report = makeFullReport();
    const proposals = generateEngineerProposals(report);
    expect(proposals).toHaveLength(2);
    expect(proposals[0].name).toBe("Alice");
    expect(proposals[1].name).toBe("Bob");
  });

  it("suggests deferring SP for heavy-load engineers", () => {
    const report = makeFullReport();
    const proposals = generateEngineerProposals(report);
    const alice = proposals.find((p) => p.name === "Alice")!;
    expect(alice.actions.some((a) => a.includes("deferring"))).toBe(true);
  });

  it("suggests deferring SP for extreme-load engineers", () => {
    const report = makeFullReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 200,
          prev_completed: 4,
          prev_sp_completed: 40,
          load_ratio: 5,
          risk: "extreme",
          baseline_sprints: 2,
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    const alice = proposals.find((p) => p.name === "Alice")!;
    expect(alice.actions.some((a) => a.includes("Defer or reassign"))).toBe(
      true,
    );
  });

  it("includes unsized items for the engineer", () => {
    const report = makeFullReport({
      hygiene: [
        {
          key: "T-1",
          summary: "Test",
          url: "https://test/T-1",
          kind: "no_sp",
          detail: "Major priority",
          assignee: "Alice",
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    const alice = proposals.find((p) => p.name === "Alice")!;
    expect(alice.actions.some((a) => a.includes("Size 1 unsized"))).toBe(true);
  });

  it("includes carryover summary for the engineer", () => {
    const report = makeFullReport({
      carryover: [
        {
          key: "T-100",
          summary: "Carryover item",
          url: "https://test/T-100",
          status: "In Progress",
          story_points: 5,
          priority: "Critical",
          assignee: "Alice",
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    const alice = proposals.find((p) => p.name === "Alice")!;
    expect(alice.actions.some((a) => a.includes("Critical/Blocker"))).toBe(
      true,
    );
    expect(alice.actions.some((a) => a.includes("carryover"))).toBe(true);
  });

  it("shows OK message for balanced engineers", () => {
    const report = makeFullReport({
      load: [
        {
          name: "Bob",
          role: "qe",
          target_assigned: 5,
          target_sp: 20,
          prev_completed: 16,
          prev_sp_completed: 60,
          load_ratio: 0.33,
          risk: "ok",
          baseline_sprints: 2,
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    const bob = proposals.find((p) => p.name === "Bob")!;
    expect(bob.actions.some((a) => a.includes("looks good"))).toBe(true);
  });

  it("skips engineers with 0 assigned items", () => {
    const report = makeFullReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 0,
          target_sp: 0,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: null,
          risk: "absent",
          baseline_sprints: 2,
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    expect(proposals).toHaveLength(0);
  });
});
