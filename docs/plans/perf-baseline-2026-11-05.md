# Board load-time baseline (2026-11-05)

Commissioned by the Focus Board orchestrator (thr_maufmdmr5q): "the board is
sluggish, especially at load." This document is the load-time lane's measured
baseline — the harness that produced it, the numbers, and the commands to
reproduce. The strategy memo follows it in
(`docs/plans/perf-strategy-2026-11-05.md`), and this doc's delta table at the
end records every re-baseline the lane takes (per the law: after every
orchestrator merge, before crediting or debiting any child's change).

## Re-baseline delta table (the living section)

Each row is one orchestrator merge, the lane's full-battery run on the new
head, and what moved. Cell format: `median [min/max]` ms; the reference
numbers beside each row are the previous row's cell state.

| Head | What landed | Modeled fan-in ∆ | Notable stage moves | Evidence |
|---|---|---|---|---|
| 391a2c0 (base) | Phase 1 merged (tooling only) | `100/300/500 = 421/692/1077` | none — matches the pre-merge series | `load-bench-2026-11-05T03-39-33-858Z.json` |
| 3a67cbe + #376 at 4b4c5ac | **Child A PR #377**: the four `*_list` handlers + done walk parallelized (`readBounded`, cap 16, server.ts); the harness model + budgets moved to the parallel shape in the same PR. #376 (button placement, another lane) merged alongside — its client-side surface shows no move above noise | **28/52/77** (modeled fan-in collapsed 15x at 500; credited to Child A: the same head's client profile moved within noise, #376 touches no load stage) | client profile unchanged within noise (firstCard 189/269/312 vs 186-303 band; settleTail 397/435/499 vs 397-513 band); modeled `mountToFirstCard` drifted down 112/181/231 (the fan-in's scans no longer contend with the board render) | `load-bench-2026-11-05T04-16-00-974Z.json` |
| f44d6bb, measured on Child B's PR head efc21fe (f44d6bb + #380's Gate C) | **#379 (pane cleanup, another lane)** merged into dev here: `firstCommit`/`mountToFirstCard`/`settleTail` all drop ~10-15% across scales vs the row above — **credited to #379** (its cleanup removed load work; Child B's Gate C touch is post-fence only). **Child B PR #380 Gate C**: the chips' first status/validation fetches ride the idle seam — the chips now fire at idle and land right behind (validate +115..+324, status +129..+392 by scale; the ceiling never fired in real Chrome) | unchanged (52/77 on B's head; the fan-in is A's territory) | client stages at 171/217/273 `firstCommit` at 100/300/500 (the #379 drop); the bench's settleTail holds its band (396/427/488) — Gate C removed the load-window chip churn; the tail's END stays Gate T's 320ms transport teardown (ruling pending with the operator) | Child B PR #380's committed before/after probes: `load-bench-2026-11-05T05-18-03-580Z.json`, `settle-attribution-2026-11-05T05-02-25-626Z.json` → `T05-17-10-060Z.json`; the lane review evidence (the same head re-run): `load-bench-2026-11-05T05-21-56-215Z.json` |
| 0476c6c | #380 merged; dev serves Gate C | 28/53/77 (in band) | none beyond the row above's changes: client firstCommit 169/219/274, settleTail 398/427/485 — the standing post-C numbers re-confirmed on merged dev | `load-bench-2026-11-05T05-27-13-321Z.json` |
| c150469 (current, lane complete) | **#390 Gate T merged**: the load-echo mount guard (700ms window; the echo's relocations land in place, later moves byte-identical). The operator's own verification ran the rebased-head gates + `uat-lane-menu`/`uat-fuzz` on the rebased tree | 28/52/77 (final: in band) | **client settleTail 105/157/249ms** (final) vs 398/424/488 before Gate T — the post-paint tail collapsed ~4x, its end now the chip wave's commit; client firstCommit 164/209/267 unchanged in band | `load-bench-2026-11-05T17-59-12-343Z.json` |

