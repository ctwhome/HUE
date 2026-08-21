#!/usr/bin/env python3
"""Render human-readable roadmap and issue briefs from canonical JSON."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs/roadmap"


def load(name: str):
    return json.loads((ROADMAP / name).read_text())


def issue_body(issue: dict, number_map: dict[str, tuple[int, str]] | None = None) -> str:
    number_map = number_map or {}
    def dep(d: str) -> str:
        if d in number_map:
            n, url = number_map[d]
            return f"- [{d} — #{n}]({url})"
        return f"- `{d}`"
    deps = "\n".join(dep(d) for d in issue["dependencies"]) or "- None"
    scope = "\n".join(f"- {x}" for x in issue["scope"])
    acceptance = "\n".join(f"- [ ] {x}" for x in issue["acceptance"])
    non_goals = "\n".join(f"- {x}" for x in issue["non_goals"]) or "- None beyond the documented scope."
    docs = "\n".join(f"- [`{x}`](../blob/main/{x})" for x in issue["docs"]) or "- Follow the milestone and repository product contract."
    return f"""> **Canonical source:** `docs/roadmap/issues.json` · `{issue['id']}`
>
> **Specification status:** `{issue['status']}` · **Readiness:** `{issue['readiness']}`

## Goal

{issue['goal']}

## Scope

{scope}

## Acceptance criteria

{acceptance}

## Dependencies

{deps}

## Non-goals

{non_goals}

## Product contract

{docs}

## Implementation handoff requirements

- Preserve the documented security, project, memory and event boundaries.
- Add or update automated tests for every observable acceptance criterion.
- Provide real verification output; do not rely on a worker/agent self-report.
- Update only the exact documentation sections whose status changed.
- Include screenshots or a recording for user-interface changes.
- Include migration, rollback and recovery notes for data/state changes.
- Link the pull request to this issue with `Closes #<issue-number>`.
"""


def main() -> None:
    milestones = load("milestones.json")
    issues = load("issues.json")
    by_m = {m["id"]: [] for m in milestones}
    for issue in issues:
        by_m[issue["milestone"]].append(issue)

    lines = [
        "# Canonical issue plan",
        "",
        "> Generated from `docs/roadmap/issues.json` by `docs/scripts/render_roadmap.py`. Do not edit by hand.",
        "",
        f"**{len(milestones)} milestones · {len(issues)} issues**",
        "",
    ]
    for m in milestones:
        lines += [f"## {m['id']} — {m['title']}", "", m["description"], "", f"**Exit:** {m['exit_criteria']}", ""]
        for i in by_m[m["id"]]:
            deps = ", ".join(i["dependencies"]) or "none"
            lines += [f"### {i['id']} — {i['title']}", "", f"`{i['status']}` · `{i['readiness']}` · dependencies: {deps}", "", i["goal"], ""]

    (ROADMAP / "ISSUES.md").write_text("\n".join(lines).rstrip() + "\n")

    graph = [
        "# Issue dependency graph",
        "",
        "> Generated from `docs/roadmap/issues.json`. Milestone colors are omitted so the graph remains legible in light and dark themes.",
        "",
        "```mermaid",
        "flowchart LR",
    ]
    for i in issues:
        label = (i["id"] + " " + i["title"]).replace('"', "'")
        graph.append(f'    {i["id"].replace("-", "_")}["{label}"]')
    for i in issues:
        for d in i["dependencies"]:
            graph.append(f'    {d.replace("-", "_")} --> {i["id"].replace("-", "_")}')
    graph += ["```", ""]
    (ROADMAP / "dependency-graph.md").write_text("\n".join(graph))

    body_dir = ROADMAP / "issue-bodies"
    body_dir.mkdir(parents=True, exist_ok=True)
    for i in issues:
        (body_dir / f"{i['id']}.md").write_text(issue_body(i))
    print(f"Rendered {len(issues)} issue briefs across {len(milestones)} milestones")


if __name__ == "__main__":
    main()
