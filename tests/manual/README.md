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
- `menu` right-clicks a card (`{ card: thr_x, item: "Pin" }`) — a real
  contextmenu event on the card, then the item click — the path the card's
  state-changing menu actions travel (the pane never opens, so the moved
  card is not the active card and the keep-in-view effect does not follow
  it).
- `back` performs the browser's own history back; `press_escape` sends a real
  Escape keydown from the body (the path the pane's close handler listens
  on); `click` left-clicks a card's anchor (`{ card: thr_x }`); `click_aria`
  clicks a control by accessible name (aria-label, else button text — e.g.
  the What's-new gift or the modal's Got it); `push_url` pushes a URL the
  mock router does not own — the shape of a link-out to main bb; `blur` takes
  an aria-label and lets that control's focus go
  (`{ blur: "Search threads" }`), the setup behind "click somewhere else"
  behavior — the search field's search button hides on it.
- Gestures run in the order the step declares them, so a pane-history step
  can sequence pushes and backs deliberately.
- `pane` (`{ threadId: thr_x }`, `{ open: false }`) reads the pane aside's
  aria-label; `active_card` reads the board's own `aria-current` marker plus
  whether the card is in view; `column_card_visible` (`thr_x`) asserts the
  card sits fully inside the columns board's own scroll viewport — the
  assertion for relocations that follow no active thread (the Pinned lane is
  far-left, and `card_visible`, the parent-lane board's rule, measures there)
  ; `url` (`{ suffix: "…" }`) asserts the browser
  URL's suffix — the honest record of pane-history behavior (do NOT assert
  `history.length`: Chrome reads it stale after a back-then-push sequence,
  the entry is added but the count lags); `whats_new` (`{ icon, unseen,
  modal }`) reads the gift button and modal (the pulse is the compiled
  `motion-safe:animate-pulse` class); `text_visible` checks a substring of
  the page's text, and `text_count` (`{ text, count }`) counts exact
  occurrences over the rendered text — how a suite proves ONE label or row
  exists where a duplicate would render a second.
