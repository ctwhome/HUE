# Architecture Decision Record: Per-Session ACP harness

- **Status:** Accepted
- **Date:** 2026-09-04
- **Owners:** Curi / HUE
- **Amends:** ADR-0002 and ADR-0005

## Context

Hermes remains HUE's primary agent harness, but OpenCode is also used regularly for software development. Both expose ACP v1 with Session creation, loading, listing, resumption, forking, cancellation, streamed updates, permission requests, and acknowledged prompt completion. Keeping all HUE delivery behavior tied to one process prevents choosing the better established harness for an individual conversation.

The installed OpenCode `1.18.4-new-ui-sidebar.11` was exercised through an isolated `opencode acp` process without private credentials, user persistence, provider calls, or LLM network access. Initialization, Session creation, listing, loading, and empty transcript replay succeeded.

## Decision

A Session stores one immutable harness choice: `hermes` or `opencode`. Hermes is the default for existing and newly created Sessions unless the user explicitly selects OpenCode at creation. HUE keeps its own globally unique Session id and separately stores the harness-native Session id; OpenCode ids are namespaced in HUE routes to prevent collisions.

One Session runtime resolver routes creation, resume, prompt delivery, transcript replay, capability state, settings, duplication, cancellation, and recovery to the persisted harness. Both adapters use the existing durable complete-envelope dispatcher, idempotency, per-Session serialization, cursor replay, explicit unknown-delivery state, and interaction boundary. Neither adapter may silently approve permission requests.

Hermes remains authoritative for Projects, Workflow bundles, schedules, Quick Ask, prompt improvement, commit generation, external cron, and Hermes administration. Hermes transcript pages continue through authenticated `hermes serve`; OpenCode transcript pages replay through ACP. Switching the harness of an existing Session is unsupported because transcripts and execution state remain harness-owned.

Schema version 10 additively backfills existing Sessions with `harness = 'hermes'` and `external_session_id = session_id`. A validated pre-migration backup is required before adding these identity columns to an existing version 9 database.

## Consequences

- Users can choose Hermes or OpenCode when creating Project or projectless Sessions without weakening HUE delivery guarantees.
- OpenCode must be installed and configured locally before an OpenCode Session can start.
- Harness-specific capabilities remain explicit; HUE does not pretend every ACP agent supports identical controls.
- Additional harnesses require a separate proven integration and decision, not a speculative plugin API.

## Revisit triggers

- ACP standardizes a transcript API that can replace adapter-specific transcript loading.
- Repeated use justifies another concrete harness.
- Workflows or schedules need an explicit non-Hermes execution owner.
- Cross-harness Session transfer gains a safe, transcript-preserving protocol.
