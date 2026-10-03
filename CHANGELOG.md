# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **New threads compose inside the board.** The toolbar, column, and
  parent-lane new-thread buttons now open bb's full compose surface in a
  modal over the board and pane instead of bb's new-thread window: a
  single-project filter still seeds the project picker, submit spawns the
  thread and opens it in the pane, a failed create keeps the draft with an
  on-screen error, and Escape inside the modal closes only the modal.

## [0.6.0] - 2026-10-03

### Added

- **A family's done work now renders as a projection card in the Done
  column.** Done children no longer nest under the family's active card —
  they move to the Done column under a projection of the parent's card
  (dimmed, with the done children nested beneath it), so a family can live in
  both spaces at once: the live portion in its attention lane, the done
  portion in Done. A done parent keeps its single Done card with its done
  children nested. Each card's child-count chip counts its own space, and a
  projection card refuses sweep selection (it is not a done thread).
  - **Big families scroll inside their card.** When a family card nests more
    than five child rows, the list caps its height and scrolls; five or fewer
    render at natural height as before. The collapse chevron still hides the
    whole list.
  - **Archived children are now hidden outright, everywhere.** They no
    longer render as dimmed rows under the family card on the Attention
    board or as riders under the family header in the Parent-thread view —
    archiving a thread removes it from the board completely, matching bb's
    sidebar. Child chips count only visible children, and the children of an
    archived parent now render as standalone cards instead of vanishing
    under a card that never renders.

- **Filter dropdowns with a search bar gain a select-all checkbox.** The
  checkbox sits left of the search bar and covers the rows the search
  currently shows: click selects every visible option in one commit (the
  menu stays open), clicking again deselects them, and a partial selection
  shows mixed. Applies to the Project and Provider dropdowns; the State
  dropdown has no search bar and the Group control is single-choice, so
  neither grows one.
  - **Enter applies a sole dropdown search match.** When a filter dropdown's
    search has narrowed the list to one row, pressing Enter selects it and
    closes the menu like clicking the row; with more matches or none, Enter
    stays inert.

### Changed

- **Developer toggle: pane chat scroll instrumentation.** A new off-by-default
  Focus Board setting logs the thread pane transcript's scroll activity
  while enabled — programmatic `scrollTop` writes with stacks, the gesture
  stream, a copyable log in the pane header (`docs/chat-click-jump-2026-09-29.md`).

- **Brand icon restored as the lane + card mark and now renders as drawn.**
  bb masks plugin icon assets off alpha coverage, and the E1 stroked-outline
  cut hollowed at icon sizes — the bold lane's hollow interior read as dark
  breaks around the solid pupil, so the served mark looked glitched
  ("clobbered"). The asset and inline `FocusBoard` element are now solid
  alpha geometry: three flush-top columns whose side lanes ride as dim
  fills (the right one short of the others), an opaque inverted middle
  lane, and a card punched through that lane as an evenodd hole — one
  `currentColor` asset that themes itself on light and dark surfaces,
  renderer-proof at any size. A `tests/brand-icon.test.ts` coverage matrix
  pins the asset and the inline element to the same mask-safe rules.
  - **The sidebar row and pane title bar now draw the mark too.** Their
    registration hardcoded a `Columns2` placeholder since the plugin's first
    commit - the manifest `branding.icon` only covers Settings surfaces, and
    an earlier bb build that preferred the manifest mark on the nav surfaces
    had quietly hidden the placeholder. After the Oct 2 bb app update that
    preference went away and the placeholder came back. The nav panel now
    registers the brand mark in bb's app-wide icon registry (`FocusBoard`)
    and draws it on both surfaces, tinted and mask-safe like every other
    plugin glyph.

