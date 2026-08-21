#!/usr/bin/env python3
"""Fetch weekly team data from GitHub, GitLab, and Jira APIs."""

import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
import ssl
from base64 import b64encode
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
CACHE_DIR = DATA_DIR / "cache"
CONFIG_PATH = DATA_DIR / "team-config.json"

TODAY = datetime.now().strftime("%Y-%m-%d")
SEVEN_DAYS_AGO = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
SEVEN_DAYS_AGO_ISO = f"{SEVEN_DAYS_AGO}T00:00:00Z"

# Load config
with open(CONFIG_PATH) as f:
    config = json.load(f)

engineers = config["engineers"]
jira_config = config["jira"]
products = config["products"]
sprint_pattern = re.compile(config["sprint_name_pattern"])

# Tokens
GITHUB_PAT = os.environ.get("GITHUB_PAT", "")
GITLAB_PAT = os.environ.get("GITLAB_PAT", "")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL", "")

ssl_ctx = ssl.create_default_context()


def github_request(url):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"token {GITHUB_PAT}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  GitHub error {e.code}: {url[:80]}", file=sys.stderr)
        return {"items": []}


def gitlab_request(url):
    req = urllib.request.Request(url)
    req.add_header("PRIVATE-TOKEN", GITLAB_PAT)
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:100]
        print(f"  GitLab error {e.code}: {body}", file=sys.stderr)
        return []
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  GitLab connection error: {e}", file=sys.stderr)
        return []


def jira_request(jql, fields):
    base = f"https://{jira_config['cloud_id']}/rest/api/3/search/jql"
    params = urllib.parse.urlencode({
        "jql": jql,
        "maxResults": 100,
        "fields": ",".join(fields),
    })
    url = f"{base}?{params}"
    credentials = b64encode(f"{JIRA_EMAIL}:{JIRA_API_TOKEN}".encode()).decode()
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {credentials}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f"  Jira error {e.code}: {body}", file=sys.stderr)
        return {"issues": []}


def csv_escape(value):
    value = str(value).replace('"', '""')
    if "," in value or '"' in value:
        return f'"{value}"'
    return value


def extract_issue_refs(body):
    if not body:
        return ""
    refs = set()
    for m in re.findall(
        r"(?:(?:closes?|fixes?|resolves?)\s*#(\d+))|(?:#(\d+))|(?:/issues/(\d+))",
        body,
        re.IGNORECASE,
    ):
        for g in m:
            if g:
                refs.add(g)
    return " ".join(sorted(refs))


def extract_sprint_name(sprint_field):
    if not sprint_field or not isinstance(sprint_field, list):
        return ""
    # Try active sprint matching pattern first
    for s in sprint_field:
        if isinstance(s, dict) and s.get("state") == "active":
            name = s.get("name", "")
            if sprint_pattern.match(name):
                return name
    # Any active sprint
    for s in sprint_field:
        if isinstance(s, dict) and s.get("state") == "active":
            return s.get("name", "")
    # Future sprint
    for s in sprint_field:
        if isinstance(s, dict) and s.get("state") == "future":
            return s.get("name", "")
    return ""


# --- GITHUB ---
print("=== Fetching GitHub PRs ===")
github_prs = []
seen_pr_keys = set()

