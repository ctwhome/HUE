# Decision register

> **Register status:** `SPEC`
> Every unresolved item below is explicitly `TBD`. Implementations must reference an accepted ADR rather than choose by accident.

## Accepted decisions

| ID | Decision | Accepted direction | ADR | Status |
|---|---|---|---|---|
| TBD-020 | Frontend and component system | SvelteKit + Svelte 5 + shadcn-svelte beneath HUE-owned tokens and wrapper components; static HTML prototype retained until functional flows stabilize | [ADR-0001](decisions/0001-sveltekit-shadcn-svelte.md) | Accepted |
| TBD-001, TBD-002, TBD-004, TBD-007, TBD-012 | Focused product boundary, shell, control plane, runtime, storage, and transport | Browser workspace on SvelteKit/Bun; `bun:sqlite`; Hermes ACP external-process adapter; acknowledged HTTP envelopes and cursor replay | [ADR-0002](decisions/0002-bun-hermes-acp-workspace.md) | Accepted |

## Alpha-blocking decisions

| ID | Decision | Options to evaluate | Decision criteria | Status |
|---|---|---|---|---|
| TBD-003 | Orchestration foundation | custom state machine; Magentic/Agent Framework concepts; LangGraph; Mastra; Google ADK; hybrid | durable execution, dynamic plans, observability, adapter neutrality, complexity | TBD |
| TBD-005 | Default task topology policy | rules + LLM; planner-first; direct-first adaptive; learned policy | predictability, cost, quality, avoid agent bureaucracy | TBD |
| TBD-006 | Knowledge/memory engine | portable files + relational graph; relational curated records; vector DB; hybrid; adapt Hermes memory | human readability, backlinks, provenance, correction, namespaces, privacy, portability | TBD |

| TBD-008 | Routing evaluation and optimization | static policy; local benchmarks; opt-in federated metrics; manual ranking | privacy, measurable quality, provider churn, simplicity | TBD |
| TBD-009 | Worker catalog format | built-in typed manifests; YAML/Markdown; plugin-provided; skills as manifests | discoverability, safety, versioning, authoring UX | TBD |
| TBD-010 | Computer-use backend | cua-driver; OS-specific native adapters; browser-only first; pluggable contract | background operation, accessibility, safety, cross-platform, recordings | TBD |
| TBD-011 | Worker/code isolation | git worktrees; OS sandbox; containers; lightweight VM; policy mix | security, performance, filesystem fidelity, cross-platform | TBD |


## Pre-alpha decisions

| ID | Decision | Options/criteria | Status |
|---|---|---|---|
| TBD-013 | Notification gateways and delivery architecture | local OS/sound, native or PWA push, self-hosted/E2E relay, Telegram, email, webhooks; delivery receipts, offline queue, privacy, deep links, operating cost | TBD |
| TBD-014 | Mobile attention surface | responsive web/PWA; native shell; companion app; notification-only first; secure monitor/approval depth | TBD |
| TBD-015 | Plugin/tool protocol | MCP-first; native SDK; both through capability adapter | TBD |
| TBD-016 | Cross-Space retrieval | deny by default; explicitly linked Resources; shared collections; policy-mediated query | TBD |
| TBD-017 | Sync and remote access | no sync initially; direct tailnet; E2E relay; hosted account optional | TBD |
| TBD-018 | Credential vault | OS keychain abstraction; external secret manager integrations | TBD |
| TBD-019 | Open-source license/governance | Apache-2.0; AGPL-3.0; MPL-2.0; dual/community license | TBD |
| TBD-021 | Telemetry/evaluation sharing | local only; opt-in anonymous aggregates; opt-in trace upload | TBD |
| TBD-022 | Portable context-pack format and location | Markdown role files; frontmatter; sidecar manifest; database projection and checkout rules | TBD |
| TBD-023 | Authoritative-source synchronization | GitHub/Calendar/email connector ownership, polling/webhooks, writeback and conflict semantics | TBD |
| TBD-024 | OpenCode adapter mode | official server/API; managed CLI subprocess; SDK; compatibility bridge | TBD |

## ADR workflow

Each decision gets `docs/decisions/NNNN-title.md` using the template. An accepted ADR includes:

- context and decision question;
- constraints/non-negotiables from the vision;
- options and evidence;
- disposable spike results if needed;
- decision;
- consequences and risks;
- migration/revisit trigger;
- affected docs/issues.

## Recommended investigation order

1. **Accepted ADR-0002:** implement and harden the focused Project/Workflow/Session slice.
2. **TBD-003 + TBD-005:** only revisit orchestration if the focused product produces a concrete need.
4. **TBD-006 + TBD-016 + TBD-022:** context pack, knowledge and memory semantics.
5. **TBD-009 + TBD-011:** worker and isolation contracts.
6. **TBD-008:** route policy/evaluation.
7. **TBD-010:** computer use after permission engine foundations.
8. **TBD-023 + TBD-024:** source ownership and the first replaceable execution adapter.
9. Remaining packaging/ecosystem decisions.

## Strong current hypotheses (not decisions)

These are recommendations to test, still `TBD`:

- Keep HUE's Project/Workflow metadata and delivery journal independent while treating Hermes ACP as the sole Session execution/runtime boundary.
- Use the accepted SvelteKit + Svelte 5 frontend and shadcn-svelte component foundation regardless of which packaging option wins `TBD-001`.
- Do not fork or embed the existing Hermes Python WebUI; use ACP and complete semantic message envelopes instead of PTY input.
- Use SQLite as canonical local transactional storage with an append-only event journal and rebuildable indexes.
- Build a small custom durable orchestration state machine while borrowing proven supervisor patterns; avoid importing a large framework before requirements are proven.
- Use capability manifests and runtime adapters; do not encode providers directly in product features.
- Use OpenCode as the first primary software execution backend while HUE owns Session continuity, context injection, permissions, task state and normalization; validate the exact adapter mode under `TBD-024`.
- Keep Space context packs human-readable and file-based at the product boundary even if SQLite, FTS or vectors provide derived indexes.
- Keep GitHub, Calendar, email and user files authoritative for native objects; HUE stores bindings/projections plus its own Session/run state.
- Use `cua-driver` as the first computer-use spike because it already offers cross-platform, accessibility-first, background-capable control, while preserving a replaceable backend interface.
- Default coding work to managed git worktrees plus stricter sandboxing for untrusted execution.

Hypotheses become architecture only through accepted ADRs and evidence.
