# HUE Workspace

The focused native web client for reliable Hermes Projects, Workflows, and Sessions.

## Requirements

- Bun 1.3.14
- Hermes Agent with ACP support (`hermes acp --check`)
- A configured Hermes profile; HUE uses `default` unless `HUE_HERMES_PROFILE` is set

## Development

From the repository root:

```bash
bun install --frozen-lockfile
make dev
```

## Verification

```bash
bun test
bun run check
bun run build
bun run test:e2e
HUE_REAL_HERMES=1 bun test src/lib/server/hermes-acp.test.ts
```

The real ACP test creates and resumes a Hermes Session but uses the local `/version` command, so it does not invoke a model.

## Production

```bash
make build
make serve HOST=127.0.0.1 PORT=4174 ORIGIN=https://m3-max.tail33436f.ts.net:4173
```

`make build` rebuilds the docs and production app without starting it. `make serve` runs an immutable build snapshot on `127.0.0.1:4174`, so later builds cannot remove assets from the live process. The configured Tailscale Serve route exposes it at `https://m3-max.tail33436f.ts.net:4173`. Set `HUE_ACCESS_SECRET`, `HUE_DATABASE_PATH`, and optionally `HUE_HERMES_PROFILE` in `app/.env`.

Development and production can run together. `make dev` uses `http://127.0.0.1:4010` and the isolated `~/.hue/hue-dev.db`; its Tailscale URL is `https://m3-max.tail33436f.ts.net:4010`. Restarting either target leaves the other running. `make stop` stops both.

### Authenticated LAN or tailnet access

Loopback access remains zero-configuration. For remote browser access, keep HUE bound to loopback behind Tailscale Serve or another trusted HTTPS reverse proxy and configure a high-entropy access secret:

```bash
bun run build
HOST=127.0.0.1 \
PORT=4173 \
ORIGIN=https://hue.example.ts.net \
HUE_ACCESS_SECRET='<output of: openssl rand -base64 32>' \
HUE_DATABASE_PATH="$HOME/.hue/hue.db" \
bun run start
```

Open the HTTPS URL and enter the secret once. HUE stores only an HttpOnly, Secure, SameSite session cookie in the browser; the configured secret is not sent to client JavaScript. `POST /logout` clears that browser session. Changing `HUE_ACCESS_SECRET` invalidates all existing sessions.

Do not expose HUE directly to the public internet or use remote access over plain HTTP. The secret grants access to local Projects, Sessions, files, terminals, and Hermes controls: use a unique generated value, keep it out of shell history and logs, restrict the proxy to a trusted LAN or tailnet, and set `ORIGIN` to the exact public HTTPS origin. This P0 mechanism does not provide accounts, per-device revocation, or brute-force rate limiting.

HUE stores Project, Workflow, Project/Session associations, message-delivery, and event-cursor state in its own SQLite database. Startup recovery redispatches queued turns after resuming their associated Hermes Session and marks interrupted running turns `unknown` without retrying them. Hermes remains authoritative for agent execution and Session transcripts; HUE never writes Hermes' database directly.
