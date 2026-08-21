# Focused implementation roadmap

> **Plan status:** `IMPLEMENTED IN PART`
> **Product scope:** Projects, Workflows, Sessions
> **Architecture:** [ADR-0002](decisions/0002-bun-hermes-acp-workspace.md)

HUE is now a focused Hermes workspace client. Earlier universal-control-plane milestones are superseded and are not an implicit backlog.

## Sequencing principle

Build and harden one thin path:

```text
Project → Workflow or new Session → complete acknowledged message → Hermes ACP → cursor-replayable result
```

## M0 — Runtime seam and delivery truth

**Goal:** prove that Bun can use Hermes without the Python dashboard or browser PTY.

- Bun/ACP disposable spike;
- ACP process supervision and v1 negotiation;
- Project-scoped session create/list/resume;
- SQLite message-envelope idempotency;
- queued/running/completed/failed/unknown delivery states;
- monotonic reconnect event cursor;
- no automatic retry after uncertain delivery.

**Exit:** a fresh Hermes ACP process can resume a persisted real turn, and backend tests prove exact-message deduplication and reconnect replay.

## M1 — Functional local workspace

**Goal:** operate real Projects, Workflows, and Sessions in a browser.

- SvelteKit/Bun application shell;
- Project CRUD with trusted root validation;
- Workflow CRUD and run action;
- sessions loaded only for the selected Project;
- new/resume Session;
- complete-message composer with accepted status;
- streamed/polled event projection and reconnect recovery;
- explicit empty, loading, failure, and unknown-delivery states;
- desktop rail/sidebar/work layout plus mobile Project and Session drawers.

**Exit:** a user can add a real local Project, create or resume a Hermes Session, send a full message, disconnect/reload, and recover the acknowledged result without truncation.

## M2 — Reliability and release

**Goal:** make the focused workspace dependable for daily use.

- ACP crash/restart reconciliation;
- visible permission requests with deny-by-default policy;
- cancel/steer support where ACP can prove semantics;
- SQLite migrations, backup/export, and retention;
- local authentication and tailnet deployment guidance;
- keyboard, screen-reader, responsive, and browser tests;
- startup/navigation/message latency budgets;
- packaged Bun service with health diagnostics.

**Exit:** representative mobile/Tailscale interruption tests pass, no message is silently truncated or double-executed, and the local service survives restart with truthful state.

## Scope discipline

The roadmap intentionally excludes generic orchestration, multiple runtimes, Areas, knowledge/memory management, files/artifacts, notifications, computer use, and third-party source integrations. Additions require a superseding product decision with real usage evidence.
