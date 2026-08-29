# Architecture Decision Record: SvelteKit frontend

- **Status:** Accepted
- **Date:** 2026-07-22
- **Updated:** 2026-08-28
- **Owners:** Curi / HUE

## Context

HUE needs a dense, responsive workspace with reliable keyboard, focus, screen-reader, pointer, and touch behavior. The original static HTML prototype established early layout direction, but the production SvelteKit application now contains the active interaction and responsive contracts.

## Decision

Use SvelteKit 5 and Svelte 5 for the product frontend. HUE owns semantic tokens, typography, density, responsive composition, and component APIs. Use installed accessible primitives and Lucide icons where they fit; product screens should prefer repository components over duplicating widget behavior.

The static prototype is retired and deleted. Production components, browser tests, and screenshots are now the only UI evidence; maintaining a parallel implementation would create drift without providing a current benefit.

## Consequences

- The production application is the single UI source of truth.
- React-only functionality requires a bounded adapter when retained functionality, such as Excalidraw, justifies it.
- UI changes require Svelte checks and representative responsive browser verification.

## Revisit triggers

- A required platform capability cannot be delivered reliably through the selected stack.
- The component foundation creates a demonstrated accessibility or maintenance failure.
