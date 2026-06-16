import { readFileSync, existsSync } from "node:fs";

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: validate-output.ts <file> [--verbose]");
    console.log(
      "\nValidates the reference summary or estimation output for completeness.",
    );
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
  }

  if (content.includes("# Story Point Reference Data")) {
    const requiredSections = [
      "## Distribution",
      "## Reference Tickets",
      "## Sizing Guide",
    ];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        errors.push(`Missing section: ${section}`);
      }
    }

    const tableRows = content
      .split("\n")
      .filter(
        (l) =>
          l.startsWith("| ") &&
          !l.startsWith("| Key") &&
          !l.startsWith("| SP") &&
          !l.startsWith("| Type") &&
          !l.startsWith("|--"),
      );
    if (tableRows.length < 10) {
      warnings.push(
        `Only ${String(tableRows.length)} data rows — may be insufficient for accurate estimation`,
      );
    }
  }

  if (errors.length > 0) {
    console.error(`\n${String(errors.length)} error(s) found:`);
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`\n${String(warnings.length)} warning(s):`);
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
    process.exit(3);
  }

  if (verbose) {
    console.log("✓ Validation passed");
  }
}

main();
