# Contributing to HUE

HUE is an active focused implementation. Changes should improve Projects, Workflows, Hermes Sessions, or a supporting surface authorized by an accepted ADR.

## Before changing code

1. Read `docs/00-status-and-review.md`, `docs/05-system-architecture.md`, and the relevant accepted ADR.
2. Trace the existing implementation, callers, tests, and ownership boundary.
3. Add an ADR before changing product objects, persistence authority, permission behavior, or external delivery.
4. Keep Hermes execution and transcripts behind ACP/Hermes APIs; never write Hermes databases or silently grant permissions.

## Pull request evidence

Include the behavior changed, focused test evidence, applicable canonical gate output, migration/rollback notes when data changes, security/privacy impact, and screenshots or recordings for user-facing changes.

## Documentation

Canonical Markdown lives in `docs/*.md` and `docs/decisions/*.md`. The Starlight site projection is generated; do not edit `docs/src/content/docs/`. Obsolete broad roadmap and prototype sources have been removed and must not be restored as implicit backlog.

## Local validation

```bash
bun install --frozen-lockfile
bun run --cwd docs verify
bun test
bun run --cwd app check
bun run --cwd app build
bun run --cwd app test:e2e
```

Run only the gates relevant while iterating, then run the applicable final commands after the last edit. Real-Hermes tests must use an isolated temporary `HERMES_HOME`, dummy credentials, and no provider network access.
