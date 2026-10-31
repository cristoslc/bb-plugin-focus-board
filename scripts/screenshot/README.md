# Screenshot harness

Renders the real plugin app (app.tsx + components/) against a mocked
`@get-bb/plugin-sdk/app` with simulated threads, then captures the README
screenshots in `docs/screenshots/` with headless Chrome. No bb server or
host app involved.

- `data.ts` — simulated projects, providers, and threads (shapes mirror the
  SDK's `PluginSidebarThread`), plus `SIM_DEMO_THREADS`: three fresh demo
  families (Working/expanded, Needs-you/collapsed, Unread/expanded) appended
  in demo mode so shots show nested child threads both folded and unfolded
  in the attention lanes — the base fixture's families are deliberately old
  (parent-lane UAT stability) and never surface there.
- `mock-sdk.tsx` — SDK stand-in: hooks return the simulated state,
  `ThreadChat` renders a canned conversation, and `useBbNavigate` drives a
  minimal real-history router (hash-based) so UAT suites can exercise the
  app's pane-history behavior with genuine browser back/forward. Its `useSdk`
  returns one stable object across renders — a per-render object loops the
  app (effect deps + setState). Vite aliases the SDK specifier
  here, so the app code runs unmodified. `?demo=1` switches the simulated
  sidebar to the base fixture plus the demo families; suites never set it.
- `main.tsx` — seeds localStorage from the query string (`?groupBy=…`,
  `?collapsed=` folds family cards by seeding the persisted
  collapsed-families list) and mounts the registered panel component through
  the mock router.
- `index.html` — defines bb's built-in theme tokens (extracted from the bb
  app bundle): the dark set on `html.dark`, a light set on `html:not(.dark)`,
  plus a minimal preflight (the plugin's compiled CSS ships without one
  because the host app provides it) and the `data-bb-plugin="focus-board"`
  attribute so the compiled utilities' scoping matches.
- `shoot.mjs` — the capture driver. Captures three shots in both themes,
  toggling the `dark` class per pass: board with the thread pane open
  (1920x1080), plus board and thread pane at phone size (390x844) —
  `name-dark.png` / `name-light.png` files.
