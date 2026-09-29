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

const HIGHLIGHTS_SYSTEM_PROMPT = `You are a senior engineering leader writing Highlights for a weekly status report.
Write 2-4 bullets (150-200 words max) covering only the most impactful completed milestones.

Rules:
- Each bullet: "- **Bold lead-in:** description ([KEY](url))"
- Only completed milestones; no in-progress items or future plans
- Frame by business impact: who benefits, what risk is reduced, what customer pain is resolved
- Order: customer-visible milestones first, then quality, then strategic decisions, then releases
- No promotional adjectives ("critical", "major", "significant")
- No em dashes; use colons, semicolons, or parentheses
- Peer-VP test: would a peer VP mention this? If no, cut it.
- Cut: routine z-stream releases, internal tooling, CI fixes, routine bug fixes, meetings

Output ONLY the 2-4 bullets, nothing else.`;

const SUMMARY_SYSTEM_PROMPT = `You are a technical writer for a software engineering team's weekly status report.
Write one "### ProductName" sub-heading per product with compact bullets covering relevant work.
Use the Jira Hierarchy Context to group work bottom-up under linked Features and Epics. Show Feature > Epic > relevant Story or work links when available. If no Feature exists, start at the Epic. If no parent exists, summarize the product work in prose.
Cover completed and in-progress work, customer-impacting bugs, backport needs, and CVEs when relevant.

Rules:
- Every product gets a paragraph, even if quiet
- Use descriptive inline Jira links for hierarchy nodes and relevant work
- Do not repeat any outcome, Jira key, or CVE already covered in Highlights; omit that work from the product summary
- Group routine items concisely rather than listing each one
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
  systemPrompt: string = SUMMARY_SYSTEM_PROMPT,
  highlights = "",
): Promise<string> {
  const completedMatch = reportBody.match(
    /## Completed This Week[\s\S]*?(?=## In Progress)/,
  );
  const inProgressMatch = reportBody.match(/## In Progress[\s\S]*?(?=## |$)/);

  const userContent = [
    highlightContext,
    highlights
      ? "\n--- Already written Highlights (do not repeat) ---\n" + highlights
      : "",
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
        { role: "system", content: systemPrompt },
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

function repeatedSummaryReferences(
  highlights: string,
  summary: string,
): string[] {
  const referencePattern = /\b(?:CVE-\d{4}-\d+|[A-Z][A-Z0-9]+-\d+)\b/g;
  const highlightReferences = new Set(highlights.match(referencePattern) ?? []);
  return [...new Set(summary.match(referencePattern) ?? [])].filter(
    (reference) => highlightReferences.has(reference),
  );
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

  let report = readFileSync(OUTPUT_PATH, "utf-8");

  if (report.includes("<!-- HIGHLIGHTS_PLACEHOLDER -->")) {
    const execSummary = await callLlm(
      highlightContext,
      report,
      HIGHLIGHTS_SYSTEM_PROMPT,
    );
    report = report.replace(
      /<!-- HIGHLIGHTS_PLACEHOLDER -->\n- \(highlights pending\)/,
      execSummary,
    );
    writeFileSync(OUTPUT_PATH, report);
    console.log("\n=> Highlights written");
  }

  if (report.includes("<!-- SUMMARY_PLACEHOLDER -->")) {
    const highlights =
      report
        .match(
          /### Highlights\n([\s\S]*?)(?=\n### |\n<!-- SUMMARY_PLACEHOLDER -->)/,
        )?.[1]
        ?.trim() ?? "";
    let summary = await callLlm(
      highlightContext,
      report,
      SUMMARY_SYSTEM_PROMPT,
      highlights,
    );
    let repeated = repeatedSummaryReferences(highlights, summary);
    if (repeated.length > 0) {
      summary = await callLlm(
        highlightContext,
        report,
        SUMMARY_SYSTEM_PROMPT +
          "\nRemove every mention of these references already in Highlights: " +
          repeated.join(", "),
        highlights,
      );
      repeated = repeatedSummaryReferences(highlights, summary);
    }
    if (repeated.length > 0) {
      throw new Error(
        "Summary repeats Highlights references: " + repeated.join(", "),
      );
    }
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