- **The sweep is rebuilt around choosing exactly what gets archived, and
  idle threads now resurface instead of vanishing.** The Done and
  A-while-ago columns' sweep grew a manual selection flow, a mid-run stop,
  and a gentler fate for quiet threads:
  - **Sweep mode is now manual: enter it any time and click cards to choose
    exactly what gets archived.** The sweep button stays visible on the Done
    and A-while-ago columns even when nothing is past the threshold; entering
    sweep mode pre-selects the past-threshold threads, clicking a card
    toggles it in or out (clicking away or Escape exits), and a thread that
    still has live children refuses with an on-screen note instead of
    silently doing nothing.
  - **The long-idle sweep now marks threads Done instead of archiving them.**
    Confirming a sweep on the Idle · A-while-ago column sends its quiet threads
    to the Done column — the same mark-dragging a card there performs — instead
    of straight to the archive; the fresh done stamp starts the Done-arm clock,
    so they resurface in the Done sweep and archive only after aging there. The
    Done column's own sweep still archives. A cancelled sweep's Undo unmarks
    Done for these threads instead of unarchiving. The CLI sweep mirrors this:
    with `--confirm`, Done-age threads archive and long-idle threads are marked
    Done (`sweep --json` now reports `archived` and `markedDone` separately).
  - **A sweep can be cancelled, not only confirmed.** An X beside the sweep
    pill exits sweep mode, and during a run it stops the loop: the archive in
    flight finishes, nothing else is swept, and the untouched cards stay
    selected for inspection or a retry. When the stop landed after threads
    had already archived, the notice offers an explicit Undo that restores
    exactly the ids the run archived.
  - **Selecting cards for a sweep no longer reshuffles the column.** Selected
    cards highlight where they sit and the list never reorders, so
    deselecting cannot jump cards around mid-gesture; scroll to see the full
    blast radius.
  - **Confirming a sweep now archives every highlighted candidate, not just
    one.** bb's sidebar archive aborts the previous in-flight archive when a
    new one starts, so the sweep's confirm loop was losing all but the last
    candidate; each archive is now awaited in turn, the running sweep shows a
    throbber on the card being archived, keeps the highlight on the rest, and
    reads "Sweeping N of M" on its button until the loop finishes. A failed
    archive keeps its card highlighted for a one-click retry and says so in a
    dismissible banner.

- **Pinned cards now carry their thread's state both ways: read state and
  needs-you.**
  - **Marking a card unread sends a parked card back to Pinned from any
    surface** — bb's native thread menu, the board's menu, the pane toggle,
    or a drop onto the Unread lane — and clears a contradicting Done mark;
    ambient thread noise never moves cards.
  - **A pinned family with a member that needs you now calls attention from
    inside Pinned.** A pinned family cannot relocate to a Needs-you lane
    (pinned threads split out before the family-column overrides read), so a
    child thread's question used to sit silent inside a card that read idle.
    Now the pinned parent card pulses — an amber border, the changelog gift's
    pulse language — shows its question icon, and rises to the top of the
    Pinned lane (above manual ranks, like urgent child rows do); the signal
    vanishes when the question is answered.

### Removed

- **The thread pane's project/branch footer line is gone.** A recent bb
  composer build shows the working context in the composer itself, so the
  plugin no longer repeats project and branch under the pane's composer; the
  pane ends with the transcript.

### Fixed

- **Menu moves bring the destination lane into view.** The keep-in-view
  contract followed the pane's active card on relocation, but a right-click
  menu move relocates a card the pane never opened — "Pin thread" sends a
  parent's whole nested family into the far-left Pinned lane — and in a
  scrolled board the destination could sit offscreen: the action read as the
  card silently vanishing. Every menu action that relocates a card (Pin,
  Unpin, Mark Done/Not Done, Mark Read/Unread) now issues a one-shot reveal
  that brings the card's new lane into view; it lands in the same commit as
  the relocation (async host actions included), a visible destination scrolls
  nothing, and passive changes still never move your scroll.

