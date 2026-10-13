import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./gitlab-read.js";

const args = [
  "qe-context",
  "--project",
  "fixture-group/fixture-repo",
  "--issue-key",
  "TEST-2",
];
const env = {
  GITLAB_API_URL: "https://gitlab.example.invalid/api/v4",
  GITLAB_PAT: "fixture-private-token",
  GITHUB_PAT: "never-send-github-token",
};
const readme =
  "# Fixture project\nTests: test/verification.spec.ts\nUnicode: ✓\n";
const firstTree = [{ path: "src/main.ts", type: "blob" }];
const lastTree = [{ path: "test/verification.spec.ts", type: "blob" }];
const mrs = [
  {
    id: 1,
    title: "TEST-2: verification",
    web_url:
      "https://gitlab.example.invalid/fixture-group/fixture-repo/-/merge_requests/1",
  },
];

type InvocationResult = { code: number; out: string; err: string };
type SuccessOutput = {
  context: { readme: string; merge_requests: unknown[]; tree: unknown[] };
  warnings: string[];
};
afterEach(() => vi.restoreAllMocks());

async function invoke(
  argv: string[],
  fetcher: typeof fetch,
  environment: NodeJS.ProcessEnv = env,
) {
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const code = await main(argv, fetcher, environment);
  const out = stdout.mock.calls.map((call) => String(call[0])).join("");
  const err = stderr.mock.calls.map((call) => String(call[0])).join("");
  stdout.mockRestore();
  stderr.mockRestore();
  return { code, out, err };
}

function fixture(
  overrides: {
    readme?: () => Response;
    mrs?: () => Response;
    tree?: (page: string) => Response;
  } = {},
) {
  return vi.fn<typeof fetch>((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe("https://gitlab.example.invalid");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe(
      env.GITLAB_PAT,
    );
    expect(JSON.stringify(init)).not.toContain(env.GITHUB_PAT);
    if (
      url.pathname ===
      "/api/v4/projects/fixture-group%2Ffixture-repo/repository/files/README.md"
    ) {
      expect([...url.searchParams.entries()]).toEqual([["ref", "HEAD"]]);
      return Promise.resolve(
        overrides.readme?.() ??
          Response.json({
            encoding: "base64",
            content: Buffer.from(readme).toString("base64"),
          }),
      );
    }
    if (
      url.pathname ===
      "/api/v4/projects/fixture-group%2Ffixture-repo/merge_requests"
    ) {
      expect([...url.searchParams.entries()]).toEqual([
        ["search", "TEST-2"],
        ["scope", "all"],
        ["per_page", "10"],
      ]);
      return Promise.resolve(overrides.mrs?.() ?? Response.json(mrs));
    }
    if (
      url.pathname ===
      "/api/v4/projects/fixture-group%2Ffixture-repo/repository/tree"
    ) {
      expect(url.searchParams.get("path")).toBe("");
      expect(url.searchParams.get("recursive")).toBe("true");
      expect(url.searchParams.get("per_page")).toBe("100");
      const page = url.searchParams.get("page")!;
      if (overrides.tree) return Promise.resolve(overrides.tree(page));
      if (page === "1")
        return Promise.resolve(
          Response.json(firstTree, { headers: { "X-Next-Page": "2" } }),
        );
      if (page === "2")
        return Promise.resolve(
          Response.json(lastTree, { headers: { "X-Next-Page": "" } }),
        );
    }
    return Promise.reject(
      new Error("Unexpected fixture route; deny transport"),
    );
  });
}

function expectOptionalFailure(result: InvocationResult, code: string) {
  expect(result).toEqual({
    code: 3,
    out: `${JSON.stringify({ context: null, warnings: [code] })}\n`,
    err: "",
  });
  expect(result.out + result.err).not.toContain(env.GITLAB_PAT);
  expect(result.out + result.err).not.toContain(env.GITHUB_PAT);
  expect(result.out + result.err).not.toContain("RAW_PRIVATE_BODY");
}

