# Canonical issue plan

> Generated from `roadmap/issues.json` by `scripts/render_roadmap.py`. Do not edit by hand.

**9 milestones · 54 issues**

## M0 — Product contract & architecture decisions

Freeze the reviewable personal-workspace contract and resolve alpha-blocking architecture choices.

**Exit:** All alpha-blocking ADRs are accepted; v0 Space, Session, context-pack, event and runtime contracts are frozen.

### HUE-001 — Review and freeze the HUE product contract

`TBI` · `agent:ready` · dependencies: none

Freeze HUE as a personal workspace with Projects, Areas, Resources, independent Sessions, portable knowledge and replaceable execution backends before implementation choices harden accidentally.

### HUE-002 — ADR: choose HUE product boundary, app shell and control-plane stack

`TBD` · `agent:ready` · dependencies: HUE-001

Decide HUE’s owned personal-workspace boundary and the replaceable relationship to Hermes/OpenCode plus the application shell and control plane.

### HUE-003 — ADR: choose canonical storage, event journal and application transport

`TBD` · `agent:ready` · dependencies: HUE-002

Select durable local state, semantic events, canonical-versus-derived data and client transport foundations for Spaces, Sessions and source projections.

### HUE-004 — ADR: choose orchestration foundation and v0 worker/runtime contracts

`TBD` · `agent:ready` · dependencies: HUE-003

Choose the smallest durable scheduler/router core and freeze provider-neutral worker plus runtime lifecycle contracts, including the first OpenCode adapter mode.

### HUE-005 — Create HUE threat model and alpha security baseline

`TBI` · `agent:ready` · dependencies: HUE-001

Turn the trust assumptions into testable boundaries before privileged execution is implemented.

### HUE-006 — ADR: choose open-source license and project governance

`TBD` · `agent:ready` · dependencies: HUE-001

Adopt an explicit license and contributor/governance model suitable for an open agent workspace.

### HUE-050 — ADR: choose portable context-pack and authoritative-source synchronization contracts

`TBD` · `agent:ready` · dependencies: HUE-003

Decide exact portable file roles/metadata and source ownership/synchronization semantics before implementing the second-brain and connectors.

### HUE-051 — ADR: choose notification gateways, phone attention surface and delivery privacy

`TBD` · `agent:ready` · dependencies: HUE-003, HUE-005

Resolve the local and phone notification architecture without making a HUE cloud account mandatory or leaking sensitive task content.

## M1 — Local shell & Space foundations

Ship the local application skeleton with Projects and Areas as real context/resource boundaries plus explicit Resource relationships.

**Exit:** First-run shell opens offline with HUE-owned Spaces/Sessions, shadcn-compatible HUE primitives, persistent state and honest empty/error/recovery screens.

### HUE-007 — Build the local HUE shell and supervised control-plane skeleton

`TBI` · `agent:blocked` · dependencies: HUE-002, HUE-003, HUE-005

Create the minimum packaged app/service that starts, reports health and shuts down safely.

### HUE-008 — Implement schema migrations and append-only semantic event journal

`TBI` · `agent:blocked` · dependencies: HUE-003, HUE-007

Provide transactional canonical storage and resumable semantic event history.

### HUE-009 — Implement Space manifests plus Project/Area CRUD and archive lifecycle

`TBI` · `agent:blocked` · dependencies: HUE-008

Persist Projects and ongoing Areas as explicit Space subtypes with common boundaries and distinct lifecycle semantics.

### HUE-010 — Implement trusted Space resource roots and filesystem boundary validation

`TBI` · `agent:blocked` · dependencies: HUE-005, HUE-009

Enforce resource-root policy for Projects and Areas outside model prompts.

### HUE-011 — Build Project/Area overview, shared Space tabs and onboarding flows

`TBI` · `agent:blocked` · dependencies: HUE-007, HUE-009, HUE-010

Expose coherent Space navigation while preserving meaningful Project versus Area behavior.

### HUE-045 — Implement Resource library and explicit Space relationships

`TBI` · `agent:ready` · dependencies: HUE-009

Represent reusable people, reading, templates and archives without granting global implicit access.

### HUE-054 — Implement the HUE component foundation with shadcn-compatible primitives

`TBI` · `agent:blocked` · dependencies: HUE-002

Establish an accessible, source-owned component and token foundation that feels native across HUE desktop and responsive surfaces without making the library the product identity.

## M2 — Sessions, context packs & portable knowledge

Provide isolated typed Sessions, human-readable context packs, layered memory, source ownership and a useful second-brain substrate.

**Exit:** Two fixture Spaces cannot leak context; context packs remain useful as files; Session summaries and source projections preserve provenance.

### HUE-012 — Implement typed Space-bound Sessions, messages, summaries and branches

`TBI` · `agent:blocked` · dependencies: HUE-009, HUE-011

Allow concurrent independent discussion, execution, research, monitoring and review Sessions without shared mutable context.

### HUE-013 — Implement portable context packs and versioned context manifests

`TBI` · `agent:blocked` · dependencies: HUE-010, HUE-012