- **Clicking in the pane's chat no longer yanks the transcript to the
  newest message while the reader is scrolled up.** The pane's click-jump
  guard now arms on the position recorded at the gesture's pointerdown —
  captured before the host shell's pending-capture clamp commits — and
  restores it when a click lands the transcript pinned at the bottom
  within ~200ms. Armed on the click-time read, the guard never fired at
  all: the clamp lands during the pointerdown edge, so the fresh read was
  already past the write and the reader stayed clamped (exposed by a live
  adversarial run inside the guard's own design band). The settled-view
  refusals of the previous fix survive only for clicks with no pointer
  event (programmatic flows); reader gestures in the window still disarm
  it, and pill and composer clicks never arm it
  (`docs/chat-click-jump-2026-09-29.md`).
## [0.5.21] - 2026-09-30

### Added

- **Escape stops a running thread before closing the pane.** Pressing Escape
  while a pane's thread is running interrupts the turn instead of dismissing
  it; the pane closes with Escape only once nothing is running (stopping
  keeps it open until the stop settles). The behavior is a declarative
  plugin setting — default on, toggle in the plugin detail page's
  configuration panel — read reactively on the board, and a gear in the
  sidebar footer opens that panel (bb's sidebar entry context menu is
  host-owned with no plugin extension point).

### Changed

- **Pinned cards take the pin when they leave the lane.** Any gesture that
  moves a pinned card out of the Pinned column — a drop onto Unread or Done,
  or "Mark done" in the card's menu — unpins as part of the same gesture:
  column placement is derived from the pin, so leaving the pin in place
  would bounce the card straight back into Pinned on the next grouping
  pass. "Mark not done" restores the card's column membership, not the pin.
- **Columns drained to zero by nesting hide themselves.** When every card in
  a column is a nested child — the parent carries its whole family into the
  family column — the drained lane would park an empty header beside columns
  that all earn their place; it now hides entirely and reappears when a card
  returns, keeping the "columns exist only while they hold cards" rule.

## [0.5.20] - 2026-09-30

### Changed

- **Dropping a card into a new column can place it there in the same drag.**
  Moving a card across lanes — Unread → Pinned, anything → Done — used to be a
  bare state change: the card landed wherever the lane's default order put it,
  and placing it meant a second drag inside the new column. Now the insertion
  line shows while the drag hovers over a card there, and the drop pins, marks
  done, or marks unread **and** writes the rank in one gesture. Dropping over
  the column's empty space is unchanged (state change only, no rank write).

## [0.5.19] - 2026-09-29

### Added

- **Clicking in the pane's chat no longer yanks the transcript back to the
  bottom.** Clicking in the transcript while it is scrolled up could jump the
  view to the newest message ("up half a page or so"): bb's page-shell
  `bottom-anchor` scroll manager keeps a pending scroll-anchor capture from
  the older-rows preload, consumes it after every React commit by mixing a
  live-applied scrollTop with a stale captured scrollHeight, overshoots the
  real maximum, and the clamp lands at the bottom. The SDK exposes no access
  to that pending capture, so the pane arms a defensive revert around
  clicks: a left click while scrolled up by at least 96px snapshots the
  position, and a clamp-to-bottom landing within ~200ms is reverted through
  the manager's own gesture path (an untrusted wheel event opens its
  disengage window first, so the revert survives the manager's
  resize-driven re-pin). Clicks on the "Scroll to latest event" pill and in
  the composer never arm the guard (they legitimately re-pin), and reader
  gestures in the window (wheel, touch, scroll keys) disarm it, so it never
  fights the reader's own scrolling. Findings, verified mechanism, the
  suggested upstream fix, and the deletion condition for this workaround:
  `docs/chat-click-jump-2026-09-29.md`. Scroller discovery also falls back
  to the click's own scroll container if an upstream rename removes the
  `.thread-scrollbar` marker class before the host fix lands
  (`tests/chat-jump-guard.test.ts`, 15 cases).

## [0.5.18] - 2026-09-29
### Fixed

- **Answering a question now clears the card from Needs you right away.** The
  board read its needs-you state from bb's sidebar thread cache, which could
  keep a stale flag after the server had already settled the interaction: the
  answered card stayed in the Needs-you column until something unrelated
  refreshed the list. The board now verifies every interaction change against
  the interaction records and corrects the card's state the moment a question
  is answered (or asked).

## [0.5.17] - 2026-09-29

### Changed

- **Parent lanes now size to fit their cards, and the selected family renders as a wide, readable ruler lane.** The locked ruler lane holds large readable cards while context lanes wrap compact cards capped by the viewport width.
- **Panning releases the lane lock, and at rest the nearest family pins flush into position.** One re-cut: clicked subtasks stay visible through the motion, seams stay aligned, and the board settles quiet (regression-tested with a real wheel-event pan in the UAT suite).
- **The lane-order toggle moves into the status rail as a vertical picker.** Viewport resizes while a lane is locked keep the ruler and band alignment, and clicking a lane header during an in-flight glide wins the lock over the pan's target.

