import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adfToText, main } from "./jira-rest.js";

const env: NodeJS.ProcessEnv = {
  JIRA_EMAIL: "fixture@example.invalid",
  JIRA_API_TOKEN: "SYNTHETIC_SECRET_DO_NOT_DISCLOSE",
};
const site = "jira.fixture.invalid";
const roots: string[] = [];
const privateMarker = "PRIVATE_RESPONSE_BODY_DO_NOT_DISCLOSE";
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

type Call = { url: URL; init: RequestInit };
type IssueOutput = {
  key: string;
  fields: {
    description: string;
    comment: {
      comments: {
        body: string;
        author?: { displayName: string; accountId: string };
      }[];
      total?: number;
    };
  };
  changelog: { histories: { items: { toString: string }[] }[]; total?: number };
};
type SearchOutput = { issues: IssueOutput[] };
function fixture(responses: Response[]): {
  fetcher: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    expect(url.origin).toBe(`https://${site}`);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`,
    );
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    calls.push({ url, init: init ?? {} });
    const response = responses.shift();
    if (!response)
      return Promise.reject(
        new Error(`${privateMarker}: unexpected request ${url.href}`),
      );
    return Promise.resolve(response);
  };
  return { fetcher, calls };
}
function bodyString(value: RequestInit["body"]): string {
  expect(value).toBeTypeOf("string");
  if (typeof value !== "string") throw new TypeError("Expected a string body");
  return value;
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function issue(
  key: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: key.split("-")[1],
    key,
    fields: { summary: `Summary ${key}`, ...fields },
  };
}
function adf(...paragraphs: string[]): unknown {
  return {
    version: 1,
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}
async function invoke<T = unknown>(
  args: string[],
  fetcher: typeof fetch,
  credentials = env,
): Promise<{ code: number; stdout: string; stderr: string; value: T }> {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  let code: number;
  try {
    code = await main(args, fetcher, credentials);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  if (code === 0) {
    expect(stderr).toBe("");
    expect(stdout.endsWith("\n")).toBe(true);
    expect(stdout.slice(0, -1)).not.toContain("\n");
  } else {
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^jira-rest [a-z-]+: JIRA_[A-Z_]+(?: \(HTTP \d+\))?\n$/,
    );
    expect(stderr).not.toContain(privateMarker);
    expect(stderr).not.toContain(env.JIRA_EMAIL);
    expect(stderr).not.toContain(env.JIRA_API_TOKEN);
    expect(stderr).not.toContain(
      Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64"),
    );
    expect(stderr).not.toContain(site);
    expect(stderr).not.toContain("https://");
  }
  const value: unknown = stdout ? (JSON.parse(stdout) as unknown) : undefined;
  return {
    code,
    stdout,
    stderr,
    get value(): T {
      if (code !== 0) throw new Error("A failed command has no success JSON");
      // T describes the synthetic successful output asserted by the calling test.
      return value as T;
    },
  };
}
function command(action: string, ...flags: string[]): string[] {
  return [action, "--site", site, ...flags];
}
async function bodyFile(value: unknown, mode = 0o600): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jira-rest-fixture-"));
  roots.push(root);
  await chmod(root, 0o700);
  const path = join(root, "body.json");
  await writeFile(path, JSON.stringify(value), { mode });
  return path;
}
function createBody(): Record<string, unknown> {
  return {
    fields: {
      project: { key: "TEST" },
      issuetype: { name: "Bug" },
      summary: "Approved fixture issue",
      description: adf(
        "Not verified.",
        "Verified. https://github.com/fixture/repo/pull/1",
      ),
      components: [{ name: "Networking / fixture" }],
      labels: ["fixture"],
    },
  };
}
function linkBody(): Record<string, unknown> {
  return {
    type: { name: "Relates" },
    inwardIssue: { key: "TEST-1" },
    outwardIssue: { key: "TEST-2" },
  };
}
const noTransport = (): typeof fetch =>
  vi.fn<typeof fetch>().mockRejectedValue(new Error(privateMarker));

describe("enhanced Jira search through public main", () => {
  it("follows a token on a short page and emits exactly one complete native issue envelope", async () => {
    const first = issue("TEST-1", {
      description: adf("Not verified.", "Verified."),
      customfield_10020: [{ id: 123 }],
    });
    const second = issue("TEST-2", {
      description: "An existing string stays unchanged.",
    });
    const transport = fixture([
      json({ issues: [first], isLast: false, nextPageToken: "page-two" }),
      json({ issues: [second], isLast: true }),
    ]);
    const result = await invoke(
      command(
        "search",
        "--jql",
        "project = TEST ORDER BY key",
        "--fields",
        "summary,description,customfield_10020",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value).toEqual({
      issues: [
        {
          ...first,
          fields: {
            ...(first.fields as object),
            description: "Not verified.\nVerified.",
          },
        },
        second,
      ],
    });
    expect(result.stdout).toBe(`${JSON.stringify(result.value)}\n`);
    expect(transport.calls.map(({ url }) => url.pathname)).toEqual([
      "/rest/api/3/search/jql",
      "/rest/api/3/search/jql",
    ]);
    expect(transport.calls.map(({ init }) => init.method)).toEqual([
      "POST",
      "POST",
    ]);
    expect(
      transport.calls.map(
        ({ init }) => JSON.parse(bodyString(init.body)) as unknown,
      ),
    ).toEqual([
      {
        jql: "project = TEST ORDER BY key",
        fields: ["summary", "description", "customfield_10020"],
        maxResults: 100,
      },
      {
        jql: "project = TEST ORDER BY key",
        fields: ["summary", "description", "customfield_10020"],
        maxResults: 100,
        nextPageToken: "page-two",
      },
    ]);
    expect(
      new Headers(transport.calls[0].init.headers).get("content-type"),
    ).toBe("application/json");
  });

  it.each([1, 3])(
    "caps only explicit --limit %i, without fetching unused continuation",
    async (limit) => {
      const transport = fixture([
        json({
          issues: Array.from({ length: 4 }, (_, index) =>
            issue(`TEST-${index + 1}`),
          ),
          isLast: false,
          nextPageToken: "unused",
        }),
      ]);
      const result = await invoke<SearchOutput>(
        command(
          "search",
          "--jql",
          "project = TEST",
          "--fields",
          "summary",
          "--limit",
          String(limit),
        ),
        transport.fetcher,
      );
      expect(result.code).toBe(0);
      expect(result.value.issues.map((entry) => entry.key)).toEqual(
        Array.from({ length: limit }, (_, index) => `TEST-${index + 1}`),
      );
      expect(transport.calls).toHaveLength(1);
      expect(
        (
          JSON.parse(bodyString(transport.calls[0].init.body)) as Record<
            string,
            unknown
          >
        ).maxResults,
      ).toBe(limit);
    },
  );

  it("reduces subsequent maxResults to the remaining explicit limit", async () => {
    const transport = fixture([
      json({ issues: [issue("TEST-1")], nextPageToken: "next" }),
      json({ issues: [issue("TEST-2"), issue("TEST-3")], isLast: true }),
    ]);
    const result = await invoke<SearchOutput>(
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "3",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value.issues).toHaveLength(3);
    expect(
      transport.calls.map(
        ({ init }) =>
          (JSON.parse(bodyString(init.body)) as Record<string, unknown>)
            .maxResults,
      ),
    ).toEqual([3, 2]);
  });

  it.each([{}, { isLast: true }, { isLast: true, nextPageToken: "ignored" }])(
    "accepts empty completed search %j",
    async (metadata) => {
      const transport = fixture([json({ issues: [], ...metadata })]);
      const result = await invoke(
        command("search", "--jql", "project = NONE", "--fields", "summary"),
        transport.fetcher,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('{"issues":[]}\n');
      expect(transport.calls).toHaveLength(1);
    },
  );

  it.each([
    { issues: [issue("TEST-2")], isLast: false },
    { issues: [issue("TEST-2")], isLast: false, nextPageToken: "" },
    { issues: [issue("TEST-2")], isLast: false, nextPageToken: "   " },
    { issues: [issue("TEST-2")], nextPageToken: "repeat" },
    { issues: [issue("TEST-2")], nextPageToken: 123 },
    { issues: [issue("TEST-2")], isLast: "false" },
    { issues: "not-an-array" },
    {
      issues: [
        {
          key: "TEST-2",
          fields: { description: { unsupported: privateMarker } },
        },
      ],
    },
  ])(
    "rejects incomplete/malformed later pages without partial stdout: %j",
    async (badPage) => {
      const transport = fixture([
        json({ issues: [issue("TEST-1")], nextPageToken: "repeat" }),
        json(badPage),
      ]);
      const result = await invoke(
        command(
          "search",
          "--jql",
          "project = TEST",
          "--fields",
          "summary,description",
        ),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(transport.calls).toHaveLength(2);
    },
  );

  it("rejects denied later pages without printing the earlier issues or raw error body", async () => {
    const transport = fixture([
      json({ issues: [issue("TEST-1")], nextPageToken: "next" }),
      new Response(privateMarker, { status: 403 }),
    ]);
    const result = await invoke(
      command("search", "--jql", "project = TEST", "--fields", "summary"),
      transport.fetcher,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "jira-rest search: JIRA_HTTP_FAILED (HTTP 403)\n",
    );
    expect(transport.calls).toHaveLength(2);
  });

  it("can advance through an empty token-bearing page rather than silently truncating", async () => {
    const transport = fixture([
      json({ issues: [], isLast: false, nextPageToken: "next" }),
      json({ issues: [issue("TEST-1")], isLast: true }),
    ]);
    const result = await invoke<SearchOutput>(
      command("search", "--jql", "project = TEST", "--fields", "summary"),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value.issues.map((entry) => entry.key)).toEqual(["TEST-1"]);
  });
});

describe("complete issue comments and changelog", () => {
  it("pages by actual count, preserves page-two verification evidence and normalizes all comment bodies", async () => {
    const transport = fixture([
      json(
        issue("TEST-2", {
          description: adf(
            "Story description",
            "https://github.com/fixture/repo/pull/2",
          ),
          comment: {
            comments: [{ body: adf("Expanded incomplete comment") }],
            total: 99,
          },
        }),
      ),
      json({
        comments: [
          {
            id: "c1",
            body: adf("Not verified."),
            author: { displayName: "Fixture QE", accountId: "fixture-qe" },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 2,
      }),
      json({
        comments: [
          {
            id: "c2",
            body: adf("Verified."),
            author: { displayName: "Fixture QE", accountId: "fixture-qe" },
          },
        ],
        startAt: 1,
        maxResults: 100,
        total: 2,
      }),
      json({
        values: [
          {
            id: "h1",
            items: [
              { field: "status", fromString: "New", toString: "In Progress" },
            ],
          },
        ],
        startAt: 0,
        maxResults: 100,
        isLast: false,
      }),
      json({
        values: [
          {
            id: "h2",
            author: { accountId: "fixture-qe" },
            items: [
              {
                field: "status",
                fromString: "In Progress",
                toString: "Verified",
              },
            ],
          },
        ],
        startAt: 1,
        maxResults: 100,
        isLast: true,
      }),
    ]);
    const result = await invoke<IssueOutput>(
      command(
        "issue",
        "--key",
        "TEST-2",
        "--fields",
        "summary,description",
        "--comments",
        "--changelog",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value.fields.description).toBe(
      "Story description\nhttps://github.com/fixture/repo/pull/2",
    );
    expect(
      result.value.fields.comment.comments.map((comment) => comment.body),
    ).toEqual(["Not verified.", "Verified."]);
    expect(result.value.fields.comment.comments[1].author).toEqual({
      displayName: "Fixture QE",
      accountId: "fixture-qe",
    });
    expect(
      result.value.changelog.histories.map((entry) => entry.items[0].toString),
    ).toEqual(["In Progress", "Verified"]);
    expect(result.value.fields.comment.total).toBe(99);
    expect(result.value.changelog).not.toHaveProperty("total");
    expect(
      transport.calls.map(({ url }) => [
        url.pathname,
        url.searchParams.get("startAt"),
      ]),
    ).toEqual([
      ["/rest/api/3/issue/TEST-2", null],
      ["/rest/api/3/issue/TEST-2/comment", "0"],
      ["/rest/api/3/issue/TEST-2/comment", "1"],
      ["/rest/api/3/issue/TEST-2/changelog", "0"],
      ["/rest/api/3/issue/TEST-2/changelog", "1"],
    ]);
    expect(transport.calls[0].url.searchParams.get("fields")).toBe(
      "summary,description",
    );
    expect(transport.calls[0].url.searchParams.has("expand")).toBe(false);
    expect(
      transport.calls
        .slice(1)
        .every(({ url }) => url.searchParams.get("maxResults") === "100"),
    ).toBe(true);
  });

  it("retains native fields on a numeric-ID read and normalizes only descriptions and comments", async () => {
    const value = issue("TEST-27", {
      description: null,
      summary: "Untouched",
      project: { key: "TEST" },
      comment: {
        comments: [
          { body: "Already text.", created: "fixture-date" },
          { body: null },
        ],
      },
    });
    const transport = fixture([json(value)]);
    const result = await invoke(
      command(
        "issue",
        "--key",
        "27",
        "--fields",
        "summary,project,description,comment",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(transport.calls[0].url.pathname).toBe("/rest/api/3/issue/27");
    expect(result.value).toEqual({
      ...value,
      fields: {
        ...(value.fields as object),
        description: "",
        comment: {
          comments: [
            { body: "Already text.", created: "fixture-date" },
            { body: "" },
          ],
        },
      },
    });
    expect(transport.calls).toHaveLength(1);
  });

  it("uses a reported page size for fallback full-page continuation", async () => {
    const transport = fixture([
      json(issue("TEST-1")),
      json({ comments: [{ body: "First" }], startAt: 0, maxResults: 1 }),
      json({ comments: [{ body: "Second" }], startAt: 1, maxResults: 1 }),
      json({ comments: [], startAt: 2, maxResults: 1 }),
    ]);
    const result = await invoke<IssueOutput>(
      command("issue", "--key", "TEST-1", "--fields", "summary", "--comments"),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(
      result.value.fields.comment.comments.map((comment) => comment.body),
    ).toEqual(["First", "Second"]);
    expect(transport.calls).toHaveLength(4);
  });

  it.each([
    { comments: [], total: 2, startAt: 1 },
    { comments: [], isLast: false, startAt: 1 },
    { comments: [{ body: "Second" }], startAt: 0, total: 2 },
    { comments: [{ body: "Second" }], startAt: 1, total: 3, isLast: true },
    { comments: [{ body: "Second" }], startAt: 1, total: 2, isLast: false },
    { comments: [{ body: "Second" }], startAt: 1, total: 1 },
    {
      comments: [{ body: "Second" }, { body: "Third" }],
      startAt: 1,
      maxResults: 1,
    },
    { comments: [{ body: "Second" }], startAt: 1, maxResults: 0 },
    { comments: [{ body: "Second" }], startAt: -1 },
    { comments: [{ body: "Second" }], total: 1.5 },
    { comments: [{ body: "Second" }], isLast: "true" },
    { comments: [{ body: 42 }], total: 2, startAt: 1 },
    { comments: {} },
  ])(
    "rejects contradictory/nonadvancing comments after page one: %j",
    async (badPage) => {
      const transport = fixture([
        json(issue("TEST-1")),
        json({ comments: [{ body: "First" }], isLast: false, startAt: 0 }),
        json(badPage),
      ]);
      const result = await invoke(
        command(
          "issue",
          "--key",
          "TEST-1",
          "--fields",
          "summary",
          "--comments",
        ),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(transport.calls).toHaveLength(3);
    },
  );

  it("rejects a denied page-two changelog even after complete comments, with no partial issue", async () => {
    const transport = fixture([
      json(issue("TEST-1")),
      json({ comments: [{ body: "Verified." }], total: 1 }),
      json({
        values: [{ items: [{ field: "status", toString: "New" }] }],
        isLast: false,
      }),
      new Response(privateMarker, { status: 403 }),
    ]);
    const result = await invoke(
      command(
        "issue",
        "--key",
        "TEST-1",
        "--fields",
        "summary",
        "--comments",
        "--changelog",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(1);
    expect(transport.calls).toHaveLength(4);
  });

  it.each([
    { values: [], startAt: 1, total: 2 },
    { values: [{ items: [] }], startAt: 0, total: 2 },
    { values: [{ items: [] }], startAt: 1, total: 3, isLast: true },
    { values: [{ items: "not-an-array" }], startAt: 1, total: 2 },
    { values: [{ items: [{ field: 42 }] }], startAt: 1, total: 2 },
    { values: [{}], startAt: 1, total: 2 },
  ])(
    "rejects malformed/contradictory changelog page two: %j",
    async (badPage) => {
      const transport = fixture([
        json(issue("TEST-1")),
        json({
          values: [{ items: [{ field: "status", toString: "New" }] }],
          startAt: 0,
          isLast: false,
        }),
        json(badPage),
      ]);
      const result = await invoke(
        command(
          "issue",
          "--key",
          "TEST-1",
          "--fields",
          "summary",
          "--changelog",
        ),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(transport.calls).toHaveLength(3);
    },
  );

  it.each(["comments", "changelog"])(
    "accepts empty complete %s",
    async (flag) => {
      const transport = fixture([
        json(issue("TEST-1")),
        json({
          [flag === "comments" ? "comments" : "values"]: [],
          total: 0,
          startAt: 0,
          isLast: true,
        }),
      ]);
      const result = await invoke<IssueOutput>(
        command("issue", "--key", "TEST-1", "--fields", "summary", `--${flag}`),
        transport.fetcher,
      );
      expect(result.code).toBe(0);
      expect(
        flag === "comments"
          ? result.value.fields.comment.comments
          : result.value.changelog.histories,
      ).toEqual([]);
    },
  );
});

describe("ADF normalization at public CLI boundaries", () => {
  const rich = {
    version: 1,
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Not verified." }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Verified." }],
      },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: "fixture-qe", text: "@Fixture QE" } },
          { type: "text", text: " reviewed " },
          {
            type: "text",
            text: "the PR",
            marks: [
              {
                type: "link",
                attrs: { href: "https://github.com/fixture/repo/pull/1" },
              },
            ],
          },
          { type: "hardBreak" },
          {
            type: "inlineCard",
            attrs: { url: "https://github.com/fixture/repo/pull/2" },
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "first item" }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "second item" }],
              },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        content: [{ type: "text", text: "line 1\nline 2" }],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "text", text: "row one" }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "text", text: "row two" }],
              },
            ],
          },
        ],
      },
      {
        type: "unknownContainer",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "unknown content retained" }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "https://github.com/fixture/repo/pull/3",
            marks: [
              {
                type: "link",
                attrs: { href: "https://github.com/fixture/repo/pull/3" },
              },
            ],
          },
        ],
      },
    ],
  };
  const expected =
    "Not verified.\nVerified.\n@Fixture QE reviewed the PR (https://github.com/fixture/repo/pull/1)\nhttps://github.com/fixture/repo/pull/2\nfirst item\nsecond item\nline 1\nline 2\nrow one\nrow two\nunknown content retained\nhttps://github.com/fixture/repo/pull/3";

  it("preserves negation, ordered paragraphs, mentions, hard breaks, block boundaries and all URL targets", async () => {
    const transport = fixture([
      json({
        issues: [
          issue("TEST-1", {
            description: rich,
            comment: { comments: [{ body: rich }] },
          }),
        ],
        isLast: true,
      }),
    ]);
    const result = await invoke<SearchOutput>(
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "description,comment",
      ),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value.issues[0].fields.description).toBe(expected);
    expect(result.value.issues[0].fields.comment.comments[0].body).toBe(
      expected,
    );
    expect(result.stdout).not.toContain("[object Object]");
    expect(
      result.value.issues[0].fields.description.split(
        "https://github.com/fixture/repo/pull/3",
      ),
    ).toHaveLength(2);
    expect(adfToText(rich)).toBe(expected);
  });

  it.each(["Verified", "Not verified"])(
    "preserves the visible status text %s in descriptions and comments",
    async (status) => {
      const body = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "status", attrs: { text: status, color: "green" } },
              { type: "text", text: ". https://example.invalid/proof" },
            ],
          },
        ],
      };
      const transport = fixture([
        json({
          issues: [
            issue("TEST-1", {
              description: body,
              comment: { comments: [{ body }] },
            }),
          ],
          isLast: true,
        }),
      ]);
      const result = await invoke<SearchOutput>(
        command(
          "search",
          "--jql",
          "project = TEST",
          "--fields",
          "description,comment",
        ),
        transport.fetcher,
      );
      const expected = `${status}. https://example.invalid/proof`;
      expect(result.code).toBe(0);
      expect(result.value.issues[0].fields.description).toBe(expected);
      expect(result.value.issues[0].fields.comment.comments[0].body).toBe(
        expected,
      );
    },
  );

  it("leaves plain strings and null distinct and preserves literal leading/trailing whitespace", async () => {
    const plain = "  Not verified.\nVerified.  \n";
    const transport = fixture([
      json({
        issues: [
          issue("TEST-1", { description: plain }),
          issue("TEST-2", { description: null }),
          issue("TEST-3", { description: adf(plain) }),
        ],
      }),
    ]);
    const result = await invoke<SearchOutput>(
      command("search", "--jql", "project = TEST", "--fields", "description"),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(
      result.value.issues.map((entry) => entry.fields.description),
    ).toEqual([plain, "", plain]);
  });

  it.each(
    [
      42,
      false,
      [],
      { unsupported: privateMarker },
      { type: "paragraph", content: [] },
      { type: "doc", version: 2, content: [] },
      { type: "doc", content: {} },
      { type: "doc", content: ["text"] },
      { type: "doc", content: [{ type: "text", text: 42 }] },
      { type: "doc", content: [{ type: "text" }] },
      {
        type: "doc",
        content: [{ type: "mention", attrs: { id: "missing-display" } }],
      },
      { type: "doc", content: [{ type: "inlineCard", attrs: { url: 42 } }] },
      {
        type: "doc",
        content: [
          {
            type: "text",
            text: "PR",
            marks: [{ type: "link", attrs: { href: {} } }],
          },
        ],
      },
    ].map((description) => ({ description })),
  )(
    "fails rather than stringify malformed descriptions: %j",
    async ({ description }) => {
      const transport = fixture([json(issue("TEST-1", { description }))]);
      const result = await invoke(
        command("issue", "--key", "TEST-1", "--fields", "description"),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_RESPONSE_INVALID");
    },
  );
});

