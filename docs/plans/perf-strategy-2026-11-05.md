# The board's load path: a strategy memo (2026-11-05)

Perf-lane Phase 2, from the measurements in `docs/plans/perf-baseline-2026-11-05.md`
(the load bench: `npm run perf:load`, six cells, three-run stable). This memo
ranks the load path's costs with the numbers measured on the harness, names
each candidate improvement's mechanism, its win, its side-effect risk, and
how the suite catches a wrong ship, then proposes the child-commission
queue. Law for every item: **behavior must not change** — the 2949-test
suite, the UAT battery, and the before/after bench runs are the proof.

## The load path's costs, ranked by the baseline

Costs are in the modeled profile (the harness numbers carry the knobs'
meanings: 8ms bridge round trip, 1.5ms per-thread metadata hop, 200ms
modeled sidebar fetch) and the client profile (pure client cost).

| Rank | Cost | Evidence (baseline) | Who pays it |
|---|---|---|---|
| 1 | The serial per-thread metadata scans inside the four `*_list` server handlers (`link_list`, `pin_parks_list`, `error_acks_list`, `snooze_list` — each `bb.sdk.threads.list({})` then one awaited `threads.getPluginMetadata` hop per row; `done_list` hops per done id via its index) | modeled `fanInWindow` 368→677→1076ms at 100→300→500 cards; the four scans are modeled at N×1.5ms each, all parallel-issued, and the board render contends with them | server (bb's plugin process) at every board open and every mounted panel |
| 2 | The post-paint mutation churn: after the board's cards are in the DOM, the page keeps mutating for ~400-513ms (client profile `settleTail`; modeled profile's negative numbers say the modeled fan-in's tail changes nothing visible, so this churn is the client profile's own) | client `settleTail` 400 / 443 / 513ms at the three scales | client, after first paint — the operator sees a board that "looks loaded" but keeps repainting |
| 3 | The board's first commit + card DOM, ~linear in cards | client `firstCommit`/`firstCard` 186-303ms across scales; TBT 80-300ms; one commit renders every card (no staged render) | client, before first paint |
| 4 | The bridge round trips themselves and the duplicated `threads.list({})` scans (five list handlers × one full host scan each) | the modeled profile's `rpcLatency=8` knob: the ten parallel round trips overlap, so their wall is ~one trip; the scans are Rank 1's shape | server + bridge |
| 5 | Module graph evaluation | client `appEval` 53-117ms | client, once per bb panel opening |

The mounted RPC names and their refetch shapes (from `app.tsx`'s mount
effects, lines ~503-910): the nine lists + `pulse_rates` fire in parallel
immediately at mount (measured: all ten issue inside one commit, client
`fanInWindow` 11-29ms); the chip hooks' `tracker_validate`/`tracker_status`
ride a later effect and are excluded from the fan-in on purpose.

## The queue (child commissions, in order)

### 1. Parallelize the four list handlers' per-thread scans (server.ts)

- **Target**: Rank 1. Modeled `fanInWindow` 1076 → ~150-250ms at 500 cards
  (the scan model in `modeledScanDelayMs` moves to the PARALLEL shape: N ×
  1.5ms / 16 concurrent hops, one handler's modeled wall ≈ 8 + 47ms at 500).
- **Mechanism**: the four handlers' `for` loops await one read per row,
  serially; the reads are independent. Fan them out over a bounded
  concurrency (e.g. 16 at a time through `Promise.all` over chunks) — the
  same reads, the same results, the same order-independent maps. The done
  index's walk (per done id) takes the same shape; done ids are a small set.
- **Expected win**: the fan-in's dominant term collapses; the board's first
  usable paint stops waiting on thousands of serial hops (the modeled
  picture: 1076 → ~150 at 500).
- **Side-effect risk + proof**: reads only, no writes, no ordering
  dependence in the assembled maps (each handler folds its records into a
  Record keyed by id). The host-side concurrency is bounded so a 5000-thread
  workspace cannot stampede. Proof: the `*_rpc.test.ts` and list-handler
  tests must stay green byte-for-byte (they cover record shapes and
  refusals), the board-kv-concurrent guarantees hold, and the child updates
  `modeledScanDelayMs` to the landed shape in the same PR with the modeled
  before/after from the bench (`--assert` budget for `fanInWindow` in the
  modeled profile lowered in the same PR).
- **Suite catch**: the modeled budget (lowered), the structural fan-in
  check, and the four handlers' own RPC tests catching any fold change.

### 2. Attribute the post-paint churn, then idle-gate its biggest drivers (client)

- **Target**: Rank 2 (400-500ms of post-paint mutation). The memo does NOT
  name the drivers yet — no measured attribution exists; measuring first is
  the child's first deliverable (the load-probe pattern: a trace of which
  effects setState after the fan-in settles — pulse poll, chip poll, what's
  new, wallpaper, dot gate…).
