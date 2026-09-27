# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Search bar in long filter dropdowns**: the toolbar's Project and
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
