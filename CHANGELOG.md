# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
