import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseCsv,
  parseCsvLine,
  classifyTicket,
  generatePreview,
} from "./classify-tickets.js";
import type { ActivityType, ClassificationRule } from "./classify-tickets.js";

const DEFAULT_TYPE: ActivityType = {
  value: "Product / Portfolio Work",
  id: "10610",
};

const RULES: ClassificationRule[] = [
  {
    activity_type: { value: "Security & Compliance", id: "10609" },
    match: { labels: ["security", "cve"], keywords: ["CVE", "vulnerability"] },
  },
  {
    activity_type: { value: "Incidents & Support", id: "10607" },
    match: {
      labels: ["customer-escalation"],
      keywords: ["incident", "escalation"],
    },
  },
  {
    activity_type: { value: "Quality / Stability / Reliability", id: "10608" },
    match: {
      issue_types: ["Bug"],
      labels: ["flaky"],
      keywords: ["regression"],
    },
  },
  {
    activity_type: { value: "Future Sustainability", id: "10606" },
    match: { labels: ["tech-debt"], keywords: ["refactor", "migration"] },
  },
];

function ticket(
  overrides: Partial<{
    key: string;
    summary: string;
    issuetype: string;
    labels: string;
  }> = {},
) {
  return {
    key: overrides.key ?? "CNV-100",
    summary: overrides.summary ?? "Some task",
    issuetype: overrides.issuetype ?? "Story",
    labels: overrides.labels ?? "",
  };
}

// ── Config loading ──────────────────────────────────────────────

describe("config loading", () => {
  it("loads a valid config file", () => {
    const configPath = resolve(import.meta.dirname, "../data/config.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.jira).toBeDefined();
    expect(config.classification_rules).toBeDefined();
    expect(config.default_activity_type).toBeDefined();
  });

  it("has valid activity type IDs in all rules", () => {
    const configPath = resolve(import.meta.dirname, "../data/config.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as {
      classification_rules: Array<{
        activity_type: { value: string; id: string };
      }>;
      default_activity_type: { value: string; id: string };
    };

    for (const rule of config.classification_rules) {
      expect(rule.activity_type.id).toMatch(/^\d+$/);
      expect(rule.activity_type.value).toBeTruthy();
    }
    expect(config.default_activity_type.id).toMatch(/^\d+$/);
  });

  it("has the correct custom field ID for Activity Type", () => {
    const configPath = resolve(import.meta.dirname, "../data/config.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as { jira: { activity_type_field: string } };
    expect(config.jira.activity_type_field).toBe("customfield_10464");
  });
});

// ── CSV parsing ─────────────────────────────────────────────────

describe("parseCsvLine", () => {
  it("splits a simple line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('CNV-1,"Fix the thing, quickly",Bug,flaky')).toEqual([
      "CNV-1",
      "Fix the thing, quickly",
      "Bug",
      "flaky",
    ]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    expect(parseCsvLine('CNV-2,"She said ""hello""",Story,')).toEqual([
      "CNV-2",
      'She said "hello"',
      "Story",
      "",
    ]);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("CNV-3,summary,Bug,")).toEqual([
      "CNV-3",
      "summary",
      "Bug",
      "",
    ]);
  });
});

