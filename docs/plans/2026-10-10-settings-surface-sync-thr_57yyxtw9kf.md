## Plan: One board, two settings surfaces — sync and organization (thread thr_57yyxtw9kf)

The board has two settings surfaces and they look like two owners. This plan
records what each surface is, where each setting's truth lives, the rule for
placing any future setting, and the mechanical slice that lands first (sweep
thresholds into the modal's Behavior tab, their named future home).

## Surfaces today (verified on dev f41df90)

**Surface A, the board's gear-icon modal** (`components/settings-modal.tsx`,
opened by the toolbar's double-duty gift/gear icon): tabs Behavior
(the pane's Escape setting), Appearance (card animations, motion, wallpaper),
What's new (the changelog feed with per-line amber), About (identity).

**Surface B, bb's plugin detail page** (`Tools`, section "Configuration"):
host-rendered from the six settings `server.ts` declares through
`bb.settings.define`: `escStopsRunningThread`,
`scrollDebugInstrumentation`, and the two sweep threshold pairs
(`doneArchiveValue` + `doneArchiveUnit`, `idleArchiveValue` +
`idleArchiveUnit`). bb paints a native control per declared setting there.
The sidebar footer gear (`app.slots.sidebarFooterAction` id `open-settings`)
jumps to this page; it is the plugin's own shortcut because bb's sidebar entry
context menu has no plugin extension point.

**Surface C, the CLI.** `bb plugin config focus-board [set|unset] <key>
<value>` edits all six declared keys and is host-validated. The plugin's own
`bb focus-board config show|set` covers the four sweep keys only. The server
reads the sweep thresholds itself (`settings.get()` inside the sweep command),
so the sweep can never be a browser-side value.

**localStorage keys** (per browser), three families:
- View state, data-shaped, toolbar-owned: `focus-board:filter` (four sub-keys),
  `:search`, `:groupBy`, `:nestChildren`, `:parentLaneOrder`,
  `:collapsedFamilies`, `:paneWidth`.
- Look prefs the modal's Appearance tab holds: `focus-board:cardTransport`,
  `focus-board:motion`, `focus-board:wallpaper` (a versioned document built to
  grow per-scope layers).
- Pulse bookkeeping, plugin-internal: `focus-board:lastSeenVersion`,
  `:lastSeenUnreleased`, `:lastSeenUnreleasedItems`.

**Read/write paths.** Host-declared settings: frontend reads the reactive
`useSettings()` values map (effective values, defaults applied host-side),
writes a per-key partial patch through
`sdk.plugins.updateSettings({ pluginId, values })` (the host stores per key, so
a patch never touches sibling keys); the server reads `settings.get()` and
writes `settings.experimental_set()`; the config panel and both CLIs read and
write the same host store. localStorage prefs: read and write through the pure
parsers and serializers in `components/preferences.ts`.

## Principles

**P1, one source of truth per setting.** A declared setting's truth is the
host's settings store. A board preference's truth is that browser's
localStorage. Nothing is ever copied from one store into the other.

**P2, one read/write path per truth.** Host-declared settings are read from
`useSettings()` (or `settings.get()` server-side) and written by one
`updateSettings` helper; localStorage preferences are read and written through
`components/preferences.ts` helpers. Any surface that wants to display a
setting renders the same path, so the surfaces agree by construction instead
of by syncing effort. The split cannot drift because there is nothing to
drift: two windows onto two truths, no copies.

**P3, the placement rule, applied to any future setting.** Ask three
questions in order. Does the server, an agent, or the CLI need the value, or
should it follow the operator across browsers? Then it is host-declared: the
config panel gets a native control for free, the modal gets the operator
control on a tab, and the write path is host-validated. Is it a per-browser
taste about how the board looks or moves? Then it is localStorage: the
Appearance tab (later mirrored outward, see D3). Is it a view of the current
data? Then it belongs to the toolbar's view controls, never to settings. The
standing boundary rule stands with a sharpened edge: the view menu is how the
board looks right now, the settings modal is how the board behaves always,
and declared settings are the behaviors bb itself (or another browser) must
be able to read.

**P4, the modal is the operator surface, the config panel is the complete
surface.** The modal holds what a board user adjusts (operator settings plus
look prefs). bb's config page shows every declared setting with its native
control, including developer settings the modal deliberately leaves out. The
modal never embeds a link-out for declared settings; declared operator
settings render as real controls right in the Behavior tab.

## Decisions

**D1, sync is structural, not a mechanism.** The two surfaces stay consistent
without a sync routine: every modal-visible declared value renders from the
single `useSettings()` map, every write goes through the single partial-patch
helper (today that is the Escape set, `app.tsx`; the slice generalizes it),
and the config panel already binds the same store. localStorage stays behind
the `preferences.ts` helpers for the same reason.

**D2, sweep thresholds move into the Behavior tab (control-wise, not
storage-wise).** The Behavior tab gains a Sweep block: two value-plus-unit
pairs (a number field and a unit select fed by `lib/duration`'s `ARCHIVE_UNITS`),
read with default fallback (2 days per arm) and written through
`updateSettings`. The client mirrors the descriptor caps (1..365 for the Done
arm, 1..3650 for the idle arm) only to keep obvious garbage out of the input;
the host's schema stays the authority and a rejected write surfaces inline
under the row, the Escape toggle's existing error pattern. The config panel
keeps rendering the same four settings natively, so each surface shows live
values of the one store. Storage does not move: the sweep server command must
keep reading the thresholds, which alone settles that they remain declared
settings.

**D3, Appearance stays localStorage-backed; the config page mirrors its
controls.** Making Appearance declared would fork the tab's three controls
across stores (the wallpaper document cannot fit the scalar declaration types
anyway), migrate live values for no operator benefit, and claim a per-browser
taste as account-wide state. Instead the plugin app registers
`app.slots.settingsSection({ id: "appearance", ... })` and renders the same
shared rows (`components/appearance-controls.tsx`, also the modal's
Appearance tab) in `components/settings-section.tsx`: reads parse through the
shared parsers, writes go through the shared serializers and keys. The
section reads once at mount; a board instance is never mounted on the
configuration page, so an edit there applies on the board's next mount (the
same-document storage-event gap). The harness mounts the section standalone
through `?page=configuration` (mock-sdk's captured registration), which is
the headless seam the mirror's verify steps run against.

**D4, the sidebar footer gear stays, retitled "Focus Board
configuration".** Two gears named "Focus Board settings" with two different
destinations is the ambiguity this thread exists to fix. The board's gear
keeps the "settings" noun and opens the modal; the footer gear takes
"configuration" and keeps jumping to the config page, where every declared
setting (and, after D3, every mirrored look pref) shows. Deleting the footer
gear would strand declared-only settings behind Tools navigation for no gain;
retitling costs one string.

**D5, the plugin CLI's config commands retire.** Ruled 2026-10-10 (operator
thread thr_2vjgvw98xc): the plugin CLI no longer carries `config show|set`,
keep true. `bb focus-board` keeps the state commands (done, group, link,
snooze, autotitle, sweep).

**Developer settings in the modal.** `scrollDebugInstrumentation` stays
config-panel and CLI only: it is a developer surface, and its own description
says keep it off. The Behavior tab carries one muted line pointing at the
configuration page (the footer gear opens it) so nothing declared is
undiscoverable.

**D6, `threadOpenTarget` is declared, with no default (added 2026-11-20,
operator thread thr_eds5qfdb6s).** P3's first question settles it: the card
click reads the value on every mount, the answer should follow the operator
across browsers, and an install that has never answered must be distinguishable
from one that kept the default. So it is a host-declared `select`
(`beside` | `panel`): the click reads it through `useSettings()`, the
configuration page gets its native control for free, and the Behavior tab
carries the same control right after the New Thread shortcut row (P4, and the
same partial-patch write path as every other declared behavior setting, D1).
The load-bearing part is the DECLARED ABSENCE of a `default`: bb stores nothing
until someone answers, so an unset row is exactly "this install still owes the
first-run dialog its one answer" (`components/open-preference-dialog.tsx`),
while an operator who kept the split pane has `beside` stored and is never
asked again. One row carries both the value and the marker, so the two cannot
disagree and no second "have we asked" key exists to drift. The row count in
"Surfaces today" above predates several additions and is not authoritative; the
descriptors in `server.ts` are, and this setting joins them as the ninth.

## What's-new pulse constraint (AMBER)

The pulse keys read only changelog-derived fingerprints
(`CURRENT_UNRELEASED_FINGERPRINT`, the generated leads) and their stored seen
marks; settings reads and writes touch none of that state. Opening the modal
on Behavior never calls `activateWhatsNew` and must never, whatever rows it
gains. The sweep block therefore adds no pulse risk; if a landing wants the
gift to pulse, the lever is a changelog bullet in the merge, exactly as
designed, never a settings write.

## First slice (this PR)

- Sweep threshold pairs rendered as controls in the Behavior tab (D2).
- The settings write path generalized to a per-key helper in `app.tsx`.
- The screenshot harness's mock SDK gets a simulated settings store
  (`updateSettings` merges and re-renders, `useSettings` reflects it), so the
  headless verify can prove a real round-trip: edit, reload, the edited value
  shows.
- Footer gear retitled (D4), pointer line added to Behavior.
- Tests: preference parser tests, modal Behavior tests, verify script steps.
- CHANGELOG bullets under a `#### Settings` surface heading, humanizer-clean.

## Later slices

1. ~~D3's configuration-page Appearance mirror~~ Landed in this same lineage
   (PR #65): the `settingsSection` registration, the shared
   `components/appearance-controls.tsx` anatomy, the standalone
   `?page=configuration` harness mount, and unit plus headless coverage.
2. ~~The `bb focus-board config` retirement ruling~~ Ruled and landed in the
   same PR (operator thread thr_2vjgvw98xc): the plugin CLI's `config
   show|set` retired, `bb plugin config focus-board` keeps the one door, and
   the README CLI block names it.
3. Mobile settings page (`experimental_page: "mobile"` on
   `settingsSection`) if bb's mobile settings surface ever needs the mirrors.

## Test plan

- `tests/preferences.test.ts`: the sweep readers. A number arrives as a
  number in range; missing, loading (undefined), or garbage falls back to the
  `lib/duration` defaults without coercion; a unit outside `ARCHIVE_UNITS`
  falls back to the default unit.
- `tests/settings-modal.test.tsx`: the Behavior tab renders the Sweep block;
  a valid value edit calls the setting handler with the right key and number;
  an out-of-range edit writes nothing; an invalid unit select never happens
  (options are the three `ARCHIVE_UNITS`); a rejected write surfaces inline;
  a unit select change writes the right key. The Escape toggle tests stay;
  the pointer line is asserted.
- `scripts/verify-settings-modal.mjs`: the sweep rows render with defaults;
  editing a threshold records the `plugins.updateSettings` patch; with the
  mock settings store, the edit survives a reload; the footer gear title sits
  on the "configuration" noun.
- `tests/manual/uat-whats-new.yaml` untouched (pulse path unchanged);
  `docs/test-coverage-matrix.md` gains the rows.