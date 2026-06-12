import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface JiraConfig {
  jira: {
    cloud_id: string;
    base_url: string;
    user_email: string;
    activity_type_field: string;
  };
}

interface ClassifiedTicket {
  key: string;
  summary: string;
  activity_type: string;
  activity_type_id: string;
  matched_rule: string;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: apply-activity-types.ts --config <path> --cache <dir> [--dry-run]",
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

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function loadClassifiedTickets(csvPath: string): ClassifiedTicket[] {
  if (!existsSync(csvPath)) {
    console.error(`Classified tickets CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const lines = readFileSync(csvPath, "utf-8").trim().split("\n");
  if (lines.length < 2) {
    console.error("No tickets found in classified CSV");
    process.exit(1);
  }

  const headers = lines[0].split(",");
  const keyIdx = headers.indexOf("key");
  const summaryIdx = headers.indexOf("summary");
  const atIdx = headers.indexOf("activity_type");
  const atIdIdx = headers.indexOf("activity_type_id");
  const ruleIdx = headers.indexOf("matched_rule");

  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      key: fields[keyIdx] ?? "",
      summary: fields[summaryIdx] ?? "",
      activity_type: fields[atIdx] ?? "",
      activity_type_id: fields[atIdIdx] ?? "",
      matched_rule: fields[ruleIdx] ?? "",
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    (args.config as string) ??
    resolve(import.meta.dirname, "../data/config.json");
  const cacheDir =
    (args.cache as string) ?? resolve(import.meta.dirname, "../data/cache");
  const dryRun = Boolean(args["dry-run"]);

  const config = loadConfig(configPath);
  const csvPath = resolve(cacheDir, "classified-tickets.csv");
  const tickets = loadClassifiedTickets(csvPath);

  if (dryRun) {
    console.log(`[DRY RUN] Would update ${String(tickets.length)} tickets:\n`);
    for (const t of tickets) {
      console.log(`  ${t.key}: ${t.activity_type} (${t.matched_rule})`);
    }
    console.log("\nNo changes made.");
    return;
  }

  const auth = getAuth(config);
  const fieldId = config.jira.activity_type_field;
  const baseUrl = config.jira.base_url;

  const succeeded: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  for (const t of tickets) {
    process.stdout.write(`  ${t.key}: ${t.activity_type}...`);

    const result = await jiraFetch(
      baseUrl,
      `/rest/api/3/issue/${t.key}`,
      auth,
      { fields: { [fieldId]: { id: t.activity_type_id } } },
    );

    if (result.ok) {
      console.log(" done.");
      succeeded.push(t.key);
    } else {
      const msg =
        typeof result.data.errorMessages === "object"
          ? JSON.stringify(result.data.errorMessages)
          : `HTTP ${String(result.status)}`;
      console.log(` FAILED (${msg})`);
      failed.push({ key: t.key, error: msg });
    }
  }

  console.log(
    `\nSet Activity Type on ${String(succeeded.length)} of ${String(tickets.length)} tickets.`,
  );

  if (failed.length > 0) {
    console.error(`\nFailed (${String(failed.length)}):`);
    for (const f of failed) {
      console.error(`  ${f.key}: ${f.error}`);
    }
    process.exit(3);
  }
}

const isDirectRun = process.argv[1]?.endsWith("apply-activity-types.ts");
if (isDirectRun) void main();
