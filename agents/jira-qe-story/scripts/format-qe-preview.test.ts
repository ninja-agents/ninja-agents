import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDraft, formatPreview } from "./format-qe-preview.js";

const validDraft = {
  source_key: "CNV-12345",
  summary: "[QE] Implement VM migration flow",
  description: "Test the VM migration flow end-to-end.",
  acceptance_criteria:
    "1. User can initiate migration\n2. Migration completes within timeout",
  test_scenarios:
    "**Scenario 1:** Happy path migration\n- Preconditions: VM is running\n- Steps: Click migrate\n- Expected: VM moves to target node",
  issue_type: "Story",
  priority: "Major",
  labels: ["qe"],
  components: [],
  story_points: 5,
  assignee_account_id: "",
  target_project_key: "CNV",
};

describe("validateDraft", () => {
  it("accepts a valid draft", () => {
    expect(validateDraft(validDraft)).toEqual([]);
  });

  it("rejects draft missing summary", () => {
    const errors = validateDraft({ ...validDraft, summary: "" });
    expect(errors).toContain("Missing required field: summary");
  });

  it("rejects draft missing acceptance_criteria", () => {
    const errors = validateDraft({ ...validDraft, acceptance_criteria: "" });
    expect(errors).toContain("Missing required field: acceptance_criteria");
  });
});

describe("formatPreview", () => {
  it("includes all sections", () => {
    const preview = formatPreview(validDraft);
    expect(preview).toContain("# QE Story Preview");
    expect(preview).toContain("### Acceptance Criteria");
    expect(preview).toContain("### Test Scenarios");
    expect(preview).toContain("Clones: CNV-12345");
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
});

describe("config", () => {
  it("example config is valid JSON", () => {
    const configPath = resolve(
      import.meta.dirname,
      "../data/qe-config.example.json",
    );
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty("jira");
    expect(config).toHaveProperty("defaults");
    expect(config).toHaveProperty("projects");
  });
});
