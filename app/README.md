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
bun run build
HOST=127.0.0.1 \
PORT=4173 \
ORIGIN=http://127.0.0.1:4173 \
HUE_DATABASE_PATH="$HOME/.hue/hue.db" \
HUE_HERMES_PROFILE=default \
bun run start
```

`bun run start` derives a local `ORIGIN` from `HOST` and `PORT` when omitted. Set the public `ORIGIN` explicitly behind a reverse proxy so SvelteKit can retain multipart CSRF protection for the Web Share Target.

HUE stores Project, Workflow, Project/Session associations, message-delivery, and event-cursor state in its own SQLite database. Startup recovery redispatches queued turns after resuming their associated Hermes Session and marks interrupted running turns `unknown` without retrying them. Hermes remains authoritative for agent execution and Session transcripts; HUE never writes Hermes' database directly.
