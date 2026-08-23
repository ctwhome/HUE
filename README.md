# HUE

> **A focused, fast workspace for Hermes Projects, Workflows, and Sessions.**
>
> One calm interface around Hermes—without the broad Python dashboard or lossy browser terminal input.

![Project activity](https://img.shields.io/badge/development-resumed-16a34a) ![Product status](https://img.shields.io/badge/product-implementation%20started-2563eb) ![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6) ![Hermes](https://img.shields.io/badge/protocol-ACP%20v1-7c3aed)

## Project activity status — resumed

> **Focused HUE implementation resumed on 21 August 2026.**

Development was paused on 25 July 2026 while the maintainer evaluated whether Hermes WebUI plus direct OpenCode/Codex delegation could satisfy the workflow without another application. That experiment exposed the durable unmet need now addressed here: reliable Hermes message delivery and Project-scoped Session organization in a purpose-built interface.

HUE is now a focused **Hermes workspace client**. HUE owns local Project and Workflow metadata plus reliable message-delivery state. Hermes ACP owns model/tool execution and Hermes Session persistence.

Implementation lives in `app`. The older broad personal-OS specification remains in the repository as historical design context, but [ADR-0002](docs/decisions/0002-bun-hermes-acp-workspace.md) is the active scope decision.

## The product in one sentence

HUE lets a user open a local **Project**, launch a reusable **Workflow**, and create or resume reliable Hermes **Sessions** whose complete messages survive retries and reconnects.

## Review the vision

1. Start with **[VISION.md](VISION.md)**.
2. Open the **[Astro/Starlight documentation website](https://ctwhome.github.io/HUE/)** and its embedded [interactive specification](https://ctwhome.github.io/HUE/prototype/), or run the docs and workspace locally with `make dev`.
3. Review the specification in order:
   - [Status, labels and review protocol](docs/00-status-and-review.md)
   - [Problem, frustrations and product principles](docs/01-problem-and-principles.md)
   - [Product experience and user journeys](docs/02-product-experience.md)
   - [Information architecture](docs/03-information-architecture.md)
   - [Spaces, sessions, knowledge and source ownership](docs/03-spaces-sessions-knowledge.md)
   - [UI specification and screen wireframes](docs/04-ui-specification.md)
   - [Target system architecture](docs/05-system-architecture.md)
   - [Projects, context and layered memory](docs/06-projects-context-memory.md)
   - [Orchestration, workers and adaptive routing](docs/07-orchestration-and-routing.md)
   - [Tools, permissions and computer use](docs/08-tools-permissions-computer-use.md)
   - [Data model, events and service contracts](docs/09-data-model-and-apis.md)
   - [Security, privacy and trust](docs/10-security-privacy-trust.md)
   - [Quality, evaluation and observability](docs/11-quality-evaluation-observability.md)
   - [Deployment and operations](docs/12-deployment-operations.md)
   - [Milestones and implementation sequence](docs/13-roadmap.md)
   - [Decision register](docs/14-decision-register.md)
   - [Accepted frontend ADR: SvelteKit + shadcn-svelte](docs/decisions/0001-sveltekit-shadcn-svelte.md)
   - [Accepted focused workspace ADR: Bun + Hermes ACP](docs/decisions/0002-bun-hermes-acp-workspace.md)
   - [Accepted Android proof ADR: bounded Capacitor shell](docs/decisions/0008-capacitor-android-native-shell.md)
   - [Glossary](docs/15-glossary.md)
   - [Notifications, attention and delivery](docs/16-notifications-attention-delivery.md)

## Status vocabulary

| Label           | Meaning                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| **TBI**         | Target behavior is specified but not implemented.                                   |
| **TBD**         | A decision is still open; implementation must not silently choose.                  |
| **SPEC**        | Documentation exists and is reviewable; this does not imply product implementation. |
| **POC**         | A disposable proof was built to answer a named question.                            |
| **IMPLEMENTED** | Code exists and acceptance evidence is linked.                                      |
| **VERIFIED**    | The implemented behavior passed its documented verification gates.                  |

The canonical status rules live in [docs/00-status-and-review.md](docs/00-status-and-review.md).

## Repository layout

```text
HUE/
├── Makefile                  # starts the complete development workspace
├── app/                      # SvelteKit/Bun Hermes workspace
├── docs/                     # Astro app, specification, ADRs, roadmap, and spikes
├── prototype/                # canonical clickable UI wireframe source
├── VISION.md                 # stable product north star
└── .github/workflows/        # verified GitHub Pages deployment
```

The canonical product Markdown remains in `VISION.md` and `docs/`. `docs/scripts/prepare_site.py` projects those files into Starlight at build time, rewrites their internal links, and copies the prototype and roadmap data. Generated projections are ignored by Git so the website cannot become a second hand-edited source of truth.

## Documentation website

```bash
bun install
make dev          # app at :4010/ and documentation at :4010/docs/
bun run --cwd docs verify
```

The production site is deployed to [ctwhome.github.io/HUE](https://ctwhome.github.io/HUE/) by GitHub Actions after every verified push to `main`.

## Android native-shell proof

Capacitor shell under `app/android` loads canonical HUE server; it does not embed another workspace or Hermes authority. JDK 21 and Android SDK 36 are required.

```bash
bun install --frozen-lockfile
bun run --cwd app android:sync # injects HUE_SERVER_URL into Capacitor before sync
scripts/android-gradle.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebug

# Debug-only emulator or adb-reverse origin; cleartext accepts loopback only.
scripts/android-gradle.sh -PHUE_SERVER_URL=http://10.0.2.2:4173 :app:assembleDebug

# Release boundary proof: first command must fail, second must pass.
scripts/android-gradle.sh -PHUE_SERVER_URL=http://127.0.0.1:4173 :app:validateHueReleaseConfig
scripts/android-gradle.sh -PHUE_SERVER_URL=https://hue.example :app:validateHueReleaseConfig

# Debug-only loopback API 36 proof.
scripts/android-proof.sh

# Exact HTTPS App Link API 36 proof; runtime value is never tracked.
HUE_ANDROID_HTTPS_ORIGIN=https://your-hue-origin.example scripts/android-proof.sh
```

`scripts/android-env.sh` finds SDK at `$ANDROID_SDK_ROOT`, `$ANDROID_HOME`, or `/Volumes/DATA-ext/Android SDK/sdk` without `local.properties`. Production builds inject HTTPS origin through `HUE_SERVER_URL`; do not put credentials or auth tokens in origin. Native credentials, if later required, must use Android Keystore. See [ADR-0008](docs/decisions/0008-capacitor-android-native-shell.md).

## Focused product contract

- Exactly three user-facing product objects: **Projects, Workflows, Sessions**.
- Projects are trusted working-directory boundaries; Workflows are reusable Project-scoped Hermes prompts; Sessions are Hermes ACP conversations.
- The browser sends complete message envelopes, never PTY keystrokes.
- HUE persists an envelope before acknowledging it, deduplicates client retries, and exposes monotonic reconnect cursors.
- Unknown delivery remains visibly unknown and is never auto-retried.
- HUE never writes Hermes' `state.db` directly and never silently grants ACP permission requests.
- Data remains local by default in HUE SQLite plus the user's existing Hermes profile.

## Roadmap and issues

The canonical source is:

- [`docs/roadmap/milestones.json`](docs/roadmap/milestones.json)
- [`docs/roadmap/issues.json`](docs/roadmap/issues.json)
- [`docs/roadmap/dependency-graph.md`](docs/roadmap/dependency-graph.md)

The GitHub copy is generated from those files so the plan and implementation tracker cannot drift silently.

## License

**TBD-019:** The open-source license has not yet been selected. Until a license is explicitly adopted, this repository is source-visible but no reuse rights are granted by implication. The decision must balance ecosystem adoption, commercial embedding, contributor expectations and protection against closed hosted extraction.
