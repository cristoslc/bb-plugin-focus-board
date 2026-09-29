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
- `back` performs the browser's own history back; `press_escape` sends a real
  Escape keydown from the body (the path the pane's close handler listens
  on); `click` left-clicks a card's anchor (`{ card: thr_x }`); `click_aria`
  clicks a control by accessible name (aria-label, else button text — e.g.
  the What's-new gift or the modal's Got it); `push_url` pushes a URL the
  mock router does not own — the shape of a link-out to main bb.
- Gestures run in the order the step declares them, so a pane-history step
  can sequence pushes and backs deliberately.
- `pane` (`{ threadId: thr_x }`, `{ open: false }`) reads the pane aside's
  aria-label; `active_card` reads the board's own `aria-current` marker plus
  whether the card is in view; `url` (`{ suffix: "…" }`) asserts the browser
  URL's suffix — the honest record of pane-history behavior (do NOT assert
  `history.length`: Chrome reads it stale after a back-then-push sequence,
  the entry is added but the count lags); `whats_new` (`{ icon, unseen,
  modal }`) reads the gift button and modal (the pulse is the compiled
  `motion-safe:animate-pulse` class); `text_visible` checks a substring of
  the page's text.
- The harness seeds the what's-new state via `?lastSeenVersion=<version>`
  (absent → first visit stamps the running version as seen).
- `column` assertions read a lane by `data-column-id`, from the top-level
  cards' hrefs; `ranked` reports whether the lane has a STORED order
  (`data-column-ordered`), and `rank_slots` how many cards offer themselves as
  drop targets.
- `glyph_glue` measures the pane's inline-code open glyph in the real line
  breaker (jsdom cannot wrap, so this one exists for the real
  geometry): it waits up to 4s for the decoration to fire (environment
  resolution plus a `workspace_files_exist` verdict are async), fails when
  the icon is not fused into the nowrap glue unit, fails when the code span
  never wrapped (the check would be vacuous), and passes when the glyph
  shares a baseline with the path's last character. The harness side:
  `scripts/screenshot/mock-sdk.tsx` renders backtick spans as real `<code>`,
  `threads.get` resolves the fixture's environment id, and the
  `workspace_files_exist` RPC vouches for `SIM_WORKSPACE_FILES`
  (`scripts/screenshot/data.ts`).
- `assert_before_drag` runs before the gesture, so a step can prove both the
  starting state and the resulting one.
- `drag_to_column` drops on a whole lane rather than a card within it, which is
  how the cross-lane Done/Unread drops are exercised.
- `store` / `rpc_called` / `rpc_not_called` read the mock's rank store and its
  call log, so a test can assert what was *persisted*, not just what rendered.
- `insertion_line` / `no_insertion_line` re-run the hover and then sample the
  rendered pseudo-element, so they see the line React actually committed.
- Suite-level `defaults.viewport` (`{ width, height }`) overrides the default
  1920×1080 — a short viewport is what gives the vertical scroll assertions
  real bite.

## Current suites

- `uat-rank.yaml` — per-column rank ordering: seed on first intent (a fresh
  lane is reachable and the first drop writes the order), a Done drop still
  working once every lane is draggable, the two half-slots, appending, no-op
  drops, cross-lane refusal, the Pinned lane across groupings, keyboard moves,
  the insertion line, and the screen-reader announcement.
- `uat-pane-history.yaml` — the open pane's thread lives in the panel's URL:
  clicks push real history entries, the browser's own back arrow reopens the
  trail of previously opened cards, a foreign-surface push-and-back restores
  the pane (the bb back-arrow case), Escape closes by replacing the entry,
  deep links open the pane directly (and a malformed one degrades to the
  plain board), and the active card is kept in view — on restore and when it
  relocates to another lane (drop-to-Done).
- `uat-whats-new.yaml` — the toolbar's gift button: an upgrade pulses it,
  opening the modal lists the delta and marks the version seen (the button
  stays), the quiet button still opens the full recent list, Escape closes
  the modal, and fresh installs / same-version revisits never pulse.
- `uat-glyph-glue.yaml` — the pane's inline-code open glyph in Chrome's real
  line breaker: a ~70-character workspace path in the fixture thread wraps
  in the 480px pane and the glyph stays glued to the path's last character,
  holding as the viewport shrinks; the probe refuses to pass vacuously when
  the span never wrapped.

## Notes

- The first step is the one every other step used to assume. A suite that
  seeds a stored order before each step will happily pass while the feature is
  unreachable on a fresh install, so keep the reachability step first and keep
  it unseeded.
- `scripts/uat/probe-reachability.mjs` is a standalone version of that same
  question, for when you want the answer without the rest of the suite.
