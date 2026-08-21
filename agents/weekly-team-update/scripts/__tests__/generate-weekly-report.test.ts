import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  parseDate,
  parseCsvLine,
  loadGithubPrs,
  loadGitlabMrs,
  loadJiraTickets,
  loadConfig,
  buildTicketIdRe,
  buildRepoToProduct,
  buildPrefixToProduct,
  buildOrgToProduct,
  buildOcpbugsSummaryRepoRe,
  buildAccountIdToName,
  buildJiraDisplayToName,
  filterCompletedPrs,
  filterOpenPrs,
  filterCompletedJira,
  filterGithubSyncedTickets,
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
  computeHighlightData,
  formatHighlightContext,
  validateData,
  loadCustomerCases,
  mergeCustomerCases,
  type PRItem,
  type JiraItem,
  type EngineerBlock,
  type CustomerCase,
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
    statuscategorychangedate: "2026-05-05T10:00:00Z",
    issuetype: "Story",
    priority: "Major",
    url: "https://test.atlassian.net/browse/TEST-123",
    role: "assignee",
    sprint_name: "",
    nested_prs: [],
    customer_cases: [],
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
    expect(parseCsvLine('a,"say ""hello""",c')).toEqual([
      "a",
      'say "hello"',
      "c",
    ]);
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
    const pr = makePR({
      number: 42,
      title: "Fix bug",
      merged_at: "2026-05-05T10:00:00Z",
    });
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
    const t = makeJira({
      key: "PROJ-123",
      summary: "Fix thing",
      resolutiondate: "2026-05-07T00:00:00Z",
    });
    expect(fmtTicketLink(t, true)).toBe(
      "- [PROJ-123 - Fix thing](https://test.atlassian.net/browse/TEST-123) (resolved May 7)",
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

  it("appends single customer inline", () => {
    const t = makeJira({
      key: "PROJ-100",
      summary: "Fix crash",
      resolutiondate: "2026-05-07T00:00:00Z",
      customer_cases: [
        {
          case_id: "CIPOE-100",
          url: "https://your-site.atlassian.net/browse/CIPOE-100",
          customer_name: "Acme Corp",
        },
      ],
    });
    const result = fmtTicketLink(t, true);
    expect(result).toContain("— Customer: Acme Corp");
  });

  it("appends multiple customers", () => {
    const t = makeJira({
      customer_cases: [
        { case_id: "CIPOE-100", url: "", customer_name: "Acme" },
        { case_id: "CIPOE-200", url: "", customer_name: "Widget Inc" },
      ],
    });
    const result = fmtTicketLink(t, true);
    expect(result).toContain("— Customers: Acme, Widget Inc");
  });

  it("shows account key when customer name is empty", () => {
    const t = makeJira({
      customer_cases: [{ case_id: "CIPOE-300", url: "", customer_name: "" }],
    });
    const result = fmtTicketLink(t, false);
    expect(result).toContain("— Customer: CIPOE-300");
  });

  it("shows no customer info when customer_cases is empty", () => {
    const t = makeJira({ customer_cases: [] });
    const result = fmtTicketLink(t, true);
    expect(result).not.toContain("Customer");
    expect(result).not.toContain("—");
  });
});

// ---------------------------------------------------------------------------
// loadCustomerCases / mergeCustomerCases
// ---------------------------------------------------------------------------

