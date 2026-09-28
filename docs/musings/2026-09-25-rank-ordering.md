# Musing: rank-ordering cards inside a column

*2026-09-25 · standalone · touches the sort in `components/grouping.ts` and the
drop wiring in `components/board.tsx`*

Today every card order in the board is derived, never stored. `sorted()` in
`grouping.ts` is pinned-first, then `updatedAt` descending. Column membership is
derived too, from `columnFor()`. So "reorder cards" is the first feature in this
board that wants to write an operator-authored fact instead of computing one.
That single shift is where all the difficulty lives.

## The UX models on the table

**1. Manual rank as the column's order (the literal ask).**
You drag a card between two neighbours; it takes that slot. Every other card
shifts. Straightforward to grasp, and the drag itself is the whole
affordance: no grip handle, no mode.

**2. Priority band.** Cards carry a band (Now / Next / Later). Dragging changes
band membership, not the sequence. Within a band, order stays recency. Pro: the
stack is short and legible even with 40 cards in a column, and the drag has a
semantic outcome you can see in the card chrome. Con: you asked for rank-order,
and band membership is a weaker promise than an explicit order.

**3. Pin-to-top within a column.** Uses the existing pin concept, just
column-scoped. Smallest change. Con: it is a two-list model dressed as one
list; you cannot express "third after the deploy lands."

**4. Sort-mode toggle.** Add a "Manual" order mode next to the existing
orderings. `sorted()` gains a branch, and drag is only live in Manual mode.
Pro: zero cost to the derived orders, which stay trustworthy. Con: the board
silently looks reorderable in modes where it is not, or you pay for a mode
indicator everywhere.

Lean: **1 or 4, and 4 is 1 with an escape hatch.** Store an explicit rank
per column, and only surface drag when ranks exist for that column. Columns
with no stored ranks keep recency order and say so quietly, rather than
swallowing a drag and doing nothing.

## Where the rank has to live

Not on the thread. On the (column, thread) pair.

A rank stored on the thread means "position 3," a column-relative fact stored
in a column-less place. Every grouping change, every recency bucket boundary,
every Done transition silently reinterprets it. Rank therefore keys on the
column id under the grouping that was active when the drop happened, e.g.
`rank:status:attention` → ordered thread ids. Switching to the Project
grouping shows no ranks, because none were ever set for those columns. That is
honest rather than broken, provided the UI does not imply otherwise.

Fractional ranks (insert *between* two cards by writing `midpoint(prev, next)`)
beat integers here. A column of 200 idle cards should not rewrite 200 records
to insert one. Ties resolve by falling back to recency.

## Presenting consistency: the hard part

This is where the real design work is, and it is mostly not about the drag.

**Derived orders actively re-sort you.** A card you just moved to the top of
`working` is working; in ten minutes it is idle-recent, in an hour
idle-today. The rank is stored under `working` and the card walks out of the
column carrying it. Now the operator's order is scattered across four columns
by the clock, and they have no way to see that. This is the biggest presentational
problem and it is not fixable with layout work. Options: a rank-scoped view
("Pinned order" grouping that groups by the column you ranked in, regardless of
current status), or accept drift and make the stored rank follow the thread
(more below).

**Two order systems on screen at once.** Sweep gather (`withSweepGather`) already
reorders a column's cards to put armed ones at the top, over any order. So
during a sweep the column visibly ignores rank. Today that is harmless because
the underlying order is also derived; with manual rank it becomes a visible
lie. Needs an explicit signal — a divider or a "showing N swept first" note —
rather than a silent resort.

**Nested cards.** `nesting.ts` renders children as rows under a parent. Does a
dragged card carry its subtree? Almost certainly yes, drag the parent, whole
family moves. But then the child's rank is a lie: the child is not at position
3 of its column, it is under its parent. Family needs to be treated as one
orderable unit, which means one rank per family, not per card.

**Filtering and dimming.** `dimmedIds` renders non-matching family members
dimmed. If a dimmed card sits between two ranked cards, the visible order is a
subsequence of the stored order. Fine, as long as nobody computes an insertion
slot from what they can see. Slots must be derived from the unfiltered order,
or a filter left on will scatter the operator's arrangement.

**Multi-window.** Two BB windows on the same board, both holding the column
visible. A rank write is a metadata write like any other; the loser's drag has
to either win silently or be refused. Last-write-wins on a whole ordered list is
the worst option here — two concurrent drags clobber every move but one. A
per-card move operation ("place thread X immediately before/after thread Y")
conflates less than "write the full list."

**Keyboard and touch.** Drag is mouse-and-trackpad. A reorder you cannot do
without a mouse is a reorder half the people cannot do. Move up / move down
needs either menu entries or a focus-plus-arrow interaction. Touch needs
long-press to lift, otherwise scroll and drag fight over the same gesture.
There is already `use-pointer-coarse` in the tree; the affordance should differ
by pointer type rather than being one compromise for both.

**Announced moves.** Any live-region announcement of "moved to position 2 of 7"
makes the reorder legible to a screen reader and costs almost nothing.

## Storage sketch

Plugin metadata, same namespace and same fail-loud parsing as `done`:

- key `rank` → `{ byColumn: { [columnKey: string]: { order: string[] } } }`
- or key `rank:<columnKey>` → `{ order: string[] }`, one record per column,
  which keeps writes scoped and avoids read-modify-write on a single blob.
- `parseRankRecord` throws on a malformed shape, same as `parseDoneRecord`.
- A rank is stored only for cards currently visible in that column, and pruned
  (or simply ignored when stale) when a card leaves. "Ignored when stale" is
  cheaper and self-healing; "pruned" is tidier. Ignoring wins, with a comment
  saying why.

## Still open

- Whether rank survives the column change (follow-the-thread) or does not
  (rank-per-column). This is the fork the whole feature turns on, and the
  answer depends on whether the operator is ranking *work* or ranking *this
  column's reading order*. Ranking reading order is the honest reading of the
  ask, and it means drift is expected, not a bug.
- Whether the Pinned column is rankable or is itself the "rank 0".
- Whether the Done column is rankable. It sweeps to Archive, so a hand-ordered
  archive is a plausible thing to want, and also a likely thing to want to be
  swept anyway.
- Whether the CLI gains a `board rank` verb to match `board done`, so ordering
  can be scripted and inspected. Probably yes, eventually.
- Live reordering animation. Cards moving under a cursor read as responsive;
  cards teleporting read as broken. Worth doing, worth not doing badly.

## Postscript (2026-09-27): the first drop into a column must densify the head

The shipped model is a sparse ordered id list (not fractional ranks), compared
by `compareByRank`: ranked cards first, then unranked in derived order. That
comparator has a sharp edge the sketch above missed: **ranking only the dragged
card still sorts it above every unranked card**, so a first drop into an
unranked column re-sorted nothing unless it landed at the top — "drop below the
second card" was a silent no-op that looked exactly like a dropped drag.

`applyMoveVisible` (lib/rank.ts) is the fix and the standing rule: a move also
ranks every card ABOVE the drop point, computed from the column's DISPLAYED
order (`visibleIds`, which the board threads through `commitMove` →
`onRankMove` → the `rank_move` RPC). Cards below the drop point stay unranked,
so the leave-a-gap, re-enter-in-the-gap property survives everywhere the
operator did not explicitly order; a `toEnd` drop ranks every visible card,
because landing below the last card means landing below the unranked ones too.
Do not simplify this back to `applyMove` — the sparse model is only safe once
the cards above the drop point are ranked with the moved card.
