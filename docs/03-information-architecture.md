# Information architecture

> **Focused product status:** `IMPLEMENTED IN PART`
> **Active navigation:** Projects → Workflows/Sessions → selected Session

The broad information architecture below is retained as historical design context. ADR-0002 narrows the implemented product to Projects, Workflows, and Sessions; Home, Inbox, Areas, Resources, tasks, knowledge, files, notifications, and global settings are not active product scope.

## Primary navigation

```text
HUE
├── Home
│   ├── Today
│   ├── Needs attention
│   ├── Active sessions
│   ├── Waiting for me
│   ├── Calendar and current focus
│   └── Recent outcomes
├── Inbox
│   ├── Unrouted captures
│   ├── Routing proposals
│   ├── Approvals
│   ├── Questions
│   └── Failures & recovery
├── Projects
│   └── <finishable Space>
│       ├── Overview
│       ├── Sessions
│       ├── Tasks & runs
│       ├── Knowledge
│       ├── Files & artifacts
│       ├── Decisions
│       ├── Activity
│       └── Settings
├── Areas
│   └── <ongoing Space>
│       ├── Overview
│       ├── Sessions
│       ├── Tasks
│       ├── Knowledge
│       ├── Files
│       ├── Decisions
│       ├── Activity
│       └── Settings
├── Resources
│   ├── People
│   ├── Reading & research library
│   ├── Templates
│   └── Archive
├── All sessions
├── All tasks
├── Knowledge & memory
│   ├── Global
│   ├── Space context packs
│   ├── Source memory
│   ├── Episodic archive
│   └── Proposed changes
└── Settings
    ├── Models & providers
    ├── Workers & routing
    ├── Tools & integrations
    ├── Computer use
    ├── Privacy & permissions
    ├── Notifications
    └── Data & backups
```

## Core objects and ownership

| Object | Primary owner | Appears in |
|---|---|---|
| Space | User/HUE workspace | Project or Area navigation, routing context |
| Project | Space subtype | Finishable outcome, repositories/milestones when relevant |
| Area | Space subtype | Ongoing responsibility, current state and periodic reviews |
| Resource | Reusable user-owned reference | Linked explicitly to one or more Spaces |
| Session | Space or Inbox | Independent discussion/execution/research/monitoring/review context |
| Conversation | Session | Human/HUE message stream inside the Session |
| Task | Space or Inbox | Session, source-system binding, task views, Home |
| Run | Task | Task inspector, activity, recovery |
| Worker | Run | Task graph, worker detail |
| Artifact | Project + originating run | Files/artifacts, conversation, task result |
| Approval | Run + policy decision | Inbox, run, notification |
| Knowledge item | Space/resource/global relationship | Context pack, second brain, search |
| Memory | Global, Space, source or episodic layer | Memory center, context inspector |
| Decision | Space or product | Space decisions, ADR/source links |
| Source binding | Space/task | GitHub, Calendar, email, files and other authoritative systems |
| Notification | User attention stream | Inbox, external delivery surfaces |

## Desktop composition

The primary application is an **Operate + Command/Inspect** surface—not a marketing dashboard. Its stable hierarchy is **Spaces → Sessions → work**.

```text
┌──────────────────┬─────────────────────────┬──────────────────────────────────┐
│ Spaces           │ Sessions in Notidian   │ Main work window                 │
│ [collapse ⇤]     │                         │                                  │
│                  │ ● Sync reliability     │ Selected Session, task, file,    │
│ Home             │   active now           │ knowledge view or Space overview │
│ Inbox  2         │                         │                                  │
│ Notifications  2 │ ◐ Mobile navigation    │ Context, run evidence and         │
│                  │   waiting for approval  │ inspector surfaces appear inside │
│ Projects         │                         │ this window when relevant.       │
│ ● HUE            │ ○ Product direction    │                                  │
│ ● Notidian       │   quiet · Friday       │                                  │
│ ○ Valorlist      │                         │                                  │
│ ○ Supertaal      │ [Filter Sessions…]     │                                  │
│ Areas            │ [+ New Session]         │                                  │
│ ○ Health         │                         │                                  │
│ ○ Parenting      │                         │                                  │
└──────────────────┴─────────────────────────┴──────────────────────────────────┘
```

