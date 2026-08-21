#!/usr/bin/env python3
"""Validate the production Astro/Starlight output and its internal route contract."""
from __future__ import annotations

import html.parser
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BASE = "/HUE/"
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def expected_file(route: str) -> Path:
    clean = route.strip("/")
    if not clean:
        return DIST / "index.html"
    return DIST / clean / "index.html"


class LinkCollector(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in {"a", "link", "script", "img"}:
            return
        attr = "href" if tag in {"a", "link"} else "src"
        for key, value in attrs:
            if key == attr and value:
                self.links.append(value)


def resolve_output_link(page: Path, raw: str) -> Path | None:
    parsed = urlparse(raw)
    if parsed.scheme or raw.startswith(("#", "mailto:", "data:", "javascript:")):
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    if path.startswith(BASE):
        relative = path[len(BASE) :]
    elif path == BASE.rstrip("/"):
        relative = ""
    elif path.startswith("/"):
        return None
    else:
        relative = (page.parent.relative_to(DIST) / path).as_posix()

    candidate = (DIST / relative).resolve()
    try:
        candidate.relative_to(DIST.resolve())
    except ValueError:
        return Path("__outside_dist__")
    if path.endswith("/") or not candidate.suffix:
        candidate = candidate / "index.html"
    return candidate


def validate_routes() -> None:
    routes = [
        "",
        "vision",
        "spec/00-status-and-review",
        "spec/04-ui-specification",
        "spec/05-system-architecture",
        "spec/14-decision-register",
        "roadmap/issues",
        "roadmap/dependencies",
        "decisions/adr-template",
        "contributing",
    ]
    routes.extend(f"roadmap/issues/hue-{number:03d}" for number in range(1, 51))
    for route in routes:
        path = expected_file(route)
        if not path.exists():
            fail(f"missing built route: /{route}/ ({path.relative_to(ROOT)})")

    for rel in ("prototype/index.html", "prototype/styles.css", "prototype/shadcn.css", "prototype/workspace-shell.css", "prototype/app.js", "favicon.svg", ".nojekyll"):
        if not (DIST / rel).exists():
            fail(f"missing built static asset: {rel}")

    for name in ("issues.json", "milestones.json", "labels.json", "github-map.json"):
        path = DIST / "data" / name
        if not path.exists():
            fail(f"missing built data file: data/{name}")
            continue
        try:
            json.loads(path.read_text())
        except Exception as exc:
            fail(f"invalid built JSON data/{name}: {exc}")


def validate_html() -> None:
    html_files = sorted(DIST.rglob("*.html"))
    if len(html_files) < 70:
        fail(f"expected at least 70 HTML files, found {len(html_files)}")
    diagram_count = 0
    broken: set[tuple[str, str]] = set()

    for page in html_files:
        text = page.read_text(errors="replace")
        diagram_count += len(re.findall(r'class=["\'][^"\']*\bmermaid\b', text))
        if "../blob/main/" in text:
            fail(f"unrewritten repository link in {page.relative_to(DIST)}")
        parser = LinkCollector()
        try:
            parser.feed(text)
            parser.close()
        except Exception as exc:
            fail(f"HTML parse failure in {page.relative_to(DIST)}: {exc}")
            continue
        for raw in parser.links:
            target = resolve_output_link(page, raw)
            if target is not None and not target.exists():
                broken.add((page.relative_to(DIST).as_posix(), raw))

    if diagram_count < 14:
        fail(f"expected at least 14 rendered Mermaid containers, found {diagram_count}")
    for page, raw in sorted(broken):
        fail(f"broken built link in {page}: {raw}")

    home = (DIST / "index.html").read_text(errors="replace") if (DIST / "index.html").exists() else ""
    for needle in ("One workspace. Clear boundaries.", "50", "Read the vision"):
        if needle not in home:
            fail(f"home page missing expected content: {needle}")
    if f'{BASE}_astro/' not in home:
        fail("home page does not contain base-prefixed Astro assets")

    prototype = (DIST / "prototype/index.html").read_text(errors="replace") if (DIST / "prototype/index.html").exists() else ""
    if "../vision/" not in prototype:
        fail("deployed prototype does not link back to the documentation vision route")


def validate_search() -> None:
    pagefind = DIST / "pagefind"
    if not pagefind.exists() or not any(pagefind.iterdir()):
        fail("Pagefind search index is missing")


def main() -> int:
    if not DIST.exists():
        print("FAILED: dist/ does not exist; run the production build first")
        return 1
    validate_routes()
    validate_html()
    validate_search()
    if ERRORS:
        print(f"FAILED: {len(ERRORS)} built-site validation error(s)")
        for error in ERRORS:
            print("-", error)
        return 1
    issue_pages = len(list((DIST / "roadmap/issues").glob("hue-*/index.html")))
    html_pages = len(list(DIST.rglob("*.html")))
    print(f"PASS: {html_pages} HTML pages, {issue_pages} issue briefs, Mermaid, search, links, data and prototype verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
