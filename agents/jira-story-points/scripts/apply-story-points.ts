import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface JiraConfig {
  jira: {
    base_url: string;
    user_email: string;
    story_points_field: string;
  };
  estimation: {
    comment_prefix: string;
  };
}

interface EstimatedTicket {
  key: string;
  estimated_sp: number;
  confidence: string;
  reasoning: string;
  similar_tickets: string[];
}

interface HistoryEntry extends EstimatedTicket {
  estimated_at: string;
  applied: boolean;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: apply-story-points.ts --config <path> --estimates <path> [--dry-run]",
      );
      console.log(
        "\nApplies SP estimates to Jira tickets (comment + set field) and writes estimation history.",
      );
      process.exit(0);
    }
    if (argv[i] === "--dry-run") {
      args["dry-run"] = true;
    } else if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function loadConfig(configPath: string): JiraConfig {
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as JiraConfig;
}

function loadEstimates(estimatesPath: string): EstimatedTicket[] {
  if (!existsSync(estimatesPath)) {
    console.error(`Estimates file not found: ${estimatesPath}`);
    process.exit(1);
  }
  const data = JSON.parse(
    readFileSync(estimatesPath, "utf-8"),
  ) as EstimatedTicket[];
  if (!Array.isArray(data) || data.length === 0) {
    console.error("Estimates file is empty or not an array");
    process.exit(2);
  }
  return data;
}

function getAuth(config: JiraConfig): string {
  const token = process.env.JIRA_API_TOKEN;
  if (!token) {
    console.error("JIRA_API_TOKEN environment variable is not set.");
    console.error(
      "Get one from: https://id.atlassian.com/manage-profile/security/api-tokens",
    );
    process.exit(1);
  }
  if (!config.jira.user_email) {
    console.error(
      "jira.user_email is empty in config. Set your Jira email in config.json.",
    );
    process.exit(1);
  }
  return Buffer.from(`${config.jira.user_email}:${token}`).toString("base64");
}

async function jiraFetch(
  baseUrl: string,
  path: string,
  auth: string,
  body: unknown,
  method: "POST" | "PUT" = "PUT",
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

async function jiraGet(
  baseUrl: string,
  path: string,
  auth: string,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { ok: res.ok, status: res.status, data };
}

async function hasExistingComment(
  baseUrl: string,
  auth: string,
  issueKey: string,
  marker: string,
): Promise<boolean> {
  const result = await jiraGet(
    baseUrl,
    `/rest/api/3/issue/${issueKey}/comment`,
    auth,
  );
  if (!result.ok) return false;
  const comments =
    (result.data as { comments?: Array<{ body?: unknown }> }).comments ?? [];
  return comments.some((c) => JSON.stringify(c.body).includes(marker));
}

function buildCommentBody(
  prefix: string,
  ticket: EstimatedTicket,
): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: prefix, marks: [{ type: "em" }] }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `${String(ticket.estimated_sp)} SP`,
            marks: [{ type: "strong" }],
          },
          { type: "text", text: ` — ${ticket.reasoning}` },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Similar tickets: ${ticket.similar_tickets.join(", ")}`,
          },
        ],
      },
    ],
  };
}

function loadHistory(historyPath: string): HistoryEntry[] {
  if (existsSync(historyPath)) {
    return JSON.parse(readFileSync(historyPath, "utf-8")) as HistoryEntry[];
  }
  return [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    (args.config as string) ??
    resolve(import.meta.dirname, "../data/config.json");
  const estimatesPath =
    (args.estimates as string) ??
    resolve(import.meta.dirname, "../data/cache/estimated-tickets.json");
  const dryRun = Boolean(args["dry-run"]);

  const config = loadConfig(configPath);
  const tickets = loadEstimates(estimatesPath);

  if (dryRun) {
    console.log(`[DRY RUN] Would update ${String(tickets.length)} tickets:\n`);
    for (const t of tickets) {
      console.log(`  ${t.key}: ${String(t.estimated_sp)} SP (${t.confidence})`);
    }
    console.log("\nNo changes made.");
    return;
  }

  const auth = getAuth(config);
  const baseUrl = config.jira.base_url;
  const spField = config.jira.story_points_field;
  const commentPrefix = config.estimation.comment_prefix;

  const succeeded: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  const now = new Date().toISOString();

  for (const t of tickets) {
    process.stdout.write(`  ${t.key}: ${String(t.estimated_sp)} SP...`);

    const alreadyCommented = await hasExistingComment(
      baseUrl,
      auth,
      t.key,
      commentPrefix,
    );

    if (!alreadyCommented) {
      const commentResult = await jiraFetch(
        baseUrl,
        `/rest/api/3/issue/${t.key}/comment`,
        auth,
        { body: buildCommentBody(commentPrefix, t) },
        "POST",
      );

      if (!commentResult.ok) {
        const msg =
          typeof commentResult.data.errorMessages === "object"
            ? JSON.stringify(commentResult.data.errorMessages)
            : `Comment HTTP ${String(commentResult.status)}`;
        console.log(` FAILED (${msg})`);
        failed.push({ key: t.key, error: msg });
        continue;
      }
    } else {
      process.stdout.write(" comment exists, skipping...");
    }

    const spResult = await jiraFetch(
      baseUrl,
      `/rest/api/3/issue/${t.key}`,
      auth,
      {
        fields: { [spField]: t.estimated_sp },
      },
    );

    if (spResult.ok) {
      console.log(" done.");
      succeeded.push(t.key);
    } else {
      const msg =
        typeof spResult.data.errorMessages === "object"
          ? JSON.stringify(spResult.data.errorMessages)
          : `SP HTTP ${String(spResult.status)}`;
      console.log(` FAILED (${msg})`);
      failed.push({ key: t.key, error: msg });
    }
  }

  console.log(
    `\nSet story points on ${String(succeeded.length)} of ${String(tickets.length)} ticket(s).`,
  );

  const historyPath = resolve(
    import.meta.dirname,
    "../data/output/estimation-history.json",
  );
  const history = loadHistory(historyPath);
  for (const t of tickets) {
    history.push({
      ...t,
      estimated_at: now,
      applied: succeeded.includes(t.key),
    });
  }
  writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
  console.log(`Estimation history updated: ${historyPath}`);

  if (failed.length > 0) {
    console.error(`\nFailed (${String(failed.length)}):`);
    for (const f of failed) {
      console.error(`  ${f.key}: ${f.error}`);
    }
    process.exit(3);
  }
}

const isDirectRun = process.argv[1]?.endsWith("apply-story-points.ts");
if (isDirectRun) void main();
