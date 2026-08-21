import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface ClosingPR {
  url: string;
  merged: boolean;
  baseRef: string;
  repoFullName: string;
}

export type ResolvedPRs = Record<string, ClosingPR[]>;

const BATCH_SIZE = 100;

const PR_FRAGMENT = `
  ... on PullRequest {
    url
    merged
    baseRefName
    baseRepository { nameWithOwner }
  }
`;

export function issueKey(ref: IssueRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

// Build a single batched GraphQL query: one aliased `search` per issue.
// s0, s1, s2, ... map directly to issues[0], issues[1], issues[2], ...
export function buildQuery(issues: IssueRef[]): string {
  if (issues.length === 0) return "{ __typename }";

  const parts = issues.map((ref, i) => {
    const q = `repo:${ref.owner}/${ref.repo} #${ref.number} is:pr is:merged`;
    return `s${i}: search(query: ${JSON.stringify(q)}, type: ISSUE, first: 10) {
      nodes { ${PR_FRAGMENT} }
    }`;
  });

  return `{ ${parts.join("\n")} }`;
}

// Parse the aliased response back into a map keyed by issueKey.
export function parseResponse(data: unknown, issues: IssueRef[]): ResolvedPRs {
  const result: ResolvedPRs = {};
  const dataObj = data as Record<string, unknown>;

  for (let i = 0; i < issues.length; i++) {
    const key = issueKey(issues[i]);
    result[key] = [];

    const bucket = dataObj[`s${i}`] as { nodes?: unknown[] } | undefined;
    if (!bucket?.nodes) continue;

    for (const node of bucket.nodes) {
      const pr = node as Record<string, unknown>;
      const merged = pr["merged"] as boolean | undefined;
      if (!merged) continue;

      const url = pr["url"] as string | undefined;
      const baseRef = pr["baseRefName"] as string | undefined;
      const baseRepo = pr["baseRepository"] as
        | { nameWithOwner?: string }
        | undefined;
      const repoFullName = baseRepo?.nameWithOwner ?? "";

      if (url && baseRef && repoFullName) {
        result[key].push({ url, merged: true, baseRef, repoFullName });
      }
    }
  }

  return result;
}

async function graphqlRequest(
  query: string,
  token: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(
      `GitHub GraphQL request failed: ${resp.status} ${resp.statusText}`,
    );
  }

  const json = (await resp.json()) as {
    data?: Record<string, unknown>;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL errors: ${messages}`);
  }

  return json.data ?? {};
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const issuesFile =
    get("--issues-file") ??
    resolve(import.meta.dirname, "../data/cache/issues.json");
  const outputFile =
    get("--output") ??
    resolve(import.meta.dirname, "../data/cache/resolved-prs.json");

  const token = process.env.GITHUB_PAT;
  if (!token) {
    console.error("Error: GITHUB_PAT environment variable is not set.");
    process.exit(2);
  }

  if (!existsSync(issuesFile)) {
    console.error(`Input file not found: ${issuesFile}`);
    process.exit(1);
  }

  const issues = JSON.parse(readFileSync(issuesFile, "utf-8")) as IssueRef[];

  if (issues.length === 0) {
    writeFileSync(outputFile, JSON.stringify({}));
    console.log("No issues to resolve.");
    process.exit(0);
  }

  const merged: ResolvedPRs = {};
  const batches = chunk(issues, BATCH_SIZE);

  for (const batch of batches) {
    const query = buildQuery(batch);
    const data = await graphqlRequest(query, token);
    const partial = parseResponse(data, batch);
    Object.assign(merged, partial);
  }

  writeFileSync(outputFile, JSON.stringify(merged, null, 2));

  const resolved = Object.values(merged).filter((prs) => prs.length > 0).length;
  const total = issues.length;
  console.log(
    `Resolved ${resolved}/${total} issues to merged PRs. Output: ${outputFile}`,
  );
}

const isDirectRun = process.argv[1]?.endsWith("resolve-github-issues.ts");
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error("Fatal:", String(err));
    process.exit(1);
  });
}
