#!/usr/bin/env tsx
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { readdirSync } from "node:fs";

const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const BLUE = "\x1b[94m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkInfo {
  line_num: number;
  link_text: string;
  url: string;
  engineer: string | null;
}

export interface LinkResult {
  link: LinkInfo;
  status: "ok" | "error" | "warning";
  message: string;
}

interface EngineerMaps {
  github: Map<string, string>;
  gitlab: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function loadEngineerMaps(configPath: string): EngineerMaps {
  if (!existsSync(configPath)) {
    console.log(
      `${YELLOW}WARN: team config not found at ${configPath}, author checks disabled${RESET}`,
    );
    return { github: new Map(), gitlab: new Map() };
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
    engineers: { name: string; github: string; gitlab: string }[];
  };
  const github = new Map<string, string>(
    config.engineers.map((e) => [e.name, e.github]),
  );
  const gitlab = new Map<string, string>(
    config.engineers.map((e) => [e.name, e.gitlab]),
  );
  return { github, gitlab };
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

export function parseLinks(content: string): LinkInfo[] {
  const lines = content.split("\n");
  const links: LinkInfo[] = [];
  let currentEngineer: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const engMatch = line.match(/^\*\*([A-Z][a-z]+ [A-Z][a-z]+)/);
    if (engMatch) {
      currentEngineer = engMatch[1];
    }

    const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      links.push({
        line_num: lineNum,
        link_text: m[1],
        url: m[2],
        engineer: currentEngineer,
      });
    }
  }

  return links;
}

