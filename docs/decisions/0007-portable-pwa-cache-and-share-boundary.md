# Architecture Decision Record: portable PWA cache and private share boundary

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owners:** Curi / HUE
- **Related:** ADR-0002 message-delivery and attachment boundaries; ADR-0006 Hermes Project authority

## Context

HUE needs portable install metadata, static launcher shortcuts, quick capture, and Web Share Target intake without turning a local Hermes workspace into a stale offline replica or a second Project authority. Session transcripts, API responses, delivery state, and shared content are private and mutable. Adapter-node deployments can also serve multiple build versions over time, so caching an HTML app shell or API response creates a stale-deployment risk.

## Decision

HUE ships a standards-based manifest with stable root id, scope, and start URL. Static shortcuts use same-origin intent URLs for projectless Session creation, Quick Idea, Projects, and Recent Sessions. Project and Session deep links remain ordinary same-origin URLs. Static manifest shortcuts are not dynamic per-entity pins; UI copy must not claim otherwise.

Service worker caching is limited to SvelteKit's versioned build asset list. Navigation and API requests pass through to the network and are never written to Cache Storage. Activation deletes older HUE build caches and claims clients. HUE does not cache HTML, manifests as an app shell, Session data, transcripts, messages, share intake, or any `/api/` response. No offline page is shown because HUE cannot honestly provide workspace or Hermes behavior offline.

Launch resolution order is explicit Project/Session/deep URL, shortcut or share intent, notification intent seam, remembered destination, then safe default. Consuming an intent replaces its URL state before acting, preventing reload loops. Quick capture and share overlays do not replace durable remembered navigation. Creating a projectless Session from its launcher shortcut is itself an explicit user action.

Quick capture stores only its unsent text and selected authoritative Hermes Project id in browser local storage. It never submits a message. Explicit **Create Session** creates one Session, transfers the draft into that Session's existing composer persistence, and routes to it. Shared file bytes remain in memory only and must be reattached after closing or reloading capture.

Web Share Target accepts bounded multipart title, text, URL, and files. HUE applies existing attachment count, aggregate/per-file size, name, extension, MIME, decoded-size, and stable-signature checks. Accepted content enters a bounded in-memory store under an unguessable one-time token for five minutes. Redirect URLs carry only that token, never shared content. Consumption deletes the entry and returns `private, no-store`; expiry cleanup also deletes it. HUE does not put shared content in cookies, push data, logs, query strings, or permanent server storage. Restarting HUE discards pending share intake.

Adapter-node must know its public origin so SvelteKit can retain multipart CSRF protection. Local `bun run start` derives `ORIGIN` from `HOST` and `PORT`; reverse-proxy deployments must provide public `ORIGIN` or trusted forwarded-host configuration.

Install UI captures `beforeinstallprompt` only when supported, exposes install from a user-opened dialog, and remembers dismissal. Project/Session pin guidance offers current-link copy, Web Share when available, and honest browser-menu fallback. HUE never claims programmatic or launcher pin success.

## Consequences

- Deployments cannot serve stale private workspace state from HUE Cache Storage.
- Installed chrome and hashed client assets can start efficiently, but useful offline workspace behavior is intentionally unavailable.
- Share intake is private and short-lived but does not survive server restart or multi-process routing without sticky in-memory ownership.
- Physical Android launcher shortcut ordering and long-press behavior still require device evidence; automated tests prove manifest payload and browser flows only.

## Revisit triggers

- A truthful offline read model exists with explicit private-data encryption and invalidation rules.
- Adapter-node runs multiple processes and share intake needs a bounded encrypted handoff store.
- Browsers standardize dynamic per-entity app shortcuts or programmatic pin confirmation.
