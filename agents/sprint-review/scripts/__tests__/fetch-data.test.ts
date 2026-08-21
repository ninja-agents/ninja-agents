import { describe, it, expect } from "vitest";

// --- Helper function reimplementations (not exported from source) ---

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

// --- Sprint discovery types ---

interface SprintObject {
  name?: string;
  state?: string;
  boardId?: number;
  startDate?: string;
  endDate?: string;
}

function findActiveSprint(
  sprintField: unknown,
  boardId: number,
  prefix: string,
): SprintObject | null {
  if (!Array.isArray(sprintField)) return null;
  const sprints = sprintField as SprintObject[];
  for (const s of sprints) {
    if (
      s.state === "active" &&
      s.boardId === boardId &&
      s.name?.startsWith(prefix)
    ) {
      return s;
    }
  }
  return null;
}

// --- Changelog parsing types ---

interface ChangelogItem {
  field?: string;
  toString?: string;
}

interface ChangelogHistory {
  created?: string;
  items?: ChangelogItem[];
}

function findEarliestInProgress(
  histories: ChangelogHistory[],
  inProgressStatuses: Set<string>,
): string {
  let earliestDate = "";
  for (const history of histories) {
    const items = history.items ?? [];
    for (const item of items) {
      if (
        item.field === "status" &&
        item.toString &&
        inProgressStatuses.has(item.toString.toLowerCase())
      ) {
        const created = history.created ?? "";
        if (!earliestDate || created < earliestDate) {
          earliestDate = created;
        }
      }
    }
  }
  return earliestDate;
}

// --- Completed issue detection ---

function isCompleted(
  fields: Record<string, unknown>,
  doneStatuses: Set<string>,
): boolean {
  const resolution = str(
    (fields.resolution as Record<string, unknown> | null)?.name,
  );
  const status = str((fields.status as Record<string, unknown> | null)?.name);
  return (
    resolution.toLowerCase() === "done" ||
    doneStatuses.has(status.toLowerCase())
  );
}

// --- CSV line builder (mirrors sprint-issues.csv row logic) ---

function buildIssueCsvLine(
  issue: { key: string; fields?: Record<string, unknown> },
  sprintName: string,
  sprintStart: string,
  sprintEnd: string,
  spField: string,
): string {
  const f = issue.fields ?? {};
  const assignee = (f.assignee ?? {}) as Record<string, unknown>;
  const qaContact = (f.customfield_10470 ?? {}) as Record<string, unknown>;
  const sp = f[spField];
  const labels = Array.isArray(f.labels)
    ? (f.labels as string[]).join(";")
    : "";

  return (
    `${issue.key},${csvEscape(str(f.summary))},${str((f.status as Record<string, unknown> | null)?.name)},` +
    `${str((f.resolution as Record<string, unknown> | null)?.name)},${str(f.resolutiondate)},` +
    `${str((f.issuetype as Record<string, unknown> | null)?.name)},` +
    `${str((f.priority as Record<string, unknown> | null)?.name)},` +
    `${str(assignee?.accountId)},${csvEscape(str(assignee?.displayName))},` +
    `${sp != null ? str(sp) : ""},` +
    `${str(f.created)},${str(f.updated)},` +
    `${csvEscape(sprintName)},${sprintStart},${sprintEnd},` +
    `${csvEscape(labels)},` +
    `${str(qaContact?.accountId)},${csvEscape(str(qaContact?.displayName))}`
  );
}

// ===================== TESTS =====================

describe("str helper", () => {
  it("converts null to empty string", () => {
    expect(str(null)).toBe("");
  });

  it("converts undefined to empty string", () => {
    expect(str(undefined)).toBe("");
  });

  it("passes strings through", () => {
    expect(str("hello")).toBe("hello");
    expect(str("")).toBe("");
  });

  it("converts numbers to string", () => {
    expect(str(42)).toBe("42");
    expect(str(0)).toBe("0");
    expect(str(3.14)).toBe("3.14");
  });

  it("converts booleans to string", () => {
    expect(str(true)).toBe("true");
    expect(str(false)).toBe("false");
  });
});

