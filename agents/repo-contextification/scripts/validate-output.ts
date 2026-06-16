import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_FILES,
  PLACEHOLDER_PATTERNS,
  LINE_LIMITS,
  SETUP_COMMAND_PATTERNS,
  COMMIT_FORMAT_PATTERNS,
  DIRECTORY_TREE_PATTERN,
  TECH_STACK_PATTERN,
  ARCHITECTURE_SUBDIRS,
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

export function checkContributingCommitDedup(repoPath: string): string[] {
  const contributingPath = join(repoPath, "CONTRIBUTING.md");
  if (!existsSync(contributingPath)) return [];

  const content = readFileSync(contributingPath, "utf-8");
  let hits = 0;
  for (const pattern of COMMIT_FORMAT_PATTERNS) {
    if (pattern.test(content)) hits++;
  }
  if (hits < 4) return [];

  return [
    `CONTRIBUTING.md duplicates commit message format (${hits} patterns matched) — link to README.md#development instead`,
  ];
}

export function checkArchitectureDedup(repoPath: string): string[] {
  const archPath = join(repoPath, "ARCHITECTURE.md");
  const agentsPath = join(repoPath, "AGENTS.md");
  if (!existsSync(archPath) || !existsSync(agentsPath)) return [];

  const archContent = readFileSync(archPath, "utf-8");
  const agentsContent = readFileSync(agentsPath, "utf-8");
  const warnings: string[] = [];

  if (
    DIRECTORY_TREE_PATTERN.test(archContent) &&
    DIRECTORY_TREE_PATTERN.test(agentsContent)
  ) {
    warnings.push(
      "ARCHITECTURE.md duplicates source directory tree from AGENTS.md — link to AGENTS.md instead",
    );
  }

  const depFlowPattern = /can import from/i;
  if (depFlowPattern.test(archContent) && depFlowPattern.test(agentsContent)) {
    warnings.push(
      "ARCHITECTURE.md duplicates dependency flow from AGENTS.md — link to AGENTS.md instead",
    );
  }

  return warnings;
}

export function checkArchitectureTechStackDedup(repoPath: string): string[] {
  const archPath = join(repoPath, "ARCHITECTURE.md");
  const agentsPath = join(repoPath, "AGENTS.md");
  if (!existsSync(archPath) || !existsSync(agentsPath)) return [];

  const archContent = readFileSync(archPath, "utf-8");
  const agentsContent = readFileSync(agentsPath, "utf-8");

  if (
    !TECH_STACK_PATTERN.test(archContent) ||
    !TECH_STACK_PATTERN.test(agentsContent)
  ) {
    return [];
  }

  const archSections = extractSections(archContent);
  const stackSection = archSections.find((s) =>
    TECH_STACK_PATTERN.test(s.heading),
  );
  if (!stackSection) return [];

  const hasTable = /\|.*\|.*\|/.test(stackSection.body);
  const hasList =
    /^[-*]\s+\*?\*?(?:React|TypeScript|PatternFly|Webpack|Vite|Next|Jest|Playwright)/im.test(
      stackSection.body,
    );
  if (!hasTable && !hasList) return [];

  return [
    "ARCHITECTURE.md duplicates technology stack from AGENTS.md — link to AGENTS.md instead",
  ];
}

export function checkCoderabbitAgentsReference(repoPath: string): string[] {
  const coderabbitPath = join(repoPath, ".coderabbit.yaml");
  const agentsPath = join(repoPath, "AGENTS.md");
  if (!existsSync(coderabbitPath) || !existsSync(agentsPath)) return [];

  const content = readFileSync(coderabbitPath, "utf-8");
  if (content.includes("AGENTS.md")) return [];

  return [
    ".coderabbit.yaml does not reference AGENTS.md — add a top-level instruction directing CodeRabbit to read AGENTS.md for coding standards",
  ];
}

export function checkCoderabbitFeatureModuleCoverage(
  repoPath: string,
): string[] {
  const coderabbitPath = join(repoPath, ".coderabbit.yaml");
  if (!existsSync(coderabbitPath)) return [];

  const content = readFileSync(coderabbitPath, "utf-8");
  const srcDir = join(repoPath, "src");
  if (!existsSync(srcDir)) return [];

  const featureModules: string[] = [];
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      existsSync(join(srcDir, entry.name, "dynamic-plugin.ts"))
    ) {
      featureModules.push(entry.name);
    }
  }

  if (featureModules.length === 0) return [];

  const missing = featureModules.filter(
    (mod) => !content.includes(`src/${mod}/`),
  );
  if (missing.length === 0) return [];

  return [
    `.coderabbit.yaml is missing path instructions for feature modules: ${missing.join(", ")}`,
  ];
}