- `repro-markread-mobile.mjs` — one-shot headless repro for the mobile
  thread-actions bug (#14): opens a thread pane at phone size (390x844),
  dumps the pane header's control list to
  `docs/screenshots/repro-markread-mobile/evidence.json`, and captures
  `phone-thread-pane.png`. Run the vite harness first (same as above),
  then `node scripts/screenshot/repro-markread-mobile.mjs`; honors the
  same `CHROME_PATH` and `HARNESS_URL` overrides.
- `repro-child-row-chips.mjs` — one-shot headless repro/verification for the
  nested-row ticket chips fix (#191): loads the demo Working family — whose
  child `thr_demo_work_c3` carries a `#16` text ref — and exits non-zero
  unless the nested row renders its condensed chip and no anchor nests inside
  the row's own link. Artifacts land in `docs/screenshots/repro-child-row-chips/`
  (two screenshots plus `evidence.json`; the pre-fix run's failing evidence
  was captured into `docs/screenshots/repro-child-row-chips-prefix/` by
  running the script with `OUT_DIR` pointed there before the fix). Run the
  vite harness first (same as above), then `node
  scripts/screenshot/repro-child-row-chips.mjs`; honors the same `CHROME_PATH`
  and `HARNESS_URL` overrides, plus `OUT_DIR`.
- `repro-done-scroll-yank.mjs` — one-shot headless regression driver for the
  post-done re-scroll yank (#119): opens a pane on the Unread card
  (`thr_uat_queue`) at 1280x800, marks it done via the on-card checkbox,
  closes the pane, jumps the board to `scrollLeft` 0, forces hover/refresh
  re-renders, and exits non-zero unless the board rests at 0. Artifacts land
  in `docs/screenshots/repro-done-scroll-yank/` (five stage screenshots plus
  `evidence.json`). Run the vite harness first (same as above), then
  `node scripts/screenshot/repro-done-scroll-yank.mjs`; honors the same
  `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR` overrides.
- `capture-toolbar-tint.mjs` — one-shot header capture for the toolbar's
  band tint: shots the toolbar in dark then light, desktop (1920x1080) and
  phone (390x844), and exits non-zero unless all four states resolve the
  band's computed `bg-muted/50` background. Artifacts land in
  `docs/screenshots/repro-toolbar-tint/` (four clips plus `evidence.json`).
  Run the vite harness first (same as above), then
  `HARNESS_URL=... node scripts/screenshot/capture-toolbar-tint.mjs`;
  honors the same `CHROME_PATH` and `HARNESS_URL` overrides.

- `capture-family-zoom-gif.mjs` — the README's animated "Zoom to family"
  GIF: loads the demo board with the zoom fixture (`?demo=1&zoomfamily=1`;
  data.ts `SIM_ZOOM_FAMILY_THREADS` is a 24-child family seeded so every
  per-lane arm of the zoomed surface holds a card), right-clicks the family
  card, runs the card menu's "Zoom to family" entry, and captures the
  Parent view scoped to that family — with a synthetic cursor overlay so
  the pointer is part of the shot — then assembles the frames with ffmpeg
  (palettegen/paletteuse) into `docs/screenshots/family-zoom.gif`. Run the
  vite harness first (same as above), then
  `node scripts/screenshot/capture-family-zoom-gif.mjs`; honors `CHROME_PATH`,
  `HARNESS_URL`, `OUT_DIR`, `FRAMES_DIR`, and `GIF_WIDTH`.

- `repro-right-gutter.mjs` — one-shot headless repro for the family card's
  right gutter (#192): measures a demo family card with a ticket chip and
  expanded nested children (`thr_demo_gutter`, `?demo=1`) on the columns
  board — card box vs the lane's right edge, and the anchor, title, chip
  rows, nested rows, and sub-rows vs the card's right edge — then measures
  the parent-lanes board's lane cells (`?groupBy=parent`, the parent renders
  as a lane there). Exits non-zero when any content surface sits closer than
  CELL_PAD (4px) to the card's right edge or a lane boundary is crossed.
  Artifacts land in `docs/screenshots/repro-right-gutter/` (`evidence.json`,
  `evidence-before-fix.json`, two card clips). Run the vite harness first
  (same as above); honors the same `CHROME_PATH`, `HARNESS_URL`, and
  `OUT_DIR` overrides.

- `repro-clipped-selector.mjs` — one-shot headless probe for the family card's
  child-row list fold (the "Fix clipped selector" report, now the whole-row
  fold): loads the ten-child demo family `thr_demo_big`, measures the card's
  child-thread section geometry at four panel widths, then verifies the fold
  in real geometry — the folded list renders exactly `FAMILY_ROWS_BEFORE_FOLD`
  whole rows with no scroll and no row past the card's bottom edge, offers its
  `Show all N` handle, and the handle reveals the whole family. Exits non-zero
  on any violation or right-edge offender. Artifacts land in
  `docs/screenshots/repro-clipped-selector/` (`evidence.json` plus card clips
  per width). Run the vite harness first; honors `CHROME_PATH`, `HARNESS_URL`,
  and `OUT_DIR`.

- `repro-orchestrator-grandchildren.mjs` — one-shot headless repro for the
  "grandchildren don't pop out" report (2026-10-22): loads the orchestrator
  fixture (`?orchestrator=1`, a root with nine lieutenants and 77
  grandchildren), and captures the card collapsed (dot strip), expanded
  (folded with the `Show all 86` handle), and revealed (every row). Exits
  non-zero unless the folded list shows exactly five whole rows with no scroll
  and no clipped row, and the handle reveals all 86. Artifacts land in
  `docs/screenshots/repro-orchestrator-grandchildren/` (`collapsed.png`,
  `expanded-folded.png`, `expanded-revealed.png`, `evidence.json`). Run the
  vite harness first; honors `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR`.

- `repro-collapsed-group-descendants.mjs` — one-shot headless verification for
  the folded feature-group card's descendant dots (issue #321): loads
  `?descgroup=1&collapsedGroups=grp_desc` (data.ts `SIM_DESC_GROUP_THREADS`, a
  group whose first member is a family root with two children and three
  grandchildren), measures the three glyph tiers in real geometry (the member,
  child and grandchild dots render 6, 4 and 2 px), checks the counts against
  the dots they claim, then drives a grandchild dot's click (the pane opens,
  the box stays folded) and the strip's background click (the box expands).
  Exits non-zero on any violation. Artifacts land in
  `docs/screenshots/repro-collapsed-group-descendants/` (`card-dark.png`,
  `card-light.png`, `board.png`, `expanded.png`, `evidence.json`). Run the vite
  harness first; honors `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR`.

- `repro-ghost-gutter-strip.mjs` — one-shot headless repro/verification for
  the parent view's ghost duplicate card strip (#227): loads the parent board
  (`?groupBy=parent&demo=1`), opens a lane pane, hovers that lane's first
  card with real mouse moves, and exits non-zero unless no card ids duplicate,
  the card count never grows, nothing renders in the gutter band (board right
  edge → pane left edge), and no cell keeps a stuck FLIP transform. Artifacts
  land in `docs/screenshots/repro-ghost-gutter-strip/` (a pane-open rest
  shot, a hover shot, plus `evidence.json`; the pre-fix run is preserved in
  `docs/screenshots/repro-ghost-gutter-strip-prefix/` via `OUT_DIR`). Run the
  vite harness first (same as above); honors the same `CHROME_PATH`,
  `HARNESS_URL`, and `OUT_DIR` overrides.

- `repro-banner-contrast.mjs` — one-shot headless repro/verification for the
  alert banners' translucent surfaces (#233): seeds a busy, photographic
  wallpaper, triggers the rank refusal banner (a drop that resolves to no
  move) and the pinned nest receipt (a nest whose child keeps its own slot)
  with real drag gestures, and exits non-zero unless every banner, in both
  themes, paints an opaque background whose text keeps WCAG AA contrast
  (4.5) against the wallpaper-composited backdrop. Artifacts land in
  `docs/screenshots/repro-banner-contrast/` (a wallpaper rest shot, a full
  board shot per banner, per-theme banner clips, plus `evidence.json`; the
  pre-fix run is preserved in
  `docs/screenshots/repro-banner-contrast-prefix/` via `OUT_DIR`). Run the
  vite harness first (same as above); honors the same `CHROME_PATH`,
  `HARNESS_URL`, and `OUT_DIR` overrides.

- `repro-pane-overlap-wide.mjs` — one-shot headless repro/verification for the
  thread pane's board-lane floor (#273): seeds a wallpaper (which paints the
  board's flex column `relative z-10`, beating the un-z-indexed pane's paint
  order), then runs three passes at a fixed panel width — the
  (wallpaper × ribbon × panel × pane) matrix, the margin sweep that names the
  threshold (the margin left of the pane, the lanes it affords, whether the
  toolbar band wrapped, and the first margin where board chrome paints past the
  board's own edge), and a drag hysteresis walk that proves the clamp is
  symmetric with no dead step. Artifacts land in
  `docs/screenshots/repro-pane-overlap-wide/` (`evidence.json` with the full
  tables, plus before/after shots). Run the vite harness first (same as above);
  honors the same `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR` overrides.

Regenerate the screenshots:

```sh
npm i --no-save puppeteer-core   # uses the system Chrome, no download
npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
node scripts/screenshot/shoot.mjs                     # terminal 2
```

`CHROME_PATH` and `HARNESS_URL` override the Chrome binary and harness URL.

## Performance probes

The `probe-*.mjs` scripts measure board performance at a phone viewport
(390x844, the release harness's phone size). `data.ts`'s `SIM_BULK_THREADS` +
`?scale=N` (mock-sdk) grow the board to a long-lived workspace's size, and
`SIM_ATTENTION_THREADS` + `?attention=N` grow it with all-attention threads
(every one renders the real pulsing treatment) for the pulse-cliff probes.

**Measure against the production build, not the dev harness.** `vite.config.ts`
serves React's development build, which is several times slower than the
plugin's shipped bundle and can rank bottlenecks wrongly. Build and serve the
production harness for every probe:

```sh
npx vite build --config scripts/screenshot/vite.probe.config.ts
npx vite preview --config scripts/screenshot/vite.probe.config.ts --strictPort
# probes then read HARNESS_URL=http://localhost:5174/
```

- `probe-mobile-perf.mjs` — the main sweep: load metrics (FCP/LCP/blocking
  time), then windowed interactions (pan, lane scroll, hover, pane open) with
  frame rate, dropped frames, and React commit counts per interaction, plus a
  V8 CPU profile. Reads `PROBE_CPU` (CDP CPU throttle, default 4) and
  `PROBE_SCALE`.
- `probe-mobile-ab.mjs` — A/B isolation: runs one gesture under CSS-only fix
  candidates and reports each variant's timing, with a `progress` value proving
  the gesture did real work. `GESTURE=pan|lane|hover|open|drag|idle`.
- `probe-rerenders.mjs` — counts ThreadCard renders per interaction (the number
  the hover fix moved: 335 renders per hover enter on a 478-card board → 0).
  The counter rides `probe-instrument-thread-card.tsx`, which the probe config
  aliases in place of the real component, so the shipped card is untouched.
- `probe-pulse-cost.mjs` — the cost of N simultaneous `animate-pulse` attention
  dots (see issue #260): injects copies of the real pulsing glyph and reports
  idle frame rate per N.
- `probe-pulse-visible.mjs` — the visible-only gate's before/after (#260).
  Opens `?attention=N` (real pulsing attention cards, no injected clones) and
  reports, per viewport width (phone, 1280x800, 1920x1080, 2560x1440,
  1280x2160, 3840x2160): how many pulses run, how many are visible, how many
  the gate parks, the idle frame rate with the gate, the frame rate with the
  gate's stylesheet removed (the pre-fix board), and the frame rate with every
  pulse killed (the ceiling). Also scrolls a busy lane to prove the gate
  toggles and adds no scroll cost. Reads `PROBE_ATTENTION`, `PROBE_CPU`,
  `PROBE_SCALE`.
- `probe-working-dot-pulse.mjs` — the working dots' rate pulse (#279). Opens
  `?workpulse=N&collapsedGroups=…`, whose board paints 3N genuine `working`
  dots through the shipped rate pulse, and reports per viewport and per N: the
  dot census (parked, animating, animating and visible), the idle frame rate
  with the gate, with the gate's stylesheet removed (every dot animating), and
  with every rate pulse killed (the ceiling), plus the page's long tasks and
  the number of `pulse_rates` calls inside the measurement window. Reads
  `PROBE_GROUPS`, `PROBE_VIEWPORTS`, `PROBE_CPU`.
- `probe-pinned-child.mjs`, `probe-chips.mjs` — the older one-shot DOM probes.

Each honors `CHROME_PATH`, `HARNESS_URL`, `OUT_DIR`, and `PROBE_CPU`; evidence
lands in `docs/screenshots/probe-*/`.