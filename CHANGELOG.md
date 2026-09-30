# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Developer toggle: pane chat scroll instrumentation.** A new Focus Board
  setting ("Developer: instrument pane chat scrolling (debug)"), shipped
  off for every build, attaches a bounded instrumentation session to the
  thread pane's chat transcript while enabled: every programmatic
  `scrollTop` write with its calling stack (flagged when it overshoots the
  scroller's live range, the click-jump capture shape), the scroll/wheel/
  touch/pointer-intent stream, 1 Hz geometry samples, and a copyable log
  from the pane header. Developer investigation tooling for the pane
  chat's click-jump displacement — `docs/chat-click-jump-2026-09-29.md`.

### Changed

- **Narrow a dropdown search to one match and Enter applies it.** When a filter
  dropdown's search field (Project, Provider, Group, State) has filtered the
  list down to a single remaining row, pressing Enter in the field now does
  what clicking that row does: applies it as the selection and closes the
  menu. With two or more matches, or none, Enter stays inert.

- **Marking a card unread now restores it up the attention ladder from any
  surface.** With the parked-pin model, a pinned card marked unread (or
  done) parks its pin as it leaves the Pinned lane. The state writes that
  bring the card back now react to the card's state, not to who wrote them:
  a mark-unread landing through the native thread menu (bb's own surface),
  the board's menu, the pane toggle, or a drag onto the Unread lane restores
  the parked pin — the card returns to Pinned wearing the mark — and un-does
  a Done card, since unread and done contradict on one card. Driven by
  bb's own cross-surface realtime feed (`thread:changed` events); safe
  because only the deliberate mark-unread write clears
  `lastReadAt`, so ambient thread noise never pulls cards back.

### Fixed

- **The pane's click-jump guard no longer cements an upward displacement.**
  The guard arms on left clicks in the transcript while the reader is
  scrolled up; a click landing at an already-displaced position armed it at
  the displaced baseline, and bb's shell (self-correcting a displacement it
  had just made by re-pinning to the bottom) was then reverted by the
  guard, leaving the reader displaced. The guard now watches the
  scroller's position with a passive scroll listener and does not arm for
  3s after any single scroll move of ≥300px — displacements and their
  self-corrections stay with the shell that made them. Shipped in 0.5.19,
  bug and fix reproduced headlessly (10 instrumented runs).

- **A pinned family with a member that needs you now calls attention from
  inside Pinned.** A pinned family cannot relocate to a Needs-you lane
  (pinned threads split out before the family-column overrides read), so a
  child thread's question used to sit silent inside a card that read idle.
  Now the pinned parent card pulses — an amber border, the changelog gift's
  pulse language — shows its question icon, and rises to the top of the
  Pinned lane (above manual ranks, like urgent child rows do); the signal
  vanishes when the question is answered.

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

- Parent-thread view: family lanes size to their content; the locked ruler lane renders large readable cards while context lanes wrap compact cards capped by the viewport width.
- Panning horizontally releases the ruler lock; at rest the nearest family pins flush into position before a single re-cut, clicked subtasks stay visible through the motion, and the board settles quiet (regression-tested with a real wheel-event pan in the UAT suite).
- The lane-order toggle is a vertical picker in the status rail; viewport resizes while a lane is locked keep the ruler and band alignment; clicking a lane header during an in-flight glide wins the lock over the pan's target.

## [0.5.16] - 2026-09-29

### Changed

- No user-visible board changes; the What's-new modal restates the 0.5.15
  notes. Release documentation updates only.

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

- **Selected option indicators in the pane question form were invisible**:
  the check rendered in `primary-foreground` on a transparent border, and
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
- **Pane question form: parity with the host's QuestionForm**: the pending
  question card now mirrors the host's shipped form rather than a stacked
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

- The board marks each lane and each card with `data-column-id`,
  `data-column-ordered`, and `data-rank-slot` attributes, which the UAT
  harness reads to drive real drag gestures.
- The simulated board in the screenshot harness gained a third unread thread
  and an in-memory rank store, and the screenshots are regenerated to match.

### Fixed

- `scripts/screenshot/shoot.mjs` failed roughly two runs in three with
  `TargetCloseError` on `Emulation.setTouchEmulationEnabled`. It flipped one
  shared page's viewport between shots; each shot now gets its own page with
  the viewport set once.

## [0.3.5] — 2026-09-26

### Fixed

- **Keep the selected card in view when the thread pane opens**: the pane
  squeezes the board, which could leave the open thread's card clipped off
  to the right. The board's horizontal scroller now keeps the active card
  (parent card or nested child row) in the visible range when the pane
  opens or is drag-resized.

## [0.3.4] — 2026-09-26

### Fixed

- **Answer agent questions from the thread pane**: the pane now renders a
  pending question as a real form and submits the answer from the board —
  the host's embedded chat only shows these in the main thread view, so the
  question tool used to block until timeout while the pane showed nothing.
  Both payload shapes are handled: provider `user_question` interactions
  (answered through `interactions.resolve`; dismissing one stops the turn,
  like the main view) and plugin forms with the ask-user-question shape
  (answered through `interactions.respond`; Dismiss cancels). Provider
  extension requests get an "Open in main view" fallback, and unrenderable
  plugin forms keep it too.

## [0.3.3] — 2026-09-26

### Added

- **New threads inherit a single-project filter**: when exactly one
  project is selected in the filter, the toolbar's new thread button and
  the board's new task affordance create the thread in that project.
  With no or multiple projects selected, bb's default project pick
  applies, and a stale filter id (project deleted since) falls back to
  the default as well.

## [0.3.2] — 2026-09-26

### Added

- **Search bar in long filter dropdowns** (#8): the toolbar's Project and
  Provider dropdowns (and any other option list past five rows) now open
  with a search field, matching the model picker's affordance. Matching is
  a case-insensitive substring on the label, the field takes focus on open,
  Escape clears the query then closes, and reopening starts blank. Short
  lists (State) keep their plain rows.

## [0.3.1] — 2026-09-25

### Changed

- **Renamed to Focus Board** (#8): package `bb-plugin-focus-board`, plugin
  ID `focus-board`, CLI `bb focus-board`, and `focus-board:` preference
  keys. Saved grouping/filter/search preferences reset once on update.
  Repository moved to
  [github.com/cristoslc/bb-plugin-focus-board](https://github.com/cristoslc/bb-plugin-focus-board)
  (the old URL redirects).

## [0.3.0] — 2026-09-25

### Added

- **`bb thread-board` CLI** (#6): one subcommand managing the plugin's own
  state — a third surface over the same Done/metadata store, never a
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

- **Done state moves to plugin metadata** (#4): Done is per-thread bb-native
  plugin metadata in the board's own namespace (`done` → `{ doneAt, keep? }`)
  — server-side, surviving across devices and reloads. A legacy-KV migration
  shim imports both earlier shapes (bare ids, epoch-ms record maps) on first
  read, idempotently, fail-loud on malformed data.
- **Sweep** (#1): two-click arm-then-confirm buttons per column — Done and
  Awhile-ago. First click arms (button shows `?`, eligible cards gather and
  highlight, count frozen at arm time); second click performs; click-away or
  Escape disarms. Thresholds `doneArchiveDays` (7) and `idleArchiveDays`
  (30) via plugin settings; per-thread "Keep from sweep" override honored
  by both arms, stored independently so never-Done threads can be kept.
- **Ticket chips** (#2): `PROJ-123`, `#1284`, and GitHub issue/PR URLs in
  titles and branches render as chips that link out; inert when the project
  has no GitHub remote.
- **GitHub status dots** (#2, optional): the server reads the official
  GitHub plugin's local cache read-only and puts open/closed/merged dots on
  matching chips; a missing cache degrades to chip-only rendering — the
  board never breaks.
- **Parent-child nesting** (#3): threads spawned as children render as
  collapsible rows under their parent card (Jira-subissue style), with a
  needs-you child promoted to its own column so it is never buried, a
  2-level depth cap with `+N more` chip, family-aware filtering, and a
  defensive family index (orphans → roots, cycles unlinked).
- **Nesting refinements** (#5): child rows carry the full title (up to two
  lines); archived children stay nested under their live parent, dimmed
  with an archived mark; a "Nest child threads" toolbar toggle flattens the
  board to independent cards (nesting off = fully flat, filters per-thread).

### Changed

- `done_list` returns `{ doneIds, records }` where records carry the
  ISO-8601 `doneAt` stamp and `keep` flag the sweep and (future) CLI consume.
- `done-changed` realtime payload is `{ threadId, done }` (was `{ count }`);
  keep-flag writes publish the same signal.
- README's "makes no server-side writes" wording corrected to describe what
  the board actually owns (pin state, read state, Done — never thread
  content).
