#!/usr/bin/env python3
"""
Generate Weekly Team Report from cached CSV data.

Reads team-wide CSVs from data/cache/team-wide/, applies date filtering,
nests PRs under Jira tickets, organizes by product/engineer, and outputs
formatted markdown.

Exit codes:
  0 — Success, report generated
  1 — Script error (bug or bad arguments)
  2 — Data quality error (missing/empty CSVs — agent should retry)
  3 — Warnings present but report generated

Usage:
  python3 scripts/generate-weekly-report.py --date 2026-05-05
  python3 scripts/generate-weekly-report.py --date 2026-05-05 --cache-dir data/cache/team-wide
"""

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
RESET = '\033[0m'

TICKET_ID_RE = re.compile(r'((?:MTV|MTA|CNV|OCPBUGS|CONSOLE)-\d+)')
JIRA_GITHUB_REF_RE = re.compile(r'\[([a-zA-Z0-9_-]+)#(\d+)\]')

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class PRItem:
    engineer: str
    number: int
    title: str
    repo: str
    state: str
    created_at: str
    merged_at: str
    url: str
    source: str  # "github" or "gitlab"
    issue_refs: List[str] = field(default_factory=list)
    ticket_id: Optional[str] = None

@dataclass
class JiraItem:
    engineer: str
    key: str
    summary: str
    status: str
    resolution: str
    resolutiondate: str
    issuetype: str
    priority: str
    url: str
    role: str = "assignee"  # "assignee" or "qa_contact"
    nested_prs: List[PRItem] = field(default_factory=list)

@dataclass
class EngineerBlock:
    name: str
    completed_tickets: List[JiraItem] = field(default_factory=list)
    completed_prs: List[PRItem] = field(default_factory=list)
    in_progress_tickets: List[JiraItem] = field(default_factory=list)
    in_progress_prs: List[PRItem] = field(default_factory=list)

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config(config_path: Path) -> dict:
    if not config_path.exists():
        print(f"{RED}ERROR: team config not found: {config_path}{RESET}", file=sys.stderr)
        sys.exit(1)
    with open(config_path) as f:
        return json.load(f)


def build_account_id_to_name(config: dict) -> Dict[str, str]:
    return {e["jira_account_id"]: e["name"] for e in config["engineers"]}


def build_jira_display_to_name(config: dict) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for e in config["engineers"]:
        for dn in e.get("jira_display_names", []):
            mapping[dn] = e["name"]
    return mapping


def build_github_to_name(config: dict) -> Dict[str, str]:
    return {e["github"]: e["name"] for e in config["engineers"]}


def build_engineer_products(config: dict) -> Dict[str, List[str]]:
    return {e["name"]: e["products"] for e in config["engineers"]}


def build_repo_to_product(config: dict) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for p in config["products"]:
        for repo in p["repos"]:
            mapping[repo] = p["key"]
            parts = repo.split("/")
            if len(parts) == 2:
                mapping[parts[1]] = p["key"]
    for repo, product in config.get("ocpbugs_repo_to_product", {}).items():
        mapping[repo] = product
    return mapping


def build_prefix_to_product(config: dict) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for p in config["products"]:
        for prefix in p["jira_prefixes"]:
            mapping[prefix] = p["key"]
    return mapping

# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------

def parse_date(s: str) -> Optional[datetime]:
    if not s or s.strip() == "":
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s.replace("+0000", "+00:00").rstrip("Z") + "Z"
                                   if "T" in s and not s.endswith("Z") and "+" not in s and "-" not in s[11:]
                                   else s, fmt)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    except ValueError:
        return None