## [0.5.16] - 2026-09-29

### Changed

- **No user-visible board changes.** The What's-new modal restates the
  0.5.15 notes; release documentation updates only.

## [0.5.15] - 2026-09-28

### Fixed

- **Dragging a card onto the Pinned lane now pins it.** Pinned was the one
  visible lane that had no cross-column drop handler — only Done ("mark
  done") and Unread ("mark unread") accepted drops — so a drag from Unread
  to Pinned was refused by the browser (no-drop cursor) and pinning needed
  the card's right-click menu. A drop on Pinned now pins, like a Done drop
  marks done. The pin writes no lane rank order and refuses nothing; cards
  already pinned keep their reorder gesture. The UAT suite's cross-lane
  refusal check moved to a plain lane, and a new step pins this gesture for
  real (`tests/manual/uat-rank.yaml`).

## [0.5.14] - 2026-09-28

### Added

- **Full Screen moves into the phone thread pane's actions menu.** A phone pane covered the whole board as a full-screen sheet but hid the maximise icon that desktop shows next to the header, so reaching the main thread view (with its full message routing and question handling) was impossible from the pane. The "More thread actions" menu now offers "Full Screen" on compact viewports, calling the same navigation as the desktop button; desktop keeps the visible button and the menu does not duplicate it (`tests/thread-pane-actions.test.tsx`, red-test first).

## [0.5.13] - 2026-09-28

### Added

- **Parent thread lanes.** The Group-by dropdown now offers "Parent thread",
  which pivots the Attention board so that each vertical lane is a parent
  thread and the horizontal rows are the attention ladder (Needs you,
  Unread, Working, idle age buckets, Done). Only children render as cards;
  the parent is a clickable lane header with a state dot and child-count
  chip. A catch-all "Standalone" lane holds threads with no family. Lane
  order defaults to family recency (most recently touched-or-responded
  family at left, done children included), with a persisted toggle to group
  lanes into project sections instead; the Standalone lane always trails.
  The Done row sorts by done-recency; archived children ride under the
  header. Sweep arming and stored lane order are deferred.

## [0.5.5] — 2026-09-28

### Changed

- **Inline-code workspace paths now verify against the workspace before
  they become clickable in the board's thread pane.** A path is
  decorated (and clickable) only when the plugin backend confirms the
  file exists in the thread's environment — checked on the
  environment's own host, so remote workspaces verify correctly. Dead
  names stay plain text: a bare `.md`, a path the model only planned,
  or anything the workspace does not have no longer invites a preview
  that opens nothing. Explicit markdown links keep the 0.5.3 behavior.

## [0.5.4] — 2026-09-28

### Added

- **Recent decisions card in the thread pane.** bb's transcript drops every trace of an answered AskUserQuestion — the tool call is suppressed, the delivered result is a hidden system message, and the interaction row stores only "Submitted", never the answers — so once a question card was submitted, the pane forgot what was decided. The pane now shows a collapsed "Recent decisions" card (up to five) rebuilt from the raw event log, listing each question's header chip, prompt, and chosen answer; it auto-expands when a fresh answer lands and collapses with Escape.

## [0.5.3] — 2026-09-28

### Fixed

- **Backticked workspace paths in thread messages are now clickable in the
  board's thread pane.** The main thread pane turns inline code like
  `docs/rfcs/rfc-support-triage-process.md` into a file-preview link; the
  board's pane rendered the same text as dead code. Clicking a qualifying
  path (a workspace-relative `.md`/`.markdown` file, optionally with a
  `:12` or `#L12-L20` suffix) now opens the file preview, and qualifying
  code spans gain the same underline and external-link icon the main pane
  shows. Commit shas, `.ts` files, and block code stay plain, matching the
  main pane's rules.

## [0.5.2] — 2026-09-28

### Fixed

- **Right-clicking a nested child thread opened the parent card's menu on top
  of the child's.** The child row's own menu did open, but the right-click
  also bubbled up to the parent card's menu wrapper, so the parent's actions
  covered it and the child's actions were unreachable. The right-click no
  longer propagates past the card it hit. Every card menu now also names the
  thread it acts on: the menu opens with a muted header line showing the
  thread's title.

## [0.5.1] — 2026-09-28

### Added

- **The Done column now sorts by when each thread was marked done, newest
  first**, instead of by the board's newest-activity order. Dragging a card
  inside Done still applies a manual order on top of that default, exactly
  as in every other column; a thread whose done stamp is unknown falls below
  recorded ones rather than being assumed just done.

## [0.5.0] — 2026-09-28

### Added

- **The open pane now lives in the panel's URL, so bb's back arrow restores
  it.** Opening (or switching) a card's pane pushes a panel route
  (`…/board/t/<threadId>`); a link-out to the full thread in main bb, a
  reload, or a shared deep link all return to the pane the user left — and
  back walks the trail of cards they lost track of, one pane per step.
  Closing the pane (×, Escape, the phone back chevron) pushes the panel
  root, so back after a close reopens the pane — close is never lost work —
  and forward re-closes it. A host whose route owner cannot push degrades
  to plain component state — the pane still opens, just without URL
  restoration. The board also keeps the active card in view: horizontally
  and vertically when a pane is restored from history (a deep link or back
  navigation has no click to have brought the card into view), and whenever
  the active card relocates to another lane — pin/unpin, done, archive, or
  a grouping change. Same-lane data refreshes never yank the user's scroll.
- **What's new**: a gift button in the toolbar lists recent changes after an
  update. It pulses until opened (opening marks the version seen); the
  button never disappears, so the changelog stays reachable. Fresh installs
  are stamped silently — no pulse for a first visit. The condensed list
  ships in the bundle (`lib/whats-new.ts`) and is pinned to
  `package.json`'s version by a test.

### Fixed

- **The screenshot harness no longer render-loops.** The mock SDK returned a
  fresh `useSdk()` object every render while the app holds it in effect deps
  and its handlers setState on resolve — an endless setState → render →
  new-sdk → setState loop (~1000 renders/s) that could eventually wedge the
  page. The mock now returns one stable client, as the real host does.

## [0.4.6] — 2026-09-27

### Added

- **Click an empty area of the board to close the thread pane.** Clicking
  anywhere on the board that is not a card, button, link, input, or menu
  closes the open thread pane, matching the host's click-away behavior.
  Clicks on cards, controls, and card menus are unaffected.

## [0.4.5] — 2026-09-27

### Fixed

- **The first drag-and-drop reorder in a column silently did nothing unless
  the drop landed at the very top.** The rank model is sparse, and a first
  move ranked only the dragged card — which the comparator then sorts above
  every unranked card, so "drop below the second card" re-sorted nothing.
  Moves now also rank every card ABOVE the drop point (the smallest write
  that honours the intent); cards below it stay unranked, preserving the
  leave-a-gap, re-enter-in-the-gap property. Applies to mouse drops, empty-
  space drops, and Alt+Arrow keyboard moves.


## [0.4.4] — 2026-09-27

### Fixed

- **Thread mention links in pane messages were swallowed.** The 0.4.3 link
  interceptor treated every relative anchor as a workspace file, so mention
  chips rendering as `/threads/thr_...` anchors stopped navigating. The
  interceptor now mirrors the host's own local-file routing heuristic: only
  destinations whose final segment contains a dot are treated as files, and
  bb's line/column suffixes (`:12`, `:12-20`, `:12:5`, `#L12-L20`) are
  stripped before resolving the path.

## [0.4.3] — 2026-09-27

### Fixed

- **Relative file links in pane messages no longer open as broken browser
  URLs.** A message like `[ERD](docs/erd.mmd)` rendered as an anchor the
  browser resolved against the bb app origin, landing on an error page. The
  pane now intercepts left-clicks on relative anchors and reopens the target
  as a live workspace file in bb's preview panel, resolved against the
  thread's environment. Absolute URLs and fragment links keep native
  routing; `../` climbs that escape the workspace root are refused.

## [0.4.2] — 2026-09-27

### Fixed

- **Rank refusal banners could not be dismissed.** The "Reorder refused"
  banner sat over the board until the next drag. It now has an X button, and
  auto-dismisses after 10 seconds — generous, so it is never gone before it
  was read. A repeat refusal restarts the timer rather than inheriting a
  stale one.

## [0.4.1] — 2026-09-27

### Fixed

- **Selected option indicators were invisible in the pane question form.**
  The check rendered in `primary-foreground` on a transparent border, and
  this theme's `primary` is not a strong fill, so picking an answer looked
  like nothing happened. Selected options now fill foreground-on-background,
  matching the plugin's own checkbox (radio-shaped for single-select, square
  for multi-select). Selection logic was always correct; only the visual was
  missing.