describe("remaining bounded Jira reads", () => {
  it.each([
    [
      "remote-links",
      ["--key", "TEST-1"],
      "/rest/api/3/issue/TEST-1/remotelink",
      [
        {
          id: 1,
          object: {
            url: "https://github.com/fixture/repo/pull/1",
            title: "Fixture PR",
          },
        },
      ],
    ],
    [
      "transitions",
      ["--key", "TEST-1"],
      "/rest/api/3/issue/TEST-1/transitions",
      { transitions: [{ id: "31", name: "Done", to: { name: "Done" } }] },
    ],
    [
      "issue-link-types",
      [],
      "/rest/api/3/issueLinkType",
      {
        issueLinkTypes: [
          {
            id: "10003",
            name: "Cloners",
            inward: "is cloned by",
            outward: "clones",
          },
        ],
      },
    ],
  ] as const)(
    "returns native %s without unrelated requests",
    async (action, flags, path, native) => {
      const transport = fixture([json(native)]);
      const result = await invoke(command(action, ...flags), transport.fetcher);
      expect(result.code).toBe(0);
      expect(result.value).toEqual(native);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].url.pathname).toBe(path);
      expect(transport.calls[0].init.method).toBe("GET");
    },
  );

  it("pages users at 100 and does not require visible email", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      accountId: `fixture-${index}`,
      displayName: `Fixture ${index}`,
    }));
    const last = { accountId: "fixture-qe", displayName: "Fixture QE" };
    const transport = fixture([json(first), json([last])]);
    const result = await invoke<{ accountId: string; displayName: string }[]>(
      command("user-search", "--query", "Fixture + QE & Review"),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.value).toEqual([...first, last]);
    expect(
      result.value.every((user) => !Object.hasOwn(user, "emailAddress")),
    ).toBe(true);
    expect(
      transport.calls.map(({ url }) => [
        url.pathname,
        url.searchParams.get("query"),
        url.searchParams.get("startAt"),
        url.searchParams.get("maxResults"),
      ]),
    ).toEqual([
      ["/rest/api/3/user/search", "Fixture + QE & Review", "0", "100"],
      ["/rest/api/3/user/search", "Fixture + QE & Review", "100", "100"],
    ]);
  });

  it("handles empty user search", async () => {
    const transport = fixture([json([])]);
    const result = await invoke(
      command("user-search", "--query", "none"),
      transport.fetcher,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("[]\n");
  });

  it.each([
    ["remote-links", ["--key", "TEST-1"], {}],
    ["remote-links", ["--key", "TEST-1"], [null]],
    ["remote-links", ["--key", "TEST-1"], [{}]],
    ["remote-links", ["--key", "TEST-1"], [{ object: { url: 42 } }]],
    [
      "transitions",
      ["--key", "TEST-1"],
      { transitions: [{ id: "31", name: "Done" }] },
    ],
    ["issue-link-types", [], { issueLinkTypes: [{ name: "Cloners" }] }],
    ["user-search", ["--query", "fixture"], [{ displayName: "No account ID" }]],
    ["transitions", ["--key", "TEST-1"], { transitions: {} }],
    ["issue-link-types", [], { issueLinkTypes: ["bad"] }],
    ["user-search", ["--query", "fixture"], { users: [] }],
    [
      "issue",
      ["--key", "TEST-1", "--fields", "summary"],
      { key: "TEST-1", fields: null },
    ],
  ] as const)(
    "rejects malformed %s schema",
    async (action, flags, response) => {
      const transport = fixture([json(response)]);
      expect(
        (await invoke(command(action, ...flags), transport.fetcher)).code,
      ).toBe(1);
    },
  );
});

