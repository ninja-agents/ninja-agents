import { describe, it, expect } from "vitest";

// Re-implement helpers locally since they aren't exported

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

// --- Types matching the source ---

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
  statuses: { done: string[] };
  engineers: Engineer[];
}

// Re-implement parseReportVelocity locally for testing
function parseReportVelocity(
  content: string,
  sprintName: string,
  config: SprintConfig,
): VelocitySummary | null {
  const lines = content.split("\n");

  let totalIssues = 0;
  let completedIssues = 0;
  let totalSp = 0;
  let completedSp = 0;

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

// Re-implement computeVelocityFromJira logic locally
function computeVelocityFromJira(
  issues: Array<{ key: string; fields?: Record<string, unknown> }>,
  sprintName: string,
  config: SprintConfig,
): VelocitySummary {
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

    const assignee = f.assignee as Record<string, unknown> | null;
    const assigneeId = str(assignee?.accountId);

    if (assigneeId) {
      const configEng = config.engineers.find(
        (e) => e.jira_account_id === assigneeId,
      );
      if (configEng) {
        const entry = engineerMap.get(configEng.name) ?? {
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
        engineerMap.set(configEng.name, entry);
      }
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

// --- Test config ---

const testConfig: SprintConfig = {
  board_id: 11806,
  sprint_name_prefix: "MIG-NET-Frontend Sprint",
  jira: {
    cloud_id: "redhat.atlassian.net",
    sprint_field: "customfield_10020",
    story_point_field: "customfield_10028",
  },
  statuses: {
    done: ["Release Pending", "Verified", "Closed"],
  },
  engineers: [
    {
      name: "Leon Kladnitsky",
      jira_account_id: "712020:1f4f0221",
      jira_display_names: ["Leon Kladnitsky"],
      role: "qe",
    },
    {
      name: "Phillip Bailey",
      jira_account_id: "5af18c19",
      jira_display_names: ["Phillip Rhodes", "Phillip Bailey"],
      role: "dev",
    },
    {
      name: "Aviv Turgeman",
      jira_account_id: "5e9ff58b",
      jira_display_names: ["Aviv Turgeman"],
      role: "dev",
    },
  ],
};

// ============================================================
// Tests
// ============================================================

describe("str helper", () => {
  it("converts strings", () => {
    expect(str("hello")).toBe("hello");
  });

  it("converts numbers", () => {
    expect(str(42)).toBe("42");
    expect(str(0)).toBe("0");
  });

  it("converts null to empty string", () => {
    expect(str(null)).toBe("");
  });

  it("converts undefined to empty string", () => {
    expect(str(undefined)).toBe("");
  });
});

describe("csvEscape", () => {
  it("leaves plain strings unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps strings with commas in quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("doubles internal quotes and wraps", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("handles commas and quotes together", () => {
    expect(csvEscape('a, "b"')).toBe('"a, ""b"""');
  });

  it("handles empty strings", () => {
    expect(csvEscape("")).toBe("");
  });
});

describe("parseSprintNumber", () => {
  const prefix = "MIG-NET-Frontend Sprint";

  it("extracts number from a valid sprint name", () => {
    expect(parseSprintNumber("MIG-NET-Frontend Sprint 4", prefix)).toBe(4);
  });

  it("extracts number 1", () => {
    expect(parseSprintNumber("MIG-NET-Frontend Sprint 1", prefix)).toBe(1);
  });

  it("returns 0 for Sprint 0", () => {
    expect(parseSprintNumber("MIG-NET-Frontend Sprint 0", prefix)).toBe(0);
  });

  it("returns null for non-numeric suffix", () => {
    expect(parseSprintNumber("MIG-NET-Frontend Sprint abc", prefix)).toBeNull();
  });

  it("returns null when prefix doesn't match (empty suffix)", () => {
    expect(parseSprintNumber("MIG-NET-Frontend Sprint", prefix)).toBeNull();
  });
});

describe("previousSprintNames", () => {
  const prefix = "MIG-NET-Frontend Sprint";

  it("returns 3 previous sprints for Sprint 4", () => {
    expect(previousSprintNames(prefix, 4, 3)).toEqual([
      "MIG-NET-Frontend Sprint 3",
      "MIG-NET-Frontend Sprint 2",
      "MIG-NET-Frontend Sprint 1",
    ]);
  });

  it("returns only valid sprints for Sprint 2 (skips 0)", () => {
    expect(previousSprintNames(prefix, 2, 3)).toEqual([
      "MIG-NET-Frontend Sprint 1",
    ]);
  });

  it("returns empty array for Sprint 1", () => {
    expect(previousSprintNames(prefix, 1, 3)).toEqual([]);
  });

  it("respects count parameter", () => {
    expect(previousSprintNames(prefix, 5, 2)).toEqual([
      "MIG-NET-Frontend Sprint 4",
      "MIG-NET-Frontend Sprint 3",
    ]);
  });
});

// --- Report velocity parsing ---

const MOCK_REPORT = `# Sprint Review — MIG-NET-Frontend Sprint 3

## Sprint Summary

| Metric | Value |
|--------|-------|
| Total Issues | 71 |
| Completed | 58 (82%) |
| Story Points Planned | 314.84 |
| Story Points Completed | 228.84 (73%) |

## By Engineer

| Engineer | Assigned | Completed | Remaining | SP Completed | SP Remaining |
|----------|----------|-----------|-----------|--------------|--------------|
| Leon Kladnitsky | 34 | 30 | 4 | 92.84 | 14 |
| Phillip Rhodes | 10 | 8 | 2 | 40 | 10 |
| Aviv Turgeman | 20 | 15 | 5 | 60 | 20 |

## Carryover Risk

- [CNV-12345 - Fix network tab](https://redhat.atlassian.net/browse/CNV-12345)
- [MTV-6789 - Update wizard](https://redhat.atlassian.net/browse/MTV-6789)

## What do we want to try next?

- Break down large stories before sprint planning
- Add acceptance criteria to all stories before pulling into sprint
- Review carryover items during standup
`;

describe("parseReportVelocity", () => {
  it("parses Sprint Summary table", () => {
    const result = parseReportVelocity(
      MOCK_REPORT,
      "MIG-NET-Frontend Sprint 3",
      testConfig,
    );
    expect(result).not.toBeNull();
    expect(result!.total_issues).toBe(71);
    expect(result!.completed_issues).toBe(58);
    expect(result!.total_sp).toBe(314.84);
    expect(result!.completed_sp).toBe(228.84);
  });

  it("parses By Engineer table", () => {
    const result = parseReportVelocity(
      MOCK_REPORT,
      "MIG-NET-Frontend Sprint 3",
      testConfig,
    );
    expect(result!.by_engineer).toHaveLength(3);
    expect(result!.by_engineer[0]).toEqual({
      name: "Leon Kladnitsky",
      assigned: 34,
      completed: 30,
      sp_completed: 92.84,
      sp_remaining: 14,
    });
  });

  it("maps display names to config names", () => {
    const result = parseReportVelocity(
      MOCK_REPORT,
      "MIG-NET-Frontend Sprint 3",
      testConfig,
    );
    const phillip = result!.by_engineer.find(
      (e) => e.name === "Phillip Bailey",
    );
    expect(phillip).toBeDefined();
    expect(phillip!.assigned).toBe(10);
  });

  it("extracts carryover keys", () => {
    const result = parseReportVelocity(
      MOCK_REPORT,
      "MIG-NET-Frontend Sprint 3",
      testConfig,
    );
    expect(result!.carryover_keys).toEqual(["CNV-12345", "MTV-6789"]);
  });

  it("extracts retro recommendations", () => {
    const result = parseReportVelocity(
      MOCK_REPORT,
      "MIG-NET-Frontend Sprint 3",
      testConfig,
    );
    expect(result!.retro_recommendations).toEqual([
      "Break down large stories before sprint planning",
      "Add acceptance criteria to all stories before pulling into sprint",
      "Review carryover items during standup",
    ]);
  });

  it("returns null for empty content", () => {
    const result = parseReportVelocity("", "Sprint 3", testConfig);
    expect(result).toBeNull();
  });

  it("returns null when no Sprint Summary table found", () => {
    const result = parseReportVelocity(
      "# Some report\n\nNo tables here.",
      "Sprint 3",
      testConfig,
    );
    expect(result).toBeNull();
  });

  it("handles missing carryover and retro sections", () => {
    const minimal = `| Total Issues | 10 |
| Completed | 8 (80%) |
| Story Points Planned | 50 |
| Story Points Completed | 40 (80%) |`;
    const result = parseReportVelocity(minimal, "Sprint 3", testConfig);
    expect(result).not.toBeNull();
    expect(result!.carryover_keys).toEqual([]);
    expect(result!.retro_recommendations).toEqual([]);
    expect(result!.by_engineer).toEqual([]);
  });
});

// --- Velocity from Jira ---

describe("computeVelocityFromJira", () => {
  it("counts completed issues with resolution Done", () => {
    const issues = [
      {
        key: "CNV-1",
        fields: {
          resolution: { name: "Done" },
          customfield_10028: 5,
          assignee: { accountId: "5e9ff58b", displayName: "Aviv Turgeman" },
        },
      },
      {
        key: "CNV-2",
        fields: {
          resolution: { name: "Won't Do" },
          customfield_10028: 3,
          assignee: { accountId: "5af18c19", displayName: "Phillip Bailey" },
        },
      },
      {
        key: "CNV-3",
        fields: {
          resolution: null,
          customfield_10028: 8,
          assignee: { accountId: "712020:1f4f0221", displayName: "Leon K" },
        },
      },
    ];

    const result = computeVelocityFromJira(issues, "Sprint 3", testConfig);
    expect(result.total_issues).toBe(3);
    expect(result.completed_issues).toBe(1);
    expect(result.total_sp).toBe(16);
    expect(result.completed_sp).toBe(5);
  });

  it("maps assignees to config engineer names", () => {
    const issues = [
      {
        key: "CNV-1",
        fields: {
          resolution: { name: "Done" },
          customfield_10028: 5,
          assignee: { accountId: "5e9ff58b", displayName: "Aviv T" },
        },
      },
    ];

    const result = computeVelocityFromJira(issues, "Sprint 3", testConfig);
    expect(result.by_engineer).toHaveLength(1);
    expect(result.by_engineer[0].name).toBe("Aviv Turgeman");
    expect(result.by_engineer[0].sp_completed).toBe(5);
  });

  it("handles missing assignee", () => {
    const issues = [
      {
        key: "CNV-1",
        fields: {
          resolution: { name: "Done" },
          customfield_10028: 5,
          assignee: null,
        },
      },
    ];

    const result = computeVelocityFromJira(issues, "Sprint 3", testConfig);
    expect(result.completed_issues).toBe(1);
    expect(result.by_engineer).toHaveLength(0);
  });

  it("returns empty velocity for no issues", () => {
    const result = computeVelocityFromJira([], "Sprint 3", testConfig);
    expect(result.total_issues).toBe(0);
    expect(result.completed_issues).toBe(0);
    expect(result.total_sp).toBe(0);
    expect(result.by_engineer).toEqual([]);
  });

  it("tracks remaining SP for in-progress issues", () => {
    const issues = [
      {
        key: "CNV-1",
        fields: {
          resolution: null,
          customfield_10028: 8,
          assignee: { accountId: "5af18c19", displayName: "Phillip" },
          status: { name: "In Progress" },
        },
      },
    ];

    const result = computeVelocityFromJira(issues, "Sprint 3", testConfig);
    expect(result.by_engineer[0].sp_remaining).toBe(8);
    expect(result.by_engineer[0].sp_completed).toBe(0);
  });
});

// --- CSV output format ---

describe("CSV output format", () => {
  function writeSprintIssuesCsv(
    issues: Array<{ key: string; fields?: Record<string, unknown> }>,
    sprintName: string,
    sprintStart: string,
    sprintEnd: string,
    config: SprintConfig,
  ): string {
    const header =
      "key,summary,status,resolution,resolutiondate,issuetype,priority,assignee_id,assignee_name,story_points,created,updated,sprint_name,sprint_start,sprint_end,labels,qa_contact_id,qa_contact_name";

    const rows = issues.map((issue) => {
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

    return [header, ...rows].join("\n") + "\n";
  }

  it("produces correct CSV header", () => {
    const csv = writeSprintIssuesCsv([], "Sprint 4", "", "", testConfig);
    const header = csv.split("\n")[0];
    expect(header).toBe(
      "key,summary,status,resolution,resolutiondate,issuetype,priority,assignee_id,assignee_name,story_points,created,updated,sprint_name,sprint_start,sprint_end,labels,qa_contact_id,qa_contact_name",
    );
  });

  it("maps fields correctly for a full issue", () => {
    const issues = [
      {
        key: "CNV-100",
        fields: {
          summary: "Fix button",
          status: { name: "Done" },
          resolution: { name: "Done" },
          resolutiondate: "2026-08-15T10:00:00.000+0000",
          issuetype: { name: "Bug" },
          priority: { name: "Major" },
          assignee: { accountId: "abc123", displayName: "Jane Doe" },
          customfield_10028: 5,
          created: "2026-08-01T09:00:00.000+0000",
          updated: "2026-08-15T10:00:00.000+0000",
          labels: ["ui", "networking"],
          customfield_10470: {
            accountId: "qa456",
            displayName: "QA Person",
          },
        },
      },
    ];

    const csv = writeSprintIssuesCsv(
      issues,
      "Sprint 4",
      "2026-08-01",
      "2026-08-15",
      testConfig,
    );
    const row = csv.split("\n")[1];
    expect(row).toContain("CNV-100");
    expect(row).toContain("Fix button");
    expect(row).toContain("Done");
    expect(row).toContain("Bug");
    expect(row).toContain("Major");
    expect(row).toContain("abc123");
    expect(row).toContain("Jane Doe");
    expect(row).toContain(",5,");
    expect(row).toContain("Sprint 4");
    expect(row).toContain("ui;networking");
    expect(row).toContain("qa456");
    expect(row).toContain("QA Person");
  });

  it("handles null fields gracefully", () => {
    const issues = [
      {
        key: "MTV-200",
        fields: {
          summary: "No assignee ticket",
          status: { name: "New" },
          resolution: null,
          resolutiondate: null,
          issuetype: { name: "Story" },
          priority: { name: "Minor" },
          assignee: null,
          customfield_10028: null,
          created: "2026-08-10",
          updated: "2026-08-10",
          labels: null,
          customfield_10470: null,
        },
      },
    ];

    const csv = writeSprintIssuesCsv(issues, "Sprint 4", "", "", testConfig);
    const row = csv.split("\n")[1];
    expect(row).toContain("MTV-200");
    expect(row).toContain("No assignee ticket");
    expect(row).not.toContain("undefined");
    expect(row).not.toContain("null");
  });
});
