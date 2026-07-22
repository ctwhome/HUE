# Information architecture

> **Product status:** `TBI`
> **Open choices:** `TBD-001` application shell, `TBD-014` mobile packaging.

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

The primary application is an **Operate + Command/Inspect** surface—not a marketing dashboard.

```text
┌──────────────────┬─────────────────────────────────────┬─────────────────────┐
│ Navigation       │ Primary workspace                   │ Context inspector   │
│                  │                                     │                     │
│ Home             │ Session / task / knowledge          │ Active Space        │
│ Projects         │                                     │ Active run          │
│   Notidian       │                                     │ Files / diff        │
│   HUE             │                                     │ Context / memory    │
│ Areas            │                                     │ Sources/provenance  │
│   Health          │                                     │                     │
│   Parenting       │                                     │                     │
│ Resources        │                                     │                     │
│ Inbox  2         │                                     │ Approvals           │
│ Sessions         │                                     │                     │
│ Tasks            │                                     │                     │
├──────────────────┴─────────────────────────────────────┴─────────────────────┤
│ Global activity rail: 2 active · 1 waiting · local runtime healthy          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Left rail answers **where am I?**
- Center answers **what am I discussing/doing/reviewing?**
- Right inspector answers **what context, work and evidence belong to this object?**
- Bottom activity rail is compact and appears only when work is active or blocked.

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
