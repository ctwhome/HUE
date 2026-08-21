#!/usr/bin/env python3
"""Idempotently synchronize HUE labels, milestones and issues to GitHub.

Requires an authenticated `gh` CLI. The canonical local JSON remains the source
of truth; this script reads remote objects back and writes docs/roadmap/github-map.json.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs/roadmap"
sys.path.insert(0, str(Path(__file__).parent))
from render_roadmap import issue_body  # noqa: E402


def run(*args: str, input_text: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(args, input=input_text, text=True, capture_output=True)
    if check and cp.returncode:
        raise RuntimeError(f"command failed ({cp.returncode}): {' '.join(args)}\n{cp.stderr.strip()}")
    return cp


def gh_json(*args: str, input_text: str | None = None):
    cp = run("gh", *args, input_text=input_text)
    return json.loads(cp.stdout) if cp.stdout.strip() else None


def load(name: str):
    return json.loads((ROADMAP / name).read_text())


def ensure_repo(repo: str, visibility: str, create: bool) -> None:
    existing = run("gh", "repo", "view", repo, "--json", "nameWithOwner", check=False)
    if existing.returncode == 0:
        return
    if not create:
        raise RuntimeError(f"repository {repo} does not exist; pass --create")
    run("gh", "repo", "create", repo, f"--{visibility}", "--description", "HUE — an open-source, local-first personal agent workspace", "--disable-wiki")


def sync_labels(repo: str, labels: list[dict]) -> None:
    for label in labels:
        run("gh", "label", "create", label["name"], "--repo", repo, "--color", label["color"], "--description", label["description"], "--force")


def sync_milestones(repo: str, milestones: list[dict]) -> dict[str, int]:
    remote = gh_json("api", f"repos/{repo}/milestones?state=all&per_page=100") or []
    by_title = {m["title"]: m for m in remote}
    result: dict[str, int] = {}
    for m in milestones:
        title = f"{m['id']} — {m['title']}"
        description = m["description"] + "\n\nExit criteria: " + m["exit_criteria"]
        if title in by_title:
            number = by_title[title]["number"]
            gh_json("api", "--method", "PATCH", f"repos/{repo}/milestones/{number}", "-f", f"title={title}", "-f", f"description={description}", "-f", "state=open")
        else:
            created = gh_json("api", "--method", "POST", f"repos/{repo}/milestones", "-f", f"title={title}", "-f", f"description={description}")
            if not isinstance(created, dict):
                raise RuntimeError(f"GitHub returned no milestone object for {title}")
            number = created["number"]
        result[m["id"]] = number
    return result


def remote_issues(repo: str) -> list[dict]:
    return gh_json("api", "--paginate", f"repos/{repo}/issues?state=all&per_page=100") or []


def source_id(title: str) -> str | None:
    if title.startswith("[HUE-") and "]" in title:
        return title[1:title.index("]")]
    return None


def create_shells(repo: str, issues: list[dict], milestone_map: dict[str, int]) -> dict[str, tuple[int, str]]:
    remote = [x for x in remote_issues(repo) if "pull_request" not in x]
    by_id = {sid: x for x in remote if (sid := source_id(x["title"])) is not None}
    for issue in issues:
        title = f"[{issue['id']}] {issue['title']}"
        if issue["id"] in by_id:
            continue
        payload = {
            "title": title,
            "body": "Synchronization in progress from docs/roadmap/issues.json.",
            "milestone": milestone_map[issue["milestone"]],
            "labels": issue["labels"],
        }
        created = gh_json("api", "--method", "POST", f"repos/{repo}/issues", "--input", "-", input_text=json.dumps(payload))
        if not isinstance(created, dict):
            raise RuntimeError(f"GitHub returned no issue object for {issue['id']}")
        by_id[issue["id"]] = created
    return {iid: (obj["number"], obj["html_url"]) for iid, obj in by_id.items()}


def update_issues(repo: str, issues: list[dict], milestone_map: dict[str, int], number_map: dict[str, tuple[int, str]]) -> None:
    for issue in issues:
        number, _ = number_map[issue["id"]]
        payload = {
            "title": f"[{issue['id']}] {issue['title']}",
            "body": issue_body(issue, number_map),
            "milestone": milestone_map[issue["milestone"]],
            "labels": issue["labels"],
            "state": "open",
        }
        gh_json("api", "--method", "PATCH", f"repos/{repo}/issues/{number}", "--input", "-", input_text=json.dumps(payload))


def verify(repo: str, milestones: list[dict], issues: list[dict], number_map: dict[str, tuple[int, str]]) -> dict:
    r = gh_json("repo", "view", repo, "--json", "nameWithOwner,url,isPrivate,defaultBranchRef")
    remote_m = gh_json("api", f"repos/{repo}/milestones?state=open&per_page=100") or []
    remote_i = [x for x in remote_issues(repo) if "pull_request" not in x and source_id(x["title"])]
    remote_ids = {source_id(x["title"]) for x in remote_i}
    expected_ids = {x["id"] for x in issues}
    if len(remote_m) < len(milestones) or not expected_ids.issubset(remote_ids):
        raise RuntimeError("remote verification failed: milestone/issue inventory incomplete")
    sample = remote_i[0]
    if "Canonical source" not in (sample.get("body") or ""):
        raise RuntimeError("remote verification failed: issue body not synchronized")
    result = {
        "repository": r,
        "milestone_count": len(milestones),
        "issue_count": len(issues),
        "issues": {iid: {"number": n, "url": url} for iid, (n, url) in sorted(number_map.items())},
    }
    (ROADMAP / "github-map.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default="ctwhome/HUE")
    p.add_argument("--create", action="store_true")
    p.add_argument("--visibility", choices=("private", "public"), default="private")
    args = p.parse_args()
    if run("gh", "auth", "status", check=False).returncode:
        print("GitHub authentication is required: run `gh auth login -h github.com`.", file=sys.stderr)
        return 2
    labels, milestones, issues = load("labels.json"), load("milestones.json"), load("issues.json")
    ensure_repo(args.repo, args.visibility, args.create)
    sync_labels(args.repo, labels)
    milestone_map = sync_milestones(args.repo, milestones)
    number_map = create_shells(args.repo, issues, milestone_map)
    update_issues(args.repo, issues, milestone_map, number_map)
    result = verify(args.repo, milestones, issues, number_map)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
