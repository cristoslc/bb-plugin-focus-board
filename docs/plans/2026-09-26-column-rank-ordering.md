# Plan: per-column rank ordering

*2026-09-26 · from docs/musings/2026-09-25-rank-ordering.md*

Rank the cards inside a column. Rank is stored per column, not per thread, so
it describes "this column's reading order" and a card that leaves the column
keeps its slot for when it comes back.

## Settled decisions

- **Per-column, keyed by `columnRankKey(groupBy, columnId)`.** Pinned and Done
  are un-namespaced (same meaning under every grouping); every other column is
  namespaced by grouping so a project id cannot collide with a lane id.
- **Sparse ordered id list.** Absent ids sort below ranked ones, in the derived
  order. Never re-densified, never renumbered on departure. This is what makes
  "keeps its rank when it comes back into Unread" true.
- **A move, not a column write.** `rank_move` takes threadId + anchor (+ toEnd)
  so two boards open on one column each lose only their own move.
- **Same-column only.** Dragging into a *different* ranked column is refused
  rather than writing an order for a card that is not in it.
- **Seed on first intent.** No gate and no toggle: the drag is the intent, and
  the first drop writes the order. A lane with a stored order says so in its
  header. (This replaced the original "drag only where a rank exists" gate,
  which turned out to make the feature unreachable on a fresh install.)
- **A family is one orderable unit.** Nested children sort by their parent's
  column order, so a parent cannot honour a rank its children ignore.
- **Keyboard parity.** Alt+ArrowUp/Down reorders a focused card in any column;
  a drag-only reorder is a reorder half the people cannot do.
- **Announced.** The insertion line is the only visual feedback, so the move
  is announced in a polite live region.

## Steps

1. `lib/rank.ts` — key, parse (fail loud on a malformed row), applyMove,
   appendTo, moveTargetFor, compareByRank. `tests/rank.test.ts`.
2. `server.ts` — `rank_list` / `rank_move` RPC, `rank-changed` realtime, KV
   row shaped so a written row validates on read.
3. `grouping.ts` — `sorted()` takes a column order; `buildColumns` reads the
   rank for each column it builds, including Pinned and Done.
4. `nesting.ts` — thread `ranks` through `NestingOptions`; sort each parent's
   children by the parent's column order.
5. `app.tsx` — `rankStore` state, refetch on mount and on `rank-changed`,
   optimistic write with a refetch on failure; pass `groupBy` to `Board`.
6. `board.tsx` / `thread-card.tsx` — per-card drop targets with an insertion
   line, the rank payload key, Alt+Arrow moves, the live region.
7. Tests: `tests/rank-board.test.ts` for the wiring, including the
   leave-and-return round trip the feature exists for; `tests/rank-rpc.test.ts`
   for the RPC and the store round trip.
8. UAT: `tests/manual/uat-rank.yaml`, run by `npm run uat`. Real HTML5 drag
   gestures against the mounted app — see tests/manual/README.md.

## What UAT caught

- **Every drop appended.** The per-card drop handler and the column-level drop
  handler both fired, because a `drop` on a card bubbles to its column and the
  column handler treats any rank drag as "append". The insert ran, then the
  append overwrote it, so all twelve visible outcomes collapsed to "last".
  Fixed by claiming the event in the card handler. No unit test could have
  found this: it is event propagation, and the UAT suite now pins it.
- Two lane-lookup and one keyboard expectation in the suite were wrong, not
  the code. The keyboard case was my error — one Alt+ArrowUp moves one slot,
  so "walks to the very top" needed either two presses or a start position one
  slot down; the suite now starts one slot down and asserts the real edge.

## RESOLVED: reachability (seed on first intent)

Chosen: **seed on first intent**. The gate that made the feature unreachable is
gone. Every card is now a drop target for its own lane's drag, the insertion
line appears on hover, and the first drop writes the order — the drag is the
intent, so no setup step or toggle is needed. `data-column-ordered` on each lane
keeps the "is this lane hand-ordered" signal for display, no longer as a gate.

Consequences, each pinned by a UAT step:

- **A rank key no longer means "ignore the Done/Unread handlers."** Every drag
  now carries one, which was the old signal for suppressing the cross-column
  handlers. The section now routes on the SOURCE lane's key instead: a
  same-lane drag appends, a different-lane drag falls through to Done/Unread.
  `fresh-install-drop-to-done-still-works` pins that a Done drop still calls
  `done_set`.
- **The insertion line appears in every lane**, not only ordered ones, so
  "no affordance" softened to "affordance on hover".
- The first drop records only the card it moved. The rest of the lane stays
  unranked and keeps recency until ranked — the sparse list working as
  intended, not an omission.

## Not in this slice

- Cross-column moves between ranked columns (a transfer, not a reorder).
- Reordering Done (it sweeps to Archive; a hand-ordered archive is plausible
  but a separate argument).
- A `board rank` CLI verb, so ordering can be inspected and scripted.
- Touch: long-press to lift. The insertion line and Alt+Arrow are the floor;
  a coarse-pointer affordance is its own piece of work.

## Known sharp edges

- **Sweep gather overrides rank.** While a sweep is armed, `withSweepGather`
  puts captured cards on top of the column regardless of rank. That was
  harmless when every order was derived; now it visibly disagrees with the
  stored order and needs a divider or a note.
- **Filter-scoped slots.** Insertion anchors come from the rendered column, so
  with a filter on, a drop appends relative to the visible list. The stored
  order stays correct; the resulting slot may not be the one an operator
  aiming at an unfiltered board would expect.
- **Rank drift is expected.** A ranked card that ages out of a recency bucket
  keeps its rank under the lane it left, and nothing shows it. This is the
  per-column tradeoff, taken deliberately.
