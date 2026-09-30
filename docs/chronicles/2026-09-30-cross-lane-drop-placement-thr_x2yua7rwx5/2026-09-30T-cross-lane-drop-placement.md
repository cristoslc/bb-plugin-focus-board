# Decision — cross-lane drops place the card at the hovered rank

Thread: thr_x2yua7rwx5 · Shipped in release 0.5.20 (tag `v0.5.20`).

## Request

Dropping a card into a new column had to place it at a rank position within
that column in the same drop — not land it wherever the lane's default order
put it and force a second drag inside the new column to position it.

## Contract as built

Scope: lanes that accept state-change drops — **Pinned, Done, Unread**. Those
are the only cross-column moves the board can perform, because a rank write
only orders cards *within* a lane; it cannot move a card between lanes.

1. A cross-lane drag hovering over a **card** in a state-change lane shows the
   same insertion line a same-lane drag shows (`dragover` computes the edge
   from the live pointer position and writes `rankDrop`).
2. Dropping on that card performs **both** effects in one drop: the state
   change (pin / mark done / mark unread) and the rank write, computed by the
   same `moveTargetFor` → `commitMove` path same-lane reorders use — anchored
   on the card below when the drop is on a bottom half, appending when below
   the last card. The card-level drop claims the event
   (`stopPropagation`) so the column's unpositioned handler cannot fire a
   second time and double-apply the state change.
3. Dropping on the column's **empty space** (or the column body) stays a bare
   state change with no rank write. Rationale: a bulk drop on "the lane" is
   not an ordering act; writing ranks there would silently convert, e.g., the
   Done column's default done-recency timeline into a hand-set order, and
   every future done card would then sort below all ranked ones. This also
   preserves the tests' pre-existing pin-drop contract for the empty space.
4. Derived lanes (Attention, idle age buckets, group-by project/provider/
   machine, parent grouping) still refuse cross-lane drag-ins: membership
   there is the thread's own data (state, age, project), not a slot a rank
   write can honour. Cross-project reassignment under Project grouping would
   need a column-override/project-change RPC and was deliberately out of
   scope.
5. `dragEnd` now clears the insertion-line state, so a cancelled or refused
   drag leaves no stale line on screen.

## Implementation notes

- `components/board.tsx` `li`-level `onDragOver`/`onDrop`: a new cross-lane
  branch guarded by `draggingIdRef.current !== null && isDropTarget` — the
  dragged-id ref (set only when ranking is wired and the card carries a
  rankKey) plus the lane's own state-change handler both being present. Without
  both guards, foreign drags could write orders for cards a lane never held
  or fire state changes the board did not intend.
- Rank writes reuse `applyMoveVisible` with the target lane's current visible
  ids; the moved card is absent from that list and `applyMove`/`appendTo`
  handle an absent id correctly, so the card joins the lane at the chosen
  slot while every card above the drop point becomes ranked (the sparse
  comparator then preserves the layout) and cards below keep their gaps.
- Position announcement (screen-reader/live region) reports the resulting
  slot from `displayAfterMove` — the same text a same-lane reorder uses.

## Tests

`tests/board-drop.test.tsx` — the pin-drop contract was updated from "pins
but writes no rank" to "pins and ranks at that edge in one gesture"; added:
positioned drop into Done (appends below the last card), insertion-line
visible during cross-lane hover, the cross-lane drop claims its event
(state change fires exactly once), and derived columns still refuse.
Full suite at release: 550 tests across 36 files, `tsc --noEmit` clean.

## Concurrent-release incident (for the record)

While preparing this release, the chat-click-guard thread committed
`Release 0.5.19` (d90cc4b) to dev moments before this thread's release
commit. Both wrote the identical 0.5.18 → 0.5.19 bump on top of 0.5.19's
dev, and the first main-checkout merge conflicted. Resolved per the release
spoke's section 0 warning: this release renumbered to **0.5.20**, the branch
was rebuilt cleanly on dev (feature commit + single release commit; no merge
or unpushed 0.5.19 artifact survives on the side branch), dev was merged
into main, and tag `v0.5.20` was signed on release commit `331a05a`. The
misnamed release commit exists only inside this thread's history and was
discarded.