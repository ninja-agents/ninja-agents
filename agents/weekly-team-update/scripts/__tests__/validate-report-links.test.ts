import { describe, it, expect } from "vitest";
import {
  parseLinks,
  classifyLinks,
  verifyGithubPrSync,
  verifyGitlabMrSync,
  verifyJira,
  type LinkInfo,
} from "../validate-report-links.js";

function makeLink(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return {
    line_num: 1,
    link_text: "Test link",
    url: "https://example.com",
    engineer: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseLinks
// ---------------------------------------------------------------------------

describe("parseLinks", () => {
  it("extracts markdown links with line numbers", () => {
    const content = `Line one\n[PR #1 - Fix](https://github.com/org/repo/pull/1) stuff\nLine three`;
    const links = parseLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0].line_num).toBe(2);
    expect(links[0].link_text).toBe("PR #1 - Fix");
    expect(links[0].url).toBe("https://github.com/org/repo/pull/1");
  });

  it("detects engineer from **Name:** pattern", () => {
    const content = `**John Smith:**\n- [PR #1 - Fix](https://github.com/org/repo/pull/1)`;
    const links = parseLinks(content);
    expect(links[0].engineer).toBe("John Smith");
  });

  it("tracks engineer changes across sections", () => {
    const content = [
      "**Alice Brown:**",
      "- [Link A](https://a.com)",
      "**Bob Clark:**",
      "- [Link B](https://b.com)",
    ].join("\n");
    const links = parseLinks(content);
    expect(links[0].engineer).toBe("Alice Brown");
    expect(links[1].engineer).toBe("Bob Clark");
  });

  it("extracts multiple links per line", () => {
    const content = `[A](https://a.com) and [B](https://b.com)`;
    const links = parseLinks(content);
    expect(links).toHaveLength(2);
  });

  it("returns empty for content with no links", () => {
    expect(parseLinks("Just plain text")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyLinks
// ---------------------------------------------------------------------------

describe("classifyLinks", () => {
  it("classifies GitHub PR links", () => {
    const links = [makeLink({ url: "https://github.com/org/repo/pull/123" })];
    const classified = classifyLinks(links);
    expect(classified.github_pr).toHaveLength(1);
    expect(classified.gitlab_mr).toHaveLength(0);
    expect(classified.jira).toHaveLength(0);
    expect(classified.other).toHaveLength(0);
  });

  it("classifies GitLab MR links", () => {
    const links = [
      makeLink({ url: "https://gitlab.cee.redhat.com/org/repo/-/merge_requests/42" }),
    ];
    const classified = classifyLinks(links);
    expect(classified.gitlab_mr).toHaveLength(1);
  });

  it("classifies Jira links", () => {
    const links = [makeLink({ url: "https://redhat.atlassian.net/browse/CNV-123" })];
    const classified = classifyLinks(links);
    expect(classified.jira).toHaveLength(1);
  });

  it("classifies unknown URLs as other", () => {
    const links = [makeLink({ url: "https://example.com/page" })];
    const classified = classifyLinks(links);
    expect(classified.other).toHaveLength(1);
  });

  it("classifies mixed links correctly", () => {
    const links = [
      makeLink({ url: "https://github.com/o/r/pull/1" }),
      makeLink({ url: "https://gitlab.cee.redhat.com/p/-/merge_requests/2" }),
      makeLink({ url: "https://redhat.atlassian.net/browse/ABC-3" }),
      makeLink({ url: "https://other.com" }),
    ];
    const classified = classifyLinks(links);
    expect(classified.github_pr).toHaveLength(1);
    expect(classified.gitlab_mr).toHaveLength(1);
    expect(classified.jira).toHaveLength(1);
    expect(classified.other).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// verifyGithubPrSync
// ---------------------------------------------------------------------------

describe("verifyGithubPrSync", () => {
  it("returns ok for valid PR link", () => {
    const link = makeLink({
      link_text: "PR #42 - Fix bug",
      url: "https://github.com/org/repo/pull/42",
    });
    const result = verifyGithubPrSync(link);
    expect(result.status).toBe("ok");
  });

  it("returns error for PR number mismatch", () => {
    const link = makeLink({
      link_text: "PR #99 - Fix bug",
      url: "https://github.com/org/repo/pull/42",
    });
    const result = verifyGithubPrSync(link);
    expect(result.status).toBe("error");
    expect(result.message).toContain("mismatch");
  });

  it("returns error for unparseable URL", () => {
    const link = makeLink({
      link_text: "PR #1",
      url: "https://github.com/org/repo/issues/1",
    });
    const result = verifyGithubPrSync(link);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Could not parse");
  });
});

// ---------------------------------------------------------------------------
// verifyGitlabMrSync
// ---------------------------------------------------------------------------

describe("verifyGitlabMrSync", () => {
  it("returns ok for valid MR link", () => {
    const link = makeLink({
      link_text: "MR !10 - Add feature",
      url: "https://gitlab.cee.redhat.com/cnv-qe/kubevirt-ui/-/merge_requests/10",
    });
    const result = verifyGitlabMrSync(link);
    expect(result.status).toBe("ok");
  });

  it("returns error for MR number mismatch", () => {
    const link = makeLink({
      link_text: "MR !99 - Fix",
      url: "https://gitlab.cee.redhat.com/org/repo/-/merge_requests/10",
    });
    const result = verifyGitlabMrSync(link);
    expect(result.status).toBe("error");
    expect(result.message).toContain("mismatch");
  });

  it("returns error for unparseable URL", () => {
    const link = makeLink({
      link_text: "MR !1",
      url: "https://gitlab.cee.redhat.com/org/repo/issues/1",
    });
    const result = verifyGitlabMrSync(link);
    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// verifyJira
// ---------------------------------------------------------------------------

describe("verifyJira", () => {
  it("returns ok for valid Jira link", () => {
    const link = makeLink({
      link_text: "CNV-123 - Fix thing",
      url: "https://redhat.atlassian.net/browse/CNV-123",
    });
    const result = verifyJira(link);
    expect(result.status).toBe("ok");
    expect(result.message).toBe("CNV-123");
  });

  it("returns error for ticket key mismatch", () => {
    const link = makeLink({
      link_text: "MTV-999 - Wrong ticket",
      url: "https://redhat.atlassian.net/browse/CNV-123",
    });
    const result = verifyJira(link);
    expect(result.status).toBe("error");
    expect(result.message).toContain("mismatch");
  });

  it("returns error for unparseable Jira URL", () => {
    const link = makeLink({
      link_text: "Some link",
      url: "https://redhat.atlassian.net/wiki/123",
    });
    const result = verifyJira(link);
    expect(result.status).toBe("error");
  });
});
