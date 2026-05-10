import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditFile,
  computeAiReadinessScore,
  generateReport,
  generateDryRunPlan,
} from "./audit-repo.js";
import type { AuditReport, FileCheck } from "./lib.js";

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
    expect(result.boilerplate).toBe(false);
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
    writeFileSync(
      join(tempDir, "README.md"),
      "# Project\n\n## Overview\n\n" + "x".repeat(60),
    );

    const result = auditFile(tempDir, "README.md");
    expect(result.exists).toBe(true);
    expect(result.missingSections).toContain("quick start");
    expect(result.missingSections).toContain("prerequisites");
    expect(result.missingSections).not.toContain("overview");
  });

  it("detects thin sections", () => {
    const content =
      "# Project\n\n## Overview\n\nToo short.\n\n## Quick Start\n\n" +
      "x".repeat(60);
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
    writeFileSync(
      join(tempDir, ".coderabbit.yaml"),
      "reviews:\n  enabled: true",
    );

    const result = auditFile(tempDir, ".coderabbit.yaml");
    expect(result.exists).toBe(true);
    expect(result.score).toBe(100);
    expect(result.missingSections).toEqual([]);
  });

  it("detects boilerplate content and caps score at 50", () => {
    const content = [
      "# My Project",
      "",
      "This is a minimal template for console plugins.",
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
    expect(result.boilerplate).toBe(true);
    expect(result.score).toBeLessThanOrEqual(50);
  });

  it("does not flag non-boilerplate content", () => {
    const content = [
      "# My Project",
      "",
      "## Overview",
      "",
      "A real project description here. " + "A".repeat(60),
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
    expect(result.boilerplate).toBe(false);
    expect(result.score).toBe(100);
  });

  it("populates the sections array with found headings", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Dev Setup\n\n## Testing",
    );

    const result = auditFile(tempDir, "CONTRIBUTING.md");
    expect(result.sections).toContain("contributing");
    expect(result.sections).toContain("dev setup");
    expect(result.sections).toContain("testing");
  });

  it("detects heading-only gaps when content exists without heading", () => {
    const content = [
      "# My Project",
      "",
      "A detailed description of the project with overview content. " +
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
    expect(result.headingOnlyGaps).toContain("overview");
    expect(result.missingSections).not.toContain("overview");
  });

  it("gives heading-only gaps 75% credit in score", () => {
    const content = [
      "# My Project",
      "",
      "A detailed description about this project. " + "A".repeat(60),
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
    expect(result.headingOnlyGaps).toContain("overview");
    expect(result.score).toBe(94); // 3 full + 0.75 heading-only = 3.75/4 = 93.75, rounds to 94
  });
});

describe("computeAiReadinessScore", () => {
  function makeFile(score: number): FileCheck {
    return {
      path: "test.md",
      exists: true,
      sections: [],
      missingSections: [],
      headingOnlyGaps: [],
      thinSections: [],
      boilerplate: false,
      score,
    };
  }

  it("averages file scores", () => {
    const files = [makeFile(100), makeFile(80)];
    expect(computeAiReadinessScore(files, false)).toBe(90);
  });

  it("adds 10-point bonus when all files are complete and docs exist", () => {
    const files = [makeFile(100), makeFile(100)];
    expect(computeAiReadinessScore(files, true)).toBe(100);
    expect(computeAiReadinessScore(files, false)).toBe(100);
  });

  it("does not award bonus when any file is incomplete", () => {
    const files = [
      makeFile(100),
      makeFile(100),
      makeFile(100),
      makeFile(100),
      makeFile(100),
      makeFile(100),
      makeFile(83),
    ];
    // Average: (600+83)/7 = 97.6 → 98. Without fix, bonus would push to 100.
    expect(computeAiReadinessScore(files, true)).toBe(98);
  });

  it("caps at 100 even with bonus", () => {
    const files = [makeFile(100)];
    expect(computeAiReadinessScore(files, true)).toBe(100);
  });
});

describe("generateReport", () => {
  function makeReport(overrides?: Partial<AuditReport>): AuditReport {
    return {
      repoPath: "/test/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
      aiReadinessScore: 50,
      ciSystems: [],
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: ["quick start"],
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
          score: 50,
        },
        {
          path: "CONTRIBUTING.md",
          exists: false,
          sections: [],
          missingSections: ["dev setup", "coding standards"],
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
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
          headingOnlyGaps: [],
          thinSections: ["overview"],
          boilerplate: false,
          score: 50,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain("### Thin Sections");
    expect(output).toContain("overview");
  });

  it("includes heading-only gaps in the recommendations", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["quick start"],
          missingSections: [],
          headingOnlyGaps: ["overview"],
          thinSections: [],
          boilerplate: false,
          score: 94,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain("### Heading-Only Gaps");
    expect(output).toContain("overview");
  });

  it("sets HEADING_ONLY=true when all gaps are heading-only", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["quick start"],
          missingSections: [],
          headingOnlyGaps: ["overview"],
          thinSections: [],
          boilerplate: false,
          score: 94,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain("HEADING_ONLY=true");
  });

  it("sets HEADING_ONLY=false when other gap types exist", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("HEADING_ONLY=false");
  });

  it("includes AUDIT_SUMMARY comment with machine-readable data", () => {
    const output = generateReport(makeReport());
    expect(output).toContain("<!-- AUDIT_SUMMARY");
    expect(output).toContain("SCORE=50");
    expect(output).toContain("INCOMPLETE_FILES=");
    expect(output).toContain("AUDIT_SUMMARY -->");
  });

  it("includes CI/CD systems in the report header", () => {
    const output = generateReport(
      makeReport({ ciSystems: ["GitHub Actions", "Prow OWNERS"] }),
    );
    expect(output).toContain("**CI/CD:** GitHub Actions, Prow OWNERS");
  });

  it("shows 'None detected' when no CI systems found", () => {
    const output = generateReport(makeReport({ ciSystems: [] }));
    expect(output).toContain("**CI/CD:** None detected");
  });

  it("shows all-complete message when no gaps exist", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
          score: 100,
        },
      ],
    });
    const output = generateReport(report);
    expect(output).toContain(
      "All documentation files are present and complete.",
    );
  });
});

describe("generateDryRunPlan", () => {
  function makeReport(overrides?: Partial<AuditReport>): AuditReport {
    return {
      repoPath: "/test/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
      aiReadinessScore: 50,
      ciSystems: [],
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
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
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
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
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
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: false,
          score: 100,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**SKIP** `CLAUDE.md`");
  });

  it("marks boilerplate files as REWRITE", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          headingOnlyGaps: [],
          thinSections: [],
          boilerplate: true,
          score: 50,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**REWRITE** `README.md`");
    expect(output).toContain("boilerplate");
  });

  it("includes expand action for thin sections", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["overview"],
          missingSections: [],
          headingOnlyGaps: [],
          thinSections: ["overview"],
          boilerplate: false,
          score: 50,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("expand sections: overview");
  });

  it("includes add headings action for heading-only gaps", () => {
    const report = makeReport({
      files: [
        {
          path: "README.md",
          exists: true,
          sections: ["quick start"],
          missingSections: [],
          headingOnlyGaps: ["overview"],
          thinSections: [],
          boilerplate: false,
          score: 94,
        },
      ],
    });
    const output = generateDryRunPlan(report);
    expect(output).toContain("**UPDATE** `README.md`");
    expect(output).toContain("add headings: overview");
  });

  it("includes dry-run footer", () => {
    const output = generateDryRunPlan(makeReport());
    expect(output).toContain("Dry-run mode");
    expect(output).toContain("no files were written");
  });
});
