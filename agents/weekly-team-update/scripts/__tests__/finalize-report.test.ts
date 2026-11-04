import { describe, it, expect } from "vitest";
import {
  parseBackportClaims,
  decideCoverage,
  applyVerdicts,
  buildRecommendations,
  renderRecommendations,
  upsertSection,
  reconcileBackportClaims,
  DEFAULT_FOLLOWUPS,
  type BackportClaim,
  type CoverageContext,
  type CloneFact,
  type PrRow,
  type TicketFacts,
  type Verdict,
} from "../finalize-report.js";

const NOW = new Date("2026-11-03T12:00:00Z");
const SUFFIX = " \u2014 Backport needed: ";

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeTicket(overrides: Partial<TicketFacts> = {}): TicketFacts {
  return {
    key: "OCPBUGS-1",
    status: "Verified",
    assignee_name: "Dana Whitfield",
    statuscategorychangedate: daysAgo(2),
    affected_versions: ["4.23"],
    fix_versions: [],
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<CoverageContext> = {},
): CoverageContext {
  return {
    tickets: new Map(),
    clones: new Map(),
    prEvidence: new Map(),
    failedKeys: new Set(),
    supportedVersions: new Map([["OCPBUGS", ["4.22.z", "4.23.z", "5.0.z"]]]),
    ...overrides,
  };
}

function claim(key: string, versions: string[]): BackportClaim {
  return { key, versions };
}

describe("parseBackportClaims", () => {
  it("reads PR bullets and ticket bullets, and flags unparsable suffixes", () => {
    const markdown = [
      "## Completed This Week",
      `- [PR #653 - OCPBUGS-135361: external name fix](https://github.com/o/r/pull/653) (merged Nov 1)${SUFFIX}4.23.z, 5.0.z`,
      `- [OCPBUGS-132373 - stale form data](https://redhat.atlassian.net/browse/OCPBUGS-132373) (resolved Oct 30)${SUFFIX}4.23.z`,
      `- [OCPBUGS-9 - broken](https://example/OCPBUGS-9) (resolved Oct 30)${SUFFIX}4.23`,
      "- Fixed two things ([OCPBUGS-1](https://example/OCPBUGS-1)). Backport needed: [OCPBUGS-1](https://example/OCPBUGS-1) to 4.23.z.",
      `- [PR #480 - [release-4.17] OCPNETUI-168: Update Owners file](https://github.com/o/r/pull/480) (merged Nov 1)${SUFFIX}4.23.z`,
    ].join("\n");

    const { claims, unparsableLines } = parseBackportClaims(markdown);

    expect(claims).toEqual([
      { key: "OCPBUGS-135361", versions: ["4.23.z", "5.0.z"] },
      { key: "OCPBUGS-132373", versions: ["4.23.z"] },
      { key: "OCPNETUI-168", versions: ["4.23.z"] },
    ]);
    expect(unparsableLines).toEqual([4]);
  });
});

describe("decideCoverage", () => {
  it("drops a version that is the ticket's own fix version and keeps the rest", () => {
    const context = makeContext({
      tickets: new Map([
        [
          "OCPBUGS-135361",
          makeTicket({ key: "OCPBUGS-135361", fix_versions: ["5.0.z"] }),
        ],
      ]),
    });

    const verdicts = decideCoverage(
      claim("OCPBUGS-135361", ["4.23.z", "5.0.z"]),
      context,
    );

    expect(verdicts.map((v) => [v.version, v.reason, v.covered])).toEqual([
      ["4.23.z", "needed", false],
      ["5.0.z", "fix_version", true],
    ]);
  });

  it("drops a version covered by a done clone only", () => {
    const doneWithVersion: CloneFact = {
      clone_key: "OCPBUGS-2",
      clone_status_category: "done",
      clone_fix_versions: ["4.22.z"],
    };
    const doneWithoutVersion: CloneFact = {
      clone_key: "OCPBUGS-3",
      clone_status_category: "done",
      clone_fix_versions: [],
    };
    const openClones: CloneFact[] = [
      {
        clone_key: "OCPBUGS-4",
        clone_status_category: "new",
        clone_fix_versions: ["4.23.z"],
      },
      {
        clone_key: "OCPBUGS-5",
        clone_status_category: "indeterminate",
        clone_fix_versions: ["5.0.z"],
      },
    ];

    const dropped = decideCoverage(
      claim("OCPBUGS-1", ["4.22.z"]),
      makeContext({ clones: new Map([["OCPBUGS-1", [doneWithVersion]]]) }),
    );
    expect(dropped[0]).toMatchObject({ reason: "done_clone", covered: true });

    const emptyDone = decideCoverage(
      claim("OCPBUGS-1", ["4.22.z"]),
      makeContext({ clones: new Map([["OCPBUGS-1", [doneWithoutVersion]]]) }),
    );
    expect(emptyDone[0]).toMatchObject({ reason: "needed", covered: false });

    const unstarted = decideCoverage(
      claim("OCPBUGS-1", ["4.23.z", "5.0.z"]),
      makeContext({ clones: new Map([["OCPBUGS-1", openClones]]) }),
    );
    expect(unstarted.map((v) => v.reason)).toEqual(["needed", "needed"]);
  });

  it("drops a version only for a merged PR targeting that release branch", () => {
    const merged = {
      url: "https://github.com/o/r/pull/700",
      number: 700,
      repo: "o/r",
      merged_at: "2026-11-02T00:00:00Z",
      base_ref: "release-4.23",
      title: "OCPBUGS-1: backport",
    };
    const open = { ...merged, number: 701, merged_at: "" };

    const withMerged = decideCoverage(
      claim("OCPBUGS-1", ["4.23.z"]),
      makeContext({ prEvidence: new Map([["OCPBUGS-1", [open, merged]]]) }),
    );
    expect(withMerged[0]).toMatchObject({ reason: "merged_pr", covered: true });

    const onlyOpen = decideCoverage(
      claim("OCPBUGS-1", ["4.23.z"]),
      makeContext({ prEvidence: new Map([["OCPBUGS-1", [open]]]) }),
    );
    expect(onlyOpen[0]).toMatchObject({ reason: "needed", covered: false });

    const titleEvidence = decideCoverage(
      claim("OCPBUGS-1", ["5.0.z"]),
      makeContext({
        prEvidence: new Map([
          [
            "OCPBUGS-1",
            [
              {
                ...merged,
                base_ref: "main",
                title: "[release-5.0] OCPBUGS-1: backport",
              },
            ],
          ],
        ]),
      }),
    );
    expect(titleEvidence[0]).toMatchObject({
      reason: "merged_pr",
      covered: true,
    });
  });

  it("drops versions outside the configured supported versions", () => {
    const verdicts = decideCoverage(
      claim("OCPBUGS-1", ["4.19.z", "4.23.z"]),
      makeContext(),
    );

    expect(verdicts.map((v) => [v.version, v.reason, v.covered])).toEqual([
      ["4.19.z", "unsupported", true],
      ["4.23.z", "needed", false],
    ]);
  });

  it("keeps claims as unverified when the GitHub lookup failed", () => {
    const verdicts = decideCoverage(
      claim("OCPBUGS-1", ["4.23.z"]),
      makeContext({ failedKeys: new Set(["OCPBUGS-1"]) }),
    );

    expect(verdicts[0]).toMatchObject({ reason: "unverified", covered: false });
  });
});

describe("applyVerdicts", () => {
  const line = `- [PR #653 - OCPBUGS-135361: external name fix](https://github.com/o/r/pull/653) (merged Nov 1)${SUFFIX}4.20.z, 4.23.z, 5.0.z`;

  function verdict(key: string, version: string): Verdict {
    return { key, version, covered: true, reason: "fix_version" };
  }

  it("removes a middle version and preserves order", () => {
    const result = applyVerdicts(line, [verdict("OCPBUGS-135361", "4.23.z")]);

    expect(result.markdown).toBe(
      `- [PR #653 - OCPBUGS-135361: external name fix](https://github.com/o/r/pull/653) (merged Nov 1)${SUFFIX}4.20.z, 5.0.z`,
    );
    expect(result.dropped).toEqual(["OCPBUGS-135361 4.23.z"]);
  });

  it("strips the whole suffix when nothing survives", () => {
    const result = applyVerdicts(line, [
      verdict("OCPBUGS-135361", "4.20.z"),
      verdict("OCPBUGS-135361", "4.23.z"),
      verdict("OCPBUGS-135361", "5.0.z"),
    ]);

    expect(result.markdown).toBe(
      "- [PR #653 - OCPBUGS-135361: external name fix](https://github.com/o/r/pull/653) (merged Nov 1)",
    );
    expect(result.markdown.endsWith("Backport needed: ")).toBe(false);
  });

  it("leaves prose that mentions backports alone", () => {
    const prose =
      "- Fixed external name switching ([OCPBUGS-135361](https://example/OCPBUGS-135361)). Backport needed: [OCPBUGS-135361](https://example/OCPBUGS-135361) to 4.23.z.";

    const result = applyVerdicts(prose, [verdict("OCPBUGS-135361", "4.23.z")]);

    expect(result.markdown).toBe(prose);
    expect(result.dropped).toEqual([]);
  });
});

describe("idempotency", () => {
  it("produces identical markdown when the stage runs twice", () => {
    const markdown = [
      "## Completed This Week",
      `- [OCPBUGS-135361 - stale data](https://example/OCPBUGS-135361) (resolved Nov 1)${SUFFIX}4.23.z, 5.0.z`,
      "",
    ].join("\n");
    const verdicts: Verdict[] = [
      {
        key: "OCPBUGS-135361",
        version: "5.0.z",
        covered: true,
        reason: "fix_version",
      },
      {
        key: "OCPBUGS-135361",
        version: "4.23.z",
        covered: false,
        reason: "needed",
      },
    ];
    const body =
      "Follow-ups from this report that need a small action.\n\n_No follow-ups this week._";

    const once = upsertSection(
      applyVerdicts(markdown, verdicts).markdown,
      "## Recommendations",
      body,
    );
    const twice = upsertSection(
      applyVerdicts(once, verdicts).markdown,
      "## Recommendations",
      body,
    );

    expect(twice).toBe(once);
    expect(once.match(/^## Recommendations$/gm)).toHaveLength(1);
  });
});

describe("buildRecommendations", () => {
  function makePr(overrides: Partial<PrRow> = {}): PrRow {
    return {
      engineer: "Casey Voss",
      number: 700,
      title: "OCPNETUI-1: improve form",
      repo: "o/r",
      state: "open",
      created_at: daysAgo(30),
      updated_at: daysAgo(1),
      url: "https://github.com/o/r/pull/700",
      ...overrides,
    };
  }

  it("classifies open PRs and stalled tickets by age", () => {
    const { rows } = buildRecommendations({
      verdicts: [],
      tickets: new Map([
        [
          "OCPNETUI-45",
          makeTicket({
            key: "OCPNETUI-45",
            status: "In Progress",
            assignee_name: "Casey Voss",
            statuscategorychangedate: daysAgo(15),
          }),
        ],
        [
          "OCPNETUI-46",
          makeTicket({
            key: "OCPNETUI-46",
            status: "In Progress",
            statuscategorychangedate: daysAgo(13),
          }),
        ],
      ]),
      prs: [
        makePr({ number: 1, updated_at: daysAgo(2) }),
        makePr({ number: 2, updated_at: daysAgo(4) }),
        makePr({ number: 3, updated_at: daysAgo(9) }),
      ],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows.map((r) => [r.category, r.why])).toEqual([
      ["Review", "Open 4d without merge"],
      ["Stale PR", "Open 9d without merge"],
      ["Stalled ticket", "No status change in 15d"],
    ]);
    expect(rows.map((r) => r.action)).toEqual([
      "Request review or ping reviewer",
      "Unblock: rebase, close, or escalate",
      "Check with the assignee or update status",
    ]);
  });

  it("builds a backport row from a surviving claim", () => {
    const { rows } = buildRecommendations({
      verdicts: [
        {
          key: "OCPBUGS-135361",
          version: "4.23.z",
          covered: false,
          reason: "needed",
        },
        {
          key: "OCPBUGS-135361",
          version: "5.0.z",
          covered: true,
          reason: "fix_version",
        },
      ],
      tickets: new Map([
        [
          "OCPBUGS-135361",
          makeTicket({
            key: "OCPBUGS-135361",
            assignee_name: "Dana Whitfield",
            statuscategorychangedate: daysAgo(3),
          }),
        ],
      ]),
      prs: [],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "Backport",
      item: "[OCPBUGS-135361](https://redhat.atlassian.net/browse/OCPBUGS-135361)",
      why: "Needs backport to 4.23.z",
      action: "Open backport PR to release-4.23",
      owner: "Dana Whitfield",
    });
  });

  it("caps rows per category and reports the remainder", () => {
    const prs = Array.from({ length: 12 }, (_, i) =>
      makePr({ number: 100 + i, updated_at: daysAgo(5) }),
    );

    const { rows, cappedCounts } = buildRecommendations({
      verdicts: [],
      tickets: new Map(),
      prs,
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: { ...DEFAULT_FOLLOWUPS, max_rows_per_category: 8 },
    });

    expect(rows).toHaveLength(8);
    expect(cappedCounts.get("Review")).toBe(4);
    expect(renderRecommendations(rows, cappedCounts)).toContain(
      "4 more not listed.",
    );
  });

  const neededVerdict: Verdict = {
    key: "OCPBUGS-1",
    version: "4.23.z",
    covered: false,
    reason: "needed",
  };

  it("flags an open backport PR for a version the report still claims", () => {
    const { rows } = buildRecommendations({
      verdicts: [neededVerdict],
      tickets: new Map(),
      prs: [
        makePr({
          number: 902,
          title: "[release-4.23] OCPBUGS-1: backport fix",
          updated_at: daysAgo(2),
        }),
      ],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows.map((r) => r.category)).toContain("Backport PR");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      category: "Backport PR",
      why: "Backport PR open 2d",
      action: "Review and merge backport PR",
    });
  });

  it("keeps a stale backport PR in the backport category", () => {
    const { rows } = buildRecommendations({
      verdicts: [neededVerdict],
      tickets: new Map(),
      prs: [
        makePr({
          number: 903,
          title: "[release-4.23] OCPBUGS-1: backport fix",
          updated_at: daysAgo(30),
        }),
      ],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows.map((r) => r.category)).toEqual(["Backport", "Backport PR"]);
    expect(rows.some((r) => r.category === "Stale PR")).toBe(false);
  });

  it("lists a version once when a ticket and its orphan PR both claim it", () => {
    const { rows } = buildRecommendations({
      verdicts: [neededVerdict, { ...neededVerdict }],
      tickets: new Map([["OCPBUGS-1", makeTicket({ key: "OCPBUGS-1" })]]),
      prs: [],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].why).toBe("Needs backport to 4.23.z");
    expect(rows[0].action).toBe("Open backport PR to release-4.23");
  });

  it("keeps an unverified claim as a backport row and says so", () => {
    const { rows } = buildRecommendations({
      verdicts: [{ ...neededVerdict, reason: "unverified" }],
      tickets: new Map(),
      prs: [],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Backport");
    expect(rows[0].why).toBe(
      "Needs backport to 4.23.z (GitHub evidence unavailable)",
    );
  });

  it("maps a Jira display name to the engineer name used elsewhere", () => {
    const { rows } = buildRecommendations({
      verdicts: [neededVerdict],
      tickets: new Map([
        [
          "OCPBUGS-1",
          makeTicket({ key: "OCPBUGS-1", assignee_name: "Dana Whitfield" }),
        ],
      ]),
      prs: [],
      jiraBaseUrl: "https://redhat.atlassian.net/browse",
      now: NOW,
      followups: DEFAULT_FOLLOWUPS,
      jiraDisplayToName: new Map([["Dana Whitfield", "Dana Field"]]),
    });

    expect(rows[0].owner).toBe("Dana Field");
  });
});

describe("reconcileBackportClaims", () => {
  const report = [
    `- [PR #653 - OCPBUGS-135361: fix](https://github.com/o/r/pull/653) (merged Nov 1)${SUFFIX}4.23.z`,
    `- [PR #641 - OCPBUGS-132373: other fix](https://github.com/o/r/pull/641) (merged Oct 29)${SUFFIX}4.23.z`,
  ].join("\n");

  it("drops a version the report no longer claims from a context entry", () => {
    const context = [
      "Backport needed (2): [OCPBUGS-135361](https://x/653) fix (needs: 4.23.z, 5.0.z); [OCPBUGS-132373](https://x/641) other fix (needs: 4.23.z)",
    ].join("\n");

    const reconciled = reconcileBackportClaims(context, report);

    expect(reconciled).toContain(
      "[OCPBUGS-135361](https://x/653) fix (needs: 4.23.z);",
    );
    expect(reconciled).not.toContain("5.0.z");
    expect(reconciled).toContain("Backport needed (2):");
  });

  it("does not split an entry whose summary contains a semicolon", () => {
    const context =
      "Backport needed (1): [OCPBUGS-135361](https://x/653) fix; then more (needs: 4.23.z, 5.0.z)";

    const reconciled = reconcileBackportClaims(context, report);

    expect(reconciled).toBe(
      "Backport needed (1): [OCPBUGS-135361](https://x/653) fix; then more (needs: 4.23.z)",
    );
  });

  it("removes entries and the whole line once nothing survives", () => {
    const partial = reconcileBackportClaims(
      "Backport needed (2): [OCPBUGS-135361](https://x/653) fix (needs: 4.23.z); [OCPBUGS-9](https://x/9) gone (needs: 5.0.z)",
      report,
    );
    expect(partial).toBe(
      "Backport needed (1): [OCPBUGS-135361](https://x/653) fix (needs: 4.23.z)",
    );

    const allGone = reconcileBackportClaims(
      "Backport needed (1): [OCPBUGS-9](https://x/9) gone (needs: 5.0.z)",
      report,
    );
    expect(allGone).toBe("");
  });

  it("removes a Backport risk line whose versions are not claimed", () => {
    const context = [
      "### Product",
      "  Backport risk: [OCPBUGS-9](https://x/9) gone (needs: 5.0.z)",
      "  Backport risk: [OCPBUGS-135361](https://x/653) fix (needs: 4.23.z, 5.0.z)",
    ].join("\n");

    const reconciled = reconcileBackportClaims(context, report);

    expect(reconciled).not.toContain("OCPBUGS-9");
    expect(reconciled).toContain(
      "Backport risk: [OCPBUGS-135361](https://x/653) fix (needs: 4.23.z)",
    );
  });

  it("keeps entries it cannot attribute to a key and is idempotent", () => {
    const context = [
      "Backport needed (1): unknown entry (needs: 4.23.z, 5.0.z)",
      "Completed (1): something else",
    ].join("\n");

    const once = reconcileBackportClaims(context, report);

    expect(once).toBe(context);
    expect(reconcileBackportClaims(once, report)).toBe(once);
  });
});

describe("upsertSection", () => {
  it("replaces an existing section instead of duplicating it", () => {
    const original = [
      "## In Progress",
      "",
      "- item",
      "",
      "## Recommendations",
      "",
      "_stale content_",
      "",
      "## Appendix",
      "",
      "- tail",
      "",
    ].join("\n");

    const updated = upsertSection(
      original,
      "## Recommendations",
      "_fresh content_",
    );

    expect(updated.match(/^## Recommendations$/gm)).toHaveLength(1);
    expect(updated).toContain("_fresh content_");
    expect(updated).not.toContain("_stale content_");
    expect(updated).toContain("## Appendix");
    expect(updated.indexOf("## Recommendations")).toBeLessThan(
      updated.indexOf("## Appendix"),
    );
  });
});
