import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebClient } from "@slack/web-api";

interface Channel {
  id: string;
  name: string;
}

interface Config {
  name: string;
  channels: Channel[];
  keywords: Record<string, string[]>;
  lookback_days: number;
  category_priority?: string[];
}

interface Message {
  channel_id: string;
  channel_name: string;
  thread_ts: string;
  message_ts: string;
  user: string;
  text: string;
  reply_count: number;
  date: string;
}

interface Thread {
  parent: Message;
  replyCount: number;
  channel: string;
}

interface ThreadJson {
  channel: string;
  channelId: string;
  threadTs: string;
  date: string;
  text: string;
  replyCount: number;
  category: string;
  jiraTickets: string[];
  githubUrls: string[];
  slackUrl: string;
}

interface ReportJson {
  generated: string;
  channels: string[];
  period: number;
  totalMessages: number;
  threads: ThreadJson[];
  uncategorizedThreads: ThreadJson[];
  allJiraTickets: string[];
  allGithubUrls: string[];
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") {
      console.log(
        "Usage: generate-report.ts --config <path> --output <path> [--format json|md]",
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

async function fetchMessages(
  channels: Channel[],
  lookbackDays: number,
): Promise<Message[]> {
  const token = process.env.SLACK_TOKEN;
  const cookie = process.env.SLACK_COOKIE;

  if (!token || !cookie) {
    console.error(
      "Missing SLACK_TOKEN or SLACK_COOKIE environment variables.\n" +
        "Set them from your Slack desktop app session.",
    );
    process.exit(1);
  }

  const client = new WebClient(token, {
    headers: { cookie: `d=${cookie}` },
  });

  const oldest = Math.floor(
    (Date.now() - lookbackDays * 86400000) / 1000,
  ).toString();
  const messages: Message[] = [];

  for (const channel of channels) {
    let cursor: string | undefined;
    do {
      const result = await client.conversations.history({
        channel: channel.id,
        oldest,
        limit: 200,
        cursor,
      });

      if (!result.ok || !result.messages) {
        console.error(
          `Failed to fetch #${channel.name} (${channel.id}): ${String(result.error ?? "unknown error")}`,
        );
        break;
      }

      for (const msg of result.messages) {
        if (!msg.ts || !msg.text) continue;
        messages.push({
          channel_id: channel.id,
          channel_name: channel.name,
          thread_ts: msg.thread_ts ?? msg.ts,
          message_ts: msg.ts,
          user: msg.user ?? "unknown",
          text: msg.text,
          reply_count: msg.reply_count ?? 0,
          date: new Date(parseFloat(msg.ts) * 1000).toISOString().split("T")[0],
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    console.log(
      `Fetched ${messages.filter((m) => m.channel_id === channel.id).length} messages from #${channel.name}`,
    );
  }

  return messages;
}

interface CategoryResult {
  name: string;
  keywords: string[];
  threads: Thread[];
  messageCount: number;
}

function groupIntoThreads(messages: Message[]): Thread[] {
  const threadMap = new Map<string, Message>();
  for (const msg of messages) {
    const key = `${msg.channel_id}:${msg.thread_ts}`;
    const existing = threadMap.get(key);
    if (!existing || msg.reply_count > existing.reply_count) {
      threadMap.set(key, msg);
    }
  }
  return [...threadMap.values()]
    .map((m) => ({
      parent: m,
      replyCount: m.reply_count,
      channel: m.channel_name,
    }))
    .sort((a, b) => b.replyCount - a.replyCount);
}

function categorize(
  messages: Message[],
  keywords: Record<string, string[]>,
): { categories: CategoryResult[]; uncategorized: Message[] } {
  const categoryMap = new Map<string, Message[]>();
  for (const name of Object.keys(keywords)) {
    categoryMap.set(name, []);
  }

  const assigned = new Set<string>();
  for (const msg of messages) {
    const text = msg.text.toLowerCase();
    let bestCategory: string | null = null;
    let bestScore = 0;

    for (const [category, kws] of Object.entries(keywords)) {
      const score = kws.filter((kw) => text.includes(kw.toLowerCase())).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    if (bestCategory && bestScore > 0) {
      categoryMap.get(bestCategory)!.push(msg);
      assigned.add(msg.message_ts);
    }
  }

  const categories: CategoryResult[] = [];
  for (const [name, kws] of Object.entries(keywords)) {
    const msgs = categoryMap.get(name) ?? [];
    const threads = groupIntoThreads(msgs);
    categories.push({
      name,
      keywords: kws,
      threads,
      messageCount: msgs.length,
    });
  }

  const uncategorized = messages.filter((m) => !assigned.has(m.message_ts));
  return { categories, uncategorized };
}

function extractJiraTickets(text: string): string[] {
  const ticketPattern =
    /\b(OCPBUGS-\d+|CNV-\d+|RHEL-\d+|MTV-\d+|CONSOLE-\d+)\b/g;
  const matches = text.match(ticketPattern);
  return matches ? [...new Set(matches)] : [];
}

function extractGitHubUrls(text: string): string[] {
  const ghPattern =
    /<?(https:\/\/github\.com\/[^\s|>]+(?:\/pull\/\d+|\/issues\/\d+))[|>]?/g;
  const urls: string[] = [];
  const matches = text.matchAll(ghPattern);
  for (const match of matches) {
    urls.push(match[1] ?? match[0]);
  }
  return [...new Set(urls)];
}

function formatPreview(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/<@[A-Z0-9]+>/g, "@user")
    .replace(/<#[A-Z0-9]+>/g, "#channel")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/\n/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen) + "...";
  }
  return cleaned;
}

function weeklyDistribution(messages: Message[]): Map<string, number> {
  const weeks = new Map<string, number>();
  for (const msg of messages) {
    const d = new Date(msg.date);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const weekKey = monday.toISOString().split("T")[0];
    weeks.set(weekKey, (weeks.get(weekKey) ?? 0) + 1);
  }
  return new Map([...weeks.entries()].sort());
}

function consolidateE2eStreaks(threads: Thread[]): Thread[] {
  const nightlyPattern = /(:failed:|nightly e2e)/i;
  const nightlyThreads = threads.filter((t) =>
    nightlyPattern.test(t.parent.text),
  );
  const nonNightly = threads.filter((t) => !nightlyPattern.test(t.parent.text));

  if (nightlyThreads.length <= 1) return threads;

  const dates = nightlyThreads.map((t) => t.parent.date).sort();
  const totalReplies = nightlyThreads.reduce((sum, t) => sum + t.replyCount, 0);
  const streakMsg: Message = {
    ...nightlyThreads[0].parent,
    text: `Nightly e2e failure streak: ${nightlyThreads.length} consecutive failures from ${dates[0]} to ${dates[dates.length - 1]}. Total ${totalReplies} replies across all failure threads.`,
    reply_count: totalReplies,
    date: dates[dates.length - 1],
  };

  return [
    {
      parent: streakMsg,
      replyCount: totalReplies,
      channel: streakMsg.channel_name,
    },
    ...nonNightly,
  ].sort((a, b) => b.replyCount - a.replyCount);
}

function buildSlackUrl(channelId: string, threadTs: string): string {
  const tsNoDot = threadTs.replace(".", "");
  return `https://redhat.enterprise.slack.com/archives/${channelId}/p${tsNoDot}`;
}

function threadToJson(thread: Thread, category: string): ThreadJson {
  return {
    channel: thread.channel,
    channelId: thread.parent.channel_id,
    threadTs: thread.parent.thread_ts,
    date: thread.parent.date,
    text: thread.parent.text,
    replyCount: thread.replyCount,
    category,
    jiraTickets: extractJiraTickets(thread.parent.text),
    githubUrls: extractGitHubUrls(thread.parent.text),
    slackUrl: buildSlackUrl(thread.parent.channel_id, thread.parent.thread_ts),
  };
}

function generateJsonReport(
  config: Config,
  categories: CategoryResult[],
  uncategorized: Message[],
  allMessages: Message[],
): ReportJson {
  const allJira = new Set<string>();
  const allGh = new Set<string>();
  for (const msg of allMessages) {
    extractJiraTickets(msg.text).forEach((t) => allJira.add(t));
    extractGitHubUrls(msg.text).forEach((u) => allGh.add(u));
  }

  const threads: ThreadJson[] = [];
  for (const cat of categories) {
    let catThreads = cat.threads;
    if (cat.name === "e2e-and-ci") {
      catThreads = consolidateE2eStreaks(catThreads);
    }
    for (const t of catThreads) {
      threads.push(threadToJson(t, cat.name));
    }
  }

  const uncatThreads = groupIntoThreads(uncategorized);
  const uncategorizedJson = uncatThreads.map((t) =>
    threadToJson(t, "uncategorized"),
  );

  return {
    generated: new Date().toISOString(),
    channels: config.channels.map((c) => c.name),
    period: config.lookback_days,
    totalMessages: allMessages.length,
    threads,
    uncategorizedThreads: uncategorizedJson,
    allJiraTickets: [...allJira].sort(),
    allGithubUrls: [...allGh],
  };
}

function generateExecutiveSummary(
  categories: CategoryResult[],
  jiraTickets: string[],
  allMessages: Message[],
): string[] {
  const lines: string[] = [];
  lines.push("## Executive Summary");
  lines.push("");

  const hotThreads = allMessages
    .filter((m) => m.reply_count >= 20)
    .sort((a, b) => b.reply_count - a.reply_count);

  lines.push(
    `**${jiraTickets.length} Jira tickets** referenced across conversations. ` +
      `**${hotThreads.length} hot threads** (20+ replies) indicate high-engagement topics.`,
  );
  lines.push("");

  for (const cat of categories) {
    if (cat.messageCount > 0) {
      lines.push(
        `- **${cat.name}:** ${cat.messageCount} messages, ${cat.threads.length} threads`,
      );
    }
  }

  if (hotThreads.length > 0) {
    lines.push("");
    lines.push("**Hottest threads (by reply count):**");
    lines.push("");
    for (const t of hotThreads.slice(0, 5)) {
      const preview = formatPreview(t.text, 120);
      lines.push(
        `1. **${t.reply_count} replies** (#${t.channel_name}, ${t.date}) — ${preview}`,
      );
    }
  }

  lines.push("");
  return lines;
}

function generateMarkdownReport(
  config: Config,
  categories: CategoryResult[],
  uncategorized: Message[],
  allMessages: Message[],
): string {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  lines.push(`# Slack Forums Analysis — ${today}`);
  lines.push("");
  lines.push(
    `**Channels:** ${config.channels.map((c) => `#${c.name}`).join(", ")}`,
  );
  lines.push(`**Period:** Last ${config.lookback_days} days`);
  lines.push(`**Total messages analyzed:** ${allMessages.length}`);
  const categorizedCount = allMessages.length - uncategorized.length;
  lines.push(
    `**Categorized:** ${categorizedCount} (${Math.round((categorizedCount / allMessages.length) * 100)}%) | **Uncategorized:** ${uncategorized.length}`,
  );
  lines.push("");

  const allJira = new Set<string>();
  for (const msg of allMessages) {
    extractJiraTickets(msg.text).forEach((t) => allJira.add(t));
  }
  const jiraTickets = [...allJira].sort();

  lines.push(...generateExecutiveSummary(categories, jiraTickets, allMessages));

  const weeks = weeklyDistribution(allMessages);
  lines.push("## Weekly Activity");
  lines.push("");
  for (const [week, count] of weeks) {
    const bar = "█".repeat(Math.ceil(count / 2));
    lines.push(`\`${week}\` ${bar} ${count} msgs`);
  }
  lines.push("");

  if (jiraTickets.length > 0) {
    lines.push("## Key Jira Tickets Mentioned");
    lines.push("");
    for (const ticket of jiraTickets) {
      lines.push(
        `- [${ticket}](https://redhat.atlassian.net/browse/${ticket})`,
      );
    }
    lines.push("");
  }

  const allGh = new Set<string>();
  for (const msg of allMessages) {
    extractGitHubUrls(msg.text).forEach((u) => allGh.add(u));
  }
  if (allGh.size > 0) {
    lines.push("## GitHub PRs & Issues Mentioned");
    lines.push("");
    for (const url of allGh) {
      const shortUrl = url
        .replace("https://github.com/", "")
        .replace("/pull/", "#")
        .replace("/issues/", "#");
      lines.push(`- [${shortUrl}](${url})`);
    }
    lines.push("");
  }

  lines.push("## Category Breakdown");
  lines.push("");

  const priority = config.category_priority ?? [];
  const sorted = [...categories].sort((a, b) => {
    const aIdx = priority.indexOf(a.name);
    const bIdx = priority.indexOf(b.name);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return b.messageCount - a.messageCount;
  });

  for (const cat of sorted) {
    let threads = cat.threads;
    if (cat.name === "e2e-and-ci") {
      threads = consolidateE2eStreaks(threads);
    }

    lines.push(
      `### ${cat.name} (${cat.messageCount} messages, ${threads.length} threads)`,
    );
    lines.push("");

    if (threads.length === 0) {
      lines.push("No matching messages found.");
      lines.push("");
      continue;
    }

    const channelDist = new Map<string, number>();
    for (const t of threads) {
      channelDist.set(t.channel, (channelDist.get(t.channel) ?? 0) + 1);
    }
    const channelInfo = [...channelDist.entries()]
      .map(([ch, n]) => `#${ch}: ${n}`)
      .join(", ");
    lines.push(`**Source:** ${channelInfo}`);
    lines.push("");

    const topThreads = threads.slice(0, 10);
    for (const thread of topThreads) {
      const preview = formatPreview(thread.parent.text, 300);
      const replyTag =
        thread.replyCount > 0 ? ` **[${thread.replyCount} replies]**` : "";
      lines.push(
        `- **[${thread.parent.date}]** (#${thread.channel})${replyTag} ${preview}`,
      );
    }

    if (threads.length > 10) {
      lines.push(`- *(${threads.length - 10} more threads)*`);
    }
    lines.push("");
  }

  if (uncategorized.length > 0) {
    const uncatThreads = groupIntoThreads(uncategorized);
    lines.push(
      `## Uncategorized (${uncategorized.length} messages, ${uncatThreads.length} threads)`,
    );
    lines.push("");
    const sample = uncatThreads.slice(0, 10);
    for (const thread of sample) {
      const preview = formatPreview(thread.parent.text, 200);
      const replyTag =
        thread.replyCount > 0 ? ` [${thread.replyCount} replies]` : "";
      lines.push(
        `- [${thread.parent.date}] (#${thread.channel})${replyTag} ${preview}`,
      );
    }
    if (uncatThreads.length > 10) {
      lines.push(`- *(${uncatThreads.length - 10} more threads)*`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath =
    args.config ?? resolve(import.meta.dirname, "../data/config.json");
  const outputPath =
    args.output ?? resolve(import.meta.dirname, "../data/output/report.md");
  const format = args.format ?? "md";

  const config = loadConfig(configPath);
  const messages = await fetchMessages(config.channels, config.lookback_days);

  if (messages.length === 0) {
    console.error("No messages found in the configured channels");
    process.exit(2);
  }

  const { categories, uncategorized } = categorize(messages, config.keywords);

  const matchedCount = categories.reduce((sum, c) => sum + c.messageCount, 0);
  if (matchedCount === 0) {
    console.error(
      "No messages matched any keyword category. Consider adjusting keywords in config.",
    );
    process.exit(2);
  }

  const warnings: string[] = [];
  for (const cat of categories) {
    if (cat.messageCount === 0) {
      warnings.push(`Category "${cat.name}" has 0 matches`);
    }
  }

  if (format === "json") {
    const jsonReport = generateJsonReport(
      config,
      categories,
      uncategorized,
      messages,
    );
    const jsonPath = outputPath.replace(/\.md$/, ".json");
    writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
    console.log(`JSON report written to ${jsonPath}`);
  } else {
    const report = generateMarkdownReport(
      config,
      categories,
      uncategorized,
      messages,
    );
    writeFileSync(outputPath, report);
    console.log(`Report written to ${outputPath}`);
  }

  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ! ${w}`));
    process.exit(3);
  }
}

void main();
