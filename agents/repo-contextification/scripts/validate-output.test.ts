import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateMarkdownLinks,
  checkLineLimits,
  checkContributingDedup,
  checkClaudeMdContextLinks,
} from "./validate-output.js";
import { LINE_LIMITS } from "./lib.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "validate-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("validateMarkdownLinks", () => {
  it("returns no errors for content with no links", () => {
    const errors = validateMarkdownLinks(
      "Just plain text.",
      tempDir,
      "README.md",
    );
    expect(errors).toEqual([]);
  });

  it("ignores external HTTP links", () => {
    const content = "[Example](https://example.com)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toEqual([]);
  });

  it("returns no errors for valid file links", () => {
    writeFileSync(join(tempDir, "CONTRIBUTING.md"), "# Contributing");
    const content = "[Contributing](CONTRIBUTING.md)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toEqual([]);
  });

  it("detects broken file links", () => {
    const content = "[Guide](NONEXISTENT.md)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken link");
    expect(errors[0]).toContain("NONEXISTENT.md");
    expect(errors[0]).toContain("file not found");
  });

  it("validates anchor links within the same file", () => {
    const content = "# Overview\n\n[Jump](#overview)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toEqual([]);
  });

  it("detects broken anchor links within the same file", () => {
    const content = "# Overview\n\n[Jump](#nonexistent-section)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken anchor");
    expect(errors[0]).toContain("nonexistent-section");
  });

  it("validates cross-file anchor links", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Dev Setup\n\nContent.",
    );
    const content = "[Setup](CONTRIBUTING.md#dev-setup)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toEqual([]);
  });

  it("detects broken cross-file anchor links", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Dev Setup",
    );
    const content = "[Testing](CONTRIBUTING.md#testing)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken anchor");
    expect(errors[0]).toContain("#testing");
    expect(errors[0]).toContain("CONTRIBUTING.md");
  });

  it("detects broken link when file exists but anchor is wrong", () => {
    writeFileSync(join(tempDir, "AGENTS.md"), "# Agents\n\n## Conventions");
    const content = "[Bad anchor](AGENTS.md#nonexistent)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken anchor");
  });

  it("handles multiple links and reports all errors", () => {
    writeFileSync(join(tempDir, "CONTRIBUTING.md"), "# Contributing");
    const content = [
      "[Valid](CONTRIBUTING.md)",
      "[Missing file](NOPE.md)",
      "[Bad anchor](#does-not-exist)",
    ].join("\n");
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toHaveLength(2);
  });

  it("includes source file name in error messages", () => {
    const content = "[Missing](NOPE.md)";
    const errors = validateMarkdownLinks(content, tempDir, "AGENTS.md");
    expect(errors[0]).toMatch(/^AGENTS\.md:/);
  });

  it("handles links to files in subdirectories", () => {
    mkdirSync(join(tempDir, "docs"), { recursive: true });
    writeFileSync(join(tempDir, "docs", "guide.md"), "# Guide");
    const content = "[Guide](docs/guide.md)";
    const errors = validateMarkdownLinks(content, tempDir, "README.md");
    expect(errors).toEqual([]);
  });
});

