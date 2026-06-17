import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface Config {
  jira: {
    cloud_id: string;
    base_url: string;
    user_email: string;
    jql: string;
    qa_contact_field: string;
  };
  detection: {
    comment_keywords: string[];
    negation_words: string[];
    negation_window: number;
    transition_statuses: string[];
    valid_from_statuses: string[];
    bot_account_ids: string[];
  };
}

interface Comment {
  author: string;
  authorAccountId: string;
  body: string;
  created: string;
}

interface ChangelogEntry {
  author: string;
  authorAccountId: string;
  field: string;
  fromString: string;
  toString: string;
  created: string;
}

interface TicketData {
  key: string;
  summary: string;
  comments: Comment[];
  changelog: ChangelogEntry[];
}

interface VerifierMatch {
  key: string;
  summary: string;
  qa_contact_name: string;
  qa_contact_account_id: string;
  evidence: string;
  source: "comment" | "transition";
  confidence: number;
  created: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: identify-verifiers.ts --config <path> --cache <dir> --output <path>",
      );
      process.exit(0);
    }
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as Config;
}

function loadTicketData(cachePath: string): TicketData[] {
  const filePath = resolve(cachePath, "tickets-data.json");
  if (!existsSync(filePath)) {
    console.error(`Ticket data not found: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as TicketData[];
}

function isBot(accountId: string, botIds: string[]): boolean {
  return botIds.includes(accountId);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasNegation(
  text: string,
  keywordPos: number,
  negationWords: string[],
  windowSize: number,
): boolean {
  const before = text.slice(Math.max(0, keywordPos - 80), keywordPos);
  // Only look within the current sentence (stop at . ! ? boundaries)
  const lastSentenceBreak = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("! "),
    before.lastIndexOf("? "),
  );
  const sameSentence =
    lastSentenceBreak >= 0 ? before.slice(lastSentenceBreak + 2) : before;
  const words = sameSentence.split(/\s+/).slice(-windowSize);
  const windowText = words.join(" ").toLowerCase();
  return negationWords.some((neg) => windowText.includes(neg.toLowerCase()));
}

export function findVerifierFromComments(
  ticket: TicketData,
  keywords: string[],
  negationWords: string[],
  negationWindow: number,
  botIds: string[],
): VerifierMatch | null {
  let lastMatch: VerifierMatch | null = null;

  for (const comment of ticket.comments) {
    if (isBot(comment.authorAccountId, botIds)) continue;

    const bodyLower = comment.body.toLowerCase();
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
      const match = regex.exec(bodyLower);
      if (!match) continue;

      if (hasNegation(comment.body, match.index, negationWords, negationWindow))
        continue;

      lastMatch = {
        key: ticket.key,
        summary: ticket.summary,
        qa_contact_name: comment.author,
        qa_contact_account_id: comment.authorAccountId,
        evidence: `Comment contains "${kw}" (${comment.created.slice(0, 10)})`,
        source: "comment",
        confidence: kw === "verified" ? 0.8 : 0.7,
        created: comment.created,
      };
    }
  }
  return lastMatch;
}

export function findVerifierFromChangelog(
  ticket: TicketData,
  targetStatuses: string[],
  validFromStatuses: string[],
  botIds: string[],
): VerifierMatch | null {
  const lowerStatuses = targetStatuses.map((s) => s.toLowerCase());
  const lowerFromStatuses = validFromStatuses.map((s) => s.toLowerCase());
  let lastMatch: VerifierMatch | null = null;

  for (const entry of ticket.changelog) {
    if (entry.field !== "status") continue;
    if (isBot(entry.authorAccountId, botIds)) continue;
    if (!lowerStatuses.includes(entry.toString.toLowerCase())) continue;
    if (
      lowerFromStatuses.length > 0 &&
      !lowerFromStatuses.includes(entry.fromString.toLowerCase())
    )
      continue;

    lastMatch = {
      key: ticket.key,
      summary: ticket.summary,
      qa_contact_name: entry.author,
      qa_contact_account_id: entry.authorAccountId,
      evidence: `Transitioned ${entry.fromString} → ${entry.toString} (${entry.created.slice(0, 10)})`,
      source: "transition",
      confidence: 0.95,
      created: entry.created,
    };
  }
  return lastMatch;
}

export function findVerifierFromClosedAfterQA(
  ticket: TicketData,
  botIds: string[],
): VerifierMatch | null {
  let wasOnQA = false;
  let lastMatch: VerifierMatch | null = null;

  for (const entry of ticket.changelog) {
    if (entry.field !== "status") continue;
    if (entry.toString.toLowerCase() === "on_qa") wasOnQA = true;
    if (
      wasOnQA &&
      entry.toString.toLowerCase() === "closed" &&
      !isBot(entry.authorAccountId, botIds)
    ) {
      lastMatch = {
        key: ticket.key,
        summary: ticket.summary,
        qa_contact_name: entry.author,
        qa_contact_account_id: entry.authorAccountId,
        evidence: `Closed after ON_QA (${entry.created.slice(0, 10)})`,
        source: "transition",
        confidence: 0.75,
        created: entry.created,
      };
    }
  }
  return lastMatch;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generatePreview(
  matched: VerifierMatch[],
  unmatched: TicketData[],
  baseUrl: string,
): string {
  const lines: string[] = [];
  lines.push("# QA Contact Assignment Preview\n");

  lines.push(`**Matched:** ${String(matched.length)} tickets`);
  lines.push(`**Unmatched:** ${String(unmatched.length)} tickets (skipped)`);

  const byComment = matched.filter((m) => m.source === "comment").length;
  const byTransition = matched.filter((m) => m.source === "transition").length;
  lines.push(
    `**Breakdown:** ${String(byTransition)} by status transition, ${String(byComment)} by comment keyword\n`,
  );

  const avgConf =
    matched.length > 0
      ? matched.reduce((sum, m) => sum + m.confidence, 0) / matched.length
      : 0;
  lines.push(`**Avg confidence:** ${avgConf.toFixed(2)}\n`);

  if (matched.length > 0) {
    lines.push("## Proposed Assignments\n");
    lines.push("| Ticket | Summary | QA Contact | Evidence | Source | Conf |");
    lines.push("| ------ | ------- | ---------- | -------- | ------ | ---- |");
    for (const m of matched) {
      const link = `[${m.key}](${baseUrl}/browse/${m.key})`;
      lines.push(
        `| ${link} | ${csvEscape(m.summary)} | ${m.qa_contact_name} | ${m.evidence} | ${m.source} | ${m.confidence.toFixed(2)} |`,
      );
    }
  }

  if (unmatched.length > 0) {
    lines.push("\n## Unmatched (No QA Contact Identified)\n");
    lines.push("| Ticket | Summary |");
    lines.push("| ------ | ------- |");
    for (const t of unmatched) {
      const link = `[${t.key}](${baseUrl}/browse/${t.key})`;
      lines.push(`| ${link} | ${csvEscape(t.summary)} |`);
    }
  }

  // Top verifiers
  const counts = new Map<string, number>();
  for (const m of matched) {
    counts.set(m.qa_contact_name, (counts.get(m.qa_contact_name) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    lines.push("\n## Top Verifiers\n");
    lines.push("| Name | Count |");
    lines.push("| ---- | ----- |");
    for (const [name, count] of sorted.slice(0, 10)) {
      lines.push(`| ${name} | ${String(count)} |`);
    }
  }

  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    args.config ?? resolve(import.meta.dirname, "../data/config.json");
  const cacheDir = args.cache ?? resolve(import.meta.dirname, "../data/cache");
  const outputPath =
    args.output ??
    resolve(import.meta.dirname, "../data/output/verifier-preview.md");

  const config = loadConfig(configPath);
  const tickets = loadTicketData(cacheDir);

  if (tickets.length === 0) {
    console.error("No tickets to process");
    process.exit(2);
  }

  const matched: VerifierMatch[] = [];
  const unmatched: TicketData[] = [];

  for (const ticket of tickets) {
    // Priority: changelog transitions first (higher confidence)
    const fromChangelog = findVerifierFromChangelog(
      ticket,
      config.detection.transition_statuses,
      config.detection.valid_from_statuses,
      config.detection.bot_account_ids,
    );
    if (fromChangelog) {
      matched.push(fromChangelog);
      continue;
    }

    const fromComment = findVerifierFromComments(
      ticket,
      config.detection.comment_keywords,
      config.detection.negation_words,
      config.detection.negation_window,
      config.detection.bot_account_ids,
    );
    if (fromComment) {
      matched.push(fromComment);
      continue;
    }

    // Fallback: person who closed after ON_QA (lower confidence)
    const fromClosedAfterQA = findVerifierFromClosedAfterQA(
      ticket,
      config.detection.bot_account_ids,
    );
    if (fromClosedAfterQA) {
      matched.push(fromClosedAfterQA);
      continue;
    }

    unmatched.push(ticket);
  }

  // Write proposals CSV
  const csvHeader =
    "key,summary,qa_contact_name,qa_contact_account_id,evidence,source,confidence";
  const csvLines = matched.map(
    (m) =>
      `${m.key},${csvEscape(m.summary)},${csvEscape(m.qa_contact_name)},${m.qa_contact_account_id},${csvEscape(m.evidence)},${m.source},${String(m.confidence)}`,
  );
  const csvContent = [csvHeader, ...csvLines].join("\n") + "\n";
  const csvPath = resolve(cacheDir, "identified-verifiers.csv");
  writeFileSync(csvPath, csvContent);

  // Write preview
  const preview = generatePreview(matched, unmatched, config.jira.base_url);
  writeFileSync(outputPath, preview);

  const byComment = matched.filter((m) => m.source === "comment").length;
  const byTransition = matched.filter((m) => m.source === "transition").length;

  console.log(
    `Identified verifiers for ${String(matched.length)} of ${String(tickets.length)} tickets.`,
  );
  console.log(
    `  By transition: ${String(byTransition)}, by comment: ${String(byComment)}`,
  );
  console.log(`Unmatched: ${String(unmatched.length)} (will be skipped).`);
  console.log(`Preview: ${outputPath}`);
  console.log(`CSV: ${csvPath}`);

  if (unmatched.length > 0 && matched.length === 0) {
    process.exit(2);
  }
  if (unmatched.length > 0) {
    process.exit(3);
  }
}

const isDirectRun = process.argv[1]?.endsWith("identify-verifiers.ts");
if (isDirectRun) main();
