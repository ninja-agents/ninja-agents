#!/usr/bin/env tsx
/**
 * Post-generation stage for the weekly report.
 *
 * 1. Verifies every ` — Backport needed: <versions>` annotation the generator
 *    appended. A version is removed only on positive evidence: a Jira fix
 *    version, a done clone fixed in that version, or a merged PR whose base
 *    branch / title targets the release stream. Absence of evidence keeps the
 *    claim.
 * 2. Appends a deterministic `## Recommendations` section with the follow-ups
 *    this report implies (remaining backports, open backport PRs, PRs awaiting
 *    review, stale PRs, stalled tickets).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGithubRequest } from "./collector-helpers.js";
import {
  buildJiraDisplayToName,
  extractReleaseBranchFromTitle,
  loadConfig,
  loadCsvFile,
  normalizeVersionStream,
} from "./generate-weekly-report.js";

const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const RESET = "\x1b[0m";

const SCRIPT_DIR = import.meta.dirname;
const AGENT_ROOT = resolve(SCRIPT_DIR, "..");
const DATA_DIR = resolve(AGENT_ROOT, "data");

const RECOMMENDATIONS_HEADING = "## Recommendations";

// The generator appends exactly this suffix (leading space + U+2014 em dash).
const BACKPORT_SUFFIX = " \u2014 Backport needed: ";
const BACKPORT_SUFFIX_RE =
  / \u2014 Backport needed: ((?:\d+\.\d+\.z)(?:, \d+\.\d+\.z)*)$/;
const CLAIM_KEY_RE = /\[(?:(?:PR|MR) [!#]\d+ - )?([A-Z][A-Z0-9]+-\d+)/;
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bullet labels are `[PR #653 - OCPBUGS-135361: …]` or `[OCPBUGS-135361 - …]`,
 * but a PR whose title starts with a release prefix reads
 * `[PR #480 - [release-4.17] OCPNETUI-168: …]`, so fall back to the first
 * ticket key anywhere on the line.
 */
function claimKeyFromLine(line: string): string | null {
  const labeled = CLAIM_KEY_RE.exec(line);
  if (labeled) return labeled[1];
  const anywhere = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(line);
  return anywhere ? anywhere[1] : null;
}

