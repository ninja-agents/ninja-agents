#!/usr/bin/env python3
"""
Report Link Validation Script

Parses a weekly report markdown file, extracts all GitHub PR, GitLab MR,
and Jira links, then verifies each via API calls.

Engineer username mappings are loaded from data/team-config.json (not hardcoded).

Usage:
  python3 scripts/validate-report-links.py                              # latest report
  python3 scripts/validate-report-links.py path/to/report.md            # specific file
  python3 scripts/validate-report-links.py --verbose                    # show all checks
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
BLUE = '\033[94m'
DIM = '\033[2m'
RESET = '\033[0m'


def load_engineer_maps(config_path: Path) -> tuple:
    if not config_path.exists():
        print(f"{YELLOW}WARN: team config not found at {config_path}, author checks disabled{RESET}")
        return {}, {}
    with open(config_path) as f:
        config = json.load(f)
    github_map = {e["name"]: e["github"] for e in config["engineers"]}
    gitlab_map = {e["name"]: e["gitlab"] for e in config["engineers"]}
    return github_map, gitlab_map


class LinkInfo(NamedTuple):
    line_num: int
    link_text: str
    url: str
    engineer: Optional[str]


class LinkResult(NamedTuple):
    link: LinkInfo
    status: str  # "ok", "error", "warning"
    message: str


class ReportLinkValidator:
    def __init__(self, project_root: Path, verbose: bool = False):
        self.project_root = project_root
        self.verbose = verbose
        self.results: List[LinkResult] = []
        self._github_token = None
        self._gitlab_token = None
        self._load_tokens()
        config_path = project_root / "data" / "team-config.json"
        self._engineer_github, self._engineer_gitlab = load_engineer_maps(config_path)

    def _load_tokens(self):
        env_path = self.project_root / ".env"
        if not env_path.exists():
            return
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                if key == "GITHUB_PAT":
                    self._github_token = val
                elif key == "GITLAB_PAT":
                    self._gitlab_token = val

    def _api_get(self, url: str, token: str, token_type: str = "token") -> Optional[dict]:
        headers = {"Accept": "application/json"}
        if token_type == "token":
            headers["Authorization"] = f"token {token}"
        elif token_type == "bearer":
            headers["Authorization"] = f"Bearer {token}"
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=15) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            if e.code == 404:
                return None
            raise
        except (URLError, TimeoutError):
            return None

    def parse_links(self, file_path: Path) -> List[LinkInfo]:
        with open(file_path) as f:
            lines = f.readlines()

        links: List[LinkInfo] = []
        current_engineer = None

        for line_num, line in enumerate(lines, start=1):
            eng_match = re.match(r'\*\*([A-Z][a-z]+ [A-Z][a-z]+)', line)
            if eng_match:
                current_engineer = eng_match.group(1)

            for m in re.finditer(r'\[([^\]]+)\]\((https?://[^)]+)\)', line):
                link_text, url = m.group(1), m.group(2)
                links.append(LinkInfo(line_num, link_text, url, current_engineer))

        return links

    def classify_links(self, links: List[LinkInfo]) -> Dict[str, List[LinkInfo]]:
        classified = {"github_pr": [], "gitlab_mr": [], "jira": [], "other": []}
        for link in links:
            if "github.com" in link.url and "/pull/" in link.url:
                classified["github_pr"].append(link)
            elif "gitlab" in link.url and "/merge_requests/" in link.url:
                classified["gitlab_mr"].append(link)
            elif "atlassian.net/browse/" in link.url:
                classified["jira"].append(link)
            else:
                classified["other"].append(link)
        return classified

    def verify_github_pr(self, link: LinkInfo) -> LinkResult:
        m = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', link.url)
        if not m:
            return LinkResult(link, "error", "Could not parse GitHub PR URL")

        owner, repo, pr_num = m.group(1), m.group(2), m.group(3)

        text_num = re.search(r'#(\d+)', link.link_text)
        if text_num and text_num.group(1) != pr_num:
            return LinkResult(link, "error",
                f"PR number mismatch: text says #{text_num.group(1)} but URL has /pull/{pr_num}")

        if not self._github_token:
            return LinkResult(link, "warning", "No GITHUB_PAT — skipped API check")

        api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_num}"
        data = self._api_get(api_url, self._github_token)

        if data is None:
            return LinkResult(link, "error", f"404 NOT FOUND: {owner}/{repo}/pull/{pr_num}")

        actual_author = data.get("user", {}).get("login", "unknown")
        if link.engineer:
            expected = self._engineer_github.get(link.engineer)
            if expected and actual_author != expected:
                return LinkResult(link, "error",
                    f"WRONG AUTHOR: expected {expected}, got {actual_author}")

        actual_title = data.get("title", "")
        desc_in_text = re.sub(r'^(PR #\d+ - |MR \d+ - )', '', link.link_text)
        desc_in_text = re.sub(r'\s*\([^)]*\)\s*$', '', desc_in_text).strip()
        if desc_in_text and actual_title and desc_in_text.lower() not in actual_title.lower() and actual_title.lower() not in desc_in_text.lower():
            return LinkResult(link, "warning",
                f"Title drift: text='{desc_in_text}' vs actual='{actual_title[:60]}'")

        state = data.get("state", "unknown")
        merged = data.get("merged", False)
        status_str = "merged" if merged else state
        return LinkResult(link, "ok",
            f"{owner}/{repo} #{pr_num} ({actual_author}, {status_str})")

    def verify_gitlab_mr(self, link: LinkInfo) -> LinkResult:
        m = re.search(r'gitlab[^/]*/(.+?)/-/merge_requests/(\d+)', link.url)
        if not m:
            return LinkResult(link, "error", "Could not parse GitLab MR URL")

        project_path, mr_iid = m.group(1), m.group(2)

        text_num = re.search(r'(?:MR |!)(\d+)', link.link_text)
        if text_num and text_num.group(1) != mr_iid:
            return LinkResult(link, "error",
                f"MR number mismatch: text says !{text_num.group(1)} but URL has /merge_requests/{mr_iid}")

        if not self._gitlab_token:
            return LinkResult(link, "warning", "No GITLAB_PAT — skipped API check")

        encoded_path = project_path.replace("/", "%2F")
        api_url = f"https://gitlab.cee.redhat.com/api/v4/projects/{encoded_path}/merge_requests/{mr_iid}"
        data = self._api_get(api_url, self._gitlab_token, token_type="bearer")

        if data is None:
            return LinkResult(link, "error", f"404 NOT FOUND: {project_path}!{mr_iid}")

        actual_author = data.get("author", {}).get("username", "unknown")
        if link.engineer:
            expected = self._engineer_gitlab.get(link.engineer)
            if expected and actual_author != expected:
                return LinkResult(link, "error",
                    f"WRONG AUTHOR: expected {expected}, got {actual_author}")

        actual_title = data.get("title", "")
        state = data.get("state", "unknown")
        return LinkResult(link, "ok",
            f"{project_path} !{mr_iid} ({actual_author}, {state})")

    def verify_jira(self, link: LinkInfo) -> LinkResult:
        m = re.search(r'/browse/([A-Z]+-\d+)', link.url)
        if not m:
            return LinkResult(link, "error", "Could not parse Jira ticket URL")
        ticket = m.group(1)

        text_ticket = re.search(r'([A-Z]+-\d+)', link.link_text)
        if text_ticket and text_ticket.group(1) != ticket:
            return LinkResult(link, "error",
                f"Ticket mismatch: text says {text_ticket.group(1)} but URL has {ticket}")

        return LinkResult(link, "ok", f"{ticket}")

    def validate(self, file_path: Path) -> bool:
        print(f"\n{BLUE}{'='*60}{RESET}")
        print(f"{BLUE}Report Link Validation{RESET}")
        print(f"{BLUE}{'='*60}{RESET}")
        print(f"\nValidating: {file_path}\n")

        links = self.parse_links(file_path)
        classified = self.classify_links(links)

        if classified["github_pr"]:
            print(f"\n{BLUE}GitHub PRs ({len(classified['github_pr'])}){RESET}")
            for link in classified["github_pr"]:
                result = self.verify_github_pr(link)
                self.results.append(result)
                self._print_result(result)

        if classified["gitlab_mr"]:
            print(f"\n{BLUE}GitLab MRs ({len(classified['gitlab_mr'])}){RESET}")
            for link in classified["gitlab_mr"]:
                result = self.verify_gitlab_mr(link)
                self.results.append(result)
                self._print_result(result)

        if classified["jira"]:
            print(f"\n{BLUE}Jira Tickets ({len(classified['jira'])}){RESET}")
            for link in classified["jira"]:
                result = self.verify_jira(link)
                self.results.append(result)
                self._print_result(result)

        return self._print_summary()

    def _print_result(self, result: LinkResult):
        if result.status == "ok":
            if self.verbose:
                print(f"  {GREEN}✓{RESET} Line {result.link.line_num}: {result.message}")
        elif result.status == "warning":
            print(f"  {YELLOW}⚠{RESET} Line {result.link.line_num}: {result.message}")
        elif result.status == "error":
            print(f"  {RED}✗{RESET} Line {result.link.line_num}: {result.link.link_text}")
            print(f"    {RED}{result.message}{RESET}")

    def _print_summary(self) -> bool:
        total = len(self.results)
        ok = sum(1 for r in self.results if r.status == "ok")
        warnings = sum(1 for r in self.results if r.status == "warning")
        errors = sum(1 for r in self.results if r.status == "error")

        print(f"\n{BLUE}{'='*60}{RESET}")
        print(f"Summary: {total} checked, {GREEN}{ok} passed{RESET}, ", end="")
        if warnings:
            print(f"{YELLOW}{warnings} warnings{RESET}, ", end="")
        if errors:
            print(f"{RED}{errors} broken{RESET}")
        else:
            print(f"{GREEN}0 broken{RESET}")
        print(f"{BLUE}{'='*60}{RESET}\n")

        return errors == 0


def find_latest_report(project_root: Path) -> Optional[Path]:
    report_dir = project_root / "data" / "team-wide"
    if not report_dir.exists():
        return None
    reports = sorted(report_dir.glob("weekly-update-*.md"), reverse=True)
    return reports[0] if reports else None


def main():
    parser = argparse.ArgumentParser(
        description="Validate links in weekly team reports"
    )
    parser.add_argument(
        "file",
        nargs="?",
        help="Path to report markdown file (default: latest in data/team-wide/)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show all checks including passing ones"
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    if args.file:
        file_path = Path(args.file)
        if not file_path.is_absolute():
            file_path = Path.cwd() / file_path
    else:
        file_path = find_latest_report(project_root)
        if not file_path:
            print(f"{RED}No weekly reports found in data/team-wide/{RESET}")
            sys.exit(1)

    if not file_path.exists():
        print(f"{RED}File not found: {file_path}{RESET}")
        sys.exit(1)

    validator = ReportLinkValidator(project_root, verbose=args.verbose)
    success = validator.validate(file_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
