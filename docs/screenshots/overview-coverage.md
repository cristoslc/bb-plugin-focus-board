# Overview media coverage

What the README's overview media shows, what it leaves out, and why. This page is the source of truth for the storyboard in `scripts/screenshot/storyboards/overview.mjs` and the still set in `docs/screenshots/`.

The media has two jobs. The animated GIF carries motion a still cannot: folding a group, dragging a card into a family inside a group, and dragging a card onto a group to join it. The stills carry the states and controls that would cost seconds of GIF time without changing board state.

## The set

| Item | File | Size | What it is |
|---|---|---|---|
| Hero GIF | `overview.gif` | 1000x562, 24 fps, 10.04 s, 1.4 MB (1,388,370 bytes) | The scenario board at rest, a group folded with its chevron, a card nested inside a group, a card joined to a group of one |
| Board stills | `overview-groups.png`, `overview-group-highlight.png` | 1680x945 | The rest board, and the same board with the Release 1.0 footprint lit across every lane |
| Control stills | `overview-group-menu.png`, `overview-card-menu.png`, `overview-group-picker.png`, `overview-group-filter.png`, `overview-view-menu.png` | clips | The two context menus, the group picker, the Group filter with its No group bucket, and the View menu's eight groupings |
| Family stills | `overview-family-fold.png`, `overview-group-dots.png`, `overview-parent-view.png` | clips / full board | The Show all N fold, the folded group card's three dot tiers, and the Parent view scoped by Zoom to family |
| State stills | `overview-done-sweep.png`, `overview-horizontal-wallpaper.png` | clip / full board | The Done lane armed for a sweep beside its projection, and horizontal lane rows over a bundled wallpaper |
| Existing | `board-thread-pane-dark.png`, `board-thread-pane-light.png`, `phone-board-light.png`, `phone-thread-pane-dark.png` | full board / phone | The thread pane and the phone layouts |

The older `family-zoom.gif` stays in the repository as the historical Zoom-to-family capture and is still reproducible with `capture-family-zoom-gif.mjs`. It is no longer the README's hero; the new GIF covers the same zoom result in the Parent view still.

## The scenario board

`?overview=1` replaces the base fixture with one six-lane board built for density. It is deliberately not the base board: nine lanes would push Done off-screen and scatter the states the story needs adjacent.

| Lane | What it carries |
|---|---|
| Pinned | A working release card and an unread brief, so the lane's sweep and both state dots read at rest |
| Needs you | The ledger parent folded over its dot strip, plus a pulsing error card on another project and provider |
| Unread | The Triage group of one (the join target), the Release 1.0 frame's unread member, two loose unread cards, and the bridge parent folded over ten child dots |
| Working | Release 1.0 expanded around a parent family (three live children, one done child) plus a second member; Chat pipeline beside it, folded on camera |
| Idle · Recent | The nest drag's source, a chip card, a snoozed card, a wrapping-title card, and the Docs sweep group folded at rest |
| Done | Three settled cards old enough for the lane's broom, plus the Release 1.0 done projection |

Both group states and both parent states are on screen at rest: an expanded group, a folded group, a group of one, an expanded parent, and two folded parents. The board is six lanes wide at 1680 px, so the Done lane and its projection stay visible without a pan.

## GIF timeline

| Beat | Time | What the viewer sees |
|---|---|---|
| 1. Rest | 0.0-1.2 s | The whole board: pinned cards, the pulsing attention card, both folded parents, the expanded and folded groups, the group of one, the snoozed card, the Done projection |
| 2. Fold | 1.2-2.8 s | The cursor moves to Chat pipeline's chevron and folds it into its dot-grid card |
| 3. Nest | 2.8-5.7 s | A card lifts from Idle · Recent, travels over the board, hovers the middle of the parent inside Release 1.0 (the amber nest ring), and drops. The card becomes a fourth nested row; the family's child count and rows grow |
| 4. Join | 5.7-8.4 s | An unread card travels onto the Triage frame's label (the join ring) and drops. The frame grows from one card to two |
| 5. Hold | 8.4-10.0 s | The finished board, pointer parked: both drags' results visible together with the two folded groups and the Done projection |

The GIF is assembled from 241 frames captured at 24 fps, one screenshot per frame. At 10.04 s and 1.4 MB it is about three and a half times the old 12 fps capture byte count for roughly the same duration, which is the cost of doubling the frame rate and adding real pointer motion. Trimming came from dropping the menus and highlights to stills, not from lowering the frame rate.

