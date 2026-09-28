# Musing: Parent threads as lanes

*2026-09-28 · sidequest · origin: the operator sketched "we probably need another group — parent threads, where each lane is a parent thread and its children are contained within it (maybe with vertical swimlanes corresponding to the ones in Attention?)". Revised the same day after the operator corrected the first draft's reading: vertical lanes are parent threads, the horizontal lanes are the pivoted Attention grouping, and only children render as cards.*

## The corrected reading

The first draft of this musing read the sketch as attention columns crossed
with parent-thread rows, concluded the idea was an overlay rather than a
grouping, and got the geometry backwards. The operator's sketch, transcribed:

- **Vertical lanes are parent threads.** Each lane is one parent thread, and
  the lane header replaces the parent's card entirely.
- **Horizontal lanes are the pivoted Attention grouping.** Today's
  left-to-right attention columns — Pinned, Needs you, Unread, Working, the
  idle buckets — rotate into top-to-bottom rows, most attention-needing at
  the top. Every lane shares the same ladder.
- **Only child threads show up as cards.** A child of the lane's parent
  renders in the row of its own state, inside its parent's lane. Threads
  with no family have no lane; see the catch-all below.

This is the attention board transposed ninety degrees with families hung off
it. A parent coordinating four subagents reads as one vertical band: its
Needs-you child in the top row, two Working children below, an Idle one lower
still — the tree's shape visible as geometry instead of hidden inside a nest.

## What this corrects in the first draft

The first verdict — "overlay, not groupBy" — flips. Parent-as-lane *is* a
genuine grouping, because the column axis is the parent relation: it deserves
a "Parent thread" entry next to Project and Machine. What the first draft
treated as the fatal objection (a parent lane is not a thread attribute, so
it loses the axis vocabulary) was an artifact of misreading the sketch as
columns-equal-parents-and-nothing-else. The pivoted ladder preserves the
attention vocabulary as rows, so nothing is lost; the grouping composes the
two facts the operator actually wants: containment (whose lane) and urgency
(which row). The first draft's other dissolve survives the transpose: the
old question "a parent sits in Needs you and a child in Working — which lane
wins?" has no winner to pick, because the child renders in its own state row
inside its parent's lane. No placement rule has to choose.

## R4 retires into geometry

`familyColumnOverrides` exists because a card takes one slot and nesting
drags the family along: the family collapses into the column of its most
attention-requiring live member so the parent card carries the urgency. The
pivoted grid carries that information for free — rows are sorted
most-attention-first, so the topmost occupied row of a lane *is* the family's
urgency, and a lane whose top card is in Needs you reads urgent without any
override. The same retirement applies to the Done-parent promotion rule: a
live child of a Done parent promotes today because the Done lane cannot
relocate to meet the child; in the grid the parent is a header and the child
sits in its own state row regardless of the parent's done state. Nothing
needs rescuing, so nothing promotes. The promotion rule stays governing the
nested-card mode; it is simply moot here.

R2 holds unchanged: archived children never take a standalone slot in any
mode. They ride with the lane — under the header, dimmed, with the archived
treatment — exactly as they ride under the parent card today. Cycles and
deleted parents already resolve to roots in `buildFamilyIndex`, and a root
without children has no lane of its own: it lands in the catch-all lane.

## Only children as cards: what the header inherits

Demoting the parent from card to lane header is the boldest line in the
sketch, and it moves work the card system currently does:

- The header inherits the parent card's job: title, click-to-open-pane, the
  child-count chip, and the family's urgency signal. R4's phrase "the parent
  card carries the family's urgency" becomes "the lane header (or the
  topmost occupied row) carries it" — the geometry does most of the work,
  but a header state dot is the cheap belt-and-braces version.
- A parent's own state stops occupying a cell. A Working parent with three
  idle children renders no Working-row card; its activity reads only off the
  header. That is a real loss — parents coordinate, but they also run their
  own turns — and it is the first thing a screenshot mock should test.
- Done is a column today, far right; pivoted, it is the bottom row. A
  fully-done family is a lane whose cells are empty except the bottom row.
  Whether such a lane renders, collapses to a header line, or reads as
  sweep-eligible as a unit is a design decision the sweep musing's
  family-eligibility rule already has the vocabulary for.

## Standalone threads and the catch-all lane