def load_csv_file(path: Path) -> List[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        content = f.read()
    if not content.strip():
        return []
    reader = csv.DictReader(io.StringIO(content))
    rows = []
    for row in reader:
        rows.append(row)
    return rows


def load_github_prs(cache_dir: Path) -> List[PRItem]:
    rows = load_csv_file(cache_dir / "github-prs.csv")
    items = []
    for r in rows:
        try:
            refs_str = r.get("issue_refs", "")
            refs_raw = [x.strip() for x in refs_str.replace(";", ",").split(",") if x.strip()] if refs_str else []
            refs = [r.lstrip("#") for r in refs_raw]
            items.append(PRItem(
                engineer=r.get("engineer", ""),
                number=int(r.get("number", 0)),
                title=r.get("title", ""),
                repo=r.get("repo", ""),
                state=r.get("state", ""),
                created_at=r.get("created_at", ""),
                merged_at=r.get("merged_at", ""),
                url=r.get("html_url", ""),
                source="github",
                issue_refs=refs,
            ))
        except (ValueError, KeyError) as e:
            print(f"{YELLOW}WARN: skipping malformed GitHub PR row: {e}{RESET}", file=sys.stderr)
    return items


def load_gitlab_mrs(cache_dir: Path) -> List[PRItem]:
    rows = load_csv_file(cache_dir / "gitlab-mrs.csv")
    items = []
    for r in rows:
        try:
            items.append(PRItem(
                engineer=r.get("engineer", ""),
                number=int(r.get("iid", 0)),
                title=r.get("title", ""),
                repo=r.get("project_path", ""),
                state=r.get("state", ""),
                created_at=r.get("created_at", ""),
                merged_at=r.get("merged_at", ""),
                url=r.get("web_url", ""),
                source="gitlab",
            ))
        except (ValueError, KeyError) as e:
            print(f"{YELLOW}WARN: skipping malformed GitLab MR row: {e}{RESET}", file=sys.stderr)
    return items


def load_jira_tickets(cache_dir: Path, config: dict) -> List[JiraItem]:
    rows = load_csv_file(cache_dir / "jira-tickets.csv")
    account_id_to_name = build_account_id_to_name(config)
    jira_display_to_name = build_jira_display_to_name(config)
    items = []
    for r in rows:
        key = r.get("key", "")
        url = r.get("url", "")
        if not url or not url.startswith("http"):
            url = f"https://redhat.atlassian.net/browse/{key}"

        engineer = r.get("engineer", "")
        role = r.get("role", "assignee")

        if not engineer:
            assignee_id = r.get("assignee_id", "")
            assignee_name = r.get("assignee_name", "")
            qa_id = r.get("qa_contact_id", "")
            qa_name = r.get("qa_contact_name", "")

            if assignee_id and assignee_id in account_id_to_name:
                engineer = account_id_to_name[assignee_id]
                role = "assignee"
            elif assignee_name and assignee_name in jira_display_to_name:
                engineer = jira_display_to_name[assignee_name]
                role = "assignee"
            elif qa_id and qa_id in account_id_to_name:
                engineer = account_id_to_name[qa_id]
                role = "qa_contact"
            elif qa_name and qa_name in jira_display_to_name:
                engineer = jira_display_to_name[qa_name]
                role = "qa_contact"
            else:
                continue

        items.append(JiraItem(
            engineer=engineer,
            key=key,
            summary=r.get("summary", ""),
            status=r.get("status", ""),
            resolution=r.get("resolution", ""),
            resolutiondate=r.get("resolutiondate", ""),
            issuetype=r.get("issuetype", ""),
            priority=r.get("priority", ""),
            url=url,
            role=role,
        ))
    return items

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_data(github_prs: List[PRItem], gitlab_mrs: List[PRItem],
                  jira_tickets: List[JiraItem], config: dict) -> Tuple[List[str], List[str]]:
    warnings: List[str] = []
    errors: List[str] = []

    if not github_prs:
        errors.append("github-prs.csv is empty or missing")
    if not jira_tickets:
        errors.append("jira-tickets.csv is empty or missing")

    merged_prs = [p for p in github_prs if p.state in ("merged", "closed") and p.merged_at]
    if len(merged_prs) < 5:
        warnings.append(f"Only {len(merged_prs)} merged GitHub PRs found (expected 10-50)")
    if len(merged_prs) < 10 and len(merged_prs) >= 5:
        warnings.append(f"Low GitHub PR count: {len(merged_prs)} merged (expected 15-50)")

    engineer_names = {e["name"] for e in config["engineers"]}
    active_engineers = set()
    for p in github_prs:
        if p.engineer in engineer_names:
            active_engineers.add(p.engineer)
    for m in gitlab_mrs:
        if m.engineer in engineer_names:
            active_engineers.add(m.engineer)
    for t in jira_tickets:
        if t.engineer in engineer_names:
            active_engineers.add(t.engineer)
    missing = engineer_names - active_engineers
    if len(missing) > 2:
        warnings.append(f"Engineers with 0 activity: {', '.join(sorted(missing))}")

    return warnings, errors

# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def filter_completed_prs(prs: List[PRItem], window_start: datetime,
                         window_end: datetime) -> List[PRItem]:
    result = []
    for p in prs:
        if p.state not in ("merged", "closed") or not p.merged_at:
            continue
        merged = parse_date(p.merged_at)
        if merged and window_start <= merged <= window_end:
            result.append(p)
    return result


