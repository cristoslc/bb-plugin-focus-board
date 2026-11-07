# The thread pane's open and close on mobile, attributed (2026-11-06)

Commission from the focus-board orchestrator (thread `thr_maufmdmr5q`), from the
operator's report: "opening and closing the thread pane gets sluggish on
mobile." This document is Stage 1: measurement and attribution, with no
behavior edits. Everything was run on this branch (based on `origin/dev` at
`8f01204`), via one reproducible probe (`scripts/perf/pane-mobile-attribution.mjs`)
plus the existing `scripts/screenshot/probe-mobile-perf.mjs`. Raw evidence sits
next to this file (the two `pane-mobile-attribution-*.json` reports below) and
under `docs/screenshots/pane-mobile-repro/` and `pane-prod-repro/`.

## How it was measured

The screenshot harness mounts the real app (`app.tsx`) against the mock SDK.
Two surfaces, both at 390x844 @2x with Puppeteer's mobile+touch emulation and
real CDP touch taps (the same `Input.dispatchTouchEvent` path a phone tap
takes):

- The **prod probe harness** (`vite.probe.config.ts` → `vite preview`): React
  production, unminified, so CPU profiles keep function names. This is the
  bundle shape bb actually serves.
- The **dev harness** (`vite.config.ts`): React development build. Its numbers
  are the repo's perf-evidence convention (the load budgets are dev-bundle
  numbers), but dev React makes every render several times more expensive
  (the open/close profiles show the dev JSX validator at 71-77% of active CPU
  samples). Treat dev numbers as the exaggerated same-shape signal.

Board population rides the `scale=N` bulk fixture (`scripts/screenshot/data.ts`):
`scale=0` = the demo board (74 cards), `scale=300` = 474 cards, `scale=500` =
740 cards. Each gesture cycle is one open (real touch tap on a visible card's
anchor, tap → pane `aside` present) then one close (tap on the pane's close
control, tap → `aside` gone), 5 cycles per cell, medians reported. The
window after each tap runs to a settle end 300ms later, and counts long
tasks, React commits, frames, and every frame gap — so a dropped frame reads
as the hole it is.

The pane's real device-class check fires in the harness itself: the pane reads
`useIsCompactViewport` (`components/ui/hooks/use-compact-viewport.tsx:10`,
`max-width: 767px`), and 390px satisfies it live, so the pane opens as the
compact full-screen sheet (`fixed inset-0`, `components/thread-pane.tsx:916-928`).
Measured both directions: on every open the sheet's box covers the board's box
completely, background opaque.

## The numbers

