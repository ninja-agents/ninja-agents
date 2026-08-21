import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = resolve(tmpdir(), `sp-fetch-test-${Date.now()}`);

// --- Helpers (reimplemented since not exported) ---

function str(value: unknown): string {
  if (value == null) return "";
  return `${value as string | number}`;
}

function jiraAuth(email: string, token: string): string {
  return Buffer.from(`${email}:${token}`).toString("base64");
}

interface ReferenceTicket {
  key: string;
  summary: string;
  description: string;
  story_points: number;
  issuetype: string;
  priority: string;
  labels: string[];
  components: string[];
  status: string;
  resolution: string;
}

function parseReferenceTicket(
  issue: Record<string, unknown>,
  spField: string,
): ReferenceTicket {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const sp = f[spField];
  return {
    key: str(issue.key),
    summary: str(f.summary),
    description: str(f.description),
    story_points: typeof sp === "number" ? sp : 0,
    issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
    priority: str((f.priority as Record<string, unknown> | null)?.name),
    labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
    components: Array.isArray(f.components)
      ? (f.components as Array<Record<string, unknown>>).map((c) => str(c.name))
      : [],
    status: str((f.status as Record<string, unknown> | null)?.name),
    resolution: str((f.resolution as Record<string, unknown> | null)?.name),
  };
}

interface TargetTicketBase {
  key: string;
  summary: string;
  description: string;
  issuetype: string;
  priority: string;
  labels: string[];
  components: string[];
  status: string;
  story_points: number | null;
}

function parseTargetTicket(
  issue: Record<string, unknown>,
  spField: string,
): TargetTicketBase {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const sp = f[spField];
  return {
    key: str(issue.key),
    summary: str(f.summary),
    description: str(f.description),
    issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
    priority: str((f.priority as Record<string, unknown> | null)?.name),
    labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
    components: Array.isArray(f.components)
      ? (f.components as Array<Record<string, unknown>>).map((c) => str(c.name))
      : [],
    status: str((f.status as Record<string, unknown> | null)?.name),
    story_points: typeof sp === "number" ? sp : null,
  };
}

function extractPrUrls(
  links: Array<Record<string, unknown>>,
): Array<{ owner: string; repo: string; number: string }> {
  const prPattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
  const results: Array<{ owner: string; repo: string; number: string }> = [];
  for (const link of links) {
    const linkObj = (link.object ?? link) as Record<string, unknown>;
    const url = str(linkObj.url);
    const match = prPattern.exec(url);
    if (match) {
      results.push({ owner: match[1], repo: match[2], number: match[3] });
    }
  }
  return results;
}

function isCacheFresh(lastUpdatedPath: string): boolean {
  if (!existsSync(lastUpdatedPath)) return false;
  const lastUpdated = readFileSync(lastUpdatedPath, "utf-8").trim();
  const lastDate = new Date(lastUpdated);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return lastDate > sevenDaysAgo;
}

// --- Tests ---

describe("str helper", () => {
  it("converts strings", () => {
    expect(str("hello")).toBe("hello");
    expect(str("")).toBe("");
  });

  it("converts numbers", () => {
    expect(str(42)).toBe("42");
    expect(str(0)).toBe("0");
    expect(str(3.14)).toBe("3.14");
  });

  it("converts null and undefined to empty string", () => {
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });

  it("converts booleans", () => {
    expect(str(true)).toBe("true");
    expect(str(false)).toBe("false");
  });
});

describe("jiraAuth", () => {
  it("produces correct base64 encoding", () => {
    const result = jiraAuth("user@example.com", "my-token");
    expect(result).toBe(
      Buffer.from("user@example.com:my-token").toString("base64"),
    );
  });

  it("handles empty credentials", () => {
    const result = jiraAuth("", "");
    expect(result).toBe(Buffer.from(":").toString("base64"));
  });
});

