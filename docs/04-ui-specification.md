# UI specification and screen wireframes

> **Product status:** `TBI`
> **Prototype:** [`../prototype/index.html`](../prototype/index.html) is a non-production functional wireframe with a shadcn-compatible HUE visual layer.
> **Accepted frontend:** [ADR-0001](../decisions/0001-sveltekit-shadcn-svelte.md) selects SvelteKit + Svelte 5 + shadcn-svelte and resolves `TBD-020`.
> **Open choices:** `TBD-001` application packaging/shell, `TBD-013` notification gateways, `TBD-014` mobile attention surface.

## UI posture

HUE is primarily an **Operate** surface with secondary **Command/Inspect** behavior. It should feel calm, precise and work-oriented—not like a marketing dashboard or a terminal log viewer.

### Visual principles — `TBI`

- Information hierarchy before decoration.
- One semantic accent plus restrained state colors.
- Dense enough to monitor real work, with comfortable reading in conversations and documents.
- Cards only where they express object boundaries; not every line becomes a card.
- Technical metadata is available but visually subordinate.
- Motion explains transitions and live state; it never stalls interaction.
- Keyboard-first desktop operation with complete pointer and touch support.
- Minimum 44px mobile targets, visible focus, semantic landmarks and reduced-motion support.

### Component foundation — accepted

[ADR-0001](../decisions/0001-sveltekit-shadcn-svelte.md) selects **SvelteKit + Svelte 5 + shadcn-svelte** for the product frontend.

- HUE-owned wrappers and CSS-variable tokens keep screens independent of low-level primitive APIs.
- Lucide-style line icons are used where useful, always with a text or accessible-name contract.
- Dialogs, sheets, menus, keyboard behavior and focus return follow platform conventions rather than fake OS chrome.
- The dependency-free HTML prototype mirrors the accepted token, variant and component-anatomy contract; framework conversion waits until functional flows stabilize.

Shadcn-svelte is the accessibility and interaction foundation, **not HUE's visual identity**. HUE supplies its own typography, semantic state colors, spacing, density, motion and composition. Stock shadcn theming, card-heavy dashboard composition and copy-pasted variants are not acceptable defaults. Application packaging under `TBD-001` remains separate from the accepted frontend framework.

## Global shell — `TBI`

```text
┌──────────────┬─────────────────────────────────────┬──────────────────────┐
│ HUE          │ Notidian / Mobile navigation       │ Project context      │
│              │                                     │ Primary root         │
│ Home         │ [Conversation] [Task] [Artifact]    │ Active instructions  │
│ Projects     │                                     │ Active run          │
│  ● Notidian  │                                     │ Files / diff        │
│  ○ HUE       │                                     │ Context / memory    │
│ Areas        │                                     │ Sources             │
│  ○ Health    │                                     │                     │
│  ○ Parenting │                                     │                     │
│ Resources    │                                     │                     │
│ Inbox (2)    │                                     │                      │
│ Notifications│                                     │                      │
│ Conversations│                                     │                      │
│ Tasks        │                                     │                      │
│ Memory       │                                     │                      │
├──────────────┴─────────────────────────────────────┴──────────────────────┤
│ ● Developer: implementing · Reviewer: waiting · [Open task] [Pause]       │
└───────────────────────────────────────────────────────────────────────────┘
```

The inspector can collapse. On narrow desktop widths it becomes a drawer. The active-run rail appears only while work is running, waiting or interrupted.

## Screen S01 — Home / attention dashboard — `TBI`

**Purpose:** Answer “Where am I needed, what should I continue, and what is running?”

```text
Good morning

NEEDS YOUR ATTENTION
┌ Approval · Notidian ───────────────────────────────┐
│ Developer requests write access to 4 files        │
│ Scope: src/routes/mobile/*     [Review] [Reject]   │
└─────────────────────────────────────────────────────┘

CONTINUE
Notidian · Mobile navigation       active 4m
HUE · Architecture decisions       last opened 1h

RUNNING QUIETLY
Research competitor project memory patterns     62%

RECENT OUTCOMES
✓ Vocabulary corpus schema decision             Verified
```

**States:** first-run empty state, normal, offline, runtime degraded, attention overload grouping, all-clear.
**Must not show:** invented productivity scores or decorative metrics.

## Screen S02 — Project Space overview — `TBI`

**Purpose:** Give one truthful view of the project’s current context and work.

```text
Notidian                                        Local project
Local-first personal knowledge workspace

[New conversation] [Assign task] [Open files] [Project settings]

NOW
  Mobile navigation                     Running
  Import architecture ADR               Waiting for decision

CONVERSATIONS
  Product direction
  Mobile synchronization
  Onboarding implementation

RECENT ARTIFACTS
  responsive-review.mp4   navigation.diff   ADR-014.md

PROJECT CONTEXT
  /Users/…/Sites/notidian
  2 linked roots · 4 instructions · 18 curated memories
```

