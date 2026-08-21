#!/usr/bin/env python3
"""Project canonical HUE documents into Starlight without duplicating sources."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "src/content/docs"
PUBLIC = ROOT / "public"
BASE = "/HUE"
GITHUB_EDIT = "https://github.com/ctwhome/HUE/edit/main/"

DOCS = sorted((ROOT / "docs").glob("*.md"))
ISSUE_DATA = json.loads((ROOT / "roadmap/issues.json").read_text())
ISSUES_BY_ID = {item["id"]: item for item in ISSUE_DATA}

PAGES: list[tuple[Path, Path, str | None, str | None]] = [
    (ROOT / "VISION.md", Path("vision.md"), None, "The north-star product vision and non-negotiable contract for HUE."),
    *[(path, Path("spec") / path.name, None, None) for path in DOCS],
    (ROOT / "roadmap/ISSUES.md", Path("roadmap/issues.md"), None, "The canonical milestone and implementation issue plan."),
    (ROOT / "roadmap/dependency-graph.md", Path("roadmap/dependencies.md"), None, "The generated dependency graph across all canonical HUE issues."),
    (ROOT / "decisions/0000-template.md", Path("decisions/adr-template.md"), "Architecture decision record template", "The evidence-first template for HUE architecture decisions."),
    (ROOT / "decisions/0001-sveltekit-shadcn-svelte.md", Path("decisions/sveltekit-shadcn-svelte.md"), "ADR-0001 — SvelteKit + shadcn-svelte", "The accepted HUE frontend framework and component-foundation decision."),
    (ROOT / "decisions/0002-bun-hermes-acp-workspace.md", Path("decisions/bun-hermes-acp-workspace.md"), "ADR-0002 — Bun + Hermes ACP workspace", "The accepted focused HUE workspace, storage, transport, and Hermes runtime boundary."),
    (ROOT / "prototype/README.md", Path("prototype/component-map.md"), "Static prototype → Svelte component map", "The shared token, component and migration contract between the functional prototype and future Svelte implementation."),
    (ROOT / "CONTRIBUTING.md", Path("contributing.md"), None, "How to contribute to HUE without silently changing its product contract."),
]

for issue_id, issue in sorted(ISSUES_BY_ID.items()):
    source = ROOT / "roadmap/issue-bodies" / f"{issue_id}.md"
    destination = Path("roadmap/issues") / f"{issue_id.lower()}.md"
    PAGES.append((source, destination, f"{issue_id} — {issue['title']}", issue["goal"]))

ROUTES: dict[str, str] = {
    "README.md": "/",
    "VISION.md": "/vision/",
    "prototype/index.html": "/prototype/",
    "roadmap/ISSUES.md": "/roadmap/issues/",
    "roadmap/dependency-graph.md": "/roadmap/dependencies/",
    "decisions/0000-template.md": "/decisions/adr-template/",
    "decisions/0001-sveltekit-shadcn-svelte.md": "/decisions/sveltekit-shadcn-svelte/",
    "decisions/0002-bun-hermes-acp-workspace.md": "/decisions/bun-hermes-acp-workspace/",
    "prototype/README.md": "/prototype/component-map/",
    "CONTRIBUTING.md": "/contributing/",
    "roadmap/issues.json": "/data/issues.json",
    "roadmap/milestones.json": "/data/milestones.json",
    "roadmap/labels.json": "/data/labels.json",
    "roadmap/github-map.json": "/data/github-map.json",
}
for path in DOCS:
    ROUTES[path.relative_to(ROOT).as_posix()] = f"/spec/{path.stem}/"
for issue_id in ISSUES_BY_ID:
    ROUTES[f"roadmap/issue-bodies/{issue_id}.md"] = f"/roadmap/issues/{issue_id.lower()}/"

LINK_RE = re.compile(r"(?P<prefix>!?\[[^\]]*\]\()(?P<target>[^)\s]+)(?P<suffix>(?:\s+[\"'][^)\n]*[\"'])?\))")


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def extract_title(text: str, fallback: str | None) -> tuple[str, str]:
    match = re.search(r"^#\s+(.+?)\s*$", text, flags=re.MULTILINE)
    if match:
        title = fallback or match.group(1).strip()
        body = text[: match.start()] + text[match.end() :]
        return title, body.lstrip("\n")
    if fallback:
        return fallback, text
    raise ValueError("Document has no H1 and no title override")


def first_description(text: str, fallback: str | None) -> str:
    if fallback:
        return fallback
    for block in re.split(r"\n\s*\n", text):
        candidate = " ".join(line.strip() for line in block.splitlines())
        if not candidate or candidate.startswith(("#", ">", "```", "|")):
            continue
        candidate = re.sub(r"[*_`]", "", candidate)
        return candidate[:220]
    return "HUE product specification."


def route_for(source: Path, target: str) -> str | None:
    if target.startswith(("http://", "https://", "mailto:", "#", "data:")):
        return None
    path_part, marker, fragment = target.partition("#")
    if path_part.startswith("../blob/main/"):
        canonical = unquote(path_part.removeprefix("../blob/main/"))
    else:
        try:
            canonical = ((source.parent / unquote(path_part)).resolve().relative_to(ROOT)).as_posix()
        except ValueError:
            return None
    route = ROUTES.get(canonical)
    if route is None:
        return None
    result = BASE + route
    if marker:
        result += "#" + fragment
    return result


def rewrite_links(source: Path, text: str) -> str:
    unresolved: list[str] = []

    def replace(match: re.Match[str]) -> str:
        target = match.group("target")
        route = route_for(source, target)
        if route:
            return match.group("prefix") + route + match.group("suffix")
        if not target.startswith(("http://", "https://", "mailto:", "#", "data:")):
            unresolved.append(target)
        return match.group(0)

    rewritten = LINK_RE.sub(replace, text)
    if source.name == "ISSUES.md":
        rewritten = re.sub(
            r"^### (HUE-(\d{3}) — .+)$",
            lambda match: f"### [{match.group(1)}]({BASE}/roadmap/issues/{match.group(1)[:7].lower()}/)",
            rewritten,
            flags=re.MULTILINE,
        )
    if unresolved:
        missing = ", ".join(sorted(set(unresolved)))
        raise ValueError(f"{source.relative_to(ROOT)} has unmapped local link(s): {missing}")
    return rewritten


def frontmatter(source: Path, title: str, description: str, order: int | None = None) -> str:
    rel = source.relative_to(ROOT).as_posix()
    lines = [
        "---",
        f"title: {yaml_string(title)}",
        f"description: {yaml_string(description)}",
        f"editUrl: {yaml_string(GITHUB_EDIT + rel)}",
    ]
    if order is not None:
        lines.extend(["sidebar:", f"  order: {order}"])
    lines.extend(["---", ""])
    return "\n".join(lines)


def prepare_content() -> None:
    shutil.rmtree(CONTENT, ignore_errors=True)
    CONTENT.mkdir(parents=True, exist_ok=True)
    landing = ROOT / "site/content/index.mdx"
    shutil.copy2(landing, CONTENT / "index.mdx")

    for source, destination, title_override, description_override in PAGES:
        raw = source.read_text()
        title, body = extract_title(raw, title_override)
        body = rewrite_links(source, body)
        description = first_description(body, description_override)
        issue_match = re.fullmatch(r"HUE-(\d{3})\.md", source.name)
        order = int(issue_match.group(1)) if issue_match else None
        output = frontmatter(source, title, description, order) + body.rstrip() + "\n"
        target = CONTENT / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(output)


def prepare_public() -> None:
    generated = [PUBLIC / "prototype", PUBLIC / "data"]
    for path in generated:
        shutil.rmtree(path, ignore_errors=True)

    shutil.copytree(ROOT / "prototype", PUBLIC / "prototype", ignore=shutil.ignore_patterns("screenshots"))
    prototype_index = PUBLIC / "prototype/index.html"
    prototype_text = prototype_index.read_text()
    prototype_text = prototype_text.replace("../VISION.md", "../vision/")
    prototype_text = prototype_text.replace("../docs/04-ui-specification.md", "../spec/04-ui-specification/")
    prototype_index.write_text(prototype_text)

    data_dir = PUBLIC / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in ("issues.json", "milestones.json", "labels.json", "github-map.json"):
        shutil.copy2(ROOT / "roadmap" / name, data_dir / name)


def main() -> None:
    prepare_content()
    prepare_public()
    page_count = len(PAGES) + 1
    print(f"Prepared {page_count} documentation pages, {len(ISSUES_BY_ID)} issue briefs, and prototype assets")


if __name__ == "__main__":
    main()
