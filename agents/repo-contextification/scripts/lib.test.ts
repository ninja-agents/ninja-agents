import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  parseGitRemoteUrl,
  isCacheFresh,
  prCacheFilePath,
  BOILERPLATE_PATTERNS,
  LINE_LIMITS,
  CI_INDICATORS,
  SETUP_COMMAND_PATTERNS,
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

describe("parseGitRemoteUrl", () => {
  it("parses HTTPS URL with .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("parses SSH URL with .git suffix", () => {
    expect(parseGitRemoteUrl("git@github.com:facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseGitRemoteUrl("git@github.com:facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("parses HTTPS URL with trailing slash", () => {
    expect(parseGitRemoteUrl("https://github.com/facebook/react/")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("returns null for non-GitHub HTTPS URLs", () => {
    expect(parseGitRemoteUrl("https://gitlab.com/org/repo.git")).toBeNull();
  });

  it("returns null for non-GitHub SSH URLs", () => {
    expect(parseGitRemoteUrl("git@bitbucket.org:org/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitRemoteUrl("")).toBeNull();
  });

  it("returns null when repo segment is missing", () => {
    expect(parseGitRemoteUrl("https://github.com/facebook")).toBeNull();
  });

  it("extracts owner/repo from URL with extra path segments", () => {
    expect(
      parseGitRemoteUrl("https://github.com/facebook/react/tree/main"),
    ).toEqual({ owner: "facebook", repo: "react" });
  });
});

describe("isCacheFresh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cache-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when file does not exist", () => {
    expect(isCacheFresh(join(tempDir, "missing.md"))).toBe(false);
  });

  it("returns true when file is within maxAgeMs", () => {
    const filePath = join(tempDir, "fresh.md");
    writeFileSync(filePath, "cached data");
    expect(isCacheFresh(filePath, 60_000)).toBe(true);
  });

  it("returns false when maxAgeMs is zero", () => {
    const filePath = join(tempDir, "stale.md");
    writeFileSync(filePath, "cached data");
    expect(isCacheFresh(filePath, 0)).toBe(false);
  });

  it("defaults to 24-hour TTL", () => {
    const filePath = join(tempDir, "default.md");
    writeFileSync(filePath, "cached data");
    expect(isCacheFresh(filePath)).toBe(true);
  });

  it("treats empty files as valid", () => {
    const filePath = join(tempDir, "empty.md");
    writeFileSync(filePath, "");
    expect(isCacheFresh(filePath, 60_000)).toBe(true);
  });
});

describe("BOILERPLATE_PATTERNS", () => {
  it("matches 'minimal template' text", () => {
    expect(
      BOILERPLATE_PATTERNS.some((p) => p.test("This is a minimal template")),
    ).toBe(true);
  });

  it("matches ExamplePage references", () => {
    expect(
      BOILERPLATE_PATTERNS.some((p) => p.test("See ExamplePage for usage")),
    ).toBe(true);
  });

  it("matches 'this is a starter' text", () => {
    expect(
      BOILERPLATE_PATTERNS.some((p) => p.test("This is a starter project")),
    ).toBe(true);
  });

  it("matches 'scaffolded from' text", () => {
    expect(
      BOILERPLATE_PATTERNS.some((p) => p.test("scaffolded from the template")),
    ).toBe(true);
  });

  it("does not match normal project content", () => {
    expect(
      BOILERPLATE_PATTERNS.some((p) =>
        p.test("A networking console plugin for OpenShift"),
      ),
    ).toBe(false);
  });
});

describe("LINE_LIMITS", () => {
  it("defines limit for CLAUDE.md", () => {
    expect(LINE_LIMITS["CLAUDE.md"]).toBe(40);
  });

  it("defines limit for cursor rules", () => {
    expect(LINE_LIMITS[".cursor/rules/*.mdc"]).toBe(30);
  });
});

describe("CI_INDICATORS", () => {
  it("includes GitHub Actions", () => {
    expect(CI_INDICATORS.some((i) => i.label === "GitHub Actions")).toBe(true);
  });

  it("includes Prow / CI Operator", () => {
    expect(CI_INDICATORS.some((i) => i.path === ".ci-operator.yaml")).toBe(
      true,
    );
  });

  it("includes GitLab CI", () => {
    expect(CI_INDICATORS.some((i) => i.path === ".gitlab-ci.yml")).toBe(true);
  });

  it("includes Prow OWNERS", () => {
    expect(CI_INDICATORS.some((i) => i.path === "OWNERS")).toBe(true);
  });
});

describe("SETUP_COMMAND_PATTERNS", () => {
  it("matches npm install", () => {
    expect(SETUP_COMMAND_PATTERNS.some((p) => p.test("Run npm install"))).toBe(
      true,
    );
  });

  it("matches npm ci", () => {
    expect(SETUP_COMMAND_PATTERNS.some((p) => p.test("npm ci"))).toBe(true);
  });

  it("matches yarn install", () => {
    expect(SETUP_COMMAND_PATTERNS.some((p) => p.test("yarn install"))).toBe(
      true,
    );
  });

  it("matches npm start", () => {
    expect(SETUP_COMMAND_PATTERNS.some((p) => p.test("npm start"))).toBe(true);
  });

  it("does not match unrelated commands", () => {
    expect(SETUP_COMMAND_PATTERNS.some((p) => p.test("npm test"))).toBe(false);
  });
});

describe("prCacheFilePath", () => {
  it("returns the conventional cache path", () => {
    expect(prCacheFilePath("facebook", "react")).toBe(
      "agents/repo-contextification/data/cache/facebook-react-pr-research.md",
    );
  });

  it("handles hyphenated owner and repo names", () => {
    expect(prCacheFilePath("my-org", "my-repo")).toBe(
      "agents/repo-contextification/data/cache/my-org-my-repo-pr-research.md",
    );
  });
});
