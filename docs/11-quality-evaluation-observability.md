# Quality, evaluation and observability

> **Product status:** `TBI`
> **Open choices:** `TBD-008` routing evaluation strategy, `TBD-021` telemetry/evaluation sharing.

## Quality model

HUE quality has six independent dimensions:

1. **Outcome correctness** — did the requested result occur?
2. **Process integrity** — were policy, scope and approvals respected?
3. **Evidence integrity** — do artifacts prove the claims?
4. **User comprehension** — can the user understand and steer the work?
5. **Efficiency** — were cost, latency and attention reasonable?
6. **Recoverability** — can interruption be reconciled without unsafe duplication?

A fast, inexpensive wrong result is not a successful route.

## Verification pyramid — `TBI`

```text
             User acceptance / real outcome
          Independent review or scenario replay
       Integration and runtime-adapter contract tests
    Service/state-machine/security and policy tests
Deterministic unit tests, schema tests and static checks
```

## Product acceptance suites — `TBI`

### Project isolation suite

- correct workspace inheritance;
- no unrelated memory/context source;
- path/symlink escape denied;
- project move/branch consequences explicit;
- export/import round trip.

### Durable run suite

- restart during each task state;
- ownership lease expiration;
- duplicate completion event;
- unknown external side effect;
- pause/resume/cancel semantics;
- recovery after adapter loss.

### Routing suite

- trivial request remains single-agent/direct;
- complex coding routes to coding capability;
- privacy policy excludes prohibited provider;
- explicit user override wins;
- degraded provider falls back safely;
- independent review uses configured independence constraint;
- bad route configuration fails closed or to approved primary.

### Tool/approval suite

- least-scope grant;
- expired/replayed approval denied;
- network/domain restriction;
- destructive command gate;
- browser prompt injection;
- secret redaction across success and error;
- computer-use unexpected UI and takeover.

### UI comprehension suite

Representative users should correctly answer:

- What is HUE doing now?
- Which project and resources are active?
- What needs approval and why?
- Did the requested outcome succeed and how was it proven?
- How do I stop or steer it?

## Route evaluation — `TBI`

HUE should improve route policies from explicit evaluation data, not anecdote. Record privacy-safe per-run metrics:

- task class/capability request;
- selected route and fallbacks;
- success/verification result;
- number and kind of retries;
- latency to first meaningful progress and completion;
- token/cost usage;
- user intervention/correction;
- reviewer findings;
- failure category.

No prompt/content is shared externally by default.

### Evaluation methods

- curated golden tasks per capability;
- replay with frozen project fixtures;
- pairwise route comparison;
- model/provider health checks;
- adversarial security fixtures;
- real-use opt-in outcome ratings;
- regression thresholds before changing defaults.

**TBD-008:** Select the scoring framework and how local evaluations influence global defaults without leaking private data.

## Observability — `TBI`

### User-facing

- semantic task/step/worker state;
- evidence and artifacts;
- cost/time budget;
- route explanation;
- provider/runtime health;
- recovery actions.

### Operator-facing

- structured logs with correlation/causation IDs;
- traces across control plane, adapters and tools;
- metrics for queue depth, event lag, heartbeats, retries and failures;
- local diagnostics bundle with redaction preview;
- adapter raw logs kept separate from semantic truth;
- storage/index/backups health.

## Service objectives — initial targets (`TBI`, values provisional)

- Local shell opens to usable project list within 2 seconds on reference hardware.
- Existing conversation switches within 500 ms excluding deferred large artifacts.
- UI reflects accepted semantic events within 250 ms locally.
- Pause/cancel acknowledgment within 2 seconds where runtime supports it.
- No acknowledged run event lost after durable commit.
- Recovery inventory available after restart within 5 seconds.

Exact performance budgets become binding only after `TBD-002` and reference hardware are decided.

## Evidence bundles — `TBI`

Every completed task produces an outcome bundle:

```text
Outcome summary
Plan revision used
Effective policy and route summary
Changed external objects/files
Artifacts
Verification checks and results
Approvals and grants
Known limitations/open risks
Cost/latency summary
Links to detailed events
```

Bundles are exportable and renderable without access to raw chain-of-thought.

## Definition of done for an implementation issue

- acceptance criteria mapped to tests/probes;
- targeted automated tests pass;
- impacted state transitions covered;
- security/privacy effects reviewed;
- UI changes include screenshots/recording and accessibility checks;
- docs/status updated from TBI only for the implemented scope;
- no unrelated section is relabeled;
- real output read back where side effects exist;
- rollback/migration path documented when data changes.

## Dogfooding

HUE should build HUE as soon as foundational execution is trustworthy. Dogfood tasks must use the same durable runs, approvals, artifacts and verification as user projects; hidden developer-only shortcuts should not become the only reliable path.