Prod probe harness, CPU throttle 4x (a mid-range phone several times slower
than this dev machine's CPU; `ATTR_CPU=4`), medians of 5 cycles:

| Cell | open tap→present | close tap→gone | open long tasks | close long tasks | worst open frame holes |
|---|---|---|---|---|---|
| phone, 74 cards | 64ms | 49ms | 0 | 0 | none |
| phone, 474 cards | 182ms | 142ms | 2 (226ms) | 4 (271ms) | 267ms |
| phone, 740 cards | 228ms | 216ms | 5 (443ms) | 4 (395ms) | 333ms |
| desktop, 74 cards | 74ms | 60ms | 1 (51ms) | 0 | — |
| desktop, 474 cards | 212ms | 148ms | 1 (211ms) | 2 (203ms) | 283ms |
| desktop, 740 cards | 277ms | 107ms | 2 (344ms) | 3 (333ms) | 367ms |

Prod probe harness, CPU throttle 8x (a low-end phone; the hard cell):

| Cell | open tap→present | close tap→gone | open long tasks | close long tasks | worst open frame holes |
|---|---|---|---|---|---|
| phone, 74 cards | 125ms | 83ms | 1 (106ms) | 1 (62ms) | 167ms |
| phone, 474 cards | 419ms | 314ms | 5 (796ms) | 5 (733ms) | 550ms |
| phone, 740 cards | 465ms | 350ms | 5 (946ms) | 5 (828ms) | 650ms |

Dev harness (React development build, 4x, 740 cards): open tap→pane-present
median 312ms (first painted ~897ms), 3 commits, 3 long tasks 439ms; close
tap→gone 290ms, and the close tail blocks hard: up to 8 long tasks totaling
790ms in a 1.3s window at 12-15fps. The dev profile again prices the dev JSX
validator (`jsxDEV`) at ~72-77% of active samples — the exaggerated React
render-cost shape of the same work the prod bundle shows.

Evidence files:

- `docs/perf/pane-mobile-attribution-2026-11-07T03-21-30-197Z.json` — the 4x
  matrix (phone+desktop × 0/300/500, with profiles)
- `docs/perf/pane-mobile-attribution-2026-11-07T03-24-04-630Z.json` — the 8x
  phone battery
- `docs/screenshots/pane-mobile-repro/evidence.json` — the dev-harness run
  (probe-mobile-perf, with trace breakdowns: dev open = RunTask 856ms /
  FunctionCall 586ms vs UpdateLayoutTree 12ms and Paint 14ms; dev close =
  RunTask 797ms — JS dominates, CSS/layout does not)
- `docs/screenshots/pane-prod-repro/evidence.json` — the prod-harness run of
  the same probe

## What the cost is made of, per suspect

### 1. The attention capture's board rebuild, per open AND per close — CONFIRMED (the driver)

Opening the pane writes attention-freeze state and closing clears it, and both
writes sit in the board build's dependency list, so every open and every close
re-runs the full board build and re-traverses every card (the per-lane card-list
body, `threadLi`, `components/board.tsx:3274`):

- Open: `openThreadCard` calls `capturePaneAttention(threadId)`
  (`app.tsx:2584`), which sets `setPaneCapture(captureThreadAttention(...))`
  or `setPaneLaneCapture(...)` (`app.tsx:1390-1408`). The columns assembly is
  a memo whose deps include `paneCapture` (`app.tsx:1834-1847`); the parent
  view's lane build's deps include `paneLaneCapture`
  (`app.tsx:1816-1829`).
- Close: the route effect's settle-close branch clears both
  (`app.tsx:2712-2721`), re-running the same build a second time.
- The recapture effect re-runs on every capture change (`app.tsx:1875-1940`,
  deps line 1940) on top of that.

The per-card memoization holds (`sameCardProps`,
`components/thread-card.tsx:2436`+: measured **1 card re-rendered per open
and per close** on the instrumented prod harness), so the cost is not card
renders — it is the traversal around them: `assembleBoard` over every thread,
then Board → per-lane render bodies creating element trees for every card
(`threadLi` in `components/board.tsx`, 4-8% of the prod profiles' self time at
the 474/740 cells), the memo compares for every card, and the ticket-refs scan (`lib/tickets.ts:147` `scan` inside `findTicketRefs`,
3-5% in the same profiles), and the keep-in-view
rect pass that follows the open (`getBoundingClientRect` is the top self-time
function in the open profiles; `components/board.tsx:852-904`).

The measurement says this directly: latencies and blocking scales with the
board, not with the pane. At 4x, open tap→present goes 64ms (74 cards) → 182ms
(474) → 228ms (740); close 49ms → 142ms → 216ms. At 8x: 125ms → 419ms → 465ms
open, 83ms → 314ms → 350ms close, with 950ms of blocked main thread per open
and the worst frame hole at 650ms. The phone and desktop cells at the same
scale sit within ~20% of each other: the sheet is not the cost; the
card-count-proportional rebuild behind it is. On a phone the same 740-card
board is fully hidden behind an opaque sheet during both gestures
(`focusSolidCards: 0` in every measured open — the recede is already
withheld), so of all viewports, the phone pays for board work that cannot be
seen.

### 2. The chip snapshot refetch, fired by every open and close — CONFIRMED (secondary, secondary-cost)

The chip repaint fingerprint includes the pane's state
(`pane:${openThreadId ?? "closed"}`, `app.tsx:2109-2117`, issue #205), and
`useTicketStatuses` effects on it (`hooks/use-ticket-statuses.ts:170`): once a
snapshot has landed, every pane open and close immediately refetches the
whole visible snapshot (`use-ticket-statuses.ts:147-155`), then writes a new
map on landing (`:84-99`), which re-renders App/Board and puts every card's
semantic comparator through a per-card ref scan on its `statusFor` compare
(`components/thread-card.tsx:2501-2510`). On the bulk fixture (no ticket
refs) that scan is nearly free; a real board with GitHub chips pays
refs-per-card scans twice per cycle on top of the snapshot wave. On a real
phone the refetch also rides real network, so its landing commit arrives a
round-trip after the gesture and re-renders the board again inside the
settle tail. Not priced in isolation here (the bulk fixture carries no refs);
flagged as a Stage 2 driver.

### 3. The pane's own mount work from PR #379 — CLEARED (fixed, minor cost)

The week's pane additions are all fixed-cost or cheaper:

- `focusRequest`: one counter (`components/thread-pane.tsx:490-495`), passed
  to ThreadChat; the pass costs one pane-local render bump.
- Per-message actions: a memo (`thread-pane.tsx:499-517`).
- The composer-context fallback row: a MutationObserver armed at mount whose
  probe fires once ≈300ms after the pane's mutations settle
  (`components/pane-context-row.tsx:118-152`), a getComputedStyle walk over a
  handful of elements — plus, when the host's context is missing, one
  `setMissing(false→true)` state flip ≈300ms after open (one small commit).

None of these scale with card count; the 74-card cell (64-125ms per gesture,
including route push + pane mount + teardown) bounds the whole fixed cost.
One real-phone mechanism stays unmeasured headlessly: `focusRequest` focuses
the composer on a real phone, which raises the keyboard and resizes the
visual viewport — that interplay is bb's surface, not measurable in this
harness, and worth a manual device check if Stage 2 lands and sluggishness
remains.

### 4. The nine-list mount gate (#403) — CLEARED for gesture open/close

The gate holds the board's first paint only, releases once, and never
re-arms (`app.tsx:499-527`, and the pan router's relationship,
`app.tsx:1070`). The pane route reads only `subPath` (`app.tsx:2706`) — no
pane state is stored behind the gate, and the probe starts each cell 1s
after load with the gate long released. Only a cold deep-link open on a
slow network pays the gate, along with the whole board; that is the load
cost #403's ceiling bounds, not this bug.

### 5. The transports' mount-age guard — CLEARED

`LOAD_TRANSPORT_MOUNT_GUARD_MS` is a 700ms one-shot after the board's first
lane-map seed (`components/card-transport.ts:153-167`); pane open and close
relocate no cards (lane sets change multiplicity only), so no transport plans
or arms on either gesture, and the guard is expired by the time a gesture can
land. The measured cycles show no transport activity.

### 6. The spotlight's focus recede — CLEARED (already fixed by #310)

The card-level marker is withheld whenever the compact sheet covers the board
(`components/thread-card.tsx:1274-1304`, the provider at
`components/pane-sheet-coverage.tsx`); measured `focusSolidCards: 0` at every
open, and the traces price the whole-board restyle at ~12ms of
`UpdateLayoutTree` even on the dev bundle. Nothing to fix here.

## Attribution summary and the proposal for Stage 2

One driver explains most of the measured cost: every pane open and every pane
close re-runs the full board build and card traversal (suspect 1), plus a
board-wide chip snapshot refetch with two comparator sweeps (suspect 2) —
both invisible-behind-the-sheet work on a phone. Everything the pane itself
gained this week is fixed-cost and small.

Proposed fix (awaiting the orchestrator's ruling on this commission; nothing edited yet):

1. When the pane covers the board as an opaque sheet, skip the attention
   capture writes (and let close's clearing see a no-op): `paneCapture` and
   `paneLaneCapture` stay null behind the sheet, mirroring how #310 withholds
   the recede marker on the same condition. The board behind the sheet is
   invisible, so a frozen placement behind it protects nothing the operator
   can read.
2. Withhold the fingerprint's pane term under the same condition, so open
   and close stop refetching the chip snapshot (the 30s poll, focus
   catch-up, and card-lane/state fingerprint terms keep the dots alive).
   Needs a fixture with ticket refs to verify the sweep's cost before it is
   built.

Predicted effect, from the measured scale curve: per-gesture cost collapses
toward the 74-card cell — open tap→present 228ms → ~64-125ms (4x/8x), close
216ms → ~50-80ms, and the blocked main thread per gesture (443-946ms of long
tasks at 4x/8x on 740 cards) falls away with the two board rebuilds per
cycle. What remains is the fixed pane cost plus (on the real device) bb's
ThreadChat mount, the keyboard's viewport effect, and real network — the
residual the harness cannot price.

### Measured correction (2026-11-07, post-fix): the prediction over-credited the capture rebuild

The prediction above bet everything on the capture writes. The Stage 2 fix
shipped in layers, and the intermediate measurement caught the
misattribution: after the freeze-skip + chip pane-term alone (report
`pane-mobile-attribution-2026-11-07T03-52-13-811Z.json`), the 740-card cell
moved 465→477ms open / 350→371ms close at 8x — noise, not the predicted
collapse. The post-fix CPU profile attributed the remainder to the BOARD
re-render itself: `openThreadId` and the fresh closure props (onOpenThread,
onClosePane, the drop/rank/menu callbacks) re-rendered all ~740 `threadLi`
fibers and their `ThreadCard`s on every gesture regardless of the capture
state (`getNearestMountedFiber`, `threadLi`, `sameCardProps`, and React
element allocation dominated the profile).

The landed fix therefore also quiets the board subtree: `activeThreadId` is
withheld (null) while the sheet covers the board, Board and ParentLaneBoard
are memoized (`memo(BoardBase)` / `memo(ParentLaneBoardBase)`), the gesture
closures are hoisted to app-stable callbacks, and openThreadId bridges
through a ref for openThreadCard/closeThreadPane whose only reads are
comparisons. The red-first render-count test (zero card renders on covered
open AND close) now pins what the measured profile demanded.

Final measured numbers on the full fix are in the PR body for this work
(Stage 2's completion report); the layer measurement above is archived
raw at `docs/perf/pane-mobile-attribution-2026-11-07T03-52-13-811Z.json`.
