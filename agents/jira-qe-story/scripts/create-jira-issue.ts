import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface QEStoryDraft {
  source_key: string;
  summary: string;
  description: string;
  acceptance_criteria: string;
  test_scenarios: string;
  automation_suggestions?: string;
  issue_type: string;
  priority: string;
  labels: string[];
  components: string[];
  story_points: number | null;
  assignee_account_id: string;
  target_project_key: string;
}

interface JiraConfig {
  jira: { cloud_id: string; base_url: string; user_email: string };
}

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function textNode(text: string, bold = false): AdfNode {
  const node: AdfNode = { type: "text", text };
  if (bold) node.marks = [{ type: "strong" }];
  return node;
}

function paragraph(nodes: AdfNode[]): AdfNode {
  return { type: "paragraph", content: nodes };
}

function heading(level: number, text: string): AdfNode {
  return {
    type: "heading",
    attrs: { level },
    content: [textNode(text)],
  };
}

function listItem(text: string): AdfNode {
  return {
    type: "listItem",
    content: [paragraph([textNode(text)])],
  };
}

export function markdownToAdf(md: string): AdfNode[] {
  const lines = md.split("\n");
  const nodes: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      nodes.push(heading(headingMatch[1].length, headingMatch[2]));
      i++;
      continue;
    }

    const numberedMatch = line.match(/^\d+\.\s+(.*)/);
    if (numberedMatch) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^\d+\.\s+(.*)/);
        if (m) items.push(listItem(m[1]));
        i++;
      }
      nodes.push({ type: "orderedList", content: items });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^[-*]\s+(.*)/);
        if (m) items.push(listItem(m[1]));
        i++;
      }
      nodes.push({ type: "bulletList", content: items });
      continue;
    }

    const inlineNodes = parseInlineMarkdown(line);
    nodes.push(paragraph(inlineNodes));
    i++;
  }

  return nodes;
}