- The left **Space rail** keeps every Project and Area directly visible. It can collapse to stable Space identities/icons without turning into a hidden project switcher.
- Selecting a Space updates the adjacent **Session sidebar**; it never mixes Sessions from unrelated Spaces.
- Session rows expose title, type, status, last activity and concise blocker/attention context. Running, waiting, review, blocked, verified and quiet states use text or accessible names in addition to color.
- Selecting a Session changes the **main work window**. The selected Space and Session remain visible while the user discusses, runs, reviews or inspects work.
- Global Home, Inbox and Notifications can use the same main window while preserving the selected Space and its Sessions.
- The main window may contain a contextual inspector or split view, but that inspector does not replace the stable Space → Session hierarchy.
- Below narrow-desktop width the Session sidebar becomes a drawer; on mobile both navigation panes become drawers with direct **Spaces** and **Sessions** controls.
- On touch devices, a rightward drag from the left edge reveals the selected Space’s Sessions and tracks the finger; either drawer can be dismissed with a leftward drag or backdrop tap.
- The Session drawer provides a visible Back affordance to the all-Spaces menu. Selecting a Space drills forward into only that Space’s Sessions.
- Android/system Back and browser Back close the topmost dialog or drawer before navigating to the previous main-window state; gesture navigation must not replace explicit buttons or trap vertical scrolling.
- A compact activity rail may appear only while work is active, waiting or blocked.

## Mobile composition

Mobile is an attention and steering surface first:

```text
┌───────────────────────────┐
│ HUE · Notidian        ☰   │
├───────────────────────────┤
│ Needs attention (1)       │
│ Approve writing 4 files   │
├───────────────────────────┤
│ Session                   │
│ ...                       │
│                           │
│ [message composer]        │
├───────────────────────────┤
│ Session Tasks Inbox Space │
└───────────────────────────┘
```

Mobile must support:

- Session/conversation and voice input;
- task progress;
- steering, pause and cancel;
- safe approvals with sufficient context;
- artifact previews;
- notifications;
- takeover/deep-link to desktop for complex diffs or computer control.

Full repository editing and dense event inspection may remain desktop-first.

## Command palette — `TBI`

The palette provides fast object and action navigation:

```text
> open notidian
  Open project: Notidian
  New Session in Notidian
  Show active Notidian task

> open health
  Open Area: Health
  Resume afternoon hunger review

> assign
  Create task from current Session
  Run selected text as task

> memory
  Inspect context used in this turn
  Propose Space memory/context-pack update

> inbox research WebGPU for Notidian
  Propose destination and Session type
```

It searches Projects, Areas, Resources, Sessions, tasks, knowledge, files, artifacts, commands and settings but clearly distinguishes navigation from side-effecting actions.

## Deep links

Every durable object must have a stable local identifier and deep link:

```text
hue://project/notidian
hue://area/health
hue://resource/<id>
hue://session/<id>
hue://task/<id>
hue://run/<id>
hue://artifact/<id>
hue://approval/<id>
```

**TBD-014:** Web and mobile URL equivalents depend on packaging and remote-access decisions.

## Search

One search surface, scoped by default to the current Space, with filters for object type, date, status, epistemic type and provenance. Global search can include linked Resources and the episodic archive without injecting those results automatically into a Session. Search results never imply that archived raw worker transcripts are current durable knowledge.

## Progressive disclosure

Default user view:

- outcome;
- task state;
- current plan step;
- blockers and approvals;
- artifacts and evidence.

Advanced inspector:

- routing rationale;
- model/provider/effort;
- worker manifest;
- tool events;
- token/cost/latency;
- context sources;
- raw logs subject to redaction.
