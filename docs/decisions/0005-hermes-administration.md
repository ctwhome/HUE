# Architecture Decision Record: Hermes administration through authenticated serve

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** Curi / HUE
- **Extends:** ADR-0002

## Context

HUE needs local administration for the Hermes installation it already uses. Hermes ACP remains the validated execution and transcript seam, but it does not expose configuration APIs. Directly editing Hermes internals would duplicate validation and cross the ownership boundary.

## Decision

HUE may expose Hermes administration as supporting interface panels, not new HUE product objects. It supervises one loopback-only `hermes serve --isolated` process for the selected profile, uses a generated per-process session token, and sends that token only from server-side code.

Hermes ACP remains the only Session execution adapter. The administration process does not submit prompts, alter HUE delivery state, write Hermes' internal database directly, or silently approve permission requests. HUE uses Hermes' authenticated APIs for configuration reads and mutations, validates all browser input at its own route boundary, redacts credentials, and requires explicit confirmation for destructive actions.

## Consequences

- Hermes remains responsible for configuration validation and persistence.
- The administration API is unavailable when the installed Hermes version does not provide `serve`.
- HUE must terminate only the child process it started and must never expose its session token or bind it beyond loopback.
- Administration features are added incrementally; provider credentials and destructive actions require dedicated security review and tests.