describe("argument/authentication/transport safety", () => {
  it("prints JSON help without auth or transport", async () => {
    const fetcher = noTransport();
    const result = await invoke<{ actions: string[] }>(["--help"], fetcher, {});
    expect(result.code).toBe(0);
    expect(result.value.actions).toEqual([
      "search",
      "issue",
      "remote-links",
      "transitions",
      "issue-link-types",
      "user-search",
      "set-fix-versions",
      "set-components",
      "transition",
      "create-issue",
      "link-issues",
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("attaches a 60-second timeout to each request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const transport = fixture([json({ issueLinkTypes: [] })]);
    expect(
      (await invoke(command("issue-link-types"), transport.fetcher)).code,
    ).toBe(0);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it("accepts common --site before the action without exposing an arbitrary endpoint", async () => {
    const transport = fixture([json({ issues: [] })]);
    const result = await invoke(
      [
        "--site",
        site,
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
      ],
      transport.fetcher,
    );
    expect(result.code).toBe(0);
  });

  it.each(
    [
      [],
      ["unknown", "--site", site],
      ["request", "--site", site, "--method", "DELETE"],
      ["--help", "--help"],
      ["--help", "--site", site],
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--extra",
        "x",
      ),
      command(
        "search",
        "--site",
        site,
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
      ),
      command("search", "--jql", "one", "--jql", "two", "--fields", "summary"),
      command("search", "--fields", "summary"),
      command("search", "--jql", "", "--fields", "summary"),
      command("search", "--jql", "   ", "--fields", "summary"),
      command("search", "--jql", "project = TEST", "--fields"),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary,,status",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "0",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "-1",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "1.5",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "01",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--limit",
        "9007199254740992",
      ),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "--approved",
      ),
      command(
        "issue",
        "--key",
        "TEST-1",
        "--fields",
        "summary",
        "--comments",
        "--comments",
      ),
      command("issue", "--key", "../../another", "--fields", "summary"),
      command("issue", "--key", "TEST-1?token=private", "--fields", "summary"),
      command("issue-link-types", "--fields", "summary"),
      command(
        "search",
        "--jql",
        "project = TEST",
        "--fields",
        "summary",
        "issue",
      ),
      ["search", "--jql", "project = TEST", "--fields", "summary"],
    ].map((args) => ({ args })),
  )("rejects bad arguments before transport: %j", async ({ args }) => {
    const fetcher = noTransport();
    const result = await invoke(args, fetcher);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JIRA_ARGUMENTS_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "https://jira.fixture.invalid",
    "jira.fixture.invalid:443",
    "user:password@jira.fixture.invalid",
    "jira.fixture.invalid/path",
    "jira.fixture.invalid?token=secret",
    "jira.fixture.invalid#fragment",
    "127.0.0.1",
    "127.1",
    "2130706433",
    "[::1]",
    "-bad.fixture.invalid",
    "bad-.fixture.invalid",
    "bad..fixture.invalid",
    "jira_fixture.invalid",
    "jira.fixture.invalid.",
    "jirá.fixture.invalid",
    "a".repeat(64) + ".invalid",
  ])("rejects non-DNS/unsafe site %s before transport", async (host) => {
    const fetcher = noTransport();
    const result = await invoke(["issue-link-types", "--site", host], fetcher);
    expect(result.code).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { JIRA_EMAIL: env.JIRA_EMAIL },
    { JIRA_API_TOKEN: env.JIRA_API_TOKEN },
    { JIRA_EMAIL: " ", JIRA_API_TOKEN: env.JIRA_API_TOKEN },
    {
      JIRA_EMAIL: "fixture\r\n@example.invalid",
      JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    },
    {
      JIRA_EMAIL: "fixture:other@example.invalid",
      JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    },
    { JIRA_EMAIL: env.JIRA_EMAIL, JIRA_API_TOKEN: "secret\n" },
  ])("rejects absent/unsafe auth %j before transport", async (credentials) => {
    const fetcher = noTransport();
    const result = await invoke(
      command("issue-link-types"),
      fetcher,
      credentials,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "jira-rest issue-link-types: JIRA_AUTH_UNAVAILABLE\n",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([301, 302, 307, 308, 401, 403, 404, 500])(
    "rejects HTTP %i without reading/exposing error bodies or retrying",
    async (status) => {
      const response = new Response(
        `${privateMarker} ${env.JIRA_EMAIL} ${env.JIRA_API_TOKEN}`,
        { status, headers: { Location: "https://attacker.fixture.invalid" } },
      );
      const reader = vi.spyOn(response, "json");
      const transport = fixture([response]);
      const result = await invoke(
        command("issue-link-types"),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        `jira-rest issue-link-types: JIRA_HTTP_FAILED (HTTP ${status})\n`,
      );
      expect(reader).not.toHaveBeenCalled();
      expect(transport.calls).toHaveLength(1);
    },
  );

  it("rejects redirected or origin-mismatched responses even when status is 200", async () => {
    for (const properties of [
      { redirected: true },
      { url: "https://attacker.fixture.invalid/stolen" },
    ]) {
      const response = json({ issueLinkTypes: [] });
      for (const [key, value] of Object.entries(properties))
        Object.defineProperty(response, key, { value });
      const transport = fixture([response]);
      const result = await invoke(
        command("issue-link-types"),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        "jira-rest issue-link-types: JIRA_ACCESS_FAILED\n",
      );
      expect(transport.calls).toHaveLength(1);
    }
  });

  it("hides raw transport exceptions and malformed successful JSON", async () => {
    const denied = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          `${privateMarker} ${env.JIRA_EMAIL} ${env.JIRA_API_TOKEN} https://attacker.fixture.invalid`,
        ),
      );
    const deniedResult = await invoke(command("issue-link-types"), denied);
    expect(deniedResult.code).toBe(1);
    expect(deniedResult.stderr).toBe(
      "jira-rest issue-link-types: JIRA_ACCESS_FAILED\n",
    );
    expect(denied).toHaveBeenCalledTimes(1);
    const transport = fixture([new Response(privateMarker)]);
    const malformed = await invoke(
      command("issue-link-types"),
      transport.fetcher,
    );
    expect(malformed.code).toBe(1);
    expect(malformed.stderr).toBe(
      "jira-rest issue-link-types: JIRA_RESPONSE_INVALID\n",
    );
  });
});

describe("five strictly approval-gated mutations", () => {
  it.each([
    [
      "set-fix-versions",
      [
        "--key",
        "TEST-1",
        "--versions-json",
        JSON.stringify([{ id: "10001" }, { name: "4.22.z" }]),
      ],
      "/rest/api/3/issue/TEST-1",
      "PUT",
      { fields: { fixVersions: [{ id: "10001" }, { name: "4.22.z" }] } },
    ],
    [
      "set-components",
      [
        "--key",
        "TEST-1",
        "--components-json",
        JSON.stringify([{ name: "Networking / fixture" }]),
      ],
      "/rest/api/3/issue/TEST-1",
      "PUT",
      { fields: { components: [{ name: "Networking / fixture" }] } },
    ],
    [
      "transition",
      ["--key", "TEST-1", "--transition-id", "31"],
      "/rest/api/3/issue/TEST-1/transitions",
      "POST",
      { transition: { id: "31" } },
    ],
  ] as const)(
    "performs one approved %s mutation with the exact constrained payload",
    async (action, flags, path, method, payload) => {
      const transport = fixture([new Response(null, { status: 204 })]);
      const result = await invoke(
        command(action, ...flags, "--approved"),
        transport.fetcher,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("{}\n");
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].url.pathname).toBe(path);
      expect(transport.calls[0].init.method).toBe(method);
      expect(
        JSON.parse(bodyString(transport.calls[0].init.body)) as unknown,
      ).toEqual(payload);
      expect(
        new Headers(transport.calls[0].init.headers).get("content-type"),
      ).toBe("application/json");
    },
  );

  it.each([
    [
      "create-issue",
      createBody(),
      "/rest/api/3/issue",
      {
        id: "3",
        key: "TEST-3",
        self: "https://jira.fixture.invalid/rest/api/3/issue/3",
      },
    ],
    ["link-issues", linkBody(), "/rest/api/3/issueLink", {}],
  ] as const)(
    "performs one approved %s from a private body file and returns native JSON",
    async (action, body, path, response) => {
      const file = await bodyFile(body);
      const transport = fixture([
        action === "link-issues"
          ? new Response(null, { status: 201 })
          : json(response, 201),
      ]);
      const result = await invoke(
        command(action, "--body-file", file, "--approved"),
        transport.fetcher,
      );
      expect(result.code).toBe(0);
      expect(result.value).toEqual(response);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].url.pathname).toBe(path);
      expect(transport.calls[0].init.method).toBe("POST");
      expect(
        JSON.parse(bodyString(transport.calls[0].init.body)) as unknown,
      ).toEqual(body);
    },
  );

  it("rejects an empty creation response instead of applying link-success semantics", async () => {
    const file = await bodyFile(createBody());
    const transport = fixture([new Response(null, { status: 201 })]);
    const result = await invoke(
      command("create-issue", "--body-file", file, "--approved"),
      transport.fetcher,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JIRA_RESPONSE_INVALID");
  });

  it.each([
    [
      "set-fix-versions",
      ["--key", "TEST-1", "--versions-json", '[{"id":"10001"}]'],
    ],
    [
      "set-components",
      ["--key", "TEST-1", "--components-json", '[{"name":"Fixture"}]'],
    ],
    ["transition", ["--key", "TEST-1", "--transition-id", "31"]],
    ["create-issue", ["--body-file", "/does/not/exist"]],
    ["link-issues", ["--body-file", "/does/not/exist"]],
  ] as const)("never transports unapproved %s", async (action, flags) => {
    const fetcher = noTransport();
    const result = await invoke(command(action, ...flags), fetcher);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JIRA_APPROVAL_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["set-fix-versions", "versions-json", "not JSON"],
    ["set-fix-versions", "versions-json", "[]"],
    ["set-fix-versions", "versions-json", '[{"id":"1","name":"extra"}]'],
    ["set-fix-versions", "versions-json", '[{"id":1}]'],
    ["set-fix-versions", "versions-json", '[{"name":" "}]'],
    [
      "set-fix-versions",
      "versions-json",
      '[{"id":"1","fields":{"assignee":{"accountId":"other"}}}]',
    ],
    ["set-components", "components-json", "null"],
    ["set-components", "components-json", "[]"],
    ["set-components", "components-json", '[{"id":"1"}]'],
    ["set-components", "components-json", '[{"name":"Fixture","id":"1"}]'],
    ["set-components", "components-json", '[{"name":""}]'],
  ])(
    "rejects unsafe %s array %s=%s before transport",
    async (action, flag, value) => {
      const fetcher = noTransport();
      const result = await invoke(
        command(action, "--key", "TEST-1", `--${flag}`, value, "--approved"),
        fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported mutation arguments instead of permitting a generic tunnel", async () => {
    for (const args of [
      command(
        "transition",
        "--key",
        "TEST-1",
        "--transition-id",
        "not-an-id",
        "--approved",
      ),
      command(
        "transition",
        "--key",
        "TEST-1",
        "--transition-id",
        "31",
        "--approved",
        "--approved",
      ),
      command(
        "transition",
        "--key",
        "TEST-1",
        "--transition-id",
        "31",
        "--approved",
        "--body-file",
        "ignored",
      ),
      command(
        "set-components",
        "--key",
        "TEST-1",
        "--components-json",
        '[{"name":"Fixture"}]',
        "--approved",
        "--endpoint",
        "/rest/api/3/user",
      ),
      command("delete-issue", "--key", "TEST-1", "--approved"),
    ]) {
      const fetcher = noTransport();
      expect((await invoke(args, fetcher)).code).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it.each(["create-issue", "link-issues"])(
    "rejects unsafe %s body file storage before transport",
    async (action) => {
      const body = action === "create-issue" ? createBody() : linkBody();
      const file = await bodyFile(body);
      const root = join(file, "..");
      const symlinkPath = join(root, "symlink.json");
      await symlink(file, symlinkPath);
      const directory = join(root, "directory");
      await mkdir(directory, { mode: 0o600 });
      const attempts = [symlinkPath, directory, join(root, "missing.json")];
      for (const path of attempts) {
        const fetcher = noTransport();
        const result = await invoke(
          command(action, "--body-file", path, "--approved"),
          fetcher,
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
        expect(fetcher).not.toHaveBeenCalled();
      }
      for (const mode of [0o644, 0o400, 0o660, 0o700]) {
        await chmod(file, mode);
        const fetcher = noTransport();
        expect(
          (
            await invoke(
              command(action, "--body-file", file, "--approved"),
              fetcher,
            )
          ).code,
        ).toBe(1);
        expect(fetcher).not.toHaveBeenCalled();
      }
      await chmod(file, 0o600);
      const hardlink = join(root, "hardlink.json");
      await link(file, hardlink);
      for (const path of [file, hardlink]) {
        const fetcher = noTransport();
        expect(
          (
            await invoke(
              command(action, "--body-file", path, "--approved"),
              fetcher,
            )
          ).code,
        ).toBe(1);
        expect(fetcher).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["create-issue", "link-issues"])(
    "rejects %s body files beneath symlink ancestors before transport",
    async (action) => {
      const body = action === "create-issue" ? createBody() : linkBody();
      const file = await bodyFile(body);
      const root = join(file, "..");
      const nested = join(root, "nested");
      await mkdir(nested, { mode: 0o700 });
      await writeFile(join(nested, "body.json"), JSON.stringify(body), {
        mode: 0o600,
      });
      const alias = join(root, "directory-alias");
      await symlink(root, alias);
      for (const path of [
        join(alias, "body.json"),
        join(alias, "nested", "body.json"),
      ]) {
        const fetcher = noTransport();
        const result = await invoke(
          command(action, "--body-file", path, "--approved"),
          fetcher,
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
        expect(fetcher).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects a body file not owned by the current process", async () => {
    if (!process.getuid)
      throw new Error("This private-file fixture requires getuid");
    const uid = process.getuid();
    const file = await bodyFile(createBody());
    const owner = vi
      .spyOn(process as NodeJS.Process & { getuid: () => number }, "getuid")
      .mockReturnValue(uid + 1);
    const fetcher = noTransport();
    try {
      const result = await invoke(
        command("create-issue", "--body-file", file, "--approved"),
        fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      owner.mockRestore();
    }
  });

  it("rejects invalid/empty/non-UTF8 private JSON body files", async () => {
    const file = await bodyFile(createBody());
    for (const bytes of [
      Buffer.from(privateMarker),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xfe]),
    ]) {
      await writeFile(file, bytes);
      const fetcher = noTransport();
      const result = await invoke(
        command("create-issue", "--body-file", file, "--approved"),
        fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it.each([
    { ...createBody(), endpoint: "/rest/api/3/user" },
    {
      fields: {
        ...(createBody().fields as object),
        assignee: { accountId: "other" },
      },
    },
    { fields: { ...(createBody().fields as object), customfield_10020: 5 } },
    {
      fields: {
        ...(createBody().fields as object),
        project: { key: "TEST", id: "1" },
      },
    },
    { fields: { ...(createBody().fields as object), issuetype: { id: "1" } } },
    { fields: { ...(createBody().fields as object), summary: " " } },
    { fields: { ...(createBody().fields as object), labels: [42] } },
    {
      fields: { ...(createBody().fields as object), components: [{ id: "1" }] },
    },
    { fields: { ...(createBody().fields as object), description: "not ADF" } },
    {
      fields: {
        ...(createBody().fields as object),
        description: { version: 2, type: "doc", content: [] },
      },
    },
    {
      fields: {
        ...(createBody().fields as object),
        description: {
          version: 1,
          type: "doc",
          content: [{ type: "text", text: 42 }],
        },
      },
    },
    {
      fields: {
        ...(createBody().fields as object),
        description: { version: 1, type: "doc", content: [], extra: "field" },
      },
    },
    {
      fields: {
        project: { key: "TEST" },
        issuetype: { name: "Bug" },
        summary: "Missing fields",
      },
    },
  ])(
    "rejects unrelated/malformed create schema before transport: %j",
    async (body) => {
      const file = await bodyFile(body);
      const fetcher = noTransport();
      const result = await invoke(
        command("create-issue", "--body-file", file, "--approved"),
        fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...linkBody(), comment: { body: privateMarker } },
    { ...linkBody(), type: { name: "Cloners" } },
    { ...linkBody(), type: { name: "Relates", id: "1" } },
    { ...linkBody(), inwardIssue: { key: "TEST-1", id: "1" } },
    { ...linkBody(), outwardIssue: { key: "../../other" } },
    { type: { name: "Relates" }, inwardIssue: { key: "TEST-1" } },
  ])(
    "rejects unrelated/malformed Relates schema before transport: %j",
    async (body) => {
      const file = await bodyFile(body);
      const fetcher = noTransport();
      const result = await invoke(
        command("link-issues", "--body-file", file, "--approved"),
        fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_BODY_UNSAFE");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    "set-fix-versions",
    "set-components",
    "transition",
    "create-issue",
    "link-issues",
  ])(
    "returns safe per-item HTTP failure for approved %s without retry",
    async (action) => {
      let flags: string[];
      if (action === "set-fix-versions")
        flags = ["--key", "TEST-1", "--versions-json", '[{"name":"4.22.z"}]'];
      else if (action === "set-components")
        flags = [
          "--key",
          "TEST-1",
          "--components-json",
          '[{"name":"Fixture"}]',
        ];
      else if (action === "transition")
        flags = ["--key", "TEST-1", "--transition-id", "31"];
      else
        flags = [
          "--body-file",
          await bodyFile(action === "create-issue" ? createBody() : linkBody()),
        ];
      const transport = fixture([
        new Response(`${privateMarker} ${env.JIRA_API_TOKEN}`, { status: 403 }),
      ]);
      const result = await invoke(
        command(action, ...flags, "--approved"),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        `jira-rest ${action}: JIRA_HTTP_FAILED (HTTP 403)\n`,
      );
      expect(transport.calls).toHaveLength(1);
    },
  );

  it("rejects malformed successful mutation JSON rather than claiming success", async () => {
    for (const response of [
      new Response(privateMarker),
      json(null),
      json([{}]),
    ]) {
      const transport = fixture([response]);
      const result = await invoke(
        command(
          "transition",
          "--key",
          "TEST-1",
          "--transition-id",
          "31",
          "--approved",
        ),
        transport.fetcher,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("JIRA_RESPONSE_INVALID");
      expect(transport.calls).toHaveLength(1);
    }
  });
});
