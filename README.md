# HUE

> **The open-source workspace for human-directed AI work.**
>
> One calm interface for projects, permanent areas of life, independent sessions, durable tasks, user-owned knowledge, visible specialist agents, code, files, browser and computer use—while the user remains in control.

![Product status](https://img.shields.io/badge/product-TBI-d97706) ![Specification](https://img.shields.io/badge/specification-reviewable-2563eb) ![Decisions](https://img.shields.io/badge/open%20decisions-TBD-7c3aed)

HUE is a planned **personal agent workspace** combining the best ideas behind Claude Cowork, Claude Code, ChatGPT Projects, GitHub Projects, second-brain systems, Hermes, OpenClaw, OpenCode, Codex, Magentic-style orchestration, and local computer-use systems—without binding the user to one model, provider, agent framework or hidden memory store.

**HUE is not implemented yet.** This repository is the product contract and documentation prototype from which implementation will proceed. Every product capability is explicitly marked **TBI** (to be implemented); unresolved choices are marked **TBD** (to be decided).

## The product in one sentence

HUE lets a user open a **Project** or ongoing **Area** with its own goals, context pack, files, sources, permissions and memory; start independent discussion, execution, research, monitoring or review sessions; watch a bounded orchestrator route work to temporary specialists; intervene through steering and approvals; and receive verified results and artifacts in the same user-owned workspace.

## Review the vision

1. Start with **[VISION.md](VISION.md)**.
2. Open the **[Astro/Starlight documentation website](https://ctwhome.github.io/HUE/)** and its embedded [interactive specification](https://ctwhome.github.io/HUE/prototype/), or run the site locally with `bun run dev`.
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
   - [Accepted frontend ADR: SvelteKit + shadcn-svelte](decisions/0001-sveltekit-shadcn-svelte.md)
   - [Glossary](docs/15-glossary.md)
   - [Notifications, attention and delivery](docs/16-notifications-attention-delivery.md)

## Status vocabulary

| Label | Meaning |
|---|---|
| **TBI** | Target behavior is specified but not implemented. |
| **TBD** | A decision is still open; implementation must not silently choose. |
| **SPEC** | Documentation exists and is reviewable; this does not imply product implementation. |
| **POC** | A disposable proof was built to answer a named question. |
| **IMPLEMENTED** | Code exists and acceptance evidence is linked. |
| **VERIFIED** | The implemented behavior passed its documented verification gates. |

The canonical status rules live in [docs/00-status-and-review.md](docs/00-status-and-review.md).

## Repository layout

```text
HUE/
├── VISION.md                 # stable product north star
├── docs/                     # canonical target product specification
├── prototype/                # canonical clickable UI wireframe source
├── decisions/                # architecture decision records (ADRs)
├── roadmap/                  # machine-readable milestones and issues
├── site/content/             # docs-site-only landing content
├── src/                      # Astro/Starlight configuration, assets and styles
├── public/                   # static site assets
├── scripts/                  # validation, site projection, roadmap rendering, GitHub sync
├── astro.config.mjs          # online documentation navigation and deployment base
└── .github/workflows/        # verified GitHub Pages deployment
```

The canonical product Markdown remains in `VISION.md`, `docs/`, `roadmap/`, and `decisions/`. `scripts/prepare_site.py` projects those files into Starlight at build time, rewrites their internal links, and copies the prototype and roadmap data. Generated projections are ignored by Git so the website cannot become a second hand-edited source of truth.

## Documentation website

```bash
bun install
bun run dev       # local Starlight development server
bun run verify    # product contract + Astro checks + build + output crawl
```

The production site is deployed to [ctwhome.github.io/HUE](https://ctwhome.github.io/HUE/) by GitHub Actions after every verified push to `main`.

## Non-negotiable product contract

- One coherent HUE workspace and front door—not one omniscient model and not a fleet the user must manually operate.
- **Projects and Areas are real context and permission boundaries**, not chat folders. Projects can finish; Areas represent ongoing responsibilities; Resources can serve several spaces.
- Sessions and tasks are different objects: sessions are isolated discussion/execution/research/monitoring/review contexts; tasks are durable desired outcomes.
- Specialist agents are **temporary workers selected by the orchestrator**, not personalities the user has to choose.
- Model, provider, effort, tools and isolation are normally selected by policy; explicit user choices always win.
- Orchestration is visible at the right level: readable task state by default, full event/transcript details on demand.
- Native APIs and deterministic tools are preferred over browser automation; browser automation is preferred over computer use.
- External, irreversible, sensitive or high-impact actions pass through explicit policy and approval gates.
- Memory is layered and inspectable. Raw run logs do not silently become durable memory.
- Human-readable context packs and the second-brain knowledge substrate remain usable without HUE or any AI backend.
- GitHub, Calendar, email and user files remain authoritative for their native objects; HUE provides bindings and a control surface rather than making stale duplicates.
- Results are backed by artifacts, diffs, tests, citations or other verification—not worker self-report.
- Local-first, model-independent and framework-independent are product requirements; Hermes, OpenCode and cloud services are replaceable backends.

## Roadmap and issues

The canonical source is:

- [`roadmap/milestones.json`](roadmap/milestones.json)
- [`roadmap/issues.json`](roadmap/issues.json)
- [`roadmap/dependency-graph.md`](roadmap/dependency-graph.md)

The GitHub copy is generated from those files so the plan and implementation tracker cannot drift silently.

## License

**TBD-019:** The open-source license has not yet been selected. Until a license is explicitly adopted, this repository is source-visible but no reuse rights are granted by implication. The decision must balance ecosystem adoption, commercial embedding, contributor expectations and protection against closed hosted extraction.
