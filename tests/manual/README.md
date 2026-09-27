# Operator-assisted E2E suites

YAML suites in this directory, run by `npm run uat`
(`scripts/uat/run.mjs`). Each suite mounts the **real** `app.tsx` in the
screenshot harness (`scripts/screenshot`) against the mocked SDK, so the
components, hooks, and event handlers under test are the ones the plugin
ships. Gestures are real DOM events: a drag dispatches `dragstart` on the
card's anchor (so the card's own handler writes the payload), `dragover` on
the target at the chosen half's coordinates, then `drop`.

## Running

```
npm run build                        # the harness loads dist/app.css
npm run uat                          # every suite in tests/manual
npm run uat -- tests/manual/uat-rank.yaml
```

The runner starts and stops its own vite server, uses the system Chrome
through `puppeteer-core` (nothing is downloaded), writes a report per suite to
`docs/uat/`, and exits non-zero if any step fails.

## Writing a step

```yaml
- id: drag-top-half-anchors-on-that-card
  title: Dropping on a card's top half lands in front of it
  goto: "?groupBy=status&ranks={\"status:unread\":[\"thr_rpc_auth\"]}"
  drag: { from: thr_rpc_auth, to: thr_review_pr, edge: before }
  assert:
    - column: unread
      ordered: [thr_rpc_auth, thr_review_pr]
    - store: { "status:unread": [thr_rpc_auth, thr_review_pr] }
    - rpc_called: { columnKey: "status:unread", threadId: thr_rpc_auth, beforeId: thr_review_pr, toEnd: false }
```

- `goto` reloads the harness; `ranks=` seeds the mock's rank store, so a step
  starts from a chosen stored order.
- `drag` needs a ranked lane on both ends: it dispatches the gesture and
  reports `dropped: false` with a reason when the source card carries no rank
  key, which is how a cross-lane or unranked drag is exercised.
- `key` presses Alt+Arrow on a card, the keyboard path to the same move.
- `column` assertions read a lane by `data-column-id`, from the top-level
  cards' hrefs; `ranked` reports whether the lane has a STORED order
  (`data-column-ordered`), and `rank_slots` how many cards offer themselves as
  drop targets.
- `assert_before_drag` runs before the gesture, so a step can prove both the
  starting state and the resulting one.
- `drag_to_column` drops on a whole lane rather than a card within it, which is
  how the cross-lane Done/Unread drops are exercised.
- `store` / `rpc_called` / `rpc_not_called` read the mock's rank store and its
  call log, so a test can assert what was *persisted*, not just what rendered.
- `insertion_line` / `no_insertion_line` re-run the hover and then sample the
  rendered pseudo-element, so they see the line React actually committed.

## Current suites

- `uat-rank.yaml` — per-column rank ordering: seed on first intent (a fresh
  lane is reachable and the first drop writes the order), a Done drop still
  working once every lane is draggable, the two half-slots, appending, no-op
  drops, cross-lane refusal, the Pinned lane across groupings, keyboard moves,
  the insertion line, and the screen-reader announcement.

## Notes

- The first step is the one every other step used to assume. A suite that
  seeds a stored order before each step will happily pass while the feature is
  unreachable on a fresh install, so keep the reachability step first and keep
  it unseeded.
- `scripts/uat/probe-reachability.mjs` is a standalone version of that same
  question, for when you want the answer without the rest of the suite.
