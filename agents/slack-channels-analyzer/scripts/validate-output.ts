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
  }

  if (!content.includes("# Slack Forums Analysis")) {
    errors.push("Missing report title (# Slack Forums Analysis)");
  }

  if (!content.includes("## Category Breakdown")) {
    errors.push("Missing Category Breakdown section");
  }

  if (!content.includes("**Channels:**")) {
    errors.push("Missing channel metadata");
  }

  if (!content.includes("**Total messages analyzed:**")) {
    errors.push("Missing total message count");
  }

  const categoryPattern = /### .+ \(\d+ messages\)/g;
  const categoryMatches = content.match(categoryPattern);
  if (!categoryMatches || categoryMatches.length === 0) {
    errors.push(
      "No category subsections found (expected ### name (N messages))",
    );
  }

  if (content.includes("## Summary & Recommendations")) {
    const summarySection = content.split("## Summary & Recommendations")[1];
    if (summarySection) {
      const bullets = summarySection.match(/^- \*\*/gm);
      if (!bullets || bullets.length < 3) {
        warnings.push(
          "Summary section should have at least 3 bolded bullet points",
        );
      }
    }
  } else {
    warnings.push(
      "Missing Summary & Recommendations section (agent adds this)",
    );
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) found:`);
    errors.forEach((e) => console.error(`  x ${e}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ! ${w}`));
  }

  if (verbose) {
    console.log("Validation passed");
  }
}

main();
