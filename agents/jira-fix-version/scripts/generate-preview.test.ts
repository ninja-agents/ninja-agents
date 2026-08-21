import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseCsvLine,
  parseCsv,
  truncate,
  generateMarkdown,
  type TicketRow,
} from "./generate-preview.js";

const BASE_URL = "https://your-site.atlassian.net";

const makeRow = (overrides: Partial<TicketRow> = {}): TicketRow => ({
  key: "CNV-1234",
  summary: "Fix something",
  status: "Closed",
  assignee: "Alice",
  issuetype: "Bug",
  github_prs: "https://github.com/org/repo/pull/42",
  pr_source: "direct",
  merged_branches: "org/repo:main",
  fix_version_ids: "12345",
  fix_version_names: "CNV v4.23",
  disposition: "proposed",
  reason: "",
  resolved_date: "2026-07-15",
  ...overrides,
});

describe("parseCsvLine", () => {
  it("splits a simple line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('"hello, world",b,c')).toEqual([
      "hello, world",
      "b",
      "c",
    ]);
  });

  it("handles escaped double-quotes inside quoted field", () => {
    expect(parseCsvLine('"say ""hi""",b')).toEqual(['say "hi"', "b"]);
  });

  it("handles empty trailing field", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("strips carriage return from last field", () => {
    const result = parseCsvLine("a,b,c\r");
    expect(result[result.length - 1]).toBe("c");
  });
});

describe("parseCsv", () => {
  const header =
    "key,summary,status,assignee,issuetype,github_prs,pr_source,merged_branches,fix_version_ids,fix_version_names,disposition,reason,resolved_date";

  it("parses all three dispositions", () => {
    const csv = [
      header,
      "CNV-1,Fix A,Closed,Alice,Bug,https://github.com/o/r/pull/1,direct,o/r:main,111,CNV v4.23,proposed,,2026-07-01",
      "CNV-2,Fix B,Closed,Bob,Bug,https://github.com/o/r/pull/2,,o/r:unknown,,,needs_review,Unknown branch(es): o/r:unknown,",
      "CNV-3,No PR,Closed,,Bug,,,,,,skipped,no linked PR found,",
    ].join("\n");

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0].disposition).toBe("proposed");
    expect(rows[1].disposition).toBe("needs_review");
    expect(rows[2].disposition).toBe("skipped");
  });

  it("reads pr_source and resolved_date columns", () => {
    const csv = [
      header,
      "MTA-1,Story fix,Closed,Alice,Story,https://github.com/o/r/pull/5,issue_resolved,o/r:main,27839,MTA 8.2.0,proposed,,2026-06-15",
    ].join("\n");

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].pr_source).toBe("issue_resolved");
    expect(rows[0].resolved_date).toBe("2026-06-15");
  });

  it("parses a Story row the same as a Bug row", () => {
    const csv = [
      header,
      "MTA-100,Story fix,Closed,Alice,Story,https://github.com/o/r/pull/5,direct,o/r:main,27839,MTA 8.2.0,proposed,,2026-07-10",
    ].join("\n");

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].issuetype).toBe("Story");
    expect(rows[0].disposition).toBe("proposed");
    expect(rows[0].fix_version_names).toBe("MTA 8.2.0");
  });

  it("returns empty array for header-only CSV", () => {
    expect(parseCsv(header)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles quoted summary containing comma", () => {
    const csv = [
      header,
      '"CNV-5","Fix, comma issue",Closed,Alice,Bug,,,,,,skipped,no linked PR found,',
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows[0].summary).toBe("Fix, comma issue");
  });

  it("falls back to empty string for missing new columns in old CSVs", () => {
    const oldHeader =
      "key,summary,status,assignee,issuetype,github_prs,merged_branches,fix_version_ids,fix_version_names,disposition,reason";
    const csv = [
      oldHeader,
      "CNV-9,Old row,Closed,Bob,Bug,https://github.com/o/r/pull/9,o/r:main,111,CNV v4.23,proposed,",
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].pr_source).toBe("");
    expect(rows[0].resolved_date).toBe("");
  });
});