for eng in engineers:
    name = eng["name"]
    username = eng["github"]
    print(f"  {name} ({username})...")

    # Merged PRs
    query = f"author:{username} is:pr is:merged merged:{SEVEN_DAYS_AGO}..{TODAY}"
    encoded = urllib.parse.quote(query)
    data = github_request(
        f"https://api.github.com/search/issues?q={encoded}&per_page=100"
    )
    for pr in data.get("items", []):
        key = (pr.get("repository_url", ""), pr["number"])
        repo_url = pr.get("repository_url", "")
        repo = "/".join(repo_url.split("/")[-2:]) if repo_url else ""
        merged_at = pr.get("pull_request", {}).get("merged_at", "") if pr.get("pull_request") else ""
        github_prs.append({
            "engineer": name,
            "number": pr["number"],
            "title": pr["title"],
            "repo": repo,
            "state": "merged",
            "created_at": pr.get("created_at", ""),
            "merged_at": merged_at,
            "html_url": pr.get("html_url", ""),
            "issue_refs": extract_issue_refs(pr.get("body", "")),
        })
        seen_pr_keys.add(key)

    # Open PRs
    query = f"author:{username} is:open is:pr"
    encoded = urllib.parse.quote(query)
    data = github_request(
        f"https://api.github.com/search/issues?q={encoded}&per_page=100"
    )
    for pr in data.get("items", []):
        key = (pr.get("repository_url", ""), pr["number"])
        if key in seen_pr_keys:
            continue
        repo_url = pr.get("repository_url", "")
        repo = "/".join(repo_url.split("/")[-2:]) if repo_url else ""
        github_prs.append({
            "engineer": name,
            "number": pr["number"],
            "title": pr["title"],
            "repo": repo,
            "state": "open",
            "created_at": pr.get("created_at", ""),
            "merged_at": "",
            "html_url": pr.get("html_url", ""),
            "issue_refs": extract_issue_refs(pr.get("body", "")),
        })
        seen_pr_keys.add(key)

print(f"  Total GitHub PRs: {len(github_prs)}")

# Save GitHub CSV
with open(CACHE_DIR / "github-prs.csv", "w") as f:
    f.write("engineer,number,title,repo,state,created_at,merged_at,html_url,issue_refs\n")
    for pr in github_prs:
        f.write(
            f"{csv_escape(pr['engineer'])},{pr['number']},{csv_escape(pr['title'])},"
            f"{pr['repo']},{pr['state']},{pr['created_at']},{pr['merged_at']},"
            f"{pr['html_url']},{pr['issue_refs']}\n"
        )

# --- JIRA ---
print("\n=== Fetching Jira Tickets ===")
jira_tickets = {}
active_sprint_name = ""

projects_clause = ", ".join(f'"{p}"' for p in jira_config["projects"])
fields = [
    "summary", "status", "assignee", "resolution", "resolutiondate",
    "statuscategorychangedate", "issuetype", "priority", "updated",
    "created", "customfield_10470", "customfield_10020", "issuelinks",
]

for eng in engineers:
    name = eng["name"]
    jira_id = eng["jira_account_id"]
    print(f"  {name} ({jira_id[:20]}...)...")

    jql = (
        f'(assignee = "{jira_id}" OR cf[10470] = "{jira_id}") '
        f"AND project in ({projects_clause}) "
        f"AND updated >= -7d ORDER BY updated DESC"
    )
    data = jira_request(jql, fields)
    issues = data.get("issues", [])
    print(f"    Found {len(issues)} tickets")

    for issue in issues:
        key = issue["key"]
        if key in jira_tickets:
            continue
        f_data = issue.get("fields", {})
        sprint_name = extract_sprint_name(f_data.get("customfield_10020"))
        if sprint_name and sprint_pattern.match(sprint_name) and not active_sprint_name:
            active_sprint_name = sprint_name

        assignee = f_data.get("assignee") or {}
        qa_contact = f_data.get("customfield_10470") or {}

        jira_tickets[key] = {
            "key": key,
            "summary": f_data.get("summary", ""),
            "status": (f_data.get("status") or {}).get("name", ""),
            "resolution": (f_data.get("resolution") or {}).get("name", ""),
            "resolutiondate": f_data.get("resolutiondate", "") or "",
            "statuscategorychangedate": f_data.get("statuscategorychangedate", "") or "",
            "issuetype": (f_data.get("issuetype") or {}).get("name", ""),
            "priority": (f_data.get("priority") or {}).get("name", ""),
            "assignee_id": assignee.get("accountId", "") if isinstance(assignee, dict) else "",
            "assignee_name": assignee.get("displayName", "") if isinstance(assignee, dict) else "",
            "qa_contact_id": qa_contact.get("accountId", "") if isinstance(qa_contact, dict) else "",
            "qa_contact_name": qa_contact.get("displayName", "") if isinstance(qa_contact, dict) else "",
            "sprint_name": sprint_name,
            "issuelinks": f_data.get("issuelinks") or [],
        }