## Coverage

Marks: **current** means the old `family-zoom.gif` or an existing README still already shows it; **GIF** means the new overview GIF shows it; **still** names the file that shows it; **omitted** gives the reason.

### Lanes and toolbar

- Focus lanes (Pinned, Needs you, Unread, Working, idle buckets, Done) at rest: current, GIF, still `overview-groups.png`.
- Vertical lane direction (the shipped default): current, GIF, still `overview-groups.png`.
- Horizontal lane direction: still `overview-horizontal-wallpaper.png`.
- Board wallpaper: still `overview-horizontal-wallpaper.png`.
- View menu, the eight groupings and the Nest child threads toggle: still `overview-view-menu.png`; the current view chip is visible in the GIF.
- Group filter including the No group bucket: still `overview-group-filter.png`.
- Project, Provider, and State filters, and search: visible in the toolbar of every board still, deliberately not opened. They are standard filter menus whose open state adds no group or family information the still set lacks.
- Family scope chip and Clear: current (the old GIF's Parent view), still `overview-parent-view.png`.
- Thread count and the What's new gift: visible in the board stills, not treated as a feature to demonstrate.
- Board pan: omitted. It is a touch-only gesture with no pointer to photograph; the live-DOM contract is pinned by `tests/manual` and `probe-board-touch-scroll.mjs`.
- Empty workspace: omitted. `scripts/uat/release-shots.mjs` already photographs the first-run empty board; it is not a marketing surface.
- Compact filter ribbon on a phone: omitted. The phone stills show the stacked toolbar; the ribbon toggle is a phone-only control covered by the release-safety set.
- Thread pane: still `board-thread-pane-dark.png` and the light variant.
- Phone board and full-screen pane: still `phone-board-light.png` and `phone-thread-pane-dark.png`.

### Feature groups

- Expanded group frame around sibling cards: current, GIF (Release 1.0, Triage, Chat pipeline), still `overview-groups.png`.
- Folded group card with its member and descendant dots: GIF (Chat pipeline folds on camera; Docs sweep starts folded), still `overview-groups.png`.
- Group of one (a solo frame, the join target): GIF (Triage), still `overview-groups.png`.
- One group spanning several lanes, one frame per lane: GIF (Release 1.0 in Unread, Working, and Done), still `overview-groups.png`.
- Clicking a group frame to light its footprint in every lane: still `overview-group-highlight.png`.
- Group context menu (new thread, zoom, rename, collapse, ungroup): still `overview-group-menu.png`.
- Group picker (current group, filter, create, rename, delete, remove from group): still `overview-group-picker.png`.
- Dropping a card onto a group frame to join it: GIF (the Triage frame grows from one card to two).
- Dropping a card onto a parent inside a group to nest it: GIF (the parent gains a fourth nested row).
- Dragging a group label or member to move the whole unit: omitted. A synthetic drag renders the ring and the insertion line but not the browser's native drag ghost, so a still would advertise a gesture it cannot show; the write is covered by `board-box-reorder` and the rank UAT suites.
- Inline group-label rename editor: omitted. The picker still shows the pencil and explains the rename; the editor is a transient input that would read as an empty box.
- Ungroup all members: still `overview-group-menu.png` (the entry is visible; the confirm is not run).
- New thread in group: still `overview-group-menu.png` (the entry is visible; the composer is outside the board).
- Zoom to group: omitted. It leaves the Focus view for the Group board, which is a different surface; the release-safety set photographs that board.
- A group with zero members: omitted because the board never renders a frame for it. There is nothing to photograph.

### Families

- Expanded parent with nested child rows: current, GIF, still `overview-groups.png`.
- Grandchild sub-rows: current (the old GIF's opening frame), still `overview-group-dots.png` shows the same depth as dots.
- Collapsed parent with its dot strip: current, GIF (the ledger and bridge parents), still `overview-groups.png`.
- Three dot tiers in a folded group card (member, child, grandchild): still `overview-group-dots.png`.
- Fold cap and the Show all N handle: current (the old GIF's opening frame), still `overview-family-fold.png`.
- Done projection (a live family's done child in the Done lane): GIF (the Done lane is visible throughout), still `overview-done-sweep.png`.
- A done parent keeping its single Done card: omitted. The fixture has a projection and settled cards; a done root would duplicate the done-space story without adding a distinct visual.
- Dragging a card onto a card's middle to nest: GIF.
- Dragging a nested child onto a column floor to un-nest: omitted. It is the inverse of the nest, the result is the card returning to a lane, and the gesture is already pinned by `board-strip-nest` and the UAT suites.
- Zoom to family and the scoped Parent view: current (the old GIF is entirely this gesture), still `overview-parent-view.png`. The new GIF leaves it out because the Parent view is a sparse surface for a small family and the swap costs seconds of screen time.
- Parent view row sweeps: still `overview-parent-view.png` (the row rails and their brooms are visible).
- Idle-child hide: omitted. It is a small eye control on a parent card; no fixture exercises it, and a still would be a control with no visible effect.
- A child that needs you un-nesting onto its own card: omitted. The assembly rule is pinned by `repro-orchestrator-grandchildren` and the nesting tests; a still cannot show the transition.
- Archived children and archived parents: omitted. Archived rows render nowhere by design, so there is nothing to photograph.
- Keep-in-view when a lane changes: omitted. It is a motion guarantee, not a state.

### Cards and state

- Working, attention, unread, and idle dots: current, GIF, still `overview-groups.png`.
- The attention pulse: current, GIF (the Deploy failed card pulses in Needs you).
- The working rate pulse: current, GIF (the Working dots breathe at their measured rates).
- Pinned lane and pin glyph: current, GIF, still `overview-groups.png`.
- Pin and unpin from the card menu: omitted. The card menu still shows the entry, but the GIF already spends its motion on the two group drags; the write is covered by `board-drop` and the UAT suites.
- Drag to Pinned, Unread, or Done to change state in one drop: omitted. A third state-changing drag would lengthen the GIF past its 10 s budget; the Done lane's result is in `overview-done-sweep.png`.
- Done checkbox on hover: omitted. It is a hover-only affordance; the done cards and the projection carry the Done story.
- Snoozed card (dimmed, with the wakes chip): GIF (Draft the marketplace FAQ in Idle · Recent), still `overview-groups.png`.
- Ticket chips with status dots: current, GIF (the pinned #331, the parent #273, the chip card #142 and #87), still `overview-done-sweep.png`.
- External tracker chips and tag chips: current (the old GIF's opening frame), not repeated in the new set. The chip-probe stills in `docs/screenshots/chip-probe-*.png` keep the coverage.
- Card context menu: still `overview-card-menu.png`.
- New child thread composer: omitted. It opens a modal outside the board and is covered by the release-safety modal shots.

### Sweep

- The sweep pill on every sweepable lane: GIF (the Done lane's broom and count are visible at rest), still `overview-done-sweep.png`.
- Arming with the lane's pre-selection, the destination in the pill, and Cancel beside it: still `overview-done-sweep.png`.
- Shift and command multi-select before sweeping: omitted. It needs a two-gesture sequence and a selection state that a single still cannot explain; the UAT sweep suites pin it.
- Confirming, running, and undoing a sweep: omitted. A run mutates the fixture and its progress banner is transient; the armed state and the destination carry the affordance.
- Sweep destinations beyond Done (idle to Done, Pinned unpin, Unread mark read): omitted. The pills are visible on every lane at rest; one armed lane is enough to explain the gesture.

### Views

- Focus view: current, GIF.
- Parent thread view: current (the old GIF), still `overview-parent-view.png`.
- Group view: omitted. It is a separate board surface and outside the Focus view this media set covers; `docs/release-safety/families-desktop.png` photographs it.
- Last activity, Project, Provider, Machine, and None: named in `overview-view-menu.png`, not photographed one by one. Each reuses the same lane structure with different buckets, so five more board stills would repeat the same picture.

## Regenerating

```sh
npm ci
npm run build
npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
node scripts/screenshot/capture-overview-gif.mjs      # terminal 2
node scripts/screenshot/capture-overview-stills.mjs
```

`FRAMES_DIR` keeps the raw GIF frames, `GIF_WIDTH` and `GIF_FPS` override the output, and `OUT_DIR`, `HARNESS_URL`, and `CHROME_PATH` behave like the other captures. The storyboard is `scripts/screenshot/storyboards/overview.mjs`; the shared recorder is `scripts/screenshot/lib/recorder.mjs`. A new GIF is a new storyboard object, not a copy of the entry script.
