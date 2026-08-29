#!/usr/bin/env python3
"""Validate built Starlight routes, links, Mermaid output, and search."""
from __future__ import annotations

import html.parser
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


class LinkCollector(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in {"a", "link", "script", "img"}:
            return
        key = "href" if tag in {"a", "link"} else "src"
        self.links.extend(value for name, value in attrs if name == key and value)


def output_link(page: Path, raw: str) -> Path | None:
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
    return candidate / "index.html" if path.endswith("/") or not candidate.suffix else candidate


def expected_routes() -> list[str]:
    docs = [f"spec/{path.stem}" for path in (ROOT.glob("*.md"))]
    decisions = []
    for path in (ROOT / "decisions").glob("*.md"):
        slug = "adr-template" if path.stem == "0000-template" else path.stem.split("-", 1)[1]
        decisions.append(f"decisions/{slug}")
    return ["", "contributing", *docs, *decisions]


def main() -> int:
    if not DIST.exists():
        print("FAILED: dist/ does not exist; run the production build first")
        return 1
    for route in expected_routes():
        target = DIST / route / "index.html" if route else DIST / "index.html"
        if not target.exists():
            fail(f"missing built route: /{route}/")
    for asset in ("favicon.svg", ".nojekyll"):
        if not (DIST / asset).exists():
            fail(f"missing built asset: {asset}")

    html_files = sorted(DIST.rglob("*.html"))
    diagrams = 0
    broken: set[tuple[str, str]] = set()
    for page in html_files:
        text = page.read_text(errors="replace")
        diagrams += len(re.findall(r'class=["\'][^"\']*\bmermaid\b', text))
        parser = LinkCollector()
        parser.feed(text)
        parser.close()
        for raw in parser.links:
            target = output_link(page, raw)
            if target is not None and not target.exists():
                broken.add((page.relative_to(DIST).as_posix(), raw))
    if diagrams < 1:
        fail("expected at least one rendered Mermaid container")
    for page, raw in sorted(broken):
        fail(f"broken built link in {page}: {raw}")
    if not (DIST / "pagefind").exists():
        fail("Pagefind search index is missing")
    home = (DIST / "index.html").read_text(errors="replace")
    for text in ("Reliable Hermes work", "Projects", "Decisions"):
        if text not in home:
            fail(f"home page missing expected content: {text}")

    if ERRORS:
        print(f"FAILED: {len(ERRORS)} built-site validation error(s)")
        for error in ERRORS:
            print("-", error)
        return 1
    print(f"PASS: {len(html_files)} HTML pages, Mermaid, search, routes, and links verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