Most threads on a real board are neither parents nor children. The rule
"only children as cards" gives them nowhere to be, so the layout needs one
catch-all lane — "Ungrouped", or an unlabeled first lane — holding
standalone cards placed by the same row ladder. The mode must degrade to
invisibility: a board with no families is one catch-all lane, which is the
attention board turned sideways. Readable, but a hint that the mode is
opt-in and that the nesting toggle and this one are siblings, not rivals.

## Which parents earn a lane

The cost is width now, not height. A parent with one child buys a lane
header plus a lane holding a single card, against today's one card with a
row under it — a poor trade. Lean: a lane for families with at least two
visible children (three or more visible members counting the parent),
smaller families staying as nested cards. Below-threshold families keep the
nest-under-card rendering inside whatever lane they would occupy — a
lane-mode board that still carries some nested cards is coherent, because
both modes already share the family index. Lane collapse (collapse to header
line with the count) keeps the default vertical budget close to today's; a
lane that is empty of cards above the Done row should say so by collapsing.

## Rank and lane order

Columns own their card order through `columnRankKey` — a stored,
operator-authored fact. The pivoted view should not mint a second one. Lane
order left-to-right derives from the family's most attention-requiring live
member (the walk `familyColumnOverrides` already does, promoted from a
placement rule to a sort key), ties by the board's derived order. Within a
row, the existing nested-sibling sort (urgent children float, then the
derived order) already answers card order inside a cell. A hand-ordered lane
list — "my trees, in the order I work them" — is the same
operator-authored-fact shift the rank-ordering musing described, and stays
YAGNI until a lane-heavy board asks for it. The row ladder is fixed by
attention and is never an operator order; that fixedness is what keeps the
view honest, since it means the grid's rows mean the same thing in every
lane.

## What a lane answers that a nest does not

The three tasks from the first draft survive the transpose and sharpen:

- **Watching an orchestration tree as a unit.** The lane is the tree; the
  row ladder is its state readout. Nothing to expand.
- **Per-parent sweeps.** The lane is the blast radius; sweep eligibility is
  already family-shaped, and arming per lane is the natural UI for it.
- **Per-parent graph slices.** The agent-graph musing settled on lane-grain
  slices ("a lane is the smallest unit of orientation the board owns"). A
  parent lane is a smaller, sharper slice than an attention column: graph
  this one orchestration tree. The lane's id set is tiny and client-derivable,
  so the ids-not-descriptions rule carries straight over — no new transport
  question, just another `threadIds` set.

## Standing rules

- Vertical lanes are parent threads. In this mode the parent is a lane
  header, never a card.
- The row ladder is the attention ladder, fixed order, most
  attention-needing at the top, identical in every lane. Rows are never a
  stored operator order.
- Only children render as cards; the parent's own state reads off the
  header, not off a cell.
- R2 holds in every mode: archived children never stand alone.
- No new stored rank: lane order and within-row order both derive.
- The mode degrades to invisibility: no families means one catch-all lane
  and a board that reads as today's attention board, sideways.

## Open questions

- Does the parent card survive anywhere — for example rendering as the first
  card of its own lane when its state outranks its children's — or is the
  header dot the whole answer?
- Does the lane mode replace nested rows or coexist with them: three modes
  of the family pipeline (flat, nested-card, lanes) or two toggles that
  compose? Three modes is cleaner; decide with a screenshot mock.
- Does the pivoted ladder generalize (rows as Last-activity buckets, or
  Project columns pivoted the same way), or is it attention-specific? The
  sketch names Attention only; generalizing is a separate decision.
- Pinned: a pinned parent pins its lane leftmost; a pinned child — a pin
  badge in its row cell, or nothing?
- The catch-all lane's shape: one lane with the row ladder, or a flat
  today-style column so standalone threads keep their familiar reading
  order?
- Phone: vertical lanes already scroll horizontally; the ladder adds
  vertical depth. Row-per-screen pagination, or the lane mode disabled on
  coarse pointers — the first feature with a platform split?
- Does the sweep gather need a lane-level form (a family's swept cards lead
  its lane), or does arming per lane make the gather redundant?
- The frozen-column rule (a card keeps its column while open in the pane):
  the row analogue is trivial (state rows are fixed), but lane order
  derives from live states, so a family whose state changes re-sorts lanes
  mid-read — does the open card's lane need freezing too?