# Sashay plan: Parent thread lanes (pivoted Attention grid)

*Origin: docs/musings/2026-09-28-parent-thread-grouping.md, corrected the
same day by the operator. The musing is the design record; this plan is the
implementation contract. Sashay thread: bb thread thr_vmbgtditqp.*

## Goal

Add a "Parent thread" option to the board's Group dropdown. Vertical lanes
are parent threads, the horizontal rows are the pivoted Attention ladder with
the most attention-needing state at the top, and only child threads render as
cards. The parent is a lane header, never a card.

## The geometry

Today the Attention grouping runs left to right: Pinned, Needs you, Unread,
Working, then idle age buckets, with Done appended far right. The parent-lane
view transposes that axis and hangs families off it:

- Vertical lanes: one lane per parent thread (a family root with at least one
  visible child), plus one catch-all lane for standalone threads.
- Horizontal rows, identical in every lane, fixed order: Needs you, Unread,
  Working, then the idle buckets (Recent, Today, Earlier, A while ago), then
  Done at the bottom.
- Cards: only level-1 children of the lane's parent, each placed in the row
  of its own state (idle children land in their age-bucket row).

One lane reads as the whole orchestration tree: a Needs-you child at the top,
Working children under it, Idle ones lower, Done ones at the bottom.

## Decisions

