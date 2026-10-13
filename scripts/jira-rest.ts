import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;
type ActionSpec = {
  required: readonly string[];
  optional?: readonly string[];
  write?: boolean;
};
const actions: Record<string, ActionSpec> = {
  search: { required: ["jql", "fields"], optional: ["limit"] },
  issue: { required: ["key", "fields"], optional: ["comments", "changelog"] },
  "remote-links": { required: ["key"] },
  transitions: { required: ["key"] },
  "issue-link-types": { required: [] },
  "user-search": { required: ["query"] },
  "set-fix-versions": { required: ["key", "versions-json"], write: true },
  "set-components": { required: ["key", "components-json"], write: true },
  transition: { required: ["key", "transition-id"], write: true },
  "create-issue": { required: ["body-file"], write: true },
  "link-issues": { required: ["body-file"], write: true },
};
const switches: Record<string, boolean> = {
  comments: true,
  changelog: true,
  approved: true,
};
const valueFlags: Record<string, boolean> = {
  site: true,
  jql: true,
  fields: true,
  limit: true,
  key: true,
  query: true,
  "versions-json": true,
  "components-json": true,
  "transition-id": true,
  "body-file": true,
};
const blockNodes: Record<string, boolean> = {
  paragraph: true,
  heading: true,
  listItem: true,
  codeBlock: true,
  tableRow: true,
};
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const NUMERIC_ID = /^\d+$/;
const own = (value: object, key: string): boolean => Object.hasOwn(value, key);

class JiraError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
  }
}
function invalid(code = "JIRA_RESPONSE_INVALID"): never {
  throw new JiraError(code);
}
function object(value: unknown, code?: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(code);
  return value as JsonObject;
}
function array(value: unknown, code?: string): unknown[] {
  if (!Array.isArray(value)) invalid(code);
  return value;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function exact(value: unknown, keys: readonly string[]): JsonObject {
  const result = object(value, "JIRA_BODY_UNSAFE");
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !own(result, key))
  )
    invalid("JIRA_BODY_UNSAFE");
  return result;
}
function positive(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    invalid("JIRA_ARGUMENTS_INVALID");
  return Number(value);
}
function hostname(value: string): string {
  if (
    value.length > 253 ||
    isIP(value) ||
    /^[\d.]+$/.test(value) ||
    !value
      .split(".")
      .every(
        (label) =>
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      )
  )
    invalid("JIRA_ARGUMENTS_INVALID");
  const host = value.toLowerCase();
  if (new URL(`https://${host}`).hostname !== host)
    invalid("JIRA_ARGUMENTS_INVALID");
  return host;
}

function parse(argv: string[]): {
  action: string;
  flags: Record<string, string>;
} {
  let action = "";
  const flags: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (action || !own(actions, arg)) invalid("JIRA_ARGUMENTS_INVALID");
      action = arg;
      continue;
    }
    const name = arg.slice(2);
    if (own(flags, name)) invalid("JIRA_ARGUMENTS_INVALID");
    if (own(switches, name)) flags[name] = "true";
    else if (own(valueFlags, name)) {
      const value = argv[++index];
      if (!nonempty(value) || value.startsWith("--"))
        invalid("JIRA_ARGUMENTS_INVALID");
      flags[name] = value;
    } else invalid("JIRA_ARGUMENTS_INVALID");
  }
  if (!action || !flags.site) invalid("JIRA_ARGUMENTS_INVALID");
  const spec = actions[action];
  const allowed = [
    "site",
    ...spec.required,
    ...(spec.optional ?? []),
    ...(spec.write ? ["approved"] : []),
  ];
  if (
    Object.keys(flags).some((flag) => !allowed.includes(flag)) ||
    spec.required.some((flag) => !flags[flag])
  )
    invalid("JIRA_ARGUMENTS_INVALID");
  flags.site = hostname(flags.site);
  if (
    flags.key &&
    !(ISSUE_KEY.test(flags.key) || (!spec.write && NUMERIC_ID.test(flags.key)))
  )
    invalid("JIRA_ARGUMENTS_INVALID");
  if (
    flags.fields &&
    !flags.fields.split(",").every((field) => /^[a-z][a-z0-9_]*$/i.test(field))
  )
    invalid("JIRA_ARGUMENTS_INVALID");
  if (flags.limit) positive(flags.limit);
  if (flags["transition-id"] && !NUMERIC_ID.test(flags["transition-id"]))
    invalid("JIRA_ARGUMENTS_INVALID");
  if (spec.write && !flags.approved) invalid("JIRA_APPROVAL_REQUIRED");
  return { action, flags };
}

