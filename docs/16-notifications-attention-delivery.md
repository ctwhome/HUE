# Focused notifications

> **Status:** `IMPLEMENTED IN PART`
> **Decision:** [ADR-0009](decisions/0009-focused-notifications.md)

HUE keeps a durable, local attention projection for meaningful Session outcomes and requests. It does not turn raw model, thought, progress, plan, or tool events into notifications.

## Current contract

- Only `message.completed`, pending `agent.permission`, pending `agent.clarify`, `message.failed`, and `message.unknown` create canonical notifications.
- Source-event sequence is unique, making startup projection and replay idempotent.
- Canonical lifecycle, device endpoints, endpoint presence, and delivery attempts are separate SQLite records.
- Projectless and Project-scoped Sessions use the same behavior.
- In-app notification text resolves current Project and Session names after authentication.
- External payloads remain generic and exclude prompts, transcript text, paths, tool arguments, answers, and secret-bearing errors.
- Permission and clarify notifications remain urgent; visible exact-Session presence may suppress redundant completion/failure/unknown system delivery for that endpoint.

## Optional Web Push

Web Push is disabled unless all VAPID values are configured. Subscription permission requires a user gesture. Endpoint URLs and keys are credentials: HUE encrypts them with AES-256-GCM using a persistent local key, exposes only device metadata, and fails startup closed if the configured key is missing or malformed.

```text
HUE_VAPID_PUBLIC_KEY
HUE_VAPID_PRIVATE_KEY
HUE_VAPID_SUBJECT=mailto:operator@example.com
```

Registration starts at the current event baseline, so enabling a device never replays old notifications. Retries are bounded and durable. A notification click attempts to acknowledge before same-origin navigation, but navigation is not blocked by an acknowledgement network failure.

## Truth and privacy

Gateway acceptance is not display, read, or action. HUE records only the strongest acknowledgement available. Read, dismissed, acted, and resolved-interaction notifications are excluded from future delivery. Foreground sound is local opt-in; browser and operating-system policy controls background sound and wearable mirroring.
