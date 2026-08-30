# Architecture Decision Record: HUE-owned schedules and dedicated projectless Sessions

- **Status:** Implemented
- **Date:** 2026-08-28
- **Owners:** Curi / HUE
- **Extends:** ADR-0003, ADR-0005, and ADR-0009

## Context

Scheduled prompts need HUE's durable complete-envelope delivery semantics and visible conversational continuity without being attached to an arbitrary Project or mixed into an unrelated interactive Session. Treating Hermes cron state as authoritative would bypass MessageDispatcher acceptance and make ACP Session correlation unreliable.

## Decision

HUE SQLite is authoritative for schedule identity, name, prompt, five-field cron expression, enabled state, next occurrence, and dedicated Session association. Each schedule owns one projectless ACP Session under HUE's unprojected Session root. Every scheduled and manual run is a durable MessageDispatcher envelope; existing messages and Session events are the run history.

Due acceptance and next-occurrence advancement are one SQLite transaction. After downtime HUE coalesces missed occurrences into one run, then advances to the next future occurrence. Manual runs use a client-supplied run ID and do not move the scheduled occurrence. Session execution and mutation remain ACP-backed, and complete-envelope, idempotency, serialization, replay, permission, and unknown-delivery rules remain unchanged. HUE never auto-approves interactions.

Existing external Hermes cron jobs are not silently imported, mutated, or deleted. HUE may show an allowlisted inventory from Hermes and, after an explicit user action, forward bounded edits, pause/resume, or confirmed deletion through Hermes's authenticated cron API. Those jobs remain external unless a user explicitly recreates them in HUE.

HUE-managed Hermes schedules receive normal Session rows because HUE creates their durable envelopes and dedicated ACP Sessions, so identity, delivery state, notifications, and transcript review remain reliable. External Hermes cron jobs receive visibly separate Hermes-owned rows because HUE did not accept their work and cannot safely infer the same delivery guarantees. HUE establishes a read baseline, then checks Hermes every 30 minutes and when the Cron tasks surface opens. Newly discovered terminal runs create durable unread state and completion, failure, or unknown notifications. Their profile-scoped Hermes Session transcripts remain Hermes-owned and are read on demand without a composer or HUE Session association.

## Consequences

- Schedules remain a supporting surface, not a fourth user-facing HUE object.
- HUE owns scheduling state while Hermes ACP owns each Session's execution and transcript persistence.
- Dedicated projectless Sessions provide a stable review surface without weakening Project trust boundaries.
- External Hermes rows expose no HUE delivery badge or composer. Poll-derived notifications report discovery, not timely execution or HUE delivery; mutation controls operate on Hermes authority and require an explicit user action.

## Revisit triggers

- Product requirements need time zones or cron syntax beyond the implemented five-field form.
- Catch-up must preserve every missed occurrence instead of coalescing them.
