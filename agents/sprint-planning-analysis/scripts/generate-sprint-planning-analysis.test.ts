import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSprintMemberships } from "./sprint-membership.js";
import {
  parseCsvLine,
  loadSprintIssues,
  parseDate,
  daysBetween,
  isCompleted,
  computeEngineerLoad,
  computeCapacityVsVelocity,
  computeLoadDistribution,
  computeRetroCompliance,
  computeCarryoverAnalysis,
  computeMultiSprintReview,
  computePlanningHygiene,
  generateRecommendations,
  computeIndividualVelocityAverages,
  generateEngineerProposals,
  buildAccountIdToName,
  buildDisplayToName,
  formatReport,
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
  board_id: 12345,
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
    sprint_history: null,
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

function makeComputedReport(
  issues: SprintIssue[],
  options: {
    config?: SprintConfig;
    baseline?: number;
    velocities?: VelocitySummary[];
    useAverages?: boolean;
  } = {},
) {
  const config = options.config ?? BASE_CONFIG;
  const baseline = options.baseline ?? 20;
  const velocities = options.velocities ?? [
    makeVelocity({
      completed_sp: baseline,
      completed_issues: 1,
      by_engineer: config.engineers.map((e) => ({
        name: e.name,
        assigned: 1,
        completed: 1,
        sp_completed: baseline,
        sp_remaining: 0,
      })),
      carryover_keys: [],
      retro_recommendations: [],
    }),
  ];
  const accountIds = buildAccountIdToName(config);
  const displayNames = buildDisplayToName(config);
  const individualVelocity =
    options.useAverages === false
      ? []
      : computeIndividualVelocityAverages(velocities, config);
  const velocity = velocities[0] ?? makeVelocity({ by_engineer: [] });
  const report: PlanningReport = {
    capacity: computeCapacityVsVelocity(issues, velocities, config),
    load: computeLoadDistribution(
      issues,
      velocity,
      config,
      accountIds,
      displayNames,
      options.useAverages === false ? undefined : individualVelocity,
    ),
    individualVelocity,
    retro: computeRetroCompliance(velocity.retro_recommendations, issues),
    carryover: computeCarryoverAnalysis(
      issues,
      velocity.carryover_keys,
      config,
      accountIds,
      displayNames,
    ),
    multiSprintReview: computeMultiSprintReview(
      issues,
      config,
      accountIds,
      displayNames,
    ),
    hygiene: computePlanningHygiene(issues, config, accountIds, displayNames),
    recommendations: [],
    engineerProposals: [],
  };
  report.recommendations = generateRecommendations(report);
  report.engineerProposals = generateEngineerProposals(report);
  return { report, velocities, config };
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

describe("sprint membership evidence", () => {
  it("normalizes distinct IDs without filtering state or equal names", () => {
    expect(
      normalizeSprintMemberships([
        { id: 3, name: "Same", state: "active" },
        { id: 1, name: " Past ", state: "closed" },
        { id: 2, name: "Same", state: "future" },
        { id: 1, name: "Past", state: "closed" },
      ]),
    ).toEqual([
      { id: 1, name: "Past", state: "closed" },
      { id: 2, name: "Same", state: "future" },
      { id: 3, name: "Same", state: "active" },
    ]);
    expect(normalizeSprintMemberships([])).toEqual([]);
  });

  it.each([
    null,
    undefined,
    {},
    "[]",
    [null],
    [{ id: 0, name: "Sprint", state: "closed" }],
    [{ id: -1, name: "Sprint", state: "closed" }],
    [{ id: 1.5, name: "Sprint", state: "closed" }],
    [{ id: Number.MAX_SAFE_INTEGER + 1, name: "Sprint", state: "closed" }],
    [{ id: "1", name: "Sprint", state: "closed" }],
    [{ id: 1, name: " ", state: "closed" }],
    [{ id: 1, state: "closed" }],
    [{ id: 1, name: "Sprint" }],
    ...["unknown", "Closed", "", null, 1].map((state) => [
      { id: 1, name: "Sprint", state },
    ]),
    [
      { id: 1, name: "Sprint", state: "closed" },
      { id: 1, name: "Conflict", state: "closed" },
    ],
    [
      { id: 1, name: "Sprint", state: "closed" },
      { id: 1, name: " Sprint ", state: "active" },
    ],
  ])("rejects malformed evidence rather than partial history %j", (value) => {
    expect(normalizeSprintMemberships(value)).toBeNull();
  });

  it("loads old rows, blank, invalid JSON and malformed history as unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "planning-history-"));
    try {
      const file = join(dir, "issues.csv");
      const original = [
        "TEST-1",
        "Summary",
        "Closed",
        "",
        "",
        "Story",
        "Major",
        "alice-id",
        "Alice Smith",
        "0",
        "2026-10-10",
        "2026-10-10",
        "Test Sprint 2",
        "",
        "",
        "",
        "bob-id",
        "Bob Jones",
      ].join(",");
      const escape = (value: unknown) =>
        `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      const historyCells = [
        undefined,
        "",
        "{invalid",
        "{}",
        escape([{ id: 1, name: "Test Sprint 2" }]),
        escape([
          { id: 1, name: "Test Sprint 1", state: "closed" },
          { id: 2, name: "Test Sprint 2" },
        ]),
        "[]",
      ];
      writeFileSync(
        file,
        "header\n" +
          historyCells
            .map((cell) => original + (cell === undefined ? "" : "," + cell))
            .join("\n") +
          "\n",
      );
      const loaded = loadSprintIssues(file);
      expect(loaded.map((issue) => issue.sprint_history)).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
        [],
      ]);
      const expected = makeIssue({
        summary: "Summary",
        status: "Closed",
        story_points: 0,
        created: "2026-10-10",
        updated: "2026-10-10",
        sprint_start: "",
        sprint_end: "",
        qa_contact_id: "bob-id",
        qa_contact_name: "Bob Jones",
      });
      for (const issue of loaded) {
        expect({ ...issue, sprint_history: null }).toEqual(expected);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(isCompleted(makeIssue({ resolution: "Done" }))).toBe(true);
  });

  it("returns false for in-progress", () => {
    expect(isCompleted(makeIssue({ status: "In Progress" }))).toBe(false);
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
    const result = computeCapacityVsVelocity(issues, [velocity], BASE_CONFIG);
    expect(result.status).toBe("ok");
    expect(result.target_sp).toBe(105);
  });

  it("marks warning between 10-20% over velocity", () => {
    const issues = Array.from({ length: 3 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 40 }),
    );
    const result = computeCapacityVsVelocity(issues, [velocity], BASE_CONFIG);
    expect(result.status).toBe("warning");
    expect(result.delta_pct).toBe(20);
  });

  it("marks overcommitted above 20% over velocity", () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 30 }),
    );
    const result = computeCapacityVsVelocity(issues, [velocity], BASE_CONFIG);
    expect(result.status).toBe("overcommitted");
    expect(result.delta_pct).toBe(50);
  });

  it("retains Done target work without recommending removal", () => {
    const issues = [
      makeIssue({
        key: "T-1",
        story_points: 10,
        status: "Closed",
        resolution: "Done",
      }),
      makeIssue({ key: "T-2", story_points: 90 }),
    ];
    const result = computeCapacityVsVelocity(issues, [velocity], BASE_CONFIG);
    expect(result.duplicate_items).toEqual([]);
    expect(result.effective_sp).toBe(90);
  });

  it("detects duplicate removals", () => {
    const issues = [
      makeIssue({ key: "T-1", story_points: 21, resolution: "Duplicate" }),
    ];
    const result = computeCapacityVsVelocity(issues, [velocity], BASE_CONFIG);
    expect(result.duplicate_items).toHaveLength(1);
    expect(result.duplicate_items[0].reason).toBe("Closed as Duplicate");
  });

  it("uses multi-sprint average when multiple velocities provided", () => {
    const velN1 = makeVelocity({ completed_sp: 100, completed_issues: 40 });
    const velN2 = makeVelocity({
      sprint_name: "Test Sprint 0",
      completed_sp: 200,
      completed_issues: 60,
    });
    const issues = [
      makeIssue({ story_points: 75 }),
      makeIssue({ key: "T-2", story_points: 75 }),
    ];
    const result = computeCapacityVsVelocity(
      issues,
      [velN1, velN2],
      BASE_CONFIG,
    );
    expect(result.velocity_sp).toBe(150);
    expect(result.velocity_issues).toBe(50);
    expect(result.target_sp).toBe(150);
    expect(result.delta_pct).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("uses single velocity when only one provided", () => {
    const vel = makeVelocity({ completed_sp: 100, completed_issues: 40 });
    const issues = [makeIssue({ story_points: 100 })];
    const result = computeCapacityVsVelocity(issues, [vel], BASE_CONFIG);
    expect(result.velocity_sp).toBe(100);
    expect(result.velocity_issues).toBe(40);
  });

  it("computes correct 3-sprint average", () => {
    const velN1 = makeVelocity({ completed_sp: 231, completed_issues: 64 });
    const velN2 = makeVelocity({
      sprint_name: "Test Sprint 1",
      completed_sp: 126,
      completed_issues: 26,
    });
    const velN3 = makeVelocity({
      sprint_name: "Test Sprint 0",
      completed_sp: 290,
      completed_issues: 66,
    });
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `T-${i}`, story_points: 66 }),
    );
    const result = computeCapacityVsVelocity(
      issues,
      [velN1, velN2, velN3],
      BASE_CONFIG,
    );
    expect(result.velocity_sp).toBe(215.67);
    expect(result.velocity_issues).toBe(52);
    expect(result.status).toBe("overcommitted");
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
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("not_addressed");
  });

  it("flags addressed when no oversized items", () => {
    const issues = [makeIssue({ key: "T-1", story_points: 5 })];
    const result = computeRetroCompliance(
      ["Decompose large items (8+ SP) before committing"],
      issues,
    );
    expect(result[0].status).toBe("addressed");
  });

  it("flags unknown for scope freeze recommendation", () => {
    const issues = [makeIssue()];
    const result = computeRetroCompliance(
      ["Establish a sprint scope freeze after day 2"],
      issues,
    );
    expect(result[0].status).toBe("unknown");
  });

  it("returns empty for no recommendations", () => {
    const result = computeRetroCompliance([], [makeIssue()]);
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

describe("computeMultiSprintReview", () => {
  const target = { id: 2, name: "Test Sprint 2", state: "future" as const };
  const past = { id: 1, name: "Test Sprint 1", state: "closed" as const };
  const older = { id: 3, name: "Test Sprint 0", state: "closed" as const };
  const started = [past, older];
  const history = [past, target, older];
  const review = (issues: SprintIssue[]) =>
    computeMultiSprintReview(
      issues,
      BASE_CONFIG,
      buildAccountIdToName(BASE_CONFIG),
      buildDisplayToName(BASE_CONFIG),
    );

  it("selects unfinished work across started IDs, not status or SP", () => {
    const issues = [
      makeIssue({
        key: "T-2",
        status: "Closed",
        story_points: null,
        sprint_history: history,
      }),
      makeIssue({
        key: "T-1",
        status: "Verified",
        story_points: 0,
        sprint_history: [
          ...history,
          { id: 4, name: "Test Sprint 1", state: "active" },
        ],
      }),
      makeIssue({ key: "DONE", resolution: "Done", sprint_history: history }),
      makeIssue({
        key: "DUP",
        resolution: "Duplicate",
        sprint_history: history,
      }),
      makeIssue({ key: "SINGLE", sprint_history: [target] }),
      makeIssue({ key: "COPIES", sprint_history: [target, target] }),
      makeIssue({
        key: "MISSING",
        sprint_history: [past, { id: 3, name: "Other", state: "closed" }],
      }),
      makeIssue({ key: "UNKNOWN" }),
    ];
    expect(review(issues)).toEqual([
      {
        key: "T-1",
        summary: "Test issue",
        url: "https://test.atlassian.net/browse/T-1",
        sprints: [
          ...started,
          { id: 4, name: "Test Sprint 1", state: "active" },
        ],
        owners: ["Alice"],
      },
      {
        key: "T-2",
        summary: "Test issue",
        url: "https://test.atlassian.net/browse/T-2",
        sprints: started,
        owners: ["Alice"],
      },
    ]);
  });

  it.each([
    {
      label: "one closed plus future target",
      memberships: [past, target],
      ids: [],
    },
    {
      label: "two closed plus future target",
      memberships: history,
      ids: [1, 3],
    },
    {
      label: "duplicate started ID",
      memberships: [past, past, target],
      ids: [],
    },
    {
      label: "extra future with historical-looking name and dates",
      memberships: [
        past,
        target,
        {
          id: 4,
          name: "Test Sprint 0",
          state: "future" as const,
          startDate: "2000-01-01",
        },
      ],
      ids: [],
    },
    {
      label: "future-only",
      memberships: [target, { ...past, state: "future" as const }],
      ids: [],
    },
    {
      label: "active target despite future-looking date",
      memberships: [
        past,
        { ...target, state: "active" as const, startDate: "2099-01-01" },
      ],
      ids: [1, 2],
    },
    { label: "started history without target", memberships: started, ids: [] },
    {
      label: "extra future cannot inflate two started memberships",
      memberships: [
        ...history,
        { id: 4, name: "Later", state: "future" as const },
      ],
      ids: [1, 3],
    },
  ])("counts explicit lifecycle evidence: $label", ({ memberships, ids }) => {
    const items = review([makeIssue({ sprint_history: memberships })]);
    expect(items.flatMap((item) => item.sprints.map((s) => s.id))).toEqual(ids);
    expect(items.map((item) => item.key)).toEqual(ids.length ? ["TEST-1"] : []);
  });

  it("reuses ID-first assignee and distinct configured-QE ownership", () => {
    const issue = (key: string, overrides: Partial<SprintIssue>) =>
      makeIssue({ key, sprint_history: history, ...overrides });
    const shared = issue("SHARED", {
      assignee_name: "Bob Jones",
      qa_contact_id: "bob-id",
      qa_contact_name: "Alice Smith",
    });
    expect(
      review([
        shared,
        shared,
        issue("ALIAS", {
          assignee_id: "missing",
          assignee_name: "aLiCe SmItH",
          qa_contact_id: "missing",
          qa_contact_name: "rObErT JoNeS",
        }),
        issue("SAME", { assignee_id: "bob-id", qa_contact_id: "bob-id" }),
        issue("NON-QE", { assignee_id: "bob-id", qa_contact_id: "alice-id" }),
        issue("EXTERNAL", {
          assignee_id: "external",
          assignee_name: "External",
          qa_contact_id: "bob-id",
        }),
        issue("UNKNOWN", {
          assignee_id: "external",
          assignee_name: "External",
        }),
      ]).map(({ key, owners }) => ({ key, owners })),
    ).toEqual([
      { key: "ALIAS", owners: ["Alice", "Bob"] },
      { key: "EXTERNAL", owners: ["Bob"] },
      { key: "NON-QE", owners: ["Bob"] },
      { key: "SAME", owners: ["Bob"] },
      { key: "SHARED", owners: ["Alice", "Bob"] },
    ]);
  });

  it("does not mutate issues or alter any pre-existing planning calculation", () => {
    const issues = [
      makeIssue({
        key: "UNFINISHED",
        story_points: 2.5,
        qa_contact_id: "bob-id",
      }),
      makeIssue({ key: "DONE", story_points: 6, resolution: "Done" }),
      makeIssue({ key: "DUP", story_points: 4, resolution: "Duplicate" }),
    ];
    const withHistory = issues.map((issue) => ({
      ...issue,
      sprint_history: history,
    }));
    const futureHistory = withHistory.map((issue) => ({
      ...issue,
      sprint_history: history.map((s) => ({ ...s, state: "future" as const })),
    }));
    const capturedFuture = structuredClone(futureHistory);
    const captured = structuredClone(withHistory);
    const { multiSprintReview: beforeReview, ...before } =
      makeComputedReport(futureHistory).report;
    const { multiSprintReview: afterReview, ...after } =
      makeComputedReport(withHistory).report;
    expect(beforeReview).toEqual([]);
    expect(afterReview.map((item) => item.key)).toEqual(["UNFINISHED"]);
    expect(after).toEqual(before);
    expect(withHistory).toEqual(captured);
    expect(futureHistory).toEqual(capturedFuture);
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

  it("retains Done work without hygiene flags", () => {
    const issues = [
      makeIssue({ key: "T-1", status: "Closed", resolution: "Done" }),
    ];
    expect(computePlanningHygiene(issues, BASE_CONFIG)).toEqual([]);
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
        completed_sp: 0,
        completed_issues: 0,
        recommended_sp: 160,
        velocity_sp: 160,
        velocity_issues: 40,
        effective_sp: 200,
        effective_issues: 50,
        duplicate_items: [],
        delta_pct: 25,
        status: "overcommitted",
      },
      load: [],
      individualVelocity: [],
      retro: [],
      carryover: [],
      multiSprintReview: [],
      hygiene: [],
      recommendations: [],
      engineerProposals: [],
      ...overrides,
    };
  }

  it("recommends removing duplicates", () => {
    const report = makeReport({
      capacity: computeCapacityVsVelocity(
        [makeIssue({ key: "T-1", resolution: "Duplicate", story_points: 21 })],
        [makeVelocity()],
        BASE_CONFIG,
      ),
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("Remove") && r.includes("T-1"))).toBe(
      true,
    );
  });

  it("recommends rebalancing extreme load", () => {
    const report = makeReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          completed_sp: 0,
          remaining_sp: 100,
          recommended_sp: 8,
          prev_completed: 1,
          prev_sp_completed: 8,
          load_ratio: 12.5,
          risk: "extreme",
          baseline_sprints: 1,
          capacity_pct: 1,
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
          assignee: "",
        },
      ],
    });
    const recs = generateRecommendations(report);
    expect(recs.some((r) => r.includes("unassigned"))).toBe(true);
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
  it("averages SP across multiple sprints", () => {
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
    const result = computeIndividualVelocityAverages([n1, n2], BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(2);
    expect(alice.per_sprint_sp).toEqual([80, 60]);
    expect(alice.avg_sp_completed).toBe(70);
    expect(alice.avg_items_completed).toBe(14);
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.avg_sp_completed).toBe(50);
    expect(bob.avg_items_completed).toBe(21);
  });

  it("computes 3-sprint average correctly", () => {
    const n1 = makeVelocity({
      by_engineer: [
        {
          name: "Alice",
          assigned: 20,
          completed: 16,
          sp_completed: 90,
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
    const n3 = makeVelocity({
      sprint_name: "Test Sprint -1",
      by_engineer: [
        {
          name: "Alice",
          assigned: 18,
          completed: 14,
          sp_completed: 30,
          sp_remaining: 20,
        },
      ],
    });
    const result = computeIndividualVelocityAverages([n1, n2, n3], BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(3);
    expect(alice.per_sprint_sp).toEqual([90, 60, 30]);
    expect(alice.avg_sp_completed).toBe(60);
    expect(alice.avg_items_completed).toBe(14);
  });

  it("uses only available sprints when one is provided", () => {
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
    const result = computeIndividualVelocityAverages([n1], BASE_CONFIG);
    const alice = result.find((r) => r.name === "Alice")!;
    expect(alice.sprints_available).toBe(1);
    expect(alice.avg_sp_completed).toBe(80);
    expect(alice.per_sprint_sp).toEqual([80]);
  });

  it("handles engineer absent from some sprints", () => {
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
    const result = computeIndividualVelocityAverages([n1, n2], BASE_CONFIG);
    const bob = result.find((r) => r.name === "Bob")!;
    expect(bob.sprints_available).toBe(1);
    expect(bob.avg_sp_completed).toBe(40);
    expect(bob.per_sprint_sp).toEqual([40, null]);
  });

  it("handles engineer absent from all sprints", () => {
    const n1 = makeVelocity({ by_engineer: [] });
    const n2 = makeVelocity({ sprint_name: "Test Sprint 0", by_engineer: [] });
    const result = computeIndividualVelocityAverages([n1, n2], BASE_CONFIG);
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
    const result = computeIndividualVelocityAverages([n1], BASE_CONFIG);
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
    const result = computeIndividualVelocityAverages([n1], BASE_CONFIG);
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
        per_sprint_sp: [80, 60],
        per_sprint_items: [16, 12],
        avg_sp_completed: 70,
        avg_items_completed: 14,
      },
      {
        name: "Bob",
        role: "qe",
        sprints_available: 2,
        per_sprint_sp: [80, 40],
        per_sprint_items: [24, 18],
        avg_sp_completed: 60,
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
        per_sprint_sp: [80],
        per_sprint_items: [16],
        avg_sp_completed: 80,
        avg_items_completed: 16,
      },
      {
        name: "Bob",
        role: "qe",
        sprints_available: 0,
        per_sprint_sp: [null],
        per_sprint_items: [null],
        avg_sp_completed: null,
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
        completed_sp: 0,
        completed_issues: 0,
        recommended_sp: 160,
        velocity_sp: 160,
        velocity_issues: 40,
        effective_sp: 200,
        effective_issues: 50,
        duplicate_items: [],
        delta_pct: 25,
        status: "overcommitted",
      },
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 10,
          target_sp: 100,
          completed_sp: 0,
          remaining_sp: 100,
          recommended_sp: 40,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: 2.5,
          risk: "heavy",
          baseline_sprints: 2,
          capacity_pct: 1,
        },
        {
          name: "Bob",
          role: "qe",
          target_assigned: 5,
          target_sp: 20,
          completed_sp: 0,
          remaining_sp: 20,
          recommended_sp: 60,
          prev_completed: 16,
          prev_sp_completed: 60,
          load_ratio: 0.33,
          risk: "ok",
          baseline_sprints: 2,
          capacity_pct: 1,
        },
      ],
      individualVelocity: [
        {
          name: "Alice",
          role: "dev",
          sprints_available: 2,
          per_sprint_sp: [40, 40],
          per_sprint_items: [8, 8],
          avg_sp_completed: 40,
          avg_items_completed: 8,
        },
        {
          name: "Bob",
          role: "qe",
          sprints_available: 2,
          per_sprint_sp: [60, 60],
          per_sprint_items: [16, 16],
          avg_sp_completed: 60,
          avg_items_completed: 16,
        },
      ],
      retro: [],
      carryover: [],
      multiSprintReview: [],
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
          completed_sp: 0,
          remaining_sp: 200,
          recommended_sp: 40,
          prev_completed: 4,
          prev_sp_completed: 40,
          load_ratio: 5,
          risk: "extreme",
          baseline_sprints: 2,
          capacity_pct: 1,
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

  it("skips engineers with 0 assigned items", () => {
    const report = makeFullReport({
      load: [
        {
          name: "Alice",
          role: "dev",
          target_assigned: 0,
          target_sp: 0,
          completed_sp: 0,
          remaining_sp: 0,
          recommended_sp: 40,
          prev_completed: 8,
          prev_sp_completed: 40,
          load_ratio: null,
          risk: "absent",
          baseline_sprints: 2,
          capacity_pct: 1,
        },
      ],
    });
    const proposals = generateEngineerProposals(report);
    expect(proposals).toHaveLength(0);
  });
});

describe("target-sprint completed-work credit", () => {
  it.each([
    {
      baseline: 20,
      done: 6,
      remaining: 20,
      capacity: 1,
      recommended: 26,
      ratio: 1,
      risk: "ok",
      defer: 0,
    },
    {
      baseline: 20,
      done: 40,
      remaining: 20,
      capacity: 1,
      recommended: 60,
      ratio: 1,
      risk: "ok",
      defer: 0,
    },
    {
      baseline: 20,
      done: 6,
      remaining: 30,
      capacity: 1,
      recommended: 26,
      ratio: 1.5,
      risk: "heavy",
      defer: 10,
    },
    {
      baseline: 20,
      done: 6,
      remaining: 20,
      capacity: 0.5,
      recommended: 16,
      ratio: 2,
      risk: "heavy",
      defer: 10,
    },
    {
      baseline: 20.25,
      done: 6,
      remaining: 20.25,
      capacity: 1,
      recommended: 26.25,
      ratio: 1,
      risk: "ok",
      defer: 0,
    },
  ])(
    "recommends $recommended total for $done Done + $remaining unfinished at $capacity capacity",
    (c) => {
      const issues = [
        makeIssue({
          key: "DONE",
          resolution: "Done",
          status: "Closed",
          story_points: c.done,
          resolutiondate: "2026-05-14T10:00:00Z",
        }),
        makeIssue({ key: "OPEN", story_points: c.remaining }),
      ];
      const config: SprintConfig = {
        ...BASE_CONFIG,
        pto: {
          "Test Sprint 2": {
            normal_sprint_workdays: 10,
            actual_sprint_workdays: 10,
            engineer_pto: [
              {
                name: "Alice",
                dates: "2026-05-15 to 2026-05-19",
                workdays_out: (1 - c.capacity) * 10,
                workdays_available: c.capacity * 10,
              },
            ],
          },
        },
      };
      const { report } = makeComputedReport(issues, {
        config,
        baseline: c.baseline,
      });
      const alice = report.load.find((l) => l.name === "Alice")!;
      expect(alice).toMatchObject({
        target_sp: c.done + c.remaining,
        completed_sp: c.done,
        remaining_sp: c.remaining,
        recommended_sp: c.recommended,
        prev_sp_completed: c.baseline,
        load_ratio: c.ratio,
        risk: c.risk,
      });
      expect(report.capacity).toMatchObject({
        target_sp: c.done + c.remaining,
        target_issues: 2,
        completed_sp: c.done,
        completed_issues: 1,
        effective_sp: c.remaining,
        effective_issues: 1,
        velocity_sp: c.baseline,
        recommended_sp: c.baseline + c.done,
        duplicate_items: [],
      });
      const proposal = report.engineerProposals.find(
        (p) => p.name === "Alice",
      )!;
      expect(proposal.avg_sp).toBe(c.baseline);
      expect(proposal.load_ratio).toBe(c.ratio);
      if (c.defer > 0) {
        expect(
          proposal.actions.some((a) =>
            a.includes(`~${c.defer} SP of unfinished work`),
          ),
        ).toBe(true);
      } else {
        expect(proposal.actions.some((a) => /defer|reassign/i.test(a))).toBe(
          false,
        );
      }
      expect(report.recommendations.some((r) => /Remove/.test(r))).toBe(false);
      expect(report.hygiene.some((h) => h.key === "DONE")).toBe(false);
    },
  );

  it.each([
    { status: "Verified", resolution: "" },
    { status: "Closed", resolution: "" },
    { status: "Closed", resolution: "Done-Errata" },
  ])(
    "$status/$resolution stays unfinished without Done resolution",
    (state) => {
      const { report } = makeComputedReport([
        makeIssue({ ...state, story_points: 8 }),
      ]);
      expect(report.capacity.completed_sp).toBe(0);
      expect(report.capacity.completed_issues).toBe(0);
      expect(report.capacity.effective_sp).toBe(8);
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        completed_sp: 0,
        remaining_sp: 8,
        target_sp: 8,
        recommended_sp: 20,
        load_ratio: 0.4,
      });
    },
  );

  it("excludes duplicates from eligible ownership and removes only duplicates", () => {
    const { report } = makeComputedReport([
      makeIssue({
        key: "DUP",
        resolution: "Duplicate",
        status: "Verified",
        story_points: 8,
        qa_contact_id: "bob-id",
      }),
      makeIssue({ key: "DONE", resolution: "Done", story_points: 6 }),
    ]);
    expect(report.capacity).toMatchObject({
      target_sp: 14,
      completed_sp: 6,
      effective_sp: 0,
      effective_issues: 0,
    });
    expect(report.capacity.duplicate_items.map((i) => i.key)).toEqual(["DUP"]);
    expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
      target_assigned: 1,
      target_sp: 6,
      completed_sp: 6,
      remaining_sp: 0,
    });
    expect(report.load.find((l) => l.name === "Bob")).toMatchObject({
      target_assigned: 0,
      target_sp: 0,
      completed_sp: 0,
      remaining_sp: 0,
    });
    expect(report.hygiene.map((h) => [h.key, h.kind])).toEqual([
      ["DUP", "duplicate"],
    ]);
    const removal = report.recommendations.find((r) => r.includes("Remove"))!;
    expect(removal).toContain("DUP");
    expect(removal).not.toContain("DONE");
  });

  it("credits distinct QE ownership once per engineer, but once per issue for the team", () => {
    const done = makeIssue({
      resolution: "Done",
      story_points: 6,
      qa_contact_id: "bob-id",
      qa_contact_name: "Robert Jones",
    });
    const byId = makeComputedReport([done]).report;
    const byDisplay = makeComputedReport([
      { ...done, assignee_id: "", qa_contact_id: "" },
    ]).report;
    for (const report of [byId, byDisplay]) {
      expect(report.capacity.completed_sp).toBe(6);
      expect(report.capacity.completed_issues).toBe(1);
      for (const name of ["Alice", "Bob"]) {
        expect(report.load.find((l) => l.name === name)).toMatchObject({
          completed_sp: 6,
          recommended_sp: 26,
          target_assigned: 1,
        });
      }
    }
    const sameOwner = makeComputedReport([
      { ...done, assignee_id: "bob-id", assignee_name: "Bob Jones" },
    ]).report;
    expect(sameOwner.load.find((l) => l.name === "Bob")).toMatchObject({
      completed_sp: 6,
      target_assigned: 1,
    });
    const devQa = makeComputedReport([
      {
        ...done,
        assignee_id: "external-id",
        assignee_name: "External",
        qa_contact_id: "alice-id",
        qa_contact_name: "Alice Smith",
      },
    ]).report;
    expect(devQa.load.find((l) => l.name === "Alice")?.completed_sp).toBe(0);
    expect(devQa.capacity.completed_sp).toBe(6);
  });

  it("gives null-SP Done zero credit and warns only for unsized unfinished work", () => {
    const { report } = makeComputedReport([
      makeIssue({
        key: "DONE",
        resolution: "Done",
        story_points: null,
        status: "Backlog",
        assignee_id: "",
        assignee_name: "",
      }),
      makeIssue({ key: "OPEN", story_points: null, status: "Verified" }),
      makeIssue({
        key: "DUP",
        resolution: "Duplicate",
        story_points: null,
        status: "Refinement",
        assignee_id: "",
        assignee_name: "",
      }),
    ]);
    expect(report.capacity).toMatchObject({
      completed_sp: 0,
      completed_issues: 1,
      effective_sp: 0,
      effective_issues: 1,
    });
    expect(report.hygiene.map((h) => [h.key, h.kind])).toEqual([
      ["OPEN", "no_sp"],
      ["DUP", "duplicate"],
    ]);
  });

  it.each([
    { baseline: 0, capacity: 1, remaining: 0, risk: "ok" },
    { baseline: 0, capacity: 1, remaining: 8, risk: "extreme" },
    { baseline: 20, capacity: 0, remaining: 0, risk: "ok" },
    { baseline: 20, capacity: 0, remaining: 8, risk: "extreme" },
  ])(
    "keeps completed-only load safe at baseline $baseline/capacity $capacity, remaining $remaining",
    (c) => {
      const config: SprintConfig = {
        ...BASE_CONFIG,
        pto: {
          "Test Sprint 2": {
            normal_sprint_workdays: 10,
            actual_sprint_workdays: 10,
            engineer_pto: [
              {
                name: "Alice",
                dates: "",
                workdays_out: 10 * (1 - c.capacity),
                workdays_available: 10 * c.capacity,
              },
            ],
          },
        },
      };
      const issues = [makeIssue({ resolution: "Done", story_points: 6 })];
      if (c.remaining)
        issues.push(makeIssue({ key: "OPEN", story_points: c.remaining }));
      const { report } = makeComputedReport(issues, {
        config,
        baseline: c.baseline,
      });
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        risk: c.risk,
        completed_sp: 6,
        recommended_sp: 6,
        load_ratio: null,
      });
      const actions = report.engineerProposals[0].actions;
      expect(actions.some((a) => /defer|reassign/i.test(a))).toBe(
        c.remaining > 0,
      );
      if (c.remaining)
        expect(
          actions.some((a) => a.includes("~8 SP of unfinished work")),
        ).toBe(true);
    },
  );

  it("does not claim sustainable capacity or emit a DM when history is missing", () => {
    const { report, velocities, config } = makeComputedReport(
      [
        makeIssue({ resolution: "Done", story_points: 6 }),
        makeIssue({ key: "OPEN", story_points: 20 }),
      ],
      { velocities: [] },
    );
    expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
      risk: "new",
      baseline_sprints: 0,
      completed_sp: 6,
    });
    expect(report.engineerProposals[0].avg_sp).toBeNull();
    const text = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      velocities,
      report,
      config,
      [],
    );
    expect(text).toContain("Already done in target sprint: 6 SP");
    expect(text).toContain("Recommended total SP: no baseline");
    expect(text).not.toContain("> From the planning agent");
    const loadRow = text
      .split("\n")
      .find((line) => line.startsWith("| Alice | DEV | 2 |"))!;
    expect(
      loadRow
        .split("|")
        .map((v) => v.trim())
        .slice(9, 12),
    ).toEqual(["no baseline", "no baseline", "New"]);
  });

  it("uses single-sprint fallback capacity in proposals when average rows are absent", () => {
    const { report } = makeComputedReport(
      [
        makeIssue({ resolution: "Done", story_points: 6 }),
        makeIssue({ key: "OPEN", story_points: 30 }),
      ],
      { useAverages: false },
    );
    expect(report.engineerProposals[0]).toMatchObject({
      avg_sp: 20,
      load_ratio: 1.5,
      risk: "heavy",
    });
    expect(
      report.engineerProposals[0].actions.some((a) =>
        a.includes("~10 SP of unfinished work"),
      ),
    ).toBe(true);
  });

  it("uses 10% stretch only on remaining team capacity", () => {
    const { report } = makeComputedReport([
      makeIssue({ resolution: "Done", story_points: 6 }),
      makeIssue({ key: "OPEN", story_points: 30 }),
    ]);
    const trim = report.recommendations.find((r) => r.includes("Trim"))!;
    expect(trim).toContain("~8 SP of unfinished work");
    expect(trim).toContain("28 SP total allowance");
    expect(trim).toContain("6 already done + 22 remaining");
    const review = report.recommendations.find((r) =>
      r.includes("Review load"),
    )!;
    expect(review).toContain("30 SP remaining");
    expect(review).toContain("recommended total 26 SP");
    expect(review).toContain("remaining load 1.5x");
    expect(review).not.toContain("> 2x");
  });

  it("never proposes deferring Done or duplicate items from historical carryover", () => {
    const issues = [
      makeIssue({ key: "DONE", resolution: "Done", story_points: 6 }),
      makeIssue({ key: "DUP", resolution: "Duplicate", story_points: 8 }),
    ];
    const { report } = makeComputedReport(issues, {
      velocities: [makeVelocity({ carryover_keys: ["DONE", "DUP"] })],
    });
    expect(report.carryover).toEqual([]);
    expect(
      report.engineerProposals[0].actions.some((a) =>
        /defer|reassign/i.test(a),
      ),
    ).toBe(false);
  });

  it.each([26, 26.2, 50, 50.2])(
    "preserves no-credit risk thresholds at $0 remaining SP",
    (remaining) => {
      const { report } = makeComputedReport([
        makeIssue({ story_points: remaining }),
      ]);
      const risk = remaining > 50 ? "extreme" : remaining > 26 ? "heavy" : "ok";
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        recommended_sp: 20,
        prev_sp_completed: 20,
        load_ratio: Math.round((remaining / 20) * 100) / 100,
        risk,
      });
    },
  );

  it("preserves fractional arithmetic on the DM and tech-lead summary", () => {
    const config: SprintConfig = {
      ...BASE_CONFIG,
      tech_leads: { Alice: ["Bob"] },
    };
    const { report, velocities } = makeComputedReport(
      [
        makeIssue({
          resolution: "Done",
          story_points: 6,
          qa_contact_id: "bob-id",
        }),
        makeIssue({
          key: "OPEN",
          story_points: 20.25,
          qa_contact_id: "bob-id",
        }),
      ],
      { config, baseline: 20.25 },
    );
    const text = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      velocities,
      report,
      config,
      [],
    );
    expect(text).toContain("26.25 = 20.25 average + 6 already done");
    const dm = text
      .split("\n")
      .find((line) => line.startsWith("> From the planning agent"))!;
    expect(dm).toContain("**26.25 SP planned**");
    expect(dm).toContain("avg. SP is 20.25 (20.25)");
    expect(dm).not.toMatch(
      /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
    );
    const directReport = text
      .split("\n")
      .find((line) => line.startsWith("> - Bob:"))!;
    expect(directReport).toContain(
      "26.25 SP assigned, 6 SP already done, 20.25 SP remaining",
    );
    expect(directReport).toContain(
      "avg 20.25 SP (20.25), 100% capacity, recommended total 26.25 SP",
    );
    expect(directReport).toContain("1x remaining load (OK)");
  });

  it("renders planned SP with the historical average and chronological breakdown", () => {
    const velocities = [32, 12, 2, 19].map((sp, index) =>
      makeVelocity({
        sprint_name: `Test Sprint ${8 - index}`,
        total_sp: sp,
        completed_sp: sp,
        total_issues: 1,
        completed_issues: 1,
        by_engineer: [
          {
            name: "Alice",
            assigned: 1,
            completed: 1,
            sp_completed: sp,
            sp_remaining: 0,
          },
        ],
        carryover_keys: [],
        retro_recommendations: [],
      }),
    );
    const { report, config } = makeComputedReport(
      [makeIssue({ story_points: 65, sprint_name: "Test Sprint 9" })],
      { velocities },
    );
    const text = formatReport(
      "Test Sprint 9",
      "2026-10-10",
      velocities,
      report,
      config,
      [],
    );
    const dm = text.split("**Alice**\n")[1].split("\n")[0];
    expect(dm).toContain("**65 SP planned**");
    expect(dm).toContain("avg. SP is 16.25 (19, 2, 12, 32)");
    expect(dm).toContain("let's plan accordingly.");
    expect(dm).not.toMatch(
      /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
    );
  });

  it("applies a shortened sprint before adding credit and exposes no team baseline at zero velocity", () => {
    const config: SprintConfig = {
      ...BASE_CONFIG,
      pto: {
        "Test Sprint 2": {
          normal_sprint_workdays: 10,
          actual_sprint_workdays: 5,
          engineer_pto: [],
        },
      },
    };
    const issues = [
      makeIssue({ resolution: "Done", story_points: 6 }),
      makeIssue({ key: "OPEN", story_points: 20 }),
    ];
    const reduced = makeComputedReport(issues, { config });
    expect(reduced.report.load.find((l) => l.name === "Alice")).toMatchObject({
      completed_sp: 6,
      remaining_sp: 20,
      capacity_pct: 0.5,
      recommended_sp: 16,
    });
    const text = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      reduced.velocities,
      reduced.report,
      config,
      [],
    );
    const dm = text.split("**Alice**\n")[1].split("\n")[0];
    expect(dm).toContain("**26 SP planned**");
    expect(dm).toContain("avg. SP is 20 (20)");
    expect(dm).not.toMatch(
      /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
    );
    const zero = makeComputedReport(issues, { baseline: 0 });
    const zeroText = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      zero.velocities,
      zero.report,
      zero.config,
      [],
    );
    expect(zeroText).toContain("Recommended total SP: no baseline");
    expect(zeroText).toContain("Already done in target sprint: 6 SP");
  });
});

describe("zero target-credit presentation", () => {
  it.each([
    { remaining: 30, ratio: 1.5, risk: "heavy", defer: 10, trim: 8 },
    { remaining: 60, ratio: 3, risk: "extreme", defer: 40, trim: 38 },
  ])(
    "keeps $risk arithmetic and tables while omitting zero-credit narrative",
    ({ remaining, ratio, risk, defer, trim }) => {
      const { report, velocities, config } = makeComputedReport([
        makeIssue({ story_points: remaining }),
      ]);
      expect(report.capacity).toMatchObject({
        target_sp: remaining,
        completed_sp: 0,
        effective_sp: remaining,
        recommended_sp: 20,
      });
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        target_sp: remaining,
        completed_sp: 0,
        remaining_sp: remaining,
        recommended_sp: 20,
        load_ratio: ratio,
        risk,
      });
      expect(report.engineerProposals[0].actions).toContainEqual(
        expect.stringContaining(
          `~${defer} SP of unfinished work to reach 20 SP total (20 SP remaining capacity)`,
        ),
      );
      expect(report.recommendations).toContainEqual(
        expect.stringContaining(
          `Trim ~${trim} SP of unfinished work** to align with proven velocity (22 SP total allowance: 22 remaining including 10% stretch)`,
        ),
      );
      const text = formatReport(
        "Test Sprint 2",
        "2026-05-14",
        velocities,
        report,
        config,
        [],
      );
      const narrative = text
        .split("\n")
        .filter((line) => !line.startsWith("|"))
        .join("\n");
      expect(narrative).not.toMatch(/already done|completed work|\+ 0/i);
      expect(text).toContain("Recommended total SP: 20 = 20 average");
      expect(text).toContain("| Already Done SP |");
      expect(text).toContain(
        `| Alice | DEV | 1 | ${remaining} | 0 | ${remaining} | 20 | 100% | 20 | ${ratio}x | **${risk === "heavy" ? "HIGH" : "EXTREME"}** |`,
      );
      const dm = text
        .split("\n")
        .find((line) => line.startsWith("> From the planning agent"))!;
      expect(dm).toContain(`**${remaining} SP planned**`);
      expect(dm).toContain("avg. SP is 20 (20)");
      expect(dm).not.toMatch(
        /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
      );
    },
  );

  it.each(["PTO", "shorter sprint"] as const)(
    "preserves %s calculations with simple DMs and no zero-credit additions",
    (kind) => {
      const config: SprintConfig = {
        ...BASE_CONFIG,
        pto: {
          "Test Sprint 2": {
            normal_sprint_workdays: 10,
            actual_sprint_workdays: kind === "PTO" ? 10 : 5,
            engineer_pto:
              kind === "PTO"
                ? [
                    {
                      name: "Alice",
                      dates: "2026-05-15 to 2026-05-19",
                      workdays_out: 5,
                      workdays_available: 5,
                    },
                  ]
                : [],
          },
        },
      };
      const { report, velocities } = makeComputedReport(
        [makeIssue({ story_points: 20 })],
        { config },
      );
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        completed_sp: 0,
        recommended_sp: 10,
        capacity_pct: 0.5,
        load_ratio: 2,
        risk: "heavy",
      });
      expect(report.engineerProposals[0].actions).toContainEqual(
        expect.stringContaining(
          "~10 SP of unfinished work to reach 10 SP total (10 SP remaining capacity)",
        ),
      );
      const text = formatReport(
        "Test Sprint 2",
        "2026-05-14",
        velocities,
        report,
        config,
        [],
      );
      const dm = text
        .split("\n")
        .find((line) => line.startsWith("> From the planning agent"))!;
      expect(dm).toContain("**20 SP planned**");
      expect(dm).toContain("avg. SP is 20 (20)");
      expect(dm).not.toMatch(
        /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
      );
      expect(text.replace(/^\|.*$/gm, "")).not.toMatch(/already done|\+ 0/i);
    },
  );

  it("omits null-SP Done commentary but retains counts and unfinished sizing warnings", () => {
    const { report, velocities, config } = makeComputedReport([
      makeIssue({ key: "DONE", resolution: "Done", story_points: null }),
      makeIssue({ key: "OPEN", story_points: 30 }),
      makeIssue({ key: "UNSIZED", story_points: null }),
    ]);
    expect(report.capacity).toMatchObject({
      completed_issues: 1,
      completed_sp: 0,
      effective_sp: 30,
    });
    expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
      completed_sp: 0,
    });
    expect(report.hygiene.filter((h) => h.kind === "no_sp")).toMatchObject([
      { key: "UNSIZED" },
    ]);
    const text = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      velocities,
      report,
      config,
      [],
    );
    expect(text.replace(/^\|.*$/gm, "")).not.toMatch(
      /already done|completed work|\+ 0/i,
    );
    expect(text).toContain("Size 1 unsized item(s)** (UNSIZED)");
    expect(text).toContain("Duplicate exclusions: 0 SP / 0 issues.");
  });

  it.each(["Alice", "Bob"])(
    "uses each owner's credit when only %s has Done work",
    (doneOwner) => {
      const config: SprintConfig = {
        ...BASE_CONFIG,
        tech_leads: { Alice: ["Bob"] },
      };
      const { report, velocities } = makeComputedReport(
        [
          makeIssue({
            key: "DONE",
            resolution: "Done",
            story_points: 6,
            assignee_id: doneOwner === "Alice" ? "alice-id" : "bob-id",
            assignee_name: doneOwner,
          }),
          makeIssue({ key: "ALICE-OPEN", story_points: 30 }),
          makeIssue({
            key: "BOB-OPEN",
            story_points: 30,
            assignee_id: "bob-id",
            assignee_name: "Bob",
          }),
        ],
        { config },
      );
      const text = formatReport(
        "Test Sprint 2",
        "2026-05-14",
        velocities,
        report,
        config,
        [],
      );
      expect(text).toContain("Already done in target sprint: 6 SP / 1 issues");
      expect(text).toContain("26 = 20 average + 6 already done");
      for (const name of ["Alice", "Bob"]) {
        const dm = text.split(`**${name}**\n`)[1].split("\n")[0];
        const proposal = text.split(`### ${name} (`)[1].split(/\n##/)[0];
        const recommendation = report.recommendations.find((r) =>
          r.includes(`Review load for ${name}`),
        )!;
        expect(dm).toContain(`**${name === doneOwner ? 36 : 30} SP planned**`);
        expect(dm).toContain("avg. SP is 20 (20)");
        expect(dm).not.toMatch(
          /already done|completed|remaining|recommended|capacity|PTO|shorter sprint|thanks/i,
        );
        if (name === doneOwner) {
          expect(proposal).toContain("| 6 SP already done |");
          expect(recommendation).toContain("including 6 SP already done");
        } else {
          expect(proposal).not.toMatch(/already done|\+ 0/i);
          expect(recommendation).not.toMatch(/already done|\+ 0/i);
        }
      }
      const directReport = text
        .split("\n")
        .find((line) => line.startsWith("> - Bob:"))!;
      if (doneOwner === "Bob") {
        expect(directReport).toContain("36 SP assigned, 6 SP already done");
        expect(directReport).toContain("recommended total 26 SP");
      } else {
        expect(directReport).not.toMatch(/already done|\+ 0/i);
        expect(directReport).toContain("30 SP assigned, 30 SP remaining");
        expect(directReport).toContain("recommended total 20 SP");
      }
      expect(directReport).toContain("1.5x remaining load (HIGH)");
    },
  );

  it("preserves no-baseline output and the DM skip without zero-credit commentary", () => {
    const { report, velocities, config } = makeComputedReport(
      [makeIssue({ story_points: 30 })],
      { velocities: [] },
    );
    expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
      completed_sp: 0,
      baseline_sprints: 0,
      load_ratio: null,
      risk: "new",
    });
    const text = formatReport(
      "Test Sprint 2",
      "2026-05-14",
      velocities,
      report,
      config,
      [],
    );
    expect(text).toContain("Recommended total SP: no baseline");
    expect(text).toContain("recommended total no baseline");
    expect(text).not.toContain("> From the planning agent");
    expect(text.replace(/^\|.*$/gm, "")).not.toMatch(
      /already done|completed work|\+ 0/i,
    );
  });
});

