#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcileBackportClaims } from "./finalize-report.js";

const SCRIPT_DIR = import.meta.dirname;
const BASE_DIR = resolve(SCRIPT_DIR, "..");
// Local calendar date, matching the skills that look the report up with
// `date +%Y-%m-%d` and the date finalize derives for its default path.
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const OUTPUT_PATH = resolve(
  BASE_DIR,
  "data/output",
  `weekly-update-${TODAY}.md`,
);

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:1234/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "qwen2.5-coder-7b-instruct";

const SUMMARY_SYSTEM_PROMPT = `You are a technical writer for a software engineering team's weekly status report.
Write one "### ProductName" sub-heading per product with compact bullets covering relevant work.
Use the Jira Hierarchy Context to group work bottom-up under linked Features and Epics. Show Feature > Epic > relevant Story or work links when available. If no Feature exists, start at the Epic. If no parent exists, summarize the product work in prose.
Cover completed and in-progress work, customer-impacting bugs, backport needs, and CVEs when relevant.

Rules:
- Every product gets a paragraph, even if quiet
- Use descriptive inline Jira links for hierarchy nodes and relevant work
- Group routine items concisely rather than listing each one
- Every claim must trace to an item in the provided data — never invent work
- Customer-impacting bugs must name the customers
- Write the product sub-headings in the order the product blocks appear in the context

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

async function callLlm(context: string, reportBody: string): Promise<string> {
  const completedMatch = reportBody.match(
    /## Completed This Week[\s\S]*?(?=## In Progress)/,
  );
  const inProgressMatch = reportBody.match(/## In Progress[\s\S]*?(?=## |$)/);

  const userContent = [
    context,
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
      max_tokens: 3072,
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

  // Step 3: Verify backport claims and append Recommendations
  run(
    `npx tsx agents/weekly-team-update/scripts/finalize-report.ts --date ${TODAY} --report ${OUTPUT_PATH}`,
    "Verifying backports and building Recommendations...",
  );

  let report = readFileSync(OUTPUT_PATH, "utf-8");

  // The generator's context predates verification, so drop the claims the
  // report no longer makes before the model can echo them.
  const verifiedContext = reconcileBackportClaims(highlightContext, report);

  if (report.includes("<!-- SUMMARY_PLACEHOLDER -->")) {
    const summary = await callLlm(verifiedContext, report);
    report = report.replace(
      /<!-- SUMMARY_PLACEHOLDER -->\n- \(summary pending\)/,
      summary,
    );
    writeFileSync(OUTPUT_PATH, report);
    console.log("\n=> Summary written");
  } else {
    console.log(
      "No placeholder found — summary may already exist, skipping LLM call",
    );
  }

  // Step 4: Validate links
  run(
    `npx tsx agents/weekly-team-update/scripts/validate-report-links.ts ${OUTPUT_PATH} --verbose`,
    "Validating links...",
  );

  console.log(`\n=> Done! Report saved to ${OUTPUT_PATH}`);
}

void main();