describe("parseReferenceTicket", () => {
  const spField = "customfield_10028";

  it("parses a full ticket with all fields", () => {
    const issue = {
      key: "CNV-12345",
      fields: {
        summary: "Add networking support",
        description: "As a user, I want to...",
        customfield_10028: 5,
        issuetype: { name: "Story" },
        priority: { name: "Major" },
        labels: ["ui", "networking"],
        components: [{ name: "Console" }, { name: "Wizard" }],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    const result = parseReferenceTicket(issue, spField);
    expect(result).toEqual({
      key: "CNV-12345",
      summary: "Add networking support",
      description: "As a user, I want to...",
      story_points: 5,
      issuetype: "Story",
      priority: "Major",
      labels: ["ui", "networking"],
      components: ["Console", "Wizard"],
      status: "Closed",
      resolution: "Done",
    });
  });

  it("handles missing description as empty string", () => {
    const issue = {
      key: "CNV-100",
      fields: {
        summary: "Fix bug",
        description: null,
        customfield_10028: 2,
        issuetype: { name: "Bug" },
        priority: { name: "Critical" },
        labels: [],
        components: [],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    expect(parseReferenceTicket(issue, spField).description).toBe("");
  });

  it("handles null labels as empty array", () => {
    const issue = {
      key: "CNV-200",
      fields: {
        summary: "Test",
        labels: null,
        customfield_10028: 3,
        issuetype: { name: "Task" },
        priority: { name: "Minor" },
        components: [],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    expect(parseReferenceTicket(issue, spField).labels).toEqual([]);
  });

  it("handles null components as empty array", () => {
    const issue = {
      key: "CNV-300",
      fields: {
        summary: "Test",
        components: null,
        customfield_10028: 2,
        issuetype: { name: "Bug" },
        priority: { name: "Major" },
        labels: [],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    expect(parseReferenceTicket(issue, spField).components).toEqual([]);
  });

  it("treats non-number story_points as 0", () => {
    const issue = {
      key: "CNV-400",
      fields: {
        summary: "Test",
        customfield_10028: null,
        issuetype: { name: "Story" },
        priority: { name: "Major" },
        labels: [],
        components: [],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    expect(parseReferenceTicket(issue, spField).story_points).toBe(0);
  });

  it("handles missing fields object", () => {
    const issue = { key: "CNV-500" } as Record<string, unknown>;
    const result = parseReferenceTicket(issue, spField);
    expect(result.key).toBe("CNV-500");
    expect(result.summary).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.story_points).toBe(0);
  });
});

describe("parseTargetTicket", () => {
  const spField = "customfield_10028";

  it("parses a full target ticket", () => {
    const issue = {
      key: "MTV-5000",
      fields: {
        summary: "Implement migration wizard step",
        description: "Detailed requirements...",
        customfield_10028: null,
        issuetype: { name: "Story" },
        priority: { name: "Major" },
        labels: ["wizard"],
        components: [{ name: "Migration" }],
        status: { name: "New" },
      },
    };

    const result = parseTargetTicket(issue, spField);
    expect(result.key).toBe("MTV-5000");
    expect(result.story_points).toBeNull();
    expect(result.components).toEqual(["Migration"]);
  });

  it("returns null for missing story_points", () => {
    const issue = {
      key: "MTV-5001",
      fields: { summary: "Test" },
    };

    expect(parseTargetTicket(issue, spField).story_points).toBeNull();
  });

  it("returns numeric story_points when set", () => {
    const issue = {
      key: "MTV-5002",
      fields: {
        summary: "Test",
        customfield_10028: 8,
      },
    };

    expect(parseTargetTicket(issue, spField).story_points).toBe(8);
  });

  it("handles legacy sub-2 story points as numbers", () => {
    const issue = {
      key: "MTV-5003",
      fields: {
        summary: "Test",
        customfield_10028: 0.42,
      },
    };

    expect(parseTargetTicket(issue, spField).story_points).toBe(0.42);
  });
});

describe("PR URL extraction from remote links", () => {
  it("extracts GitHub PR URLs", () => {
    const links = [
      {
        object: { url: "https://github.com/kubev2v/forklift/pull/123" },
      },
    ];
    const prs = extractPrUrls(links);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      owner: "kubev2v",
      repo: "forklift",
      number: "123",
    });
  });

  it("ignores non-GitHub URLs", () => {
    const links = [
      {
        object: { url: "https://gitlab.com/some/repo/-/merge_requests/42" },
      },
      {
        object: {
          url: "https://redhat.atlassian.net/browse/CNV-12345",
        },
      },
    ];
    expect(extractPrUrls(links)).toHaveLength(0);
  });

  it("handles empty remote links", () => {
    expect(extractPrUrls([])).toHaveLength(0);
  });

  it("extracts multiple PRs from different repos", () => {
    const links = [
      {
        object: {
          url: "https://github.com/kubev2v/forklift-console-plugin/pull/100",
        },
      },
      {
        object: { url: "https://github.com/kubev2v/forklift/pull/200" },
      },
    ];
    const prs = extractPrUrls(links);
    expect(prs).toHaveLength(2);
    expect(prs[0].repo).toBe("forklift-console-plugin");
    expect(prs[1].repo).toBe("forklift");
  });

  it("handles links without object wrapper", () => {
    const links = [{ url: "https://github.com/org/repo/pull/99" }] as Array<
      Record<string, unknown>
    >;
    const prs = extractPrUrls(links);
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe("99");
  });
});

describe("cache TTL logic", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("returns false when file does not exist", () => {
    expect(isCacheFresh(resolve(TEST_DIR, "nonexistent.txt"))).toBe(false);
  });

  it("returns true for recent timestamp", () => {
    const path = resolve(TEST_DIR, "last-updated.txt");
    writeFileSync(path, new Date().toISOString());
    expect(isCacheFresh(path)).toBe(true);
  });

  it("returns false for old timestamp", () => {
    const path = resolve(TEST_DIR, "last-updated.txt");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    writeFileSync(path, eightDaysAgo.toISOString());
    expect(isCacheFresh(path)).toBe(false);
  });
});

describe("CLI arg parsing", () => {
  function parseArgs(
    argv: string[],
  ): { mode: string; ticketKey?: string } | null {
    if (argv.includes("--sync-reference")) return { mode: "sync-reference" };
    if (argv.includes("--backlog")) return { mode: "backlog" };
    const ticketIdx = argv.indexOf("--ticket");
    if (ticketIdx !== -1 && argv[ticketIdx + 1]) {
      return { mode: "ticket", ticketKey: argv[ticketIdx + 1] };
    }
    return null;
  }

  it("parses --sync-reference", () => {
    expect(parseArgs(["--sync-reference"])).toEqual({
      mode: "sync-reference",
    });
  });

  it("parses --ticket with key", () => {
    expect(parseArgs(["--ticket", "CNV-12345"])).toEqual({
      mode: "ticket",
      ticketKey: "CNV-12345",
    });
  });

  it("parses --backlog", () => {
    expect(parseArgs(["--backlog"])).toEqual({ mode: "backlog" });
  });

  it("returns null for no recognized args", () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(["--invalid"])).toBeNull();
  });

  it("returns null for --ticket without key", () => {
    expect(parseArgs(["--ticket"])).toBeNull();
  });
});

describe("reference ticket JSON format", () => {
  const spField = "customfield_10028";

  it("produces correct schema shape", () => {
    const issue = {
      key: "CNV-999",
      fields: {
        summary: "Test ticket",
        description: "A description",
        customfield_10028: 5,
        issuetype: { name: "Story" },
        priority: { name: "Major" },
        labels: ["ui"],
        components: [{ name: "Console" }],
        status: { name: "Closed" },
        resolution: { name: "Done" },
      },
    };

    const ticket = parseReferenceTicket(issue, spField);
    const keys = Object.keys(ticket).sort();
    expect(keys).toEqual([
      "components",
      "description",
      "issuetype",
      "key",
      "labels",
      "priority",
      "resolution",
      "status",
      "story_points",
      "summary",
    ]);
  });

  it("preserves array types for labels and components", () => {
    const issue = {
      key: "CNV-1000",
      fields: {
        summary: "Multi-label ticket",
        customfield_10028: 8,
        labels: ["ui", "networking", "console"],
        components: [{ name: "Plugin" }, { name: "Wizard" }, { name: "API" }],
        issuetype: { name: "Story" },
        priority: { name: "Major" },
        status: { name: "Done" },
        resolution: { name: "Done" },
      },
    };

    const ticket = parseReferenceTicket(issue, spField);
    expect(Array.isArray(ticket.labels)).toBe(true);
    expect(ticket.labels).toHaveLength(3);
    expect(Array.isArray(ticket.components)).toBe(true);
    expect(ticket.components).toHaveLength(3);
    expect(ticket.components).toEqual(["Plugin", "Wizard", "API"]);
  });

  it("extracts resolution name from nested object", () => {
    const issue = {
      key: "CNV-1001",
      fields: {
        summary: "Resolved ticket",
        customfield_10028: 2,
        issuetype: { name: "Bug" },
        priority: { name: "Critical" },
        labels: [],
        components: [],
        status: { name: "Closed" },
        resolution: { name: "Won't Fix" },
      },
    };

    expect(parseReferenceTicket(issue, spField).resolution).toBe("Won't Fix");
  });
});

describe("backlog resolution filter", () => {
  const validResolutions = new Set(["Done", "Done-Errata", ""]);

  function shouldInclude(resolution: string): boolean {
    return !resolution || validResolutions.has(resolution);
  }

  it("includes tickets with Done resolution", () => {
    expect(shouldInclude("Done")).toBe(true);
  });

  it("includes tickets with Done-Errata resolution", () => {
    expect(shouldInclude("Done-Errata")).toBe(true);
  });

  it("includes tickets with empty resolution (unresolved)", () => {
    expect(shouldInclude("")).toBe(true);
  });

  it("excludes Duplicate resolution", () => {
    expect(shouldInclude("Duplicate")).toBe(false);
  });

  it("excludes Won't Fix resolution", () => {
    expect(shouldInclude("Won't Fix")).toBe(false);
  });

  it("excludes Cannot Reproduce resolution", () => {
    expect(shouldInclude("Cannot Reproduce")).toBe(false);
  });
});
