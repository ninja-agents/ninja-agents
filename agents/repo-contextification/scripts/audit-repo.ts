import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  type FileCheck,
  type AuditReport,
  REQUIRED_FILES,
  FILE_DESCRIPTIONS,
  parseArgs,
  extractHeadings,
  findMissingSections,
  findThinSections,
} from "./lib.js";

function auditFile(repoPath: string, filePath: string): FileCheck {
  const fullPath = join(repoPath, filePath);
  const expected = REQUIRED_FILES[filePath] ?? [];

  if (!existsSync(fullPath)) {
    return {
      path: filePath,
      exists: false,
      sections: [],
      missingSections: expected.map((s) => s.label),
      thinSections: [],
      score: 0,
    };
  }

  const content = readFileSync(fullPath, "utf-8");
  const headings = extractHeadings(content);
  const missing = findMissingSections(headings, expected);
  const thin = findThinSections(content, expected);
  const total = expected.length || 1;
  const fullCredit = total - missing.length - thin.length;
  const halfCredit = thin.length * 0.5;
  const score = Math.round(((fullCredit + halfCredit) / total) * 100);

  return {
    path: filePath,
    exists: true,
    sections: headings,
    missingSections: missing,
    thinSections: thin,
    score,
  };
}

function generateReport(report: AuditReport): string {
  const lines: string[] = [
    "# Repo Contextification Audit",
    "",
    `**Repo:** ${report.repoPath}`,
    `**Date:** ${report.timestamp}`,
    `**AI-Readiness Score:** ${report.aiReadinessScore}/100`,
    "",
    "## File Status",
    "",
    "| File | Status | Completeness | Issues |",
    "|------|--------|-------------|--------|",
  ];

  for (const f of report.files) {
    const status = f.exists ? "Present" : "**MISSING**";
    const score = f.exists ? `${f.score}%` : "N/A";
    const missing = f.missingSections.join(", ");
    const thin = f.thinSections.map((s) => `${s} (thin)`).join(", ");
    const issues = [missing, thin].filter(Boolean).join(", ") || "—";
    lines.push(`| ${f.path} | ${status} | ${score} | ${issues} |`);
  }

  lines.push("", "## Recommendations", "");

  const missingFiles = report.files.filter((f) => !f.exists);
  const incompleteFiles = report.files.filter(
    (f) => f.exists && f.missingSections.length > 0,
  );
  const thinFiles = report.files.filter(
    (f) => f.exists && f.thinSections.length > 0,
  );

  if (missingFiles.length > 0) {
    lines.push("### Missing Files (create these first)");
    for (const f of missingFiles) {
      lines.push(
        `- **${f.path}** — ${FILE_DESCRIPTIONS[f.path] ?? "Documentation file"}`,
      );
    }
    lines.push("");
  }

  if (incompleteFiles.length > 0) {
    lines.push("### Incomplete Files (add missing sections)");
    for (const f of incompleteFiles) {
      lines.push(`- **${f.path}** — missing: ${f.missingSections.join(", ")}`);
    }
    lines.push("");
  }

  if (thinFiles.length > 0) {
    lines.push("### Thin Sections (add more content)");
    for (const f of thinFiles) {
      lines.push(
        `- **${f.path}** — needs more content: ${f.thinSections.join(", ")}`,
      );
    }
    lines.push("");
  }

  if (
    missingFiles.length === 0 &&
    incompleteFiles.length === 0 &&
    thinFiles.length === 0
  ) {
    lines.push("All documentation files are present and complete.");
  }

  const complete = report.files
    .filter(
      (f) =>
        f.exists &&
        f.missingSections.length === 0 &&
        f.thinSections.length === 0,
    )
    .map((f) => f.path);
  const incomplete = report.files
    .filter(
      (f) =>
        !f.exists || f.missingSections.length > 0 || f.thinSections.length > 0,
    )
    .map((f) => f.path);

  lines.push(
    "",
    `<!-- AUDIT_SUMMARY`,
    `SCORE=${report.aiReadinessScore}`,
    `COMPLETE_FILES=${complete.join(",")}`,
    `INCOMPLETE_FILES=${incomplete.join(",")}`,
    `AUDIT_SUMMARY -->`,
  );

  return lines.join("\n");
}

function generateDryRunPlan(report: AuditReport): string {
  const lines: string[] = [
    "## Dry-Run Plan",
    "",
    "Actions the agent would perform:",
    "",
  ];

  for (const f of report.files) {
    if (!f.exists) {
      lines.push(
        `- **CREATE** \`${f.path}\` — ${FILE_DESCRIPTIONS[f.path] ?? "Documentation file"}`,
      );
    } else if (f.missingSections.length > 0 || f.thinSections.length > 0) {
      const actions: string[] = [];
      if (f.missingSections.length > 0)
        actions.push(`add sections: ${f.missingSections.join(", ")}`);
      if (f.thinSections.length > 0)
        actions.push(`expand sections: ${f.thinSections.join(", ")}`);
      lines.push(`- **UPDATE** \`${f.path}\` — ${actions.join("; ")}`);
    } else {
      lines.push(`- **SKIP** \`${f.path}\` — already complete (${f.score}%)`);
    }
  }

  lines.push("", "(Dry-run mode — no files were written)");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    console.log(
      "Usage: audit-repo.ts --repo-path <path> [--output <path>] [--dry-run]",
    );
    process.exit(0);
  }

  const dryRun = args["dry-run"] === true;

  if (args.github) {
    console.error(
      "GitHub mode requires MCP — run via the agent, not directly.",
    );
    process.exit(1);
  }

  const repoPath =
    typeof args["repo-path"] === "string" ? args["repo-path"] : process.cwd();
  if (!existsSync(repoPath)) {
    console.error(`Repo path not found: ${repoPath}`);
    process.exit(1);
  }

  const files = Object.keys(REQUIRED_FILES).map((f) => auditFile(repoPath, f));

  const cursorDir = join(repoPath, ".cursor", "rules");
  const hasCursorRules =
    existsSync(cursorDir) &&
    readdirSync(cursorDir).some((f) => f.endsWith(".mdc"));
  files.push({
    path: ".cursor/rules/*.mdc",
    exists: hasCursorRules,
    sections: [],
    missingSections: hasCursorRules ? [] : ["cursor rules"],
    thinSections: [],
    score: hasCursorRules ? 100 : 0,
  });

  const totalScore = files.reduce((sum, f) => sum + f.score, 0);
  const aiReadinessScore = Math.round(totalScore / files.length);

  const docsDir = join(repoPath, "docs");
  const hasDocs = existsSync(docsDir) && readdirSync(docsDir).length > 0;
  const bonusPoints = hasDocs ? 10 : 0;

  const report: AuditReport = {
    repoPath,
    files,
    aiReadinessScore: Math.min(100, aiReadinessScore + bonusPoints),
    timestamp: new Date().toISOString(),
  };

  let output = generateReport(report);
  if (dryRun) {
    output += "\n\n" + generateDryRunPlan(report);
  }

  const outputPath = typeof args.output === "string" ? args.output : undefined;
  if (outputPath && !dryRun) {
    writeFileSync(resolve(outputPath), output);
    console.log(`Audit report written to ${resolve(outputPath)}`);
  } else {
    console.log(output);
  }
}

main();