export function parseInlineMarkdown(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(textNode(text.slice(lastIndex, match.index)));
    }
    if (match[1]) {
      nodes.push(textNode(match[1], true));
    } else if (match[2] && match[3]) {
      nodes.push({
        type: "text",
        text: match[2],
        marks: [{ type: "link", attrs: { href: match[3] } }],
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(textNode(text.slice(lastIndex)));
  }

  return nodes;
}

export function buildIssuePayload(
  draft: QEStoryDraft,
): Record<string, unknown> {
  const fullDescription = [
    draft.description,
    "\n## Acceptance Criteria\n",
    draft.acceptance_criteria,
    "\n## Test Scenarios\n",
    draft.test_scenarios,
  ].join("\n");

  const adfContent = markdownToAdf(fullDescription);

  const fields: Record<string, unknown> = {
    project: { key: draft.target_project_key },
    issuetype: { name: draft.issue_type },
    summary: draft.summary,
    description: { version: 1, type: "doc", content: adfContent },
    priority: { name: draft.priority },
    labels: draft.labels,
    components: draft.components.map((c) => ({ name: c })),
  };

  if (draft.assignee_account_id) {
    fields.assignee = { accountId: draft.assignee_account_id };
  }
  if (draft.story_points !== null) {
    fields.customfield_10028 = draft.story_points;
  }

  return { fields };
}

function getAuth(config: JiraConfig): string {
  const token = process.env.JIRA_API_TOKEN;
  if (!token) {
    console.error("JIRA_API_TOKEN environment variable is not set.");
    console.error(
      "Get one from: https://id.atlassian.com/manage-profile/security/api-tokens",
    );
    process.exit(2);
  }
  return Buffer.from(`${config.jira.user_email}:${token}`).toString("base64");
}

async function jiraFetch(
  baseUrl: string,
  path: string,
  auth: string,
  body: unknown,
  method: "POST" | "PUT" = "POST",
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { ok: res.ok, status: res.status, data };
}

export interface CliArgs {
  help: boolean;
  dryRun: boolean;
  updateKey: string | null;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = { help: false, dryRun: false, updateKey: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") result.help = true;
    else if (argv[i] === "--dry-run") result.dryRun = true;
    else if (argv[i] === "--update" && i + 1 < argv.length)
      result.updateKey = argv[++i];
  }
  return result;
}

async function postAutomationComment(
  baseUrl: string,
  auth: string,
  issueKey: string,
  suggestions: string,
): Promise<void> {
  console.log("Posting automation suggestions as comment...");
  const commentAdf = markdownToAdf(
    `## Automation Suggestions\n\n${suggestions}`,
  );
  const commentRes = await jiraFetch(
    baseUrl,
    `/rest/api/3/issue/${issueKey}/comment`,
    auth,
    { body: { version: 1, type: "doc", content: commentAdf } },
  );
  if (!commentRes.ok) {
    console.error(`Warning: comment failed (${String(commentRes.status)})`);
  } else {
    console.log("Automation suggestions posted.");
  }
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.help) {
    console.log(
      [
        "Usage: create-jira-issue.ts [--update <KEY>] [--dry-run] [--help]",
        "",
        "Reads data/cache/qe-story-draft.json and creates or updates a QE story in Jira.",
        "Requires JIRA_API_TOKEN env var and jira.user_email in config.",
        "",
        "Modes:",
        "  (default)          Create a new issue, link it, post automation comment",
        "  --update <KEY>     Update an existing issue's description + post automation comment",
        "  --dry-run          Preview the payload without calling the API",
        "",
        "Exit codes:",
        "  0 — success",
        "  1 — API error",
        "  2 — missing config, draft, or token",
      ].join("\n"),
    );
    process.exit(0);
  }

  const dataDir = resolve(import.meta.dirname, "../data");
  const draftPath = resolve(dataDir, "cache/qe-story-draft.json");
  const configPath = resolve(dataDir, "qe-config.json");

  if (!existsSync(draftPath)) {
    console.error(`Draft not found: ${draftPath}`);
    process.exit(2);
  }
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(2);
  }

  const draft = JSON.parse(readFileSync(draftPath, "utf-8")) as QEStoryDraft;
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as JiraConfig;

  if (!config.jira.user_email) {
    console.error("jira.user_email is required in qe-config.json");
    process.exit(2);
  }

  const payload = buildIssuePayload(draft);
  const fields = payload.fields as Record<string, unknown>;
  const baseUrl = config.jira.base_url;
  const isUpdate = cliArgs.updateKey !== null;

  if (cliArgs.dryRun) {
    if (isUpdate) {
      console.log(
        `=== DRY RUN — would PUT to /rest/api/3/issue/${cliArgs.updateKey} ===`,
      );
      console.log(
        JSON.stringify(
          { fields: { description: fields.description } },
          null,
          2,
        ),
      );
    } else {
      console.log("=== DRY RUN — would POST to /rest/api/3/issue ===");
      console.log(JSON.stringify(payload, null, 2));
      console.log(`\n=== Would link: ${draft.source_key} (Cloners) ===`);
    }
    if (draft.automation_suggestions) {
      console.log("=== Would post automation suggestions as comment ===");
    }
    process.exit(0);
  }

  const auth = getAuth(config);

  if (isUpdate) {
    const updateKey = cliArgs.updateKey as string;
    console.log(`Updating ${updateKey}...`);

    const updatePayload = {
      fields: { description: fields.description },
    };
    const updateRes = await jiraFetch(
      baseUrl,
      `/rest/api/3/issue/${updateKey}`,
      auth,
      updatePayload,
      "PUT",
    );
    if (!updateRes.ok) {
      console.error(`Update failed (${String(updateRes.status)}):`);
      console.error(JSON.stringify(updateRes.data, null, 2));
      process.exit(1);
    }
    console.log(`Updated: ${updateKey}`);
    console.log(`Link: ${baseUrl}/browse/${updateKey}`);

    if (draft.automation_suggestions) {
      await postAutomationComment(
        baseUrl,
        auth,
        updateKey,
        draft.automation_suggestions,
      );
    }

    console.log(`\nDone. ${updateKey} — ${baseUrl}/browse/${updateKey}`);
  } else {
    console.log(`Creating QE story in ${draft.target_project_key}...`);
    const createRes = await jiraFetch(
      baseUrl,
      "/rest/api/3/issue",
      auth,
      payload,
    );
    if (!createRes.ok) {
      console.error(`Issue creation failed (${String(createRes.status)}):`);
      console.error(JSON.stringify(createRes.data, null, 2));
      process.exit(1);
    }

    const createdKey = createRes.data.key as string;
    console.log(`Created: ${createdKey}`);
    console.log(`Link: ${baseUrl}/browse/${createdKey}`);

    console.log(`Linking ${createdKey} → ${draft.source_key} (Cloners)...`);
    const linkRes = await jiraFetch(baseUrl, "/rest/api/3/issueLink", auth, {
      type: { name: "Cloners" },
      inwardIssue: { key: createdKey },
      outwardIssue: { key: draft.source_key },
    });
    if (!linkRes.ok) {
      console.error(
        `Warning: linking failed (${String(linkRes.status)}): ${JSON.stringify(linkRes.data)}`,
      );
    } else {
      console.log(`Linked: ${createdKey} clones ${draft.source_key}`);
    }

    if (draft.automation_suggestions) {
      await postAutomationComment(
        baseUrl,
        auth,
        createdKey,
        draft.automation_suggestions,
      );
    }

    console.log(`\nDone. ${createdKey} — ${baseUrl}/browse/${createdKey}`);
  }
}

const isDirectRun = process.argv[1]?.endsWith("create-jira-issue.ts");
if (isDirectRun) void main();