const STANDALONE_DOC_TOPICS: { files: string[]; topic: string }[] = [
  { files: ["VERSIONING.md"], topic: "versioning" },
  {
    files: ["INTERNATIONALIZATION.md", "I18N.md"],
    topic: "internationalization",
  },
  { files: ["SECURITY.md"], topic: "security" },
  { files: ["docs/development.md", "DEVELOPMENT.md"], topic: "development" },
];

export function checkContributingExistingDocDedup(repoPath: string): string[] {
  const contributingPath = join(repoPath, "CONTRIBUTING.md");
  if (!existsSync(contributingPath)) return [];

  const content = readFileSync(contributingPath, "utf-8");
  const sections = extractSections(content);
  const warnings: string[] = [];

  for (const { files, topic } of STANDALONE_DOC_TOPICS) {
    const existingDoc = files.find((f) => existsSync(join(repoPath, f)));
    if (!existingDoc) continue;

    const matchingSection = sections.find((s) =>
      tokenize(s.heading).some((t) => t.startsWith(topic.slice(0, 6))),
    );
    if (!matchingSection) continue;

    const bodyLines = matchingSection.body
      .split("\n")
      .filter((l) => l.trim().length > 0);
    if (bodyLines.length > 2) {
      warnings.push(
        `CONTRIBUTING.md duplicates content from ${existingDoc} in "${matchingSection.heading}" section — link to it instead`,
      );
    }
  }

  return warnings;
}

export function checkArchitectureSubdirLink(repoPath: string): string[] {
  const archPath = join(repoPath, "ARCHITECTURE.md");
  if (!existsSync(archPath)) return [];

  const subdirDoc = ARCHITECTURE_SUBDIRS.find((p) =>
    existsSync(join(repoPath, p)),
  );
  if (!subdirDoc) return [];

  const content = readFileSync(archPath, "utf-8");
  if (content.includes(subdirDoc)) return [];

  return [
    `ARCHITECTURE.md does not link to existing ${subdirDoc} — add a link to avoid content duplication`,
  ];
}

export function checkDocumentedCiFilenames(repoPath: string): string[] {
  const warnings: string[] = [];
  const workflowsDir = join(repoPath, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];

  const actualWorkflows = new Set(
    readdirSync(workflowsDir).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
    ),
  );

  const docsToCheck = ["ARCHITECTURE.md", "AGENTS.md"];
  const ciFilePattern = /`([a-zA-Z0-9._-]+\.ya?ml)`/g;

  for (const docFile of docsToCheck) {
    const docPath = join(repoPath, docFile);
    if (!existsSync(docPath)) continue;

    const content = readFileSync(docPath, "utf-8");
    const sections = extractSections(content);
    const ciSections = sections.filter((s) => isCiSection(s.heading));
    if (ciSections.length === 0) continue;

    const ciText = ciSections.map((s) => s.body).join("\n");
    let match: RegExpExecArray | null;
    while ((match = ciFilePattern.exec(ciText)) !== null) {
      const filename = match[1];
      if (!actualWorkflows.has(filename)) {
        warnings.push(
          `${docFile} references CI workflow \`${filename}\` but .github/workflows/${filename} does not exist`,
        );
      }
    }
  }

  return warnings;
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
      if (
        file === "ARCHITECTURE.md" &&
        ARCHITECTURE_SUBDIRS.some((p) => existsSync(join(repoPath, p)))
      ) {
        warnings.push(
          `ARCHITECTURE.md not at repo root — exists as subdirectory doc (acceptable)`,
        );
      } else {
        errors.push(`Missing required file: ${file}`);
      }
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

    const proseContent = content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "");
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(proseContent)) {
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
  warnings.push(...checkContributingCommitDedup(repoPath));
  warnings.push(...checkContributingExistingDocDedup(repoPath));
  warnings.push(...checkArchitectureDedup(repoPath));
  warnings.push(...checkArchitectureTechStackDedup(repoPath));
  warnings.push(...checkArchitectureSubdirLink(repoPath));
  warnings.push(...checkClaudeMdContextLinks(repoPath));
  warnings.push(...checkCoderabbitAgentsReference(repoPath));
  warnings.push(...checkCoderabbitFeatureModuleCoverage(repoPath));
  warnings.push(...checkDocumentedCiFilenames(repoPath));

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
