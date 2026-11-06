# The post-paint settle tail, attributed (2026-11-05)

Child B of the perf lane (queue item 2 of the carrier, #373): after the board's
first card paints, the client keeps mutating the DOM for ~400-500ms — the load
bench's client-profile `settleTail` (397/435/499ms at 100/300/500 in the lane's
current re-baseline delta table, taken on dev head `4b4c5ac` after Child A's
merge, `docs/perf/load-bench-2026-11-05T04-16-00-974Z.json`). This document is
the staged attribution of that tail, measured by a committed, reproducible
probe that changes no behavior (`scripts/perf/settle-attribution.mjs`), with
per-driver evidence.

## The probe, in one paragraph

The load driver measures an untouched app; the probe only observes. Two
in-page instruments, installed before any document script: a React commit
census through the DevTools hook contract (the dev build injects into a hook
installed at document start and calls `onCommitFiberRoot` per commit; each
record names the components that actually ran their render — dev fibers carry
an `actualStartTime` stamp — plus the App fiber's whole-render wall), and a
labeled mutation census (one MutationObserver over `document.body` recording
every childList and characterData change with a timestamp and the nearest
board marker, mirroring the bench's childList-only settle clock while also
keeping text records the bench cannot see; attribute writes are counted and
kept out of both clocks, matching the bench). A second observer pins the
transport ghosts' phase attributes, and a read-through wrapper logs every
`setTimeout`/`setInterval` call's schedule time, delay, and caller stack. After
extraction the probe groups the tail's mutation bursts, assigns them to their
commits, and names each commit's driver: the rpc resolution whose end mark sits
in its render window, or `no-rpc-effect`.

## The numbers (three recorded loads per scale, all deterministic to ±2ms)

`node scripts/perf/settle-attribution.mjs`, client profile (no knobs), full
battery; evidence `docs/perf/settle-attribution-2026-11-05T04-44-28-236Z.json`.

| Scale (cards) | settleTail (bench clock) | transport arm @ | ghost removals (last mutation) | chip wave end @ |
|---|---|---|---|---|
| 100 (174) | 399 / 396 / 399ms | +73ms | +396..+399ms | +113..+117ms |
| 300 (440) | 431 / 430 / 430ms | +101..+103ms | +430..+431ms | +171..+178ms |
| 500 (706) | 491 / 490 / 486ms | +154ms | +486..+491ms | +253..+278ms |

The lane's re-baseline cells (435/499ms at 300/500 medians) sit inside these
cells' reach; the probe and the bench measure the same tail on the same head.

## What the tail is made of

The tail is not render churn; it is timer-scheduled decoration plus one visible
wave, in this order (times relative to the fence = max(first card, last mount
rpc end), client profile at 300):

1. **The mount echo (the fan-in's setStates land, ~+0 to +103ms).** The nine
   mount lists and the pulse poll resolve at the fence (the client profile's
   fan-in is an 11-30ms parallel burst) and their setStates land in the echo
   commit at ~+103ms: 1,587 fibers re-render (119 `ThreadCardImpl`s, the done
   projection's section, the toolbar, the settings and composer shells), and
   the DOM moves: the done section gains its projected cards, a feature-group
   box coalesces its two members into one run (the box's run `<li>` replaces
   their old slots), and two cards' `<li>`s relocate between lanes.
2. **The load-echo transports (the dominant driver — the tail's end at every
   scale).** The echo commit's lane map and run-unit map moved, so the board's
   lane-diff layout effect (`components/board.tsx`, the caller at
   `board.tsx:527` in the dev bundle) arms TWO transport plays. The active
   variant is zoom (`ZOOM_PHASE_PLAN`: collapse at 0ms, settle at 320ms,
   remove at 320ms), so SIX timers land in the timer log per load (two 0ms
   collapse timers at arm, two settle timers and two remove timers at arm +
   320ms). The ghost slots render in the next commit (~+127ms, two aria-hidden
   `<li data-transport-ghost data-transport-out="wiping-out">` slots), their
   phases flip to `collapsing` at ~+159..+167ms (attribute-only, the bench's
   clock never sees it), and at **arm + 320ms (the +430ms at 300, the +486ms
   at 500, the +396ms at 100) both ghost `<li>`s are removed** — the last DOM
   mutation of the load, which is why the settle clock stops there. The
   removal commit also re-renders the Board plus ~325-531 memoized card
   wrappers (`ThreadCardImpl`), a render the settle number only sees through
   the two removed nodes. The ghosts are decorative: `aria-hidden` + `inert`,
   parked slots whose teardown is internal bookkeeping of the transport
   machine, not anything an operator reads.
3. **The chip wave (the visible driver, secondary; ~+114 to +171ms at 300,
   +113 to +117 at 100, +253 to +278 at 500).** The chip hooks'
   `tracker_validate` and `tracker_status` calls (one of each at these scales;
   the bulk fixture's cards carry no refs) ride the effect that follows the
   echo commit: they start at ~+114ms and land at ~+133ms, and the landings
   commit at +159..+178ms — ~34 childList mutations plus 3 text swaps: the
   text-chip containers mount under three cards and 31 SVG glyph paths appear
   across the board's chip marks (the kind glyphs' icon paths), all VISIBLE.
4. **The zero-mutation renders (invisible to the settle clock; a rider
   finding).** The echo commit re-rendered 1,587 fibers with zero childList
   mutations; the removal commit re-rendered the Board with 325-531 card
   wrappers for two removed nodes. `settleTail` prices neither; the TBT stage
   and the render wall catch them (the App fiber's render wall in the tail
   reads ~5ms at 300, ~10-12ms at 500).

### The memo's named suspects, cleared and kept

- **The working-dot rate poll (`hooks/use-pulse-rates.ts`) — cleared.** Its
  mount call resolves at the fence with an empty rates map on a plain board;
  `sameRates` holds the previous map by identity, the hook setStates nothing,
  and the interval's next fire is 20 seconds away (the timer log shows it due
  at +20s). It produces no tail.
- **The what's-new pulse — cleared.** The first-visit stamp's setState rides
  the pre-fence commit (the second render at −2ms relative to the fence, before
  the echo); the gear's remaining pulse is a CSS animation, which a
  childList/characterData census correctly never sees.
- **Wallpaper layers — cleared.** No wallpaper layer is mounted in the bench
  fixture (`surfaces` carry none), and the paint frame's remeasure clock never
  appears in the timer log; the write it does at load is attribute-level.
- **The IntersectionObserver pulse gate (`components/attention-pulse-gate.ts`)
  — cleared for this clock.** Its parking flips `data-pulse-parked`
  attributes, which the bench's childList-only settle clock and its text
  records both exclude; the probe counts 58-62 attribute mutations per load of
  which 2 are the ghosts' phase flips and the rest are the gate's parking and
  the paint/period custom properties.

### Why the modeled profile's settleTail is negative (a consistency check)

`groups_list` is not scan-modeled in the harness (it answers at the 8ms
round trip, before the board's real first render, so the group-box map already
exists when the board lays out), done-list moves are multiplicity changes the
transport planner skips by design, and the chip landings precede the fence.
With no relocation the planner arms nothing and the tail's last mutation beats
the fence — the negative settleTail the re-baseline recorded is the same
mechanism this document measures in reverse, not a measurement disagreement.

## The gate list this attribution proposes (awaiting the lane's ack)

1. **Gate T (transports) — the change that moves the tail.** Suppress transport
   planning for plays the board would arm while the mount echo is still
   landing (a mount-age guard in the lane-diff layout effect's arm path: no
   play within a short window of the board's first lane-map seed; every later
   move arms exactly as today). The lanes' final state is byte-identical, the
   polls' cadences are untouched, and the load's dominant wall term (arm delay
   + the 320ms zoom clock + the removal commit) goes to ~0: the tail's end
   becomes the chip wave's last mutation (~+175ms at 300, ~+118 at 100).
   VISIBLE-at-load consequence to rule on: cards relocated by the mount echo
   land in place (no zoom) instead of playing a load-time dissolve; at-rest and
   gesture behavior are unchanged, and the attention-freeze, keep-in-view, and
   touch suites watch gesture-time transports only.
2. **Gate C (the chip hooks' first fetch) — the commission's idle-gating
   mechanism, on the visible driver.** `hooks/use-ticket-statuses.ts` and the
   `tracker_validate` effect in `app.tsx` move their first fetch from
   right-after-the-echo-commit to idle (`requestIdleCallback` with a short
   documented fallback, the poll intervals, focus catch-up, timeout, and
   failure laws byte-identical, the map identity and content rules intact).
   The statuses still land well before an operator can realistically gesture.
   Two things the lane should know before acking: on the bench, the idle
   landing may still fall inside the settle read's window (the extraction
   waits fanInDrain + ~400ms, and the fallback ceiling sits near it), so Gate C
   alone may not move the measured `settleTail` — it removes the load-window
   churn instead; and the hooks' UNIT tests assert the mount fetch, so the
   moved-assertion note in the commission applies.

Sequencing judgment (mine, for the record): Gate T is the tail's end and its
biggest single win; Gate C is the mechanism the memo named. Doing T first and
re-running the attribution after would show the residual tail with C's
decision on real numbers.

## The Gate C after-run (the chip first fetches ride idle; the transports stand)

The lane acked Gate C (the chip hooks' first fetches move to idle, the
transports on hold), and this section is C's attribution of record. The
mechanism, once landed: before a chip surface's first snapshot has landed, its
fetch triggers (`tracker_status`'s effect fetches in
`hooks/use-ticket-statuses.ts`, the `tracker_validate` effect in `app.tsx`)
schedule through `lib/idle-callback.ts` — the host's `requestIdleCallback` with
a hard 400ms fallback ceiling (`IDLE_CALLBACK_FALLBACK_MS`) — and once a
verdict or status set has landed, every trigger fetches immediately, exactly
as today. Poll intervals, focus catch-ups, timeout and failure laws are
byte-identical; a ref-set clear is not a landing, so the load's own key churn
rides the gate whole; a failed fetch never counts as landed.

The after-battery, re-taken on the branch's final (rebased) head
(`docs/perf/settle-attribution-2026-11-05T05-17-10-060Z.json`):

| Scale | settleTail before (re-baseline) | settleTail after | chip calls fired at (idle) |
|---|---|---|---|
| 100 | 397 | 400 / 401 / 402 | validate +115..143, status +129..157 |
| 300 | 435 | 430 / 432 / 433 | validate +176..179, status +209..309 |
| 500 | 499 | 483 / 494 / 484 | validate +269..324, status +350..392 |

- The settle number did not move, as predicted: the transports' ghost removals
  still end the tail at every scale (Gate T's hold stands).
- The chip wave DID move: `tracker_validate` / `tracker_status` now fire at the
  browser's idle callbacks (the validate calls at +115..+324 by scale, the
  status calls at +129..+392; the 400ms ceiling is only the bound Chrome never
  reached on this machine) and land right behind them, instead of the pre-gate
  wall of +113..+278 — the load window now carries no unscheduled decoration
  fetch at all.
- The same change under the modeled profile does not move that profile's
  settleTail either: the branch's `--assert` battery re-taken on the final
  head reads modeLed 94/112/185 where the lane's re-baseline reads 91/112/175,
  its client settleTails 398/431/488 where the re-baseline reads 397/435/499 —
  all inside the standing budgets with zero violations
  (`load-bench-2026-11-05T05-18-03-580Z.json`, the PR's bench evidence).

## The Gate T after-run (the mount-age guard; the tail's end is the chip wave)

The lane approved Gate T, and this section is its attribution of record. The
mechanism, as landed: the board's lane-diff layout effect stamps
`mountSeedAtRef` with `Date.now()` at its FIRST lane map, and a diff within
`LOAD_TRANSPORT_MOUNT_GUARD_MS` (700ms, documented beside the planner in
`components/card-transport.ts`) applies the move's final layout directly — no
ghost, no arrival, no phase timers. Every post-window move arms byte-identically.
The guard's clock is `Date.now()` deliberately: the repo's suites fake Date, so
tests walk past the window with the same fake clock the phase timers ride.

The after-battery, re-taken on the guard with Gate C standing
(`docs/perf/settle-attribution-2026-11-05T17-13-12-329Z.json`):

| Scale | settleTail before (47ffa8b, both gates standing) | settleTail after (guard landed) | tail's last mutation |
|---|---|---|---|
| 100 | 398 (397/402/404 runs) | 108 / 107 / 123 | one chip-wave commit, child×22 |
| 300 | 424 (424/430 runs) | 171 / 167 / 195 | one chip-wave commit, child×22 |
| 500 | 488 (482/497 runs) | 284 (median; min 243 / max 272 on the bench) | one chip-wave commit, child×22 |

- The tail's end moved onto the chip wave's last mutation, exactly as the
  approved design predicted: one commit, a single 22-child insert (the chips'
  status snapshots), no ghost teardown at arm + 320ms behind it.
- The bench's client medians against the before-bench
  (`load-bench-2026-11-05T17-00-50-525Z.json` on 47ffa8b, 0 violations):
  398/424/488 before, 103/160/251 after
  (`load-bench-2026-11-05T17-14-33-080Z.json`); the modeled profile barely
  moves (91/122/184). The client-profile `settleTail` budgets lower to
  340/510/850 (each ≈ 3× its measured median, all six cells green with zero
  violations at the guard commit).
- The relocation suites' move: every relocation pin in
  `tests/board-transport.test.tsx` and `tests/board-transport-zoom.test.tsx`
  walks its mount past the window (`pastLoadEcho()`) so the suites keep
  proving the post-window law; the guard's own law test arms a relocation a
  full window after a suppressed one and pins the dissolve.

The emptied-lane edge the guard's law test surfaced (for the lane's record,
pre-existing): `buildColumns` keeps the "columns exist only while they hold
cards" rule (`components/grouping.ts`), so a relocation that EMPTIES its lane
removes the lane from the render, and the dissolve's out-ghost has no lane to
weave into. Proven pre-existing on 47ffa8b with a scratch (one card relocating,
lane emptied: no ghost rendered, `phase: null`, the layout still landed). The
guard did not introduce it; the guard's law test is merely the first to shape
it. Gesture transports on a lane that keeps residents are untouched.

## The hold after-run (the board paints once, settled; the echo is the paint)

The lane's carrier issue #403 commissioned the two-tier hold: BoardPage renders
its existing loading view until the mount fan-in has settled, with a hard
ceiling so a hung list can never blank the panel. The mechanism, as landed: the
seven mount refetch units chain a settle mark (`settleMountList`) onto each of
the nine immediate calls — handlers byte-identical, both resolve and rejection
count as settled, a rejection being settled because the board works without
every optional list and the hold never waits for a retry — and the ninth
landing flips `mountSettled`. The fetches fire at the same moment they always
did (the gate holds the render, not the calls): the fan-in runs during the
loading view, so its setStates land in the FIRST paint's commit instead of an
echo after it. The ceiling, `MOUNT_SETTLE_CEILING_MS` (beside
`lib/idle-callback.ts`'s `IDLE_CALLBACK_FALLBACK_MS`, documented the same way:
small enough that the deferred board still beats an operator's first gesture,
large enough that a modeled drain beats it), is a deterministic
`window.setTimeout` — one shot per mount, canceled on unmount, never re-armed —
and past it the board paints with whatever landed, exactly the pre-gate
behavior. The realtime signal path refetches the same units, but those marks
land after the release and only ever re-mark tracked keys: the gate is
mount-only. The transports' mount-age guard
(`components/board.tsx` `mountSeedAtRef` + `LOAD_TRANSPORT_MOUNT_GUARD_MS`) is
untouched — the echo now happens pre-paint, and the guard stands as the safety
net it already was.

The after-battery (probe re-taken on the gate;
`docs/perf/settle-attribution-2026-11-06T15-11-04-930Z.json`, the before-run on
the same head `docs/perf/settle-attribution-2026-11-06T14-58-15-611Z.json`):

| Scale | settleTail before this head | settleTail after | post-fence drivers after |
|---|---|---|---|
| 100 | 110 / 106 / 120 | 69 / 71 / 74 | `tracker_validate` (45 fibers) + a 7-fiber shell commit |
| 300 | 159 / 154 / 155 | 94 / 91 / 103 | `tracker_validate` + 7-52-fiber shell commits |
| 500 | 275 / 252 / 276 | 170 / 160 / 139 | `tracker_validate` + 7-52-fiber shell commits |

- The echo commit is GONE from the tail. Before this head the tail's biggest
  driver was the mount lists' post-paint landing — one commit per run keyed
  `rpc:done_list` (or `rpc:family_state_list`) re-rendering 905 / 1,966 / 3,034
  fibers (711 `ThreadCardImpl`s at 500), moving cards between lanes and
  coalescing group boxes. After the hold, the nine lists' setStates land in the
  paint itself (the probe's before-fence window — the fence is now the first
  card, so the paint commit is the settled board), and the post-fence tail
  carries only the chips' idle landing and single-digit-fiber shell commits.
- The load bench on the same head: client `settleTail` 101 / 158 / 248 before,
  76 / 102 / 179 after (`load-bench-2026-11-06T14-57-14-525Z.json` and
  `load-bench-2026-11-06T15-09-43-559Z.json`); the client `firstCommit` stage
  is now the loading view's commit (53 / 46 / 50ms, was the full board's
  163 / 214 / 266), and client `fanInWindow` reads ~0-2ms because the calls no
  longer queue behind the first big render. The client `settleTail` budgets
  lower to 250 / 350 / 600 (each ≈ 3× its measured median, never above the
  budget it replaces).
- The modeled firstCard's honest price on this head is +3 / +5 / +4ms
  (`mountToFirstCard` 108 / 176 / 224 → 111 / 181 / 228), not the commission's
  +30 / 50 / 80 forecast: in the modeled profile the fan-in drains DURING the
  ~198ms sidebar wait, so the gate is already released when the board's render
  begins. The modeled `mountToFirstCard` budgets re-anchor to 400 / 600 / 750
  (each ≈ 3× measured, tightened from the serial-era 1500 / 4000 / 6000 that
  priced a wall the bounded parallel scan retired). All six cells green with
  zero violations at the final head (`load-bench-2026-11-06T15-11-57-750Z.json`,
  the `--assert` battery).
- The after-report's timer list carries one `setTimeout`(+400ms) entry from the
  gate's ceiling; that is its SCHEDULE record (the probe logs schedules, never
  cancels) — the commit census shows no commit at the ceiling's due time, the
  release having canceled it pre-paint.
