#!/usr/bin/env python3
"""Validate the focused HUE documentation contract."""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
ERRORS: list[str] = []
DOCS = [ROOT / "README.md", ROOT / "CONTRIBUTING.md", *sorted((ROOT / "docs").glob("*.md")), *sorted((ROOT / "docs/decisions").glob("*.md"))]


def fail(message: str) -> None:
    ERRORS.append(message)


def validate_markdown() -> None:
    link_re = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
    fence_re = re.compile(r"^\s*```([^`]*)$")
    for path in DOCS:
        text = path.read_text()
        open_fence: tuple[int, str] | None = None
        for number, line in enumerate(text.splitlines(), 1):
            match = fence_re.match(line)
            if not match:
                continue
            if open_fence is None:
                open_fence = (number, match.group(1).strip())
            elif match.group(1).strip():
                fail(f"{path.relative_to(ROOT)}:{number}: closing fence must not have a language")
            else:
                open_fence = None
        if open_fence:
            language = open_fence[1] or "plain"
            fail(f"{path.relative_to(ROOT)}:{open_fence[0]}: unclosed {language} fence")

        for raw in link_re.findall(text):
            target = raw.split("#", 1)[0].strip()
            if not target or re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            resolved = (path.parent / unquote(target)).resolve()
            try:
                resolved.relative_to(ROOT)
            except ValueError:
                fail(f"{path.relative_to(ROOT)}: link escapes repository: {raw}")
                continue
            if not resolved.exists():
                fail(f"{path.relative_to(ROOT)}: broken link: {raw}")


def validate_decision_register() -> None:
    register = (ROOT / "docs/14-decision-register.md").read_text()
    decisions = sorted((ROOT / "docs/decisions").glob("[0-9][0-9][0-9][1-9]-*.md"))
    decisions += sorted((ROOT / "docs/decisions").glob("[0-9][0-9][1-9][0-9]-*.md"))
    for path in sorted(set(decisions)):
        adr = f"ADR-{path.name[:4]}"
        if adr not in register:
            fail(f"docs/14-decision-register.md: missing {adr}")


def main() -> int:
    validate_markdown()
    validate_decision_register()
    if ERRORS:
        print(f"FAILED: {len(ERRORS)} validation error(s)")
        for error in ERRORS:
            print("-", error)
        return 1
    print(f"PASS: {len(DOCS)} focused documents, links, fences, and decision register verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
