# Glossary

> **Document status:** `SPEC`

| Term | Meaning in HUE |
|---|---|
| **HUE** | The personal workspace, product and control surface—not one omniscient context and not an individual temporary worker. |
| **Space** | Common context, knowledge, source, memory and permission boundary implemented as a Project or Area. |
| **Project** | A Space pursuing a finishable outcome; it may bind repositories, milestones and external delivery state. |
| **Area** | A Space representing an ongoing responsibility such as Health, Parenting or Finances. |
| **Resource** | Reusable reference (person, book, template, library, archive) related to Spaces explicitly rather than by global implicit access. |
| **Resource root** | A validated folder/repository/collection a Space may access. |
| **Session** | Independent Space-bound discussion, execution, research, monitoring or review context. |
| **Conversation** | The branching user/HUE message stream inside a Session. It may originate tasks but is not itself a task log. |
| **Task** | A durable desired outcome with lifecycle across one or more execution attempts. |
| **Run** | One execution attempt for a task. |
| **Plan** | A versioned graph of steps, dependencies, outcomes and verification criteria. |
| **Step** | One plan node with a defined observable outcome. |
| **Worker** | A temporary specialist execution context created for a run/step. |
| **Worker class** | An allowlisted capability template such as researcher, developer or reviewer. |
| **Runtime adapter** | Bridge from HUE’s worker lifecycle contract to Hermes, OpenCode, Codex, Claude Code or another engine. Backend-native Sessions are not canonical HUE Sessions. |
| **Capability request** | Provider-neutral statement of quality, domain, latency, privacy, context and tool needs. |
| **Route** | Resolved runtime/provider/model/effort/fallback configuration for a worker. |
| **Tool** | A bounded deterministic or agent-operated capability with declared risk and schemas. |
| **Grant** | Scoped, expiring authorization for a subject to invoke a capability on resources. |
| **Approval** | Human decision that creates or denies a grant at a policy boundary. |
| **Artifact** | Durable output/evidence such as a file, diff, report, recording, citation bundle or test result. |
| **Event** | Immutable semantic record in a run’s history. |
| **Context manifest** | Exact ordered set of sources, versions, policy and omissions supplied to a turn/worker. |
| **Context pack** | Human-readable maintained files/notes providing a Space’s goals, current state, decisions, active work, sources and operating rules. |
| **Knowledge item** | Portable maintained note/file relationship with backlinks, tags, version and epistemic provenance. |
| **Source binding** | Explicit ownership/sync contract connecting a Space to GitHub, Calendar, email, files or another authoritative system. |
| **Global memory** | Curated stable user preferences/identity facts allowed across Spaces. |
| **Space memory** | Curated current state/facts/decisions available only in one Project or Area. |
| **Source memory** | Freshness-aware facts retrieved from an authoritative source with native provenance. |
| **Session memory** | Messages, branches, summaries and decisions for one Session; not automatically durable Space memory. |
| **Episodic archive** | Searchable closed Sessions and completed work that are not injected by default. |
| **Run state** | Operational plan/events/results/checkpoints; not automatically semantic memory. |
| **Outcome bundle** | Completion summary plus routes, changes, artifacts, evidence, approvals and open risks. |
| **Unknown outcome** | A run state where external effects may have occurred and must be reconciled before retry. |
| **Deterministic job** | Normal program/tool execution used instead of an LLM worker when appropriate. |
| **Computer use** | Accessibility/vision-based operation of native GUI applications under scoped policy. |
| **TBI** | Accepted target behavior that remains to be implemented. |
| **TBD** | Material decision still open. |
| **SPEC** | Reviewable documentation exists; does not imply implementation. |
| **POC** | Disposable experiment answering a named decision. |
| **Verified** | Behavior passed its documented evidence gates. |