type Rendered = { text: string; startsBlock: boolean; endsBlock: boolean };
function adfNode(value: unknown): Rendered {
  const node = object(value);
  if (!nonempty(node.type)) invalid();
  const type = node.type;
  if (node.attrs !== undefined) object(node.attrs);
  if (node.text !== undefined && typeof node.text !== "string") invalid();
  const content = node.content === undefined ? [] : array(node.content);
  let text = "";
  let startsBlock = false;
  let endsBlock = false;
  for (const child of content) {
    const rendered = adfNode(child);
    if (
      text &&
      rendered.text &&
      (endsBlock || rendered.startsBlock) &&
      !text.endsWith("\n") &&
      !rendered.text.startsWith("\n")
    )
      text += "\n";
    if (!text && rendered.text) startsBlock = rendered.startsBlock;
    text += rendered.text;
    if (rendered.text) endsBlock = rendered.endsBlock;
  }
  if (type === "text") {
    if (typeof node.text !== "string" || content.length) invalid();
    text = node.text;
  } else if (type === "hardBreak") text = "\n";
  else if (type === "mention" || type === "status") {
    const attrs = object(node.attrs);
    if (!nonempty(attrs.text)) invalid();
    text = attrs.text;
  } else if (type === "inlineCard") {
    const attrs = object(node.attrs);
    if (!nonempty(attrs.url)) invalid();
    text = attrs.url;
  } else if (type === "link") {
    const attrs = object(node.attrs);
    if (!nonempty(attrs.href)) invalid();
    if (!text) text = attrs.href;
    else if (!text.includes(attrs.href)) text += ` (${attrs.href})`;
  }
  if (node.marks !== undefined) {
    for (const value of array(node.marks)) {
      const mark = object(value);
      if (!nonempty(mark.type)) invalid();
      if (mark.attrs !== undefined) object(mark.attrs);
      if (mark.type === "link") {
        const href = object(mark.attrs).href;
        if (!nonempty(href)) invalid();
        if (!text.includes(href)) text += ` (${href})`;
      }
    }
  }
  if (own(blockNodes, type)) startsBlock = endsBlock = true;
  return { text, startsBlock, endsBlock };
}

/** Normalize only Jira's text boundaries; leave all other issue fields native. */
export function adfToText(value: unknown): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  const doc = object(value);
  if (
    doc.type !== "doc" ||
    !Array.isArray(doc.content) ||
    (doc.version !== undefined && doc.version !== 1)
  )
    invalid();
  return adfNode(doc).text;
}
function normalizeComment(value: unknown): JsonObject {
  const comment = object(value);
  if (!own(comment, "body")) invalid();
  comment.body = adfToText(comment.body);
  return comment;
}
function normalizeIssue(value: unknown): JsonObject {
  const issue = object(value);
  if (typeof issue.key !== "string" || !ISSUE_KEY.test(issue.key)) invalid();
  const fields = object(issue.fields);
  if (own(fields, "description"))
    fields.description = adfToText(fields.description);
  if (own(fields, "comment")) {
    const comment = object(fields.comment);
    if (own(comment, "comments"))
      comment.comments = array(comment.comments).map(normalizeComment);
  }
  return issue;
}

