import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_FILES,
  PLACEHOLDER_PATTERNS,
  parseArgs,
  extractHeadings,
  headingToSlug,
} from "./lib.js";

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
