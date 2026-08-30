# Architecture Decision Record: focused Hermes workspace on Bun and ACP

- **Status:** Accepted
- **Decision IDs:** TBD-001, TBD-002, TBD-004, TBD-007, TBD-012
- **Date:** 2026-07-23
- **Owners:** Curi / HUE
- **Supersedes:** the universal personal-agent control-plane alpha scope

> Project identity and folder ownership in this record are superseded by [ADR-0006](0006-hermes-projects-authority.md). Hermes Projects are authoritative; HUE retains only its own linked metadata and delivery truth.
>
> Workflow `work_mode` defaults are superseded by [ADR-0013](0013-hermes-native-workflow-bundles.md). Workflows now reference Hermes-owned bundle slugs; Session-level cadence state remains unchanged.

## Context

The original HUE specification grew into a universal personal operating system spanning Areas, knowledge, artifacts, notifications, routing, multiple worker runtimes, computer use, and source integrations. The immediate product need is much smaller: a fast, reliable, purpose-built web interface for Hermes Projects, reusable Workflows, and Sessions.

The existing Hermes Python dashboard is broad and terminal-oriented. Its browser PTY sends keystroke fragments and can lose unsent input during reconnects. A fork would also inherit unrelated pages and upstream frontend architecture.

## Evidence

`docs/spikes/001-hermes-acp-bun` exercised the installed Hermes runtime from Bun through the official `@agentclientprotocol/sdk`:

- ACP v1 initialization succeeded;
- a session was created;
- a complete prompt streamed nine updates and ended with `end_turn`;
- a fresh Hermes process listed and resumed the persisted session;
- the replay contained both the exact user prompt and complete assistant response.

A production integration test also verifies ACP initialization, session creation, local-command streaming, listing, and resume without invoking a model.

## Decision

Build HUE as a focused **Hermes workspace client** with exactly three product objects:

1. **Project** — a named, trusted working-directory boundary.
2. **Workflow** — a reusable Hermes launch/prompt definition scoped to a Project.
3. **Session** — a Hermes ACP conversation belonging to a Project working directory.

Use:

- SvelteKit 5 and Svelte 5 for UI and HTTP routes;
- Bun as package manager, test runner, server runtime, and SQLite host;
- `bun:sqlite` for HUE-owned Project, Workflow, idempotency, delivery-state, and event-cursor data;
- Hermes ACP v1 as the only Session execution and mutation adapter;
- the authenticated, loopback-only `hermes serve` messages endpoint for bounded read-only transcript pages without agent, provider, tool, or MCP initialization;
- complete HTTP message envelopes with client-generated IDs and durable acknowledgement;
- cursor-based event replay, initially via polling and later optionally SSE.

HUE owns Project and Workflow metadata plus message-delivery truth. Hermes owns model/tool execution and Hermes conversation persistence. HUE resumes and mutates Hermes Sessions through ACP. It reads transcript pages through the supervised Hermes server's authenticated read-only API so Hermes retains profile routing, compaction handling, pagination, and schema ownership; HUE never opens or writes `~/.hermes/state.db` directly.

HUE also persists each discovered or created Hermes Session's Project association and working directory. Session routes and delivery records require that association and use the composite Project/Session boundary. On startup, accepted queued turns resume their associated Hermes Session before dispatch; interrupted running turns become `unknown` with a durable event and are never retried automatically.

HUE also owns a per-Session `work_mode` enum with exactly `autonomous` and `live`. It defaults to `autonomous` for new, migrated, and forked Sessions, is stored only in HUE SQLite, is visible in Session list/detail payloads, and is changed only through HUE Session/message routes. It must never be confused with Hermes ACP runtime `modeId`, and it does not widen authority.

The browser never sends terminal keystrokes as chat input. HUE persists the full envelope before dispatch, deduplicates retries, serializes turns within a Session, and marks transport loss as `unknown` rather than automatically replaying a potentially side-effecting prompt.

At prompt time HUE reads the current stored `work_mode`, sends ACP `_meta.hue = { workMode, version, authorityUnchanged: true }`, and prefixes the user text with a fixed cadence-only preamble because current Hermes ACP ignores `_meta`. HUE strips only that exact generated preamble from replayed Hermes user transcript chunks so the HUE-visible transcript remains the original user text.

## Explicit non-goals

