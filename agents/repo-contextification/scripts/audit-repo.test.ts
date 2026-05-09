import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { auditFile, generateReport, generateDryRunPlan } from "./audit-repo.js";
import type { AuditReport } from "./lib.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "audit-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("auditFile", () => {
  it("returns score 0 and all sections missing for a nonexistent file", () => {
    const result = auditFile(tempDir, "README.md");
    expect(result.exists).toBe(false);
    expect(result.score).toBe(0);
    expect(result.missingSections).toContain("overview");
    expect(result.missingSections).toContain("quick start");
  });

  it("returns score 100 when all expected sections are present and substantial", () => {
    const content = [
      "# My Project",
      "",
      "## Overview",
      "",
      "A".repeat(60),
      "",
      "## Quick Start",
      "",
      "B".repeat(60),
      "",
      "## Prerequisites",
      "",
      "C".repeat(60),
      "",
      "## Contributing",
      "",
      "D".repeat(60),
    ].join("\n");
    writeFileSync(join(tempDir, "README.md"), content);

    const result = auditFile(tempDir, "README.md");
    expect(result.exists).toBe(true);
    expect(result.score).toBe(100);
    expect(result.missingSections).toEqual([]);
    expect(result.thinSections).toEqual([]);
  });

  it("detects missing sections", () => {
    writeFileSync(join(tempDir, "README.md"), "# Project\n\n## Overview\n\n" + "x".repeat(60));

    const result = auditFile(tempDir, "README.md");
    expect(result.exists).toBe(true);
    expect(result.missingSections).toContain("quick start");
    expect(result.missingSections).toContain("prerequisites");
    expect(result.missingSections).not.toContain("overview");
  });

  it("detects thin sections", () => {
    const content = "# Project\n\n## Overview\n\nToo short.\n\n## Quick Start\n\n" + "x".repeat(60);
    writeFileSync(join(tempDir, "README.md"), content);

    const result = auditFile(tempDir, "README.md");
    expect(result.thinSections).toContain("overview");
    expect(result.thinSections).not.toContain("quick start");
  });

  it("gives half credit for thin sections in the score", () => {
    const content = [
      "# Project",
      "",
      "## Overview",
      "",
      "Short.",
      "",
      "## Quick Start",
      "",
      "x".repeat(60),
      "",
      "## Prerequisites",
      "",
      "x".repeat(60),
      "",
      "## Contributing",
      "",
      "x".repeat(60),
    ].join("\n");
    writeFileSync(join(tempDir, "README.md"), content);

    const result = auditFile(tempDir, "README.md");
    expect(result.thinSections).toEqual(["overview"]);
    expect(result.score).toBe(88); // 3 full + 0.5 thin = 3.5/4 = 87.5, rounds to 88
  });

  it("returns empty sections for files with no expected sections", () => {
    writeFileSync(join(tempDir, ".coderabbit.yaml"), "reviews:\n  enabled: true");

    const result = auditFile(tempDir, ".coderabbit.yaml");
    expect(result.exists).toBe(true);
    expect(result.score).toBe(100);
    expect(result.missingSections).toEqual([]);
  });

  it("populates the sections array with found headings", () => {
    writeFileSync(join(tempDir, "CONTRIBUTING.md"), "# Contributing\n\n## Dev Setup\n\n## Testing");

    const result = auditFile(tempDir, "CONTRIBUTING.md");
    expect(result.sections).toContain("contributing");
    expect(result.sections).toContain("dev setup");
    expect(result.sections).toContain("testing");
  });
});

describe("generateReport", () => {
  function makeReport(overrides?: Partial<AuditReport>): AuditReport {
    return {
      repoPath: "/test/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
      aiReadinessScore: 50,
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: ["quick start"],
          thinSections: [],
          score: 50,
        },
        {
          path: "CONTRIBUTING.md",
          exists: false,
          sections: [],
          missingSections: ["dev setup", "coding standards"],
          thinSections: [],
          score: 0,
        },
      ],
      ...overrides,
    };
  }

  it("includes the repo path and score in the header", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("**Repo:** /test/repo");
    expect(output).toContain("**AI-Readiness Score:** 50/100");
  });

  it("marks missing files as MISSING in the table", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("| CONTRIBUTING.md | **MISSING** |");
  });

  it("marks present files as Present in the table", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("| README.md | Present |");
  });

  it("lists missing files in the recommendations", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("### Missing Files");
    expect(output).toContain("**CONTRIBUTING.md**");
  });

  it("lists incomplete files in the recommendations", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("### Incomplete Files");
    expect(output).toContain("README.md");
    expect(output).toContain("quick start");
  });

  it("includes thin sections in the recommendations", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          thinSections: ["overview"],
          score: 50,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain("### Thin Sections");
    expect(output).toContain("overview");
  });

  it("includes AUDIT_SUMMARY comment with machine-readable data", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("<!-- AUDIT_SUMMARY");
    expect(output).toContain("SCORE=50");
    expect(output).toContain("INCOMPLETE_FILES=");
    expect(output).toContain("AUDIT_SUMMARY -->");
  });

  it("shows all-complete message when no gaps exist", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          thinSections: [],
          score: 100,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain("All documentation files are present and complete.");
  });
});

describe("generateDryRunPlan", () => {
  function makeReport(overrides?: Partial<AuditReport>): AuditReport {
    return {
      repoPath: "/test/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
      aiReadinessScore: 50,
      files: [],
      ...overrides,
    };
  }

  it("marks missing files as CREATE", () => {
    const report = makeReport({
      files: [
        {
          path: "AGENTS.md",
          exists: false,
          sections: [],
          missingSections: ["overview"],
          thinSections: [],
          score: 0,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**CREATE** `AGENTS.md`");
  });

  it("marks incomplete files as UPDATE", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: ["quick start"],
          thinSections: [],
          score: 50,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**UPDATE** `README.md`");
    expect(output).toContain("add sections: quick start");
  });

  it("marks complete files as SKIP", () => {
    const report = makeReport({
      files: [
        {
          path: "CLAUDE.md",
          exists: true,
          sections: ["context"],
          missingSections: [],
          thinSections: [],
          score: 100,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**SKIP** `CLAUDE.md`");
  });

  it("includes expand action for thin sections", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          thinSections: ["overview"],
          score: 50,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("expand sections: overview");
  });

  it("includes dry-run footer", () => {
    const output = generateDryRunPlan(makeReport());
    expect(output).toContain("Dry-run mode");
    expect(output).toContain("no files were written");
  });
});