function names(
  value: unknown,
  allowId: boolean,
  requireEntries: boolean,
): void {
  const entries = array(value, "JIRA_BODY_UNSAFE");
  if (requireEntries && !entries.length) invalid("JIRA_BODY_UNSAFE");
  for (const entry of entries) {
    const record = object(entry, "JIRA_BODY_UNSAFE");
    const keys = Object.keys(record);
    if (
      keys.length !== 1 ||
      (keys[0] !== "name" && !(allowId && keys[0] === "id")) ||
      !nonempty(record[keys[0]])
    )
      invalid("JIRA_BODY_UNSAFE");
  }
}
function validateAdf(value: unknown): void {
  const doc = exact(value, ["version", "type", "content"]);
  if (doc.version !== 1 || doc.type !== "doc" || !Array.isArray(doc.content))
    invalid("JIRA_BODY_UNSAFE");
  const visit = (value: unknown): void => {
    const node = object(value, "JIRA_BODY_UNSAFE");
    if (
      !nonempty(node.type) ||
      Object.keys(node).some(
        (key) => !["type", "text", "content", "attrs", "marks"].includes(key),
      )
    )
      invalid("JIRA_BODY_UNSAFE");
    if (node.text !== undefined && typeof node.text !== "string")
      invalid("JIRA_BODY_UNSAFE");
    if (node.type === "text" && typeof node.text !== "string")
      invalid("JIRA_BODY_UNSAFE");
    if (node.attrs !== undefined) object(node.attrs, "JIRA_BODY_UNSAFE");
    if (node.content !== undefined)
      for (const child of array(node.content, "JIRA_BODY_UNSAFE")) visit(child);
    if (node.marks !== undefined)
      for (const value of array(node.marks, "JIRA_BODY_UNSAFE")) {
        const mark = object(value, "JIRA_BODY_UNSAFE");
        if (
          !nonempty(mark.type) ||
          Object.keys(mark).some((key) => key !== "type" && key !== "attrs")
        )
          invalid("JIRA_BODY_UNSAFE");
        if (mark.attrs !== undefined) object(mark.attrs, "JIRA_BODY_UNSAFE");
      }
  };
  for (const child of doc.content) visit(child);
}
function validateBody(action: string, value: unknown): JsonObject {
  if (action === "link-issues") {
    const body = exact(value, ["type", "inwardIssue", "outwardIssue"]);
    if (exact(body.type, ["name"]).name !== "Relates")
      invalid("JIRA_BODY_UNSAFE");
    for (const field of ["inwardIssue", "outwardIssue"]) {
      const key = exact(body[field], ["key"]).key;
      if (typeof key !== "string" || !ISSUE_KEY.test(key))
        invalid("JIRA_BODY_UNSAFE");
    }
    return body;
  }
  const body = exact(value, ["fields"]);
  const fields = exact(body.fields, [
    "project",
    "issuetype",
    "summary",
    "description",
    "components",
    "labels",
  ]);
  const project = exact(fields.project, ["key"]).key;
  if (
    typeof project !== "string" ||
    !/^[A-Z][A-Z0-9_]*$/.test(project) ||
    !nonempty(exact(fields.issuetype, ["name"]).name) ||
    !nonempty(fields.summary)
  )
    invalid("JIRA_BODY_UNSAFE");
  validateAdf(fields.description);
  names(fields.components, false, false);
  if (
    array(fields.labels, "JIRA_BODY_UNSAFE").some((label) => !nonempty(label))
  )
    invalid("JIRA_BODY_UNSAFE");
  return body;
}
async function privateBody(path: string): Promise<unknown> {
  try {
    const bodyPath = resolve(path);
    for (let ancestor = dirname(bodyPath); ; ancestor = dirname(ancestor)) {
      const entry = await lstat(ancestor);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        invalid("JIRA_BODY_UNSAFE");
      if (ancestor === dirname(ancestor)) break;
    }
    const file = await open(
      bodyPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await file.stat();
      const uid = process.getuid?.();
      const privateFile = (stat: typeof before): boolean =>
        stat.isFile() &&
        uid !== undefined &&
        stat.uid === uid &&
        stat.nlink === 1 &&
        (stat.mode & 0o7777) === 0o600;
      if (!privateFile(before)) invalid("JIRA_BODY_UNSAFE");
      const bytes = await file.readFile();
      const after = await file.stat();
      if (
        !privateFile(after) ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        invalid("JIRA_BODY_UNSAFE");
      const text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes)) invalid("JIRA_BODY_UNSAFE");
      return JSON.parse(text) as unknown;
    } finally {
      await file.close();
    }
  } catch {
    invalid("JIRA_BODY_UNSAFE");
  }
}