- **D1 — grouping, not overlay.** "Parent thread" is a real `GroupBy` value
  in the dropdown (the musing's revised verdict). It does not compose as a
  second axis on other groupings.
- **D2 — fixed row ladder.** Rows derive from `STATUS_COLUMN_ORDER`
  transposed, with Done as the bottom row. Rows are never an operator order
  and never a stored rank.
- **D3 — parent as header, never a card.** The lane header carries the
  parent card's job: title, click opens the pane, child-count chip, and a
  state dot (the parent's own `threadState`). The header of a Done parent
  gets the muted done treatment.
- **D4 — catch-all lane.** Threads with no family (roots without children,
  including cycle members and deleted-parent orphans from
  `buildFamilyIndex`) render in one lane labeled "Standalone", placed by the
  same row ladder. A board with no families renders as that one lane, which
  is the attention board turned sideways.
- **D5 — derived lane order.** Lanes sort by their family's most
  attention-requiring live member (the walk `familyColumnOverrides` already
  does, promoted from a placement rule to a sort key), ties by
  `derivedCompare` (pinned first, newest first). No new stored rank in v1.
- **D6 — cell order.** Within a row cell, urgent children (state
  "attention") float to the top, then the derived order, mirroring
  `sortNestedByColumnRank`.
- **D7 — R2 carries over.** Archived children never stand alone. They render
  under the lane header with the archived treatment (dimmed, archived
  label), riding with the lane exactly as they ride under the parent card
  today. An archived child with no parent renders nowhere.
- **D8 — depth cap.** Grandchildren never render as lane cards; a level-1
  child with grandchildren shows the existing `+N` chip
  (`grandchildCountFor`).
- **D9 — Done row.** Done children render in the Done row. A lane whose
  cards are all Done still renders; no collapse in v1. The Done row sorts by
  `doneRecencyCompare` (newest done first).
- **D10 — filtering.** Family-aware keep-and-dim (`filterFamilies`) applies
  unchanged; non-matching family members dim in their cells.
- **D11 — nesting toggle inert here.** In parent grouping the lane view is
  the mode; the R3 toggle keeps governing every other grouping and is
  ignored (but still persisted) when "Parent thread" is selected.
- **D12 — sweep deferred.** No lane-level sweep arming in v1. The per-column
  arm UI has no analogue yet; the `bb focus-board sweep` CLI keeps working.
  Lane-level arming is deferred work.
- **D13 — pinned.** A pinned parent floats its lane leftmost through
  `derivedCompare` in the tiebreak; a pinned child carries its pin badge in
  its row cell. No separate pinned lane.
- **D14 — no frozen columns.** Lane membership is stable (families do not
  change lanes); lane order may re-sort when states change. The
  keep-in-view effect still applies to the open card.
- **D15 — pane routing unchanged.** The pane, its URL subpath, and the
  back-arrow history behave exactly as in every grouping.

## What ships

1. The Group dropdown gains "Parent thread" (`groupBy: "parent"`).
2. A pure lane model: `buildParentLanes(threads, doneIds, now)` in a new
   `components/parent-lanes.ts`, reusing `buildFamilyIndex`,
   `threadState`, `doneRecencyCompare`, and `derivedCompare`. It returns the
   ordered lanes, each with its parent, header facts, and per-row card lists,
   plus the Standalone lane.
3. A lane board renderer, `components/parent-lane-board.tsx`: a left rail of
   row labels, one vertical lane per family, cells stacking that lane's
   cards for the row. Reuses `ThreadCard` for child cards. Lanes scroll
   horizontally like columns do today; the row rail stays visible.
4. `app.tsx` branches assembly on `groupBy === "parent"`: the lane model
   replaces `buildColumns`/`nestUnderParents`; filters and search run
   before assembly exactly as today.
5. Tests, coverage matrix rows, README and CHANGELOG updates, and a UAT
   suite (see below).

## Work units

- **Unit A (red then green):** `tests/parent-lanes.test.ts` written first
  against the pure model; then `components/parent-lanes.ts` until green.
- **Unit B:** `components/parent-lane-board.tsx` plus `app.tsx` wiring;
  renderer-level tests for the lane grid; `npx tsc --noEmit` and
  `npm run build` pass.
- **Unit C:** coverage matrix rows, README bullet, CHANGELOG entry, UAT
  suite `tests/manual/uat-parent-lanes.yaml`.
- **Unit D:** run `npm run uat -- tests/manual/uat-parent-lanes.yaml`,
  fix what it catches, post the E2E chronicle.

## Test matrix

| Path | Blast radius | Happy | Sad | Edge | Corner |
|------|--------------|-------|-----|------|--------|
| Lane building (`buildParentLanes`) | low | auto (`tests/parent-lanes.test.ts`: parent with visible children becomes a lane) | auto (no families → one Standalone lane) | auto (deleted parent → orphan in Standalone; cycle → roots) | auto (lane with only archived children does not render as a family lane) |
| Row placement | low | auto (child state → row, incl. idle buckets) | auto (Done child in Done row) | auto (state change moves the card between rows) | skip (pure placement) |
| Lane order | low | auto (most attention-needing member first) | auto (all-idle families tie → derived order) | auto (pinned parent floats left) | auto (archived and done members excluded from the lift) |
| Cell order | low | auto (urgent child first) | auto (no urgent → derived) | auto (rank-free: stored column ranks ignored in lane mode) | skip |
| Header facts | low | auto (child-count chip counts all children, archived included) | auto (state dot present for every state) | auto (done parent muted) | skip |
| Standalone lane | low | auto (same ladder, urgent-first order) | auto (empty board → single empty lane) | auto (pinned standalone floats in-lane) | skip |
| Archived riders (D7) | low | auto (render under header, dimmed) | auto (archived-only family → rider-only lane still shows header) | auto (archived child never in a row cell) | skip |
| Family filter + search | low | auto (child match keeps lane, members dim) | auto (no match drops lane) | auto (search by title matches through the lane) | skip |
| Depth cap (D8) | low | auto (`+N` chip on level-1 child) | auto (no chip without grandchildren) | auto (grandchild never a card) | skip |
| GroupBy persistence | low | auto (`parseGroupStored` round-trips "parent") | auto (invalid value → default) | skip | skip |
| Nesting toggle inert (D11) | low | auto (parent grouping ignores the toggle; other groupings unchanged) | skip | skip | skip |
| Lane board interaction | low | UAT (`uat-parent-lanes.yaml`: header click opens parent pane; card click opens child pane; horizontal scroll) | UAT (empty board shows the Standalone lane) | UAT (group switch back to Attention renders columns unchanged) | skip |

## Verification

- `npm test` and `npx tsc --noEmit` (the repo's declared test command is
  `npm test`).
- `npm run build`.
- `npm run uat -- tests/manual/uat-parent-lanes.yaml` with the harness
  requirements from AGENTS.md (`npm run build` first, `CHROME_PATH` if
  Chrome is not in the default place). Reports land in `docs/uat/`.
- A screenshot-harness capture of the lane board against a seeded family
  fixture, for the plan review and (optionally) README.

## Deferred (not in this PR)

- Lane collapse to a header line; stored lane order ("my trees, in the order
  I work them"); the parent rendering as its lane's first card when its own
  state outranks its children's; generalizing the pivoted ladder to other
  groupings (Last activity, Project); phone-specific row pagination;
  lane-level sweep arming and a lane-level gather; a per-lane graph slice
  against the agent-graph musing's `threadIds` transport.

## Open decisions, revisable in review

- Whether a fully-Done lane should read as sweep-eligible as a unit (the
  sweep musing's family-eligibility rule has the vocabulary; deferred with
  D12).
- Whether the Standalone lane should read as an unlabeled first lane instead
  of a labeled one.
- Whether the state dot on the lane header is enough, or the parent should
  also render as a card when it outranks its children (D3 pins header-only
  for v1; a screenshot mock settles it).