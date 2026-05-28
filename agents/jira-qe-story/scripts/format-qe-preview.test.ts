import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateDraft,
  formatPreview,
  countNumberedItems,
  countScenarios,
  type QEStoryDraft,
} from "./format-qe-preview.js";

const validDraft: QEStoryDraft = {
  source_key: "CNV-12345",
  summary: "[QE] Implement VM migration flow",
  description: "Test the VM migration flow end-to-end.",
  acceptance_criteria:
    "1. User can initiate migration\n2. Migration completes within timeout\n3. Source VM is stopped after migration",
  test_scenarios:
    "**Scenario 1: Happy path migration**\n- Preconditions: VM is running\n- Steps: 1. Click migrate\n- Expected: VM moves to target node\n\n**Scenario 2: Migration with insufficient resources**\n- Preconditions: Target node has <2GB RAM\n- Steps: 1. Select VM, 2. Click Migrate\n- Expected: Error message shown\n\n**Scenario 3: Migration cancellation**\n- Preconditions: Migration in progress\n- Steps: 1. Click cancel\n- Expected: VM stays on source node",
  issue_type: "Story",
  priority: "Major",
  labels: ["qe"],
  components: [],
  story_points: 5,
  assignee_account_id: "712020:abc-123",
  target_project_key: "CNV",
};

const testConfig = {
  qe_engineers: [
    { name: "Leon Kladnitsky", jira_account_id: "712020:abc-123" },
    { name: "Pedro Abreu", jira_account_id: "712020:def-456" },
  ],
  projects: [
    { jira_prefix: "CNV", name: "Container-Native Virtualization" },
    { jira_prefix: "MTV", name: "Migration Toolkit for Virtualization" },
  ],
};

// --- Helpers ---

describe("countNumberedItems", () => {
  it("counts numbered lines", () => {
    expect(countNumberedItems("1. First\n2. Second\n3. Third")).toBe(3);
  });

  it("returns 0 for unnumbered text", () => {
    expect(countNumberedItems("- bullet\n- another")).toBe(0);
  });

  it("handles mixed content", () => {
    expect(countNumberedItems("Intro text\n1. Item\nMore text\n2. Item")).toBe(
      2,
    );
  });
});

describe("countScenarios", () => {
  it("counts scenario headers", () => {
    expect(countScenarios(validDraft.test_scenarios)).toBe(3);
  });

  it("returns 0 for missing scenarios", () => {
    expect(countScenarios("Just some text")).toBe(0);
  });
});

// --- Validation ---

