# Contributing to HUE

HUE is currently a **documentation-first product specification**, not a production application. Contributions should sharpen the product contract, resolve named decisions with evidence, or implement a scoped roadmap issue without silently changing the vision.

## Before proposing code

1. Read `VISION.md` and the relevant product chapters.
2. Find the canonical `HUE-xxx` issue in `roadmap/issues.json` / GitHub.
3. Check dependencies and named `TBD` decisions.
4. Do not implement a blocked issue by choosing an architecture in code; resolve the ADR first.

## Pull request evidence

A PR should include:

- linked issue (`Closes #...` when complete);
- acceptance-criterion mapping;
- tests and actual verification output;
- UI screenshots/recording when applicable;
- data migration and rollback notes when applicable;
- security/privacy impact;
- exact documentation/status changes.

## Documentation changes

- Use `TBI`, `TBD`, `SPEC`, `POC`, `IMPLEMENTED`, and `VERIFIED` exactly as defined.
- Do not mark an entire chapter implemented for a partial slice.
- Add unresolved material choices to the decision register and an ADR issue.
- Keep `roadmap/*.json` canonical; run the render script after edits.

## Local validation

```bash
python3 scripts/render_roadmap.py
python3 scripts/validate_docs.py
bun install
bun run verify
```

`bun run verify` regenerates the Starlight content projection, checks Astro and the canonical product contract, builds the production site, then crawls built routes, internal links, Mermaid containers, Pagefind search, roadmap data and the interactive prototype.

## License

Contribution terms remain `TBD-019` until the repository adopts an explicit license and governance model. Do not submit third-party code or content whose reuse terms are unclear.
