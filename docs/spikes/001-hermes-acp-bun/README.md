# 001: Hermes ACP from Bun

## Question

Given the installed Hermes runtime, when a Bun service launches `hermes acp`, can it create/list/resume sessions and receive a complete streamed response without a browser PTY?

## Pass criteria

- `initialize` succeeds through the official ACP TypeScript SDK.
- a session is created with a project working directory;
- a complete prompt is submitted as one protocol envelope;
- streamed `session/update` chunks can be assembled into one response;
- the prompt request ends with an ACP stop reason;
- the created session can be listed and resumed.

## Verdict: VALIDATED

Run on 2026-07-23 with Bun 1.3.14, Hermes ACP, and the official TypeScript SDK 1.3.0:

```json
{
  "ok": true,
  "protocol": "ACP v1",
  "sessionId": "fa390920-dafb-4404-8a50-29f5b45c83f6",
  "completeResponse": "HUE ACP STREAM OK.",
  "streamedUpdates": 9,
  "restartPersistence": true,
  "sessionsForCwd": 1
}
```

### What worked

- Bun supervised `hermes acp` over newline-delimited JSON stdio.
- The official SDK initialized ACP v1 and created a session bound to an absolute project cwd.
- One complete user prompt was submitted as an ACP request and nine structured updates were received before `stopReason: end_turn`.
- A fresh Hermes ACP process listed the persisted session and replayed its completed transcript on resume.

### What this replaces

HUE does not need the Hermes Python dashboard server or an xterm/PTY transport. Hermes remains the agent runtime; Bun owns HUE metadata, browser transport, durable request IDs, and reconnect delivery.

### Production requirements

- Pin and negotiate ACP v1 rather than using experimental v2.
- Supervise one ACP process per Hermes profile/runtime boundary.
- Persist HUE message IDs and delivery state before submitting prompts.
- Treat ACP end-of-turn as execution acknowledgement, not browser-delivery acknowledgement.
- Deny unattended permission requests and expose explicit approval UI before enabling side effects.