describe("loadCustomerCases", () => {
  it("parses CSV into a map keyed by ticket", () => {
    const dir = resolve(tmpdir(), `cc-test-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "customer-cases.csv"),
      [
        "ticket_key,case_id,case_url,customer_name",
        'MTV-100,CIPOE-100,https://your-site.atlassian.net/browse/CIPOE-100,"Acme Corp"',
        "MTV-100,CIPOE-200,https://your-site.atlassian.net/browse/CIPOE-200,Widget",
        "MTV-200,CIPOE-300,https://your-site.atlassian.net/browse/CIPOE-300,",
      ].join("\n"),
    );
    const map = loadCustomerCases(dir);
    expect(map.size).toBe(2);
    expect(map.get("MTV-100")).toHaveLength(2);
    expect(map.get("MTV-100")![0].customer_name).toBe("Acme Corp");
    expect(map.get("MTV-200")![0].customer_name).toBe("");
    rmSync(dir, { recursive: true });
  });

  it("returns empty map when file is missing", () => {
    const map = loadCustomerCases("/tmp/nonexistent-cc-dir");
    expect(map.size).toBe(0);
  });
});

describe("mergeCustomerCases", () => {
  it("merges cases into matching tickets", () => {
    const tickets = [
      makeJira({ key: "MTV-100" }),
      makeJira({ key: "MTV-200" }),
    ];
    const cases = new Map<string, CustomerCase[]>([
      [
        "MTV-100",
        [
          {
            case_id: "CIPOE-100",
            url: "https://your-site.atlassian.net/browse/CIPOE-100",
            customer_name: "Acme",
          },
        ],
      ],
    ]);
    mergeCustomerCases(tickets, cases);
    expect(tickets[0].customer_cases).toHaveLength(1);
    expect(tickets[0].customer_cases[0].case_id).toBe("CIPOE-100");
    expect(tickets[1].customer_cases).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterCompletedPrs
// ---------------------------------------------------------------------------

describe("filterCompletedPrs", () => {
  const ws = new Date("2026-04-30T00:00:00Z");
  const we = new Date("2026-05-08T00:00:00Z");

  it("includes merged PRs within window", () => {
    const prs = [
      makePR({ state: "merged", merged_at: "2026-05-05T10:00:00Z" }),
    ];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(1);
  });

  it("excludes open PRs", () => {
    const prs = [makePR({ state: "open", merged_at: "" })];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(0);
  });

  it("excludes PRs outside window", () => {
    const prs = [
      makePR({ state: "merged", merged_at: "2026-04-20T10:00:00Z" }),
    ];
    expect(filterCompletedPrs(prs, ws, we)).toHaveLength(0);
  });

  it("includes closed PRs with merged_at in window", () => {
    const prs = [
      makePR({ state: "closed", merged_at: "2026-05-01T10:00:00Z" }),
    ];
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

  it("filters out PRs older than cutoff date", () => {
    const cutoff = new Date("2026-05-01T00:00:00Z");
    const prs = [
      makePR({ state: "open", created_at: "2026-05-10T10:00:00Z" }),
      makePR({ state: "open", created_at: "2026-04-01T10:00:00Z" }),
      makePR({ state: "open", created_at: "2026-01-15T10:00:00Z" }),
    ];
    expect(filterOpenPrs(prs, cutoff)).toHaveLength(1);
  });

  it("includes all open PRs when no cutoff is provided", () => {
    const prs = [
      makePR({ state: "open", created_at: "2025-01-01T10:00:00Z" }),
      makePR({ state: "open", created_at: "2026-05-10T10:00:00Z" }),
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
    const tickets = [
      makeJira({ resolution: "Done", resolutiondate: "2026-05-05T10:00:00Z" }),
    ];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(1);
  });

  it("excludes non-Done resolutions", () => {
    const tickets = [
      makeJira({
        resolution: "Won't Do",
        resolutiondate: "2026-05-05T10:00:00Z",
      }),
    ];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(0);
  });

  it("excludes tickets outside window", () => {
    const tickets = [
      makeJira({
        resolution: "Done",
        resolutiondate: "2026-04-20T10:00:00Z",
        statuscategorychangedate: "2026-04-20T10:00:00Z",
      }),
    ];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(0);
  });

  it("excludes tickets that only transitioned between Done statuses (e.g. VERIFIED → Closed)", () => {
    const tickets = [
      makeJira({
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
        statuscategorychangedate: "2026-03-15T10:00:00Z",
      }),
    ];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(0);
  });

  it("falls back to resolutiondate when statuscategorychangedate is empty", () => {
    const tickets = [
      makeJira({
        resolution: "Done",
        resolutiondate: "2026-05-05T10:00:00Z",
        statuscategorychangedate: "",
      }),
    ];
    expect(filterCompletedJira(tickets, ws, we)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// filterInProgressJira
// ---------------------------------------------------------------------------

describe("filterInProgressJira", () => {
  it("excludes Done/Closed/Resolved/Verified statuses", () => {
    const statuses = ["Done", "Closed", "Resolved", "Verified"];
    const tickets = statuses.map((s) => makeJira({ status: s }));
    expect(filterInProgressJira(tickets)).toHaveLength(0);
  });

  it("includes New status (not-started sprint items)", () => {
    const tickets = [makeJira({ status: "New" })];
    expect(filterInProgressJira(tickets)).toHaveLength(1);
  });

  it("includes In Progress status", () => {
    const tickets = [makeJira({ status: "In Progress" })];
    expect(filterInProgressJira(tickets)).toHaveLength(1);
  });

  it("filters Bug/qa_contact to only ON_QA status", () => {
    const bugQa = makeJira({
      issuetype: "Bug",
      role: "qa_contact",
      status: "In Progress",
    });
    expect(filterInProgressJira([bugQa])).toHaveLength(0);

    const bugQaOnQa = makeJira({
      issuetype: "Bug",
      role: "qa_contact",
      status: "ON_QA",
    });
    expect(filterInProgressJira([bugQaOnQa])).toHaveLength(1);
  });

  it("filters Bug/assignee to dev statuses", () => {
    const bugDev = makeJira({
      issuetype: "Bug",
      role: "assignee",
      status: "ASSIGNED",
    });
    expect(filterInProgressJira([bugDev])).toHaveLength(1);

    const bugDevOther = makeJira({
      issuetype: "Bug",
      role: "assignee",
      status: "ON_QA",
    });
    expect(filterInProgressJira([bugDevOther])).toHaveLength(0);
  });

  it("includes Bug with customer accounts regardless of status", () => {
    const bugNew = makeJira({
      issuetype: "Bug",
      role: "assignee",
      status: "New",
      customer_cases: [
        { case_id: "CIPOE-100", url: "", customer_name: "Acme Corp" },
      ],
    });
    expect(filterInProgressJira([bugNew])).toHaveLength(1);

    const bugNewNoCases = makeJira({
      issuetype: "Bug",
      role: "assignee",
      status: "New",
      customer_cases: [],
    });
    expect(filterInProgressJira([bugNewNoCases])).toHaveLength(0);
  });

  it("excludes tickets not in matching sprint when pattern is provided", () => {
    const pattern = /^Team Sprint \d+$/;
    const inSprint = makeJira({
      status: "In Progress",
      sprint_name: "Team Sprint 5",
    });
    const notInSprint = makeJira({
      status: "In Progress",
      sprint_name: "",
    });
    const wrongSprint = makeJira({
      status: "In Progress",
      sprint_name: "Network QE Sprint 12",
    });
    expect(
      filterInProgressJira([inSprint, notInSprint, wrongSprint], pattern),
    ).toHaveLength(1);
  });

  it("includes all non-excluded tickets when no sprint pattern is provided", () => {
    const tickets = [
      makeJira({ status: "In Progress", sprint_name: "" }),
      makeJira({ status: "POST", sprint_name: "Some Other Sprint" }),
    ];
    expect(filterInProgressJira(tickets)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// filterGithubSyncedTickets
// ---------------------------------------------------------------------------

describe("filterGithubSyncedTickets", () => {
  const configWithFilter = {
    products: [
      {
        key: "MTA",
        name: "Migration Toolkit for Applications",
        jira_prefixes: ["MTA"],
        repos: [],
        filter_github_synced_without_pr: true,
      },
      {
        key: "MTV",
        name: "Migration Toolkit for Virtualization",
        jira_prefixes: ["MTV"],
        repos: [],
      },
    ],
  } as Parameters<typeof filterGithubSyncedTickets>[1];

  it("removes a GitHub-synced MTA ticket with no nested PRs", () => {
    const ticket = makeJira({
      key: "MTA-1234",
      summary: "[tackle2-ui#2840] Some feature",
      nested_prs: [],
    });
    expect(filterGithubSyncedTickets([ticket], configWithFilter)).toHaveLength(
      0,
    );
  });

  it("keeps a GitHub-synced MTA ticket that has a nested PR", () => {
    const ticket = makeJira({
      key: "MTA-1234",
      summary: "[tackle2-ui#2840] Some feature",
      nested_prs: [makePR()],
    });
    expect(filterGithubSyncedTickets([ticket], configWithFilter)).toHaveLength(
      1,
    );
  });

  it("keeps an MTA ticket with no [repo#NNNN] pattern even without nested PRs", () => {
    const ticket = makeJira({
      key: "MTA-7238",
      summary: "RedHat logo appears too white/washed out",
      nested_prs: [],
    });
    expect(filterGithubSyncedTickets([ticket], configWithFilter)).toHaveLength(
      1,
    );
  });

  it("does not filter GitHub-synced tickets for products without the flag", () => {
    const ticket = makeJira({
      key: "MTV-999",
      summary: "[some-repo#123] Some feature",
      nested_prs: [],
    });
    expect(filterGithubSyncedTickets([ticket], configWithFilter)).toHaveLength(
      1,
    );
  });

  it("is a no-op when no product has the flag set", () => {
    const configNoFilter = {
      products: [
        { key: "MTA", name: "MTA", jira_prefixes: ["MTA"], repos: [] },
      ],
    } as Parameters<typeof filterGithubSyncedTickets>[1];
    const ticket = makeJira({
      key: "MTA-1234",
      summary: "[tackle2-ui#2840] Some feature",
      nested_prs: [],
    });
    expect(filterGithubSyncedTickets([ticket], configNoFilter)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractTicketIds
// ---------------------------------------------------------------------------

describe("extractTicketIds", () => {
  it("extracts ticket IDs from PR title", () => {
    const re = /((PROJ|TEAM|BUGS|NETUI)-\d+)/g;
    expect(extractTicketIds("PROJ-123: fix bug", re)).toEqual(["PROJ-123"]);
  });

  it("extracts multiple IDs", () => {
    const re = /((PROJ|TEAM|BUGS|NETUI)-\d+)/g;
    expect(extractTicketIds("BUGS-81616, BUGS-79458: CVE fix", re)).toEqual([
      "BUGS-81616",
      "BUGS-79458",
    ]);
  });

  it("returns empty for no match", () => {
    const re = /((PROJ|TEAM)-\d+)/g;
    expect(extractTicketIds("just a PR title", re)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nestPrsUnderTickets
// ---------------------------------------------------------------------------

describe("nestPrsUnderTickets", () => {
  it("nests PR under ticket by title match", () => {
    const re = /((PROJ|TEAM)-\d+)/g;
    const pr = makePR({ title: "PROJ-100: fix bug" });
    const ticket = makeJira({ key: "PROJ-100", nested_prs: [] });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("nests PR via issue_refs", () => {
    const re = /((PROJ|TEAM)-\d+)/g;
    const pr = makePR({ title: "Fix something", issue_refs: ["PROJ-200"] });
    const ticket = makeJira({ key: "PROJ-200", nested_prs: [] });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("nests PR via github ref index", () => {
    const re = /((TEAM)-\d+)/g;
    const pr = makePR({
      title: "Use shared component",
      repo: "org/example-ui",
      issue_refs: ["3212"],
      engineer: "Test Engineer",
    });
    const ticket = makeJira({
      key: "TEAM-6873",
      summary: "[example-ui#3212] Replace duplicated implementations",
      engineer: "Test Engineer",
      nested_prs: [],
    });
    const { tickets, orphanPrs } = nestPrsUnderTickets([pr], [ticket], re);
    expect(tickets[0].nested_prs).toHaveLength(1);
    expect(orphanPrs).toHaveLength(0);
  });

  it("orphans PR when no match found", () => {
    const re = /((PROJ)-\d+)/g;
    const pr = makePR({ title: "Unrelated change" });
    const ticket = makeJira({ key: "PROJ-999", nested_prs: [] });
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
    expect(
      determineProduct(
        ticket,
        config!,
        repoToProduct,
        prefixToProduct,
        ocpbugsRe,
        ticketIdRe,
      ),
    ).toBe("CNV");
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
    expect(
      determineProduct(
        ticket,
        config!,
        repoToProduct,
        prefixToProduct,
        ocpbugsRe,
        ticketIdRe,
      ),
    ).toBe("Networking Console Plugins");
  });

  it.skipIf(!config)("maps PR by repo", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const pr = makePR({ repo: "kubev2v/forklift-console-plugin" });
    expect(
      determineProduct(
        pr,
        config!,
        repoToProduct,
        prefixToProduct,
        ocpbugsRe,
        ticketIdRe,
      ),
    ).toBe("MTV");
  });

  it.skipIf(!config)("returns Other for unknown items", () => {
    const repoToProduct = buildRepoToProduct(config!);
    const prefixToProduct = buildPrefixToProduct(config!);
    const ocpbugsRe = buildOcpbugsSummaryRepoRe(config!);
    const ticketIdRe = buildTicketIdRe(config!);
    const pr = makePR({ repo: "unknown/repo", title: "something" });
    expect(
      determineProduct(
        pr,
        config!,
        repoToProduct,
        prefixToProduct,
        ocpbugsRe,
        ticketIdRe,
      ),
    ).toBe("Other");
  });
});

// ---------------------------------------------------------------------------
// buildOrgToProduct + determineProduct org routing
// ---------------------------------------------------------------------------

describe("buildOrgToProduct", () => {
  it("maps each org to its product key", () => {
    const config = {
      products: [
        {
          key: "MTA",
          name: "MTA",
          jira_prefixes: ["MTA"],
          repos: [],
          github_orgs: ["konveyor"],
        },
        { key: "MTV", name: "MTV", jira_prefixes: ["MTV"], repos: [] },
      ],
    } as Parameters<typeof buildOrgToProduct>[0];
    const map = buildOrgToProduct(config);
    expect(map.get("konveyor")).toBe("MTA");
    expect(map.has("migtools")).toBe(false);
  });

  it("returns empty map when no product has github_orgs", () => {
    const config = {
      products: [
        { key: "MTA", name: "MTA", jira_prefixes: ["MTA"], repos: [] },
      ],
    } as Parameters<typeof buildOrgToProduct>[0];
    expect(buildOrgToProduct(config).size).toBe(0);
  });
});

describe("determineProduct org routing", () => {
  const emptyMap = new Map<string, string>();
  const ocpbugsRe = /nomatch/;
  const ticketIdRe = /nomatch/g;
  const fakeConfig = { products: [], engineers: [] } as unknown as Parameters<
    typeof determineProduct
  >[1];

  it("routes a konveyor-org PR to MTA via orgToProduct", () => {
    const pr = makePR({ repo: "konveyor/tackle2-hub" });
    const orgToProduct = new Map([["konveyor", "MTA"]]);
    expect(
      determineProduct(
        pr,
        fakeConfig,
        emptyMap,
        emptyMap,
        ocpbugsRe,
        ticketIdRe,
        orgToProduct,
      ),
    ).toBe("MTA");
  });

  it("falls through to Other for orgs not in orgToProduct", () => {
    const pr = makePR({ repo: "migtools/mta-tackle2-hub" });
    const orgToProduct = new Map([["konveyor", "MTA"]]);
    expect(
      determineProduct(
        pr,
        fakeConfig,
        emptyMap,
        emptyMap,
        ocpbugsRe,
        ticketIdRe,
        orgToProduct,
      ),
    ).toBe("Other");
  });

  it("repo-level match takes precedence over org-level", () => {
    const pr = makePR({ repo: "konveyor/special-repo" });
    const repoToProduct = new Map([["konveyor/special-repo", "MTV"]]);
    const orgToProduct = new Map([["konveyor", "MTA"]]);
    expect(
      determineProduct(
        pr,
        fakeConfig,
        repoToProduct,
        emptyMap,
        ocpbugsRe,
        ticketIdRe,
        orgToProduct,
      ),
    ).toBe("MTV");
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
    const { consolidate, testTickets, otherTickets } =
      shouldConsolidateTestTasks(tickets);
    expect(consolidate).toBe(true);
    expect(testTickets).toHaveLength(4);
    expect(otherTickets).toHaveLength(0);
  });

  it("does not consolidate when <= 3 test tasks", () => {
    const tickets = [
      makeJira({ summary: "[TIER-1][test] cnv-4.18.35" }),
      makeJira({ summary: "Regular ticket" }),
    ];
    const { consolidate, testTickets, otherTickets } =
      shouldConsolidateTestTasks(tickets);
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
        key: "PROJ-1",
        summary: "[TIER-1] cnv-4.18.35",
        url: "https://test.atlassian.net/browse/PROJ-1",
      }),
      makeJira({
        key: "PROJ-2",
        summary: "[TIER-2] cnv-4.14.18",
        url: "https://test.atlassian.net/browse/PROJ-2",
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
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({
          summary: "CVE-2026-1234 lodash vulnerability",
          issuetype: "Bug",
        }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("TEAM", engineers);

    const highlights = generateHighlights(sections);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]).toContain("CVE");
    expect(highlights[0]).toContain("lodash");
  });

  it("generates test version highlight", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: "[TIER-1][test-kubevirt] cnv-4.18.35" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("PROJ", engineers);

    const highlights = generateHighlights(sections);
    expect(highlights).toContainEqual(expect.stringContaining("4.18.35"));
  });

  it("returns max 4 highlights", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    for (const pk of ["A", "B", "C", "D", "E"]) {
      const engineers = new Map<string, EngineerBlock>();
      engineers.set("User", {
        name: "User",
        completed_tickets: [
          makeJira({ summary: `Feature for ${pk}`, issuetype: "Story" }),
        ],
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
// computeHighlightData
// ---------------------------------------------------------------------------

describe("computeHighlightData", () => {
  it("returns structured CVE data", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({
          summary: "CVE-2026-1234 lodash vulnerability",
          issuetype: "Bug",
        }),
      ],
      completed_prs: [makePR({ title: "Fix CVE-2026-5678 axios issue" })],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("TEAM", engineers);

    const data = computeHighlightData(sections);
    expect(data.cve).not.toBeNull();
    expect(data.cve!.count).toBe(2);
    expect(data.cve!.products).toEqual(["TEAM"]);
    expect(data.cve!.libraries).toContain("lodash");
    expect(data.cve!.libraries).toContain("axios");
  });

  it("returns structured test version data", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: "[TIER-1][test-kubevirt] cnv-4.18.35" }),
        makeJira({ summary: "[TIER-2][test-kubevirt] cnv-4.14.18" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("PROJ", engineers);

    const data = computeHighlightData(sections);
    expect(data.testing).not.toBeNull();
    expect(data.testing!.versions).toEqual(["4.14.18", "4.18.35"]);
  });

  it("returns null for categories with no data", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: "A feature", issuetype: "Story" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("TEAM", engineers);

    const data = computeHighlightData(sections);
    expect(data.cve).toBeNull();
    expect(data.testing).toBeNull();
    expect(data.features.get("TEAM")).toEqual(["A feature"]);
  });

  it("does not truncate feature summaries", () => {
    const sections = new Map<
      string,
      Map<
        string,
        {
          name: string;
          completed_tickets: JiraItem[];
          completed_prs: PRItem[];
          in_progress_tickets: JiraItem[];
          in_progress_prs: PRItem[];
        }
      >
    >();
    const engineers = new Map<string, EngineerBlock>();
    const longSummary =
      "This is a very long feature summary that exceeds sixty characters by quite a large margin";
    engineers.set("User", {
      name: "User",
      completed_tickets: [
        makeJira({ summary: longSummary, issuetype: "Story" }),
      ],
      completed_prs: [],
      in_progress_tickets: [],
      in_progress_prs: [],
    });
    sections.set("TEAM", engineers);

    const data = computeHighlightData(sections);
    const feature = data.features.get("TEAM")![0];
    expect(feature).not.toContain("...");
    expect(feature.length).toBeGreaterThan(60);
  });

  it("collects customer-impacting in-progress tickets", () => {
    const sections = new Map<string, Map<string, EngineerBlock>>();
    const engineers = new Map<string, EngineerBlock>();
    engineers.set("User", {
      name: "User",
      completed_tickets: [],
      completed_prs: [],
      in_progress_tickets: [
        makeJira({
          summary: "React error #31 on network resource Details page",
          status: "ASSIGNED",
          customer_cases: [
            {
              case_id: "CIPOE-100",
              url: "https://test.atlassian.net/browse/CIPOE-100",
              customer_name: "Acme Corp",
            },
            {
              case_id: "CIPOE-200",
              url: "https://test.atlassian.net/browse/CIPOE-200",
              customer_name: "Widget Inc",
            },
          ],
        }),
        makeJira({
          summary: "Bug with no customer",
          status: "In Progress",
        }),
      ],
      in_progress_prs: [],
    });
    sections.set("Networking", engineers);

    const data = computeHighlightData(sections);
    expect(data.customerTickets.has("Networking")).toBe(true);
    const entries = data.customerTickets.get("Networking")!;
    expect(entries).toHaveLength(1);
    expect(entries[0].customers).toContain("Acme Corp");
    expect(entries[0].customers).toContain("Widget Inc");
    expect(entries[0].summary).toContain("react error");
  });
});

describe("formatHighlightContext", () => {
  it("formats all categories", () => {
    const data = {
      cve: {
        count: 5,
        products: ["TEAM", "Console Plugins"],
        libraries: ["lodash", "axios"],
      },
      testing: { versions: ["4.14.18", "4.18.35"] },
      features: new Map([["PROJ", ["feature 1", "feature 2"]]]),
      bugs: new Map([["TEAM", ["bug fix 1"]]]),
      customerTickets: new Map(),
    };
    const output = formatHighlightContext(data);
    expect(output).toContain(
      "CVE: 5 fixes across TEAM, Console Plugins (lodash, axios)",
    );
    expect(output).toContain("Testing: CNV Tier 1/2 for 4.14.18, 4.18.35");
    expect(output).toContain("Features: PROJ (2)");
    expect(output).toContain("Bugs: TEAM (1)");
  });

  it("omits empty categories", () => {
    const data = {
      cve: null,
      testing: null,
      features: new Map<string, string[]>(),
      bugs: new Map<string, string[]>(),
      customerTickets: new Map(),
    };
    const output = formatHighlightContext(data);
    expect(output).toBe("--- Highlight Context ---");
  });

  it("formats per-product context when sections provided", () => {
    const data = {
      cve: null,
      testing: null,
      features: new Map<string, string[]>(),
      bugs: new Map<string, string[]>(),
      customerTickets: new Map(),
    };
    const sections = new Map<string, Map<string, EngineerBlock>>([
      [
        "TEAM",
        new Map([
          [
            "Alice",
            {
              name: "Alice",
              completed_tickets: [
                {
                  engineer: "Alice",
                  key: "TEAM-100",
                  summary: "Add multi-NIC support",
                  status: "Done",
                  resolution: "Done",
                  resolutiondate: "2026-07-01",
                  statuscategorychangedate: "2026-07-01",
                  issuetype: "Story",
                  priority: "Major",
                  url: "https://example.com/TEAM-100",
                  role: "assignee" as const,
                  sprint_name: "Sprint 5",
                  nested_prs: [],
                  customer_cases: [],
                },
              ],
              completed_prs: [],
              in_progress_tickets: [
                {
                  engineer: "Alice",
                  key: "TEAM-101",
                  summary: "Storage access mode selection",
                  status: "In Progress",
                  resolution: "",
                  resolutiondate: "",
                  statuscategorychangedate: "",
                  issuetype: "Story",
                  priority: "Major",
                  url: "https://example.com/TEAM-101",
                  role: "assignee" as const,
                  sprint_name: "Sprint 5",
                  nested_prs: [],
                  customer_cases: [],
                },
              ],
              in_progress_prs: [],
            },
          ],
        ]),
      ],
    ]);
    const output = formatHighlightContext(data, sections);
    expect(output).toContain("### TEAM");
    expect(output).toContain("Completed (1):");
    expect(output).toContain("multi-NIC support");
    expect(output).toContain("In Progress (1):");
    expect(output).toContain("access mode selection");
  });

  it("skips products with no activity when sections provided", () => {
    const data = {
      cve: null,
      testing: null,
      features: new Map<string, string[]>(),
      bugs: new Map<string, string[]>(),
      customerTickets: new Map(),
    };
    const sections = new Map<string, Map<string, EngineerBlock>>([
      [
        "PROJ",
        new Map([
          [
            "Bob",
            {
              name: "Bob",
              completed_tickets: [],
              completed_prs: [],
              in_progress_tickets: [],
              in_progress_prs: [],
            },
          ],
        ]),
      ],
    ]);
    const output = formatHighlightContext(data, sections);
    expect(output).toBe("--- Highlight Context ---");
    expect(output).not.toContain("### PROJ");
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
  const outputDir = resolve(AGENT_ROOT, "data/output");
  const referenceFile = existsSync(outputDir)
    ? readdirSync(outputDir)
        .filter((f) => /^weekly-update-\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .pop()
    : undefined;
  const hasReference = !!referenceFile;
  const refDateStr = referenceFile?.match(/(\d{4}-\d{2}-\d{2})/)?.[1];

  it.skipIf(!config || !hasCache || !hasReference)(
    "generates output identical to reference report",
    () => {
      const ticketIdRe = buildTicketIdRe(config!);
      const githubPrs = loadGithubPrs(CACHE_DIR);
      const gitlabMrs = loadGitlabMrs(CACHE_DIR);
      const jiraTickets = loadJiraTickets(CACHE_DIR, config!);
      const customerCases = loadCustomerCases(CACHE_DIR);
      mergeCustomerCases(jiraTickets, customerCases);
      const allPrs = [...githubPrs, ...gitlabMrs];

      const reportDate = new Date(`${refDateStr!}T00:00:00Z`);
      const windowStart = new Date(
        reportDate.getTime() - 7 * 24 * 60 * 60 * 1000,
      );
      const windowEnd = new Date(
        reportDate.getTime() + 1 * 24 * 60 * 60 * 1000,
      );

      const completedPrs = filterCompletedPrs(allPrs, windowStart, windowEnd);
      const prCutoff = new Date(
        reportDate.getTime() - 30 * 24 * 60 * 60 * 1000,
      );
      const openPrs = filterOpenPrs(allPrs, prCutoff);
      const completedJira = filterCompletedJira(
        jiraTickets,
        windowStart,
        windowEnd,
      );
      const sprintPattern = config!.sprint_name_pattern
        ? new RegExp(config!.sprint_name_pattern)
        : undefined;
      const ipJira = filterInProgressJira(jiraTickets, sprintPattern);

      const { tickets: completedTickets, orphanPrs: completedOrphanPrs } =
        nestPrsUnderTickets(completedPrs, completedJira, ticketIdRe);
      const { tickets: ipTickets, orphanPrs: ipOrphanPrs } = nestInProgress(
        openPrs,
        ipJira,
        ticketIdRe,
      );

      const visibleCompletedTickets = filterGithubSyncedTickets(
        completedTickets,
        config!,
      );

      const sections = organize(
        visibleCompletedTickets,
        completedOrphanPrs,
        ipTickets,
        ipOrphanPrs,
        config!,
        ticketIdRe,
      );

      const { warnings } = validateData(
        githubPrs,
        gitlabMrs,
        jiraTickets,
        config!,
      );

      const reportLines: string[] = [
        `# ${config!.report_title}`,
        fmtReportDate(reportDate),
        "",
        "## Summary",
        "<!-- SUMMARY_PLACEHOLDER -->",
        "- (summary pending)",
      ];
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
      const expected = readFileSync(
        resolve(outputDir, referenceFile!),
        "utf-8",
      );

      const stripHighlights = (s: string) =>
        s.replace(/## Summary\n[\s\S]*?\n(?=\n## )/, "## Summary\n");
      expect(stripHighlights(reportText)).toBe(stripHighlights(expected));
    },
  );
});
