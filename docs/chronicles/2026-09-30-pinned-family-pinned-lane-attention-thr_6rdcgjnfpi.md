# Decision — a pinned family's Needs-you member calls attention from inside Pinned

Thread: thr_6rdcgjnfpi · landed on dev unreleased (0.6.0-dev lineage).

## Request

"When a pinned family has a child thread that needs to ask a question, it
doesn't call attention because it can't move from Pinned to Needs You."
Proposed: in Pinned, get the family a pulsing border and move it to the top
of the vertical lane, similar to the changelog gift icon's pulse.

## Why the bug exists

`buildColumns` splits pinned threads out
(`active.filter((thread) => !thread.isPinned)`) **before** the R4 family
column overrides are consulted — the overrides are only read for unpinned
roots. So a pinned family can never relocate to the attention column, no
matter what state its live members are in. The family sits in Pinned with
the parent card rendering its own (usually idle) state; the child's
pending interaction appeared only as a faint amber dot on its nested row.

## Contract as built

Pinned placement is kept (it is the lane the operator chose the card for —
relocating it would bounce the card the operator pinned at the far left
into a derived column), and the attention surfaces where the family
already sits, by two agreeing signals computed from the same states:

1. **Pulse.** `ThreadCard` computes `familyNeedsAttention`: the card's own
   state is `attention`, or a nested child's is (archived and done children
   never count). The card gains a pulsing amber border — an absolutely
   positioned overlay span (`data-attention-pulse`) carrying
   `border-2 border-amber-500 bg-amber-500/5 motion-safe:animate-pulse`,
   the changelog gift's pulse language and reduced-motion guard. A border,
   not a ring: rings paint outside the box and the overlay lives inside the
   card's own `overflow-hidden`, so only the border lands on visible
   pixels. The pulse animates the overlay's opacity, not the card's, so
   the title never blinks. The header row gains the amber
   `MessageQuestion` icon with `aria-label="A subthread needs your input"`
   when only a child demands attention (`indicatorLabel` stays when the
   thread itself has the pending interaction).
2. **Lift.** `nestUnderParents` computes `pinnedAttentionIds(columns,
   nested, doneIds)`: pinned threads whose own state is attention, and
   pinned roots whose nested family has an attention member. The Pinned
   lane sorts with an attention tier **above its existing order** —
   including manual ranks — per the same rule `sortNestedByColumnRank`
   already applies to urgent child rows. A stable sort keeps everyone
   else's relative order.

Both signals end together: the pulse reads the same states the lift reads,
so the border and the lane position can never disagree about who is
urgent, and answering the question restores the lane exactly as it was.

## Deliberately not done

- Relocating the pinned family to Needs you / Unread when its members want
  the operator. Pinned is an operator choice, not a derived state; the
  lift-plus-pulse keeps the choice and still calls attention. Revisit only
  if the pulse reads as insufficient.
- The parent-lane (parent grouping) board is out of scope: it has no
  Pinned lane, its urgent children already render as their own cells, and
  the lane-order "urgent first" rule exists there.
- Cross-axis children (project/provider/machine groupings mismatch) stay
  standalone in their own column and surface their own attention there;
  the pinned parent neither pulses nor lifts for them.

## Harness fidelity notes (side quest, same thread)

While screenshot-verifying the pulse, the screenshot mock was found
rendering the current app not at all (`useSettings`,
`app.slots.sidebarFooterAction` missing from the SDK stub) — stubs added —
and, once rendering, with **every cascading-layered utility clobbered by
the mock's unlayered preflight**: unlayered author styles beat all
`@layer`s regardless of specificity, so `border` utilities computed 0px
and any border color resolved to `currentColor`. The preflight is now
layered `base` (the plugin's utilities live in `@layer utilities`, which
declares later and wins) — the same relationship real bb's host CSS stands
in. That fix is harness-only; it changed nothing in the plugin.

## Tests

- `tests/nesting.test.ts` — pinned-with-attention-child stays in Pinned
  and leads the lane; the lift holds above a stored manual rank and
  disappears once answered; grandchild attention lifts; own-state
  attention lifts; done/archived members neither lift nor pulse;
  `pinnedAttentionIds` is empty without a Pinned lane.
- `tests/pinned-attention-board.test.tsx` — DOM contract: the pulse
  renders only on the attention family's pin card; lane order matches.
- Coverage matrix: the Family columns (R4) row names the pinned-lane
  attention lift and the pulse.