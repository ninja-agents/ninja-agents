import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateMarkdownLinks } from "./validate-output.js";

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