**Inspector:** branches/worktrees, repositories, project health, permission exceptions.
**Empty state:** setup checklist, not a blank page.

Every Space exposes the same secondary navigation: **Overview · Sessions · Tasks · Knowledge · Files · Decisions · Activity · Settings**. Views adapt to the Space type instead of hiding conceptual differences.

## Screen S02A — Permanent Area overview — `TBI`

**Purpose:** Maintain current state for an ongoing responsibility without imposing repository or milestone metaphors.

```text
Health                                                   Ongoing Area

CURRENT GOALS                 CURRENT SYSTEM
Stable energy                 Vegan diet
Preserve strength             Running + strength training
Sustainable 70–72 kg          Weekly review

ACTIVE QUESTIONS              RECENT OBSERVATIONS
Afternoon hunger              15:00 hunger on 3/5 days
Meal timing                   Sleep averaged 7h 42m

[Start Session] [Weekly review] [Add observation]
```

Observation, inference, sourced evidence, professional advice and unresolved uncertainty have visually distinct labels. The Area has no branch/worktree controls unless a linked Project explicitly supplies them.

## Screen S03 — Session and conversation — `TBI`

**Purpose:** Think, communicate and launch work inside one independent Space-bound Session without turning the transcript into a task log.

```text
Notidian / Sessions / Product direction              Discussion

You       The mobile navigation feels too generic...
HUE       The conflict is between persistent project access and...

          Proposed task
          Fix mobile navigation and verify narrow viewports
          [Review scope] [Start task] [Keep discussing]

──────────────────────────────────────────────────────
[ + context ]  Ask or assign work…         [voice] [send]
Project: Notidian · Auto routing · Computer use: ask
```

**Message affordances:** branch, quote, turn into task, save artifact, propose memory, inspect context.
**Streaming:** text and compact semantic tool activity; raw events belong in run detail.
**Error:** retain unsent text and show retry path.

The Session header displays type (Discussion, Execution, Research, Monitoring or Review), Space, context-pack version and source health. Changing type creates an explicit transition or a new linked Session; it does not silently add broad tools to an existing context.

## Screen S04 — Task plan and live graph — `TBI`

**Purpose:** Make orchestration understandable and steerable.

```text
Fix mobile navigation                              RUNNING
Goal: Replace overflow menu with responsive project navigation

● Inspect current layout                 done 1m
● Reproduce at target viewports          done 2m
● Implement in worktree                  active
○ Run quality gates                      waiting
○ Independent review                     waiting
○ Verify and prepare result              waiting

Active worker
Developer · coding/high · isolated worktree
Editing src/lib/navigation/…

[Steer] [Pause] [Cancel] [Open worker] [View artifacts]
```

Graph view supports dependencies and parallel branches but defaults to an ordered readable list. Replanning records what changed and why.

## Screen S05 — Worker detail — `TBI`

**Purpose:** Inspect one temporary specialist without making workers top-level identities.

Shows:

- assigned outcome and constraints;
- status/heartbeat;
- selection rationale;
- effective capability policy and user overrides;
- model/provider/effort under an advanced disclosure;
- tools, paths and permissions granted;
- context sources and token budget;
- transcript/event timeline;
- files touched and artifacts produced;
- cost, latency and retry count;
- pause, steer and terminate.

Private chain-of-thought is never exposed. The UI shows actions, summaries and declared rationale only.

## Screen S06 — Universal inbox, routing and approvals — `TBI`

**Purpose:** Capture unfiled requests, correct proposed Space/Session routing, and make informed risk decisions quickly.

Routing-proposal detail shows original text, proposed destination, Session type, related topic/sources and likely output. Primary actions are **Accept routing**, **Change**, and **Keep in inbox**. A correction is inspectable and never presented as secret automatic learning.

```text
Approval required                           WRITE FILES
Task: Fix mobile navigation
Worker: Developer

Requested
  Modify 4 files inside /Sites/notidian/src

Why
  Implement the approved responsive navigation plan

Preview
  +184 / −62 · no files outside project · no network request

Decision scope
  (•) Approve this action
  ( ) Approve matching writes for this run
  ( ) Add a reusable project rule

[Reject] [Edit scope] [Approve]
```

Approval must display action, target, consequences, evidence, reversibility and scope. Broad “allow everything” is not the primary action.

## Screen S07 — Artifact and diff viewer — `TBI`

**Purpose:** Review outcomes where they belong.

Supports:

- Markdown/document preview;
- source file and side-by-side diff;
- images, audio, video and PDF;
- test/log evidence;
- citations and source snippets;
- generated HTML prototypes;
- metadata, provenance and originating task;
- accept, edit, export, reveal in filesystem, attach to conversation.

For code, show changed files, staged/unstaged state, worktree/branch, checks and reviewer annotations.

## Screen S08 — Project settings — `TBI`

Tabs:

