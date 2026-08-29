#!/usr/bin/env python3
"""Project canonical HUE documents into Starlight."""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import unquote

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
CONTENT = APP / "src/content/docs"
PUBLIC = APP / "public"
BASE = os.environ.get("HUE_DOCS_BASE", "/HUE")
GITHUB_EDIT = "https://github.com/ctwhome/HUE/edit/main/"

DOCS = sorted((ROOT / "docs").glob("*.md"))
DECISIONS = sorted((ROOT / "docs/decisions").glob("*.md"))


def decision_slug(path: Path) -> str:
    return "adr-template" if path.stem == "0000-template" else path.stem.split("-", 1)[1]


PAGES: list[tuple[Path, Path]] = [
    *[(path, Path("spec") / path.name) for path in DOCS],
    *[(path, Path("decisions") / f"{decision_slug(path)}.md") for path in DECISIONS],
    (ROOT / "CONTRIBUTING.md", Path("contributing.md")),
]

ROUTES = {
    "README.md": "/",
    "CONTRIBUTING.md": "/contributing/",
    **{path.relative_to(ROOT).as_posix(): f"/spec/{path.stem}/" for path in DOCS},
    **{
        path.relative_to(ROOT).as_posix(): f"/decisions/{decision_slug(path)}/"
        for path in DECISIONS
    },
}
LINK_RE = re.compile(r"(?P<prefix>!?\[[^\]]*\]\()(?P<target>[^)\s]+)(?P<suffix>(?:\s+[\"'][^)\n]*[\"'])?\))")


def extract_title(text: str) -> tuple[str, str]:
    match = re.search(r"^#\s+(.+?)\s*$", text, flags=re.MULTILINE)
    if not match:
        raise ValueError("Document has no H1")
    return match.group(1).strip(), (text[: match.start()] + text[match.end() :]).lstrip("\n")


def description(text: str) -> str:
    for block in re.split(r"\n\s*\n", text):
        candidate = " ".join(line.strip() for line in block.splitlines())
        if candidate and not candidate.startswith(("#", ">", "```", "|", "- **")):
            return re.sub(r"[*_`]", "", candidate)[:220]
    return "HUE focused product documentation."


def route_for(source: Path, target: str) -> str | None:
    if target.startswith(("http://", "https://", "mailto:", "#", "data:")):
        return None
    path_part, marker, fragment = target.partition("#")
    try:
        canonical = ((source.parent / unquote(path_part)).resolve().relative_to(ROOT)).as_posix()
    except ValueError:
        return None
    route = ROUTES.get(canonical)
    if route is None:
        return None
    return BASE + route + (("#" + fragment) if marker else "")


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
    if unresolved:
        raise ValueError(
            f"{source.relative_to(ROOT)} has unmapped local link(s): {', '.join(sorted(set(unresolved)))}"
        )
    return rewritten


def prepare_content() -> None:
    shutil.rmtree(CONTENT, ignore_errors=True)
    CONTENT.mkdir(parents=True)
    shutil.copy2(APP / "site/content/index.mdx", CONTENT / "index.mdx")
    for source, destination in PAGES:
        title, body = extract_title(source.read_text())
        body = rewrite_links(source, body)
        rel = source.relative_to(ROOT).as_posix()
        output = "\n".join(
            [
                "---",
                f"title: {json.dumps(title)}",
                f"description: {json.dumps(description(body))}",
                f"editUrl: {json.dumps(GITHUB_EDIT + rel)}",
                "---",
                "",
                body.rstrip(),
                "",
            ]
        )
        target = CONTENT / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(output)


def prepare_public() -> None:
    for path in (PUBLIC / "prototype", PUBLIC / "data"):
        shutil.rmtree(path, ignore_errors=True)


def main() -> None:
    prepare_content()
    prepare_public()
    print(f"Prepared {len(PAGES) + 1} documentation pages from canonical Markdown")


if __name__ == "__main__":
    main()