The focused product does not implement:

- Areas, Resources, universal Inbox, Home dashboard, or global memory center;
- a generic task/run graph or visual workflow builder;
- artifact/file management, source synchronization, or computer use UI;
- notifications, phone delivery, collaboration, or hosted sync;
- multi-runtime routing, OpenCode/Codex/Claude adapters, or a native agent runtime;
- model/provider/tool administration already owned by Hermes.

These may be reconsidered only through a new product decision; they are not implicit backlog.

## Consequences

### Positive

- The implemented surface matches the actual need and can remain fast.
- Hermes capabilities are reused without importing its Python dashboard.
- Message integrity is materially stronger than PTY input.
- HUE metadata stays small, local, inspectable, and independently migratable.
- On-demand Project → Session loading is inherent in the API boundary.

### Trade-offs

- HUE depends on Hermes ACP behavior and version compatibility.
- Hermes Sessions remain runtime-owned rather than fully canonical HUE records.
- ACP startup loads the selected Hermes profile and can take several seconds; the service must supervise and reuse the process.
- Permission prompts require an explicit HUE UI before approval-capable tool flows can be considered complete. The initial adapter cancels permission requests rather than granting silently.

### External blocker: Hermes clarify bridge

Hermes Agent v0.20.5 does not expose its installed `clarify` tool through ACP. `acp_adapter/server.py` creates the per-turn permission callback with `conn.request_permission`, but never assigns `agent.clarify_callback`. The core tool executor passes that unset callback to `clarify_tool`, so HUE cannot truthfully offer clarify elicitation for this adapter version. HUE reports clarify as unsupported until it observes an actual inbound ACP `elicitation/create` request; only an observed request may create an answerable HUE interaction.

Minimal upstream Hermes handoff:

1. Upgrade or extend Hermes' Python ACP SDK seam so `AgentSideConnection` can send typed `elicitation/create` requests and receive `CreateElicitationResponse`. The SDK bundled with Hermes v0.20.5 exposes `request_permission` but no elicitation method; do not call its private connection from HUE.
2. In `acp_adapter/server.py::initialize`, retain whether `client_capabilities.elicitation.form` was advertised.
3. In `acp_adapter/server.py::prompt`, build a per-session synchronous `clarify_callback` beside `make_approval_callback`. Convert Hermes single/batch questions and choices into a form `requestedSchema`, submit `elicitation/create` on the ACP event loop with `asyncio.run_coroutine_threadsafe`, and map accepted content or cancel back to the return shape expected by `clarify_tool`.
4. Assign and restore `agent.clarify_callback` inside `_run_agent`, on the executor thread and within the same per-session context used by approval callbacks. Cancellation, timeout, client disconnect, unsupported schema, and absent client form capability must return cancel rather than block or auto-answer.
5. Add Hermes adapter tests proving single choice, multi-select, free text, batch questions, cancellation, timeout, concurrent-session isolation, and no callback leakage after a turn.

This change belongs in Hermes Agent, not HUE. HUE must keep its capability gate after upstream support lands because older or alternate ACP agents may still omit the bridge.

### Issue 65 capability and file boundaries

Installed Hermes Agent v0.20.5 reads ACP `resource_link` content only from local file paths or `file://` URIs. HUE therefore stages validated non-image bytes in a private per-turn temporary directory, deletes it after every terminal prompt outcome, and persists only attachment metadata. Reloaded metadata is explicitly unavailable until reattached.

Current ACP exposes full-Session `session/fork`, but no selected-message fork, Session import, authoritative model cost, or compression-state seam. HUE labels these controls unavailable and must not substitute full-Session duplication or inferred usage. Revisit only after Hermes advertises and proves matching ACP behavior.

HUE verifies stable signatures for PDF, Office/ZIP, gzip, tar, 7z, supported images, MP3/WAV/Ogg/M4A, MP4/WebM, and QuickTime. Safe text/code uses strict UTF-8 and NUL rejection. Formats without stable signatures remain unsupported rather than accepted by extension alone.

## Revisit triggers

- Hermes ACP cannot expose a required Session capability safely.
- Bun or `bun:sqlite` fails representative durability/performance gates.
- A fourth product object is justified by repeated real use rather than speculative breadth.
- Multi-user or remote-untrusted deployment becomes a requirement.
