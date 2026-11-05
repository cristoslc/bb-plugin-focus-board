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

The after-battery (`docs/perf/settle-attribution-2026-11-05T05-02-25-626Z.json`,
same tree minus C, three runs per scale):

| Scale | settleTail before | settleTail after | chip calls fired at |
|---|---|---|---|
| 100 | 399 / 396 / 399 | 402 / 401 / 401 | +121 / +135 (idle) |
| 300 | 431 / 430 / 430 | 431 / 428 / 429 | +192 / +224 (idle) |
| 500 | 491 / 490 / 486 | 491 / 498 / 498 | +314 / +364 (idle) |

- The settle number did not move, as predicted: the transports' ghost removals
  still end the tail at every scale (Gate T's hold stands).
- The chip wave DID move: `tracker_validate` / `tracker_status` now fire at the
  browser's idle callbacks (+121..+364 by scale; the 400ms ceiling is only the
  bound Chrome never reached on this machine) and land at +201..+375, instead
  of the pre-gate wall of +113..+278 — the load window now carries no
  un-idle-scheduled decoration fetch at all.
- The same change under the modeled profile does not move that profile's
  settleTail either: the after-run's modeled cells (95/119/183) match the
  lane's re-baseline (91/112/175, `load-bench-2026-11-05T04-16-00-974Z.json`)
  within jitter, and the whole `--assert` battery passes with the standing
  budgets (`load-bench-2026-11-05T05-03-40-945Z.json`, zero violations).