- `hover_card` rests the real pointer on a top-level card's center
  (`{ card: thr_x }`), so the CSS `:hover` and the spotlight's `:has()` rule
  both arm the way an operator's idle pointer does; `mouse_to` parks it at
  plain viewport coordinates (`{ x, y, wait_ms }`). The `hover_prominence`
  assertion (`{ card }`, optional `pointer_hover: false` for the release case)
  samples the settled computed styles: the hovered surface must be opaque, the
  dark theme's surface may darken and the light theme's must NEVER darken
  (#195), and a sibling must recede while a card is under the pointer.
- `type` (`{ into: <aria-label>, text }`) focuses a labelled field and types
  through the browser's real input pipeline; add `clear: true` when the field
  opens prefilled (the picker's rename editor opens holding the group's
  name), so the keystrokes replace the value instead of appending to it.
- A step's `theme` (`light` or `dark`) overrides the suite default and flips
  BOTH theme switches: the `dark` class for the token set and Tailwind's
  media-based `dark:` utilities (`prefers-color-scheme` emulation) — the
  class alone cannot flip a `dark:` variant.
- `aria_present` / `aria_absent` (`Search`) assert a control by its exact aria-label — the visibility check for labelled icon buttons the page text cannot see (the search field's button).
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
- `scroll` also accepts `target: "columns"` to scroll the grouped column
  board (the default targets the parent-lane board's `[data-parent-board]`),
  for setups where the far end of the column board must sit offscreen before
  a gesture (e.g. pinning a card into the far-left Pinned lane).
- `wheel_pan` also accepts `over` — the same origin vocabulary `touch_pan`
  uses (`{ card }`, `{ between: [a, b] }`, `{ column, empty: true }`,
  `{ board: true }`) — so a wheel can be delivered on a card's own body or in
  the gap between two cards rather than the board's middle.
- `touch_pan` drives a real finger: `page.touchscreen` sends CDP
  `Input.dispatchTouchEvent` against the suite's touch viewport, so the
  browser's own gesture recognizer, the surface's `touch-action`, and its drag
  sources decide the outcome. The payload is `{ from, dx, dy }` plus optional
  `steps`, `step_ms`, `hold_ms` (a long press before the pan) and `settle_ms`.
  `from` is the origin vocabulary above. It leaves a reading in the page that
  four assertions read, and each FAILS when no pan ran in the step, so a step
  that forgot its gesture cannot pass vacuously:
  - `touch_origin` (`{ card, column }`) — what the finger actually landed on.
  - `touch_scroll` (`{ target: board|lane, axis: x|y, min, direction }`) — the
    scroll that gesture produced, read as a delta so a previous step's offset
    cannot satisfy it.
  - `no_native_drag: true` — the browser started no `dragstart` during the pan.
  - `touch_drag_armor` (`{ card }`) — the live-DOM touch contract: the viewport
    reports `(pointer: coarse)` and `(hover: none)`, no element of the board
    carries `draggable="true"`, the card's anchor is `draggable="false"` and
    computes `user-select: none`, and the board and lane lists declare
    `touch-action: manipulation` (both pan axes kept, never `none` and never a
    single axis).
- `drag_source` (`{ card, armed }`) — one card's `draggable` attribute, for both
  directions of the pointer rule: armed for a mouse, not armed for a finger.
- `scroll_offset` (`{ target: board|lane, column, axis, min?, max?, equals? }`)
  — the board's own offset, or one lane's card list's, so a scroll gesture can
  be proven against an `assert_before_drag` baseline.
- A synthetic touch never starts a platform drag. Chrome begins touch
  drag-and-drop from a long press inside its browser-side gesture pipeline,
  which `Input.dispatchTouchEvent` does not enter, so `touch_pan` can prove a
  pan happened and no drag started, but it cannot reproduce the lift that stole
  the pan on a real phone. That half is pinned as the live-DOM contract
  (`touch_drag_armor`, `drag_source`), which fails on a tree with armed drag
  sources at a coarse viewport.

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
- `uat-lane-reveal.yaml` — a menu action that relocates a card keeps the
  board legible: right-click Pin (plain card and a parent with nested
  children, whose whole family rides along), Mark Done, and Unpin — each from
  a scrolled view where the destination lane sits offscreen — all bring the
  relocated card into view once, while passive changes scroll nothing.
- `uat-whats-new.yaml` — the toolbar's gift button: an upgrade pulses it,
  opening the modal lists the delta and marks the version seen (the button
  stays), the quiet button still opens the full recent list, Escape closes
  the modal, and fresh installs / same-version revisits never pulse.
- `uat-glyph-glue.yaml` — the pane's inline-code open glyph in Chrome's real
  line breaker: a ~70-character workspace path in the fixture thread wraps
  in the 480px pane and the glyph stays glued to the path's last character,
  holding as the viewport shrinks; the probe refuses to pass vacuously when
  the span never wrapped.

- `uat-pane-archive.yaml` — the thread pane's archive path: opening the
  pane, Archive in the actions menu removes the card from the board while
  the pane stays open on the archived thread (the archived lookup keeps it
  resolvable), and the archived row's menu keeps its Unarchive as its only
  way out.
- `uat-pane-phone.yaml` — the phone pane at a 390×844 viewport: a card
  opens the full-screen sheet, the compact actions menu carries Full Screen
  (the standalone button is dropped on compact), and choosing it runs the
  maximize path (the mock's navigation is a no-op, so the pane stays).
- `uat-grandchildren.yaml` — the depth-2 (three-tier) family card in real
  Chrome: the grandchild sub-row renders under its parent row indented right
  of it, the family fold hides and restores the sub-row tier with the rows,
  ticket chips reach depth 2 (`child_chip` — pins PR #194's behavior and
  fails on a tree without it), and the card's right gutter holds at both
  depths (`right_gutter`, issue #192). The three-tier family is the base
  fixture's `thr_gutter_family` chain.
- `uat-hover-prominence.yaml` — hovered-card prominence in both themes (issue
  #195): the dark theme's hovered card darkens and the other cards recede, the
  light theme's hover never darkens the surface (darkening there reads as
  muting), and parking the pointer hands the surface and the dim back. The
  runner's `hover_card` gesture rests the real pointer on a card's center, and
  one suite covers both schemes via the per-step `theme` (which flips the
  `dark` class and Tailwind's media `dark:` variants together).
- `uat-attention-pulse.yaml` — the attention pulse's visible-only gate (issue
  #260): over `?attention=40` at a 390x844 viewport, the on-screen attention
  overlays animate while the off-screen ones hold still (the `attention_pulse`
  prober reads computed `animationName` per overlay, and judges visibility by
  the IntersectionObserver rule — the viewport intersected with each lane's own
  clipping container), and a `resize` to 1920x1080 re-runs the gate. The
  assertion demands at least one parked pulse, so the suite fails on a tree
  without the fix (verified: 0 of 42 parked before, 32 after).
- `uat-tap-latency.yaml` — the mobile tap-latency budget under real load
  conditions (issue #265). Declares `scale: 300` and `cpu_throttle: 4` at the
  suite level, so it runs on a 478-card board with a phone-class CPU, then
  times the tap that opens the pane and the tap that closes it against
  `gesture_budget: { max_ms: 600 }`, the number calibrated on the DEV harness
  the runner serves (open 410-472ms, close 364-377ms, plus headroom). Marked
  `manual: true` (see below): the sweep skips it and it runs by path, because
  taking it off opt-in is a separate decision.
- `uat-search.yaml` — the board toolbar's search box logic: a typed title
  query narrows the board and the search button appears in the field (issue
  #207), the button's click is the Enter-equivalent and — in real Chrome, the
  half jsdom cannot prove — leaves the field focused with the button still up,
  blur hides only the button, the clear x resets the board and the refocused
  empty field carries no button, a no-match query empties the board while the
  button still rides the field, and the id path reaches the same card.

- `uat-group-unique.yaml` — group names are unique, walked through the card
  menu's picker in real Chrome: creating "Alpha" from a second card settles
  onto the one existing Alpha group (one dashed box holds both cards), a
  rename onto the fixture's existing "chat-imagegent" is refused with the
  reason inline and the editor still open, and a rename to a free name
  commits and re-labels the box.

- `uat-family-state.yaml` — the family fold and idle-hide state lives on the
  server, not in browser localStorage: folding a family and clicking the
  idle-children eye write the `family_state_set` payload the mock's call log
  records, and a `goto` reload with a seeded `?familyState=` server row renders
  the fold and hide on mount. The harness holds one page, so two real windows
  and a second machine are beyond it; the jsdom two-document simulation
  (`tests/preferences-cross-window-sync.test.tsx`) covers the live
  cross-window convergence.

- `uat-board-views.yaml` — every board view variant on the desktop surface
  (Attention, Last activity, Project, Provider, Machine, Group, Threads, and
  the Parent-thread view): the lanes each grouping derives and, where the
  fixture's order is derivable, the cards' order inside them. The parent
  view's panning has its own suite (`uat-parent-lanes.yaml`).
- `uat-views-mobile.yaml` / `uat-views-tablet.yaml` — the views that matter
  at a phone (390×844) and tablet (768×1024) viewport, including the pane at
  phone width and a real drag on the horizontal lane read.
- `uat-lane-direction.yaml` — the lane-direction preference on the real
  board (issue #153): the vertical default, the horizontal rows on desktop,
  a drop, both insertion-line edges, and Alt+ArrowLeft/Right along the row,
  Alt+ArrowUp doing nothing on a horizontal board, and the Appearance tab
  flipping the open board live both ways. The runner's drag and line probes
  read the board's `data-lane-direction` and split on the flow axis, so a
  suite exercises whichever read the page mounts.
- `uat-board-touch.yaml` — the board surface under a real finger at 390×844
  with `hasTouch` + `isMobile` (issue #328, the phone report): the vertical and
  horizontal boards arm no native drag source and no selectable card text, and
  real CDP touch pans scroll the board whether the finger lands on a card, in
  the gap between two cards, on an empty lane, on the board's own padding, or
  after a 550ms long-press hold — with no `dragstart` and no rank write, in both
  lane layouts. The rows board also scrolls vertically as a board and
  horizontally per row.
- `uat-board-drag-surface.yaml` — the same surface under a desktop pointer
  (issue #328's second question, "horizontal scrolling issues on desktop
  too?"): a cursor drag still reorders in both lane layouts (with the row's
  left/right insertion edges), a horizontal wheel delivered on a card or in the
  gap between two cards pans the column board, and a vertical wheel on a row
  card pans the rows board. It also records the desktop truth the phone suite
  hides: at a wide viewport the rows fit their slot, so a horizontal wheel over
  a row card must move nothing.
- `uat-host-push-races.yaml` — live host pushes raced against in-flight
  gestures: the mock's sidebar is now a real reactive store, so a push
  update (the `push_update` gesture) can promote, lift, or reseat a card
  WHILE an insertion-line hover is armed, with the board invariants
  asserting the aftermath.
- `uat-fuzz.yaml` — the gesture fuzz (model-based): `fuzz: { steps, seed }`
  picks gestures off the live DOM (drags with every edge, state drops,
  keyboard through the browser's REAL key delivery, pointer clicks, menu
  actions, host pushes, Escape) and asserts the board invariants after
  every one. Deterministic per seed; a failure prints the trail.

## Invariants (suite-level `invariants: true`)

Three board laws asserted after every step (opt out per step with
`invariants: false`): one top-level lane per thread (the Done projection's
family card the only legal second home), a lane's displayed cards that
appear in its stored rank keep the stored relative order, and no refusal
banner on screen — except the board's own `resolved to no move` report: a
release whose insertion slot already holds the dragged card is a correct
no-op refusal, not a break, and a random drag reaches it by dropping a card
onto its own neighbour.

## Matrix (suite-level `matrix: { viewports, themes }`)

Every declared cell (viewport × theme) re-runs the suite's same steps and
writes its own report (`<suite>.vWxH-theme.md`), so a regression names its
cell. Cheap suites matrix on both axes; heavy ones stay single-cell.

## Other runner knobs

- `shots: true` captures a per-step PNG under `docs/uat/shots/` (gitignored;
  artifacts for humans, no pixel diffing).
- `push_update: { threadId, patch }` — a host push whose patch (status,
  unread, pending flag) lands mid-step, racing whatever is in flight.
- `wheel_pan` accepts `{ dx, dy, target }` (the columns board included).
- `hover` with `{ from, to, edge }` arms a card's insertion line as a
  gesture (the setup half the race suites need); without a `from` it keeps
  the board-area hover behavior it already had.
- Ports hand out from a pid-derived random base (two concurrent UAT
  sessions on one repo no longer collide), the harness child spawns vite
  directly so a strictPort failure names itself instead of riding another
  runner's server, and a taken port retries a few slots ahead.

## Manual (opt-in) suites

A suite may declare `manual: true` at its top level:

```yaml
suite: tap-latency
manual: true
```

A manual suite is skipped by the default sweep (`npm run uat` with no
arguments — which `npm run release-safety` calls) and runs only when its file
is named on the command line:

```
npm run uat -- tests/manual/uat-tap-latency.yaml
```

The runner prints the skipped files at the end of a sweep, so a left-out gate
is visible rather than silently missing. Use it for a gate whose budget is
currently red for a reason unrelated to the change being landed (a budget
calibrated on a build the runner does not serve, for example): the gate stays
real and runnable on demand, but it cannot wedge every release. A non-boolean
`manual` value fails the run, because either mistake — staying in or dropping
out of the sweep — changes which gates run.

## Load conditions (issue #266)

A suite may declare the load it runs under in `defaults`, and it applies to
every step of that suite:

```yaml
defaults:
  viewport: { width: 390, height: 844 }
  scale: 300          # append 300 synthetic threads (mock-sdk `?scale=N`)
  attention: 40       # append 40 all-attention threads (`?attention=N`)
  cpu_throttle: 4     # CDP Emulation.setCPUThrottlingRate — a phone-class CPU
  network: slow3g     # CDP network throttling: none | fast3g | slow3g
```

- `scale` and `attention` ride the `goto` URL, so the mock SDK's existing
  fixtures load. A step's own query value wins, so one step in a scaled suite
  can still load the base fixture with `goto: "?scale=0"`.
- `cpu_throttle` and `network` are applied to the page through a CDP session,
  per suite, so they never leak into the next suite. `network: none` is
  throttling OFF, which measures the CPU alone.
- A bad value (a negative number, a misspelled preset) fails the run before
  the browser launches. A perf suite that silently ran unthrottled would pass
  for the wrong reason, which is the failure this feature exists to prevent.
- The pure helpers live in `scripts/uat/load-conditions.mjs` and are pinned by
  `tests/uat-load-conditions.test.ts`. The gesture-settle clock lives in
  `scripts/uat/settle-clock.mjs` and is pinned by
  `tests/uat-settle-clock.test.ts`.

## Two windows (`defaults.windows: 2`)

bb's second window learns about a write through a realtime signal and a
refetch. To assert that, a suite can open a SECOND live document over the same
mocked host:

```yaml
defaults:
  windows: 2

steps:
  - id: fold-in-window-a
    goto: "?demo=1"
    click_aria: { label: "3 child threads", within: thr_demo_needs }
  - id: window-b-follows
    page: peer
    assert:
      - dot_order: { family: thr_demo_needs, dots: [thr_demo_needs_c0] }
```

- Both pages load the same `?sharedHost=<token>` query. That token turns on the
  harness's cross-window host row (`scripts/screenshot/host-log.ts` +
  `host-state.ts`): every host write (done marks, family fold and hide-idle,
  group registry and assignments, rank moves) is appended as one record to the
  page pair's own log in localStorage, and the browser's `storage` event
  delivers it to the other document, which applies the SAME function and fires
  the realtime signal, so the second window refetches exactly as bb's does.
- `page: peer` runs a step against the second window. Omit it (or write
  `page: main`) for the first. A step that names the peer in a suite without
  `windows: 2` fails the run rather than quietly driving the first window.
- No reload between the write and the assertion: a step that forgot to stay
  put would prove the replay, not the live signal. `tests/manual/uat-two-windows.yaml`
  is the gate on the whole path.
- The token is fresh per suite run, so records from an earlier run or another
  suite can never replay into this one.

A step may time its own gesture with a budget:

```yaml
- id: a-tap-opens-the-pane-within-budget
  gestures:
    - click: { card: thr_uat_queue }
  assert:
    - gesture_budget: { gesture: click, max_ms: 600 }
```

The measurement is the gesture's own round trip in page time — dispatch to
the DOM going quiet for two animation frames — so the runner's own `sleep`
waits and the CDP round trip are not part of the number. A missing reading is
a FAIL, never a silent pass. `gesture` names which timed gesture to check
(omit it to judge the step's last timed gesture).

## Notes

- The first step is the one every other step used to assume. A suite that
  seeds a stored order before each step will happily pass while the feature is
  unreachable on a fresh install, so keep the reachability step first and keep
  it unseeded.
- `scripts/uat/probe-reachability.mjs` is a standalone version of that same
  question, for when you want the answer without the rest of the suite.