print(f"  Total unique Jira tickets: {len(jira_tickets)}")
print(f"  Active sprint: {active_sprint_name or 'not found'}")

# Fetch sprint backlog if we found an active sprint
if active_sprint_name:
    print(f"\n=== Fetching Sprint Backlog: {active_sprint_name} ===")
    jql = f'sprint = "{active_sprint_name}" ORDER BY key ASC'
    data = jira_request(jql, fields)
    sprint_issues = data.get("issues", [])
    print(f"  Sprint backlog: {len(sprint_issues)} tickets")

    added = 0
    for issue in sprint_issues:
        key = issue["key"]
        if key in jira_tickets:
            continue
        f_data = issue.get("fields", {})
        sprint_name = extract_sprint_name(f_data.get("customfield_10020"))
        assignee = f_data.get("assignee") or {}
        qa_contact = f_data.get("customfield_10470") or {}

        jira_tickets[key] = {
            "key": key,
            "summary": f_data.get("summary", ""),
            "status": (f_data.get("status") or {}).get("name", ""),
            "resolution": (f_data.get("resolution") or {}).get("name", ""),
            "resolutiondate": f_data.get("resolutiondate", "") or "",
            "statuscategorychangedate": f_data.get("statuscategorychangedate", "") or "",
            "issuetype": (f_data.get("issuetype") or {}).get("name", ""),
            "priority": (f_data.get("priority") or {}).get("name", ""),
            "assignee_id": assignee.get("accountId", "") if isinstance(assignee, dict) else "",
            "assignee_name": assignee.get("displayName", "") if isinstance(assignee, dict) else "",
            "qa_contact_id": qa_contact.get("accountId", "") if isinstance(qa_contact, dict) else "",
            "qa_contact_name": qa_contact.get("displayName", "") if isinstance(qa_contact, dict) else "",
            "sprint_name": sprint_name or active_sprint_name,
            "issuelinks": f_data.get("issuelinks") or [],
        }
        added += 1
    print(f"  Added {added} new tickets from sprint backlog")

print(f"  Final Jira ticket count: {len(jira_tickets)}")

# Save Jira CSV
with open(CACHE_DIR / "jira-tickets.csv", "w") as f:
    f.write("key,summary,status,resolution,resolutiondate,statuscategorychangedate,issuetype,priority,assignee_id,assignee_name,qa_contact_id,qa_contact_name,sprint_name\n")
    for ticket in jira_tickets.values():
        f.write(
            f"{ticket['key']},{csv_escape(ticket['summary'])},{ticket['status']},"
            f"{ticket['resolution']},{ticket['resolutiondate']},"
            f"{ticket['statuscategorychangedate']},{ticket['issuetype']},"
            f"{ticket['priority']},{ticket['assignee_id']},"
            f"{csv_escape(ticket['assignee_name'])},{ticket['qa_contact_id']},"
            f"{csv_escape(ticket['qa_contact_name'])},{ticket['sprint_name']}\n"
        )

# --- CUSTOMER ACCOUNTS (from issue links) ---
print("\n=== Extracting Customer Accounts from Issue Links ===")
customer_cases = []
jira_base = jira_config["cloud_id"]

