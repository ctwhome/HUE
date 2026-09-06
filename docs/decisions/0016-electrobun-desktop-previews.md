# Architecture Decision Record: Electrobun desktop previews

- **Status:** Accepted
- **Date:** 2026-09-06
- **Amends:** ADR-0004's cross-origin browser-preview constraint

## Context

The web Project browser uses a sandboxed iframe. Same-origin pages support HUE's bounded element picker, but cross-origin pages remain opaque and pages may refuse framing. Local development needs a real browser context with developer tools and element selection without weakening the web/PWA boundary or making a native shell authoritative for HUE data.

## Decision

Add a thin Electrobun desktop shell that loads one configured HUE server origin. The Bun/SvelteKit server remains the sole owner of application routes, authentication, local data, Projects, Workflows, Sessions, and harness processes.

The shell accepts loopback HTTP or remote HTTPS origins only. Its main view has no application RPC handlers and native navigation is restricted to the configured HUE origin. Remote HUE access uses the existing `HUE_ACCESS_SECRET` login and secure session cookie without a desktop bypass.

When Electrobun's injected runtime is present, the Project browser replaces its iframe with a sandboxed `<electrobun-webview>`. The native view may open its own developer tools and run an explicit element picker. Picker results cross the event-only host bridge, are treated as untrusted input, validated, allowlisted, bounded, and sanitized before entering a draft. Ordinary browsers, installed PWAs, and mobile clients retain the existing iframe behavior.

Preview URLs resolve on the computer running the desktop shell. Access to a development server on another computer is user-managed through SSH port forwarding or a trusted Tailnet route. HUE does not add a preview reverse proxy, remote inspector control, frame streaming, public service exposure, or automatic network reconfiguration.

The first version uses each platform's system webview. CEF, CDP automation, integrated console collection, signing, notarization, automatic updates, and a settings UI for the server origin remain outside this decision.

## Consequences

- Local desktop development gains native developer tools, cross-origin element selection, and previews that are not subject to iframe framing policy.
- Web and mobile behavior remains portable and unchanged.
- The desktop shell must be started separately from HUE so it cannot create a second database or scheduler owner.
- A remote desktop shell can operate HUE over authenticated HTTPS, but it can preview only addresses reachable from that desktop computer.
- Native behavior requires platform testing in addition to browser tests.
