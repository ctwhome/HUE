# UX and perceived-performance audit

Date: 2026-09-08. Status: review evidence, not an accepted architecture decision.

## Highest priorities

HUE's main experience risks are delayed information, unsafe asynchronous state updates, and missing recovery feedback. Faster animation would not fix them. Prioritize preserving the user's work, showing useful information before optional work completes, and making loading/error states visible where the user acted.

| Priority | Finding | Evidence |
| --- | --- | --- |
| P1 | Send acknowledgements erase newer drafts | Isolated execution reproduced |
| P1 | Repeated busy-session submissions create distinct queued messages | Isolated execution reproduced |
| P1 | Storage failure can strand delivery in `saving` | Isolated execution reproduced, with successful-storage control |
| P1 | Session loading can transfer old attachments or overwrite newer state | Source-confirmed race |
| P1 | Git operations block the shared server event loop | Synchronous request-path implementation |
| P1 | Git actions can target a newly selected repository while displaying old rows | Source-confirmed race |
| P1 | File and skill saves can overwrite typing performed during the save | Source-confirmed race |
| P1 | Prompt library discards unsaved work on dismissal | Browser reproduced |
| P2 | Mobile file loading and errors render outside the viewport | Browser reproduced at 320px and 390px |
| P2 | Workflow save allows repeated submissions; errors appear outside its modal | Browser reproduced with intercepted requests |
| P2 | Deep-link restoration waits through multiple serial data requests | Browser timing plus source trace |
| P2 | Event replay depends on live Hermes Project administration | Source-confirmed request dependency |
| P2 | Git dock and inner section share a persistence key | Source-confirmed; browser test failed twice |

P1 means fix first because of lost work, duplicated work, wrong-context operations, or cross-feature blocking. P2 means material speed, correctness, recovery, or usability degradation. Scale-dependent risks below are not presented as measured production regressions.

## Scope and method

- Reviewed Projects, Workflows, Sessions, supporting workbench tools, Hermes administration, notifications, schedules, PWA boundaries, and relevant accepted decisions.
- Traced implementation, callers, reducers, API handlers, existing unit tests, and browser tests. No application code was changed.
- Used the existing development server at `http://127.0.0.1:44010`; no additional Vite server was started.
- Inspected the shell and App Settings at 1440x900, 1024x768, 390x844, and 320x844. Exercised mobile Project tools, file preview, artifacts, Session finder, Prompt library, and Hermes administration section navigation.
- Injected delayed/503 file-preview and Workflow-create responses in the audit browser only. Workflow POSTs were intercepted before reaching the server. No real prompts, Git mutations, schedule runs, file edits, provider changes, or process-stop actions were performed.
- Ran isolated message-state probes with fake API responses and in-memory storage. These made no network or harness calls.
- Ran the full Bun unit suite, Svelte check, and isolated production-build Playwright suite. Repeated three failing restoration tests separately.
- The worktree already contained changes to navigation, BrowserPanel, dev-server discovery, styles, and browser tests. Those changes were preserved. Live development reloads occurred during inspection; timing observations describe this development environment, not an immutable release benchmark.

## Measured observations

Three desktop reload samples, with the existing browser dock open:

| Observation | Samples / result |
| --- | --- |
| Document request TTFB | 1,142 ms; 644 ms; 1,186 ms |
| Conversation region and composer detectable | 2,794 ms; 2,614 ms; 3,548 ms |
| Initial Project Session lookup | 1,158 ms; 1,180 ms; 1,513 ms |
| Initial notifications request | 994 ms; 1,012 ms; 1,237 ms |
| Local-server discovery | 622 ms; 608 ms; 757 ms |
| Detailed third-sample Session response | Started at 3,179 ms; completed at 4,872 ms; 71,775 transfer bytes |
| Third-sample repository request | 2,105 ms |
| Third-sample health request | 2,635 ms |
| Main-thread long tasks recorded during those short sample windows | None |

The shell-detection metric does **not** mean transcript content was ready. The third sample shows why: Session detail was still pending after the composer appeared. After detail, two further Session-list responses completed at approximately 5.25 and 5.90 seconds. An earlier first navigation had 2,157 ms TTFB, excluded from the three reload samples.

These are browser observations on a busy local development server, without CPU/network throttling. They do not establish production p50/p95, prove that any one synchronous operation caused a particular delay, or measure long-session streaming. The absence of short-window long tasks does not clear the long-history rendering risks.

### Visible states

- No document-level horizontal overflow was found in the inspected shell or App Settings at the four sizes.
- Inspected visible Session buttons met 44px mobile dimensions. App Settings' checkboxes have larger clickable labels, so their 13px native checkbox glyph alone is not a hit-target defect.
- Session finder showed a loading state, then an explicit no-results state; Escape returned focus to its trigger.
- At 320px, a failed file preview was positioned at `x=320`; at 390px, at `x=390`. The loading/error text existed but was outside the visible area.
- Artifacts returned a blank list with no empty-state explanation in the inspected mobile flow.
- An unsaved custom Workflow closed on Escape without confirmation. Reopening did not restore the editor; starting a new editor showed empty name and prompt fields.
- A delayed Workflow create left Add prompt enabled. Two clicks produced two intercepted POSTs. The simulated failure alert was outside the open dialog, with no matching error inside it.
- With the retained browser dock and navigation open, the composer text field measured about 164px wide at 1440px and 181px at 1024px. This is a usability concern with that retained layout, not a claim about every default layout: verify a useful minimum chat width when allocating adjacent panes.
- No unexpected console errors were observed in the manual inspection. Five recorded 503 resource errors came from the deliberate failure probes.

