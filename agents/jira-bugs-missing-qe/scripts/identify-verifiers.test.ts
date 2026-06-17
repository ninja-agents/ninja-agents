import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findVerifierFromComments,
  findVerifierFromChangelog,
  findVerifierFromClosedAfterQA,
  hasNegation,
} from "./identify-verifiers.js";

const keywords = ["verified", "tested"];
const negationWords = ["not", "hasn't", "cannot", "don't", "didn't"];
const negationWindow = 5;
const statuses = ["Verified"];
const validFrom = ["MODIFIED", "ON_QA", "ASSIGNED"];
const botIds = ["bot-001", "bot-002"];

function makeTicket(
  overrides: Partial<{
    key: string;
    comments: Array<{
      author: string;
      authorAccountId: string;
      body: string;
      created: string;
    }>;
    changelog: Array<{
      author: string;
      authorAccountId: string;
      field: string;
      fromString: string;
      toString: string;
      created: string;
    }>;
  }> = {},
) {
  return {
    key: overrides.key ?? "TEST-1",
    summary: "Test bug",
    comments: overrides.comments ?? [],
    changelog: overrides.changelog ?? [],
  };
}

describe("identify-verifiers", () => {
  describe("config loading", () => {
    it("loads a valid config file", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      expect(config).toHaveProperty("jira");
      expect(config).toHaveProperty("detection");
    });
  });

  describe("findVerifierFromComments", () => {
    it("matches a comment containing 'verified'", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Jane QE",
            authorAccountId: "jane-1",
            body: "I verified the fix on staging.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromComments(
        ticket,
        keywords,
        negationWords,
        negationWindow,
        botIds,
      );
      expect(result).not.toBeNull();
      expect(result?.qa_contact_name).toBe("Jane QE");
      expect(result?.source).toBe("comment");
      expect(result?.confidence).toBe(0.8);
    });

    it("matches 'tested' with lower confidence", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            body: "I tested this manually.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromComments(
        ticket,
        keywords,
        negationWords,
        negationWindow,
        botIds,
      );
      expect(result?.confidence).toBe(0.7);
    });

    it("returns null when no keyword matches", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            body: "Fixed the issue in PR #42.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromComments(
          ticket,
          keywords,
          negationWords,
          negationWindow,
          botIds,
        ),
      ).toBeNull();
    });

    it("filters out bot comments", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Automation Bot",
            authorAccountId: "bot-001",
            body: "Verified automatically.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromComments(
          ticket,
          keywords,
          negationWords,
          negationWindow,
          botIds,
        ),
      ).toBeNull();
    });

    it("skips negated keywords", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            body: "This has not been verified yet.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromComments(
          ticket,
          keywords,
          negationWords,
          negationWindow,
          botIds,
        ),
      ).toBeNull();
    });

    it("returns the LAST matching comment (most recent)", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Early QE",
            authorAccountId: "qe-1",
            body: "Verified on staging.",
            created: "2026-01-01T00:00:00Z",
          },
          {
            author: "Late QE",
            authorAccountId: "qe-2",
            body: "Verified on production.",
            created: "2026-02-01T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromComments(
        ticket,
        keywords,
        negationWords,
        negationWindow,
        botIds,
      );
      expect(result?.qa_contact_name).toBe("Late QE");
    });

    it("does not match 'unverified' (word boundary)", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            body: "This is still unverified.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromComments(
          ticket,
          keywords,
          negationWords,
          negationWindow,
          botIds,
        ),
      ).toBeNull();
    });

    it("does not match 'verification' (word boundary)", () => {
      const ticket = makeTicket({
        comments: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            body: "Awaiting verification from QE.",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromComments(
          ticket,
          keywords,
          negationWords,
          negationWindow,
          botIds,
        ),
      ).toBeNull();
    });
  });

  describe("findVerifierFromChangelog", () => {
    it("matches a transition to Verified", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "QE Person",
            authorAccountId: "qe-1",
            field: "status",
            fromString: "MODIFIED",
            toString: "Verified",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromChangelog(
        ticket,
        statuses,
        validFrom,
        botIds,
      );
      expect(result).not.toBeNull();
      expect(result?.qa_contact_name).toBe("QE Person");
      expect(result?.source).toBe("transition");
      expect(result?.confidence).toBe(0.95);
    });

    it("ignores non-status changelog entries", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            field: "priority",
            fromString: "Medium",
            toString: "High",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromChangelog(ticket, statuses, validFrom, botIds),
      ).toBeNull();
    });

    it("rejects transitions from invalid source statuses", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "Bot",
            authorAccountId: "human-1",
            field: "status",
            fromString: "Closed",
            toString: "Verified",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromChangelog(ticket, statuses, validFrom, botIds),
      ).toBeNull();
    });

    it("filters out bot transitions", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "CI Bot",
            authorAccountId: "bot-001",
            field: "status",
            fromString: "MODIFIED",
            toString: "Verified",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(
        findVerifierFromChangelog(ticket, statuses, validFrom, botIds),
      ).toBeNull();
    });

    it("returns the LAST matching transition", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "QE Early",
            authorAccountId: "qe-1",
            field: "status",
            fromString: "MODIFIED",
            toString: "Verified",
            created: "2026-01-01T00:00:00Z",
          },
          {
            author: "QE Late",
            authorAccountId: "qe-2",
            field: "status",
            fromString: "ON_QA",
            toString: "Verified",
            created: "2026-02-01T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromChangelog(
        ticket,
        statuses,
        validFrom,
        botIds,
      );
      expect(result?.qa_contact_name).toBe("QE Late");
    });
  });

  describe("hasNegation", () => {
    it("detects 'not' before keyword", () => {
      const text = "This has not been verified yet.";
      const pos = text.indexOf("verified");
      expect(hasNegation(text, pos, negationWords, 5)).toBe(true);
    });

    it("does not flag when no negation present", () => {
      const text = "I verified the fix on staging.";
      const pos = text.indexOf("verified");
      expect(hasNegation(text, pos, negationWords, 5)).toBe(false);
    });

    it("detects negation at sentence boundary", () => {
      const text = "Cannot be verified without access.";
      const pos = text.indexOf("verified");
      expect(hasNegation(text, pos, negationWords, 5)).toBe(true);
    });

    it("ignores negation in a previous sentence", () => {
      const text =
        "That was not the issue. I verified the fix works correctly now.";
      const pos = text.lastIndexOf("verified");
      expect(hasNegation(text, pos, negationWords, 5)).toBe(false);
    });
  });

  describe("findVerifierFromClosedAfterQA", () => {
    it("matches when ticket went ON_QA then Closed by a human", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            field: "status",
            fromString: "POST",
            toString: "ON_QA",
            created: "2026-01-01T00:00:00Z",
          },
          {
            author: "QE Person",
            authorAccountId: "qe-1",
            field: "status",
            fromString: "ON_QA",
            toString: "Closed",
            created: "2026-01-10T00:00:00Z",
          },
        ],
      });
      const result = findVerifierFromClosedAfterQA(ticket, botIds);
      expect(result).not.toBeNull();
      expect(result?.qa_contact_name).toBe("QE Person");
      expect(result?.confidence).toBe(0.75);
    });

    it("returns null when ticket was never ON_QA", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            field: "status",
            fromString: "New",
            toString: "Closed",
            created: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(findVerifierFromClosedAfterQA(ticket, botIds)).toBeNull();
    });

    it("filters bots who closed after ON_QA", () => {
      const ticket = makeTicket({
        changelog: [
          {
            author: "Dev",
            authorAccountId: "dev-1",
            field: "status",
            fromString: "POST",
            toString: "ON_QA",
            created: "2026-01-01T00:00:00Z",
          },
          {
            author: "Bot",
            authorAccountId: "bot-001",
            field: "status",
            fromString: "ON_QA",
            toString: "Closed",
            created: "2026-01-10T00:00:00Z",
          },
        ],
      });
      expect(findVerifierFromClosedAfterQA(ticket, botIds)).toBeNull();
    });
  });
});