describe("validateDraft", () => {
  it("accepts a valid draft with no errors or warnings", () => {
    const { errors, warnings } = validateDraft(validDraft, testConfig);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("errors on missing required fields", () => {
    const { errors } = validateDraft({ ...validDraft, summary: "" });
    expect(errors).toContain("Missing required field: summary");
  });

  it("errors on unnumbered acceptance criteria", () => {
    const { errors } = validateDraft({
      ...validDraft,
      acceptance_criteria: "- bullet one\n- bullet two",
    });
    expect(errors).toContain(
      "Acceptance criteria must be a numbered list (e.g., 1. 2. 3.)",
    );
  });

  it("errors on unstructured test scenarios", () => {
    const { errors } = validateDraft({
      ...validDraft,
      test_scenarios: "Just run the tests and see if they pass",
    });
    expect(errors).toContain(
      'Test scenarios must use "**Scenario N:**" format (e.g., **Scenario 1: Title**)',
    );
  });

  it("warns on missing scenario structure", () => {
    const { warnings } = validateDraft({
      ...validDraft,
      test_scenarios:
        "**Scenario 1: No structure**\nJust some text without sections",
    });
    expect(warnings).toContain("Scenario 1: missing Preconditions");
    expect(warnings).toContain("Scenario 1: missing Expected result");
  });

  it("warns when fewer scenarios than criteria", () => {
    const { warnings } = validateDraft({
      ...validDraft,
      acceptance_criteria: "1. A\n2. B\n3. C\n4. D\n5. E",
      test_scenarios:
        "**Scenario 1: Only one**\n- Preconditions: X\n- Steps: Y\n- Expected: Z",
    });
    expect(warnings.some((w) => w.includes("1 scenarios for 5 criteria"))).toBe(
      true,
    );
  });

  it("warns on missing [QE] prefix", () => {
    const { warnings } = validateDraft({
      ...validDraft,
      summary: "VM migration flow",
    });
    expect(warnings).toContain('Summary should start with "[QE]" prefix');
  });

  it("warns on non-fibonacci story points", () => {
    const { warnings } = validateDraft({
      ...validDraft,
      story_points: 4,
    });
    expect(warnings.some((w) => w.includes("not a standard Fibonacci"))).toBe(
      true,
    );
  });

  it("warns on unknown assignee when config provided", () => {
    const { warnings } = validateDraft(
      { ...validDraft, assignee_account_id: "712020:unknown" },
      testConfig,
    );
    expect(
      warnings.some((w) => w.includes("not found in config qe_engineers")),
    ).toBe(true);
  });

  it("warns on unknown project key when config provided", () => {
    const { warnings } = validateDraft(
      { ...validDraft, target_project_key: "UNKNOWN" },
      testConfig,
    );
    expect(
      warnings.some((w) => w.includes("not found in config projects")),
    ).toBe(true);
  });

  it("does not warn on config checks when no config provided", () => {
    const { warnings } = validateDraft({
      ...validDraft,
      assignee_account_id: "712020:unknown",
      target_project_key: "UNKNOWN",
    });
    expect(warnings.some((w) => w.includes("not found in config"))).toBe(false);
  });
});

// --- Preview ---

describe("formatPreview", () => {
  it("includes all sections", () => {
    const preview = formatPreview(validDraft);
    expect(preview).toContain("# QE Story Preview");
    expect(preview).toContain("### Acceptance Criteria");
    expect(preview).toContain("### Test Scenarios");
    expect(preview).toContain("Clones: CNV-12345");
  });

  it("includes coverage summary", () => {
    const preview = formatPreview(validDraft);
    expect(preview).toContain("Coverage: 3 criteria, 3 scenarios");
  });

  it("includes automation stats in coverage when present", () => {
    const draft = {
      ...validDraft,
      automation_suggestions:
        "| 1 | Reload | Yes | page.reload() |\n| 2 | Radio | Yes | assert radio |\n| 3 | Manual | No | visual check |",
    };
    const preview = formatPreview(draft);
    expect(preview).toContain("2/3 automatable");
  });

  it("includes dev story table when provided", () => {
    const devStory = {
      key: "CNV-12345",
      fields: {
        summary: "Implement VM migration flow",
        status: { name: "In Progress" },
        priority: { name: "Major" },
        issuetype: { name: "Story" },
      },
    };
    const preview = formatPreview(validDraft, devStory);
    expect(preview).toContain("## Source Dev Story");
    expect(preview).toContain("In Progress");
  });

  it("includes automation suggestions when present", () => {
    const draft = {
      ...validDraft,
      automation_suggestions:
        "Add test to `playwright/tests/tier1/clone-wizard.spec.ts`",
    };
    const preview = formatPreview(draft);
    expect(preview).toContain("### Automation Suggestions");
    expect(preview).toContain("clone-wizard.spec.ts");
  });

  it("omits automation section when empty", () => {
    const preview = formatPreview(validDraft);
    expect(preview).not.toContain("### Automation Suggestions");
  });
});

// --- Config ---

describe("config", () => {
  it("example config is valid JSON with required sections", () => {
    const configPath = resolve(
      import.meta.dirname,
      "../data/qe-config.example.json",
    );
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty("jira");
    expect(config).toHaveProperty("defaults");
    expect(config).toHaveProperty("projects");
    expect(config).toHaveProperty("qe_engineers");
  });
});