Local screenshots, containing no conversation body:

- [Mobile file selection with invisible error](../screenshots/ux-audit-hidden-file-error-320.png)
- [App Settings at 320px](../screenshots/ux-audit-settings-320.png)

## Findings: protect work and context

### 1. P1: acknowledging one draft deletes a newer draft

**Reproduction:** submit text A, keep the POST pending, type B in the same Session, then acknowledge A. The isolated probe changed both composer and persisted draft from B to empty; no error was reported.

`submit()` unconditionally clears the current composer and attachments after success. Separately, `sendText()` captures draft equality before the request and uses that old result to clear persistence after it. Exact retry and queued-edit completion have the same current-draft clearing pattern.

**Fix direction:** capture the submitted draft revision/envelope; only clear content that still belongs to that revision. Construct accepted rows from the captured envelope, never from live attachment arrays after an await.

**Sources:** [message-state.svelte.ts:84-106](../../app/src/lib/components/workspace/message-state.svelte.ts#L84), [319-375](../../app/src/lib/components/workspace/message-state.svelte.ts#L319), [472-486](../../app/src/lib/components/workspace/message-state.svelte.ts#L472).

### 2. P1: queued sends bypass exact-envelope recovery

Busy-session submission uses a separate function that creates a fresh UUID on every call, has no in-flight guard, and does not retain uncertain envelopes. Two concurrent submits in the isolated probe produced two distinct IDs and two identical local queued rows. An acknowledgement lost after real acceptance would likewise make a manual retry a different message, defeating server idempotency.

An accepted-but-unacknowledged follow-up is also absent from the local queue. The client can consequently stop polling when the current turn ends, even though the server has more work.

**Fix direction:** use the existing captured-envelope and uncertainty contract for queued submission, including same-ID retry and submission locking.

**Sources:** [message-state.svelte.ts:94-153](../../app/src/lib/components/workspace/message-state.svelte.ts#L94), [679-684](../../app/src/lib/components/workspace/message-state.svelte.ts#L679).

### 3. P1: storage failure interrupts delivery recovery

The transport-error catch writes pending persistence before setting recoverable in-memory state. An unguarded `localStorage.setItem` exception escapes that catch.

| Same simulated transport failure | Normal storage | Quota failure |
| --- | --- | --- |
| Delivery | `delivery unknown` | `saving` |
| Pending envelope in memory | Present | Missing |
| Busy marker cleared | Yes | No |
| Error reported through UI callback | Transport error | None |

Pending persistence retains image base64, making quota pressure realistic; exact quota limits depend on the browser. Draft storage exceptions can also interrupt navigation before its request/error handling.

**Fix direction:** establish in-memory delivery truth before best-effort persistence, handle storage failure explicitly, and never let it mask an uncertain send.

**Sources:** [message-state.svelte.ts:453-469](../../app/src/lib/components/workspace/message-state.svelte.ts#L453), [message-persistence.ts:31-74](../../app/src/lib/components/workspace/message-persistence.ts#L31).

### 4. P1: Session loading can overwrite newer work or retain the previous Session's files

`openSession()` restores the destination's text but does not immediately clear old staged images/files or queue-edit identity. The eventual `applyLoadedSession()` clears those fields and replaces delivery/timeline state.

**Reproduction conditions:** attach a file in A; select B with a delayed/failing detail GET. A's attachment remains staged under B until successful loading. Conversely, attach a new file or submit while B's GET is pending: its older snapshot can clear the attachment or overwrite newer active-message/delivery state. Selection-generation checks protect against another Session, but not mutations within the same Session after the snapshot started.

**Fix direction:** reset selection-owned staging synchronously; reconcile a loaded snapshot against newer local revisions/cursors instead of replacing them indiscriminately.

**Sources:** [navigation.svelte.ts:454-519](../../app/src/lib/components/workspace/navigation.svelte.ts#L454), [session-controller.svelte.ts:112-115](../../app/src/lib/components/workspace/session-controller.svelte.ts#L112), [session-state.svelte.ts:183-200](../../app/src/lib/components/workspace/session-state.svelte.ts#L183).

### 5. P1: reattaching a file does not repair exact retry after reload

Generic file bytes are deliberately removed from persisted pending envelopes. Reattaching updates current staging, not the pending envelope used by Retry exact message. That action still rejects missing bytes. Sending the newly staged file normally no longer matches the metadata-only envelope and allocates a new ID, which risks duplicate work if the original was accepted.

**Fix direction:** reconcile reattached content into the specific pending envelope while retaining its identity, or present an explicit alternative recovery path. Do not persist generic file bytes just to conceal the problem.

**Sources:** [message-persistence.ts:38-74](../../app/src/lib/components/workspace/message-persistence.ts#L38), [message-state.svelte.ts:315-332](../../app/src/lib/components/workspace/message-state.svelte.ts#L315), [472-480](../../app/src/lib/components/workspace/message-state.svelte.ts#L472), [612-619](../../app/src/lib/components/workspace/message-state.svelte.ts#L612).

### 6. P1: repository switching leaves old rows actionable against the new repository

Selecting B changes `layout.selectedRepository` immediately but leaves A's status rows visible while loading. Mutations use the current selection and guard `repositoryBusy`, not `repositoryLoading`. A slow or failed GET therefore allows an old displayed path to be staged/unstaged in B; push/commit can also use B while A's context remains visible.

**Fix direction:** bind mutations to the displayed snapshot's repository and disable them whenever displayed and requested contexts differ. Preserve a visible loading/error state.

**Sources:** [RepositoryPanels.svelte:66-87](../../app/src/lib/components/workbench/RepositoryPanels.svelte#L66), [139-147](../../app/src/lib/components/workbench/RepositoryPanels.svelte#L139), [275-399](../../app/src/lib/components/workbench/RepositoryPanels.svelte#L275).

### 7. P1: save responses overwrite edits made while saving

The file editor stays editable while a save is pending. After saving A, its response calls `applyPreview`, replacing newer B and resetting the clean baseline. Existing save guards check file identity/version, not the current draft revision. Installed-skill editing has the same pattern.

**Fix direction:** update the saved baseline to A but preserve a newer dirty B, or prevent editing during the bounded save. Prefer revision-aware handling for uninterrupted typing.

**Sources:** [FilesPanel.svelte:231-235,259-269](../../app/src/lib/components/workbench/FilesPanel.svelte#L231), [file-preview-requests.ts:62-73](../../app/src/lib/components/workbench/file-preview-requests.ts#L62), [HermesPanel.svelte:232-244](../../app/src/lib/components/HermesPanel.svelte#L232).

### 8. P1: Prompt library discards unsaved work

Escape, backdrop/close, source changes, or selecting another editor can discard custom Workflow, Bundle, and member-skill edits without the dirty protection used elsewhere. The custom-Workflow Escape case was reproduced without submitting anything.

**Fix direction:** reuse the existing dirty guard for all dismissal and editor-selection paths; preserve the current draft until discard is explicit.

**Sources:** [PromptLibraryDialog.svelte:195-212](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L195), [296-319](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L296), [368-431](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L368), [579-588](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L579).

### 9. P1: delayed Bundle save applies its result to the current selection

The request targets A's slug, but the response handler rereads `creatingBundle` and `selectedBundleSlug`. Switching to B before A completes can replace B's list entry with A, duplicate A locally, force selection back to A, and overwrite newer fields.

**Fix direction:** capture the mutation target and revision before awaiting; update that target's list entry only, without replacing another active editor.

**Source:** [PromptLibraryDialog.svelte:218-243](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L218).

### 10. P2: several other async completions are not origin-safe

| Path | Concrete risk | Source |
| --- | --- | --- |
| Queue submit/edit | A's response updates B's queue; successful submit can clear B's draft | [message-state.svelte.ts:108-180](../../app/src/lib/components/workspace/message-state.svelte.ts#L108) |
| Stop | Response can mark B cancelling, or overwrite an already received terminal event and leave A stuck cancelling | [message-state.svelte.ts:283-295](../../app/src/lib/components/workspace/message-state.svelte.ts#L283) |
| Runtime/work mode | A's delayed result merges into B's current runtime/activity | [runtime-state.svelte.ts:29-60](../../app/src/lib/components/workspace/runtime-state.svelte.ts#L29), [session-controller.svelte.ts:61-82](../../app/src/lib/components/workspace/session-controller.svelte.ts#L61) |
| Post-load/post-settle work | A continuation after unread/list refresh can change draft, scroll, or polling for a later selection | [navigation.svelte.ts:493-519](../../app/src/lib/components/workspace/navigation.svelte.ts#L493), [message-state.svelte.ts:679-684](../../app/src/lib/components/workspace/message-state.svelte.ts#L679) |
| Workflow creation | A's result appends to the currently selected B's list/cache | [navigation.svelte.ts:536-558](../../app/src/lib/components/workspace/navigation.svelte.ts#L536) |
| Schedule history | A's response can appear beneath B's selected heading | [HermesPanel.svelte:400-405](../../app/src/lib/components/HermesPanel.svelte#L400) |

Use the existing captured-selection/generation pattern consistently; add turn identity where terminal events can supersede an HTTP acknowledgement. Do not serialize unrelated Sessions to avoid these races.

## Findings: immediate information and useful feedback

### 11. P2: mobile file loading/errors are offscreen

`FilePreview` gets its open class only from `preview || diffData`. Selecting a file clears both while loading, and an error leaves both empty. Narrow/mobile presentation therefore hides or translates the entire component, including its status and alert.

**Observed:** at both tested mobile widths the preview's left edge equaled the viewport width. This is exactly the kind of interaction that feels unresponsive: the selection changes, but neither progress nor failure appears.

**Fix direction:** open the preview for an active selection/loading/error, or render those states in the visible file pane. Apply the same rule to initial tree/artifact errors.

**Sources:** [FilePreview.svelte:107-110,163-191](../../app/src/lib/components/workbench/FilePreview.svelte#L107), [FilesPanel.svelte:179-228](../../app/src/lib/components/workbench/FilesPanel.svelte#L179), [responsive.css:150-163](../../app/src/styles/responsive.css#L150), [project-browser.css:209-225](../../app/src/styles/project-browser.css#L209).

### 12. P2: Workflow mutation has neither local progress nor local error

Workflow save/create errors route to the workspace banner outside the modal. Add/save controls lack mutation-specific locking. The browser probe produced two intercepted creates while pending, then an alert outside the dialog and none inside it.

**Fix direction:** expose pending/error state at the library form, disable repeat submission, preserve inputs on failure, and announce success only after acceptance.

**Sources:** [PromptLibraryDialog.svelte:321-339,728-803](../../app/src/lib/components/workspace/PromptLibraryDialog.svelte#L321), [navigation.svelte.ts:536-562](../../app/src/lib/components/workspace/navigation.svelte.ts#L536), [Workspace.svelte:722-727](../../app/src/lib/components/Workspace.svelte#L722).

### 13. P2: polling can be stuck behind an old Session or remain falsely reconnecting

Stopping polling clears a timer, not the in-flight request or single-flight holder. Switching from stalled A to running B makes B's polls join A's request until it settles. The API wrapper supplies no default timeout/abort.

Separately, a failed poll marks delivery reconnecting, but successful empty responses or assistant chunks do not restore running. The running event may already be behind the cursor. A reducer probe confirmed that a successful chunk leaves reconnecting unchanged.

**Fix direction:** cancel or scope each polling flight to selection identity; recover connectivity independently from turn delivery, without fabricating accepted/completed state.

**Sources:** [message-state.svelte.ts:644-692](../../app/src/lib/components/workspace/message-state.svelte.ts#L644), [workspace-state.ts:369-429](../../app/src/lib/workspace-state.ts#L369), [workspace/api.ts:5-9](../../app/src/lib/components/workspace/api.ts#L5).

### 14. P2: transcript reconstruction can duplicate or remove known information

| Case | Effect | Source |
| --- | --- | --- |
| Persisted cancelled/failed/unknown turn | Replay boundary matches only running/completed turns; harness history and local events can render the same turn twice. A cancelled-turn reducer probe rendered user/partial assistant twice. | [workspace-state.ts:266-324](../../app/src/lib/workspace-state.ts#L266) |
| Active OpenCode or failed Hermes history read | Backend intentionally returns empty harness history plus local events. Frontend replaces an already complete cached view, losing harness-only history locally. Ordinary completion does not necessarily reload detail. | [session-route-handlers.ts:81-95,140-150](../../app/src/lib/server/session-route-handlers.ts#L81), [session-state.svelte.ts:183-200](../../app/src/lib/components/workspace/session-state.svelte.ts#L183) |
| Reused tool ID across turns | Activity matches kind + ID rather than message identity, overwriting the earlier activity and retaining its old sequence. Confirmed with the reducer. | [workspace-state.ts:92-110,216-234](../../app/src/lib/workspace-state.ts#L92) |
| Terminal failure | Durable error details are not retained/displayed by the reducer; reloading a failed nonactive turn also clears the delivery label. A failed prompt can appear simply unanswered. | [workspace-state.ts:390-413](../../app/src/lib/workspace-state.ts#L390), [session-state.svelte.ts:77-83](../../app/src/lib/components/workspace/session-state.svelte.ts#L77) |

Preserve known history when an incoming snapshot is partial, reconcile using turn identities, and expose persisted failure reasons with an appropriate recovery action. Do not replay OpenCode into an active turn or relax harness transcript ownership.

### 15. P2: queued attachment editing and Send now are misleading

- Text editing a queued message with both images and generic files enters preserve-attachments mode, but the endpoint passes an empty images array.
- Adding a file while editing metadata-only queued attachments filters out all existing byte-less entries, silently replacing rather than augmenting retained files.
- A preserved attachment-only edit can fail the endpoint's content-required check because it checks newly supplied content rather than retained attachments.
- Every row's Send now calls the same cancellation action without a selected message ID. Clicking the second row does not advance that specific message ahead of the first.

**Sources:** [message-state.svelte.ts:156-192,612-619](../../app/src/lib/components/workspace/message-state.svelte.ts#L156), [session-route-handlers.ts:432-458](../../app/src/lib/server/session-route-handlers.ts#L432), [Composer.svelte:487-491](../../app/src/lib/components/workspace/Composer.svelte#L487).

### 16. P2: file refresh/search can cancel selection without resolving its busy state

Tree completion invokes `checkSelected()` through the same request controller as preview selection. It can abort a new selection whose preview is still empty; its own response then does not populate that empty preview, while the superseded selection cannot clear busy. Tree/search responses also lack their own generation check and may overwrite newer results.

**Fix direction:** separate passive version checks from active selection lifecycle, and ignore stale tree/search results. Add delayed refresh-then-select and reversed-search-response tests.

**Sources:** [FilesPanel.svelte:135-170,179-228,255-258](../../app/src/lib/components/workbench/FilesPanel.svelte#L135), [file-preview-requests.ts:15-43](../../app/src/lib/components/workbench/file-preview-requests.ts#L15).

### 17. P2: stale Project metadata can disagree with mounted tools

Project list refresh and folder mutations have separate generations, while name/color/icon/group saves bypass that shared ordering. An older readback can revert a newer visible value; shared saving state can settle before all requests do. List refresh does not also refresh the selected Project object.

A primary-folder change replaces Project metadata but does not remount tools keyed only by Project ID. Files/Git can still show the old folder's snapshot while later Project-ID-based requests use the new root. Retained terminals remain in their existing directory, without a corresponding context transition.

**Fix direction:** origin/revision-safe authoritative readbacks; explicitly invalidate root-dependent tool state and label or recreate terminals on root changes. Preserve dirty-file protection.

**Sources:** [project-management.svelte.ts:297-368,411-474,535-578](../../app/src/lib/components/workspace/project-management.svelte.ts#L297), [Workspace.svelte:734-745,812-860](../../app/src/lib/components/Workspace.svelte#L734), [TerminalPanel.svelte:269-285](../../app/src/lib/components/workbench/TerminalPanel.svelte#L269).

### 18. P2: Git persistence collides; terminal tab restoration has separate races

The outer Git dock and inner Git status section both write `hue:project-tools:<projectId>:git-open`. Collapsing the inner section causes reload to close the entire dock. The existing restoration browser test failed in both the full run and isolated repeat.

**Sources:** [panel-state.ts:13-36](../../app/src/lib/components/workspace/panel-state.ts#L13), [repository-layout.ts:10-44](../../app/src/lib/components/workbench/repository-layout.ts#L10).

Terminal selection separately leaves old polls in flight. A-to-B-to-A can accept multiple responses for A using only tab identity, duplicating output or regressing its cursor. Closing an active tab resets the renderer for the next retained tab without resetting that tab's cursor, so prior output is not replayed.

**Source:** [TerminalPanel.svelte:139-159,214-249](../../app/src/lib/components/workbench/TerminalPanel.svelte#L139).

### 19. P2: supporting surfaces conceal freshness and failures

| Surface | Problem | Source |
| --- | --- | --- |
| Artifacts | No explicit loading or empty state; old results remain during refresh; failures use a potentially hidden preview error channel | [FilesPanel.svelte:370-378,580-596](../../app/src/lib/components/workbench/FilesPanel.svelte#L370) |
| Dev servers | Discovery errors erase the previous list and become indistinguishable from no servers found | [BrowserPanel.svelte:187-197](../../app/src/lib/components/workbench/BrowserPanel.svelte#L187) |
| Browser clean reload | Ordinary web UI can enable a control that only reports desktop support is required | [BrowserPanel.svelte:288-300,517-523](../../app/src/lib/components/workbench/BrowserPanel.svelte#L288) |
| Git badge/status | External agent/terminal changes do not reliably refresh retained snapshots or the closed rail count | [ProjectWorkbench.svelte:111-117,195-207](../../app/src/lib/components/ProjectWorkbench.svelte#L111), [RepositoryPanels.svelte:244-254](../../app/src/lib/components/workbench/RepositoryPanels.svelte#L244) |
| Health | One-time snapshot has no refresh control; Preview becomes ready from a saved URL, not successful loading | [HealthStrip.svelte:34-98](../../app/src/lib/components/workbench/HealthStrip.svelte#L34) |
| Administration actions | Parent loading does not lock child action controls; repeated Run now allocates distinct run IDs | [HermesPanel.svelte:297-325,435-440](../../app/src/lib/components/HermesPanel.svelte#L297), [SchedulesView.svelte:223-260](../../app/src/lib/components/hermes/SchedulesView.svelte#L223) |
| Excalidraw | Debounced exit flush uses an ordinary fetch; page termination can lose the final write. Conflict leaves a stale version and no reload/reconcile/export recovery UI | [ExcalidrawBrowserCanvas.tsx:73-86,161-190](../../app/src/lib/components/workbench/ExcalidrawBrowserCanvas.tsx#L73), [ExcalidrawPanel.svelte:32-45,82-120](../../app/src/lib/components/workbench/ExcalidrawPanel.svelte#L32) |

Correction to an initial review hypothesis: **dev-server discovery does run automatically** for an active empty tab in the current code. The defect retained here is failure handling, not an absent initial search.

## Findings: latency and resource use

### 20. P1: synchronous subprocesses block unrelated features

Repository request paths perform synchronous discovery, Git commands, and GitHub CLI operations. GitHub issue and PR calls each allow 10 seconds; mutation commands allow up to 15 seconds, and push up to 60 seconds. Those are configured maximum waits, not measured durations. During a synchronous subprocess, the shared JS event loop cannot process unrelated polls, cancellation, or ACP output callbacks.

Repository mutations also compute fresh status in the service and then recompute it in the route. Dev-server discovery uses synchronous listener enumeration as another shared blocker.

**Fix direction:** use asynchronous subprocess APIs with existing deadlines/path validation/output bounds; reuse mutation readback; avoid rediscovering repositories on every status request. No new queue or dependency is needed just to move process waiting off the event loop.

**Sources:** [services.ts:461-500,527-570,751-839](../../app/src/lib/server/services.ts#L461), [repository/+server.ts:90-154](../../app/src/routes/api/projects/[projectId]/repository/+server.ts#L90), [dev-servers.ts:65-85](../../app/src/lib/server/dev-servers.ts#L65).

### 21. P1: ACP startup exposes a connection before it is initialized

`open()` assigns `this.connection` before awaiting initialization. A concurrent `start()` checks that connection before checking `this.starting`, returning before capability negotiation has completed. Concurrent list/runtime/create calls can see missing capabilities or send premature requests. Hermes and OpenCode share this implementation.

**Fix direction:** await the existing startup promise before accepting connection readiness. Add a delayed-initialize concurrency test and bounded control-operation deadlines; do not impose a short deadline on legitimate agent prompts.

**Sources:** [hermes-acp.ts:416-429,449-491](../../app/src/lib/server/hermes-acp.ts#L416), [opencode-acp.ts:31-41](../../app/src/lib/server/opencode-acp.ts#L31).

### 22. P2: initial display and Session pagination wait for too much upstream work

The document's server load awaits Project listing/reconciliation. A Project outage also replaces locally available Chat counts with zero. Notification responses similarly wait for Project enrichment after reading local notification data.

Session-list handlers perform full root/harness discovery and recovery before applying local page limits. Subsequent pages repeat discovery. Hermes and optional OpenCode are enumerated serially per root. The frontend collects all pages before assigning the resulting list; Project cached lists help, but do not remove authoritative repeated work or the projectless gap.

Deep-linked detail is requested after resolving the target Session through list lookup. The measured reload showed the resulting serial waterfall even for a small conversation.

**Fix direction:** serve trustworthy local counts/delivery/list data promptly with explicit reconciliation state; reconcile once per refresh rather than once per page; show pages as available; avoid blocking already-known Session detail on unrelated discovery. Keep Hermes authoritative for Project identity and mutations.

**Sources:** [+page.server.ts:5-25](../../app/src/routes/+page.server.ts#L5), [notifications/+server.ts:29-42](../../app/src/routes/api/notifications/+server.ts#L29), [Project sessions/+server.ts:113-146](../../app/src/routes/api/projects/[projectId]/sessions/+server.ts#L113), [sessions/+server.ts:66-108](../../app/src/routes/api/sessions/+server.ts#L66), [navigation.svelte.ts:275-326](../../app/src/lib/components/workspace/navigation.svelte.ts#L275).

### 23. P2: every Project event poll depends on live administration

The 650ms event poll resolves `projects.get` before reading HUE's local durable event log. With quick responses that is approximately 92 Project RPCs/minute per active polling controller. A slow admin request delays already available information; an admin outage prevents replay and is reported through the generic 404 scope path. Full runtime inventories can also be returned repeatedly.

**Fix direction:** use validated persisted Session/Project association for local replay where permitted, while preserving canonical scope and archive/access policy. Distinguish outage from not-found. Measure runtime payload cost before introducing change/version responses.

**Sources:** [session-route-handlers.ts:24-36,531-539](../../app/src/lib/server/session-route-handlers.ts#L24), [services.ts:266-270](../../app/src/lib/server/services.ts#L266), [hermes-projects-rpc.ts:37-49](../../app/src/lib/server/hermes-projects-rpc.ts#L37), [message-state.svelte.ts:644-684](../../app/src/lib/components/workspace/message-state.svelte.ts#L644).

### 24. P2: full-history work makes long conversations increasingly expensive

- Session detail reads all HUE messages/events before compaction. Message hydration performs per-message attachment queries and synchronous stored-image reads/base64 encoding.
- Hermes history fetches sequential 500-message pages, oldest first, and waits for all of them before returning any browser transcript.
- The complete conversation is rendered. Skill attribution scans the timeline per message; event application scans/copies history; streamed text is reparsed, highlighted, sanitized, and replaced as HTML.
- A MutationObserver rescans conversation DOM for enhanced code/table/Mermaid output. A growing Mermaid block can trigger repeated diagram work.
- Each visited complete Session view remains reachable in an unbounded controller-lifetime map, including image-heavy histories.

**Fix direction:** first profile representative long sessions, then bound initial history, batch attachment metadata, fetch image bytes on demand, avoid repeated unchanged-history work, and bound retained views. Do not introduce a virtualization framework, worker architecture, or broad cache without measuring the actual bottleneck.

**Sources:** [hermes-serve.ts:223-279](../../app/src/lib/server/hermes-serve.ts#L223), [store.ts:3035-3050,3270-3318,3417-3522](../../app/src/lib/server/store.ts#L3035), [Conversation.svelte:140,198-303,356-440](../../app/src/lib/components/workspace/Conversation.svelte#L140), [thinking-state.ts:10-20](../../app/src/lib/components/workspace/thinking-state.ts#L10), [message-markdown.ts:34-55](../../app/src/lib/message-markdown.ts#L34), [session-state.svelte.ts:43,114-170](../../app/src/lib/components/workspace/session-state.svelte.ts#L43).

### 25. P2: attachment rejection happens after expensive file reading

FileReader materializes full base64 before validation decodes/checks size and content. Large unsupported files therefore consume memory and time unnecessarily. Aggregate staging limits are not checked at intake, and there is no reading state preventing send before the chosen file appears.

**Fix direction:** preflight `File.size` and obviously unsupported types, retain signature validation afterward, check aggregate staged limits, and show pending intake state with selection-safe completion.

**Sources:** [attachment-files.ts:7-38](../../app/src/lib/components/workspace/attachment-files.ts#L7), [message-content.ts:198-243](../../app/src/lib/message-content.ts#L198), [message-state.svelte.ts:612-624](../../app/src/lib/components/workspace/message-state.svelte.ts#L612).

### 26. P2: status queries repeatedly derive current state from historical data

Indicators join messages to JSON event payloads, then group/window historical lifecycle data. The work repeats per Project, during notification refresh, and across a whole scope even when requesting a single Session or page. Search similarly scans text/event content despite bounded output counts.

**Fix direction:** measure query plans on synthetic representative history; restrict calculation to requested Session IDs and optimize the shared lifecycle lookup/index first. Do not remove historical ordering semantics or add a speculative second source of truth.

**Sources:** [store.ts:3168-3266](../../app/src/lib/server/store.ts#L3168), [1842-1904](../../app/src/lib/server/store.ts#L1842), [services.ts:244-262](../../app/src/lib/server/services.ts#L244).

### 27. P2: scheduling has synchronous and failure-loop risks

Cron occurrence calculation walks civil minutes synchronously, up to 2,635,200 candidates. An isolated, single-run Bun probe from 2026-01-01 UTC observed approximately 10ms for a daily expression, 113ms for next New Year, and 440ms for impossible February 31. These are illustrative local measurements, not stable benchmarks.

If processing a due schedule throws before advancing it, the scheduler can immediately rearm the same overdue item with zero delay, repeatedly consuming CPU/logging and starving later due work. Rearming also hydrates all schedules just to find the earliest timestamp.

**Fix direction:** skip unmatched calendar fields while preserving DST behavior, isolate per-schedule failure/backoff, and query the earliest enabled timestamp directly.

**Sources:** [cron.ts:91-116](../../app/src/lib/server/cron.ts#L91), [schedule-service.ts:165-216](../../app/src/lib/server/schedule-service.ts#L165), [store.ts:2861-2876](../../app/src/lib/server/store.ts#L2861).

### 28. P2: external cron discovery can remain stale or miss runs

History requests fan out through unbounded `Promise.all`; one failed job rejects the whole pass before recording histories. Each job reads only its latest 100 runs, with no catch-up pagination. Opening the Cron collection fetches inventory but not the histories/unread projection promised by the surface-open contract. The normal 30-minute background interval is intentional; these additional gaps are not.

**Fix direction:** refresh projections on surface open, bound concurrency, isolate per-job failures, and page toward the last observed run if the upstream API supports it.

**Sources:** [external-cron-service.ts:27-109](../../app/src/lib/server/external-cron-service.ts#L27), [external-hermes-cron.ts:55-114](../../app/src/lib/server/external-hermes-cron.ts#L55), [sessions/+server.ts:90-100](../../app/src/routes/api/sessions/+server.ts#L90), [ADR-0010](../decisions/0010-hermes-schedules-and-dedicated-sessions.md).

### 29. P2: additional independent work is unnecessarily coupled

| Area | Risk | Smallest direction / source |
| --- | --- | --- |
| Runtime diagnostics | Health/status/logs/update-check share one awaited group; update-check failure hides otherwise useful information. Integrity checks run synchronously. | Separate optional detail from basic health. [hermes-admin.ts:135-147](../../app/src/lib/server/hermes-admin.ts#L135), [runtime-reliability.ts:37-59](../../app/src/lib/server/runtime-reliability.ts#L37) |
| Web Push | Sequential endpoint delivery has no explicit HUE transport timeout; one slow endpoint delays later notifications. TTL is not a socket timeout. | Add a real deadline before considering bounded concurrency. [notifications.ts:196-270](../../app/src/lib/server/notifications.ts#L196) |
| Development service replacement | Failed `instanceof` replaces the aggregate without retiring prior resources; qualifying hot reload can retain timers/children/DB handles and confuse recovery. Exact Vite invalidation behavior was not reproduced. | Explicit orderly retirement. [services.ts:136-159](../../app/src/lib/server/services.ts#L136) |
| Schedule Run now | Reads old full detail/history before accepting the run | Return accepted run plus lightweight metadata. [admin/+server.ts:61-65](../../app/src/routes/api/hermes/admin/+server.ts#L61) |
| Workflow update | Loads every Workflow prompt to find one target | Query the target directly. [store.ts:2366-2412](../../app/src/lib/server/store.ts#L2366) |

## Verification results

| Gate | Result |
| --- | --- |
| `bun test` | 792 passed, 5 skipped, 0 failed; 2,688 assertions across 147 files |
| `bun run --cwd app check` | 0 errors, 0 warnings |
| `bun run --cwd app test:e2e` | 92 passed, 9 failed out of 101; approximately 4.1 minutes |
| Production build inside Playwright | Succeeded; emitted a >500kB chunk warning, not independently proof of a loading regression |
| Focused repeat of Session-pane and Git restoration tests | Same three tests failed again |
| Isolated message-state probes | Confirmed draft loss, duplicate queued requests/rows, and storage-failure recovery interruption |
| Isolated reducer probes | Confirmed duplicate cancelled turn, reused activity-ID overwrite, and reconnect label persistence |

The Playwright configuration uses port 44014, an isolated home/database, dummy credentials, and blocked provider-network proxy settings. Normal successful UI tests do not cover most delayed-ack, out-of-order, partial-history, or storage-failure cases found here.

### Browser failure triage

| Test in `app/src/routes/workspace.e2e.ts` | Assessment |
| --- | --- |
| 301: unavailable Session read-only | Snapshot is projectless, not the intended Project. Likely `addProject()` hydration/selection setup race; not established as an unavailable-Session product bug. |
| 539: independent Session panes | Post-reload persisted count is two but docked article never becomes visible. Reproduced twice. Reconciliation/readiness is the failure stage; underlying cause remains unresolved. |
| 752: stale persisted Session panes | Count stays two before reconciliation; no evidence stale articles rendered. Reproduced twice. Root cause remains unresolved. |
| 1223: Git sizes/collapsed sections | Confirmed outer/inner `git-open` storage-key collision; reproduced twice. |
| 1291: preview element selection | Old `Browser view` wrapper locator; test fails before reaching element selection. |
| 1428: responsive files | Expects opening Files to close Browser, contrary to current independent-panel behavior. |
| 1972: Preview health | Snapshot is projectless, so Project health is not mounted. Likely shared setup race; not proof Preview rendering broke. |
| 8327: Project tools | Searches for Browser selector inside Browser article; selector now belongs to Project tools navigation. |
| 8902: retained tools | Searches for Excalidraw inside Browser article; they are now sibling docks. |

The pane grid restores counts before it renders validated docked Sessions; rendering/pruning is gated by `sessionListLoaded` and `reconciledProjectId`. Relevant sources: [SessionPaneGrid.svelte:94-147,322-326](../../app/src/lib/components/workspace/SessionPaneGrid.svelte#L94), [Workspace.svelte:674-675](../../app/src/lib/components/Workspace.svelte#L674). The existing fixtures accept query parameters, so blaming these two failures on a missing cached-query mock would be unsupported.

The shared setup concern is [workspace.e2e.ts:249-274](../../app/src/routes/workspace.e2e.ts#L249): a one-time Project `aria-current` read can precede mount-time restored projectless navigation. Synchronize fixture setup with final hydrated selection before judging those downstream assertions.

## Coverage and limits

| Feature area | Checked | Still not verified by this audit |
| --- | --- | --- |
| Projects/navigation | Source, authoritative-folder decisions, finder, responsive shell, automated metadata/archive/recovery tests | Actual destructive archive/delete; native folder dialogs; large inventories |
| Sessions | Selection/cache/detail/replay source; loaded OpenCode conversation; isolated send/reducer probes; automated Hermes/OpenCode choice, send, retry, permissions, voice, context, backgrounds and mobile flows | Live provider generation; real permission approval; large streaming benchmarks; exact root cause of two restoration failures |
| Workflows/Bundles | Catalog/editor source; dirty dismissal; synthetic duplicate/failure create; automated happy paths | Real mutations, native Hermes bundle execution and provider response |
| Files/artifacts | Real tree/read preview, simulated loading/outage, empty artifacts, source save/search races, endpoint tests | Actual file mutation; large upload memory profile |
| Git/worktrees/GitHub | Source request/mutation flow; browser-suite coverage and failure triage | Real push/commit/worktree mutation; measured long hook/network stalls |
| Terminal | Source tab/cursor/lifecycle audit; automated typing/lifecycle tests passed | Real long-lived interactive terminal soak and output-race reproduction |
| Browser/Excalidraw | Responsive tool entry, local-server discovery, source persistence/capability review, old locator failures identified | Native Electrobun child previews; actual canvas exit durability; stop-server mutation; platform-specific rendering |
| Hermes administration | Opened Runtime, Memory, Skills, Schedules, Commands, Profiles, MCP, Models; source and automated coverage | Provider/config changes, scheduled execution, credential setup, real backups/restarts |
| Notifications/PWA | Source and complete automated suites; finder focus checked manually | Real Push delivery, installed PWA/offline behavior, Android hardware |
| Accessibility/performance | Required CSS viewport matrix; visible core mobile target sizes; finder focus; local reload/resource timing | Screen-reader session, actual mobile keyboard/safe-area hardware, production p95/INP, CPU-throttled long-session traces, sustained heap growth |

This is a comprehensive feature-surface review, not a claim that every native platform and destructive action was exercised. No graph artifact was available; implementation evidence was traced directly. Screenshots and this report are the only audit deliverables added to the worktree; generated test output remains uncommitted.

## Recommended sequence

1. **Protect work:** draft revision checks, queue identity/recovery, storage-failure handling, selection-safe async completions, dirty guards, correct repository target binding.
2. **Make feedback truthful:** visible mobile file states, modal-local mutation feedback, accurate reconnect/failure state, explicit artifact emptiness, stable cached history during partial refresh.
3. **Remove avoidable waiting:** asynchronous subprocesses, ready-only ACP startup, local replay independent of admin round-trips, discovery once per refresh, early useful Session data.
4. **Repair persistence and verification:** separate Git keys, diagnose pane reconciliation, update obsolete test locators without weakening assertions, add delayed/out-of-order/quota tests.
5. **Measure scale before redesign:** long transcript open/stream, large attachment rejection, many visited Sessions, historical status queries, and slow background integration behavior.

Proposed acceptance criteria, not current performance claims: acknowledge a local interaction within 100ms; preserve all newer edits during delayed responses; display cached content immediately without regressing it to empty; show loading/error at the point of interaction; keep unrelated requests responsive while Git waits; preserve exactly-once message identity across retries. Establish production latency and responsiveness budgets using repeatable representative fixtures before choosing broader performance architecture.
