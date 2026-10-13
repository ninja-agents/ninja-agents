import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELP =
  "Usage: gitlab-read qe-context --project OWNER/REPO --issue-key KEY [--api-url HTTPS_API_BASE]\nGitLab base: --api-url or GITLAB_API_URL; optional auth: GITLAB_PAT.\n";
const FLAGS: Record<string, string> = {
  "--project": "project",
  "--issue-key": "issueKey",
  "--api-url": "apiUrl",
};

type Options = { project: string; issueKey: string; apiUrl?: string };
type Context = { readme: string; merge_requests: unknown[]; tree: unknown[] };

class SourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parse(argv: string[]): Options | null {
  if (argv.length === 1 && argv[0] === "--help") return null;
  if (argv[0] !== "qe-context") throw new Error();
  const values: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    const name = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : undefined;
    const value = argv[i + 1];
    if (
      !name ||
      Object.hasOwn(values, name) ||
      !value ||
      value.startsWith("--") ||
      hasControlCharacter(value)
    )
      throw new Error();
    values[name] = value;
  }
  if (
    !values.project ||
    !values.issueKey ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(values.project) ||
    values.project.split("/").some((part) => part === "." || part === "..") ||
    !/^[A-Z][A-Z0-9_]*-\d+$/.test(values.issueKey)
  )
    throw new Error();
  return {
    project: values.project,
    issueKey: values.issueKey,
    apiUrl: values.apiUrl,
  };
}

function apiBase(value: string | undefined): URL {
  if (!value) throw new SourceError("GITLAB_BASE_UNAVAILABLE");
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      /[?#\s\\]/.test(value) ||
      !/^\/api\/v4\/?$/.test(url.pathname)
    )
      throw new Error();
    url.pathname = "/api/v4/";
    return url;
  } catch {
    throw new SourceError("GITLAB_BASE_INVALID");
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): unknown[] {
  if (!Array.isArray(value) || !value.every(object)) throw new Error();
  return value;
}

function readmeText(value: unknown): string {
  if (
    !object(value) ||
    value.encoding !== "base64" ||
    typeof value.content !== "string"
  )
    throw new Error();
  const encoded = value.content.replace(/[\r\n]/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function context(
  options: Options,
  fetcher: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<Context> {
  const base = apiBase(options.apiUrl ?? env.GITLAB_API_URL);
  const project = `projects/${encodeURIComponent(options.project)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.GITLAB_PAT) headers["PRIVATE-TOKEN"] = env.GITLAB_PAT;

  async function request(
    path: string,
    query: Record<string, string>,
    code: string,
  ): Promise<{ value: unknown; response: Response }> {
    try {
      const url = new URL(path, base);
      url.search = new URLSearchParams(query).toString();
      const response = await fetcher(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (
        !response.ok ||
        response.redirected ||
        (response.url && response.url !== url.href)
      )
        throw new Error();
      return { value: await response.json(), response };
    } catch {
      throw new SourceError(code);
    }
  }

  const readmeResponse = await request(
    `${project}/repository/files/README.md`,
    { ref: "HEAD" },
    "GITLAB_README_FAILED",
  );
  let readme: string;
  try {
    readme = readmeText(readmeResponse.value);
  } catch {
    throw new SourceError("GITLAB_README_FAILED");
  }

  const mrResponse = await request(
    `${project}/merge_requests`,
    { search: options.issueKey, scope: "all", per_page: "10" },
    "GITLAB_MERGE_REQUESTS_FAILED",
  );
  let mergeRequests: unknown[];
  try {
    mergeRequests = records(mrResponse.value);
    if (mergeRequests.length > 10) throw new Error();
  } catch {
    throw new SourceError("GITLAB_MERGE_REQUESTS_FAILED");
  }

  const tree: unknown[] = [];
  let page = 1;
  while (true) {
    const result = await request(
      `${project}/repository/tree`,
      { path: "", recursive: "true", per_page: "100", page: String(page) },
      "GITLAB_TREE_FAILED",
    );
    try {
      const entries = records(result.value);
      if (
        entries.length > 100 ||
        entries.some(
          (entry) =>
            !object(entry) ||
            typeof entry.path !== "string" ||
            !entry.path ||
            (entry.type !== "blob" && entry.type !== "tree"),
        )
      )
        throw new Error();
      tree.push(...entries);
      const next = result.response.headers.get("x-next-page");
      if (next !== null) {
        if (next === "") break;
        if (!/^[1-9]\d*$/.test(next)) throw new Error();
        const nextPage = Number(next);
        if (
          !Number.isSafeInteger(nextPage) ||
          nextPage <= page ||
          entries.length === 0
        )
          throw new Error();
        page = nextPage;
      } else {
        if (entries.length < 100) break;
        page += 1;
        if (!Number.isSafeInteger(page)) throw new Error();
      }
    } catch {
      throw new SourceError("GITLAB_TREE_FAILED");
    }
  }
  return { readme, merge_requests: mergeRequests, tree };
}

export async function main(
  argv = process.argv.slice(2),
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let options: Options | null;
  try {
    options = parse(argv);
  } catch {
    process.stderr.write("GITLAB_ARGUMENTS_INVALID\n");
    return 1;
  }
  if (options === null) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const result = await context(options, fetcher, env);
    process.stdout.write(
      `${JSON.stringify({ context: result, warnings: [] })}\n`,
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof SourceError ? error.code : "GITLAB_CONTEXT_FAILED";
    process.stdout.write(
      `${JSON.stringify({ context: null, warnings: [code] })}\n`,
    );
    return 3;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
