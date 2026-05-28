import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface QEStoryDraft {
  source_key: string;
  summary: string;
  description: string;
  acceptance_criteria: string;
  test_scenarios: string;
  issue_type: string;
  priority: string;
  labels: string[];
  components: string[];
  story_points: number | null;
  assignee_account_id: string;
  target_project_key: string;
}

interface DevStory {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string };
    issuetype: { name: string };
  };
}

const REQUIRED_FIELDS: (keyof QEStoryDraft)[] = [
  "source_key",
  "summary",
  "description",
  "acceptance_criteria",
  "test_scenarios",
  "target_project_key",
];

function parseArgs(argv: string[]): { help: boolean } {
  return { help: argv.includes("--help") };
}

export function validateDraft(draft: QEStoryDraft): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const value = draft[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }
  return errors;
}

export function formatPreview(
  draft: QEStoryDraft,
  devStory?: DevStory,
): string {
  const lines: string[] = [];

  lines.push("# QE Story Preview");
  lines.push("");

  if (devStory) {
    lines.push("## Source Dev Story");
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`| ----- | ----- |`);
    lines.push(`| Key | ${devStory.key} |`);
    lines.push(`| Summary | ${devStory.fields.summary} |`);
    lines.push(`| Status | ${devStory.fields.status.name} |`);
    lines.push(`| Priority | ${devStory.fields.priority.name} |`);
    lines.push(`| Type | ${devStory.fields.issuetype.name} |`);
    lines.push("");
  }

  lines.push("## QE Story to Create");
  lines.push("");
  lines.push(`**Project:** ${draft.target_project_key}`);
  lines.push(`**Type:** ${draft.issue_type}`);
  lines.push(`**Priority:** ${draft.priority}`);
  if (draft.story_points !== null) {
    lines.push(`**Story Points:** ${String(draft.story_points)}`);
  }
  if (draft.labels.length > 0) {
    lines.push(`**Labels:** ${draft.labels.join(", ")}`);
  }
  if (draft.components.length > 0) {
    lines.push(`**Components:** ${draft.components.join(", ")}`);
  }
  if (draft.assignee_account_id) {
    lines.push(`**Assignee ID:** ${draft.assignee_account_id}`);
  }
  lines.push("");
  lines.push(`### ${draft.summary}`);
  lines.push("");
  lines.push(draft.description);
  lines.push("");
  lines.push("### Acceptance Criteria");
  lines.push("");
  lines.push(draft.acceptance_criteria);
  lines.push("");
  lines.push("### Test Scenarios");
  lines.push("");
  lines.push(draft.test_scenarios);
  lines.push("");
  lines.push("---");
  lines.push(`Clones: ${draft.source_key}`);

  return lines.join("\n");
}

export function main() {
  const { help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(
      "Usage: format-qe-preview.ts [--help]\n\nReads data/cache/qe-story-draft.json and outputs a formatted Markdown preview.",
    );
    process.exit(0);
  }

  const dataDir = resolve(import.meta.dirname, "../data/cache");
  const draftPath = resolve(dataDir, "qe-story-draft.json");
  const devStoryPath = resolve(dataDir, "dev-story.json");

  if (!existsSync(draftPath)) {
    console.error(`Draft not found: ${draftPath}`);
    process.exit(2);
  }

  const draft = JSON.parse(readFileSync(draftPath, "utf-8")) as QEStoryDraft;
  const errors = validateDraft(draft);

  if (errors.length > 0) {
    console.error(
      `Validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }

  const devStory = existsSync(devStoryPath)
    ? (JSON.parse(readFileSync(devStoryPath, "utf-8")) as DevStory)
    : undefined;

  console.log(formatPreview(draft, devStory));
}

const isDirectRun = process.argv[1]?.endsWith("format-qe-preview.ts");
if (isDirectRun) main();
