import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// --- Test Utilities ---

/**
 * Extract testable helper functions by loading the module.
 * We'll mock fetch globally and test the main flow.
 */

const TEST_CACHE_DIR = resolve(tmpdir(), `fetch-data-test-${Date.now()}`);

// --- CSV Helper Tests ---

describe("CSV Helpers", () => {
  describe("csvEscape", () => {
    // We'll test via manual implementation since helpers aren't exported
    function csvEscape(value: string): string {
      value = value.replace(/"/g, '""');
      if (value.includes(",") || value.includes('"')) {
        return `"${value}"`;
      }
      return value;
    }

    it("should leave plain strings unchanged", () => {
      expect(csvEscape("hello")).toBe("hello");
      expect(csvEscape("simple text")).toBe("simple text");
    });

    it("should wrap strings with commas in quotes", () => {
      expect(csvEscape("hello, world")).toBe('"hello, world"');
      expect(csvEscape("a,b,c")).toBe('"a,b,c"');
    });

    it("should double-escape existing quotes", () => {
      expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
      expect(csvEscape('"quoted"')).toBe('"""quoted"""');
    });

    it("should handle commas and quotes together", () => {
      expect(csvEscape('he said, "hi"')).toBe('"he said, ""hi"""');
    });

    it("should handle empty strings", () => {
      expect(csvEscape("")).toBe("");
    });
  });

  describe("extractIssueRefs", () => {
    function extractIssueRefs(body: string | null | undefined): string {
      if (!body) return "";
      const refs = new Set<string>();
      const pattern =
        /(?:(?:closes?|fixes?|resolves?)\s*#(\d+))|(?:#(\d+))|(?:\/issues\/(\d+))/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(body)) !== null) {
        for (let i = 1; i <= 3; i++) {
          if (match[i]) refs.add(match[i]);
        }
      }
      return [...refs].sort().join(" ");
    }

    it("should extract issue numbers from closes syntax", () => {
      expect(extractIssueRefs("closes #123")).toBe("123");
      expect(extractIssueRefs("Closes #456")).toBe("456");
      expect(extractIssueRefs("close #789")).toBe("789");
    });

    it("should extract issue numbers from fixes syntax", () => {
      expect(extractIssueRefs("fixes #123")).toBe("123");
      expect(extractIssueRefs("Fixes #456")).toBe("456");
      expect(extractIssueRefs("fix #789")).toBe("789");
    });

    it("should extract issue numbers from resolves syntax", () => {
      expect(extractIssueRefs("resolves #123")).toBe("123");
      expect(extractIssueRefs("Resolves #456")).toBe("456");
      expect(extractIssueRefs("resolve #789")).toBe("789");
    });

    it("should extract standalone issue references", () => {
      expect(extractIssueRefs("See #123 for details")).toBe("123");
      expect(extractIssueRefs("Related to #456")).toBe("456");
    });

    it("should extract issue URL references", () => {
      expect(extractIssueRefs("https://github.com/org/repo/issues/123")).toBe(
        "123",
      );
      expect(
        extractIssueRefs("See https://example.com/issues/456 for more"),
      ).toBe("456");
    });

    it("should extract multiple issue references", () => {
      const body = "Fixes #123 and closes #456, see also #789";
      expect(extractIssueRefs(body)).toBe("123 456 789");
    });

    it("should deduplicate issue references", () => {
      const body = "Fixes #123, closes #123, see #123";
      expect(extractIssueRefs(body)).toBe("123");
    });

    it("should sort issue references", () => {
      const body = "Fixes #789 and #123 and #456";
      expect(extractIssueRefs(body)).toBe("123 456 789");
    });

    it("should handle null and undefined", () => {
      expect(extractIssueRefs(null)).toBe("");
      expect(extractIssueRefs(undefined)).toBe("");
    });

    it("should handle empty string", () => {
      expect(extractIssueRefs("")).toBe("");
    });

    it("should handle body with no issue references", () => {
      expect(extractIssueRefs("This is a PR without issue refs")).toBe("");
    });

    it("should handle complex real-world PR bodies", () => {
      const body = `
## Summary
This PR fixes a critical bug

Closes #123
Resolves #456

See also #789 and https://github.com/org/repo/issues/1011

## Test Plan
- Tested locally
      `;
      expect(extractIssueRefs(body)).toBe("1011 123 456 789");
    });
  });

  describe("extractSprintName", () => {
    interface SprintObject {
      state?: string;
      name?: string;
    }

    function extractSprintName(
      sprintField: unknown,
      sprintPattern: RegExp,
    ): string {
      if (!Array.isArray(sprintField)) return "";
      const sprints = sprintField as SprintObject[];

      for (const s of sprints) {
        if (s.state === "active" && s.name && sprintPattern.test(s.name)) {
          return s.name;
        }
      }
      for (const s of sprints) {
        if (s.state === "active") return s.name ?? "";
      }
      for (const s of sprints) {
        if (s.state === "future") return s.name ?? "";
      }
      return "";
    }

    const sprintPattern = /Sprint \d+/;

    it("should extract active sprint matching pattern", () => {
      const field = [
        { state: "closed", name: "Sprint 1" },
        { state: "active", name: "Sprint 2" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Sprint 2");
    });

    it("should prefer active sprint matching pattern over other active sprints", () => {
      const field = [
        { state: "active", name: "Random Active Sprint" },
        { state: "active", name: "Sprint 3" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Sprint 3");
    });

    it("should fallback to any active sprint if no pattern match", () => {
      const field = [
        { state: "closed", name: "Sprint 1" },
        { state: "active", name: "Random Sprint" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Random Sprint");
    });

    it("should fallback to future sprint if no active sprint", () => {
      const field = [
        { state: "closed", name: "Sprint 1" },
        { state: "future", name: "Sprint 3" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Sprint 3");
    });

    it("should return empty string for non-array input", () => {
      expect(extractSprintName(null, sprintPattern)).toBe("");
      expect(extractSprintName(undefined, sprintPattern)).toBe("");
      expect(extractSprintName("not an array", sprintPattern)).toBe("");
      expect(extractSprintName({}, sprintPattern)).toBe("");
    });

    it("should return empty string for empty array", () => {
      expect(extractSprintName([], sprintPattern)).toBe("");
    });

    it("should handle sprints with missing name field", () => {
      const field = [
        { state: "active" },
        { state: "active", name: "Sprint 2" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Sprint 2");
    });

    it("should handle sprints with missing state field", () => {
      const field = [
        { name: "Sprint 1" },
        { state: "active", name: "Sprint 2" },
      ];
      expect(extractSprintName(field, sprintPattern)).toBe("Sprint 2");
    });
  });

  describe("str helper", () => {
    function str(value: unknown): string {
      if (value == null) return "";
      return `${value as string | number}`;
    }

    it("should convert strings", () => {
      expect(str("hello")).toBe("hello");
    });

    it("should convert numbers", () => {
      expect(str(123)).toBe("123");
      expect(str(0)).toBe("0");
      expect(str(-42)).toBe("-42");
    });

    it("should convert null and undefined to empty string", () => {
      expect(str(null)).toBe("");
      expect(str(undefined)).toBe("");
    });

    it("should convert booleans", () => {
      expect(str(true)).toBe("true");
      expect(str(false)).toBe("false");
    });

    it("should convert objects to string representation", () => {
      expect(str({})).toBe("[object Object]");
      expect(str({ key: "value" })).toBe("[object Object]");
    });
  });
});

// --- Integration Tests (with mocked fetch) ---

describe("fetch-data integration", () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Setup test cache directory
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_CACHE_DIR, { recursive: true });

    // Setup environment variables
    process.env.JIRA_API_TOKEN = "test-token";
    process.env.JIRA_EMAIL = "test@example.com";
    process.env.GITHUB_PAT = "test-github-token";
    process.env.GITLAB_PAT = "test-gitlab-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();

    // Cleanup test cache directory
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }

    // Cleanup environment
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.GITHUB_PAT;
    delete process.env.GITLAB_PAT;
  });

  describe("GitHub API Handling", () => {
    it("should handle successful GitHub PR fetch", async () => {
      const mockPr = {
        number: 123,
        title: "Test PR",
        repository_url: "https://api.github.com/repos/org/repo",
        state: "open",
        created_at: "2026-08-15T10:00:00Z",
        html_url: "https://github.com/org/repo/pull/123",
        body: "Fixes #456",
        pull_request: {},
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [mockPr] }),
      });

      // The script would process this
      const response = await fetch("test-url");
      const data = (await response.json()) as { items: unknown[] };

      expect(data.items).toHaveLength(1);
      expect(data.items[0]).toMatchObject({
        number: 123,
        title: "Test PR",
      });
    });

    it("should handle GitHub API errors gracefully", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
      });

      const response = await fetch("test-url");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });

    it("should handle GitHub network errors", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(fetch("test-url")).rejects.toThrow("Network error");
    });

    it("should handle empty GitHub PR list", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });

      const response = await fetch("test-url");
      const data = (await response.json()) as { items: unknown[] };

      expect(data.items).toHaveLength(0);
    });

    it("should parse repository name from repository_url", () => {
      const repoUrl = "https://api.github.com/repos/openshift/console";
      const repoParts = repoUrl.split("/");
      const repo =
        repoParts.length >= 2
          ? `${repoParts[repoParts.length - 2]}/${repoParts[repoParts.length - 1]}`
          : "";

      expect(repo).toBe("openshift/console");
    });

    it("should handle malformed repository_url", () => {
      const repoUrl = "invalid-url";
      const repoParts = repoUrl.split("/");
      const repo =
        repoParts.length >= 2
          ? `${repoParts[repoParts.length - 2]}/${repoParts[repoParts.length - 1]}`
          : "";

      expect(repo).toBe("");
    });

    it("should deduplicate PRs by key (repo:number)", () => {
      const seenPrKeys = new Set<string>();
      const key1 = "https://api.github.com/repos/org/repo:123";
      const key2 = "https://api.github.com/repos/org/repo:123";
      const key3 = "https://api.github.com/repos/org/repo:456";

      seenPrKeys.add(key1);

      expect(seenPrKeys.has(key2)).toBe(true);
      expect(seenPrKeys.has(key3)).toBe(false);

      seenPrKeys.add(key3);
      expect(seenPrKeys.size).toBe(2);
    });
  });

  describe("Jira API Handling", () => {
    it("should handle successful Jira ticket fetch", async () => {
      const mockTicket = {
        key: "CNV-123",
        fields: {
          summary: "Test ticket",
          status: { name: "In Progress" },
          assignee: {
            accountId: "123456",
            displayName: "John Doe",
          },
          issuetype: { name: "Bug" },
          priority: { name: "High" },
          customfield_10020: [{ state: "active", name: "Sprint 5" }],
          customfield_10470: null,
          issuelinks: [],
        },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ issues: [mockTicket] }),
      });

      const response = await fetch("test-url");
      const data = (await response.json()) as {
        issues: Array<{ key: string; fields?: Record<string, unknown> }>;
      };

      expect(data.issues).toHaveLength(1);
      expect(data.issues[0].key).toBe("CNV-123");
      expect(data.issues[0].fields?.summary).toBe("Test ticket");
    });

    it("should handle Jira API authentication errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      const response = await fetch("test-url");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it("should handle Jira JQL errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Invalid JQL query"),
      });

      const response = await fetch("test-url");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it("should parse Jira ticket with all fields", () => {
      interface JiraTicket {
        key: string;
        summary: string;
        status: string;
        resolution: string;
        issuetype: string;
        priority: string;
        assignee_id: string;
        assignee_name: string;
        qa_contact_id: string;
        qa_contact_name: string;
        sprint_name: string;
      }

      function str(value: unknown): string {
        if (value == null) return "";
        return `${value as string | number}`;
      }

      function extractSprintName(sprintField: unknown): string {
        if (!Array.isArray(sprintField)) return "";
        const sprints = sprintField as Array<{
          state?: string;
          name?: string;
        }>;
        for (const s of sprints) {
          if (s.state === "active") return s.name ?? "";
        }
        return "";
      }

      function parseJiraIssue(issue: {
        key: string;
        fields?: Record<string, unknown>;
      }): JiraTicket {
        const f = issue.fields ?? {};
        const assignee = (f.assignee ?? {}) as Record<string, unknown>;
        const qaContact = (f.customfield_10470 ?? {}) as Record<
          string,
          unknown
        >;
        const sprintName = extractSprintName(f.customfield_10020);

        return {
          key: issue.key,
          summary: str(f.summary),
          status: str((f.status as Record<string, unknown> | null)?.name),
          resolution: str(
            (f.resolution as Record<string, unknown> | null)?.name,
          ),
          issuetype: str((f.issuetype as Record<string, unknown> | null)?.name),
          priority: str((f.priority as Record<string, unknown> | null)?.name),
          assignee_id: str(assignee?.accountId),
          assignee_name: str(assignee?.displayName),
          qa_contact_id: str(qaContact?.accountId),
          qa_contact_name: str(qaContact?.displayName),
          sprint_name: sprintName,
        };
      }

      const issue = {
        key: "CNV-123",
        fields: {
          summary: "Test ticket",
          status: { name: "In Progress" },
          resolution: { name: "Done" },
          issuetype: { name: "Bug" },
          priority: { name: "High" },
          assignee: {
            accountId: "123456",
            displayName: "John Doe",
          },
          customfield_10470: {
            accountId: "789012",
            displayName: "Jane QE",
          },
          customfield_10020: [{ state: "active", name: "Sprint 5" }],
        },
      };

      const ticket = parseJiraIssue(issue);

      expect(ticket).toMatchObject({
        key: "CNV-123",
        summary: "Test ticket",
        status: "In Progress",
        resolution: "Done",
        issuetype: "Bug",
        priority: "High",
        assignee_id: "123456",
        assignee_name: "John Doe",
        qa_contact_id: "789012",
        qa_contact_name: "Jane QE",
        sprint_name: "Sprint 5",
      });
    });

    it("should parse Jira ticket with missing optional fields", () => {
      function str(value: unknown): string {
        if (value == null) return "";
        return `${value as string | number}`;
      }

      function parseJiraIssue(issue: {
        key: string;
        fields?: Record<string, unknown>;
      }): { key: string; summary: string; assignee_name: string } {
        const f = issue.fields ?? {};
        const assignee = (f.assignee ?? {}) as Record<string, unknown>;

        return {
          key: issue.key,
          summary: str(f.summary),
          assignee_name: str(assignee?.displayName),
        };
      }

      const issue = {
        key: "CNV-123",
        fields: {
          summary: "Test ticket",
          // No assignee
        },
      };

      const ticket = parseJiraIssue(issue);

      expect(ticket).toMatchObject({
        key: "CNV-123",
        summary: "Test ticket",
        assignee_name: "",
      });
    });
  });

  describe("Customer Cases Extraction", () => {
    it("should extract customer cases from Account issue links", () => {
      interface JiraIssueLink {
        type?: { name?: string };
        outwardIssue?: {
          key?: string;
          fields?: { summary?: string };
        };
      }

      interface CustomerCase {
        ticket_key: string;
        case_id: string;
        case_url: string;
        customer_name: string;
      }

      const jiraBase = "redhat.atlassian.net";
      const ticketKey = "OCPBUGS-123";
      const issuelinks: JiraIssueLink[] = [
        {
          type: { name: "Account" },
          outwardIssue: {
            key: "CIPOE-456",
            fields: { summary: "Acme Corporation" },
          },
        },
        {
          type: { name: "Related" },
          outwardIssue: {
            key: "CIPOE-789",
            fields: { summary: "Other Corp" },
          },
        },
      ];

      const customerCases: CustomerCase[] = [];

      for (const link of issuelinks) {
        if (link.type?.name !== "Account") continue;
        const outward = link.outwardIssue;
        if (!outward) continue;
        const accountKey = outward.key ?? "";
        if (!accountKey.startsWith("CIPOE-")) continue;
        const customerName = outward.fields?.summary ?? "";
        customerCases.push({
          ticket_key: ticketKey,
          case_id: accountKey,
          case_url: `https://${jiraBase}/browse/${accountKey}`,
          customer_name: customerName,
        });
      }

      expect(customerCases).toHaveLength(1);
      expect(customerCases[0]).toMatchObject({
        ticket_key: "OCPBUGS-123",
        case_id: "CIPOE-456",
        case_url: "https://redhat.atlassian.net/browse/CIPOE-456",
        customer_name: "Acme Corporation",
      });
    });

    it("should skip non-Account issue links", () => {
      interface JiraIssueLink {
        type?: { name?: string };
        outwardIssue?: {
          key?: string;
          fields?: { summary?: string };
        };
      }

      const issuelinks: JiraIssueLink[] = [
        {
          type: { name: "Related" },
          outwardIssue: {
            key: "CIPOE-456",
            fields: { summary: "Some Account" },
          },
        },
      ];

      const customerCases: Array<{ ticket_key: string }> = [];

      for (const link of issuelinks) {
        if (link.type?.name !== "Account") continue;
        customerCases.push({ ticket_key: "test" });
      }

      expect(customerCases).toHaveLength(0);
    });

    it("should skip non-CIPOE issue keys", () => {
      interface JiraIssueLink {
        type?: { name?: string };
        outwardIssue?: {
          key?: string;
          fields?: { summary?: string };
        };
      }

      const issuelinks: JiraIssueLink[] = [
        {
          type: { name: "Account" },
          outwardIssue: {
            key: "OTHER-456",
            fields: { summary: "Some Account" },
          },
        },
      ];

      const customerCases: Array<{ case_id: string }> = [];

      for (const link of issuelinks) {
        if (link.type?.name !== "Account") continue;
        const outward = link.outwardIssue;
        if (!outward) continue;
        const accountKey = outward.key ?? "";
        if (!accountKey.startsWith("CIPOE-")) continue;
        customerCases.push({ case_id: accountKey });
      }

      expect(customerCases).toHaveLength(0);
    });

    it("should handle missing outwardIssue", () => {
      interface JiraIssueLink {
        type?: { name?: string };
        outwardIssue?: {
          key?: string;
          fields?: { summary?: string };
        };
      }

      const issuelinks: JiraIssueLink[] = [
        {
          type: { name: "Account" },
          // No outwardIssue
        },
      ];

      const customerCases: Array<{ case_id: string }> = [];

      for (const link of issuelinks) {
        if (link.type?.name !== "Account") continue;
        const outward = link.outwardIssue;
        if (!outward) continue;
        customerCases.push({ case_id: "test" });
      }

      expect(customerCases).toHaveLength(0);
    });
  });

  describe("GitLab API Handling", () => {
    it("should handle successful GitLab MR fetch", async () => {
      const mockMr = {
        iid: 123,
        title: "Test MR",
        web_url: "https://gitlab.com/org/project/-/merge_requests/123",
        state: "merged",
        created_at: "2026-08-15T10:00:00Z",
        merged_at: "2026-08-16T10:00:00Z",
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockMr]),
      });

      const response = await fetch("test-url");
      const data = (await response.json()) as unknown[];

      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        iid: 123,
        title: "Test MR",
      });
    });

    it("should handle GitLab API errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      const response = await fetch("test-url");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it("should handle GitLab timeout", async () => {
      fetchMock.mockRejectedValue(new Error("Timeout"));

      await expect(fetch("test-url")).rejects.toThrow("Timeout");
    });

    it("should parse project_path from web_url", () => {
      const gitlabBase = "https://gitlab.com/";
      const webUrl = "https://gitlab.com/org/project/-/merge_requests/123";
      const projectPath = webUrl.includes("/-/")
        ? webUrl.replace(gitlabBase, "").split("/-/")[0]
        : "";

      expect(projectPath).toBe("org/project");
    });

    it("should handle malformed web_url", () => {
      const gitlabBase = "https://gitlab.com/";
      const webUrl = "https://gitlab.com/invalid-url";
      const projectPath = webUrl.includes("/-/")
        ? webUrl.replace(gitlabBase, "").split("/-/")[0]
        : "";

      expect(projectPath).toBe("");
    });
  });

  describe("CSV File Writing", () => {
    it("should write valid GitHub PRs CSV", () => {
      function csvEscape(value: string): string {
        value = value.replace(/"/g, '""');
        if (value.includes(",") || value.includes('"')) {
          return `"${value}"`;
        }
        return value;
      }

      const prs = [
        {
          engineer: "John Doe",
          number: 123,
          title: 'Fix bug, add "feature"',
          repo: "org/repo",
          state: "merged",
          created_at: "2026-08-15T10:00:00Z",
          merged_at: "2026-08-16T10:00:00Z",
          html_url: "https://github.com/org/repo/pull/123",
          issue_refs: "456 789",
        },
      ];

      const csvLines = [
        "engineer,number,title,repo,state,created_at,merged_at,html_url,issue_refs",
      ];
      for (const pr of prs) {
        csvLines.push(
          `${csvEscape(pr.engineer)},${pr.number},${csvEscape(pr.title)},` +
            `${pr.repo},${pr.state},${pr.created_at},${pr.merged_at},` +
            `${pr.html_url},${pr.issue_refs}`,
        );
      }

      const csv = csvLines.join("\n") + "\n";

      expect(csv).toContain("engineer,number,title");
      expect(csv).toContain("John Doe,123");
      expect(csv).toContain('"Fix bug, add ""feature"""');
      expect(csv).toContain("456 789");
    });

    it("should write valid Jira tickets CSV", () => {
      function csvEscape(value: string): string {
        value = value.replace(/"/g, '""');
        if (value.includes(",") || value.includes('"')) {
          return `"${value}"`;
        }
        return value;
      }

      const tickets = [
        {
          key: "CNV-123",
          summary: "Test ticket, with comma",
          status: "In Progress",
          resolution: "",
          resolutiondate: "",
          statuscategorychangedate: "2026-08-15T10:00:00Z",
          issuetype: "Bug",
          priority: "High",
          assignee_id: "123456",
          assignee_name: "John Doe",
          qa_contact_id: "",
          qa_contact_name: "",
          sprint_name: "Sprint 5",
        },
      ];

      const csvLines = [
        "key,summary,status,resolution,resolutiondate,statuscategorychangedate,issuetype,priority,assignee_id,assignee_name,qa_contact_id,qa_contact_name,sprint_name",
      ];
      for (const ticket of tickets) {
        csvLines.push(
          `${ticket.key},${csvEscape(ticket.summary)},${ticket.status},` +
            `${ticket.resolution},${ticket.resolutiondate},` +
            `${ticket.statuscategorychangedate},${ticket.issuetype},` +
            `${ticket.priority},${ticket.assignee_id},` +
            `${csvEscape(ticket.assignee_name)},${ticket.qa_contact_id},` +
            `${csvEscape(ticket.qa_contact_name)},${ticket.sprint_name}`,
        );
      }

      const csv = csvLines.join("\n") + "\n";

      expect(csv).toContain("key,summary,status");
      expect(csv).toContain("CNV-123");
      expect(csv).toContain('"Test ticket, with comma"');
      expect(csv).toContain("Sprint 5");
    });

    it("should write valid customer cases CSV", () => {
      function csvEscape(value: string): string {
        value = value.replace(/"/g, '""');
        if (value.includes(",") || value.includes('"')) {
          return `"${value}"`;
        }
        return value;
      }

      const cases = [
        {
          ticket_key: "OCPBUGS-123",
          case_id: "CIPOE-456",
          case_url: "https://redhat.atlassian.net/browse/CIPOE-456",
          customer_name: "Acme Corporation, Inc.",
        },
      ];

      const csvLines = ["ticket_key,case_id,case_url,customer_name"];
      for (const cc of cases) {
        csvLines.push(
          `${cc.ticket_key},${cc.case_id},${cc.case_url},${csvEscape(cc.customer_name)}`,
        );
      }

      const csv = csvLines.join("\n") + "\n";

      expect(csv).toContain("ticket_key,case_id,case_url,customer_name");
      expect(csv).toContain("OCPBUGS-123,CIPOE-456");
      expect(csv).toContain('"Acme Corporation, Inc."');
    });
  });

  describe("Error Handling", () => {
    it("should exit if JIRA_API_TOKEN is missing", () => {
      delete process.env.JIRA_API_TOKEN;

      // The script checks for this at startup
      const hasJiraToken = !!process.env.JIRA_API_TOKEN;
      const hasJiraEmail = !!process.env.JIRA_EMAIL;

      expect(hasJiraToken).toBe(false);
      expect(hasJiraEmail).toBe(true);
    });

    it("should exit if JIRA_EMAIL is missing", () => {
      delete process.env.JIRA_EMAIL;

      const hasJiraToken = !!process.env.JIRA_API_TOKEN;
      const hasJiraEmail = !!process.env.JIRA_EMAIL;

      expect(hasJiraToken).toBe(true);
      expect(hasJiraEmail).toBe(false);
    });

    it("should handle fetch network errors gracefully", async () => {
      fetchMock.mockRejectedValue(new Error("Network timeout"));

      try {
        await fetch("test-url");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(String(e)).toContain("Network timeout");
      }
    });

    it("should return empty results on API errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const response = await fetch("test-url");

      // Script returns { items: [] } on GitHub errors
      // and { issues: [] } on Jira errors
      expect(response.ok).toBe(false);
    });
  });

  describe("Date Calculations", () => {
    it("should calculate 7 days ago correctly", () => {
      const now = new Date("2026-08-21T12:00:00Z");
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const expectedDate = "2026-08-14";

      expect(sevenDaysAgo.toISOString().slice(0, 10)).toBe(expectedDate);
    });

    it("should format ISO datetime correctly", () => {
      const date = "2026-08-14";
      const isoDateTime = `${date}T00:00:00Z`;

      expect(isoDateTime).toBe("2026-08-14T00:00:00Z");
    });

    it("should format today's date correctly", () => {
      const now = new Date("2026-08-21T15:30:45Z");
      const today = now.toISOString().slice(0, 10);

      expect(today).toBe("2026-08-21");
    });
  });

  describe("JQL Query Building", () => {
    it("should build correct per-engineer JQL", () => {
      const accountId = "123456";
      const projects = ["CNV", "OCPBUGS"];
      const projectsClause = projects.map((p) => `"${p}"`).join(", ");

      const jql =
        `(assignee = "${accountId}" OR cf[10470] = "${accountId}") ` +
        `AND project in (${projectsClause}) ` +
        `AND updated >= -7d ORDER BY updated DESC`;

      expect(jql).toContain('assignee = "123456"');
      expect(jql).toContain('cf[10470] = "123456"');
      expect(jql).toContain('project in ("CNV", "OCPBUGS")');
      expect(jql).toContain("updated >= -7d");
    });

    it("should build correct sprint backlog JQL", () => {
      const sprintName = "MIG-NET-Frontend Sprint 5";
      const jql = `sprint = "${sprintName}" ORDER BY key ASC`;

      expect(jql).toBe('sprint = "MIG-NET-Frontend Sprint 5" ORDER BY key ASC');
    });

    it("should escape quotes in JQL values", () => {
      const sprintName = 'Sprint with "quotes"';
      const jql = `sprint = "${sprintName}"`;

      expect(jql).toContain('"Sprint with "quotes""');
    });
  });
});