## [0.4.0] — 2026-09-27

### Added

- **Per-column card rank ordering.** Drag cards up and down inside a column to
  put them in your own order instead of the board's recency order.
  - Order is stored per column, not per thread, so it describes the column's
    reading order. A card that leaves a column and comes back returns to the
    slot it left, because the stored order is a sparse list of thread ids that
    is never renumbered.
  - The Pinned and Done lanes keep one order across every grouping; other
    lanes are namespaced by grouping, so a project named "unread" cannot
    collide with the Attention lane.
  - **Seed on first intent**: no setup step and no toggle. Every card is a
    drop target for its own lane, the insertion line appears on hover, and the
    first drop writes the order. A lane with a stored order says so in its
    header, so a card sitting out of recency order does not read as a bug.
  - **Keyboard parity**: Alt+ArrowUp / Alt+ArrowDown moves a focused card one
    slot, and each move is announced in a live region. A drag-only reorder is
    a reorder half the people cannot do.
  - Drop on a card's top half to land in front of it, bottom half to land past
    it, or below the last card to append. Dropping a card on itself, or
    dragging into a different lane's order, writes nothing.
- **The pane question form reaches parity with the host's shipped
  QuestionForm.** The pending question card no longer renders as a stacked
  long form. Sequential questions sit behind a scrollable tab strip with a
  N-of-M counter and Back/Next; the banner collapses (Escape collapses it
  before the pane closes); the form body is height-capped and scrolls
  internally so the transcript keeps its space, which was blocking the phone
  layout. Free-text-only questions (the common provider shape) open with the
  textarea visible, number keys 1-N select options, and the form also disables
  while the interaction's server-side status is `resolving`, with stale
  selections filtered before submission. Analysis of the original gaps is in
  `docs/pane-question-gap-analysis.md`.

