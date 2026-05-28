import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface QEStoryDraft {
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
  automation_suggestions?: string;
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

interface QEConfig {
  qe_engineers?: { name: string; jira_account_id: string }[];
  projects?: { jira_prefix: string; name: string }[];
}

const REQUIRED_FIELDS: (keyof QEStoryDraft)[] = [
  "source_key",
  "summary",
  "description",
  "acceptance_criteria",
  "test_scenarios",
  "target_project_key",
];

export function countNumberedItems(text: string): number {
  return text.split("\n").filter((line) => /^\d+\.\s/.test(line.trim())).length;
}

export function countScenarios(text: string): number {
  return (text.match(/\*\*Scenario\s+\d+/g) ?? []).length;
}

function scenarioHasStructure(text: string): string[] {
  const warnings: string[] = [];
  const scenarios = text.split(/\*\*Scenario\s+\d+/).slice(1);
  for (let i = 0; i < scenarios.length; i++) {
    const block = scenarios[i];
    const num = i + 1;
    if (!/preconditions?/i.test(block))
      warnings.push(`Scenario ${String(num)}: missing Preconditions`);
    if (!/steps?/i.test(block))
      warnings.push(`Scenario ${String(num)}: missing Steps`);
    if (!/expected/i.test(block))
      warnings.push(`Scenario ${String(num)}: missing Expected result`);
  }
  return warnings;
}

function countAutomatable(text: string): { total: number; auto: number } {
  const rows = text.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line));
  const auto = rows.filter((line) => /yes/i.test(line)).length;
  return { total: rows.length, auto };
}

export function validateDraft(
  draft: QEStoryDraft,
  config?: QEConfig,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = draft[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (draft.acceptance_criteria) {
    const count = countNumberedItems(draft.acceptance_criteria);
    if (count === 0) {
      errors.push(
        "Acceptance criteria must be a numbered list (e.g., 1. 2. 3.)",
      );
    } else if (count < 3) {
      warnings.push(
        `Only ${String(count)} acceptance criteria — consider adding more for thorough coverage`,
      );
    }
  }

  if (draft.test_scenarios) {
    const count = countScenarios(draft.test_scenarios);
    if (count === 0) {
      errors.push(
        'Test scenarios must use "**Scenario N:**" format (e.g., **Scenario 1: Title**)',
      );
    }

    const structureWarnings = scenarioHasStructure(draft.test_scenarios);
    warnings.push(...structureWarnings);

    if (draft.acceptance_criteria) {
      const criteriaCount = countNumberedItems(draft.acceptance_criteria);
      if (count > 0 && criteriaCount > 0 && count < criteriaCount) {
        warnings.push(
          `${String(count)} scenarios for ${String(criteriaCount)} criteria — some criteria may lack test coverage`,
        );
      }
    }
  }

  if (draft.summary && !draft.summary.startsWith("[QE]")) {
    warnings.push('Summary should start with "[QE]" prefix');
  }

  if (
    draft.story_points !== null &&
    ![1, 2, 3, 5, 8, 13, 21].includes(draft.story_points)
  ) {
    warnings.push(
      `Story points ${String(draft.story_points)} is not a standard Fibonacci value (1, 2, 3, 5, 8, 13, 21)`,
    );
  }

  if (config?.qe_engineers && draft.assignee_account_id) {
    const knownIds = config.qe_engineers.map((e) => e.jira_account_id);
    if (!knownIds.includes(draft.assignee_account_id)) {
      warnings.push(
        `Assignee ${draft.assignee_account_id} not found in config qe_engineers`,
      );
    }
  }

  if (config?.projects && draft.target_project_key) {
    const knownPrefixes = config.projects.map((p) => p.jira_prefix);
    if (!knownPrefixes.includes(draft.target_project_key)) {
      warnings.push(
        `Project key "${draft.target_project_key}" not found in config projects`,
      );
    }
  }

  return { errors, warnings };
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
    lines.push("| Field | Value |");
    lines.push("| ----- | ----- |");
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
  if (draft.automation_suggestions) {
    lines.push("");
    lines.push("### Automation Suggestions");
    lines.push("");
    lines.push(draft.automation_suggestions);
  }

  lines.push("");
  lines.push("---");

  const criteriaCount = countNumberedItems(draft.acceptance_criteria);
  const scenarioCount = countScenarios(draft.test_scenarios);
  const automationStats = draft.automation_suggestions
    ? countAutomatable(draft.automation_suggestions)
    : null;

  const coverageParts = [
    `${String(criteriaCount)} criteria`,
    `${String(scenarioCount)} scenarios`,
  ];
  if (automationStats && automationStats.total > 0) {
    coverageParts.push(
      `${String(automationStats.auto)}/${String(automationStats.total)} automatable`,
    );
  }
  lines.push(`Coverage: ${coverageParts.join(", ")}`);
  lines.push(`Clones: ${draft.source_key}`);

  return lines.join("\n");
}

function loadConfig(dataDir: string): QEConfig | undefined {
  const configPath = resolve(dataDir, "../../data/qe-config.json");
  const examplePath = resolve(dataDir, "../../data/qe-config.example.json");
  const path = existsSync(configPath) ? configPath : examplePath;
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as QEConfig;
}

export function main() {
  const help = process.argv.slice(2).includes("--help");

  if (help) {
    console.log(
      "Usage: format-qe-preview.ts [--help]\n\nReads data/cache/qe-story-draft.json, validates the draft, and outputs a formatted Markdown preview.\n\nExit codes:\n  0 — valid, preview printed\n  1 — validation errors (missing fields, bad format)\n  2 — draft file not found\n  3 — warnings only (preview printed, warnings on stderr)",
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
  const config = loadConfig(dataDir);
  const { errors, warnings } = validateDraft(draft, config);

  if (errors.length > 0) {
    console.error(
      `Validation failed (${String(errors.length)} error(s)):\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`,
    );
    if (warnings.length > 0) {
      console.error(
        `\n${String(warnings.length)} warning(s):\n${warnings.map((w) => `  ⚠ ${w}`).join("\n")}`,
      );
    }
    process.exit(1);
  }

  const devStory = existsSync(devStoryPath)
    ? (JSON.parse(readFileSync(devStoryPath, "utf-8")) as DevStory)
    : undefined;

  console.log(formatPreview(draft, devStory));

  if (warnings.length > 0) {
    console.error(
      `\n${String(warnings.length)} warning(s):\n${warnings.map((w) => `  ⚠ ${w}`).join("\n")}`,
    );
    process.exit(3);
  }
}

const isDirectRun = process.argv[1]?.endsWith("format-qe-preview.ts");
if (isDirectRun) main();