The lane's work is complete against these numbers. The final operator
headline, start → finish on the harness (modeled profile, the one a load fix
moves): first-card paint 395 → 343 / 475 → 421 / 512 → 465ms at 100/300/500
cards (≈13%), the fan-in 1077 → 77ms at 500 (13x), TBT 299 → 212ms at 500;
the client profile's first-card paint 190 → 164 / 252 → 209 / 294 → 267ms
(the ~10-15% share of that is #379's cleanup, credited in its row); and the
post-paint tail 488 → 249ms at 500 (the echo's dissolve retired by the
operator-approved Gate T; the residual 105-157ms is the chips' idle
landing).

The next lane target stands in these numbers: the modeled fan-in's remaining
shape (one aggregate mount read, queue item 3), with the client's post-paint
tail's dominant term (the transports) awaiting the operator's Gate T ruling.

## What measures load

`scripts/perf/load-bench.mjs` (`npm run perf:load`) boots the REAL app in the
screenshot harness (mock SDK, no bb account, no network) at several board
sizes and reads the load path stage by stage from page navigation to the
settled board:

```
nav → appEval → firstCommit → threadsReady → firstCard → quiet
```

| Stage | What it prices | Where its timestamps come from |
|---|---|---|
| `appEval` | The plugin's module graph evaluating | `fb:app-imported`, pushed by the harness entry (`scripts/screenshot/main.tsx`) after all imports resolve |
| `firstCommit` | React's first commit into the plugin mount point | in-page instrument (`#root`'s first child) |
| `threadsWait` | The modeled host sidebar fetch (staged profile only) | `fb-sidebar-ready` at the mock store's ready flip |
| `mountToFirstCard` | The board's own render cost from ready threads to the first card's DOM node (hooks, memo chains, family index, box plan, columns, card DOM) | `fb-sidebar-ready` → `fb-first-card` |
| `fanInWindow` | The mount metadata fan-in: first rpc start → last required rpc end. The nine plugin-server lists + the pulse mount poll ONLY; the chip hooks' `tracker_validate`/`tracker_status` ride a later effect and are excluded | per-call marks pushed by the mock's instrumented rpc wrapper |
| `settleTail` | How long the DOM keeps mutating after the max of first-card and the last mount rpc end (post-fan-in repaints: pulse rates, chip states). Negative means the last mount rpc changed nothing visible — the board was already quiet; negatives pass the budget trivially by design. | last DOM mutation timestamp the instrument keeps |

Headline numbers read FCP, first-card paint, and TBT (long tasks over 50ms,
summed, during load) per run; the report's `headline` block aggregates them
the same way.

### The two load profiles

- **`client`** — every knob off. Pure client-mount cost with an instant
  sidebar and instant RPCs: what React/memo/columns/card-DOM work costs the
  page. In this profile `firstCard` ≈ `firstCommit` (the board's first commit
  renders cards directly; there is no loading view), and `threadsWait` reads
  negative (the sidebar is ready at module-eval time, before React exists) —
  by definition, not a bug; the stage exists for the staged profile and the
  budgets only assert it there.
- **`modeled`** — `?sidebarDelay=200&rpcLatency=8&metaScanMs=1.5`. The host
  fetches its sidebar before the board renders (200ms), each rpc costs a
  modeled bridge round trip (8ms), and the four per-thread state list
  handlers (`link_list`, `pin_parks_list`, `error_acks_list`, `snooze_list`)
  pay the serial per-thread metadata scan the REAL server shape pays
  (server.ts: `threads.list({})` then one awaited `getPluginMetadata` hop
  per row; `done_list` walks its done-index KV then reads per done id) at
  1.5ms per hop. This is the profile a load fix must move: it carries the
  production shape's serial-scan term. When a child lands a batched /
  server-side read, the modeled cost for THAT handler moves to the new shape
  in the same PR (the model is the mock's stand-in for the handler's real
  wall-time shape, written next to its implementation in
  `scripts/screenshot/mock-sdk.tsx`, `modeledScanDelayMs`).

The modeled numbers are synthetic by construction: what a run proves about
another run is the DELTA on this harness, never an absolute claim about a
real bb.

### The suite's gates (run with `--assert`)

- **Completeness, per load**: the required marks must exist and the required
  ten mount rpcs must have issued; an incomplete timeline aborts the bench
  loud instead of becoming a fast sample.
- **Fixture determinism, per cell**: the card count must be byte-identical
  across repeats (SIM_BULK_THREADS is a deterministic fixture); a wavering
  board aborts.
- **Stage budgets, per scale**: the medians must sit under
  `BUDGETS_BY_STAGE` (generous margins over the calibrated baseline below).
