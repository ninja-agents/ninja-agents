import { readFileSync, existsSync } from "node:fs";

export interface FileCheck {
  path: string;
  exists: boolean;
  sections: string[];
  missingSections: string[];
  thinSections: string[];
  score: number;
}

export interface AuditReport {
  repoPath: string;
  files: FileCheck[];
  aiReadinessScore: number;
  timestamp: string;
}

export interface ExpectedSection {
  label: string;
  stems: string[];
}

export const REQUIRED_FILES: Record<string, ExpectedSection[]> = {
  "README.md": [
    {
      label: "overview",
      stems: ["overview", "descript", "about", "introduct"],
    },
    { label: "quick start", stems: ["quick", "start", "getting", "install"] },
    { label: "prerequisites", stems: ["prerequisit", "require"] },
    { label: "contributing", stems: ["contribut"] },
  ],
  "CONTRIBUTING.md": [
    {
      label: "dev setup",
      stems: ["setup", "install", "getting", "coding", "contribut"],
    },
    {
      label: "coding standards",
      stems: ["standard", "style", "convention", "lint", "format"],
    },
    {
      label: "PR process",
      stems: ["pull", "request", "submit", "review", "pr"],
    },
    { label: "testing", stems: ["test"] },
  ],
  "AGENTS.md": [
    { label: "overview", stems: ["overview", "project", "structur"] },
    {
      label: "conventions",
      stems: ["convention", "pattern", "standard", "naming"],
    },
    { label: "review guidelines", stems: ["review", "guidelin"] },
  ],
  "ARCHITECTURE.md": [
    { label: "components", stems: ["component", "modul", "structur", "view"] },
    { label: "data flow", stems: ["flow", "data", "how", "work", "pipeline"] },
    {
      label: "dependencies",
      stems: ["dependen", "stack", "package", "librar"],
    },
  ],
  ".coderabbit.yaml": [],
  "CLAUDE.md": [
    {
      label: "context pointers",
      stems: ["agent", "architectur", "contribut", "context"],
    },
    {
      label: "quick reference",
      stems: ["reference", "rule", "convention", "stack"],
    },
  ],
};

export const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bHACK\b/i,
  /\bWIP\b/i,
  /\bfill in later\b/i,
];

export const FILE_DESCRIPTIONS: Record<string, string> = {
  "README.md": "Repo-level foundational context for developers",
  "CONTRIBUTING.md": "Contribution conventions for humans and agents",
  "AGENTS.md": "AI-specific guidance and repo conventions",
  "ARCHITECTURE.md": "System design and component relationships",
  ".coderabbit.yaml": "CodeRabbit AI code review configuration",
  "CLAUDE.md": "Claude Code project context with pointers to detailed docs",
  ".cursor/rules/*.mdc":
    "Cursor project rules with conventions and context pointers",
};

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      args.help = true;
      return args;
    }
    if (argv[i] === "--dry-run") {
      args["dry-run"] = true;
    } else if (argv[i] === "--verbose") {
      args.verbose = true;
    } else if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

export function extractHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((l) => l.startsWith("#"))
    .map((l) => l.replace(/^#+\s*/, "").toLowerCase());
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function headingMatchesStem(
  headingTokens: string[],
  stem: string,
): boolean {
  return headingTokens.some(
    (token) => token.startsWith(stem) || stem.startsWith(token),
  );
}

export function sectionFound(
  headings: string[],
  section: ExpectedSection,
): boolean {
  return headings.some((heading) => {
    const tokens = tokenize(heading);
    return section.stems.some((stem) => headingMatchesStem(tokens, stem));
  });
}

export function findMissingSections(
  headings: string[],
  expected: ExpectedSection[],
): string[] {
  return expected
    .filter((section) => !sectionFound(headings, section))
    .map((section) => section.label);
}

interface Section {
  heading: string;
  level: number;
  body: string;
}

function headingLevel(line: string): number {
  const match = /^(#+)/.exec(line);
  return match ? match[1].length : 0;
}

export function extractSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentLevel = 0;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const lvl = headingLevel(line);
    if (lvl > 0) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          body: bodyLines.join("\n"),
        });
      }
      currentHeading = line.replace(/^#+\s*/, "").toLowerCase();
      currentLevel = lvl;
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      body: bodyLines.join("\n"),
    });
  }
  return sections;
}

export function findThinSections(
  content: string,
  expected: ExpectedSection[],
  minChars = 50,
): string[] {
  const sections = extractSections(content);
  const thin: string[] = [];

  for (const exp of expected) {
    const idx = sections.findIndex((s) => {
      const tokens = tokenize(s.heading);
      return exp.stems.some((stem) => headingMatchesStem(tokens, stem));
    });
    if (idx < 0) continue;

    const matched = sections[idx];
    let fullBody = matched.body;
    for (let i = idx + 1; i < sections.length; i++) {
      if (sections[i].level <= matched.level) break;
      fullBody += "\n" + sections[i].body;
    }

    const nonWhitespace = fullBody.replace(/\s+/g, "").length;
    if (nonWhitespace < minChars) {
      thin.push(exp.label);
    }
  }
  return thin;
}

export function headingToSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractHeadingsFromFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return extractHeadings(content);
}
