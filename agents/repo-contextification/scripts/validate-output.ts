import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_FILES,
  PLACEHOLDER_PATTERNS,
  LINE_LIMITS,
  SETUP_COMMAND_PATTERNS,
  CI_HEADING_STEMS,
  parseArgs,
  extractHeadings,
  extractSections,
  tokenize,
  headingMatchesStem,
  headingToSlug,
} from "./lib.js";

export function checkLineLimits(
  repoPath: string,
  generatedFiles?: Set<string>,
): string[] {
  const warnings: string[] = [];

  const claudeMdPath = join(repoPath, "CLAUDE.md");
  if (
    existsSync(claudeMdPath) &&
    (!generatedFiles || generatedFiles.has("CLAUDE.md"))
  ) {
    const lineCount = readFileSync(claudeMdPath, "utf-8").split("\n").length;
    if (lineCount > LINE_LIMITS["CLAUDE.md"]) {
      warnings.push(
        `CLAUDE.md is ${lineCount} lines (limit: ${LINE_LIMITS["CLAUDE.md"]}) — keep it concise`,
      );
    }
  }

  const cursorRulesDir = join(repoPath, ".cursor", "rules");
  if (existsSync(cursorRulesDir)) {
    const mdcLimit = LINE_LIMITS[".cursor/rules/*.mdc"];
    for (const file of readdirSync(cursorRulesDir).filter((f) =>
      f.endsWith(".mdc"),
    )) {
      const relativePath = `.cursor/rules/${file}`;
      if (generatedFiles && !generatedFiles.has(relativePath)) continue;
      const filePath = join(cursorRulesDir, file);
      const lineCount = readFileSync(filePath, "utf-8").split("\n").length;
      if (lineCount > mdcLimit) {
        warnings.push(
          `.cursor/rules/${file} is ${lineCount} lines (limit: ${mdcLimit}) — keep it concise`,
        );
      }
    }
  }

  return warnings;
}

function isCiSection(heading: string): boolean {
  const tokens = tokenize(heading);
  return CI_HEADING_STEMS.some((stem) => headingMatchesStem(tokens, stem));
}

export function checkContributingDedup(repoPath: string): string[] {
  const contributingPath = join(repoPath, "CONTRIBUTING.md");
  if (!existsSync(contributingPath)) return [];

  const content = readFileSync(contributingPath, "utf-8");
  const sections = extractSections(content);
  const nonCiText = sections
    .filter((s) => !isCiSection(s.heading))
    .map((s) => s.body)
    .join("\n");

  const commands: string[] = [];
  for (const pattern of SETUP_COMMAND_PATTERNS) {
    const match = pattern.exec(nonCiText);
    if (match) commands.push(match[0]);
  }
  if (commands.length === 0) return [];

  return [
    `CONTRIBUTING.md contains setup commands (${commands.join(", ")}) — link to README.md instead of duplicating`,
  ];
}

export function validateMarkdownLinks(
  content: string,
  repoPath: string,
  sourceFile: string,
): string[] {
  const errors: string[] = [];
  const linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    const [, linkText, href] = match;
    if (!href || href.startsWith("http")) continue;

    if (href.startsWith("#")) {
      const ownSlugs = extractHeadings(content).map(headingToSlug);
      const anchor = href.slice(1);
      if (!ownSlugs.includes(anchor)) {
        errors.push(
          `${sourceFile}: broken anchor [${linkText ?? ""}](${href}) — heading not found`,
        );
      }
      continue;
    }

    const hashIdx = href.indexOf("#");
    const linkPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const anchor = hashIdx >= 0 ? href.slice(hashIdx + 1) : undefined;
    const targetPath = join(repoPath, linkPath);

    if (!existsSync(targetPath)) {
      errors.push(
        `${sourceFile}: broken link [${linkText ?? ""}](${href}) — file not found`,
      );
      continue;
    }

    if (anchor) {
      const targetContent = readFileSync(targetPath, "utf-8");
      const targetSlugs = extractHeadings(targetContent).map(headingToSlug);
      if (!targetSlugs.includes(anchor)) {
        errors.push(
          `${sourceFile}: broken anchor [${linkText ?? ""}](${href}) — heading "#${anchor}" not found in ${linkPath}`,
        );
      }
    }
  }
  return errors;
}

const CLAUDE_MD_EXPECTED_LINKS = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
];

export function checkClaudeMdContextLinks(repoPath: string): string[] {
  const claudeMdPath = join(repoPath, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return [];

  const content = readFileSync(claudeMdPath, "utf-8");
  const sections = extractSections(content);
  const contextSection = sections.find((s) =>
    tokenize(s.heading).some((t) => t.startsWith("context")),
  );
  if (!contextSection) return [];

  const missing = CLAUDE_MD_EXPECTED_LINKS.filter(
    (file) => !contextSection.body.includes(file),
  );
  if (missing.length === 0) return [];

  return [
    `CLAUDE.md Context section is missing links to: ${missing.join(", ")}`,
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    console.log("Usage: validate-output.ts --repo-path <path> [--verbose]");
    process.exit(0);
  }

  const verbose = args.verbose === true;
  const repoPath =
    typeof args["repo-path"] === "string" ? args["repo-path"] : process.cwd();

  if (!existsSync(repoPath)) {
    console.error(`Repo path not found: ${repoPath}`);
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredFiles = Object.keys(REQUIRED_FILES).filter(
    (f) => f !== ".coderabbit.yaml",
  );

  for (const file of requiredFiles) {
    const filePath = join(repoPath, file);
    if (!existsSync(filePath)) {
      errors.push(`Missing required file: ${file}`);
      continue;
    }

    const content = readFileSync(filePath, "utf-8");

    if (content.trim().length === 0) {
      errors.push(`${file} is empty`);
      continue;
    }

    const headings = extractHeadings(content);
    if (headings.length === 0) {
      warnings.push(`${file} has no markdown headings`);
    }

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(content)) {
        warnings.push(`${file} contains placeholder text: ${pattern.source}`);
      }
    }

    const linkErrors = validateMarkdownLinks(content, repoPath, file);
    errors.push(...linkErrors);
  }

  const coderabbitPath = join(repoPath, ".coderabbit.yaml");
  if (!existsSync(coderabbitPath)) {
    warnings.push(".coderabbit.yaml not found — CodeRabbit not configured");
  }

  warnings.push(...checkLineLimits(repoPath));
  warnings.push(...checkContributingDedup(repoPath));
  warnings.push(...checkClaudeMdContextLinks(repoPath));

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) found:`);
    errors.forEach((e) => console.error(`  ✗ ${e}`));
  }

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (errors.length === 0 && verbose) {
    console.log("✓ Validation passed");
  }

  process.exit(errors.length > 0 ? 1 : warnings.length > 0 ? 3 : 0);
}

if (process.argv[1]?.endsWith("validate-output.ts")) {
  main();
}