export function classifyLinks(links: LinkInfo[]): {
  github_pr: LinkInfo[];
  gitlab_mr: LinkInfo[];
  jira: LinkInfo[];
  other: LinkInfo[];
} {
  const classified = {
    github_pr: [] as LinkInfo[],
    gitlab_mr: [] as LinkInfo[],
    jira: [] as LinkInfo[],
    other: [] as LinkInfo[],
  };
  for (const link of links) {
    if (link.url.includes("github.com") && link.url.includes("/pull/")) {
      classified.github_pr.push(link);
    } else if (
      link.url.includes("gitlab") &&
      link.url.includes("/merge_requests/")
    ) {
      classified.gitlab_mr.push(link);
    } else if (link.url.includes("atlassian.net/browse/")) {
      classified.jira.push(link);
    } else {
      classified.other.push(link);
    }
  }
  return classified;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function apiGet(
  url: string,
  token: string,
  tokenType: "token" | "bearer" = "token",
): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (tokenType === "token") {
    headers.Authorization = `token ${token}`;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verifyGithubPrSync(link: LinkInfo): LinkResult {
  const m = link.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) {
    return { link, status: "error", message: "Could not parse GitHub PR URL" };
  }

  const [, , , prNum] = m;

  const textNum = link.link_text.match(/#(\d+)/);
  if (textNum && textNum[1] !== prNum) {
    return {
      link,
      status: "error",
      message: `PR number mismatch: text says #${textNum[1]} but URL has /pull/${prNum}`,
    };
  }

  return { link, status: "ok", message: `PR #${prNum} — URL format valid` };
}

export function verifyGitlabMrSync(link: LinkInfo): LinkResult {
  const m = link.url.match(/gitlab[^/]*\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) {
    return { link, status: "error", message: "Could not parse GitLab MR URL" };
  }

  const [, , mrIid] = m;

  const textNum = link.link_text.match(/(?:MR |!)(\d+)/);
  if (textNum && textNum[1] !== mrIid) {
    return {
      link,
      status: "error",
      message: `MR number mismatch: text says !${textNum[1]} but URL has /merge_requests/${mrIid}`,
    };
  }

  return { link, status: "ok", message: `MR !${mrIid} — URL format valid` };
}

export function verifyJira(link: LinkInfo): LinkResult {
  const m = link.url.match(/\/browse\/([A-Z]+-\d+)/);
  if (!m) {
    return {
      link,
      status: "error",
      message: "Could not parse Jira ticket URL",
    };
  }
  const ticket = m[1];

  const textTicket = link.link_text.match(/([A-Z]+-\d+)/);
  if (textTicket && textTicket[1] !== ticket) {
    return {
      link,
      status: "error",
      message: `Ticket mismatch: text says ${textTicket[1]} but URL has ${ticket}`,
    };
  }

  return { link, status: "ok", message: ticket };
}

// ---------------------------------------------------------------------------
// ReportLinkValidator
// ---------------------------------------------------------------------------

export class ReportLinkValidator {
  private agentRoot: string;
  private verbose: boolean;
  results: LinkResult[] = [];
  private githubToken: string | undefined;
  private gitlabToken: string | undefined;
  private engineerGithub: Map<string, string>;
  private engineerGitlab: Map<string, string>;

  constructor(agentRoot: string, verbose: boolean = false) {
    this.agentRoot = agentRoot;
    this.verbose = verbose;
    this.githubToken = process.env.GITHUB_PAT;
    this.gitlabToken = process.env.GITLAB_PAT;
    const configPath = resolve(this.agentRoot, "data", "team-config.json");
    const maps = loadEngineerMaps(configPath);
    this.engineerGithub = maps.github;
    this.engineerGitlab = maps.gitlab;
  }

  async verifyGithubPr(link: LinkInfo): Promise<LinkResult> {
    const m = link.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) {
      return {
        link,
        status: "error",
        message: "Could not parse GitHub PR URL",
      };
    }

    const [, owner, repo, prNum] = m;

    const textNum = link.link_text.match(/#(\d+)/);
    if (textNum && textNum[1] !== prNum) {
      return {
        link,
        status: "error",
        message: `PR number mismatch: text says #${textNum[1]} but URL has /pull/${prNum}`,
      };
    }

    if (!this.githubToken) {
      return {
        link,
        status: "warning",
        message: "No GITHUB_PAT — skipped API check",
      };
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNum}`;
    const data = await apiGet(apiUrl, this.githubToken);

    if (data === null) {
      return {
        link,
        status: "error",
        message: `404 NOT FOUND: ${owner}/${repo}/pull/${prNum}`,
      };
    }

    const actualAuthor =
      ((data.user as Record<string, unknown>)?.login as string) ?? "unknown";
    if (link.engineer) {
      const expected = this.engineerGithub.get(link.engineer);
      if (expected && actualAuthor !== expected) {
        return {
          link,
          status: "error",
          message: `WRONG AUTHOR: expected ${expected}, got ${actualAuthor}`,
        };
      }
    }

    const actualTitle = (data.title as string) ?? "";
    let descInText = link.link_text.replace(/^(PR #\d+ - |MR \d+ - )/, "");
    descInText = descInText.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (
      descInText &&
      actualTitle &&
      !descInText.toLowerCase().includes(actualTitle.toLowerCase()) &&
      !actualTitle.toLowerCase().includes(descInText.toLowerCase())
    ) {
      return {
        link,
        status: "warning",
        message: `Title drift: text='${descInText}' vs actual='${actualTitle.slice(0, 60)}'`,
      };
    }

    const state = (data.state as string) ?? "unknown";
    const merged = (data.merged as boolean) ?? false;
    const statusStr = merged ? "merged" : state;
    return {
      link,
      status: "ok",
      message: `${owner}/${repo} #${prNum} (${actualAuthor}, ${statusStr})`,
    };
  }

  async verifyGitlabMr(link: LinkInfo): Promise<LinkResult> {
    const m = link.url.match(/gitlab[^/]*\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (!m) {
      return {
        link,
        status: "error",
        message: "Could not parse GitLab MR URL",
      };
    }

    const [, projectPath, mrIid] = m;

    const textNum = link.link_text.match(/(?:MR |!)(\d+)/);
    if (textNum && textNum[1] !== mrIid) {
      return {
        link,
        status: "error",
        message: `MR number mismatch: text says !${textNum[1]} but URL has /merge_requests/${mrIid}`,
      };
    }

    if (!this.gitlabToken) {
      return {
        link,
        status: "warning",
        message: "No GITLAB_PAT — skipped API check",
      };
    }

    const encodedPath = projectPath.replace(/\//g, "%2F");
    const apiUrl = `https://gitlab.cee.redhat.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`;
    const data = await apiGet(apiUrl, this.gitlabToken, "bearer");

    if (data === null) {
      return {
        link,
        status: "error",
        message: `404 NOT FOUND: ${projectPath}!${mrIid}`,
      };
    }

    const actualAuthor =
      ((data.author as Record<string, unknown>)?.username as string) ??
      "unknown";
    if (link.engineer) {
      const expected = this.engineerGitlab.get(link.engineer);
      if (expected && actualAuthor !== expected) {
        return {
          link,
          status: "error",
          message: `WRONG AUTHOR: expected ${expected}, got ${actualAuthor}`,
        };
      }
    }

    const state = (data.state as string) ?? "unknown";
    return {
      link,
      status: "ok",
      message: `${projectPath} !${mrIid} (${actualAuthor}, ${state})`,
    };
  }

  private printResult(result: LinkResult): void {
    if (result.status === "ok") {
      if (this.verbose) {
        console.log(
          `  ${GREEN}✓${RESET} Line ${result.link.line_num}: ${result.message}`,
        );
      }
    } else if (result.status === "warning") {
      console.log(
        `  ${YELLOW}⚠${RESET} Line ${result.link.line_num}: ${result.message}`,
      );
    } else {
      console.log(
        `  ${RED}✗${RESET} Line ${result.link.line_num}: ${result.link.link_text}`,
      );
      console.log(`    ${RED}${result.message}${RESET}`);
    }
  }

  private printSummary(): boolean {
    const total = this.results.length;
    const ok = this.results.filter((r) => r.status === "ok").length;
    const warnings = this.results.filter((r) => r.status === "warning").length;
    const errors = this.results.filter((r) => r.status === "error").length;

    console.log(`\n${BLUE}${"=".repeat(60)}${RESET}`);
    let summary = `Summary: ${total} checked, ${GREEN}${ok} passed${RESET}, `;
    if (warnings) {
      summary += `${YELLOW}${warnings} warnings${RESET}, `;
    }
    if (errors) {
      summary += `${RED}${errors} broken${RESET}`;
    } else {
      summary += `${GREEN}0 broken${RESET}`;
    }
    console.log(summary);
    console.log(`${BLUE}${"=".repeat(60)}${RESET}\n`);

    return errors === 0;
  }

  async validate(filePath: string): Promise<boolean> {
    console.log(`\n${BLUE}${"=".repeat(60)}${RESET}`);
    console.log(`${BLUE}Report Link Validation${RESET}`);
    console.log(`${BLUE}${"=".repeat(60)}${RESET}`);
    console.log(`\nValidating: ${filePath}\n`);

    const content = readFileSync(filePath, "utf-8");
    const links = parseLinks(content);
    const classified = classifyLinks(links);

    if (classified.github_pr.length > 0) {
      console.log(
        `\n${BLUE}GitHub PRs (${classified.github_pr.length})${RESET}`,
      );
      for (const link of classified.github_pr) {
        const result = await this.verifyGithubPr(link);
        this.results.push(result);
        this.printResult(result);
      }
    }

    if (classified.gitlab_mr.length > 0) {
      console.log(
        `\n${BLUE}GitLab MRs (${classified.gitlab_mr.length})${RESET}`,
      );
      for (const link of classified.gitlab_mr) {
        const result = await this.verifyGitlabMr(link);
        this.results.push(result);
        this.printResult(result);
      }
    }

    if (classified.jira.length > 0) {
      console.log(`\n${BLUE}Jira Tickets (${classified.jira.length})${RESET}`);
      for (const link of classified.jira) {
        const result = verifyJira(link);
        this.results.push(result);
        this.printResult(result);
      }
    }

    return this.printSummary();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLatestReport(agentRoot: string): string | null {
  const reportDir = resolve(agentRoot, "data", "output");
  if (!existsSync(reportDir)) return null;
  const reports = readdirSync(reportDir)
    .filter((f) => f.startsWith("weekly-update-") && f.endsWith(".md"))
    .sort()
    .reverse();
  return reports.length > 0 ? resolve(reportDir, reports[0]) : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let filePath: string | null = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  const scriptDir = dirname(resolve(process.argv[1]));
  const agentRoot = resolve(scriptDir, "..");

  if (filePath) {
    if (!filePath.startsWith("/")) {
      filePath = resolve(process.cwd(), filePath);
    }
  } else {
    filePath = findLatestReport(agentRoot);
    if (!filePath) {
      console.log(
        `${RED}No weekly reports found in agents/weekly-team-update/data/output/${RESET}`,
      );
      process.exit(1);
    }
  }

  if (!existsSync(filePath)) {
    console.log(`${RED}File not found: ${filePath}${RESET}`);
    process.exit(1);
  }

  const validator = new ReportLinkValidator(agentRoot, verbose);
  const success = await validator.validate(filePath);
  process.exit(success ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""));
if (isMain) {
  void main();
}
