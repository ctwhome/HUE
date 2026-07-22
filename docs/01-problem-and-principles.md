# Problem, frustrations and product principles

> **Product status:** `TBI`
> **Open choices:** none for the problem statement; implementation choices are tracked separately.

## The core problem

AI tools are becoming more capable while their operating model becomes more fragmented. The user must often decide **how the system should work** before the system can do the work:

- Which app?
- Which model and provider?
- Which reasoning effort?
- Which agent, profile or prompt?
- Which repository and folder?
- Which tools and permissions?
- Should it run in a worktree, shell, browser or desktop?
- How will it report progress?
- Where will the result and memory live?

Those are control-plane responsibilities. HUE exists to assume them transparently while preserving user authority.

## Frustration map

### F01 — Manual resource administration

**Today:** The user repeatedly picks model, provider, effort, folder and tools.
**Cost:** Cognitive overhead, inconsistent quality, wasted premium tokens and misrouted work.
**HUE response — TBI:** Accept outcome-level intent and select resources using inspectable policy. User overrides always take precedence.

### F02 — Projects that are only chat folders—and life areas forced into projects

**Today:** A “project” groups conversations but does not reliably own files, instructions, memory, permissions or defaults. Ongoing domains such as Health or Parenting are either left unstructured or forced into fake repository/milestone metaphors.
**Cost:** Wrong-directory edits, repeated explanations, context leakage and a workspace model that fits code better than life.
**HUE response — TBI:** Make Projects and Areas first-class Space boundaries, with Resources shared explicitly. Projects can finish; Areas preserve ongoing current state, routines, observations and questions.

### F03 — Separate chat and execution products

**Today:** Thinking happens in one app; implementation happens in a coding CLI; documents and browser work happen elsewhere.
**Cost:** Lost decisions, copy/paste handoffs and fragmented history.
**HUE response — TBI:** Conversations, tasks, code, documents, browser/computer activity and artifacts share one project timeline without becoming one undifferentiated transcript.

### F04 — Invisible or noisy orchestration

**Today:** Either a spinner hides all progress or raw agent logs flood the user.
**Cost:** Low trust, inability to steer, and attention overload.
**HUE response — TBI:** Show a concise task graph and meaningful state by default; expose full worker and event detail on demand.

### F05 — Permanent specialist sprawl

**Today:** Users create many bots/profiles and must remember which one owns a request.
**Cost:** Split personality, split memory, parallel notifications and manual routing.
**HUE response — TBI:** Keep one persistent HUE and instantiate temporary specialists within the current task and project.

### F06 — Memory contamination

**Today:** Durable preferences, project facts, transient plans and raw logs are mixed together.
**Cost:** Stale assumptions, private cross-project leakage and repeated corrections.
**HUE response — TBI:** Separate global, project, conversation and run state; make durable memories inspectable and correctable.

### F07 — Fragile background autonomy

**Today:** Work disappears when a chat closes, processes restart, or a child agent fails.
**Cost:** Duplicate side effects, unknown completion and inability to resume safely.
**HUE response — TBI:** Persist tasks, attempts, events, checkpoints and ownership; distinguish unknown from failed or completed.

### F08 — Agent claims without evidence

**Today:** A worker says tests passed or a file was written, but the parent accepts the report.
**Cost:** False completion and broken trust.
**HUE response — TBI:** The orchestrator verifies externally visible side effects and attaches evidence to outcomes.

### F09 — Unsafe GUI autonomy

**Today:** Computer-use agents may act through visually ambiguous interfaces with broad permissions.
**Cost:** Wrong clicks, accidental messages, purchases or destructive changes.
**HUE response — TBI:** Use API-first escalation, scoped application access, previews, action risk classes, approvals and post-action verification.

### F10 — Provider lock-in

**Today:** Product logic assumes one vendor’s models, tools or hosted runtime.
**Cost:** Cost, privacy and capability choices become product migrations.
**HUE response — TBI:** Route by capability policy through provider and runtime adapters; preserve explicit user choice.

### F11 — No calm place to review work

**Today:** Conversations, diffs, generated files, citations, approvals and agent status live in separate surfaces.
**Cost:** The user becomes the integration layer.
**HUE response — TBI:** A project workspace provides conversations, runs, approvals and artifacts as linked but distinct views.

### F12 — The myth of one all-knowing agent

**Today:** A personal assistant is expected to remain deeply informed about every repository, relationship, health concern and unfinished task in one growing context or memory store.
**Cost:** Stale context, privacy leakage, confused sessions and dependence on one model/framework’s internal session format.
**HUE response — TBI:** The workspace owns independent Space-bound Sessions and context packs. The orchestrator behaves like a scheduler/router; replaceable specialists receive only the context needed for their work.

### F13 — AI work duplicates authoritative systems

**Today:** Agent workspaces copy issues, events, email and documents into another database without preserving ownership or freshness.
**Cost:** Conflicts, stale status and uncertainty about which system is true.
**HUE response — TBI:** GitHub, Calendar, email and user files remain authoritative. HUE stores bindings, projections, provenance and its own session/run state.

## Product principles

1. **Outcome first.** Ask what result is needed before asking how to execute.
2. **One calm interface.** Specialists work underneath; HUE owns attention and synthesis.
3. **Space boundaries are real.** Paths, context, memory and permissions resolve from the selected Project or Area.
4. **Autonomy is inspectable.** The user can see why work was routed and change it.
5. **Durability before spectacle.** A resumable task beats an impressive but ephemeral demo.
6. **Least capability.** Give workers only the context, tools, paths and time they need.
7. **Deterministic before agentic.** Use a program when a program can solve the problem reliably.
8. **Evidence before completion.** Verification is part of execution, not a celebratory afterthought.
9. **Memory is editorial.** Facts and decisions become durable intentionally, not because they appeared in a transcript.
10. **Human authority is explicit.** Risky actions stop at a visible approval boundary.
11. **Local is the default trust anchor.** Cloud capability is opt-in and policy-governed.
12. **Escape hatches matter.** Export data, inspect files, choose providers, pause workers and recover manually.
13. **Progressive disclosure.** Simple work feels simple; advanced controls appear when needed.
14. **No agent bureaucracy.** A single capable worker is preferred unless specialization or parallelism materially helps.
15. **The workspace owns continuity.** Models, Hermes, OpenCode and other runtimes are replaceable; Spaces, Sessions, context packs and decisions are not runtime-owned.
16. **Native sources retain authority.** HUE improves control and context without inventing a second truth for GitHub, Calendar, email or files.

## Anti-goals

- Maximizing the number of agents.
- Showing chain-of-thought or private model reasoning.
- Treating Areas as fake projects, all work as tasks, or all sessions as one conversation.
- Building a generic workflow-canvas product before the natural-language workspace works.
- Moving every user file into a proprietary database.
- Requiring the second brain or context packs to be unreadable without HUE.
- Replacing version control, editors or operating systems.
- Autonomous publishing, spending, trading, messaging or destructive administration without explicit policy and approval.