### Changed

- **The board's cards and lanes carry drag-testability attributes.** The
  board marks each lane and each card with `data-column-id`,
  `data-column-ordered`, and `data-rank-slot` attributes, which the UAT
  harness reads to drive real drag gestures.
- **The screenshot harness simulates a third unread thread.** The simulated
  board gained an in-memory rank store, and the screenshots are regenerated
  to match.

### Fixed

- **Screenshot runs stop failing two runs in three.** The script flipped
  one shared page's viewport between shots (`TargetCloseError` on
  `Emulation.setTouchEmulationEnabled`); each shot now gets its own page
  with the viewport set once.

## [0.3.5] — 2026-09-26

### Fixed

- **The selected card stays in view when the thread pane opens.** The pane
  squeezes the board, which could leave the open thread's card clipped off
  to the right; the board's horizontal scroller now keeps the active card
  (parent card or nested child row) in the visible range when the pane
  opens or is drag-resized.

## [0.3.4] — 2026-09-26

### Fixed

- **Agent questions are answerable from the thread pane.** The pane now
  renders a pending question as a real form and submits the answer from the
  board — the host's embedded chat only shows these in the main thread
  view, so the question tool used to block until timeout while the pane
  showed nothing.
  Both payload shapes are handled: provider `user_question` interactions
  (answered through `interactions.resolve`; dismissing one stops the turn,
  like the main view) and plugin forms with the ask-user-question shape
  (answered through `interactions.respond`; Dismiss cancels). Provider
  extension requests get an "Open in main view" fallback, and unrenderable
  plugin forms keep it too.

## [0.3.3] — 2026-09-26

### Added

- **New threads inherit the single selected project filter.** When exactly
  one project is selected in the filter, the toolbar's new thread button
  and the board's new task affordance create the thread in that project.
  With no or multiple projects selected, bb's default project pick
  applies, and a stale filter id (project deleted since) falls back to
  the default as well.

## [0.3.2] — 2026-09-26

### Added

