import { describe, it, expect } from "vitest";
import {
  buildQuery,
  parseResponse,
  issueKey,
  type IssueRef,
} from "./resolve-github-issues.js";

const ref = (owner: string, repo: string, number: number): IssueRef => ({
  owner,
  repo,
  number,
});

describe("issueKey", () => {
  it("formats as owner/repo#number", () => {
    expect(issueKey(ref("konveyor", "tackle2-ui", 42))).toBe(
      "konveyor/tackle2-ui#42",
    );
  });
});

describe("buildQuery", () => {
  it("contains a search alias per issue", () => {
    const issues = [
      ref("konveyor", "tackle2-ui", 100),
      ref("konveyor", "tackle2-ui", 101),
    ];
    const q = buildQuery(issues);
    expect(q).toContain("s0:");
    expect(q).toContain("s1:");
    expect(q).toContain("#100 is:pr is:merged");
    expect(q).toContain("#101 is:pr is:merged");
  });

  it("includes the repo in each search query", () => {
    const issues = [
      ref("konveyor", "tackle2-ui", 1),
      ref("openshift", "networking-console-plugin", 2),
    ];
    const q = buildQuery(issues);
    expect(q).toContain("repo:konveyor/tackle2-ui #1");
    expect(q).toContain("repo:openshift/networking-console-plugin #2");
  });

  it("handles a single issue", () => {
    const q = buildQuery([ref("org", "repo", 99)]);
    expect(q).toContain("s0:");
    expect(q).toContain("repo:org/repo #99 is:pr is:merged");
    expect(q).not.toContain("s1:");
  });

  it("returns a placeholder query for zero issues", () => {
    const q = buildQuery([]);
    expect(q).toContain("__typename");
    expect(q).not.toContain("search");
  });

  it("indexes aliases globally across different repos", () => {
    const issues = [
      ref("org-a", "repo-a", 10),
      ref("org-b", "repo-b", 20),
      ref("org-a", "repo-a", 30),
    ];
    const q = buildQuery(issues);
    expect(q).toContain("s0:");
    expect(q).toContain("s1:");
    expect(q).toContain("s2:");
  });
});

describe("parseResponse", () => {
  const makeNode = (
    url: string,
    merged: boolean,
    baseRefName: string,
    nameWithOwner: string,
  ) => ({
    url,
    merged,
    baseRefName,
    baseRepository: { nameWithOwner },
  });

  it("maps s0 back to the first issue key", () => {
    const issues = [ref("konveyor", "tackle2-ui", 42)];
    const data = {
      s0: {
        nodes: [
          makeNode(
            "https://github.com/konveyor/tackle2-ui/pull/99",
            true,
            "main",
            "konveyor/tackle2-ui",
          ),
        ],
      },
    };
    const result = parseResponse(data, issues);
    expect(result["konveyor/tackle2-ui#42"]).toHaveLength(1);
    expect(result["konveyor/tackle2-ui#42"][0].url).toBe(
      "https://github.com/konveyor/tackle2-ui/pull/99",
    );
    expect(result["konveyor/tackle2-ui#42"][0].baseRef).toBe("main");
    expect(result["konveyor/tackle2-ui#42"][0].repoFullName).toBe(
      "konveyor/tackle2-ui",
    );
  });

  it("filters out unmerged PRs", () => {
    const issues = [ref("konveyor", "tackle2-ui", 1)];
    const data = {
      s0: {
        nodes: [
          makeNode(
            "https://github.com/konveyor/tackle2-ui/pull/5",
            false,
            "main",
            "konveyor/tackle2-ui",
          ),
          makeNode(
            "https://github.com/konveyor/tackle2-ui/pull/6",
            true,
            "main",
            "konveyor/tackle2-ui",
          ),
        ],
      },
    };
    const result = parseResponse(data, issues);
    expect(result["konveyor/tackle2-ui#1"]).toHaveLength(1);
    expect(result["konveyor/tackle2-ui#1"][0].url).toContain("/pull/6");
  });

  it("returns empty array for issue with no results", () => {
    const issues = [ref("konveyor", "tackle2-ui", 7)];
    const data = { s0: { nodes: [] } };
    const result = parseResponse(data, issues);
    expect(result["konveyor/tackle2-ui#7"]).toEqual([]);
  });

  it("returns empty array when bucket is missing from response", () => {
    const issues = [ref("ghost", "repo", 1)];
    const data = {};
    const result = parseResponse(data, issues);
    expect(result["ghost/repo#1"]).toEqual([]);
  });

  it("maps multiple issues across different repos by index", () => {
    const issues = [
      ref("org-a", "repo-a", 10),
      ref("org-b", "repo-b", 20),
      ref("org-a", "repo-a", 30),
    ];
    const data = {
      s0: {
        nodes: [
          makeNode(
            "https://github.com/org-a/repo-a/pull/100",
            true,
            "main",
            "org-a/repo-a",
          ),
        ],
      },
      s1: { nodes: [] },
      s2: {
        nodes: [
          makeNode(
            "https://github.com/org-a/repo-a/pull/300",
            true,
            "release-1.x",
            "org-a/repo-a",
          ),
        ],
      },
    };
    const result = parseResponse(data, issues);
    expect(result["org-a/repo-a#10"]).toHaveLength(1);
    expect(result["org-b/repo-b#20"]).toEqual([]);
    expect(result["org-a/repo-a#30"]).toHaveLength(1);
    expect(result["org-a/repo-a#30"][0].baseRef).toBe("release-1.x");
  });

  it("returns multiple PRs per issue when search finds multiple", () => {
    const issues = [ref("org", "repo", 5)];
    const data = {
      s0: {
        nodes: [
          makeNode(
            "https://github.com/org/repo/pull/10",
            true,
            "main",
            "org/repo",
          ),
          makeNode(
            "https://github.com/org/repo/pull/11",
            true,
            "release-4.21",
            "org/repo",
          ),
        ],
      },
    };
    const result = parseResponse(data, issues);
    expect(result["org/repo#5"]).toHaveLength(2);
    expect(result["org/repo#5"][1].baseRef).toBe("release-4.21");
  });
});