- **Mechanism (candidate)**: the effects that re-render without operator
  benefit at load (first-frame polls whose results are decoration) move from
  "fire at mount" to "fire at idle" (`requestIdleCallback` fallback timeout),
  preserving their cadence and their failure laws; anything that can change
  a card's visible state before first paint stays put.
- **Expected win**: `settleTail` toward ~0 at load; the board's load-window
  main thread stops churning after paint.
- **Side-effect risk + proof**: the risk is a behavior change by timing — a
  poll that fired at t+300ms now fires at idle; user-visible if an operator
  watches a chip dot settle. The child must keep ALL the visible state
  landing before the operator can gesture (idle is typically <1s after
  load) and keep the polls' catch-up paths (visibility/focus) intact —
  their unit tests exist (`use-pulse-rates`, `use-ticket-statuses`) and
  stay green. UAT's pulse/chip suites are the neighbor proof.
- **Suite catch**: the `settleTail` budget lowered under the measured
  before/after; the pulse/chip suites prove the state still lands.

### 3. One aggregate mount read (`board_state_get`) for the nine mount lists

- **RULING (2026-11-05, Child C's PR #381): measured, DROPPED — not adopted.**
  Child C landed the aggregate exactly as specced (server composing the same
  zod payloads from one shared scan and one namespace read per thread via
  `readBounded`; the client mount issuing one call dispatching today's
  setters; the refused-aggregate fallback to the exact nine per-list calls;
  all gates green, 2965 tests on its head efc21fe+16). The modeled fan-in
  moved 53.0/77.5 → 53.0/77.0 (Δ ≤ 1ms, inside the profile's 1.6-3.7ms
  run-to-run spread) — inside noise, the memo's own pre-committed drop
  condition. The arithmetic is settled: with Child A's bounded parallel
  walk, the modeled window was already one walk's wall, and the aggregate's
  shared walk costs the same wall. What the aggregate wins beyond the model
  — five `threads.list` scans → one, ten bridge trips → two, and up to nine
  setState arrivals → one batch (already batched by React) — is real on a
  production host but below this harness's resolution and the modeled knobs
  price none of it. The complexity it buys that win with (a new RPC, the
  mount restructure, the fallback path) fails the evidence bar the memo set:
  the queue follows measurements, not its own earlier guesses. PR #381 and
  its evidence stay as the documented record; the single-scan win remains
  available if the operator ever wants a live-bb measurement of it (outside
  this lane's synthetic mandate).
- **Mechanism**: `server.ts` gains `board_state_get` returning each list's
  existing payload (same zod shapes, composed); the mount effect calls it
  once and dispatches the same setState setters; the SIGNAL-path refetch
  units (`refetchDoneState` etc.) stay byte-identical — signals keep
  refetching exactly the state that changed, coalescing unchanged.
- **Failure shape** (as specced then): fail the whole read loud, degrade to
  the per-list mount calls on a refused aggregate (an old host serving a
  half build must not hard-fail the mount — the aggregate stays
  optional-state by fallback).
- **Suite catch** (as specced): the mount-fan-in RPC-name updates, stage
  budgets, and the app tests' fake-sdk mount behavior.

### 4. The board's first-commit/cost-per-card (Rank 3) — DEFERRED, with reasons

The cost is ~linear (~0.5ms/card) and one commit renders everything; the
candidate fixes (progressive/deferred rendering, virtualization) each
change when things paint — a behavior surface the suites watch (attention
freeze captures, keep-in-view, pan/scroll geometry all measured against
the rendered DOM). The pane-perf precedents (#310/#312) bought 100ms+ wins
in interaction with surgical CSS/JS removals; the load commit's win at 300
cards (~184ms) is real but the smallest-risk-per-win of the ranked items
so far. The memo keeps it parked with its evidence; a child may claim it
ONLY with a design that the attention-freeze and keep-in-view suites prove
byte-identical.

## What the suite guards meanwhile

- Stage budgets (generous, recalibrated per merge) and the structural
  fan-in check ride every `--assert` run.
- The fixture is deterministic; the bench aborts on any completeness or
  determinism violation loud.
- Every child PR carries: gates green (`test`/`typecheck`/`build`/`gates`),
  `perf:load` before/after on the SAME tree, the UAT neighbor suites
  relevant to its surface, a changelog bullet when user-visible (a pure
  read-shape change is not, its PR says so under the template), and the
  board link.

## The re-baseline law

Every orchestrator merge re-baselines before a child's numbers are credited
or debited (Phase 1's law, restated): the lane runs `perf:load` on the new
dev, updates the baseline doc's delta table, THEN spawns the reviewer
against the child's claimed numbers.