function metadata(
  page: JsonObject,
  key: string,
  minimum: number,
): number | undefined {
  if (page[key] === undefined) return undefined;
  const value = page[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    invalid();
  return value;
}
function lastFlag(page: JsonObject): boolean | undefined {
  if (page.isLast !== undefined && typeof page.isLast !== "boolean") invalid();
  return page.isLast;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

type Request = (
  path: string,
  method?: string,
  body?: unknown,
  query?: Record<string, string>,
) => Promise<unknown>;
async function history(
  request: Request,
  path: string,
  field: string,
  normalize: (entry: unknown) => JsonObject,
): Promise<unknown[]> {
  const records: unknown[] = [];
  let startAt = 0;
  while (true) {
    const page = object(
      await request(path, "GET", undefined, {
        startAt: String(startAt),
        maxResults: "100",
      }),
    );
    const entries = array(page[field]);
    const offset = metadata(page, "startAt", 0);
    const total = metadata(page, "total", 0);
    const size = metadata(page, "maxResults", 1) ?? 100;
    const last = lastFlag(page);
    const next = startAt + entries.length;
    if (
      (offset !== undefined && offset !== startAt) ||
      !Number.isSafeInteger(next) ||
      entries.length > size ||
      (total !== undefined && next > total)
    )
      invalid("JIRA_PAGINATION_INVALID");
    const remaining = total !== undefined && next < total;
    if (
      (last === true && remaining) ||
      (last === false && total !== undefined && !remaining) ||
      (!entries.length && (remaining || last === false))
    )
      invalid("JIRA_PAGINATION_INVALID");
    records.push(...entries.map(normalize));
    if (
      last === true ||
      (total !== undefined && !remaining) ||
      (!remaining && last !== false && entries.length < size)
    )
      return records;
    if (next <= startAt) invalid("JIRA_PAGINATION_INVALID");
    startAt = next;
  }
}
async function execute(
  action: string,
  flags: Record<string, string>,
  request: Request,
  body?: unknown,
): Promise<unknown> {
  const issuePath = flags.key
    ? `/rest/api/3/issue/${encodeURIComponent(flags.key)}`
    : "";
  switch (action) {
    case "search": {
      const issues: JsonObject[] = [];
      const limit = flags.limit ? positive(flags.limit) : undefined;
      const tokens = new Set<string>();
      let nextPageToken: string | undefined;
      while (true) {
        const page = object(
          await request("/rest/api/3/search/jql", "POST", {
            jql: flags.jql,
            fields: flags.fields.split(","),
            maxResults:
              limit === undefined ? 100 : Math.min(100, limit - issues.length),
            ...(nextPageToken === undefined ? {} : { nextPageToken }),
          }),
        );
        const entries = array(page.issues).map(normalizeIssue);
        issues.push(
          ...(limit === undefined
            ? entries
            : entries.slice(0, limit - issues.length)),
        );
        const last = lastFlag(page);
        if (
          page.nextPageToken !== undefined &&
          page.nextPageToken !== null &&
          typeof page.nextPageToken !== "string"
        )
          invalid();
        if (limit !== undefined && issues.length === limit) return { issues };
        if (last === true) return { issues };
        const token = page.nextPageToken;
        if (!nonempty(token)) {
          if (last === false) invalid("JIRA_PAGINATION_INVALID");
          return { issues };
        }
        if (tokens.has(token)) invalid("JIRA_PAGINATION_INVALID");
        tokens.add(token);
        nextPageToken = token;
      }
    }
    case "issue": {
      const issue = normalizeIssue(
        await request(issuePath, "GET", undefined, { fields: flags.fields }),
      );
      const fields = object(issue.fields);
      if (flags.comments) {
        const comments = await history(
          request,
          `${issuePath}/comment`,
          "comments",
          normalizeComment,
        );
        const comment = own(fields, "comment") ? object(fields.comment) : {};
        comment.comments = comments;
        fields.comment = comment;
      }
      if (flags.changelog) {
        const histories = await history(
          request,
          `${issuePath}/changelog`,
          "values",
          (value) => {
            const entry = object(value);
            array(entry.items).forEach((item) => {
              if (!nonempty(object(item).field)) invalid();
            });
            return entry;
          },
        );
        const changelog =
          issue.changelog === undefined ? {} : object(issue.changelog);
        changelog.histories = histories;
        issue.changelog = changelog;
      }
      return issue;
    }
    case "remote-links":
      return array(await request(`${issuePath}/remotelink`)).map((value) => {
        const entry = object(value);
        if (!nonempty(object(entry.object).url)) invalid();
        return entry;
      });
    case "transitions": {
      const result = object(await request(`${issuePath}/transitions`));
      array(result.transitions).forEach((value) => {
        const entry = object(value);
        if (
          !nonempty(entry.id) ||
          !nonempty(entry.name) ||
          !nonempty(object(entry.to).name)
        )
          invalid();
      });
      return result;
    }
    case "issue-link-types": {
      const result = object(await request("/rest/api/3/issueLinkType"));
      array(result.issueLinkTypes).forEach((value) => {
        const entry = object(value);
        if (
          !nonempty(entry.id) ||
          !nonempty(entry.name) ||
          !nonempty(entry.inward) ||
          !nonempty(entry.outward)
        )
          invalid();
      });
      return result;
    }
    case "user-search": {
      const users: unknown[] = [];
      let startAt = 0;
      while (true) {
        const page = array(
          await request("/rest/api/3/user/search", "GET", undefined, {
            query: flags.query,
            startAt: String(startAt),
            maxResults: "100",
          }),
        );
        page.forEach((value) => {
          const entry = object(value);
          if (!nonempty(entry.accountId) || !nonempty(entry.displayName))
            invalid();
        });
        users.push(...page);
        if (page.length < 100) return users;
        startAt += page.length;
        if (!Number.isSafeInteger(startAt)) invalid("JIRA_PAGINATION_INVALID");
      }
    }
    case "set-fix-versions":
      return request(issuePath, "PUT", { fields: { fixVersions: body } });
    case "set-components":
      return request(issuePath, "PUT", { fields: { components: body } });
    case "transition":
      return request(`${issuePath}/transitions`, "POST", {
        transition: { id: flags["transition-id"] },
      });
    case "create-issue":
      return request("/rest/api/3/issue", "POST", body);
    case "link-issues":
      return request("/rest/api/3/issueLink", "POST", body);
    default:
      return invalid("JIRA_ARGUMENTS_INVALID");
  }
}

export async function main(
  argv = process.argv.slice(2),
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let operation = "arguments";
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      process.stdout.write(
        `${JSON.stringify({ usage: "jira-rest --site HOST ACTION [action flags]", actions: Object.keys(actions), authentication: "JIRA_EMAIL and JIRA_API_TOKEN environment variables; writes require --approved" })}\n`,
      );
      return 0;
    }
    const { action, flags } = parse(argv);
    operation = action;
    let body: unknown;
    if (action === "set-fix-versions" || action === "set-components") {
      try {
        body = JSON.parse(
          flags[
            action === "set-fix-versions" ? "versions-json" : "components-json"
          ],
        ) as unknown;
      } catch {
        invalid("JIRA_BODY_UNSAFE");
      }
      names(body, action === "set-fix-versions", true);
    } else if (flags["body-file"])
      body = validateBody(action, await privateBody(flags["body-file"]));
    if (
      !nonempty(env.JIRA_EMAIL) ||
      !nonempty(env.JIRA_API_TOKEN) ||
      hasControlCharacter(env.JIRA_EMAIL) ||
      env.JIRA_EMAIL.includes(":") ||
      hasControlCharacter(env.JIRA_API_TOKEN)
    )
      invalid("JIRA_AUTH_UNAVAILABLE");
    const authorization = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`;
    const request: Request = async (path, method = "GET", body, query) => {
      const url = new URL(path, `https://${flags.site}`);
      if (query) url.search = new URLSearchParams(query).toString();
      let response: Response;
      try {
        response = await fetcher(url.href, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: {
            Accept: "application/json",
            Authorization: authorization,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        invalid("JIRA_ACCESS_FAILED");
      }
      if (response.redirected || (response.url && response.url !== url.href))
        invalid("JIRA_ACCESS_FAILED");
      if (!response.ok)
        throw new JiraError("JIRA_HTTP_FAILED", response.status);
      if (actions[action].write && response.status === 204) return {};
      if (action === "link-issues" && response.status === 201) return {};
      let value: unknown;
      try {
        value = (await response.json()) as unknown;
      } catch {
        invalid("JIRA_RESPONSE_INVALID");
      }
      if (actions[action].write) object(value);
      return value;
    };
    const result = await execute(action, flags, request, body);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const safe =
      error instanceof JiraError
        ? error
        : new JiraError("JIRA_OPERATION_FAILED");
    process.stderr.write(
      `jira-rest ${operation}: ${safe.code}${safe.status === undefined ? "" : ` (HTTP ${safe.status})`}\n`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
