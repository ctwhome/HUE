# Architecture Decision Record: focused notifications

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owners:** Curi / HUE
- **Amends:** ADR-0002 notification non-goal

## Context

Session work can finish, fail, become uncertain, or require permission while the user is away. The implemented notification slice provides useful attention without reviving the obsolete broad notification-gateway roadmap.

## Decision

Retain HUE notifications as a bounded supporting surface. HUE owns an idempotent SQLite projection for five Session event kinds: completion, pending permission, pending clarify, failure, and unknown delivery. In-app state is canonical. Optional Web Push and foreground sound are delivery projections, not new product objects.

External content is privacy-minimized and generic. Credentials are encrypted at rest with a separate local key. Registration starts from the current event baseline, retries are bounded, endpoint presence can suppress redundant non-urgent delivery, and delivery acknowledgements never imply read or action. ADR-0010 extends this projection to newly discovered terminal external Hermes cron runs after a separate run-history baseline.

Notifications do not grant permissions, answer clarifications, retry unknown prompts, or disclose transcript content.

## Consequences

- Notifications remain available for Project and projectless Sessions.
- HUE owns notification lifecycle and delivery attempts, while browser/OS delivery remains best effort.
- Email, Telegram, hosted relays, arbitrary webhooks, broad policy hierarchies, and rich lock-screen content are not accepted direction.

## Revisit triggers

- A new channel has a concrete user need and an acceptable credential/privacy contract.
- Multi-user delivery or hosted relay operation becomes a product requirement.
