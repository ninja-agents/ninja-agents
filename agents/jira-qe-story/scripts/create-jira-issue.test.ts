import { describe, it, expect } from "vitest";
import {
  markdownToAdf,
  parseInlineMarkdown,
  buildIssuePayload,
} from "./create-jira-issue.js";

describe("markdownToAdf", () => {
  it("converts a heading", () => {
    const nodes = markdownToAdf("## Acceptance Criteria");
    expect(nodes).toEqual([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Acceptance Criteria" }],
      },
    ]);
  });

  it("converts a numbered list", () => {
    const nodes = markdownToAdf("1. First item\n2. Second item");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("orderedList");
    expect(nodes[0].content).toHaveLength(2);
    expect(nodes[0].content![0].content![0].content![0].text).toBe(
      "First item",
    );
  });

  it("converts a bullet list", () => {
    const nodes = markdownToAdf("- Item A\n- Item B\n- Item C");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("bulletList");
    expect(nodes[0].content).toHaveLength(3);
  });

  it("converts a plain paragraph", () => {
    const nodes = markdownToAdf("Just some text.");
    expect(nodes).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Just some text." }],
      },
    ]);
  });

  it("skips empty lines", () => {
    const nodes = markdownToAdf("Line one\n\nLine two");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("paragraph");
    expect(nodes[1].type).toBe("paragraph");
  });

  it("handles mixed content", () => {
    const md = "## Title\n\n1. First\n2. Second\n\nA paragraph.\n\n- Bullet";
    const nodes = markdownToAdf(md);
    expect(nodes.map((n) => n.type)).toEqual([
      "heading",
      "orderedList",
      "paragraph",
      "bulletList",
    ]);
  });
});

describe("parseInlineMarkdown", () => {
  it("parses bold text", () => {
    const nodes = parseInlineMarkdown("This is **bold** text");
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toEqual({
      type: "text",
      text: "bold",
      marks: [{ type: "strong" }],
    });
  });

  it("parses links", () => {
    const nodes = parseInlineMarkdown("See [docs](https://example.com) here");
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toEqual({
      type: "text",
      text: "docs",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });

  it("handles plain text", () => {
    const nodes = parseInlineMarkdown("no formatting");
    expect(nodes).toEqual([{ type: "text", text: "no formatting" }]);
  });

  it("handles multiple bold segments", () => {
    const nodes = parseInlineMarkdown("**A** and **B**");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].marks![0].type).toBe("strong");
    expect(nodes[2].marks![0].type).toBe("strong");
  });
});

describe("buildIssuePayload", () => {
  const draft = {
    source_key: "CNV-12345",
    summary: "[QE] Test story",
    description: "A description.",
    acceptance_criteria: "1. Criterion A\n2. Criterion B",
    test_scenarios:
      "**Scenario 1: Test**\n- Preconditions: None\n- Steps: Do it\n- Expected: It works",
    issue_type: "Story",
    priority: "Normal",
    labels: ["qe"],
    components: ["CNV User Interface"],
    story_points: 5,
    assignee_account_id: "712020:abc-123",
    target_project_key: "CNV",
  };

  it("builds a valid payload with all fields", () => {
    const payload = buildIssuePayload(draft) as {
      fields: Record<string, unknown>;
    };
    expect(payload.fields.project).toEqual({ key: "CNV" });
    expect(payload.fields.issuetype).toEqual({ name: "Story" });
    expect(payload.fields.summary).toBe("[QE] Test story");
    expect(payload.fields.priority).toEqual({ name: "Normal" });
    expect(payload.fields.labels).toEqual(["qe"]);
    expect(payload.fields.components).toEqual([{ name: "CNV User Interface" }]);
    expect(payload.fields.customfield_10028).toBe(5);
    expect(payload.fields.assignee).toEqual({ accountId: "712020:abc-123" });
  });

  it("description is ADF format", () => {
    const payload = buildIssuePayload(draft) as {
      fields: {
        description: { version: number; type: string; content: unknown[] };
      };
    };
    expect(payload.fields.description.version).toBe(1);
    expect(payload.fields.description.type).toBe("doc");
    expect(payload.fields.description.content.length).toBeGreaterThan(0);
  });

  it("omits assignee when empty", () => {
    const payload = buildIssuePayload({
      ...draft,
      assignee_account_id: "",
    }) as { fields: Record<string, unknown> };
    expect(payload.fields.assignee).toBeUndefined();
  });

  it("omits story points when null", () => {
    const payload = buildIssuePayload({
      ...draft,
      story_points: null,
    }) as { fields: Record<string, unknown> };
    expect(payload.fields.customfield_10028).toBeUndefined();
  });
});
