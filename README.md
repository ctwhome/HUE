<p align="center">
  <img src="app/static/favicon.png" alt="HUE logo" width="180">
  <img src="app/static/hermes-logo.png" alt="Hermes logo" width="180">
</p>

# HUE - Hermes Unified Environment

> Keep Hermes Projects, reusable Workflows, and durable Sessions in one focused local workspace.

HUE is a native Bun/SvelteKit workspace for exactly three user-facing objects. It adds reliable complete-message delivery, Project workbench tools, and focused Hermes administration without taking ownership of agent execution or transcript persistence.

## Product boundary

- **Projects** are Hermes-authoritative trusted local folder boundaries.
- **Workflows** are reusable Project-scoped prompts and launch settings owned by HUE.
- **Sessions** are Project or projectless Hermes conversations with durable delivery state.
- **Supporting surfaces** include bounded files, terminals, Git, browser/Excalidraw, notifications, schedules, and Hermes administration.

HUE never writes Hermes databases directly or silently approves ACP permission requests. The one narrow direct-filesystem exception for custom `SKILL.md` files is documented and hardened in [ADR-0012](docs/decisions/0012-custom-skill-filesystem-exception.md).

## Install and develop

Prerequisites: Bun, Git, an installed Hermes Agent with ACP support, and an authenticated GitHub CLI for GitHub panels.

```bash
bun install --frozen-lockfile
make dev
```

Open [http://127.0.0.1:4010](http://127.0.0.1:4010). Development uses the canonical `~/.hue/hue.db`.

## Build and serve

Production runs continuously under its KeepAlive LaunchAgent. `make restart` builds documentation and the app, then restarts production onto an immutable snapshot of that build. `make dev` hands the canonical database from production to the foreground development server, then restores production when development stops.

```bash
make restart
```

`make build` compiles without restarting production. `make serve` is the lower-level foreground production command used by the LaunchAgent.

Project terminals work on loopback and through an authenticated HTTPS tailnet or trusted reverse-proxy origin.

Set `ORIGIN` to the exact public HTTPS origin when serving behind a trusted LAN or tailnet reverse proxy. Set `HUE_ACCESS_SECRET` for non-loopback browser access. Never expose HUE directly to the public internet.

## Verification

```bash
bun test
bun run --cwd app check
bun run --cwd app build
bun run --cwd app test:e2e
bun run --cwd docs verify
```

The real-Hermes seam is optional and isolated:

```bash
HUE_REAL_HERMES=1 bun test app/src/lib/server/hermes-acp.test.ts
```

See the [active status](docs/00-status-and-review.md), [focused architecture](docs/05-system-architecture.md), [decision register](docs/14-decision-register.md), and [contribution guide](CONTRIBUTING.md).

## License

No open-source license has been selected. This repository is source-visible but does not grant reuse rights by implication.