def filter_open_prs(prs: List[PRItem]) -> List[PRItem]:
    return [p for p in prs if p.state in ("open", "opened")]


def filter_completed_jira(tickets: List[JiraItem], window_start: datetime,
                          window_end: datetime) -> List[JiraItem]:
    result = []
    for t in tickets:
        if t.resolution != "Done":
            continue
        rd = parse_date(t.resolutiondate)
        if rd and window_start <= rd <= window_end:
            result.append(t)
    return result


def filter_in_progress_jira(tickets: List[JiraItem]) -> List[JiraItem]:
    closed_statuses = {"Done", "Closed", "Resolved", "Verified"}
    return [t for t in tickets if t.status not in closed_statuses]

# ---------------------------------------------------------------------------
# Nesting & product mapping
# ---------------------------------------------------------------------------

def extract_ticket_ids(title: str) -> List[str]:
    return TICKET_ID_RE.findall(title)


def _build_github_ref_index(tickets: List[JiraItem]) -> Dict[Tuple[str, str, str], str]:
    """Build mapping from (repo_name, issue_number, engineer) -> ticket key
    using [repo#N] in Jira summaries. Allows precise matching via PR issue_refs."""
    index: Dict[Tuple[str, str, str], str] = {}
    for t in tickets:
        m = JIRA_GITHUB_REF_RE.search(t.summary)
        if m:
            repo_name, issue_num = m.group(1), m.group(2)
            index[(repo_name, issue_num, t.engineer)] = t.key
    return index


def nest_prs_under_tickets(completed_prs: List[PRItem],
                           completed_tickets: List[JiraItem]) -> Tuple[List[JiraItem], List[PRItem]]:
    ticket_map = {t.key: t for t in completed_tickets}
    github_ref_index = _build_github_ref_index(completed_tickets)
    orphan_prs: List[PRItem] = []

    for pr in completed_prs:
        ids = extract_ticket_ids(pr.title)
        nested = False
        for tid in ids:
            if tid in ticket_map:
                ticket_map[tid].nested_prs.append(pr)
                pr.ticket_id = tid
                nested = True
                break
        if nested:
            continue

        matched = False
        for ref in pr.issue_refs:
            if ref in ticket_map:
                ticket_map[ref].nested_prs.append(pr)
                pr.ticket_id = ref
                matched = True
                break
        if matched:
            continue

        repo_name = pr.repo.split("/")[-1] if "/" in pr.repo else pr.repo
        for ref in pr.issue_refs:
            ticket_key = github_ref_index.get((repo_name, ref, pr.engineer))
            if ticket_key and ticket_key in ticket_map:
                ticket_map[ticket_key].nested_prs.append(pr)
                pr.ticket_id = ticket_key
                matched = True
                break
        if matched:
            continue

        orphan_prs.append(pr)
    return list(ticket_map.values()), orphan_prs


