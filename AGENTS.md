# AGENTS.md

## Product boundary

HUE is a focused native Bun/SvelteKit workspace for exactly three user-facing objects: Projects, Workflows, and Hermes Sessions. HUE owns local organization and reliable message-delivery state; Hermes ACP owns agent execution and Hermes transcript persistence. Do not write Hermes' internal database directly or silently grant ACP permission requests.

## Repository map

- `app/`: production SvelteKit 5/Svelte 5 application and Bun SQLite control plane.
- `docs/`: Astro/Starlight application, canonical specification, roadmap, decisions, and retained spikes.
- `docs/decisions/`: accepted architecture decisions; ADR-0002 is the baseline, and later accepted ADRs may amend, extend, or supersede it.
- `docs/14-decision-register.md`: canonical index of accepted and unresolved decisions.
- `docs/spikes/001-hermes-acp-bun/`: retained evidence for the validated Hermes ACP seam.
- `prototype/`: historical interactive design context.

## Canonical commands

Use Bun throughout. Do not substitute npm, pnpm, yarn, or a version-specific Bun command.

```bash
bun install --frozen-lockfile
bun test
bun run --cwd app check
bun run --cwd app build
bun run --cwd app test:e2e
HUE_REAL_HERMES=1 bun test app/src/lib/server/hermes-acp.test.ts
```

Run production locally from `app` with `bun run build` followed by `HOST=127.0.0.1 PORT=4173 HUE_DATABASE_PATH="$HOME/.hue/hue.db" bun run start`.

## Development workflow

- Always apply Ponytail in full mode to development work: understand the real flow first, then choose the smallest correct solution.
- Inspect the relevant implementation, callers, tests, and accepted decisions before editing. Do not guess at repository conventions.
- Use this order: avoid speculative work, reuse repository code, use the standard library or native platform, use an installed dependency, then write the minimum new code.
- Fix bugs at the shared root cause rather than patching each symptom. Preserve validation, security, accessibility, and data-loss protections.
- Keep changes scoped to the request. Do not add abstractions, dependencies, compatibility layers, configuration, or scaffolding without a current concrete need.
- For behavior changes, write the smallest failing test first. Run focused checks while iterating, then the relevant canonical gates after the final edit.
- Update canonical docs when product behavior, architecture, or operations change. Avoid unrelated documentation churn.
- Continue through implementation and verification unless blocked by a decision only the user can make. Report skipped checks and blockers explicitly.

## Delivery rules

- Work on the `main` branch unless the user specifically requests another branch in the chat; do not merge automatically.
- No speculative runtime adapters, hosted sync, or broad personal-OS scope without a new decision.
- Use Lucide icons through `unplugin-icons` (`~icons/lucide/<icon>`) when a matching icon exists. Keep product marks and project/session emoji as-is; icon-only controls require an accessible name and tooltip.
- Preserve complete-envelope submission, idempotency, per-session serialization, cursor replay, and explicit unknown-delivery state.
- SQLite schema changes must preserve automatic backups, historical-schema migration coverage, and tested failure recovery; never destructively rewrite user data in place.
- Real-Hermes tests must use an isolated temporary `HERMES_HOME`, dummy credentials, and no LLM/provider network access or user persistence.
- User-facing shell changes require browser verification at 1440×900, 1024×768, 390×844, and dense 320px mobile where relevant. Check interaction, overflow, console/resources, labels, focus, drawers, and 44px mobile targets.
- Do not commit generated `node_modules`, `.svelte-kit`, `build`, test output, local databases, credentials, LaunchAgent files, or private session content.
