import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  parseDate,
  parseCsvLine,
  loadCsvFile,
  loadGithubPrs,
  loadGitlabMrs,
  loadJiraTickets,
  loadConfig,
  buildTicketIdRe,
  buildRepoToProduct,
  buildPrefixToProduct,
  buildOcpbugsSummaryRepoRe,
  buildAccountIdToName,
  buildJiraDisplayToName,
  filterCompletedPrs,
  filterOpenPrs,
  filterCompletedJira,
  filterInProgressJira,
  extractTicketIds,
  nestPrsUnderTickets,
  nestInProgress,
  determineProduct,
  shouldConsolidateTestTasks,
  organize,
  fmtDate,
  fmtReportDate,
  fmtPrLink,
  fmtTicketLink,
  fmtTestTaskSummary,
  formatCompletedSection,
  formatInProgressSection,
  generateHighlights,
  validateData,
  type PRItem,
  type JiraItem,
} from "../generate-weekly-report.js";

const AGENT_ROOT = resolve(import.meta.dirname, "../..");
const CONFIG_PATH = resolve(AGENT_ROOT, "data/team-config.json");
const CACHE_DIR = resolve(AGENT_ROOT, "data/cache");

function makePR(overrides: Partial<PRItem> = {}): PRItem {
  return {
    engineer: "Test User",
    number: 1,
    title: "Test PR",
    repo: "org/repo",
    state: "merged",
    created_at: "2026-05-01T10:00:00Z",
    merged_at: "2026-05-05T10:00:00Z",
    url: "https://github.com/org/repo/pull/1",
    source: "github",
    issue_refs: [],
    ...overrides,
  };
}