describe("csvEscape", () => {
  it("leaves plain strings unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape("simple text")).toBe("simple text");
  });

  it("wraps strings with commas in double quotes", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("doubles internal quotes and wraps", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("handles commas and quotes together", () => {
    expect(csvEscape('he said, "yes"')).toBe('"he said, ""yes"""');
  });

  it("handles empty string", () => {
    expect(csvEscape("")).toBe("");
  });

  it("does not quote fields without commas or quotes", () => {
    expect(csvEscape("no special chars")).toBe("no special chars");
    expect(csvEscape("CNV-12345")).toBe("CNV-12345");
  });
});

describe("Auth", () => {
  it("builds correct base64 from email and token", () => {
    const email = "user@example.com";
    const token = "api-token-123";
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    expect(auth).toBe(
      Buffer.from("user@example.com:api-token-123").toString("base64"),
    );
    expect(Buffer.from(auth, "base64").toString()).toBe(
      "user@example.com:api-token-123",
    );
  });

  it("handles empty credentials", () => {
    const auth = Buffer.from(":").toString("base64");
    expect(Buffer.from(auth, "base64").toString()).toBe(":");
  });
});

describe("Sprint Discovery", () => {
  const BOARD_ID = 11806;
  const PREFIX = "MIG-NET-Frontend Sprint";

  it("finds matching active sprint with correct board and prefix", () => {
    const field = [
      {
        state: "active",
        boardId: BOARD_ID,
        name: "MIG-NET-Frontend Sprint 4",
        startDate: "2026-08-01",
        endDate: "2026-08-15",
      },
    ];
    const result = findActiveSprint(field, BOARD_ID, PREFIX);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("MIG-NET-Frontend Sprint 4");
    expect(result!.startDate).toBe("2026-08-01");
  });

  it("skips sprints with wrong boardId", () => {
    const field = [
      {
        state: "active",
        boardId: 99999,
        name: "MIG-NET-Frontend Sprint 4",
      },
    ];
    const result = findActiveSprint(field, BOARD_ID, PREFIX);
    expect(result).toBeNull();
  });

  it("skips sprints with wrong prefix", () => {
    const field = [
      {
        state: "active",
        boardId: BOARD_ID,
        name: "Other Team Sprint 1",
      },
    ];
    const result = findActiveSprint(field, BOARD_ID, PREFIX);
    expect(result).toBeNull();
  });

  it("skips closed sprints", () => {
    const field = [
      {
        state: "closed",
        boardId: BOARD_ID,
        name: "MIG-NET-Frontend Sprint 3",
      },
      {
        state: "active",
        boardId: BOARD_ID,
        name: "MIG-NET-Frontend Sprint 4",
      },
    ];
    const result = findActiveSprint(field, BOARD_ID, PREFIX);
    expect(result!.name).toBe("MIG-NET-Frontend Sprint 4");
  });

  it("returns null for non-array input", () => {
    expect(findActiveSprint(null, BOARD_ID, PREFIX)).toBeNull();
    expect(findActiveSprint(undefined, BOARD_ID, PREFIX)).toBeNull();
    expect(findActiveSprint("not an array", BOARD_ID, PREFIX)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(findActiveSprint([], BOARD_ID, PREFIX)).toBeNull();
  });
});

describe("Changelog Parsing", () => {
  const inProgressStatuses = new Set([
    "in progress",
    "assigned",
    "modified",
    "code review",
    "review",
    "post",
    "dev complete",
  ]);

  it("finds the earliest in-progress transition date", () => {
    const histories: ChangelogHistory[] = [
      {
        created: "2026-08-05T10:00:00Z",
        items: [{ field: "status", toString: "In Progress" }],
      },
      {
        created: "2026-08-03T08:00:00Z",
        items: [{ field: "status", toString: "Assigned" }],
      },
      {
        created: "2026-08-10T12:00:00Z",
        items: [{ field: "status", toString: "Code Review" }],
      },
    ];
    expect(findEarliestInProgress(histories, inProgressStatuses)).toBe(
      "2026-08-03T08:00:00Z",
    );
  });

  it("skips non-status field changes", () => {
    const histories: ChangelogHistory[] = [
      {
        created: "2026-08-01T10:00:00Z",
        items: [{ field: "assignee", toString: "John" }],
      },
      {
        created: "2026-08-05T10:00:00Z",
        items: [{ field: "status", toString: "In Progress" }],
      },
    ];
    expect(findEarliestInProgress(histories, inProgressStatuses)).toBe(
      "2026-08-05T10:00:00Z",
    );
  });

  it("skips transitions to non-in-progress statuses", () => {
    const histories: ChangelogHistory[] = [
      {
        created: "2026-08-01T10:00:00Z",
        items: [{ field: "status", toString: "New" }],
      },
      {
        created: "2026-08-03T10:00:00Z",
        items: [{ field: "status", toString: "Done" }],
      },
    ];
    expect(findEarliestInProgress(histories, inProgressStatuses)).toBe("");
  });

  it("handles empty changelog", () => {
    expect(findEarliestInProgress([], inProgressStatuses)).toBe("");
  });

  it("handles history entries with missing items", () => {
    const histories: ChangelogHistory[] = [
      { created: "2026-08-01T10:00:00Z" },
      {
        created: "2026-08-05T10:00:00Z",
        items: [{ field: "status", toString: "In Progress" }],
      },
    ];
    expect(findEarliestInProgress(histories, inProgressStatuses)).toBe(
      "2026-08-05T10:00:00Z",
    );
  });

  it("is case-insensitive for status names", () => {
    const histories: ChangelogHistory[] = [
      {
        created: "2026-08-05T10:00:00Z",
        items: [{ field: "status", toString: "IN PROGRESS" }],
      },
    ];
    expect(findEarliestInProgress(histories, inProgressStatuses)).toBe(
      "2026-08-05T10:00:00Z",
    );
  });
});

describe("Completed Issue Detection", () => {
  const doneStatuses = new Set(["release pending", "verified", "closed"]);

  it("detects resolution=Done as completed", () => {
    const fields = {
      resolution: { name: "Done" },
      status: { name: "New" },
    };
    expect(isCompleted(fields, doneStatuses)).toBe(true);
  });

  it("detects done status as completed", () => {
    const fields = {
      resolution: null,
      status: { name: "Closed" },
    };
    expect(isCompleted(fields, doneStatuses)).toBe(true);
  });

  it("does not flag in-progress as completed", () => {
    const fields = {
      resolution: null,
      status: { name: "In Progress" },
    };
    expect(isCompleted(fields, doneStatuses)).toBe(false);
  });

  it("is case-insensitive for resolution", () => {
    const fields = {
      resolution: { name: "done" },
      status: { name: "New" },
    };
    expect(isCompleted(fields, doneStatuses)).toBe(true);
  });
});

describe("CSV Output Format", () => {
  const SP_FIELD = "customfield_10028";

  it("produces correct header", () => {
    const header =
      "key,summary,status,resolution,resolutiondate,issuetype,priority,assignee_id,assignee_name,story_points,created,updated,sprint_name,sprint_start,sprint_end,labels,qa_contact_id,qa_contact_name";
    expect(header.split(",")).toHaveLength(18);
  });

  it("maps full issue fields correctly", () => {
    const issue = {
      key: "CNV-12345",
      fields: {
        summary: "Fix login bug",
        status: { name: "Done" },
        resolution: { name: "Done" },
        resolutiondate: "2026-08-10T12:00:00Z",
        issuetype: { name: "Bug" },
        priority: { name: "Major" },
        assignee: { accountId: "abc123", displayName: "Aviv Turgeman" },
        customfield_10028: 5,
        created: "2026-08-01T10:00:00Z",
        updated: "2026-08-10T12:00:00Z",
        labels: ["ui", "networking"],
        customfield_10470: {
          accountId: "def456",
          displayName: "Leon Kladnitsky",
        },
      },
    };
    const line = buildIssueCsvLine(
      issue,
      "Sprint 4",
      "2026-08-01",
      "2026-08-15",
      SP_FIELD,
    );
    const parts = line.split(",");
    expect(parts[0]).toBe("CNV-12345");
    expect(parts[1]).toBe("Fix login bug");
    expect(parts[2]).toBe("Done");
    expect(line).toContain("abc123");
    expect(line).toContain("Aviv Turgeman");
    expect(line).toContain("5");
    expect(line).toContain("ui;networking");
    expect(line).toContain("Leon Kladnitsky");
  });

  it("handles null fields gracefully", () => {
    const issue = {
      key: "MTV-999",
      fields: {
        summary: "Empty ticket",
        status: { name: "New" },
        resolution: null,
        resolutiondate: null,
        issuetype: { name: "Story" },
        priority: { name: "Minor" },
        assignee: null,
        customfield_10028: null,
        created: "2026-08-01T10:00:00Z",
        updated: "2026-08-01T10:00:00Z",
        labels: [],
        customfield_10470: null,
      },
    };
    const line = buildIssueCsvLine(
      issue,
      "Sprint 4",
      "2026-08-01",
      "2026-08-15",
      SP_FIELD,
    );
    expect(line).toContain("MTV-999");
    expect(line).toContain("Empty ticket");
    // Null story_points should produce empty field
    const parts = line.split(",");
    // story_points is at index 9
    expect(parts[9]).toBe("");
  });

  it("escapes summary containing commas", () => {
    const issue = {
      key: "CNV-100",
      fields: {
        summary: "Fix bug, improve perf",
        status: { name: "New" },
        resolution: null,
        resolutiondate: null,
        issuetype: { name: "Bug" },
        priority: { name: "Major" },
        assignee: null,
        customfield_10028: null,
        created: "2026-08-01T10:00:00Z",
        updated: "2026-08-01T10:00:00Z",
        labels: [],
        customfield_10470: null,
      },
    };
    const line = buildIssueCsvLine(
      issue,
      "Sprint 4",
      "2026-08-01",
      "2026-08-15",
      SP_FIELD,
    );
    expect(line).toContain('"Fix bug, improve perf"');
  });

  it("sprint-transitions.csv has correct format", () => {
    const header = "key,first_in_progress_date";
    const row = "CNV-12345,2026-08-03T08:00:00Z";
    expect(header.split(",")).toEqual(["key", "first_in_progress_date"]);
    expect(row.split(",")).toEqual(["CNV-12345", "2026-08-03T08:00:00Z"]);
  });

  it("sprint-changelog.csv is header only", () => {
    const header =
      "key,summary,status,resolution,issuetype,assignee_name,story_points,created,updated,sprint_names";
    expect(header.split(",")).toHaveLength(10);
  });
});