for key, ticket in jira_tickets.items():
    for link in ticket.get("issuelinks", []):
        link_type = link.get("type", {})
        if link_type.get("name") != "Account":
            continue
        outward = link.get("outwardIssue")
        if not outward:
            continue
        account_key = outward.get("key", "")
        if not account_key.startswith("CIPOE-"):
            continue
        customer_name = (outward.get("fields") or {}).get("summary", "")
        customer_cases.append({
            "ticket_key": key,
            "case_id": account_key,
            "case_url": f"https://{jira_base}/browse/{account_key}",
            "customer_name": customer_name,
        })

print(f"  Found {len(customer_cases)} customer accounts across {len(set(c['ticket_key'] for c in customer_cases))} tickets")

with open(CACHE_DIR / "customer-cases.csv", "w") as f:
    f.write("ticket_key,case_id,case_url,customer_name\n")
    for cc in customer_cases:
        f.write(
            f"{cc['ticket_key']},{cc['case_id']},{cc['case_url']},"
            f"{csv_escape(cc['customer_name'])}\n"
        )

# --- GITLAB ---
print("\n=== Fetching GitLab MRs ===")
gitlab_mrs = []
GITLAB_API = config.get("gitlab", {}).get("api_url", os.environ.get("GITLAB_API_URL", ""))
GITLAB_BASE = GITLAB_API.rsplit("/api/", 1)[0] + "/" if GITLAB_API else ""

for eng in engineers:
    name = eng["name"]
    username = eng["gitlab"]
    print(f"  {name} ({username})...")

    # Merged MRs
    url = (
        f"{GITLAB_API}/merge_requests?"
        f"author_username={username}&scope=all&state=merged"
        f"&updated_after={SEVEN_DAYS_AGO_ISO}&per_page=100"
    )
    data = gitlab_request(url)
    if isinstance(data, list):
        for mr in data:
            web_url = mr.get("web_url", "")
            project_path = web_url.replace(GITLAB_BASE, "").split("/-/")[0] if "/-/" in web_url else ""
            gitlab_mrs.append({
                "engineer": name,
                "iid": mr.get("iid", ""),
                "title": mr.get("title", ""),
                "project_path": project_path,
                "state": "merged",
                "created_at": mr.get("created_at", ""),
                "merged_at": mr.get("merged_at", ""),
                "web_url": web_url,
            })

    # Open MRs
    url = (
        f"{GITLAB_API}/merge_requests?"
        f"author_username={username}&scope=all&state=opened&per_page=100"
    )
    data = gitlab_request(url)
    if isinstance(data, list):
        for mr in data:
            web_url = mr.get("web_url", "")
            project_path = web_url.replace(GITLAB_BASE, "").split("/-/")[0] if "/-/" in web_url else ""
            gitlab_mrs.append({
                "engineer": name,
                "iid": mr.get("iid", ""),
                "title": mr.get("title", ""),
                "project_path": project_path,
                "state": "open",
                "created_at": mr.get("created_at", ""),
                "merged_at": "",
                "web_url": web_url,
            })

print(f"  Total GitLab MRs: {len(gitlab_mrs)}")

# Save GitLab CSV
with open(CACHE_DIR / "gitlab-mrs.csv", "w") as f:
    f.write("engineer,iid,title,project_path,state,created_at,merged_at,web_url\n")
    for mr in gitlab_mrs:
        f.write(
            f"{csv_escape(mr['engineer'])},{mr['iid']},{csv_escape(mr['title'])},"
            f"{mr['project_path']},{mr['state']},{mr['created_at']},"
            f"{mr['merged_at']},{mr['web_url']}\n"
        )

# Save last-updated timestamp
with open(CACHE_DIR / "last-updated.txt", "w") as f:
    f.write(datetime.now().isoformat() + "\n")

# Summary
print(f"\n=== Summary ===")
print(f"GitHub PRs: {len(github_prs)}")
print(f"Jira Tickets: {len(jira_tickets)}")
print(f"GitLab MRs: {len(gitlab_mrs)}")
print(f"Active Sprint: {active_sprint_name or 'not found'}")
print(f"Cache saved to: {CACHE_DIR}")