- **Long filter dropdowns gain a search bar** (#8). Project and Provider
  dropdowns (and any other option list past five rows) now open with a
  search field, matching the model picker's affordance. Matching is
  a case-insensitive substring on the label, the field takes focus on open,
  Escape clears the query then closes, and reopening starts blank. Short
  lists (State) keep their plain rows.

## [0.3.1] — 2026-09-25

### Changed

- **The plugin is renamed to Focus Board** (#8). The package is
  `bb-plugin-focus-board`, the plugin ID `focus-board`, the CLI
  `bb focus-board`, and the `focus-board:` preference keys. Saved
  grouping/filter/search preferences reset once on update.
  Repository moved to
  [github.com/cristoslc/bb-plugin-focus-board](https://github.com/cristoslc/bb-plugin-focus-board)
  (the old URL redirects).

## [0.3.0] — 2026-09-25

### Added

- **The new `bb thread-board` CLI manages the plugin's own state** (#6).
  It is a third surface over the same Done/metadata store, never a
  re-spelling of `bb thread`:
  - `bb thread-board done list|mark|clear` — list done threads (with
    `doneAt`, `keep`, and a `not in the live thread list` flag; orphaned
    marks on deleted threads survive via a `done-index` KV), stamp Done
    (idempotent, refreshes `doneAt`), clear it. Agents get free Done
    marking.
  - `bb thread-board sweep [--ids …] [--confirm]` — dry-run prints the
    eligible set and exits 1, never archiving without `--confirm`;
    `--ids` freezes the blast radius to the named threads. `keep`, pinned,
    and already-archived threads are never eligible.
  - `bb thread-board config show|set` — read and set the sweep thresholds
    (`doneArchiveDays`, `idleArchiveDays`) without learning
    `bb plugin config` syntax.

## [0.2.0] — 2026-09-25

The day's four sashays plus the nesting refinement round, merged in sequence:
done-metadata foundation → sweep → tracker mirroring → nesting refinements.

### Added

- **Done state moves to per-thread plugin metadata** (#4), server-side and
  surviving across devices and reloads. It lives in the board's own
  namespace (`done` → `{ doneAt, keep? }`); a legacy-KV migration shim
  imports both earlier shapes (bare ids, epoch-ms record maps) on first
  read, idempotently, fail-loud on malformed data.
- **The sweep arms with a first click and performs with a second** (#1):
  arm-then-confirm buttons sit on the Done and Awhile-ago columns. First
  click arms (button shows `?`, eligible cards gather and highlight, count
  frozen at arm time); second click performs; click-away or Escape disarms. Thresholds `doneArchiveDays` (7) and `idleArchiveDays`
  (30) via plugin settings; per-thread "Keep from sweep" override honored
  by both arms, stored independently so never-Done threads can be kept.
- **Ticket chips render and link out from titles and branches** (#2).
  `PROJ-123`, `#1284`, and GitHub issue/PR URLs show as chips; inert when
  the project has no GitHub remote.
- **GitHub status dots appear on matching chips** (#2, optional). The
  server reads the official GitHub plugin's local cache read-only and puts
  open/closed/merged dots on matching chips; a missing cache degrades to
  chip-only rendering — the board never breaks.
- **Threads spawned as children nest under their parent card** (#3) as
  collapsible rows, Jira-subissue style. A needs-you child is promoted to
  its own column so it is never buried; a 2-level depth cap surfaces a
  `+N more` chip; filtering is family-aware; a defensive family index
  orphans to roots and unlinks cycles.
- **Child rows gain full titles, and archived children stay nested** (#5).
  Child rows carry the full title (up to two lines); archived children stay
  nested under their live parent, dimmed with an archived mark; a "Nest
  child threads" toolbar toggle flattens the board to independent cards
  (nesting off = fully flat, filters per-thread).

### Changed

- **`done_list` returns richer Done records.** The payload is
  `{ doneIds, records }`, where records carry the ISO-8601 `doneAt` stamp
  and `keep` flag the sweep and (future) CLI consume.
- **The `done-changed` realtime payload narrows to the thread.** It is
  `{ threadId, done }` (was `{ count }`); keep-flag writes publish the same
  signal.
- **The README's "makes no server-side writes" wording is corrected.** It
  now describes what the board actually owns (pin state, read state, Done —
  never thread content).