def nest_in_progress(open_prs: List[PRItem],
                     ip_tickets: List[JiraItem]) -> Tuple[List[JiraItem], List[PRItem]]:
    ticket_map = {t.key: t for t in ip_tickets}
    github_ref_index = _build_github_ref_index(ip_tickets)
    orphan_prs: List[PRItem] = []

    for pr in open_prs:
        ids = extract_ticket_ids(pr.title)
        nested = False
        for tid in ids:
            if tid in ticket_map:
                ticket_map[tid].nested_prs.append(pr)
                pr.ticket_id = tid
                nested = True
                break
        if nested:
            continue

        matched = False
        for ref in pr.issue_refs:
            if ref in ticket_map:
                ticket_map[ref].nested_prs.append(pr)
                pr.ticket_id = ref
                matched = True
                break
        if matched:
            continue

        repo_name = pr.repo.split("/")[-1] if "/" in pr.repo else pr.repo
        for ref in pr.issue_refs:
            ticket_key = github_ref_index.get((repo_name, ref, pr.engineer))
            if ticket_key and ticket_key in ticket_map:
                ticket_map[ticket_key].nested_prs.append(pr)
                pr.ticket_id = ticket_key
                matched = True
                break
        if matched:
            continue

        orphan_prs.append(pr)
    return list(ticket_map.values()), orphan_prs


def determine_product(item, config: dict, repo_to_product: Dict[str, str],
                      prefix_to_product: Dict[str, str],
                      engineer_products: Dict[str, List[str]]) -> str:
    if isinstance(item, JiraItem):
        prefix = item.key.split("-")[0] if "-" in item.key else ""
        if prefix in prefix_to_product:
            return prefix_to_product[prefix]
        if prefix == "OCPBUGS":
            products = engineer_products.get(item.engineer, [])
            return products[0] if products else "CNV"

    if isinstance(item, PRItem):
        repo = item.repo
        if repo in repo_to_product:
            return repo_to_product[repo]
        repo_name = repo.split("/")[-1] if "/" in repo else repo
        if repo_name in repo_to_product:
            return repo_to_product[repo_name]
        if repo == "openshift/release":
            products = engineer_products.get(item.engineer, [])
            return products[0] if products else "CNV"

    eng_products = engineer_products.get(
        item.engineer if isinstance(item, (PRItem, JiraItem)) else "", [])
    return eng_products[0] if eng_products else "CNV"


def should_consolidate_test_tasks(tickets: List[JiraItem]) -> Tuple[bool, List[JiraItem], List[JiraItem]]:
    test_pattern = re.compile(r'^\[(?:TIER-\d|POST-UPGRADE|STAGE)', re.IGNORECASE)
    test_tickets = [t for t in tickets if test_pattern.match(t.summary)]
    other_tickets = [t for t in tickets if not test_pattern.match(t.summary)]
    return len(test_tickets) > 3, test_tickets, other_tickets

# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

def organize(completed_tickets: List[JiraItem], completed_orphan_prs: List[PRItem],
             ip_tickets: List[JiraItem], ip_orphan_prs: List[PRItem],
             config: dict) -> Dict[str, Dict[str, EngineerBlock]]:
    repo_to_product = build_repo_to_product(config)
    prefix_to_product = build_prefix_to_product(config)
    eng_products = build_engineer_products(config)
    product_order = [p["key"] for p in config["products"]]
    engineer_names = [e["name"] for e in config["engineers"]]

    sections: Dict[str, Dict[str, EngineerBlock]] = {}
    for pk in product_order:
        sections[pk] = {}

    def get_block(product: str, engineer: str) -> EngineerBlock:
        if product not in sections:
            sections[product] = {}
        if engineer not in sections[product]:
            sections[product][engineer] = EngineerBlock(name=engineer)
        return sections[product][engineer]

    for t in completed_tickets:
        product = determine_product(t, config, repo_to_product, prefix_to_product, eng_products)
        get_block(product, t.engineer).completed_tickets.append(t)

    for p in completed_orphan_prs:
        product = determine_product(p, config, repo_to_product, prefix_to_product, eng_products)
        get_block(product, p.engineer).completed_prs.append(p)

    for t in ip_tickets:
        product = determine_product(t, config, repo_to_product, prefix_to_product, eng_products)
        get_block(product, t.engineer).in_progress_tickets.append(t)

    for p in ip_orphan_prs:
        product = determine_product(p, config, repo_to_product, prefix_to_product, eng_products)
        get_block(product, p.engineer).in_progress_prs.append(p)

    name_order = {n: i for i, n in enumerate(engineer_names)}
    for pk in sections:
        sections[pk] = dict(sorted(sections[pk].items(),
                                   key=lambda x: name_order.get(x[0], 99)))

    return sections

# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def fmt_date(datestr: str) -> str:
    dt = parse_date(datestr)
    if not dt:
        return ""
    return dt.strftime("%b %-d")


def fmt_pr_link(pr: PRItem, indent: int = 0) -> str:
    prefix = "  " * indent + "- "
    label = "PR" if pr.source == "github" else "MR"
    num = f"#{pr.number}" if pr.source == "github" else f"!{pr.number}"
    merged_str = f" (merged {fmt_date(pr.merged_at)})" if pr.merged_at else f" (opened {fmt_date(pr.created_at)})"
    return f"{prefix}[{label} {num} - {pr.title}]({pr.url}){merged_str}"


def fmt_ticket_link(t: JiraItem, completed: bool = True) -> str:
    qa_tag = " (QA)" if t.role == "qa_contact" else ""
    if completed:
        return f"- [{t.key} - {t.summary}]({t.url}) (resolved {fmt_date(t.resolutiondate)}){qa_tag}"
    else:
        status_str = t.status
        priority_suffix = ""
        if t.priority in ("Blocker", "Critical"):
            priority_suffix = f", {t.priority} priority"
        return f"- [{t.key} - {t.summary}]({t.url}) ({status_str}{priority_suffix}){qa_tag}"


def fmt_test_task_summary(test_tickets: List[JiraItem]) -> str:
    versions = set()
    for t in test_tickets:
        for m in re.finditer(r'cnv-(\d+\.\d+\.\d+)', t.summary, re.IGNORECASE):
            versions.add(m.group(1))
    version_str = ", ".join(sorted(versions)) if versions else "multiple versions"
    links = ", ".join(f"[{t.key}]({t.url})" for t in test_tickets[:5])
    extra = f", and {len(test_tickets) - 5} more" if len(test_tickets) > 5 else ""
    return f"- {len(test_tickets)} CNV release test execution tasks completed — Tier 1/2 testing for CNV {version_str} ({links}{extra})"


def format_completed_section(sections: Dict[str, Dict[str, EngineerBlock]],
                             config: dict) -> str:
    lines: List[str] = []
    product_names = {p["key"]: p["name"] for p in config["products"]}

    for pk in sections:
        has_completed = False
        for eng_name, block in sections[pk].items():
            if block.completed_tickets or block.completed_prs:
                has_completed = True
                break
        if not has_completed:
            continue

        lines.append(f"\n### {pk} ({product_names.get(pk, pk)})\n")
        for eng_name, block in sections[pk].items():
            if not block.completed_tickets and not block.completed_prs:
                continue
            lines.append(f"**{eng_name}:**")

            should_consolidate, test_tix, other_tix = should_consolidate_test_tasks(
                block.completed_tickets)

            for t in other_tix:
                lines.append(fmt_ticket_link(t, completed=True))
                for pr in t.nested_prs:
                    lines.append(fmt_pr_link(pr, indent=1))

            if should_consolidate and test_tix:
                lines.append(fmt_test_task_summary(test_tix))
            elif test_tix:
                for t in test_tix:
                    lines.append(fmt_ticket_link(t, completed=True))

            for pr in block.completed_prs:
                lines.append(fmt_pr_link(pr, indent=0))

            lines.append("")

    return "\n".join(lines)