- **Structural fan-in check, per run**: `fanInWindow ≤ this run's slowest
  call + 34ms` — a parallel fan-in settles inside one call's own cost; a
  serial waterfall eats one call cost per link and trips the check. The
  allowance is self-referential (read from the run's own calls) because a
  static knob-derived bound false-fired whenever the board's render
  contended with the modeled timers (measured 2026-11-05: a healthy parallel
  fan-in at 627ms of modeled scan with a static 492ms allowance).
- **Empty battery**: a scale list that resolves to zero cells aborts at
  startup (an `--scales` parse once measured nothing and printed a green
  budget line — the exact wrong-reason pass the suite exists to prevent;
  two zero-cell reports were produced and deleted before this gate existed).

## The baseline numbers

Three consecutive full-battery runs (`--assert`, all passing) on the same
tree, medians per cell in the order the runs happened:

### client profile (pure client cost)

| Stage | 100 cards (174) | 300 scale (440 cards) | 500 scale (706 cards) |
|---|---|---|---|
| `appEval` | 77 / 63 / 56 | 54 / 54 / 70 | 63 / 58 / 53 |
| `firstCard` (paint) | 208 / 186 / 190 | 252 / 237 / 271 | 303 / 291 / 294 |
| `mountToFirstCard` | 134 / 131 / 131 | 193 / 184 / 201 | 242 / 239 / 241 |
| `fanInWindow` | 29 / 29 / 29 | 13 / 11 / 12 | 20 / 19 / 19 |
| `settleTail` | 400 / 397 / 398 | 443 / 434 / 436 | 513 / 497 / 497 |
| `tbt` (headline) | 86 / 80 / 85 | 165 / 167 / 200 | 296 / 286 / 299 |

### modeled profile (the production shape's synthetic costs)

| Stage | 100 scale (174 cards) | 300 scale (440 cards) | 500 scale (706 cards) |
|---|---|---|---|
| `threadsWait` | 197 / 197 / 197 | 196 / 197 / 195 | 196 / 197 / 197 |
| `firstCard` (paint) | 427 / 393 / 386 | 475 / 446 / 481 | 509 / 515 / 495 |
| `mountToFirstCard` | 135 / 114 / 120 | 200 / 193 / 196 | 248 / 244 / 241 |
| `fanInWindow` | 398 / 368 / 376 | 677 / 677 / 677 | 1077 / 1076 / 1076 |
| `settleTail` | 51 / 38 / 40 | −158 / −179 / −160 | −457 / −458 / −463 |
| `tbt` (headline) | 84 / 80 / 66 | 161 / 168 / 171 | 276 / 299 / 300 |

### What the numbers already say (pointers, not the memo)

- The modeled fan-in is the load path's dominant stage at scale: 368-398ms
  at 100 cards, 677ms at 300 scale, 1076-1077ms at 500 — the four
  serial per-thread metadata scans (4 handlers × N threads × 1.5ms
  modeled hop, all parallel, then further widened by the board render
  contending on the main thread).
- The pure client cost is the second tier: `firstCard` grows ~linearly with
  cards (≈0.5ms/card on this machine), 186-303ms across scales on the
  dev-harness module graph; TBT grows with it (80-300ms).
- After the board paints, the client profile keeps mutating DOM for
  ~400-500ms (`settleTail`) — the post-paint churn the pulse/chip effects
  drive; the staged profile's negatives there say the modeled fan-in's tail
  calls change nothing visible once the board is up.
- The fan-in (in the client profile) resolves in 11-29ms: parallel bursts of
  instant answers — the structural check holds; a future change that makes
  the mount fan-in serial trips its run-scoped allowance.

## Stability evidence

Three full runs of the 6-cell battery inside ~4 minutes; every median's
run-to-run spread for the load path's load-bearing stages:

- `fanInWindow`: 0-2ms at 300/500 scale (0.3% of the stage).
- `mountToFirstCard`: 3-21ms across cells.
- `firstCard`: 12-41ms (the widest, driven by `firstCommit`'s 22-38ms
  module/commit jitter on the dev harness).
- `threadsWait` (staged): 0-2ms — the modeled 200ms fence is timer-exact.

The absolute budgets in `BUDGETS_BY_STAGE` all sit at or above the widest
observed medians by ≥2x at the load path's hot stages, and every cell
passes with margin; the structural fan-in check held in all 60 recorded
runs.

## Reproduction

```bash
npm run perf:load                 # measure + report + JSON evidence
npm run perf:load -- --assert     # the same battery, failing on budget breach
npm run perf:load -- --scales 300 --repeats 7   # one scale, more samples
```

Runs boot their own harness (port 5473, identity-token handshaken) and a
headless Chrome; raw machine outputs land in `docs/perf/load-bench-*.json`,
one per run (this doc's three runs: `load-bench-2026-11-05T03-23-50-069Z.json`,
`load-bench-2026-11-05T03-26-20-368Z.json`, `load-bench-2026-11-05T03-27-10-293Z.json`).

The unit tests for the stage arithmetic itself: `tests/perf-load-stages.test.ts`
(`npx vitest run tests/perf-load-stages.test.ts`), contract-tested without a
browser.

## Environment

- MacBook Pro, Apple M3 Pro, 36 GB RAM, macOS 26.7.1 (build 25G241).
- Google Chrome 157.0.8103.39, headless, 1920×1080 viewport.
- Node v24.22.1; the vite DEV harness (the same server the UAT runner uses),
  warm module graph per load (2 warm-up loads per cell, not recorded, 5
  recorded runs per cell — the first load's cold-transform cost is outside
  this baseline's claim).
- Board fixture: the harness base fixture (~40 base threads) + `SIM_BULK_THREADS(N)`
  (a state-mixed, family-nested, project/provider spread bulk set),
  card counts at each scale recorded per cell (174 / 440 / 706).

## Baseline tree and in-flight work

- Baseline taken on `origin/dev` = `5fdc2ca` (the 0.48.1 pane-parity-audit
  merge; the New-project icon-button rework #361 is already in this tree).
- Known in-flight, NOT in these numbers: PR #362 (external,
  "Threads running background work stay in Working" — Working-lane
  semantics), and the orchestrator's other commissions still landing. The
  lane re-baselines after each orchestrator merge before crediting or
  debiting any child's change.
- The lane's own commission (this PR): the bench, the stage module + its
  tests, the modeled knobs — no app or server behavior changed.
