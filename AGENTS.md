# AGENTS.md

## Product boundary

HUE is a focused native Bun/SvelteKit workspace for exactly three user-facing objects: Projects, Workflows, and Hermes Sessions. HUE owns local organization and reliable message-delivery state; Hermes ACP owns agent execution and Hermes transcript persistence. Do not write Hermes' internal database directly or silently grant ACP permission requests.

## Repository map

- `app/`: production SvelteKit 5/Svelte 5 application and Bun SQLite control plane.
- `docs/`: Astro/Starlight application, canonical specification, roadmap, decisions, and retained spikes.
- `docs/decisions/`: accepted architecture decisions; ADR-0002 is the active implementation boundary.
- `docs/spikes/001-hermes-acp-bun/`: retained evidence for the validated Hermes ACP seam.
- `prototype/`: historical interactive design context.

## Canonical commands

Use Bun 1.3.14 throughout.

```bash
bun install --frozen-lockfile
bun test
cd app
bun run check
bun run build
bun run test:e2e
HUE_REAL_HERMES=1 bun test src/lib/server/hermes-acp.test.ts
```

Run production locally from `app` with `bun run build` followed by `HOST=127.0.0.1 PORT=4173 HUE_DATABASE_PATH="$HOME/.hue/hue.db" bun run start`.

## Delivery rules

- Work on a feature branch; do not merge automatically.
- Keep the implementation direct and small; no speculative runtime adapters, hosted sync, or broad personal-OS scope without a new decision.
- Behavior changes use test-first development.
- Preserve complete-envelope submission, idempotency, per-session serialization, cursor replay, and explicit unknown-delivery state.
- User-facing shell changes require browser verification at 1440×900, 1024×768, 390×844, and dense 320px mobile where relevant. Check interaction, overflow, console/resources, labels, focus, drawers, and 44px mobile targets.
- Do not commit generated `node_modules`, `.svelte-kit`, `build`, test output, local databases, credentials, LaunchAgent files, or private session content.