const CATEGORY_ORDER: RecommendationRow["category"][] = [
  "Backport",
  "Backport PR",
  "Review",
  "Stale PR",
  "Stalled ticket",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackportClaim {
  key: string;
  versions: string[];
}

export type DropReason =
  | "fix_version"
  | "done_clone"
  | "merged_pr"
  | "unsupported";

export interface Verdict {
  key: string;
  version: string;
  covered: boolean;
  reason: DropReason | "unverified" | "needed";
  evidence?: string;
}

export interface TicketFacts {
  key: string;
  status: string;
  assignee_name: string;
  statuscategorychangedate: string;
  affected_versions: string[];
  fix_versions: string[];
}

export interface CloneFact {
  clone_key: string;
  clone_status_category: string;
  clone_fix_versions: string[];
}

export interface PrEvidence {
  url: string;
  number: number;
  repo: string;
  merged_at: string;
  base_ref: string;
  title: string;
}

export interface PrRow {
  engineer: string;
  number: number;
  title: string;
  repo: string;
  state: string;
  created_at: string;
  updated_at: string;
  url: string;
}

export interface CoverageContext {
  tickets: Map<string, TicketFacts>;
  clones: Map<string, CloneFact[]>;
  prEvidence: Map<string, PrEvidence[]>;
  failedKeys: Set<string>;
  supportedVersions: Map<string, string[]>;
}

export interface FollowupsConfig {
  pending_review_days: number;
  stale_pr_days: number;
  stale_ticket_days: number;
  max_rows_per_category: number;
}

export const DEFAULT_FOLLOWUPS: FollowupsConfig = {
  pending_review_days: 3,
  stale_pr_days: 7,
  stale_ticket_days: 14,
  max_rows_per_category: 8,
};

export interface RecommendationRow {
  category:
    | "Backport"
    | "Backport PR"
    | "Review"
    | "Stale PR"
    | "Stalled ticket";
  item: string;
  why: string;
  action: string;
  owner: string;
  ageDays: number;
}

export interface RecommendationsInput {
  verdicts: Verdict[];
  tickets: Map<string, TicketFacts>;
  prs: PrRow[];
  jiraBaseUrl: string;
  now: Date;
  followups: FollowupsConfig;
  /** Jira display name -> engineer name, so owners match the rest of the report. */
  jiraDisplayToName?: Map<string, string>;
}

export interface RecommendationsResult {
  rows: RecommendationRow[];
  cappedCounts: Map<string, number>;
}

interface FinalizeConfig {
  jira: { base_url: string };
  products: { key: string; jira_prefixes: string[]; repos: string[] }[];
  backport?: Record<
    string,
    { supported_versions: string[]; main_target_version: string }
  >;
  followups?: Partial<FollowupsConfig>;
}

// ---------------------------------------------------------------------------
// Backport claim parsing
// ---------------------------------------------------------------------------

/**
 * Finds every generated backport annotation. Lines whose trailing version list
 * looks like an annotation but does not parse are reported instead of guessed
 * at, so the caller can fail loudly.
 */
export function parseBackportClaims(markdown: string): {
  claims: BackportClaim[];
  unparsableLines: number[];
} {
  const claims: BackportClaim[] = [];
  const unparsableLines: number[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const markerAt = line.lastIndexOf(BACKPORT_SUFFIX);
    if (markerAt === -1) continue;

    const match = BACKPORT_SUFFIX_RE.exec(line);
    if (match) {
      const key = claimKeyFromLine(line);
      if (!key) {
        unparsableLines.push(i + 1);
        continue;
      }
      claims.push({ key, versions: match[1].split(", ") });
      continue;
    }

    // A version-like tail that misses the format (e.g. "4.23.z." or "4.23")
    // would otherwise be silently ignored.
    const tail = line.slice(markerAt + BACKPORT_SUFFIX.length).trim();
    if (tail !== "" && /^[\d.,\sz]+$/.test(tail)) {
      unparsableLines.push(i + 1);
    }
  }

  return { claims, unparsableLines };
}

// ---------------------------------------------------------------------------
// Coverage decisions
// ---------------------------------------------------------------------------

function jiraPrefix(key: string): string {
  const dash = key.indexOf("-");
  return dash === -1 ? key : key.slice(0, dash);
}

function prTargetsVersion(pr: PrEvidence, version: string): boolean {
  if (!pr.merged_at) return false;
  const baseStream = normalizeVersionStream(
    pr.base_ref.replace(/^release-/i, ""),
  );
  if (baseStream && baseStream === version) return true;
  return extractReleaseBranchFromTitle(pr.title).includes(version);
}

/**
 * Decides the fate of every version in a claim. Precedence, first match wins:
 * unsupported -> fix_version -> done_clone -> merged_pr -> unverified -> needed.
 */
export function decideCoverage(
  claim: BackportClaim,
  ctx: CoverageContext,
): Verdict[] {
  const ticket = ctx.tickets.get(claim.key);
  const clones = ctx.clones.get(claim.key) ?? [];
  const evidence = ctx.prEvidence.get(claim.key) ?? [];
  const prefix = jiraPrefix(claim.key);
  const supported = ctx.supportedVersions.get(prefix);

  return claim.versions.map((version) => {
    const normalized = normalizeVersionStream(version);

    if (supported && !supported.includes(normalized)) {
      return {
        key: claim.key,
        version,
        covered: true,
        reason: "unsupported" as const,
        evidence: `${normalized} is not a supported version for ${prefix}`,
      };
    }

    const fixVersion = (ticket?.fix_versions ?? [])
      .map(normalizeVersionStream)
      .find((fv) => fv && fv === normalized);
    if (fixVersion) {
      return {
        key: claim.key,
        version,
        covered: true,
        reason: "fix_version" as const,
        evidence: `${claim.key} fix version ${fixVersion}`,
      };
    }

    for (const clone of clones) {
      if (clone.clone_status_category !== "done") continue;
      const cloneFix = (clone.clone_fix_versions ?? [])
        .map(normalizeVersionStream)
        .find((fv) => fv && fv === normalized);
      if (cloneFix) {
        return {
          key: claim.key,
          version,
          covered: true,
          reason: "done_clone" as const,
          evidence: `${clone.clone_key} (done) fix version ${cloneFix}`,
        };
      }
    }

    const mergedPr = evidence.find((pr) => prTargetsVersion(pr, normalized));
    if (mergedPr) {
      return {
        key: claim.key,
        version,
        covered: true,
        reason: "merged_pr" as const,
        evidence: mergedPr.url || `${mergedPr.repo}#${mergedPr.number}`,
      };
    }

    if (ctx.failedKeys.has(claim.key)) {
      return {
        key: claim.key,
        version,
        covered: false,
        reason: "unverified" as const,
        evidence: `GitHub lookup unavailable for ${claim.key}`,
      };
    }

    return {
      key: claim.key,
      version,
      covered: false,
      reason: "needed" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Markdown rewriting
// ---------------------------------------------------------------------------

/**
 * Removes covered versions from the annotations; strips the suffix entirely
 * when nothing survives. Lines without a generated suffix are never touched.
 */
export function applyVerdicts(
  markdown: string,
  verdicts: Verdict[],
): { markdown: string; dropped: string[]; kept: string[] } {
  const coveredBy = new Map<string, Verdict>();
  for (const verdict of verdicts) {
    if (verdict.covered)
      coveredBy.set(`${verdict.key} ${verdict.version}`, verdict);
  }

  const dropped: string[] = [];
  const kept: string[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = BACKPORT_SUFFIX_RE.exec(line);
    if (!match) continue;
    const key = claimKeyFromLine(line);
    if (!key) continue;

    const versions = match[1].split(", ");
    const surviving = versions.filter(
      (version) => !coveredBy.has(`${key} ${version}`),
    );

    if (surviving.length === versions.length) {
      for (const version of versions) kept.push(`${key} ${version}`);
      continue;
    }

    for (const version of versions) {
      if (surviving.includes(version)) {
        kept.push(`${key} ${version}`);
      } else {
        dropped.push(`${key} ${version}`);
      }
    }

    const markerAt = line.lastIndexOf(BACKPORT_SUFFIX);
    const head = line.slice(0, markerAt);
    lines[i] =
      surviving.length === 0
        ? head
        : `${head}${BACKPORT_SUFFIX}${surviving.join(", ")}`;
  }

  return { markdown: lines.join("\n"), dropped, kept };
}

/**
 * Keeps an LLM prompt context in step with the verified report: removes
 * backport entries whose versions the report no longer claims. The generator
 * renders them as `Backport needed (N): a; b (needs: 4.23.z, 5.0.z)` and
 * `Backport risk: [KEY](url) summary (needs: …)`.
 */
export function reconcileBackportClaims(
  text: string,
  markdown: string,
): string {
  const allowed = new Map<string, string[]>();
  for (const claim of parseBackportClaims(markdown).claims) {
    const known = allowed.get(claim.key) ?? [];
    for (const version of claim.versions) {
      if (!known.includes(version)) known.push(version);
    }
    allowed.set(claim.key, known);
  }

  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes("(needs: ")) {
      keptLines.push(line);
      continue;
    }

    const header = /^(.*Backport needed \()(\d+)(\): )(.*)$/.exec(line);
    if (header) {
      // Summaries keep their own semicolons, so split only where the next
      // entry starts with its ticket link.
      const entries = header[4]
        .split(/; (?=\[[A-Z][A-Z0-9]+-\d+\]\()/)
        .map((entry) => filterNeedsEntry(entry, allowed))
        .filter((entry): entry is string => entry !== null);
      if (entries.length > 0) {
        keptLines.push(
          `${header[1]}${entries.length}${header[3]}${entries.join("; ")}`,
        );
      }
      continue;
    }

    const single = filterNeedsEntry(line, allowed);
    if (single !== null) keptLines.push(single);
  }

  return keptLines.join("\n");
}

function filterNeedsEntry(
  entry: string,
  allowed: Map<string, string[]>,
): string | null {
  const needs = /\(needs: ([^)]*)\)/.exec(entry);
  if (!needs) return entry;
  const key = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(entry);
  if (!key) return entry;

  const permitted = allowed.get(key[1]) ?? [];
  const surviving = needs[1]
    .split(",")
    .map((version) => version.trim())
    .filter((version) => permitted.includes(version));

  if (surviving.length === 0) return null;
  return entry.replace(needs[0], `(needs: ${surviving.join(", ")})`);
}

/**
 * Replaces an existing section (heading through the next `## ` or EOF) or
 * appends it at the end. Applying the same body twice is a no-op.
 */
export function upsertSection(
  markdown: string,
  heading: string,
  body: string,
): string {
  const block = `${heading}\n\n${body.trim()}\n`;
  const normalized = markdown.replace(/\s*$/, "") + "\n";
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === heading);

  if (start === -1) {
    const base = normalized.replace(/\n$/, "");
    return base === "" ? block : `${base}\n\n${block}`;
  }

  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const merged = [...before, ...block.split("\n"), ...after];
  // A trailing empty element from `block` plus a trailing "" from the source
  // would leave a blank line at EOF.
  while (
    merged.length > 1 &&
    merged[merged.length - 1] === "" &&
    merged[merged.length - 2] === ""
  ) {
    merged.pop();
  }
  return merged.join("\n");
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function ageInDays(iso: string, now: Date): number | null {
  if (!iso || iso.trim() === "") return null;
  const timestamp = Date.parse(iso.trim());
  if (!Number.isFinite(timestamp)) return null;
  const days = Math.floor((now.getTime() - timestamp) / DAY_MS);
  return days < 0 ? 0 : days;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function extractKeys(title: string): string[] {
  const keys: string[] = [];
  const re = new RegExp(TICKET_KEY_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(title)) !== null) keys.push(match[1]);
  return keys;
}

function byAgeThenItem(a: RecommendationRow, b: RecommendationRow): number {
  if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
  return a.item.localeCompare(b.item);
}

export function buildRecommendations(
  input: RecommendationsInput,
): RecommendationsResult {
  const {
    verdicts,
    tickets,
    prs,
    jiraBaseUrl,
    now,
    followups,
    jiraDisplayToName,
  } = input;
  const jiraBase = jiraBaseUrl.replace(/\/$/, "");

  // Claims the report still carries: unmet, plus unconfirmed ones when GitHub
  // could not be asked. Deduped because a ticket and its orphan PRs each keep
  // the same annotation.
  const neededByKey = new Map<
    string,
    { versions: string[]; unverified: boolean }
  >();
  for (const verdict of verdicts) {
    if (verdict.reason !== "needed" && verdict.reason !== "unverified")
      continue;
    const entry = neededByKey.get(verdict.key) ?? {
      versions: [],
      unverified: false,
    };
    if (!entry.versions.includes(verdict.version)) {
      entry.versions.push(verdict.version);
    }
    if (verdict.reason === "unverified") entry.unverified = true;
    neededByKey.set(verdict.key, entry);
  }

  const grouped = new Map<RecommendationRow["category"], RecommendationRow[]>();
  for (const category of CATEGORY_ORDER) grouped.set(category, []);

  // 1. Backports still needed.
  for (const [key, entry] of neededByKey) {
    const ticket = tickets.get(key);
    const versions = entry.versions;
    const targets = versions.map(
      (version) => `release-${version.replace(/\.z$/, "")}`,
    );
    const requested = `Needs backport to ${versions.join(", ")}`;
    grouped.get("Backport")!.push({
      category: "Backport",
      item: `[${key}](${jiraBase}/${key})`,
      why: entry.unverified
        ? `${requested} (GitHub evidence unavailable)`
        : requested,
      action:
        targets.length === 1
          ? `Open backport PR to ${targets[0]}`
          : `Open backport PRs to ${targets.join(", ")}`,
      owner: ticket
        ? (jiraDisplayToName?.get(ticket.assignee_name) ?? ticket.assignee_name)
        : "",
      ageDays: ageInDays(ticket?.statuscategorychangedate ?? "", now) ?? 0,
    });
  }

  for (const pr of prs) {
    if (pr.state !== "open") continue;
    const age = ageInDays(pr.updated_at, now);
    const item = `[PR #${pr.number} - ${pr.title}](${pr.url})`;

    // 2. Open backport PR for a version this report still claims.
    const streams = extractReleaseBranchFromTitle(pr.title);
    const backportTarget = streams.find((stream) =>
      extractKeys(pr.title).some((key) =>
        (neededByKey.get(key)?.versions ?? []).includes(stream),
      ),
    );
    if (backportTarget) {
      const prAge = age ?? ageInDays(pr.created_at, now) ?? 0;
      grouped.get("Backport PR")!.push({
        category: "Backport PR",
        item,
        why: `Backport PR open ${prAge}d`,
        action: "Review and merge backport PR",
        owner: pr.engineer,
        ageDays: prAge,
      });
      continue;
    }

    // 3/4. Review and staleness, only when the update time is known.
    if (age === null) continue;
    if (age >= followups.stale_pr_days) {
      grouped.get("Stale PR")!.push({
        category: "Stale PR",
        item,
        why: `Open ${age}d without merge`,
        action: "Unblock: rebase, close, or escalate",
        owner: pr.engineer,
        ageDays: age,
      });
    } else if (age >= followups.pending_review_days) {
      grouped.get("Review")!.push({
        category: "Review",
        item,
        why: `Open ${age}d without merge`,
        action: "Request review or ping reviewer",
        owner: pr.engineer,
        ageDays: age,
      });
    }
  }

  // 5. Stalled in-progress tickets.
  for (const ticket of tickets.values()) {
    if (ticket.status !== "In Progress") continue;
    const age = ageInDays(ticket.statuscategorychangedate, now);
    if (age === null || age < followups.stale_ticket_days) continue;
    grouped.get("Stalled ticket")!.push({
      category: "Stalled ticket",
      item: `[${ticket.key}](${jiraBase}/${ticket.key})`,
      why: `No status change in ${age}d`,
      action: "Check with the assignee or update status",
      owner:
        jiraDisplayToName?.get(ticket.assignee_name) ?? ticket.assignee_name,
      ageDays: age,
    });
  }

  const rows: RecommendationRow[] = [];
  const cappedCounts = new Map<string, number>();
  for (const category of CATEGORY_ORDER) {
    const categoryRows = (grouped.get(category) ?? []).sort(byAgeThenItem);
    const limit = followups.max_rows_per_category;
    if (limit > 0 && categoryRows.length > limit) {
      cappedCounts.set(category, categoryRows.length - limit);
      rows.push(...categoryRows.slice(0, limit));
    } else {
      rows.push(...categoryRows);
    }
  }

  return { rows, cappedCounts };
}

export function renderRecommendations(
  rows: RecommendationRow[],
  cappedCounts: Map<string, number>,
): string {
  const parts: string[] = [
    "Follow-ups from this report that need a small action.",
    "",
  ];

  if (rows.length === 0) {
    parts.push("_No follow-ups this week._");
  } else {
    parts.push("| Item | Why it needs attention | Suggested action | Owner |");
    parts.push("| --- | --- | --- | --- |");
    for (const row of rows) {
      parts.push(
        `| ${escapeCell(row.item)} | ${escapeCell(row.why)} | ${escapeCell(row.action)} | ${escapeCell(row.owner)} |`,
      );
    }
    for (const category of CATEGORY_ORDER) {
      const hidden = cappedCounts.get(category);
      if (hidden) {
        parts.push("");
        parts.push(`_${hidden} more not listed._`);
      }
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Live GitHub evidence
// ---------------------------------------------------------------------------

async function collectPrEvidence(
  keys: string[],
  config: FinalizeConfig,
  request: (url: string) => Promise<Record<string, unknown>>,
): Promise<{ evidence: Map<string, PrEvidence[]>; failed: Set<string> }> {
  const evidence = new Map<string, PrEvidence[]>();
  const failed = new Set<string>();

  for (const key of keys) {
    const prefix = jiraPrefix(key);
    const repos = config.products
      .filter((product) => (product.jira_prefixes ?? []).includes(prefix))
      .flatMap((product) => product.repos ?? []);

    if (repos.length === 0) {
      process.stderr.write(
        `${YELLOW}WARN: no configured repository for ${key}${RESET}\n`,
      );
      failed.add(key);
      continue;
    }

    try {
      const hits: { repo: string; number: number }[] = [];
      for (const repo of repos) {
        const query = encodeURIComponent(`repo:${repo} is:pr "${key}"`);
        const data = await request(
          `https://api.github.com/search/issues?q=${query}&per_page=30`,
        );
        const items = (data.items ?? []) as Array<Record<string, unknown>>;
        for (const item of items) {
          const number = Number(item.number);
          if (Number.isFinite(number) && number > 0) {
            hits.push({ repo, number });
          }
        }
      }

      const found: PrEvidence[] = [];
      for (const hit of hits) {
        const pr = await request(
          `https://api.github.com/repos/${hit.repo}/pulls/${hit.number}`,
        );
        const base = (pr.base ?? {}) as Record<string, unknown>;
        found.push({
          url: typeof pr.html_url === "string" ? pr.html_url : "",
          number: hit.number,
          repo: hit.repo,
          merged_at: typeof pr.merged_at === "string" ? pr.merged_at : "",
          base_ref: typeof base.ref === "string" ? base.ref : "",
          title: typeof pr.title === "string" ? pr.title : "",
        });
      }
      evidence.set(key, found);
    } catch (e: unknown) {
      process.stderr.write(
        `${YELLOW}WARN: GitHub lookup failed for ${key}: ${String(e)}${RESET}\n`,
      );
      failed.add(key);
    }
  }

  return { evidence, failed };
}

// ---------------------------------------------------------------------------
// Cache loading
// ---------------------------------------------------------------------------

function loadTicketFacts(cacheDir: string): Map<string, TicketFacts> {
  const tickets = new Map<string, TicketFacts>();
  for (const row of loadCsvFile(resolve(cacheDir, "jira-tickets.csv"))) {
    const key = row.key ?? "";
    if (!key) continue;
    tickets.set(key, {
      key,
      status: row.status ?? "",
      assignee_name: row.assignee_name ?? "",
      statuscategorychangedate: row.statuscategorychangedate ?? "",
      affected_versions: splitList(row.affected_versions),
      fix_versions: splitList(row.fix_versions),
    });
  }
  return tickets;
}

function loadCloneFacts(cacheDir: string): Map<string, CloneFact[]> {
  const clones = new Map<string, CloneFact[]>();
  for (const row of loadCsvFile(resolve(cacheDir, "clone-links.csv"))) {
    const parent = row.parent_key ?? "";
    if (!parent) continue;
    const list = clones.get(parent) ?? [];
    list.push({
      clone_key: row.clone_key ?? "",
      clone_status_category: row.clone_status_category ?? "",
      clone_fix_versions: splitList(row.clone_fix_versions),
    });
    clones.set(parent, list);
  }
  return clones;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function loadPrRows(cacheDir: string): PrRow[] {
  const rows: PrRow[] = [];
  for (const row of loadCsvFile(resolve(cacheDir, "github-prs.csv"))) {
    rows.push({
      engineer: row.engineer ?? "",
      number: parseInt(row.number ?? "0", 10),
      title: row.title ?? "",
      repo: row.repo ?? "",
      state: row.state ?? "",
      created_at: row.created_at ?? "",
      updated_at: row.updated_at ?? "",
      url: row.html_url ?? "",
    });
  }
  return rows;
}

function supportedVersionsByPrefix(
  config: FinalizeConfig,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [prefix, backport] of Object.entries(config.backport ?? {})) {
    const versions = (backport.supported_versions ?? [])
      .map(normalizeVersionStream)
      .filter(Boolean);
    if (versions.length > 0) map.set(prefix, versions);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  date: string;
  report: string;
  config: string;
  cacheDir: string;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  const localToday = new Date();
  const today = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`;
  const args: Args = {
    date: today,
    report: "",
    config: resolve(DATA_DIR, "team-config.json"),
    cacheDir: resolve(DATA_DIR, "cache"),
    check: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`${RED}ERROR: ${flag} requires a value${RESET}`);
        process.exit(1);
      }
      i++;
      return value;
    };
    switch (flag) {
      case "--date":
        args.date = next();
        break;
      case "--report":
        args.report = next();
        break;
      case "--config":
        args.config = next();
        break;
      case "--cache-dir":
        args.cacheDir = next();
        break;
      case "--check":
        args.check = true;
        break;
      default:
        console.error(`${RED}ERROR: unknown argument: ${flag}${RESET}`);
        process.exit(1);
    }
  }

  if (!args.report) {
    args.report = resolve(DATA_DIR, "output", `weekly-update-${args.date}.md`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.report)) {
    console.error(`${RED}ERROR: report not found: ${args.report}${RESET}`);
    process.exit(1);
  }

  const teamConfig = loadConfig(args.config);
  const config = teamConfig as FinalizeConfig;
  const followups: FollowupsConfig = {
    ...DEFAULT_FOLLOWUPS,
    ...(config.followups ?? {}),
  };

  for (const file of [
    "jira-tickets.csv",
    "clone-links.csv",
    "github-prs.csv",
  ]) {
    const path = resolve(args.cacheDir, file);
    if (!existsSync(path)) {
      console.error(`${RED}ERROR: cache file not found: ${path}${RESET}`);
      process.exit(1);
    }
  }

  const markdown = readFileSync(args.report, "utf-8");
  const { claims, unparsableLines } = parseBackportClaims(markdown);
  if (unparsableLines.length > 0) {
    console.error(
      `${RED}ERROR: unparsable Backport needed annotation on line(s): ${unparsableLines.join(", ")}${RESET}`,
    );
    process.exit(2);
  }

  const tickets = loadTicketFacts(args.cacheDir);
  const clones = loadCloneFacts(args.cacheDir);
  const prs = loadPrRows(args.cacheDir);
  const supportedVersions = supportedVersionsByPrefix(config);

  // Pass 1: Jira-side evidence only. Keys that survive need a GitHub check.
  const preliminary = claims.map((claim) =>
    decideCoverage(claim, {
      tickets,
      clones,
      prEvidence: new Map(),
      failedKeys: new Set(),
      supportedVersions,
    }),
  );
  const pendingKeys = [
    ...new Set(
      preliminary
        .filter((verdicts) => verdicts.some((v) => v.reason === "needed"))
        .map((verdicts) => verdicts[0].key),
    ),
  ];

  // Pass 2: add merged release-branch PR evidence.
  const token = process.env.GITHUB_PAT ?? "";
  let prEvidence = new Map<string, PrEvidence[]>();
  let failedKeys = new Set<string>();
  if (pendingKeys.length > 0) {
    if (!token) {
      console.log(
        `${YELLOW}GITHUB_PAT not set — merged release-branch PRs cannot be checked.${RESET}`,
      );
      failedKeys = new Set(pendingKeys);
    } else {
      console.log(
        `Checking ${pendingKeys.length} backport claim(s) on GitHub...`,
      );
      const result = await collectPrEvidence(
        pendingKeys,
        config,
        createGithubRequest(token),
      );
      prEvidence = result.evidence;
      failedKeys = result.failed;
    }
  }

  const verdicts = claims.flatMap((claim) =>
    decideCoverage(claim, {
      tickets,
      clones,
      prEvidence,
      failedKeys,
      supportedVersions,
    }),
  );

  const applied = applyVerdicts(markdown, verdicts);
  const dropped = applied.dropped;
  const unverified = verdicts.filter((v) => v.reason === "unverified");

  const recommendations = buildRecommendations({
    verdicts,
    tickets,
    prs,
    jiraBaseUrl: config.jira.base_url,
    now: new Date(),
    followups,
    jiraDisplayToName: buildJiraDisplayToName(teamConfig),
  });
  const section = renderRecommendations(
    recommendations.rows,
    recommendations.cappedCounts,
  );
  const next = upsertSection(
    applied.markdown,
    RECOMMENDATIONS_HEADING,
    section,
  );
  const removedClaims = parseBackportClaims(applied.markdown).claims.length;
  const finalMarkdown = next;

  for (const verdict of verdicts) {
    if (!verdict.covered) continue;
    console.log(
      `  drop ${verdict.key} ${verdict.version} (${verdict.reason}: ${verdict.evidence ?? "n/a"})`,
    );
  }
  for (const verdict of unverified) {
    console.log(
      `${YELLOW}  unverified ${verdict.key} ${verdict.version} — kept${RESET}`,
    );
  }
  console.log(
    `Backport claims: ${claims.length} line(s), ${dropped.length} version(s) dropped, ${removedClaims} line(s) kept.`,
  );
  console.log(`Recommendations: ${recommendations.rows.length} row(s).`);

  if (args.check) {
    if (finalMarkdown === markdown) {
      console.log(`${GREEN}no changes${RESET}`);
      process.exit(unverified.length > 0 ? 3 : 0);
    }
    console.log(`${YELLOW}--check: report would change${RESET}`);
    process.exit(3);
  }

  if (finalMarkdown !== markdown) {
    writeFileSync(args.report, finalMarkdown);
    console.log(`Updated ${args.report}`);
  } else {
    console.log(`${GREEN}no changes${RESET}`);
  }

  mkdirSync(args.cacheDir, { recursive: true });
  writeFileSync(
    resolve(args.cacheDir, "backport-verification.json"),
    JSON.stringify(
      { generated_at: new Date().toISOString(), verdicts },
      null,
      2,
    ) + "\n",
  );

  if (unverified.length > 0) {
    console.error(
      `\n${YELLOW}Warnings present — ${unverified.length} backport claim(s) could not be verified against GitHub.${RESET}`,
    );
    process.exit(3);
  }

  process.exit(0);
}

const isDirectRun = process.argv[1]?.endsWith("finalize-report.ts");
if (isDirectRun) {
  main().catch((e: unknown) => {
    console.error(`${RED}ERROR: ${String(e)}${RESET}`);
    process.exit(1);
  });
}
