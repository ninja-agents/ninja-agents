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

  if (!content.includes("# Proposed Ticket Transitions")) {
    errors.push("Missing required heading: '# Proposed Ticket Transitions'");
  }

  const ticketPattern = /[A-Z]+-\d+/g;
  const tickets = content.match(ticketPattern);
  if (!tickets || tickets.length === 0) {
    warnings.push("No ticket keys found in output");
  }

  const bareUrlPattern = /(?<!\()(https?:\/\/[^\s)]+)(?!\))/g;
  const tableSection = content.split("skipped")[0] ?? content;
  const bareUrls = tableSection.match(bareUrlPattern);
  if (bareUrls && bareUrls.length > 0) {
    warnings.push(
      `Found ${String(bareUrls.length)} bare URL(s) — use markdown hyperlinks`,
    );
  }

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