describe("GitLab qe-context public CLI", () => {
  it("emits one complete JSON context with decoded README and page-two paths", async () => {
    const fetcher = fixture();
    const result = await invoke(args, fetcher);
    expect(result).toEqual({
      code: 0,
      out: `${JSON.stringify({ context: { readme, merge_requests: mrs, tree: [...firstTree, ...lastTree] }, warnings: [] })}\n`,
      err: "",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses explicit API base in preference to the environment", async () => {
    const result = await invoke(
      [...args, "--api-url", env.GITLAB_API_URL + "/"],
      fixture(),
      { ...env, GITLAB_API_URL: "https://wrong.example.invalid/api/v4" },
    );
    expect(result.code).toBe(0);
  });

  it("allows public reads without GitLab auth and never substitutes GitHub auth", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      expect(new Headers(init?.headers).has("PRIVATE-TOKEN")).toBe(false);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(JSON.stringify(init)).not.toContain(env.GITHUB_PAT);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("README.md"))
        return Promise.resolve(
          Response.json({ encoding: "base64", content: "" }),
        );
      return Promise.resolve(Response.json([]));
    });
    const result = await invoke(args, fetcher, {
      GITLAB_API_URL: env.GITLAB_API_URL,
      GITHUB_PAT: env.GITHUB_PAT,
    });
    expect(result.code).toBe(0);
    const output = JSON.parse(result.out) as SuccessOutput;
    expect(output).toEqual({
      context: { readme: "", merge_requests: [], tree: [] },
      warnings: [],
    });
  });

  it("continues full tree pages when pagination headers are absent", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      type: "blob",
    }));
    const fetcher = fixture({
      tree: (page) => Response.json(page === "1" ? fullPage : lastTree),
    });
    const result = await invoke(args, fetcher);
    expect(result.code).toBe(0);
    const output = JSON.parse(result.out) as SuccessOutput;
    expect(output.context.tree).toEqual([...fullPage, ...lastTree]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("honors an explicit exhausted tree header even for a full page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      type: "blob",
    }));
    const fetcher = fixture({
      tree: () => Response.json(fullPage, { headers: { "X-Next-Page": "" } }),
    });
    const result = await invoke(args, fetcher);
    expect(result.code).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("supports --help with no credentials or transport", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await invoke(["--help"], fetcher, {});
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: gitlab-read qe-context");
    expect(result.err).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });

  for (const argv of [
    [],
    ["other"],
    ["qe-context"],
    [...args, "--unknown", "value"],
    [...args, "--api-url"],
    [...args, "--api-url", ""],
    [...args, "--project", "other/repo"],
    [...args, "--help"],
    ["qe-context", "--project", "owner/../repo", "--issue-key", "TEST-2"],
    ["qe-context", "--project", "owner/repo", "--issue-key", "not a key"],
    [...args, "--api-url", "https://example.invalid/api/v4\n"],
  ]) {
    it(`rejects invalid arguments without transport: ${JSON.stringify(argv)}`, async () => {
      const fetcher = vi.fn<typeof fetch>();
      const result = await invoke(argv, fetcher);
      expect(result).toEqual({
        code: 1,
        out: "",
        err: "GITLAB_ARGUMENTS_INVALID\n",
      });
      expect(fetcher).not.toHaveBeenCalled();
    });
  }

  it("returns safe optional absence when no API base is configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expectOptionalFailure(
      await invoke(args, fetcher, {}),
      "GITLAB_BASE_UNAVAILABLE",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  for (const base of [
    "http://gitlab.example.invalid/api/v4",
    "https://private:secret@gitlab.example.invalid/api/v4",
    "https://gitlab.example.invalid/api/v4?token=secret",
    "https://gitlab.example.invalid/api/v4#secret",
    "https://gitlab.example.invalid/wrong",
    "not a url",
    "https://gitlab.example.invalid\\api\\v4",
  ]) {
    it(`rejects unsafe API base without transport: ${base}`, async () => {
      const fetcher = vi.fn<typeof fetch>();
      expectOptionalFailure(
        await invoke([...args, "--api-url", base], fetcher),
        "GITLAB_BASE_INVALID",
      );
      expect(fetcher).not.toHaveBeenCalled();
    });
  }

  for (const status of [302, 403, 500]) {
    it(`returns optional failure for README HTTP ${status} without disclosing raw body`, async () => {
      const fetcher = fixture({
        readme: () =>
          new Response(`RAW_PRIVATE_BODY ${env.GITLAB_PAT}`, {
            status,
            headers: { Location: "https://other.example.invalid/" },
          }),
      });
      expectOptionalFailure(
        await invoke(args, fetcher),
        "GITLAB_README_FAILED",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }

  for (const metadata of [
    { redirected: true, url: "https://other.example.invalid/RAW_PRIVATE_BODY" },
    {
      redirected: false,
      url: "https://other.example.invalid/RAW_PRIVATE_BODY",
    },
  ]) {
    it("rejects followed redirects or unexpected response URLs from injected transport", async () => {
      const fetcher = fixture({
        readme: () => {
          const response = Response.json({
            encoding: "base64",
            content: Buffer.from(readme).toString("base64"),
          });
          Object.defineProperties(response, {
            redirected: { value: metadata.redirected },
            url: { value: metadata.url },
          });
          return response;
        },
      });
      expectOptionalFailure(
        await invoke(args, fetcher),
        "GITLAB_README_FAILED",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }

  it("sanitizes thrown transport errors", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error(`RAW_PRIVATE_BODY ${env.GITLAB_PAT}`)),
    );
    expectOptionalFailure(await invoke(args, fetcher), "GITLAB_README_FAILED");
  });

  for (const value of [
    null,
    { encoding: "text", content: "RAW_PRIVATE_BODY" },
    { encoding: "base64", content: "%%%" },
    { encoding: "base64", content: "YQ=" },
    { encoding: "base64", content: "/w==" },
  ]) {
    it(`rejects malformed README metadata: ${JSON.stringify(value)}`, async () => {
      expectOptionalFailure(
        await invoke(args, fixture({ readme: () => Response.json(value) })),
        "GITLAB_README_FAILED",
      );
    });
  }

  it("rejects malformed response JSON without disclosing it", async () => {
    expectOptionalFailure(
      await invoke(
        args,
        fixture({ readme: () => new Response("RAW_PRIVATE_BODY") }),
      ),
      "GITLAB_README_FAILED",
    );
  });

  for (const response of [
    () => new Response("RAW_PRIVATE_BODY", { status: 403 }),
    () => Response.json({ merge_requests: [] }),
    () => Response.json([null]),
    () => Response.json(Array.from({ length: 11 }, () => ({ id: 1 }))),
  ]) {
    it("drops already-collected README when MR enrichment fails", async () => {
      const fetcher = fixture({ mrs: response });
      expectOptionalFailure(
        await invoke(args, fetcher),
        "GITLAB_MERGE_REQUESTS_FAILED",
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  }

  for (const next of ["1", "0", "-1", "two", "2.5", "02", "9007199254740992"]) {
    it(`rejects malformed/nonincreasing pagination: ${next}`, async () => {
      expectOptionalFailure(
        await invoke(
          args,
          fixture({
            tree: () =>
              Response.json(firstTree, { headers: { "X-Next-Page": next } }),
          }),
        ),
        "GITLAB_TREE_FAILED",
      );
    });
  }

  it("rejects repeated continuation on the second tree page without partial JSON", async () => {
    const fetcher = fixture({
      tree: () => Response.json(firstTree, { headers: { "X-Next-Page": "2" } }),
    });
    expectOptionalFailure(await invoke(args, fetcher), "GITLAB_TREE_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects empty pages with contradictory continuation", async () => {
    expectOptionalFailure(
      await invoke(
        args,
        fixture({
          tree: () => Response.json([], { headers: { "X-Next-Page": "2" } }),
        }),
      ),
      "GITLAB_TREE_FAILED",
    );
  });

  it("drops all partial context when a later tree page is denied", async () => {
    const fetcher = fixture({
      tree: (page) =>
        page === "1"
          ? Response.json(firstTree, { headers: { "X-Next-Page": "2" } })
          : new Response("RAW_PRIVATE_BODY", { status: 403 }),
    });
    expectOptionalFailure(await invoke(args, fetcher), "GITLAB_TREE_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  for (const value of [
    { tree: [] },
    [null],
    [{ type: "blob" }],
    [{ path: "file", type: "other" }],
  ]) {
    it(`rejects malformed tree records: ${JSON.stringify(value)}`, async () => {
      expectOptionalFailure(
        await invoke(args, fixture({ tree: () => Response.json(value) })),
        "GITLAB_TREE_FAILED",
      );
    });
  }
});