describe("target membership rather than completion-date gating", () => {
  it.each(["", "2026-05-14T10:00:00Z", "2026-05-20T10:00:00Z"])(
    "credits target Done work with resolution date %s",
    (resolutiondate) => {
      const { report } = makeComputedReport([
        makeIssue({ resolution: "Done", resolutiondate, story_points: 6 }),
      ]);
      expect(report.capacity.completed_sp).toBe(6);
      expect(report.load.find((l) => l.name === "Alice")).toMatchObject({
        completed_sp: 6,
        remaining_sp: 0,
        recommended_sp: 26,
        load_ratio: 0,
        risk: "ok",
      });
    },
  );
});

describe("multi-sprint DM followups", () => {
  const history = [
    { id: 10, name: "Test Sprint 0", state: "closed" as const },
    { id: 11, name: "Test Sprint 1", state: "closed" as const },
    { id: 12, name: "Test Sprint 2", state: "future" as const },
  ];
  function render(
    issues: SprintIssue[],
    options: Parameters<typeof makeComputedReport>[1] = {},
  ) {
    const { report, velocities, config } = makeComputedReport(issues, options);
    return {
      report,
      text: formatReport(
        "Test Sprint 2",
        "2026-10-10",
        velocities,
        report,
        config,
        [],
      ),
    };
  }
  const dm = (text: string, name: string) =>
    text.split(`**${name}**\n`)[1]?.split("\n---")[0] ?? "";

  it("lists shared and individual items once per owner after an unchanged primary DM", () => {
    const shared = makeIssue({
      key: "TEST-B",
      summary: 'Shared, "unfinished" work',
      qa_contact_id: "bob-id",
      story_points: null,
      sprint_history: history,
    });
    const issues = [
      shared,
      shared,
      makeIssue({ key: "TEST-A", story_points: 0, sprint_history: history }),
      makeIssue({ key: "SINGLE", sprint_history: history.slice(1) }),
      makeIssue({ key: "DONE", resolution: "Done", sprint_history: history }),
      makeIssue({
        key: "DUP",
        resolution: "Duplicate",
        sprint_history: history,
      }),
    ];
    const { text } = render(issues);
    const { text: withoutHistory } = render(
      issues.map((issue) => ({ ...issue, sprint_history: null })),
    );
    for (const name of ["Alice", "Bob"]) {
      const block = dm(text, name);
      expect(block.split("\n")[0]).toBe(
        dm(withoutHistory, name).split("\n")[0],
      );
      const bullets = block
        .split("\n")
        .filter((line) => line.startsWith("> - ["));
      expect(
        bullets.map((line) => line.match(/^> - \[([^\]]+)\]/)?.[1]),
      ).toEqual(name === "Alice" ? ["TEST-A", "TEST-B"] : ["TEST-B"]);
      for (const line of bullets) {
        expect(line).toMatch(
          /\(2 started sprints: Test Sprint 0, Test Sprint 1\)$/,
        );
        expect(line).not.toContain("Test Sprint 2");
      }
      expect(block.indexOf("> These unfinished")).toBeGreaterThan(
        block.indexOf("> From the planning agent"),
      );
    }
  });

  it("omits the review separator when one started sprint leaves a lead with no items", () => {
    const config = { ...BASE_CONFIG, tech_leads: { Alice: ["Bob"] } };
    const issues = [makeIssue({ sprint_history: history.slice(1) })];
    const { text, report } = render(issues, { config });
    const { text: withoutHistory } = render(
      issues.map((issue) => ({ ...issue, sprint_history: null })),
      { config },
    );
    expect(report.multiSprintReview).toEqual([]);
    expect(dm(text, "Alice")).toBe(dm(withoutHistory, "Alice"));
    expect(dm(text, "Alice")).toContain("> Additional info");
  });

  it.each([0, 20])(
    "asks even for zero SP with a known %s historical average",
    (baseline) => {
      const { text } = render(
        [makeIssue({ story_points: 0, sprint_history: history })],
        { baseline },
      );
      expect(dm(text, "Alice")).toContain(`Your avg. SP is ${baseline}`);
      expect(dm(text, "Alice")).toContain("> These unfinished");
      expect(dm(text, "Bob")).not.toContain("> These unfinished");
    },
  );

  it("omits primary and followup messages for qualifying owners without a baseline", () => {
    const { report, text } = render([makeIssue({ sprint_history: history })], {
      velocities: [],
    });
    expect(report.multiSprintReview.map((item) => item.key)).toEqual([
      "TEST-1",
    ]);
    expect(text).not.toContain("> From the planning agent");
    expect(text).not.toContain("> These unfinished");
  });

  it("places a lead's own review before unchanged lead details without copying direct-report items", () => {
    const config: SprintConfig = {
      ...BASE_CONFIG,
      tech_leads: { Alice: ["Bob"] },
    };
    const issues = [
      makeIssue({ key: "ALICE", sprint_history: history }),
      makeIssue({ key: "BOB", assignee_id: "bob-id", sprint_history: history }),
    ];
    const { text } = render(issues, { config });
    const { text: before } = render(
      issues.map((issue) => ({ ...issue, sprint_history: null })),
      { config },
    );
    const alice = dm(text, "Alice");
    expect(alice).toContain("> - [ALICE]");
    expect(alice).not.toContain("> - [BOB]");
    expect(alice.indexOf("> These unfinished")).toBeLessThan(
      alice.indexOf("> Additional info"),
    );
    expect(alice.split("> Additional info")[1]).toBe(
      dm(before, "Alice").split("> Additional info")[1],
    );
    expect(dm(text, "Bob")).toContain("> - [BOB]");
  });
});