def format_in_progress_section(sections: Dict[str, Dict[str, EngineerBlock]],
                               config: dict) -> str:
    lines: List[str] = []
    product_names = {p["key"]: p["name"] for p in config["products"]}

    for pk in sections:
        has_ip = False
        for eng_name, block in sections[pk].items():
            if block.in_progress_tickets or block.in_progress_prs:
                has_ip = True
                break
        if not has_ip:
            continue

        lines.append(f"\n### {pk} ({product_names.get(pk, pk)})\n")
        for eng_name, block in sections[pk].items():
            if not block.in_progress_tickets and not block.in_progress_prs:
                continue
            lines.append(f"**{eng_name}:**")

            for t in block.in_progress_tickets:
                lines.append(fmt_ticket_link(t, completed=False))
                for pr in t.nested_prs:
                    lines.append(fmt_pr_link(pr, indent=1))

            for pr in block.in_progress_prs:
                lines.append(fmt_pr_link(pr, indent=0))

            lines.append("")

    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Key highlights
# ---------------------------------------------------------------------------

def generate_highlights(sections: Dict[str, Dict[str, EngineerBlock]]) -> List[str]:
    engineer_counts: Dict[str, Dict[str, int]] = {}
    for pk, engineers in sections.items():
        for eng_name, block in engineers.items():
            if eng_name not in engineer_counts:
                engineer_counts[eng_name] = {"prs": 0, "tickets": 0, "products": set()}
            total_prs = len(block.completed_prs)
            for t in block.completed_tickets:
                total_prs += len(t.nested_prs)
            engineer_counts[eng_name]["prs"] += total_prs
            engineer_counts[eng_name]["tickets"] += len(block.completed_tickets)
            if total_prs > 0 or len(block.completed_tickets) > 0:
                engineer_counts[eng_name]["products"].add(pk)

    highlights: List[str] = []
    sorted_engineers = sorted(engineer_counts.items(),
                              key=lambda x: x[1]["prs"] + x[1]["tickets"],
                              reverse=True)

    for eng_name, counts in sorted_engineers[:4]:
        prs = counts["prs"]
        tickets = counts["tickets"]
        products = counts["products"]
        product_str = "/".join(sorted(products))

        if prs == 0 and tickets == 0:
            continue

        notable_tickets = []
        for pk, engineers in sections.items():
            if eng_name in engineers:
                block = engineers[eng_name]
                for t in block.completed_tickets:
                    if t.issuetype in ("Story", "Epic", "Bug") and not re.match(r'^\[(?:TIER|POST|STAGE)', t.summary):
                        notable_tickets.append(t)

        if notable_tickets:
            ticket_detail = ", ".join(f"{t.key}" for t in notable_tickets[:3])
            highlights.append(
                f"- {eng_name} shipped {prs} {product_str} PRs/MRs including {ticket_detail}")
        elif prs > 0:
            highlights.append(f"- {eng_name} shipped {prs} {product_str} PRs/MRs")

    return highlights[:4]

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate weekly team report from cached CSVs")
    parser.add_argument("--date", required=True, help="Report date (YYYY-MM-DD)")
    parser.add_argument("--cache-dir", default="data/cache/team-wide",
                        help="Path to cached CSV directory")
    parser.add_argument("--output", default=None,
                        help="Output path (default: data/team-wide/weekly-update-{date}.md)")
    parser.add_argument("--config", default="data/team-config.json",
                        help="Path to team config JSON")
    args = parser.parse_args()

    try:
        report_date = datetime.strptime(args.date, "%Y-%m-%d")
    except ValueError:
        print(f"{RED}ERROR: invalid date format: {args.date} (use YYYY-MM-DD){RESET}", file=sys.stderr)
        sys.exit(1)

    window_start = report_date - timedelta(days=7)
    window_end = report_date + timedelta(days=1)  # inclusive of report date
    cache_dir = Path(args.cache_dir)
    config_path = Path(args.config)
    output_path = Path(args.output) if args.output else Path(f"data/team-wide/weekly-update-{args.date}.md")

    config = load_config(config_path)

    # Load data
    print(f"Loading CSVs from {cache_dir}/...")
    github_prs = load_github_prs(cache_dir)
    gitlab_mrs = load_gitlab_mrs(cache_dir)
    jira_tickets = load_jira_tickets(cache_dir, config)
    all_prs = github_prs + gitlab_mrs

    print(f"  GitHub PRs: {len(github_prs)} rows")
    print(f"  GitLab MRs: {len(gitlab_mrs)} rows")
    print(f"  Jira tickets: {len(jira_tickets)} rows")

    # Validate
    warnings, errors = validate_data(github_prs, gitlab_mrs, jira_tickets, config)
    if errors:
        for e in errors:
            print(f"{RED}ERROR: {e}{RESET}", file=sys.stderr)
        print(f"\n{RED}Cannot generate report — fix data issues above and retry.{RESET}", file=sys.stderr)
        sys.exit(2)

    # Filter
    completed_prs = filter_completed_prs(all_prs, window_start, window_end)
    open_prs = filter_open_prs(all_prs)
    completed_jira = filter_completed_jira(jira_tickets, window_start, window_end)
    ip_jira = filter_in_progress_jira(jira_tickets)

    print(f"\nFiltered (7-day window {window_start.strftime('%Y-%m-%d')} to {report_date.strftime('%Y-%m-%d')}):")
    print(f"  Completed PRs/MRs: {len(completed_prs)}")
    print(f"  Open PRs/MRs: {len(open_prs)}")
    print(f"  Jira resolved (Done): {len(completed_jira)}")
    print(f"  Jira in progress: {len(ip_jira)}")

    if len(completed_jira) == 0:
        warnings.append("0 Jira tickets resolved in window — report may be incomplete")

    # Nest PRs under Jira tickets
    completed_tickets, completed_orphan_prs = nest_prs_under_tickets(completed_prs, completed_jira)
    ip_tickets, ip_orphan_prs = nest_in_progress(open_prs, ip_jira)

    nested_count = sum(len(t.nested_prs) for t in completed_tickets)
    print(f"\nNesting: {nested_count} PRs nested under {len([t for t in completed_tickets if t.nested_prs])} Jira tickets")

    # Organize by product
    sections = organize(completed_tickets, completed_orphan_prs,
                        ip_tickets, ip_orphan_prs, config)

    # Generate report
    highlights = generate_highlights(sections)

    report_lines = [
        f"# {config['report_title']}",
        report_date.strftime("%B %-d, %Y"),
        "",
        "## Key Highlights",
    ]
    report_lines.extend(highlights if highlights else ["- Steady delivery across all products"])
    report_lines.append("")

    if warnings:
        report_lines.append("## Data Quality Notes")
        for w in warnings:
            report_lines.append(f"- {w}")
        report_lines.append("")

    report_lines.append("## Completed This Week")
    report_lines.append(format_completed_section(sections, config))

    report_lines.append("## In Progress")
    report_lines.append(format_in_progress_section(sections, config))

    report_lines.append("## Blockers & Critical Issues")
    report_lines.append("None reported.")

    report_text = "\n".join(report_lines) + "\n"

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report_text)
    print(f"\n{GREEN}Report saved to {output_path}{RESET}")

    # Summary
    total_completed = len(completed_prs) + len(completed_jira)
    total_ip = len(open_prs) + len(ip_jira)
    print(f"\n--- Report Statistics ---")
    print(f"  GitHub PRs merged: {len([p for p in completed_prs if p.source == 'github'])}")
    print(f"  GitLab MRs merged: {len([p for p in completed_prs if p.source == 'gitlab'])}")
    print(f"  Jira tickets closed (Done): {len(completed_jira)}")
    print(f"  Total completed items: {total_completed}")
    print(f"  Total in-progress items: {total_ip}")
    print(f"  Date range: {window_start.strftime('%Y-%m-%d')} to {report_date.strftime('%Y-%m-%d')}")

    if warnings:
        print(f"\n{YELLOW}Warnings present — review report before sharing.{RESET}")
        sys.exit(3)

    sys.exit(0)


if __name__ == "__main__":
    main()
