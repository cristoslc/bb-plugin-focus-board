# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
