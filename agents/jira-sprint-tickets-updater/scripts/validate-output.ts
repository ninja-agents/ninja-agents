import { readFileSync, existsSync } from "node:fs";

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: validate-output.ts <file> [--verbose]");
    process.exit(0);
  }

  const [inputPath] = args;
  const verbose = args.includes("--verbose");

  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const content = readFileSync(inputPath, "utf-8");
  const errors: string[] = [];
  const warnings: string[] = [];

  if (content.trim().length === 0) {
    errors.push("Output file is empty");
    reportAndExit(errors, warnings, verbose);
    return;
  }

  if (!content.includes("# Proposed Ticket Transitions")) {
    errors.push("Missing required heading: '# Proposed Ticket Transitions'");
  }

  const summaryMatch = content.match(
    /(\d+) tickets analyzed\. \*\*(\d+)\*\* to transition, \*\*(\d+)\*\* skipped/,
  );
  if (!summaryMatch) {
    errors.push(
      "Missing summary line: 'N tickets analyzed. **M** to transition, **K** skipped.'",
    );
  } else {
    const total = parseInt(summaryMatch[1], 10);
    const toTransition = parseInt(summaryMatch[2], 10);
    const skippedCount = parseInt(summaryMatch[3], 10);
    if (total !== toTransition + skippedCount) {
      errors.push(
        `Summary count mismatch: ${String(total)} total != ${String(toTransition)} + ${String(skippedCount)}`,
      );
    }
  }

  const tableRows = content.match(/^\| [A-Z][\w-]+-\d+ \|/gm);
  if (tableRows) {
    for (const row of tableRows) {
      const pipeCount = (row.match(/\|/g) ?? []).length;
      if (pipeCount < 2) {
        warnings.push(`Table row may be malformed: ${row.substring(0, 60)}`);
      }
    }
  }

  const ticketPattern = /[A-Z]+-\d+/g;
  const tickets = content.match(ticketPattern);
  if (!tickets || tickets.length === 0) {
    warnings.push("No ticket keys found in output");
  }

  const bareUrlPattern = /(?<!\[)[^(](https:\/\/github\.com\/[^\s)]+)(?!\))/g;
  const bareUrls = content.match(bareUrlPattern);
  if (bareUrls && bareUrls.length > 0) {
    warnings.push(
      `Found ${String(bareUrls.length)} possible bare URL(s) — use markdown hyperlinks`,
    );
  }

  if (
    content.includes("No transitions to apply") &&
    tableRows &&
    tableRows.length > 0
  ) {
    errors.push(
      "Contradiction: says 'no transitions' but table rows with ticket keys found",
    );
  }

  reportAndExit(errors, warnings, verbose);
}

function reportAndExit(
  errors: string[],
  warnings: string[],
  verbose: boolean,
): void {
  if (errors.length > 0) {
    console.error(`\n${String(errors.length)} error(s) found:`);
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`\n${String(warnings.length)} warning(s):`);
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (verbose) {
    console.log("✓ Validation passed");
  }
}

main();
