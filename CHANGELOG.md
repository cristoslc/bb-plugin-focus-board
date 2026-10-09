# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **The pane's question form keeps half-answered questions alive.** Picks and free text survive a reload or a thread switch and restore with the open tab, then clear once the question is submitted or dismissed — the same recovery the new-thread composer gives prompts.
- **Card menus now surface a thread's controlled browser tab.** "Reveal browser tab" discovers the thread's desktop-browser tabs, focuses the owning thread, and opens the side panel on the page's tab — blank carrier tabs skipped — one click straight from the board. bb offers no honest success signal here (it answers `ok` even when the reveal no-ops, and `tabs`' `presentation` field never reflects live visibility), so the gesture claims nothing; the opened panel is the feedback.
  ([#17](https://github.com/cristoslc/bb-plugin-focus-board/issues/17))
- **Board cards carry linked-issue chips.** A thread tied to a GitHub issue or pull request in the board's own link store shows its `#N` chip with a live status dot, even when the title and branch name say nothing (issue [#13](https://github.com/cristoslc/bb-plugin-focus-board/issues/13)).
  - **Agents are nudged to link.** The `focus_board_link_issue` tool rides thread instructions and asks agents to call it right after they open or file an issue or PR.
  - **The CLI links too.** `bb focus-board link list|set|clear` manages the store by hand.
- **Board links reach any tracker.** `link set` and the agent tool accept any https tracker URL (with an optional chip label), forgejo remotes build their own `…/issues/N` chips, and non-GitHub chips show the site's favicon.
- **PR chips and issue chips are distinct glyphs.** A link's stored issue-vs-PR kind now rides the chip, so a linked PR shows the PR glyph immediately (merging into the purple merge glyph when status lands) instead of the issue glyph; external tracker chips name their own site's favicon and no longer don a GitHub issue glyph.

### Changed

- **The pane's actions menu now leads with the state toggles.** Mark Done and Pin sit at the top, Snooze keeps its divider, and "New child thread…" moved down below the snooze entry, away from the everyday toggles.
- **Ticket chips say their source and their kind at a glance.** Each chip now leads with its provider mark — GitHub's own mark, or a generic ticket glyph when the source can't be named — followed by the issue-vs-PR glyph, whose open/merged/closed color takes over the old bare state dot.

### Fixed

- **The board no longer silently vanishes when a checkout's node_modules goes bad.** `npm test`, `npm run build`, and `npm run uat` now abort at a preflight guard whenever repo-root node_modules is a symlink, with the repair printed in the error; `scripts/node-modules-watchdog.sh` carries the self-healing bb automation that checks both main checkouts every 5 minutes, and AGENTS.md forbids node_modules symlinks outright.
- **Word-shaped ticket keys no longer chip.** `PROJ-123`-style text matched with nothing able to validate it, so impostor chips like GLM-5 appeared; only refs GitHub can confirm (`#N`, issue/PR URLs) and the board's own links chip now.
- **Mobile thread pane: thread actions drop from a split caret, like Open
  in.** The standalone ⋯ button next to the Mark Read toggle is gone — an
  icon-only toggle, a hairline divider, and an attached ChevronDown caret
  now use the same grammar as the Open in menu at every width.
  ([#14](https://github.com/cristoslc/bb-plugin-focus-board/issues/14))

## [1.0.0] - 2026-10-05

### Added

- **Toolbar search reaches project names and branches.** The filter box still
  matches card titles, but now also matches the project and the branch (or
  machine) a card's footer shows, on parents and nested children alike — a
  hit on any family member keeps the family on the board with the rest
  dimmed.

### Fixed

- **✨ "The thread's active model" no longer lands on a metered catalog
  default.** When the thread's model can't be cloned, the title probe now
  inherits the same spawn default chain a new thread gets instead of
  cloning just the provider. The old path resolved the provider's catalog
  default (an openrouter model here) and the metered gate rejected it with
  a 409.
- **Reordering from two boards at once can no longer drop a column's
  order.** Rank writes now serialize server-side, so a move landing while
  another panel's write is in flight can no longer revert that panel's
  column.
- **A corrupt snooze record can no longer silence the other wake-ups.** One
  bad record is skipped with a log line at load instead of stranding every
  later snooze, and a record that turns unreadable between set and wake now
  logs instead of crashing the timer.
- **An absurd snooze duration refuses cleanly.** A `<when>` like
  `+100000000w` that overflows the Date range exits with the invalid-wake
  hint and no longer marks the thread read as a side effect.

### Changed

- **A drop on a column title never writes an order.** It still detaches a
  nested child (or applies the column's state change cross-lane), but
  placement stays with the insertion line beside the cards — the floor below
  keeps its append.
- **The Working lane no longer vanishes when nothing runs.** The Attention
  board keeps its Working column even when every thread has gone idle; the
  empty lane reads "No work in progress" instead of disappearing.

## [0.9.0] - 2026-10-05

### Added

- **✨ auto-rename gains the thread's own model as a fallback.** When the
  pinned AI service fails, the fallback modal now titles the thread with a
  hidden one-turn probe on the model bb resolved for the source thread: no
  workspace tools run, the probe is deleted in every path, and resolution
  falls back through the thread's provider to a plain hidden child. The
  modal's other-services list is probed for the bridge focus-board calls,
  so a service whose plugin lacks it (bb cloud, Codex) renders disabled
  with its reason instead of a click that 404s.
  - **Titles come from the thread's true originating prompt.** The source
    timeline's oldest user row wins, prompt history as the fallback — no
    more titling the latest follow-up.
  - **The CLI mirrors the menu.** `bb focus-board autotitle
    availability|prompt|probe --thread-id <id>` runs the probe end-to-end
    without opening the pane.

- **Sweep selection takes shift-click and ⌘/Ctrl-click.** Shift-click grabs
  the run from the last-clicked card through the one you click (cards that
  cannot join a sweep are skipped); ⌘/Ctrl-click toggles a single card.

- **Open menu in the thread pane header.** The workspace button becomes a
  header menu styled like the main thread view's: the icon opens the
  thread's workspace folder in your preferred editor, and the dropdown adds
  file explorer, terminal, new window, and Copy thread link. It runs on the
  machine the workspace lives on (remote sessions included) and hides when
  there is no workspace, the host daemon is down, or the workspace lives on
  another host.
  - **Full screen joins the dropdown.** The floating caret button becomes
    an ellipsis in the swap.
  - **The debug bug button is gone.** The scroll instrumentation setting
    still works, but its log reaches only the browser console (and the
    `__focusBoardScrollDebug.dump()` window handle).

### Changed

- **The Done column sorts by activity recency again, most recently active on top.** The idle sweep's fresh stamps no longer vault long-idle threads or family projections up the column. A stored drag order still wins.

- **A double-tap of Escape no longer closes the thread pane.** After the pane
  stops a running thread or closes, further Escapes inside a short window
  are swallowed, so a stop double-tap can't cascade into closing the pane.

- **Family cards fold their child rows into a "N child threads" line with a
  strip of status-colored dots immediately below it.** The fold toggle sits
  in the child section, directly above the rows it acts on, and folds
  persist across sessions. A child that needs you un-nests into its own
  Needs-you card while the rest stay folded.

- **✨ "New child thread…" opens a composer preset to the parent.** The card
  menu (board cards, nested rows) and the pane's actions menu open the
  composer keyed to the parent, and the spawned child opens in the pane
  nested under it.
  - **The child starts where the parent runs.** When the parent's checkout
    is a worktree, the composer's environment picker is seeded to reuse it;
    other checkouts keep bb's own default.

- **Drop a card onto a card to nest it.** The hovered target rings amber —
  distinct from the top/bottom thirds' ordinary insertion line, so a family
  drop never masquerades as a lane drop — and the drop re-parents the
  thread under the target.
  - **Drag a nested child onto any column header or floor to top-level it
    again.** Nested rows drag like cards now, the hovered title strip grows
    a notch and rings amber for the family detach (the floor works too), and
    dragging the child back onto a card re-nests it — nest and detach are
    each other's undo; the card menu's Make Top-Level detaches too.

- **Mark Unread joins the pane's actions as one attached split control.**
  The header's split menus no longer clip: their carets now open visible
  dropdowns.

## [0.8.0] - 2026-10-03

### Added

- **Collapsible nested children on family cards.** The chevron folds nested
  rows into a "N child threads" pill that reopens them, and folds persist
  across sessions. A folded card reopens itself when a nested child turns
  unread or needs you.

- **Snooze: read now, unread again at a target time.** One "Snooze…" entry
  (on cards and in the pane's actions menu) opens a presets-or-picked-time
  picker, and the snoozed card dims until it wakes. Any pin/read/done/archive
  gesture lifts the snooze first, and CLI parity lands as
  `bb focus-board snooze list|set|clear`.

- **✨ auto-rename in the pane's title editor.** One click on the title
  editor's ✨ button titles the thread from its first user prompt, using
  the AI service bb's thread-title task is set to (Settings → AI services)
  via the openrouter-inference plugin's `complete` bridge. A generated
  title renames and closes the editor; a failure keeps it open with a
  fallback modal that names the reason and offers another service or a
  manual rename.

- **The thread pane's actions menu pins again.** A Pin/Unpin entry joins the
  opened pane's more-actions menu with the card menu's semantics: the
  gesture lifts a snooze and clears a parked pin, and a lane move reveals
  after the pin lands.

### Changed

- **Every lane now has its sweep, each with its own destination.** Pinned
  sweeps to Unpinned, Unread to Read, and every Idle bucket to Done; Needs
  You and Working never sweep. A cancelled sweep's Undo reverses destination
  by destination.
  - **The sweep pill drops the word "Sweep."** Screen-reader labels keep the
    full sweep wording.

## [0.7.0] - 2026-10-03

### Changed

- **New threads compose inside the board.** The toolbar, column, and
  parent-lane new-thread buttons now open bb's full compose surface in a
  modal over the board and pane. A failed create keeps your draft with an
  on-screen error, and Escape closes only the modal.

## [0.6.0] - 2026-10-03

### Added

- **A family's done work renders as a projection card in the Done column.**
  Done children move under a dimmed copy of the parent's card, so a family
  lives in both spaces at once — live in its lane, done in Done. Projection
  cards refuse sweep selection.
  - **Big families scroll inside their card.** Past five child rows the
    list caps its height and scrolls.
  - **Archived children are hidden outright, everywhere.** Archiving a
    thread removes it from the board completely, matching bb's sidebar, and
    its children re-render as standalone cards.

- **Filter dropdowns with a search bar gain a select-all checkbox.** One
  click selects every visible option, clicking again deselects, and a
  partial selection shows mixed; present on the Project and Provider
  dropdowns.
  - **Enter applies a sole dropdown search match.** With one match left in
    the search, Enter selects it and closes the menu like a click.

### Changed

- **Developer toggle: pane chat scroll instrumentation.** An off-by-default
  setting logs the transcript's scroll activity, with a copyable log in the
  pane header (`docs/chat-click-jump-2026-09-29.md`).

- **The brand icon is restored as the lane-and-card mark.** The asset is
  solid alpha geometry: it themes itself on light and dark surfaces and
  renders clean at any size (`tests/brand-icon.test.ts` pins the rules).
  - **The sidebar row and pane title bar draw the mark too.** They had kept
    a placeholder icon since the plugin's first commit.

- **The sweep is rebuilt around choosing exactly what gets archived, and
  idle threads resurface instead of vanishing.** Manual selection, a mid-run
  stop, and a gentler fate for quiet threads:
  - **Sweep mode is manual: enter it any time and click the cards to
    archive.** The button stays visible even when nothing is past the
    threshold, armed sweeps pre-select the aged-out threads, and a parent
    with live children refuses with an on-screen note.
  - **The long-idle sweep now marks threads Done instead of archiving
    them.** Quiet threads resurface in the Done sweep and archive only
    after aging there; the CLI mirrors it (`sweep --json` reports
    `archived` and `markedDone` separately).
  - **A sweep can be cancelled, not only confirmed.** The X stops the run
    mid-loop, and the notice offers an exact Undo.
  - **Selecting cards for a sweep no longer reshuffles the column.** The
    list never reorders mid-gesture.
  - **Confirming a sweep archives every highlighted candidate.** The
    button reads "Sweeping N of M" until the loop finishes, and a failed
    archive keeps its card highlighted for a one-click retry.

- **Pinned cards carry their thread's state both ways: read state and
  needs-you.**
  - **Marking a card unread now returns a parked card to Pinned from any
    surface.** It also clears a contradicting Done mark.
  - **A pinned family with a member that needs you calls attention inside
    Pinned.** The parent card pulses amber, shows its question icon, and
    rises to the top of the lane until the question is answered.

### Removed

- **The thread pane's project/branch footer line is gone.** Recent bb
  builds show the working context in the composer itself; the pane ends
  with the transcript.

### Fixed

- **Menu moves bring the destination lane into view.** Every menu action
  that relocates a card now reveals its new lane, so a move never reads as
  the card silently vanishing. Passive changes still never move your
  scroll.

- **Clicking in the pane's chat no longer yanks the transcript to the
  newest message while you are scrolled up.** The click-jump guard arms on
  the click's own position read and reverts the clamp; the full mechanism
  and removal condition stay in `docs/chat-click-jump-2026-09-29.md`.

## [0.5.21] - 2026-09-30

### Added

- **Escape stops a running thread before closing the pane.** While a turn
  runs, Escape interrupts it; the pane closes only once nothing is running.
  Default on, toggle in the plugin detail page.

### Changed

- **Pinned cards take the pin when they leave the lane.** Any gesture that
  moves a pinned card out of Pinned unpins in the same gesture, so the card
  cannot bounce straight back. Mark-not-done restores the card's column,
  not the pin.
- **Columns drained to zero by nesting hide themselves.** They reappear
  when a card returns.

## [0.5.20] - 2026-09-30

### Changed

- **Dropping a card into a new column can place it there in the same drag.**
  The insertion line shows while the drag hovers over a card, and the drop
  writes the state and the rank in one gesture.

## [0.5.19] - 2026-09-29

### Added

- **Clicking in the pane's chat no longer yanks the transcript back to the
  bottom.** A guard reverts the host's clamp-to-bottom when a click lands
  while you are scrolled up; clicking the scroll pill or the composer still
  re-pins. Findings and the removal condition:
  `docs/chat-click-jump-2026-09-29.md`.

## [0.5.18] - 2026-09-29

### Fixed

- **Answering a question now clears the card from Needs you right away.**
  The board verifies every interaction change against the interaction
  records, instead of trusting a cache that could stay stale.

## [0.5.17] - 2026-09-29

### Changed

- **Parent lanes now size to fit their cards.** The selected family renders
  as a wide, readable ruler lane; context lanes wrap compact cards.
- **Panning releases the lane lock, and at rest the nearest family pins
  flush into position.** Seams stay aligned and the board settles quiet.
- **The lane-order toggle moves into the status rail as a vertical
  picker.**

## [0.5.16] - 2026-09-29

### Changed

- **No user-visible board changes.** The What's-new modal restates the
  0.5.15 notes.

## [0.5.15] - 2026-09-28

### Fixed

- **Dragging a card onto the Pinned lane now pins it.** Pinned was the one
  visible lane without a drop handler, so pinning needed the right-click
  menu. The pin writes no lane rank order; already-pinned cards keep their
  reorder gesture.

## [0.5.14] - 2026-09-28

### Added

- **Full Screen moves into the phone thread pane's actions menu.** A phone
  pane covers the board as a full-screen sheet but hid the desktop's
  maximise icon, so the main thread view was unreachable from the pane.

## [0.5.13] - 2026-09-28

### Added

- **Parent thread lanes.** The Group-by dropdown offers "Parent thread":
  each lane is a parent thread, the rows are the attention ladder (Needs
  you, Unread, Working, idle age buckets, Done). Only children render as
  cards; a catch-all "Standalone" lane holds threads with no family, and a
  persisted toggle groups lanes into project sections instead.

## [0.5.5] — 2026-09-28

### Changed

- **Inline-code workspace paths now verify against the workspace before
  they become clickable.** A path clicks only when the backend confirms the
  file exists in the thread's environment, so dead names stay plain text.

## [0.5.4] — 2026-09-28

### Added

- **Recent decisions card in the thread pane.** bb's transcript drops every
  trace of an answered question, so the pane rebuilds the last five from
  the raw event log — question and chosen answer. It auto-expands on a
  fresh answer and collapses with Escape.

## [0.5.3] — 2026-09-28

### Fixed

- **Backticked workspace paths in thread messages are now clickable in the
  board's pane.** Workspace-relative markdown files open in bb's file
  preview, styled like the main pane's links. Commit shas, `.ts` files, and
  block code stay plain.

## [0.5.2] — 2026-09-28

### Fixed

- **Right-clicking a nested child thread no longer stacks the parent
  card's menu on top of the child's.** The right-click stops at the card it
  hits, and every card menu now names its thread in a muted header line.

## [0.5.1] — 2026-09-28

### Added

- **The Done column sorts by when each thread was marked done, newest
  first.** Dragging inside Done still applies a manual order, exactly like
  every other column.

## [0.5.0] — 2026-09-28

### Added

- **The open pane now lives in the panel's URL, so bb's back arrow restores
  it.** Opening a card pushes a `…/board/t/<threadId>` route; links, a
  reload, or a shared deep link all return to the pane you left, and back
  walks the trail of cards one pane per step. Closing pushes the panel
  root, so back reopens the pane — close is never lost work — and forward
  re-closes it. The board keeps the active card in view whenever it
  relocates.
- **What's new**: a gift button in the toolbar lists recent changes after
  an update, pulsing until opened. Fresh installs are stamped silently, and
  the condensed list ships in the bundle, pinned to `package.json`'s
  version by a test.

### Fixed

- **The screenshot harness no longer render-loops.** The mock SDK handed
  back a fresh client every render, looping a thousand renders a second;
  it now returns one stable client, as the real host does.

## [0.4.6] — 2026-09-27

### Added

- **Click an empty area of the board to close the thread pane.** Clicks on
  cards, controls, and card menus are unaffected.

## [0.4.5] — 2026-09-27

### Fixed

- **The first drag-and-drop reorder in a column silently did nothing unless
  the drop landed at the top.** A move now also ranks every card above the
  drop point, so the card lands where you put it. Applies to mouse drops,
  empty-space drops, and Alt+Arrow keyboard moves.

## [0.4.4] — 2026-09-27

### Fixed

- **Thread mention links in pane messages were swallowed.** The link
  interceptor treated every relative anchor as a workspace file; it now
  mirrors the host's heuristic and strips bb's line and column suffixes
  before resolving.

## [0.4.3] — 2026-09-27

### Fixed

- **Relative file links in pane messages no longer open as broken browser
  URLs.** A left-click on a relative anchor reopens the target as a live
  workspace file in bb's preview panel. Absolute URLs keep native routing.

## [0.4.2] — 2026-09-27

### Fixed

- **Rank refusal banners can be dismissed.** They gained an X button and
  auto-dismiss after ten seconds; a repeat refusal restarts the timer.

## [0.4.1] — 2026-09-27

### Fixed

- **Selected option indicators are visible in the pane question form.**
  Selected options fill foreground-on-background, radio-shaped for
  single-select, square for multi-select. The logic was always right; the
  visual was missing.

## [0.4.0] — 2026-09-27

### Added

- **Per-column card rank ordering.** Drag cards up and down inside a
  column to order them your way instead of the board's recency order.
  - Orders are stored per column, so a card that leaves and comes back
    returns to the slot it left.
  - The Pinned and Done lanes keep one order across every grouping; other
    lanes are namespaced by grouping.
  - **Seed on first intent**: no setup step — the first drop writes the
    order, and a lane with a stored order says so in its header.
  - **Keyboard parity**: Alt+Arrow moves a focused card one slot,
    announced in a live region.
  - Drop on a card's top half to land in front of it, bottom half to land
    past it.
- **The pane question form reaches parity with the host's shipped
  QuestionForm.** Sequential questions sit behind a scrollable tab strip
  with a N-of-M counter, the body scrolls internally to keep the
  transcript's space, and number keys select options. Analysis of the
  original gaps: `docs/pane-question-gap-analysis.md`.

### Changed

- **The board's cards and lanes carry drag-testability attributes.** The
  UAT harness reads `data-column-id`, `data-column-ordered`, and
  `data-rank-slot` to drive real drag gestures.
- **The screenshot harness simulates a third unread thread.**

### Fixed

- **Screenshot runs stop failing two runs in three.** Each shot now gets
  its own page with the viewport set once.

## [0.3.5] — 2026-09-26

### Fixed

- **The selected card stays in view when the thread pane opens.** The pane
  squeezes the board, so the scroller keeps the active card visible when
  the pane opens or is drag-resized.

## [0.3.4] — 2026-09-26

### Fixed

- **Agent questions are answerable from the thread pane.** The pane renders
  a pending question as a real form and submits the answer from the board,
  where the question tool used to block until timeout while the pane showed
  nothing.

## [0.3.3] — 2026-09-26

### Added

- **New threads inherit the single selected project filter.** With no,
  several, or stale selections, bb's default project pick applies.

## [0.3.2] — 2026-09-26

### Added

- **Long filter dropdowns gain a search bar** (#8). Past five rows,
  dropdowns open with a case-insensitive search field, matching the model
  picker. Short lists keep plain rows.

## [0.3.1] — 2026-09-25

### Changed

- **The plugin is renamed to Focus Board** (#8). Package, plugin ID, CLI,
  and preference keys all move, and saved preferences reset once on
  update. The repository moves to
  [github.com/cristoslc/bb-plugin-focus-board](https://github.com/cristoslc/bb-plugin-focus-board)
  (the old URL redirects).

## [0.3.0] — 2026-09-25

### Added

- **The new `bb thread-board` CLI manages the plugin's own state** (#6). A
  third surface over the same Done/metadata store, never a re-spelling of
  `bb thread`:
  - `done list|mark|clear` — agents get free Done marking.
  - `sweep [--ids …] [--confirm]` — a dry-run prints the eligible set and
    exits 1, and `--ids` freezes the blast radius.
  - `config show|set` — sweep thresholds without learning
    `bb plugin config` syntax.

## [0.2.0] — 2026-09-25

The day's four sashays plus the nesting refinement round, merged in
sequence: done-metadata foundation → sweep → tracker mirroring → nesting
refinements.

### Added

- **Done state moves to per-thread plugin metadata** (#4), server-side and
  surviving across devices and reloads. A legacy-KV migration shim imports
  the earlier shapes on first read.
- **The sweep arms with a first click and performs with a second** (#1), on
  the Done and Awhile-ago columns. Thresholds `doneArchiveDays` (7) and
  `idleArchiveDays` (30), with a per-thread "Keep from sweep" override.
- **Ticket chips render and link out from titles and branches** (#2).
  `PROJ-123`, `#1284`, and GitHub links become chips; inert with no GitHub
  remote.
- **GitHub status dots appear on matching chips** (#2, optional), read from
  the official GitHub plugin's local cache. A missing cache degrades to
  chip-only rendering.
- **Threads spawned as children nest under their parent card** (#3),
  Jira-subissue style. A needs-you child is promoted to its own column, a
  2-level depth cap surfaces a `+N more` chip, and filtering is
  family-aware.
- **Child rows gain full titles, and archived children stay nested** (#5).
  A "Nest child threads" toolbar toggle flattens the board when you want
  independent cards.

### Changed

- **`done_list` returns richer Done records**: `{ doneIds, records }` with
  the ISO `doneAt` stamp and `keep` flag.
- **The `done-changed` realtime payload narrows to the thread**:
  `{ threadId, done }`, was `{ count }`.
- **The README's "makes no server-side writes" wording is corrected.** It
  now names what the board actually owns: pin state, read state, Done —
  never thread content.