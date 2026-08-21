# Architecture Decision Record: focused Hermes workspace on Bun and ACP

- **Status:** Accepted
- **Decision IDs:** TBD-001, TBD-002, TBD-004, TBD-007, TBD-012
- **Date:** 2026-07-23
- **Owners:** Curi / HUE
- **Supersedes:** the universal personal-agent control-plane alpha scope

## Context

The original HUE specification grew into a universal personal operating system spanning Areas, knowledge, artifacts, notifications, routing, multiple worker runtimes, computer use, and source integrations. The immediate product need is much smaller: a fast, reliable, purpose-built web interface for Hermes Projects, reusable Workflows, and Sessions.

The existing Hermes Python dashboard is broad and terminal-oriented. Its browser PTY sends keystroke fragments and can lose unsent input during reconnects. A fork would also inherit unrelated pages and upstream frontend architecture.

## Evidence

`spikes/001-hermes-acp-bun` exercised the installed Hermes runtime from Bun through the official `@agentclientprotocol/sdk`:

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
- Hermes ACP v1 as the only execution adapter;
- complete HTTP message envelopes with client-generated IDs and durable acknowledgement;
- cursor-based event replay, initially via polling and later optionally SSE.

HUE owns Project and Workflow metadata plus message-delivery truth. Hermes owns model/tool execution and Hermes conversation persistence. HUE reads and resumes Hermes Sessions through ACP; it does not write `~/.hermes/state.db` directly.

HUE also persists each discovered or created Hermes Session's Project association and working directory. Session routes and delivery records require that association and use the composite Project/Session boundary. On startup, accepted queued turns resume their associated Hermes Session before dispatch; interrupted running turns become `unknown` with a durable event and are never retried automatically.

The browser never sends terminal keystrokes as chat input. HUE persists the full envelope before dispatch, deduplicates retries, serializes turns within a Session, and marks transport loss as `unknown` rather than automatically replaying a potentially side-effecting prompt.

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

## Revisit triggers

- Hermes ACP cannot expose a required Session capability safely.
- Bun or `bun:sqlite` fails representative durability/performance gates.
- A fourth product object is justified by repeated real use rather than speculative breadth.
- Multi-user or remote-untrusted deployment becomes a requirement.
