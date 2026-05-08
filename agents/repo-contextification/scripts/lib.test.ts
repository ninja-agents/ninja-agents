import { describe, it, expect } from "vitest";
import {
  parseArgs,
  extractHeadings,
  tokenize,
  headingMatchesStem,
  sectionFound,
  findMissingSections,
  extractSections,
  findThinSections,
  headingToSlug,
  type ExpectedSection,
} from "./lib.js";

describe("parseArgs", () => {
  it("parses string arguments", () => {
    const args = parseArgs(["--repo-path", "/tmp", "--output", "report.md"]);
    expect(args["repo-path"]).toBe("/tmp");
    expect(args.output).toBe("report.md");
  });

  it("parses boolean flags", () => {
    const args = parseArgs(["--dry-run", "--verbose"]);
    expect(args["dry-run"]).toBe(true);
    expect(args.verbose).toBe(true);
  });

  it("returns help flag and stops", () => {
    const args = parseArgs(["--help", "--repo-path", "/tmp"]);
    expect(args.help).toBe(true);
    expect(args["repo-path"]).toBeUndefined();
  });

  it("handles empty argv", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("mixes string and boolean args", () => {
    const args = parseArgs(["--repo-path", "/tmp", "--dry-run"]);
    expect(args["repo-path"]).toBe("/tmp");
    expect(args["dry-run"]).toBe(true);
  });
});

describe("extractHeadings", () => {
  it("extracts headings at all levels", () => {
    const content = "# Title\n\nText\n\n## Section\n\n### Sub";
    expect(extractHeadings(content)).toEqual(["title", "section", "sub"]);
  });

  it("returns empty array for no headings", () => {
    expect(extractHeadings("Just plain text\nNo headings")).toEqual([]);
  });

  it("strips leading hashes and whitespace", () => {
    expect(extractHeadings("###   Spaced Heading")).toEqual(["spaced heading"]);
  });
});

describe("tokenize", () => {
  it("splits on non-alphanumeric characters", () => {
    expect(tokenize("Quick Start")).toEqual(["quick", "start"]);
  });

  it("handles hyphens and special chars", () => {
    expect(tokenize("CI/CD Config")).toEqual(["ci", "cd", "config"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("headingMatchesStem", () => {
  it("matches when token starts with stem", () => {
    expect(headingMatchesStem(["contributing"], "contribut")).toBe(true);
  });

  it("matches when stem starts with token", () => {
    expect(headingMatchesStem(["test"], "testing")).toBe(true);
  });

  it("does not match unrelated tokens", () => {
    expect(headingMatchesStem(["architecture"], "contribut")).toBe(false);
  });
});

describe("sectionFound", () => {
  const section: ExpectedSection = {
    label: "overview",
    stems: ["overview", "descript", "about"],
  };

  it("finds section by exact heading", () => {
    expect(sectionFound(["overview", "quick start"], section)).toBe(true);
  });

  it("finds section by stem prefix", () => {
    expect(sectionFound(["description", "setup"], section)).toBe(true);
  });

  it("returns false when no heading matches", () => {
    expect(sectionFound(["setup", "testing"], section)).toBe(false);
  });
});

describe("findMissingSections", () => {
  const expected: ExpectedSection[] = [
    { label: "overview", stems: ["overview"] },
    { label: "setup", stems: ["setup", "install"] },
    { label: "testing", stems: ["test"] },
  ];

  it("returns all labels when no headings match", () => {
    expect(findMissingSections([], expected)).toEqual([
      "overview",
      "setup",
      "testing",
    ]);
  });

  it("returns only missing labels", () => {
    expect(findMissingSections(["overview", "tests"], expected)).toEqual([
      "setup",
    ]);
  });

  it("returns empty array when all match", () => {
    expect(
      findMissingSections(["overview", "installation", "testing"], expected),
    ).toEqual([]);
  });
});

describe("extractSections", () => {
  it("splits content into heading/body pairs", () => {
    const content = "# Title\n\nIntro text\n\n## Section\n\nBody here";
    const sections = extractSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("title");
    expect(sections[0].level).toBe(1);
    expect(sections[1].heading).toBe("section");
    expect(sections[1].level).toBe(2);
    expect(sections[1].body).toContain("Body here");
  });

  it("keeps sub-headings as separate sections", () => {
    const content = "## Parent\n\nParent body\n\n### Child\n\nChild body";
    const sections = extractSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("parent");
    expect(sections[1].heading).toBe("child");
  });

  it("returns empty array for content with no headings", () => {
    expect(extractSections("Just text")).toEqual([]);
  });
});

describe("findThinSections", () => {
  const expected: ExpectedSection[] = [
    { label: "overview", stems: ["overview"] },
  ];

  it("flags sections with minimal content", () => {
    const content = "## Overview\n\nShort.";
    expect(findThinSections(content, expected)).toEqual(["overview"]);
  });

  it("passes sections with substantial content", () => {
    const longBody = "x".repeat(60);
    const content = `## Overview\n\n${longBody}`;
    expect(findThinSections(content, expected)).toEqual([]);
  });

  it("includes sub-heading content in parent body", () => {
    const content = "## Overview\n\nBrief.\n\n### Details\n\n" + "x".repeat(60);
    expect(findThinSections(content, expected)).toEqual([]);
  });

  it("respects custom minChars threshold", () => {
    const content = "## Overview\n\n" + "x".repeat(30);
    expect(findThinSections(content, expected, 20)).toEqual([]);
    expect(findThinSections(content, expected, 40)).toEqual(["overview"]);
  });

  it("ignores missing sections (handled elsewhere)", () => {
    const content = "## Setup\n\nSome content here.";
    expect(findThinSections(content, expected)).toEqual([]);
  });
});

describe("headingToSlug", () => {
  it("converts heading to GitHub-style slug", () => {
    expect(headingToSlug("Quick Start")).toBe("quick-start");
  });

  it("strips special characters", () => {
    expect(headingToSlug("What's New?")).toBe("whats-new");
  });

  it("collapses multiple hyphens", () => {
    expect(headingToSlug("CI / CD  Config")).toBe("ci-cd-config");
  });

  it("handles already-lowercase text", () => {
    expect(headingToSlug("overview")).toBe("overview");
  });

  it("trims leading and trailing hyphens", () => {
    expect(headingToSlug("- Heading -")).toBe("heading");
  });
});