function makeJira(overrides: Partial<JiraItem> = {}): JiraItem {
  return {
    engineer: "Test User",
    key: "TEST-123",
    summary: "Test ticket",
    status: "Closed",
    resolution: "Done",
    resolutiondate: "2026-05-05T10:00:00Z",
    issuetype: "Story",
    priority: "Major",
    url: "https://redhat.atlassian.net/browse/TEST-123",
    role: "assignee",
    nested_prs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseDate
// ---------------------------------------------------------------------------

describe("parseDate", () => {
  it("parses ISO-8601 with Z suffix", () => {
    const d = parseDate("2026-05-07T10:21:15Z");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(4); // May = 4
    expect(d!.getUTCDate()).toBe(7);
  });

  it("parses ISO-8601 with timezone offset +0000", () => {
    const d = parseDate("2026-05-07T10:21:15.492+0000");
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(7);
  });

  it("parses ISO-8601 with timezone offset +00:00", () => {
    const d = parseDate("2026-05-07T10:21:15+00:00");
    expect(d).not.toBeNull();
  });

  it("parses date-only format", () => {
    const d = parseDate("2026-05-07");
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(7);
  });

  it("parses ISO with milliseconds and Z", () => {
    const d = parseDate("2026-04-28T13:24:49.357Z");
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(28);
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for whitespace", () => {
    expect(parseDate("   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCsvLine
// ---------------------------------------------------------------------------

describe("parseCsvLine", () => {
  it("parses simple comma-separated values", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped quotes in quoted fields", () => {
    expect(parseCsvLine('a,"say ""hello""",c')).toEqual(["a", 'say "hello"', "c"]);
  });

  it("handles empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles trailing empty field", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

// ---------------------------------------------------------------------------
// fmtDate
// ---------------------------------------------------------------------------

describe("fmtDate", () => {
  it("formats May 7 without leading zero", () => {
    expect(fmtDate("2026-05-07T10:00:00Z")).toBe("May 7");
  });

  it("formats Apr 30", () => {
    expect(fmtDate("2026-04-30T10:00:00Z")).toBe("Apr 30");
  });

  it("formats Jan 1", () => {
    expect(fmtDate("2026-01-01T00:00:00Z")).toBe("Jan 1");
  });

  it("returns empty for invalid date", () => {
    expect(fmtDate("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fmtReportDate
// ---------------------------------------------------------------------------

describe("fmtReportDate", () => {
  it("formats full date", () => {
    expect(fmtReportDate(new Date("2026-05-07T00:00:00Z"))).toBe("May 7, 2026");
  });
});

// ---------------------------------------------------------------------------
// fmtPrLink
// ---------------------------------------------------------------------------

describe("fmtPrLink", () => {
  it("formats GitHub PR with merged date", () => {
    const pr = makePR({ number: 42, title: "Fix bug", merged_at: "2026-05-05T10:00:00Z" });
    expect(fmtPrLink(pr)).toBe(
      "- [PR #42 - Fix bug](https://github.com/org/repo/pull/1) (merged May 5)",
    );
  });

  it("formats GitLab MR with opened date", () => {
    const mr = makePR({
      number: 10,
      title: "Add feature",
      source: "gitlab",
      merged_at: "",
      url: "https://gitlab.com/org/repo/-/merge_requests/10",
    });
    expect(fmtPrLink(mr)).toBe(
      "- [MR !10 - Add feature](https://gitlab.com/org/repo/-/merge_requests/10) (opened May 1)",
    );
  });

  it("indents when indent > 0", () => {
    const pr = makePR({ number: 1, title: "X" });
    expect(fmtPrLink(pr, 1).startsWith("  - ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fmtTicketLink
// ---------------------------------------------------------------------------

describe("fmtTicketLink", () => {
  it("formats completed ticket", () => {
    const t = makeJira({ key: "CNV-123", summary: "Fix thing", resolutiondate: "2026-05-07T00:00:00Z" });
    expect(fmtTicketLink(t, true)).toBe(
      "- [CNV-123 - Fix thing](https://redhat.atlassian.net/browse/TEST-123) (resolved May 7)",
    );
  });

  it("adds QA tag for qa_contact role", () => {
    const t = makeJira({ role: "qa_contact" });
    expect(fmtTicketLink(t, true)).toContain("(QA)");
  });

  it("formats in-progress with status", () => {
    const t = makeJira({ status: "In Progress", priority: "Major" });
    expect(fmtTicketLink(t, false)).toContain("(In Progress)");
    expect(fmtTicketLink(t, false)).not.toContain("priority");
  });

  it("adds priority suffix for Critical/Blocker", () => {
    const t = makeJira({ status: "In Progress", priority: "Critical" });
    expect(fmtTicketLink(t, false)).toContain("Critical priority");
  });
});

// ---------------------------------------------------------------------------
// filterCompletedPrs
// ---------------------------------------------------------------------------

describe("filterCompletedPrs", () => {
  const ws = new Date("2026-04-30T00:00:00Z");
  const we = new Date("2026-05-08T00:00:00Z");

  it("includes merged PRs within window", () => {
    const prs = [makePR({ state: "merged", merged_at: "2026-05-05T10:00:00Z" })];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(1);
  });

  it("excludes open PRs", () => {
    const prs = [makePR({ state: "open", merged_at: "" })];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(0);
  });

  it("excludes PRs outside window", () => {
    const prs = [makePR({ state: "merged", merged_at: "2026-04-20T10:00:00Z" })];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(0);
  });

  it("includes closed PRs with merged_at in window", () => {
    const prs = [makePR({ state: "closed", merged_at: "2026-05-01T10:00:00Z" })];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// filterOpenPrs
// ---------------------------------------------------------------------------

describe("filterOpenPrs", () => {
  it("includes open and opened states", () => {
    const prs = [
      makePR({ state: "open" }),
      makePR({ state: "opened" }),
      makePR({ state: "merged" }),
    ];
    expect(filterOpenPrs(prs)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// filterCompletedJira
// ---------------------------------------------------------------------------

describe("filterCompletedJira", () => {
  const ws = new Date("2026-04-30T00:00:00Z");
  const we = new Date("2026-05-08T00:00:00Z");

  it("includes Done tickets resolved in window", () => {
    const tickets = [makeJira({ resolution: "Done", resolutiondate: "2026-05-05T10:00:00Z" })];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(1);
  });

  it("excludes non-Done resolutions", () => {
    const tickets = [makeJira({ resolution: "Won't Do", resolutiondate: "2026-05-05T10:00:00Z" })];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(0);
  });

  it("excludes tickets outside window", () => {
    const tickets = [makeJira({ resolution: "Done", resolutiondate: "2026-04-20T10:00:00Z" })];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterInProgressJira
// ---------------------------------------------------------------------------

describe("filterInProgressJira", () => {
  it("excludes Done/Closed/Resolved/Verified/New statuses", () => {
    const statuses = ["Done", "Closed", "Resolved", "Verified", "New"];
    const tickets = statuses.map((s) => makeJira({ status: s }));
    expect(filterInProgressJira(tickets)).toHaveLength(0);
  });

  it("includes In Progress status", () => {
    const tickets = [makeJira({ status: "In Progress" })];
    expect(filterInProgressJira(tickets)).toHaveLength(1);
  });

  it("filters Bug/qa_contact to only ON_QA status", () => {
    const bugQa = makeJira({ issuetype: "Bug", role: "qa_contact", status: "In Progress" });
    expect(filterInProgressJira([bugQa])).toHaveLength(0);

    const bugQaOnQa = makeJira({ issuetype: "Bug", role: "qa_contact", status: "ON_QA" });
    expect(filterInProgressJira([bugQaOnQa])).toHaveLength(1);
  });

  it("filters Bug/assignee to dev statuses", () => {
    const bugDev = makeJira({ issuetype: "Bug", role: "assignee", status: "ASSIGNED" });
    expect(filterInProgressJira([bugDev])).toHaveLength(1);

    const bugDevOther = makeJira({ issuetype: "Bug", role: "assignee", status: "ON_QA" });
    expect(filterInProgressJira([bugDevOther])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractTicketIds
// ---------------------------------------------------------------------------

describe("extractTicketIds", () => {
  it("extracts ticket IDs from PR title", () => {
    const re = /((CNV|MTV|MTA|OCPBUGS|CONSOLE)-\d+)/g;
    expect(extractTicketIds("CNV-123: fix bug", re)).toEqual(["CNV-123"]);
  });

  it("extracts multiple IDs", () => {
    const re = /((CNV|MTV|MTA|OCPBUGS|CONSOLE)-\d+)/g;
    expect(extractTicketIds("OCPBUGS-81616, OCPBUGS-79458: CVE fix", re)).toEqual([
      "OCPBUGS-81616",
      "OCPBUGS-79458",
    ]);
  });

  it("returns empty for no match", () => {
    const re = /((CNV|MTV|MTA)-\d+)/g;
    expect(extractTicketIds("just a PR title", re)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nestPrsUnderTickets
// ---------------------------------------------------------------------------

describe("nestPrsUnderTickets", () => {
  it("nests PR under ticket by title match", () => {
    const re = /((CNV|MTV)-\d+)/g;
    const pr = makePR({ title: "CNV-100: fix bug" });
    const ticket = makeJira({ key: "CNV-100", nested_prs: [] });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("nests PR via issue_refs", () => {
    const re = /((CNV|MTV)-\d+)/g;
    const pr = makePR({ title: "Fix something", issue_refs: ["CNV-200"] });
    const ticket = makeJira({ key: "CNV-200", nested_prs: [] });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("nests PR via github ref index", () => {
    const re = /((MTA)-\d+)/g;
    const pr = makePR({
      title: "Use shared component",
      repo: "konveyor/tackle2-ui",
      issue_refs: ["3212"],
      engineer: "Radek",
    });
    const ticket = makeJira({
      key: "MTA-6873",
      summary: "[tackle2-ui#3212] Replace duplicated implementations",
      engineer: "Radek",
      nested_prs: [],
    });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("orphans PR when no match found", () => {
    const re = /((CNV)-\d+)/g;
    const pr = makePR({ title: "Unrelated change" });
    const ticket = makeJira({ key: "CNV-999", nested_prs: [] });
    const { orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(orphanPrs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// determineProduct
// ---------------------------------------------------------------------------

describe("determineProduct", () => {
  const config = existsSync(CONFIG_PATH) ? loadConfig(CONFIG_PATH) : null;

  it.skipIf(!config)("maps Jira ticket by prefix", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const ticket = makeJira({ key: "CNV-123", summary: "A ticket" });
    expect(determineProduct(ticket, config!, repoToProduct, prefixToProduct, ocpbugsRe, ticketIdRe)).toBe("CNV");
  });

  it.skipIf(!config)("maps OCPBUGS by repo name in summary", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const ticket = makeJira({
      key: "OCPBUGS-123",
      summary: "CVE in nmstate-console-plugin",
    });
    expect(determineProduct(ticket, config!, repoToProduct, prefixToProduct, ocpbugsRe, ticketIdRe)).toBe("Console Plugins");
  });

  it.skipIf(!config)("maps PR by repo", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const pr = makePR({ repo: "kubev2v/forklift-console-plugin" });
    expect(determineProduct(pr, config!, repoToProduct, prefixToProduct, ocpbugsRe, ticketIdRe)).toBe("MTV");
  });

  it.skipIf(!config)("returns Other for unknown items", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const pr = makePR({ repo: "unknown/repo", title: "something" });
    expect(determineProduct(pr, config!, repoToProduct, prefixToProduct, ocpbugsRe, ticketIdRe)).toBe("Other");
  });
});

// ---------------------------------------------------------------------------
// shouldConsolidateTestTasks
// ---------------------------------------------------------------------------

describe("shouldConsolidateTestTasks", () => {
  it("consolidates when > 3 test tasks", () => {
    const tickets = [
      makeJira({ summary: "[TIER-1][test] cnv-4.18.35" }),
      makeJira({ summary: "[TIER-2][test] cnv-4.18.35" }),
      makeJira({ summary: "[POST-UPGRADE][test] cnv-4.14.18" }),
      makeJira({ summary: "[STAGE][test] cnv-4.12.23" }),
    ];
    const { consolidate, testTickets, otherTickets } = shouldConsolidateTestTasks(tickets);
    expect(consolidate).toBe(true);
    expect(testTickets).toHaveLength(4);
    expect(otherTickets).toHaveLength(0);
  });

  it("does not consolidate when <= 3 test tasks", () => {
    const tickets = [
      makeJira({ summary: "[TIER-1][test] cnv-4.18.35" }),
      makeJira({ summary: "Regular ticket" }),
    ];
    const { consolidate, testTickets, otherTickets } = shouldConsolidateTestTasks(tickets);
    expect(consolidate).toBe(false);
    expect(testTickets).toHaveLength(1);
    expect(otherTickets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// fmtTestTaskSummary
// ---------------------------------------------------------------------------

describe("fmtTestTaskSummary", () => {
  it("aggregates versions and creates summary", () => {
    const tickets = [
      makeJira({
        key: "CNV-1",
        summary: "[TIER-1] cnv-4.18.35",
        url: "https://redhat.atlassian.net/browse/CNV-1",
      }),
      makeJira({
        key: "CNV-2",
        summary: "[TIER-2] cnv-4.14.18",
        url: "https://redhat.atlassian.net/browse/CNV-2",
      }),
    ];
    const result = fmtTestTaskSummary(tickets);
    expect(result).toContain("2 CNV release test execution tasks completed");
    expect(result).toContain("4.14.18");
    expect(result).toContain("4.18.35");
  });
});

// ---------------------------------------------------------------------------
// generateHighlights
// ---------------------------------------------------------------------------

describe("generateHighlights", () => {
  it("generates CVE highlight", () => {
    const sections = new Map<string, Map<string, { name: string; completed_tickets: JiraItem[]; completed_prs: PRItem[]; in_progress_tickets: JiraItem[]; in_progress_prs: PRItem[] }>>();
    const engineers = new Map();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: "CVE-2026-1234 lodash vulnerability", issuetype: "Bug" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("MTA", engineers);

    const highlights = generateHighlights(sections);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]).toContain("CVE");
    expect(highlights[0]).toContain("lodash");
  });

  it("generates test version highlight", () => {
    const sections = new Map<string, Map<string, { name: string; completed_tickets: JiraItem[]; completed_prs: PRItem[]; in_progress_tickets: JiraItem[]; in_progress_prs: PRItem[] }>>();
    const engineers = new Map();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: "[TIER-1][test-kubevirt] cnv-4.18.35" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("CNV", engineers);

    const highlights = generateHighlights(sections);
    expect(highlights).toContainEqual(expect.stringContaining("4.18.35"));
  });

  it("returns max 4 highlights", () => {
    const sections = new Map<string, Map<string, { name: string; completed_tickets: JiraItem[]; completed_prs: PRItem[]; in_progress_tickets: JiraItem[]; in_progress_prs: PRItem[] }>>();
    for (const pk of ["A", "B", "C", "D", "E"]) {
      const engineers = new Map();
      engineers.set("User", {
        name: "User",
        completed_tickets: [makeJira({ summary: `Feature for ${pk}`, issuetype: "Story" })],
        completed_prs: [],
        in_progress_tickets: [],
        in_progress_prs: [],
      });
      sections.set(pk, engineers);
    }

    const highlights = generateHighlights(sections);
    expect(highlights.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// validateData
// ---------------------------------------------------------------------------

describe("validateData", () => {
  const config = existsSync(CONFIG_PATH) ? loadConfig(CONFIG_PATH) : null;

  it.skipIf(!config)("errors when github-prs is empty", () => {
    const { errors } = validateData([], [], [makeJira()], config!);
    expect(errors).toContainEqual(expect.stringContaining("github-prs.csv"));
  });

  it.skipIf(!config)("errors when jira-tickets is empty", () => {
    const { errors } = validateData([makePR()], [], [], config!);
    expect(errors).toContainEqual(expect.stringContaining("jira-tickets.csv"));
  });

  it.skipIf(!config)("warns on low merged PR count", () => {
    const prs = Array.from({ length: 3 }, () => makePR({ state: "merged" }));
    const { warnings } = validateData(prs, [], [makeJira()], config!);
    expect(warnings.some((w) => w.includes("merged GitHub PRs"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

describe("config helpers", () => {
  const config = existsSync(CONFIG_PATH) ? loadConfig(CONFIG_PATH) : null;

  it.skipIf(!config)("buildAccountIdToName maps all engineers", () => {
    const map = buildAccountIdToName(config!);
    expect(map.size).toBe(config!.engineers.length);
  });

  it.skipIf(!config)("buildJiraDisplayToName maps display names", () => {
    const map = buildJiraDisplayToName(config!);
    expect(map.size).toBeGreaterThan(0);
    expect(map.get("Scott Dickerson")).toBe("Scott Dickers");
  });

  it.skipIf(!config)("buildTicketIdRe matches known prefixes", () => {
    const re = buildTicketIdRe(config!);
    re.lastIndex = 0;
    const m = re.exec("CNV-12345");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("CNV-12345");
  });

  it.skipIf(!config)("buildRepoToProduct maps repos", () => {
    const map = buildRepoToProduct(config!);
    expect(map.get("kubev2v/forklift-console-plugin")).toBe("MTV");
    expect(map.get("forklift-console-plugin")).toBe("MTV");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: compare output with reference
// ---------------------------------------------------------------------------

describe("end-to-end", () => {
  const config = existsSync(CONFIG_PATH) ? loadConfig(CONFIG_PATH) : null;
  const hasCache = existsSync(resolve(CACHE_DIR, "github-prs.csv"));
  const referenceFile = resolve(AGENT_ROOT, "data/output/weekly-update-2026-05-07.md");
  const hasReference = existsSync(referenceFile);

  it.skipIf(!config || !hasCache || !hasReference)(
    "generates output identical to reference report",
    () => {
      const ticketIdRe = buildTicketIdRe(config!);
      const githubPrs = loadGithubPrs(CACHE_DIR);
      const gitlabMrs = loadGitlabMrs(CACHE_DIR);
      const jiraTickets = loadJiraTickets(CACHE_DIR, config!);
      const allPrs = [...githubPrs, ...gitlabMrs];

      const reportDate = new Date("2026-05-07T00:00:00Z");
      const windowStart = new Date(reportDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(reportDate.getTime() + 1 * 24 * 60 * 60 * 1000);

      const completedPrs = filterCompletedPrs(allPrs, windowStart, windowEnd);
      const openPrs = filterOpenPrs(allPrs);
      const completedJira = filterCompletedJira(jiraTickets, windowStart, windowEnd);
      const ipJira = filterInProgressJira(jiraTickets);

      const { tickets: completedTickets, orphanPrs: completedOrphanPrs } =
        nestPrsUnderTickets(completedPrs, completedJira, ticketIdRe);
      const { tickets: ipTickets, orphanPrs: ipOrphanPrs } =
        nestInProgress(openPrs, ipJira, ticketIdRe);

      const sections = organize(
        completedTickets,
        completedOrphanPrs,
        ipTickets,
        ipOrphanPrs,
        config!,
        ticketIdRe,
      );

      const highlights = generateHighlights(sections);
      const { warnings } = validateData(githubPrs, gitlabMrs, jiraTickets, config!);

      const reportLines: string[] = [
        `# ${config!.report_title}`,
        fmtReportDate(reportDate),
        "",
        "## Key Highlights",
      ];
      reportLines.push(
        ...(highlights.length > 0 ? highlights : ["- Steady delivery across all products"]),
      );
      reportLines.push("");

      if (warnings.length > 0) {
        reportLines.push("## Data Quality Notes");
        for (const w of warnings) reportLines.push(`- ${w}`);
        reportLines.push("");
      }

      reportLines.push("## Completed This Week");
      reportLines.push(formatCompletedSection(sections, config!));

      reportLines.push("## In Progress");
      reportLines.push(formatInProgressSection(sections, config!));

      const reportText = reportLines.join("\n") + "\n";
      const expected = readFileSync(referenceFile, "utf-8");
      expect(reportText).toBe(expected);
    },
  );
});
