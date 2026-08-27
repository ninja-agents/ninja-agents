#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const BASE_DIR = resolve(SCRIPT_DIR, "..");
const TODAY = new Date().toISOString().slice(0, 10);
const OUTPUT_PATH = resolve(
  BASE_DIR,
  "data/output",
  `weekly-update-${TODAY}.md`,
);

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:1234/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "qwen2.5-coder-7b-instruct";

const SUMMARY_SYSTEM_PROMPT = `You are a technical writer for a software engineering team's weekly status report.
Write one "### ProductName" sub-heading per product with one rich paragraph each covering:
- What shipped this week (outcomes, not ticket IDs) — active voice, past tense
- What's actively in progress — present tense
- CVEs fixed, blockers, or notable items
- Customer-impacting bugs — name affected customers

Rules:
- Every product gets a paragraph, even if quiet
- No markdown links or Jira ticket IDs in the summary
- Quantify when possible ("8 bug fixes", "two features")
- Every claim must trace to an item in the provided data — never invent work
- Customer-impacting bugs must name the customers

Output ONLY the summary sub-headings and paragraphs, nothing else.`;

function run(cmd: string, label: string): string {
  console.log(`\n=> ${label}`);
  try {
    return execSync(cmd, {
      cwd: resolve(SCRIPT_DIR, "../../.."),
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
      timeout: 300_000,
    });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 3) {
      console.log("  (warnings present, continuing)");
      return err.stdout ?? "";
    }
    console.error(`  FAILED (exit ${err.status})`);
    process.exit(1);
  }
}

async function callLlm(
  highlightContext: string,
  reportBody: string,
): Promise<string> {
  const completedMatch = reportBody.match(
    /## Completed This Week[\s\S]*?(?=## In Progress)/,
  );
  const inProgressMatch = reportBody.match(/## In Progress[\s\S]*?(?=## |$)/);

  const userContent = [
    highlightContext,
    "",
    "--- Report Sections (for reference) ---",
    completedMatch?.[0]?.slice(0, 2000) ?? "(no completed section found)",
    inProgressMatch?.[0]?.slice(0, 1500) ?? "(no in-progress section found)",
  ].join("\n");

  console.log(
    `\n=> Calling ${LLM_MODEL} at ${LLM_BASE_URL} (${userContent.length} chars)`,
  );

  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`LLM API error ${resp.status}: ${text}`);
    process.exit(1);
  }

  const data = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message?.content;
  if (!content) {
    console.error("LLM returned empty response");
    process.exit(1);
  }

  // Strip <think>...</think> blocks (Qwen reasoning traces)
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

async function main(): Promise<void> {
  // Step 1: Fetch data
  run(
    "npx tsx agents/weekly-team-update/scripts/fetch-data.ts",
    "Fetching data from GitHub, GitLab, Jira...",
  );

  // Step 2: Generate report (capture stdout for Highlight Context)
  const genOutput = run(
    `npx tsx agents/weekly-team-update/scripts/generate-weekly-report.ts --date ${TODAY}`,
    "Generating report...",
  );

  // Extract Highlight Context from stdout
  const hcStart = genOutput.indexOf("--- Highlight Context ---");
  const highlightContext = hcStart >= 0 ? genOutput.slice(hcStart) : genOutput;

  // Step 3: Read report and call LLM for summary
  const report = readFileSync(OUTPUT_PATH, "utf-8");

  if (!report.includes("<!-- SUMMARY_PLACEHOLDER -->")) {
    console.log(
      "No placeholder found — summary may already exist, skipping LLM call",
    );
  } else {
    const summary = await callLlm(highlightContext, report);
    const patched = report.replace(
      /<!-- SUMMARY_PLACEHOLDER -->\n- \(summary pending\)/,
      summary,
    );
    writeFileSync(OUTPUT_PATH, patched);
    console.log("\n=> Summary written");
  }

  // Step 4: Validate links
  run(
    `npx tsx agents/weekly-team-update/scripts/validate-report-links.ts ${OUTPUT_PATH} --verbose`,
    "Validating links...",
  );

  console.log(`\n=> Done! Report saved to ${OUTPUT_PATH}`);
}

void main();