Assemble least-context Session/worker inputs from human-readable Space files plus explicit sources and record exact immutable manifests.

### HUE-014 — Implement global, Space, source and episodic memory lifecycle with provenance

`TBI` · `agent:blocked` · dependencies: HUE-013

Keep preferences, current Space state, authoritative-source facts and archived episodes separate and correctable.

### HUE-015 — Build knowledge/memory center, context-pack editor and “Why this context?” inspector

`TBI` · `agent:blocked` · dependencies: HUE-013, HUE-014

Make maintained knowledge, memory layers and exact retrieval inspectable and correctable.

### HUE-016 — Add cross-Space isolation, retrieval and context regression suite

`TBI` · `agent:blocked` · dependencies: HUE-013, HUE-014, HUE-005

Prove Project/Area/Resource boundaries and explicit cross-Space links prevent accidental retrieval leakage.

### HUE-046 — Implement portable second-brain relationships, backlinks and epistemic provenance

`TBI` · `agent:ready` · dependencies: HUE-013, HUE-045

Make HUE knowledge human-readable, linked, versioned and useful without any model or runtime.

### HUE-047 — Implement authoritative-source bindings and staleness-aware projections

`TBI` · `agent:ready` · dependencies: HUE-003, HUE-009

Keep GitHub, Calendar, email and user files authoritative while giving HUE normalized, freshness-aware control surfaces.

### HUE-048 — Build universal inbox routing proposals and correction workflow

`TBI` · `agent:ready` · dependencies: HUE-009, HUE-012, HUE-013

Let users capture unfiled work while HUE proposes a correctable destination Space, Session type, topic and expected output.

### HUE-049 — Implement Session summaries and structured Space-state update proposals

`TBI` · `agent:ready` · dependencies: HUE-012, HUE-013, HUE-014, HUE-046

Turn completed work into concise resumable Session summaries and reviewable updates to current state/decisions/active work.

## M3 — Durable tasks, runs & visible execution

Turn outcomes into resumable tasks with semantic events, one trustworthy worker path and durable local attention.

**Exit:** A real Space-bound task survives restart, returns evidence-backed artifacts and creates exactly one policy-correct local completion notification.

### HUE-017 — Implement durable task, run, plan and step state machines

`TBI` · `agent:blocked` · dependencies: HUE-008, HUE-013, HUE-004

Represent assigned outcomes and execution attempts truthfully across restarts.

### HUE-018 — Build semantic event projections and live run stream

`TBI` · `agent:blocked` · dependencies: HUE-008, HUE-017

Turn immutable run events into durable UI-readable projections.

### HUE-019 — Implement first native worker and deterministic verification path

`TBI` · `agent:blocked` · dependencies: HUE-004, HUE-017, HUE-018

Execute one scoped worker end to end under HUE ownership.

### HUE-020 — Build task plan and live run inspector UI

`TBI` · `agent:blocked` · dependencies: HUE-018, HUE-019

Show the user what is happening, why and what needs attention.

### HUE-021 — Implement restart reconciliation, checkpoints and outcome bundles

`TBI` · `agent:blocked` · dependencies: HUE-019, HUE-020

Recover truthful execution state and produce evidence-backed completion.

### HUE-052 — Implement durable notification center, attention policy and local sound/desktop delivery

`TBI` · `agent:blocked` · dependencies: HUE-018, HUE-020, HUE-051

Make meaningful task outcomes and attention needs durable, calm and locally visible even after HUE restarts.

## M4 — Worker catalog & capability routing

Choose temporary specialists, models, providers, tools and runtimes by transparent policy.

**Exit:** Fixture tasks route correctly under privacy, budget, health and user-override constraints.

### HUE-022 — Implement versioned worker catalog and manifest validation

`TBI` · `agent:blocked` · dependencies: HUE-004, HUE-019

Define safe temporary specialist classes without permanent bot sprawl.

### HUE-023 — Implement capability-based route policy and precedence

`TBI` · `agent:blocked` · dependencies: HUE-022, HUE-005

Resolve provider-neutral needs into approved runtime/model/effort routes.

### HUE-024 — Add provider/runtime health, quota, budget and fallback handling

`TBI` · `agent:blocked` · dependencies: HUE-023

Adapt routes safely to real provider availability and budgets.

### HUE-025 — Implement adaptive orchestrator planning, dependencies and replanning

`TBI` · `agent:blocked` · dependencies: HUE-021, HUE-023, HUE-024

Implement a bounded scheduler/router that proposes inbox destination, attaches Space context, plans only when useful, handles dependencies, prevents conflicts and replans from evidence.

### HUE-026 — Build routing policy, explanation and evaluation workbench

`TBI` · `agent:blocked` · dependencies: HUE-023, HUE-024, HUE-025

Let users inspect, simulate and improve automatic routing.

## M5 — OpenCode-first coding workspace & artifact review

Deliver the first primary software execution path through OpenCode with worktrees, tests, diffs, review and handoff.

**Exit:** A multi-file issue is completed through the OpenCode adapter, verified and presented for user-approved merge/PR handoff.

### HUE-027 — Implement repository service and managed worktree lifecycle