describe("truncate", () => {
  it("returns string unchanged when under limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis when over limit", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toHaveLength(5);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("generateMarkdown", () => {
  it("renders ticket key as Jira hyperlink", () => {
    const rows = [makeRow({ key: "CNV-1234", disposition: "proposed" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain(
      "[CNV-1234](https://your-site.atlassian.net/browse/CNV-1234)",
    );
  });

  it("groups proposed rows by fix version with sub-header", () => {
    const rows = [
      makeRow({ fix_version_names: "MTA 8.3.0", key: "MTA-1" }),
      makeRow({ fix_version_names: "MTA 8.3.0", key: "MTA-2" }),
      makeRow({ fix_version_names: "CNV v4.23", key: "CNV-1" }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("### MTA 8.3.0 (2)");
    expect(md).toContain("### CNV v4.23 (1)");
    expect(md).not.toContain("| Proposed Fix Version(s) |");
  });

  it("sorts fix version groups by descending count", () => {
    const rows = [
      makeRow({ fix_version_names: "A", key: "A-1" }),
      makeRow({ fix_version_names: "B", key: "B-1" }),
      makeRow({ fix_version_names: "B", key: "B-2" }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    const idxA = md.indexOf("### A");
    const idxB = md.indexOf("### B");
    expect(idxB).toBeLessThan(idxA);
  });

  it("converts semicolons to comma-space in branch column", () => {
    const rows = [
      makeRow({
        merged_branches: "org/repo:main;org/repo:release-4.22",
        fix_version_names: "CNV v4.23",
        disposition: "proposed",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("org/repo:main, org/repo:release-4.22");
  });

  it("shows fix version as group header with semicolons converted", () => {
    const rows = [
      makeRow({
        fix_version_names: "5.0.0;4.21.z",
        disposition: "proposed",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("### 5.0.0, 4.21.z (1)");
  });

  it("shows [PR] source indicator for direct PRs", () => {
    const rows = [makeRow({ pr_source: "direct" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("[PR]");
  });

  it("shows [Issue→PR] source indicator for issue-resolved PRs", () => {
    const rows = [makeRow({ pr_source: "issue_resolved" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("[Issue→PR]");
  });

  it("shows resolved date in proposed table", () => {
    const rows = [makeRow({ resolved_date: "2026-07-15T10:00:00Z" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("2026-07-15");
  });

  it("omits proposed section when there are no proposed rows", () => {
    const rows = [
      makeRow({ disposition: "skipped", reason: "no linked PR found" }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).not.toContain("## ✅ Proposed");
    expect(md).toContain("## ⏭️ Skipped");
  });

  it("omits needs_review section when count is zero", () => {
    const rows = [makeRow({ disposition: "proposed" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).not.toContain("## ⚠️ Needs Review");
  });

  it("omits skipped section when count is zero", () => {
    const rows = [makeRow({ disposition: "proposed" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).not.toContain("## ⏭️ Skipped");
  });

  it("includes date in title", () => {
    const rows = [makeRow()];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("2026-08-07");
  });

  it("truncates proposed summary to 80 chars", () => {
    const long = "A".repeat(85);
    const rows = [makeRow({ summary: long, disposition: "proposed" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("A".repeat(79) + "…");
  });

  it("truncates needs_review summary to 80 chars", () => {
    const long = "B".repeat(85);
    const rows = [
      makeRow({
        summary: long,
        disposition: "needs_review",
        merged_branches: "org/repo:unknown",
        reason: "Unknown branch(es): org/repo:unknown",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("B".repeat(79) + "…");
  });

  it("skipped section shows reason summary table, not per-ticket rows", () => {
    const rows = [
      makeRow({
        summary: "No PR here",
        disposition: "skipped",
        reason: "no linked PR or issue found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
      makeRow({
        key: "CNV-2",
        summary: "Also no PR",
        disposition: "skipped",
        reason: "no linked PR or issue found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("## ⏭️ Skipped (2)");
    expect(md).toContain("no linked PR or issue found");
    // 2 rows same reason: count with keys shown inline (≤5)
    expect(md).toContain("| 2 (CNV-1234, CNV-2) |");
    // keys appear as plain text in count cell, not as hyperlinks
    expect(md).not.toContain("[CNV-1234](");
    expect(md).not.toContain("[CNV-2](");
  });

  it("skipped section aggregates multiple reasons with counts and keys for rare ones", () => {
    const rows = [
      makeRow({
        key: "A-1",
        disposition: "skipped",
        reason: "no linked PR or issue found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
      makeRow({
        key: "A-2",
        disposition: "skipped",
        reason: "no linked PR or issue found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
      makeRow({
        key: "B-1",
        disposition: "skipped",
        reason: "issue linked but no closing PR found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("| no linked PR or issue found | 2 (A-1, A-2) |");
    expect(md).toContain("| issue linked but no closing PR found | 1 (B-1) |");
  });

  it("skipped section omits key list when reason has more than 5 tickets", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      makeRow({
        key: `MTA-${i}`,
        disposition: "skipped",
        reason: "no linked PR or issue found",
        merged_branches: "",
        fix_version_ids: "",
        fix_version_names: "",
      }),
    );
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("| no linked PR or issue found | 6 |");
    expect(md).not.toContain("MTA-0, MTA-1");
  });

  it("partial proposed rows show warning indicator in source column", () => {
    const rows = [
      makeRow({
        pr_source: "direct",
        reason: "Also merged to unknown branch(es): org/repo:release-0.9",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("[PR] ⚠️");
  });

  it("partial proposed rows with issue_resolved source show combined indicator", () => {
    const rows = [
      makeRow({
        pr_source: "issue_resolved",
        reason: "Also merged to unknown branch(es): org/repo:release-0.9",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("[Issue→PR] ⚠️");
  });

  it("legend appears when at least one partial proposed row exists", () => {
    const rows = [
      makeRow({
        reason: "Also merged to unknown branch(es): org/repo:release-0.9",
      }),
    ];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).toContain("⚠️ = also merged to branch(es) not in config");
  });

  it("legend is absent when no partial proposed rows exist", () => {
    const rows = [makeRow({ reason: "" })];
    const md = generateMarkdown(rows, "2026-08-07", BASE_URL);
    expect(md).not.toContain("⚠️ = also merged to branch(es) not in config");
  });
});

describe("config.example.json", () => {
  const examplePath = resolve(
    import.meta.dirname,
    "../data/config.example.json",
  );

  it("loads and parses without error", () => {
    const raw = readFileSync(examplePath, "utf-8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("has required top-level keys", () => {
    const config = JSON.parse(readFileSync(examplePath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(config).toHaveProperty("jira.cloud_id");
    expect(config).toHaveProperty("source.jql");
    expect(config).toHaveProperty("branchToFixVersion");
  });

  it("branchToFixVersion has at least one repo with a branch entry containing id and name", () => {
    const config = JSON.parse(readFileSync(examplePath, "utf-8")) as {
      branchToFixVersion: Record<
        string,
        Record<string, { id: string; name: string }>
      >;
    };
    const repos = Object.values(config.branchToFixVersion).filter(
      (v) => typeof v === "object" && !Array.isArray(v) && "main" in v,
    );
    expect(repos.length).toBeGreaterThan(0);
    const branches = Object.values(repos[0]);
    expect(branches.length).toBeGreaterThan(0);
    expect(branches[0]).toHaveProperty("id");
    expect(branches[0]).toHaveProperty("name");
  });

  it("has upcoming_changes array", () => {
    const config = JSON.parse(readFileSync(examplePath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(config.upcoming_changes)).toBe(true);
    const changes = config.upcoming_changes as Array<{
      date: string;
      description: string;
    }>;
    expect(changes[0]).toHaveProperty("date");
    expect(changes[0]).toHaveProperty("description");
  });

  it("includes konveyor/tackle2-ui with historical release branches", () => {
    const config = JSON.parse(readFileSync(examplePath, "utf-8")) as {
      branchToFixVersion: Record<
        string,
        Record<string, { id: string; name: string }>
      >;
    };
    const ktui = config.branchToFixVersion["konveyor/tackle2-ui"];
    expect(ktui).toBeDefined();
    expect(ktui["release-0.8"]).toBeDefined();
    expect(ktui["release-0.9"]).toBeDefined();
    expect(ktui["release-0.10"]).toBeDefined();
  });
});