1. **General:** name, description, icon/color, archive.
2. **Roots:** primary workspace, additional roots, repositories, trust state.
3. **Instructions:** inline guidance and linked context files with precedence.
4. **Memory:** namespace settings, inherited global categories, retention.
5. **Skills:** selected capabilities and project procedures.
6. **Defaults:** model policy, effort policy, worker policy, notification policy.
7. **Permissions:** filesystem, network, tools, external-action gates.
8. **Integrations:** GitHub, MCP, calendars, storage.
9. **Notifications:** outcome subscriptions, channels/devices, privacy level, sounds, quiet hours, grouping and escalation.
10. **Data:** export, backup, delete and audit history.

Settings changes apply to **new turns/runs** and never rewrite historical execution context silently.

## Screen S09 — Knowledge, context packs, memory center and context inspector — `TBI`

Memory center lists:

- global preferences/facts;
- project facts and decisions;
- proposals awaiting confirmation;
- superseded entries;
- conflicts;
- provenance and last-used metadata.

The same surface can open the human-readable Space context pack (`goals`, `current-state`, `decisions`, `active-work`, source bindings and instructions), show a proposed file/note revision, and reveal backlinks/tags/version history. Source memory and episodic archive are separate filters from current Space memory.

Context inspector answers:

```text
Why did HUE know/use this?
1. Global preference: concise operational updates
2. Project instruction: preserve local-first behavior
3. docs/architecture.md § Sync model
4. Conversation decision from July 22
5. Current task plan
```

Users can remove a source from the current turn without deleting the underlying record.

## Screen S10 — Routing and worker policy — `TBI`

Default view uses capabilities rather than vendor names:

```text
Fast utility       local/small preferred       Healthy
General reasoning  balanced                    Healthy
Coding             strongest approved coding  Healthy
Independent review different model family      Healthy
Vision/UI           vision required             Healthy
```

Advanced view reveals resolved providers/models, budgets, fallbacks, benchmark evidence and route history.

## Screen S11 — Computer-use monitor — `TBI`

```text
Computer operator · Numbers                     PAUSED FOR APPROVAL
Goal: Add July rows and export a PDF

[Live scoped application preview]

✓ Open workbook
✓ Locate July sheet
✓ Insert 14 rows
○ Save workbook                       approval required
○ Export PDF

[Take over] [Approve save] [Reject] [Stop]
```

It shows the agent cursor separately from the user cursor, scoped application, action history, risk classification and current permission mode.

## Screen S12 — Recovery center — `TBI`

Groups:

- interrupted runs safe to resume;
- unknown side-effect outcomes requiring inspection;
- exhausted routes/providers;
- orphan worktrees/processes;
- failed backups or sync;
- stale approvals.

Recovery actions explain whether they are idempotent and what evidence will be checked before retry.

## Screen S13 — Onboarding — `TBI`

Progressive setup:

1. Choose local data directory and backup posture.
2. Add first model/provider or local runtime.
3. Create/open first project and approve roots.
4. Import optional global preferences and existing agent history.
5. Run a safe capability check.
6. Explain approvals, memory and how to stop work.

Provider setup cannot be required before browsing the product documentation or creating local projects.

## Screen S14 — Notifications and delivery history — `TBI`

**Purpose:** Show what needs attention, what finished and whether each configured channel actually received the alert.

```text
Notifications                                      2 unread
[Needs attention] [Outcomes] [Monitoring] [System]    [Settings]

NOW
✓ Mobile navigation fixed                         Verified
  Notidian · task ran 18m
  Desktop: displayed · Sound: played · Phone: delivered
  [Open result] [Delivery details] [Mark read]

! Approval still required                         12m
  Export research report · phone reminder in 3m
  [Review safely] [Mute task]

EARLIER
○ Competitor monitor found no material change     Quiet · in-app only
```

Notification detail shows the source event, task/run, outcome certainty, policy snapshot, redacted payload preview, every delivery attempt and the strongest truthful acknowledgement (**queued**, **accepted**, **displayed/delivered**, **failed**, **expired**, **read**, **acted**).

The header bell displays unread attention count, not raw event volume. Dismissal clears the attention projection but does not erase the underlying semantic/security event. Settings provide channel/device authorization, privacy level, per-Space overrides, completion threshold, sound test, quiet hours, grouping and escalation. See [Notifications, attention and delivery](16-notifications-attention-delivery.md).

## Responsive and accessibility requirements — `TBI`

- WCAG 2.2 AA target.
- Complete keyboard operation and shortcut reference.
- Screen-reader announcements for task state, not every tool token.
- Logical focus after modal/drawer transitions.
- Color never carries status alone.
- User-selectable density, type scale and motion.
- High-contrast and reduced-transparency modes.
- Mobile approvals show enough context to avoid blind consent.
- Long paths and model names truncate visually but remain copyable.

## Prototype honesty

Mock content in `prototype/` demonstrates layout and interaction only. It must display a persistent `SPEC / TBI` marker and must not call real agent, filesystem or provider APIs.