`TBI` · `agent:blocked` · dependencies: HUE-010, HUE-021

Provide safe isolated repository execution owned by HUE.

### HUE-028 — Implement OpenCode-first coding worker adapter with scoped terminal and file tools

`TBI` · `agent:blocked` · dependencies: HUE-022, HUE-027

Make OpenCode the primary v0 software execution backend while HUE retains canonical Session/task/policy/evidence state.

### HUE-029 — Build artifact, changed-files and diff review workspace

`TBI` · `agent:blocked` · dependencies: HUE-018, HUE-027, HUE-028

Review code and generated artifacts in the same project/task context.

### HUE-030 — Ingest test/build evidence and add independent review loop

`TBI` · `agent:blocked` · dependencies: HUE-025, HUE-028, HUE-029

Make coding completion depend on evidence and independent review.

### HUE-031 — Implement commit, merge and pull-request approval handoff

`TBI` · `agent:blocked` · dependencies: HUE-030, HUE-005

Move verified work into version-control collaboration only with explicit authority.

## M6 — Permissions, browser & computer use

Operate web/native applications through scoped grants, approvals and verified side effects.

**Exit:** A native-app workflow completes visibly and stops at every consequential boundary.

### HUE-032 — Implement capability policy engine and scoped expiring grants

`TBI` · `agent:blocked` · dependencies: HUE-005, HUE-019, HUE-023

Enforce least-capability access outside model prompts.

### HUE-033 — Build approval inbox, preview and decision scopes

`TBI` · `agent:blocked` · dependencies: HUE-032

Let users understand and decide consequential actions without blind consent.

### HUE-034 — Implement isolated browser worker with prompt-injection boundaries

`TBI` · `agent:blocked` · dependencies: HUE-032, HUE-033

Perform interactive web tasks in isolated, policy-controlled browser contexts.

### HUE-035 — Integrate scoped computer-use backend and live monitor

`TBI` · `agent:blocked` · dependencies: HUE-033, HUE-010

Operate native applications visibly with capture-act-verify and takeover.

### HUE-036 — Implement external side-effect ledger and adversarial safety suite

`TBI` · `agent:blocked` · dependencies: HUE-032, HUE-034, HUE-035, HUE-021

Prevent unsafe retries and prove browser/computer/tool boundaries under attack.

## M7 — Replaceable runtime adapters & open ecosystem

Prove HUE can normalize heterogeneous agents, source systems and tools behind stable contracts.

**Exit:** Two heterogeneous runtimes pass conformance with normalized events, scoped context and truthful recovery.

### HUE-037 — Publish runtime adapter SDK and conformance suite

`TBI` · `agent:blocked` · dependencies: HUE-004, HUE-021, HUE-022

Let external runtimes implement HUE worker lifecycle without product-specific coupling.

### HUE-038 — Implement Hermes runtime adapter

`TBI` · `agent:blocked` · dependencies: HUE-037

Reuse Hermes provider/tools/skills strengths through the HUE runtime contract.

### HUE-039 — Implement Codex and Claude Code adapter pilots

`TBI` · `agent:blocked` · dependencies: HUE-028, HUE-037

Prove OpenCode is a first backend rather than a permanent dependency by running equivalent fixtures through alternate coding runtimes.

### HUE-040 — Implement MCP/plugin mediation and deterministic job adapter

`TBI` · `agent:blocked` · dependencies: HUE-032, HUE-037

Extend capabilities without growing an unsafe core or calling LLMs unnecessarily.

## M8 — Alpha hardening & portable release

Package a secure, accessible, recoverable local alpha with optional privacy-preserving phone attention.

**Exit:** Security, quality, backup and operations gates pass, and one authorized phone channel delivers a redacted task outcome with a secure deep link.

### HUE-041 — Build onboarding, health diagnostics and recovery center

`TBI` · `agent:blocked` · dependencies: HUE-011, HUE-021, HUE-024, HUE-036

Make local setup and failure recovery understandable without terminal archaeology.

### HUE-042 — Implement backup, restore, export/import and retention controls

`TBI` · `agent:blocked` · dependencies: HUE-008, HUE-014, HUE-021, HUE-036

Protect user ownership and recoverability of HUE data.

### HUE-043 — Package signed alpha with safe updates, accessibility and responsive attention surface

`TBI` · `agent:blocked` · dependencies: HUE-007, HUE-033, HUE-041, HUE-042, HUE-053

Deliver an installable, accessible local alpha with safe migration/update behavior.

### HUE-044 — Run alpha threat, golden-task, performance and dogfood release gates

`TBI` · `agent:blocked` · dependencies: HUE-016, HUE-026, HUE-030, HUE-036, HUE-040, HUE-043

Prove the release meets outcome, trust, comprehension and recovery contracts.

### HUE-053 — Implement secure phone notifications, redacted deep links and delivery diagnostics

`TBI` · `agent:blocked` · dependencies: HUE-032, HUE-033, HUE-041, HUE-051, HUE-052

Alert the user on an authorized phone when long work finishes or needs attention without exposing sensitive HUE content or weakening approval policy.