describe("checkLineLimits", () => {
  it("returns no warnings when files are within limits", () => {
    const lines = Array(LINE_LIMITS["CLAUDE.md"]).fill("line").join("\n");
    writeFileSync(join(tempDir, "CLAUDE.md"), lines);
    expect(checkLineLimits(tempDir)).toEqual([]);
  });

  it("warns when CLAUDE.md exceeds line limit", () => {
    const lines = Array(LINE_LIMITS["CLAUDE.md"] + 10)
      .fill("line")
      .join("\n");
    writeFileSync(join(tempDir, "CLAUDE.md"), lines);
    const warnings = checkLineLimits(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLAUDE.md");
    expect(warnings[0]).toContain(`limit: ${LINE_LIMITS["CLAUDE.md"]}`);
  });

  it("warns when .mdc files exceed line limit", () => {
    mkdirSync(join(tempDir, ".cursor", "rules"), { recursive: true });
    const lines = Array(LINE_LIMITS[".cursor/rules/*.mdc"] + 5)
      .fill("line")
      .join("\n");
    writeFileSync(join(tempDir, ".cursor", "rules", "project.mdc"), lines);
    const warnings = checkLineLimits(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("project.mdc");
  });

  it("returns no warnings when files do not exist", () => {
    expect(checkLineLimits(tempDir)).toEqual([]);
  });

  it("ignores non-mdc files in cursor rules directory", () => {
    mkdirSync(join(tempDir, ".cursor", "rules"), { recursive: true });
    const lines = Array(100).fill("line").join("\n");
    writeFileSync(join(tempDir, ".cursor", "rules", "notes.txt"), lines);
    expect(checkLineLimits(tempDir)).toEqual([]);
  });
});

describe("checkContributingDedup", () => {
  it("returns no warnings when CONTRIBUTING.md does not exist", () => {
    expect(checkContributingDedup(tempDir)).toEqual([]);
  });

  it("returns no warnings when CONTRIBUTING.md has no setup commands", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nSee [README](README.md) for setup.\n\n## Testing\n\nRun `npm test`.",
    );
    expect(checkContributingDedup(tempDir)).toEqual([]);
  });

  it("warns when CONTRIBUTING.md contains npm install", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Setup\n\nRun `npm install` to get started.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CONTRIBUTING.md");
    expect(warnings[0]).toContain("npm install");
    expect(warnings[0]).toContain("link to README.md");
  });

  it("warns when CONTRIBUTING.md contains npm ci", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Dev Setup\n\n```bash\nnpm ci\n```",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("npm ci");
  });

  it("warns when CONTRIBUTING.md contains yarn install", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nFirst, run yarn install.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("yarn install");
  });

  it("lists multiple matching commands in one warning", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nRun `npm install` then `npm start`.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("npm install");
    expect(warnings[0]).toContain("npm start");
  });

  it("warns when CONTRIBUTING.md contains go mod download", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Setup\n\n```bash\ngo mod download\n```",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("go mod download");
  });

  it("warns when CONTRIBUTING.md contains pip install", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nRun `pip install -r requirements.txt`.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("pip install");
  });

  it("warns when CONTRIBUTING.md contains make install", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nRun `make install` to build.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("make install");
  });

  it("warns when CONTRIBUTING.md contains cargo build", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\nRun `cargo build` to compile.",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cargo build");
  });

  it("skips setup commands under CI/Pipeline headings", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Testing\n\nRun `npm test`.\n\n## CI Pipeline\n\nThe CI job runs `npm ci` and `npm install`.\n",
    );
    expect(checkContributingDedup(tempDir)).toEqual([]);
  });

  it("skips setup commands under Prow headings", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## What Prow Does\n\nThe `test-prow-e2e.sh` script installs dependencies with `npm ci`.\n",
    );
    expect(checkContributingDedup(tempDir)).toEqual([]);
  });

  it("still warns for setup commands outside CI sections", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Setup\n\nRun `npm install` to get started.\n\n## CI Pipeline\n\nCI also runs `npm ci`.\n",
    );
    const warnings = checkContributingDedup(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("npm install");
    expect(warnings[0]).not.toContain("npm ci");
  });

  it("skips commands under Continuous Integration heading", () => {
    writeFileSync(
      join(tempDir, "CONTRIBUTING.md"),
      "# Contributing\n\n## Continuous Integration\n\nThe workflow runs `go mod download` and `go build`.\n",
    );
    expect(checkContributingDedup(tempDir)).toEqual([]);
  });
});

describe("checkClaudeMdContextLinks", () => {
  it("returns no warnings when CLAUDE.md does not exist", () => {
    expect(checkClaudeMdContextLinks(tempDir)).toEqual([]);
  });

  it("returns no warnings when all context links are present", () => {
    writeFileSync(
      join(tempDir, "CLAUDE.md"),
      "# Project\n\n## Context\n\n- [Agents](AGENTS.md)\n- [Architecture](ARCHITECTURE.md)\n- [Contributing](CONTRIBUTING.md)\n",
    );
    expect(checkClaudeMdContextLinks(tempDir)).toEqual([]);
  });

  it("warns when context links are missing", () => {
    writeFileSync(
      join(tempDir, "CLAUDE.md"),
      "# Project\n\n## Context\n\n- [Agents](AGENTS.md)\n",
    );
    const warnings = checkClaudeMdContextLinks(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ARCHITECTURE.md");
    expect(warnings[0]).toContain("CONTRIBUTING.md");
  });

  it("returns no warnings when CLAUDE.md has no Context section", () => {
    writeFileSync(
      join(tempDir, "CLAUDE.md"),
      "# Project\n\n## Quick Reference\n\nSome rules here.\n",
    );
    expect(checkClaudeMdContextLinks(tempDir)).toEqual([]);
  });

  it("warns when Context section exists but has no links", () => {
    writeFileSync(
      join(tempDir, "CLAUDE.md"),
      "# Project\n\n## Context\n\nSee the documentation for details.\n",
    );
    const warnings = checkClaudeMdContextLinks(tempDir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("AGENTS.md");
    expect(warnings[0]).toContain("ARCHITECTURE.md");
    expect(warnings[0]).toContain("CONTRIBUTING.md");
  });
});