describe("parseCsv", () => {
  it("parses a well-formed CSV into tickets", () => {
    const csv = [
      "key,summary,issuetype,labels",
      "CNV-1,Fix login,Bug,flaky;regression",
      "CNV-2,Add feature,Story,",
    ].join("\n");

    const tickets = parseCsv(csv);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toEqual({
      key: "CNV-1",
      summary: "Fix login",
      issuetype: "Bug",
      labels: "flaky;regression",
    });
    expect(tickets[1]).toEqual({
      key: "CNV-2",
      summary: "Add feature",
      issuetype: "Story",
      labels: "",
    });
  });

  it("returns empty array for header-only CSV", () => {
    expect(parseCsv("key,summary,issuetype,labels")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles quoted summaries with commas", () => {
    const csv = [
      "key,summary,issuetype,labels",
      'MTV-10,"Migrate VMs, step 2",Task,tech-debt',
    ].join("\n");

    const tickets = parseCsv(csv);
    expect(tickets[0].summary).toBe("Migrate VMs, step 2");
    expect(tickets[0].labels).toBe("tech-debt");
  });
});

// ── Classification ──────────────────────────────────────────────

describe("classifyTicket", () => {
  it("matches by label", () => {
    const result = classifyTicket(
      ticket({ labels: "security" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Security & Compliance");
    expect(result.matched_rule).toBe("label match");
  });

  it("label matching is case-insensitive", () => {
    const result = classifyTicket(
      ticket({ labels: "Customer-Escalation" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Incidents & Support");
  });

  it("matches by keyword in summary", () => {
    const result = classifyTicket(
      ticket({ summary: "Fix CVE-2025-1234 in auth module" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Security & Compliance");
    expect(result.matched_rule).toBe("keyword match");
  });

  it("keyword matching is case-insensitive", () => {
    const result = classifyTicket(
      ticket({ summary: "Handle REGRESSION in network plugin" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Quality / Stability / Reliability");
  });

  it("matches by issue type", () => {
    const result = classifyTicket(
      ticket({ issuetype: "Bug", summary: "Button not clickable" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Quality / Stability / Reliability");
    expect(result.matched_rule).toBe("issue type match");
  });

  it("issue type matching is case-insensitive", () => {
    const result = classifyTicket(
      ticket({ issuetype: "bug" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Quality / Stability / Reliability");
  });

  it("falls back to default when no rule matches", () => {
    const result = classifyTicket(
      ticket({ summary: "Add new dashboard widget", issuetype: "Story" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Product / Portfolio Work");
    expect(result.activity_type_id).toBe("10610");
    expect(result.matched_rule).toBe("default");
  });

  it("respects rule priority — first match wins", () => {
    // "security" label matches the first rule (Security & Compliance)
    // even though "Bug" issue type would match the third rule
    const result = classifyTicket(
      ticket({ issuetype: "Bug", labels: "security" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Security & Compliance");
  });

  it("label match takes priority over keyword match within a rule", () => {
    // Both label and keyword could match the same rule —
    // label is checked first and reported as the match reason
    const result = classifyTicket(
      ticket({ labels: "cve", summary: "Fix vulnerability in auth" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.matched_rule).toBe("label match");
  });

  it("handles semicolon-separated labels", () => {
    const result = classifyTicket(
      ticket({ labels: "frontend;tech-debt;cleanup" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Future Sustainability");
  });

  it("handles empty labels gracefully", () => {
    const result = classifyTicket(
      ticket({ labels: "", summary: "Normal work" }),
      RULES,
      DEFAULT_TYPE,
    );
    expect(result.activity_type).toBe("Product / Portfolio Work");
  });

  it("preserves ticket fields in output", () => {
    const input = ticket({
      key: "MTV-55",
      summary: "Fix auth",
      issuetype: "Bug",
      labels: "flaky",
    });
    const result = classifyTicket(input, RULES, DEFAULT_TYPE);
    expect(result.key).toBe("MTV-55");
    expect(result.summary).toBe("Fix auth");
    expect(result.issuetype).toBe("Bug");
    expect(result.labels).toBe("flaky");
  });

  it("returns default when rules array is empty", () => {
    const result = classifyTicket(ticket(), [], DEFAULT_TYPE);
    expect(result.activity_type).toBe("Product / Portfolio Work");
    expect(result.matched_rule).toBe("default");
  });
});

// ── Preview generation ──────────────────────────────────────────

describe("generatePreview", () => {
  const classified = [
    {
      key: "CNV-1",
      summary: "Fix bug",
      issuetype: "Bug",
      labels: "",
      activity_type: "Quality / Stability / Reliability",
      activity_type_id: "10608",
      matched_rule: "issue type match",
    },
    {
      key: "CNV-2",
      summary: "New feature",
      issuetype: "Story",
      labels: "",
      activity_type: "Product / Portfolio Work",
      activity_type_id: "10610",
      matched_rule: "default",
    },
    {
      key: "CNV-3",
      summary: "CVE fix",
      issuetype: "Bug",
      labels: "security",
      activity_type: "Security & Compliance",
      activity_type_id: "10609",
      matched_rule: "label match",
    },
  ];

  it("includes the title and total count", () => {
    const preview = generatePreview(classified);
    expect(preview).toContain("# Activity Type Classification Preview");
    expect(preview).toContain("Total tickets: 3");
  });

  it("includes summary table with activity type counts", () => {
    const preview = generatePreview(classified);
    expect(preview).toContain("| Quality / Stability / Reliability | 1 |");
    expect(preview).toContain("| Product / Portfolio Work | 1 |");
    expect(preview).toContain("| Security & Compliance | 1 |");
  });

  it("includes proposed assignments table with linked ticket keys and summaries", () => {
    const preview = generatePreview(classified);
    expect(preview).toContain(
      "[CNV-1](https://redhat.atlassian.net/browse/CNV-1)",
    );
    expect(preview).toContain("| Fix bug |");
    expect(preview).toContain("| Summary |");
    expect(preview).toContain("| issue type match |");
    expect(preview).toContain("| label match |");
  });

  it("truncates long summaries to 60 chars", () => {
    const longTicket = [
      {
        ...classified[0],
        summary:
          "This is a very long summary that exceeds sixty characters and should be truncated",
      },
    ];
    const preview = generatePreview(longTicket);
    expect(preview).toContain(
      "This is a very long summary that exceeds sixty characters an...",
    );
    expect(preview).not.toContain("should be truncated");
  });

  it("includes defaulted tickets section when defaults exist", () => {
    const preview = generatePreview(classified);
    expect(preview).toContain("## Defaulted Tickets (review recommended)");
    expect(preview).toContain("CNV-2");
    expect(preview).toContain("New feature");
  });

  it("omits defaulted section when no defaults exist", () => {
    const noDefaults = classified.filter((t) => t.matched_rule !== "default");
    const preview = generatePreview(noDefaults);
    expect(preview).not.toContain("Defaulted Tickets");
  });

  it("handles empty input", () => {
    const preview = generatePreview([]);
    expect(preview).toContain("Total tickets: 0");
  });
});
