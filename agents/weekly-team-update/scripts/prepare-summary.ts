#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export class SummaryPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummaryPreparationError";
  }
}

export function extractSummary(report: string): string {
  const headings = [...report.matchAll(/^## Summary[ \t]*\r?$/gm)];
  if (headings.length !== 1 || headings[0].index === undefined) {
    throw new SummaryPreparationError(
      "Report must contain exactly one ## Summary section",
    );
  }

  const start = headings[0].index;
  const tail = report.slice(start + headings[0][0].length);
  const nextSection = tail.search(/^## [^\r\n]+/gm);
  const summary = report
    .slice(
      start,
      nextSection < 0 ? undefined : start + headings[0][0].length + nextSection,
    )
    .trimEnd();

  if (
    !/^### Highlights[ \t]*\r?$/m.test(summary) ||
    !/^### (?!Highlights[ \t]*\r?$)[^\r\n]+/m.test(summary)
  ) {
    throw new SummaryPreparationError(
      "Summary needs Highlights and at least one product subsection",
    );
  }
  if (
    /<!--\s*[A-Z_]*PLACEHOLDER\s*-->|- \((?:highlights|summary) pending\)/i.test(
      summary,
    )
  ) {
    throw new SummaryPreparationError(
      "Summary still contains a placeholder or pending text",
    );
  }

  return summary + "\n";
}

export function targetPathForDate(reportDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new SummaryPreparationError(
      "Report filename must contain a YYYY-MM-DD date",
    );
  }

  const date = new Date(`${reportDate}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== reportDate
  ) {
    throw new SummaryPreparationError(`Invalid report date: ${reportDate}`);
  }

  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekday === 0 ? -2 : 5 - weekday));
  const friday = date.toISOString().slice(0, 10);
  return join("reports", friday.slice(0, 4), friday, "vme", "cx", "mnf.md");
}

export function prepareSummary(
  reportPath: string,
  checkoutRoot: string,
): string {
  const match = /^weekly-update-(\d{4}-\d{2}-\d{2})\.md$/.exec(
    basename(reportPath),
  );
  if (!match) {
    throw new SummaryPreparationError(
      "Source must be a weekly-update-YYYY-MM-DD.md report",
    );
  }

  const targetPath = targetPathForDate(match[1]);
  const destination = resolve(checkoutRoot, targetPath);
  if (existsSync(destination)) {
    throw new SummaryPreparationError(`Target already exists: ${targetPath}`);
  }

  const summary = extractSummary(readFileSync(reportPath, "utf8"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, summary, { encoding: "utf8", flag: "wx" });
  return targetPath;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new SummaryPreparationError(
      "Usage: npx tsx agents/weekly-team-update/scripts/prepare-summary.ts <approved-report> <destination-checkout>",
    );
  }
  console.log(`Prepared ${prepareSummary(args[0], args[1])}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(import.meta.dirname, "prepare-summary.ts")
) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
