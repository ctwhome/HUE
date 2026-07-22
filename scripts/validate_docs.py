#!/usr/bin/env python3
"""Validate HUE's docs-as-product contract with no external dependencies."""
from __future__ import annotations

import html.parser
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def load_json(rel: str):
    try:
        return json.loads((ROOT / rel).read_text())
    except Exception as exc:
        fail(f"{rel}: invalid JSON: {exc}")
        return []


def validate_roadmap() -> None:
    labels = load_json("roadmap/labels.json")
    milestones = load_json("roadmap/milestones.json")
    issues = load_json("roadmap/issues.json")
    label_names = {x.get("name") for x in labels}
    mids = {x.get("id") for x in milestones}
    ids = [x.get("id") for x in issues]
    if len(ids) != len(set(ids)):
        fail("roadmap/issues.json: duplicate issue IDs")
    if len(mids) != len(milestones):
        fail("roadmap/milestones.json: duplicate milestone IDs")
    imap = {x.get("id"): x for x in issues}
    for issue in issues:
        iid = issue.get("id", "<missing>")
        if issue.get("milestone") not in mids:
            fail(f"{iid}: unknown milestone {issue.get('milestone')}")
        for label in issue.get("labels", []):
            if label not in label_names:
                fail(f"{iid}: unknown label {label}")
        for dep in issue.get("dependencies", []):
            if dep not in imap:
                fail(f"{iid}: unknown dependency {dep}")
            if dep == iid:
                fail(f"{iid}: self dependency")
        for doc in issue.get("docs", []):
            if not (ROOT / doc).exists():
                fail(f"{iid}: missing product-contract file {doc}")
        for required in ("goal", "scope", "acceptance", "non_goals", "readiness", "status"):
            if required not in issue:
                fail(f"{iid}: missing {required}")
        if issue.get("status") == "TBD" and "decision:TBD" not in issue.get("labels", []):
            fail(f"{iid}: TBD issue lacks decision:TBD label")
        if issue.get("readiness") == "agent:ready" and "agent:ready" not in issue.get("labels", []):
            fail(f"{iid}: readiness/label mismatch")

    visiting: set[str] = set()
    visited: set[str] = set()
    def walk(iid: str, trail: list[str]) -> None:
        if iid in visiting:
            fail("dependency cycle: " + " -> ".join(trail + [iid]))
            return
        if iid in visited:
            return
        visiting.add(iid)
        for dep in imap[iid].get("dependencies", []):
            walk(dep, trail + [iid])
        visiting.remove(iid)
        visited.add(iid)
    for iid in imap:
        walk(iid, [])


def validate_markdown_links() -> None:
    link_re = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
    for path in [ROOT / "README.md", ROOT / "VISION.md", *sorted((ROOT / "docs").glob("*.md"))]:
        text = path.read_text()
        if path.parent == ROOT / "docs" and path.name != "15-glossary.md":
            if "status:" not in text[:500].lower():
                fail(f"{path.relative_to(ROOT)}: no status banner near top")
        if text.count("```mermaid") > text.count("```"):
            fail(f"{path.relative_to(ROOT)}: unclosed Mermaid fence")
        for raw in link_re.findall(text):
            target = raw.split("#", 1)[0].strip()
            if not target or re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            target = unquote(target)
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                fail(f"{path.relative_to(ROOT)}: link escapes repo: {raw}")
                continue
            if not resolved.exists():
                fail(f"{path.relative_to(ROOT)}: broken link: {raw}")


class BasicHTML(html.parser.HTMLParser):
    pass


def validate_prototype() -> None:
    for rel in ("prototype/index.html", "prototype/styles.css", "prototype/app.js"):
        if not (ROOT / rel).exists():
            fail(f"missing prototype file: {rel}")
    html_path = ROOT / "prototype/index.html"
    if html_path.exists():
        text = html_path.read_text()
        try:
            p = BasicHTML(); p.feed(text); p.close()
        except Exception as exc:
            fail(f"prototype/index.html parse error: {exc}")
        for token in ("SPEC", "TBI", "data-screen", "app.js", "styles.css"):
            if token not in text:
                fail(f"prototype/index.html missing required marker {token}")


def validate_decisions() -> None:
    reg = (ROOT / "docs/14-decision-register.md").read_text()
    ids = set(re.findall(r"TBD-\d{3}", reg))
    referenced: set[str] = set()
    for p in [ROOT / "README.md", ROOT / "VISION.md", *sorted((ROOT / "docs").glob("*.md"))]:
        referenced |= set(re.findall(r"TBD-\d{3}", p.read_text()))
    missing = referenced - ids
    if missing:
        fail("TBD references missing from decision register: " + ", ".join(sorted(missing)))


def main() -> int:
    validate_roadmap()
    validate_markdown_links()
    validate_prototype()
    validate_decisions()
    if ERRORS:
        print(f"FAILED: {len(ERRORS)} validation error(s)")
        for err in ERRORS:
            print("-", err)
        return 1
    docs = len(list((ROOT / "docs").glob("*.md")))
    issues = len(load_json("roadmap/issues.json"))
    print(f"PASS: {docs} docs, {issues} canonical issues, prototype contract present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
