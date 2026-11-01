# Demo gifs in release notes

A release page must show what it changed. Every demonstrable feature in a release gets a short gif in its GitHub Release notes, placed directly under the bullet that names it. The rule is per feature, not per release: one release may carry no gifs or a dozen.

## The rule

- Walk the release's `Added` and `Changed` bullets, and the `Fixed` bullets that change something an operator can see. For each one, decide *demonstrable* or *skip*, and record the decision.
- **Demonstrable** means the screenshot harness can stage the state and drive the gesture: a menu, a drag, a fold, a settings toggle, a pane opening, a status change. If it moves on screen and the harness can reach it, it gets a gif.
- **Skip** means geometry no gesture reveals (a 4px gutter, a font's weight, an opaque banner's exact border), timing or internal work with no on-screen state (a hung transport call, a cache's age, a repaint count), or an interaction the harness cannot stage. A skipped bullet is named in the pull request and in the release's thread with one line of why. Silently missing gifs are the failure this rule exists to prevent.
- **Building the automation is part of shipping the release.** When a feature has no demo because the harness cannot reach it yet, adding the seed fixture, the gesture driver, or the storyboard step is release work, not a follow-up. Those storyboards outlive the release: the next one starts from them.

## Where the pieces live

| Piece | Path |
|---|---|
| Recorder (shared gestures, the arrow and finger overlays, two-window capture, ffmpeg assembly) | `scripts/screenshot/release-demos/runner.mjs` |
| The orientation lead-in every demo inherits | `scripts/screenshot/lib/lead-in.mjs` |
| The shared host row two windows write to (`?sharedHost=<token>`) | `scripts/screenshot/host-state.ts`, `scripts/screenshot/host-log.ts` |
| CLI entry | `scripts/screenshot/capture-release-demos.mjs` |
| One storyboard file per release | `scripts/screenshot/release-demos/<version>.mjs` |
| Harness fixtures and query params | `scripts/screenshot/data.ts`, `scripts/screenshot/main.tsx`, `scripts/screenshot/mock-sdk.tsx` |
| Output | `docs/screenshots/release-demos/` (gitignored), then uploaded as release assets |

A storyboard is a list of demos, each one a clip target, a URL, and a few gesture calls:

```js
export const baseParams = "demo=1&collapsed=thr_demo_needs";
export const demos = [
  {
    id: "zoom-to-family",
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_demo_work"]');
      await g.rightClickCard('[data-thread-card="thr_demo_work"]');
      await g.menuPick("Zoom to family");
      await g.shot("parent", { hold: 2.4 });
    },
  },
];
```

Run it against the harness:

```sh
npm run build
npx vite --config scripts/screenshot/vite.config.ts
node scripts/screenshot/capture-release-demos.mjs v1.5.0
```

`--only <id>` records one demo, `HARNESS_URL` points at another port, `DEMO_OUT_DIR` moves the gifs. The runner gives every demo a fresh page with cleared storage, so one demo's filter never hides the next one's cards.

## Capture from the tag's own build

Capture each release's gifs against **that release's tree**, in a throwaway worktree (`git worktree add --detach <dir> vX.Y.Z`, then `npm ci`, `npm run build`, and the harness). A gif is evidence of what shipped: a later release's fixtures, chrome, or gestures can change the picture, and a gif of today's board under last month's release notes is a false claim. The exception is a feature whose behavior is untouched since its tag and whose demo the tag's harness still stages; then capture on `dev` and say so in the pull request.

## Upload and embed

- The gif is a **release asset**, never a repo file: media in the repo bloats every clone and the git history keeps it forever.
- `gh release upload <tag> <file>` adds it; `gh release edit <tag> --notes-file notes.md` publishes the notes.
- Put the image directly under the bullet it demonstrates, with a one-line caption naming the feature. Leave the rest of the published body verbatim. The bullet's own text is usually the caption; add one only when the gif shows a shape the bullet does not name.
- Never recreate a release, move a tag, or retag to fix notes. Editing the body and adding assets is the whole operation.

## Budget

- Short is fine when the feature is quick. A gif's length is the story's length: a single-gesture demo (one menu pick, one toggle) may run under 15 seconds because padding a one-click story to a floor is dead air the reader scrolls past. Past 45 seconds is a video nobody finishes, so split the story by feature rather than let one clip run long.
- **Every gif opens on the board at rest.** The recorder holds the staged board for about a second before the storyboard's first gesture (1s by default, `scripts/screenshot/lib/lead-in.mjs`), so a viewer arrives with the before-picture the gesture is about to change. It is applied once, for every demo, rather than hand-written into each storyboard; a demo that needs a longer beat sets `leadIn: 1.6`, and `leadIn: 0` opts out. Nothing else may remove it, and `tests/release-demo-storyboards.test.ts` fails when a storyboard's value is not a deliberate number of seconds.
- A few MB per gif. Keep the source viewport honest and let the palette-optimized ffmpeg pass (`palettegen` 192 colors) keep the file small; a demo that needs more is doing too much in one gif, so split it by feature.
- **Every gif plays at 15 fps or faster.** 15 is the floor, not the target: the recorder assembles at 24 fps by default (`DEFAULT_FPS` in `runner.mjs`) because a finger crossing the board reads smoother there, and `DEMO_FPS` may raise the rate. A rate under 15 throws rather than clamping, and motion frames are captured one per playback frame (`stage.frameSeconds`), so a pan shows the board at each step instead of two stills. The floor applies to footage captured from now on: assets already published on older release pages keep the slower rate they shipped at until something re-captures them, and re-capturing the whole back catalogue is a separate decision, not a cleanup.
- Real app, real gestures, synthetic pointer: the harness renders the shipped components, the driver moves a real pointer (or dispatches the drag events, or lands a real CDP touch, the app itself listens for), and an overlay makes the pointer visible because headless screenshots carry no OS cursor. The overlay has two vocabularies and a clip carries only one: a mouse demo shows the arrow (`#demo-cursor`), a touch demo shows the fingertip ring with its contact dot (`#demo-touch`), hidden until the finger lands and moved to the exact coordinate of each touch event. The viewport picks it: `hasTouch` means a finger.
- One feature per gif. If a bullet's story needs two scenes, it is two bullets or two gifs.

## Two windows in one gif

Some features are a write in one window landing in another. The recorder stages those for real: a demo with `windows: 2` opens a second live page against the same mocked host, every `shot` captures both, and the assembled gif stacks them side by side behind a hairline divider. `g.use("peer")` moves the pointer and the gestures to the second window without breaking the frame lockstep.

The shared host is the part that makes the two pages honest: `?sharedHost=<token>` turns on a per-pair write log over localStorage (`scripts/screenshot/host-log.ts`), and both windows apply each received write through one function (`scripts/screenshot/host-state.ts`), firing the realtime signal the real server publishes, so the second window refetches exactly as bb's own second window does. `scripts/uat/run.mjs` drives the same pairing with `defaults.windows: 2` and `page: peer` steps, gated by `tests/manual/uat-two-windows.yaml`.

Two fixed viewports of the same size are required: the halves are hstacked, so a height difference fails the assembly rather than cropping silently.

## Seed fixtures beat forked boards

When a bullet's shape does not exist on the demo board, add an opt-in fixture, never a second board: a query param in `scripts/screenshot/data.ts` behind `scripts/screenshot/mock-sdk.tsx`, the way `?idlebusy=1`, `?dualgroups=1` and `?pinnedgroup=1` seed the three shapes the demo board could not stage. The fixtures outlive their releases; the next bullet that needs the same shape starts from them.

## Coverage

The backfill's per-bullet decisions live here so the record survives the pull request that made them. `Demonstrated` means the release page carries a gif for that bullet today.

| Release | Bullet | Status | Unlocked by |
|---|---|---|---|
| 1.6.0 | Two boards stop erasing each other's Done and sweep-keep marks | demonstrated | two-window driver (`windows: 2`) over the shared host row |
| 1.6.0 | A family folded in one window stays folded when the other folds one | demonstrated | two-window driver |
| 1.6.0 | A group created in one window survives a simultaneous change in another | demonstrated | two-window driver |
| 1.6.0 | A rank drag in one window survives another window's drop | demonstrated | two-window driver |
| 1.6.0 | A wallpaper chosen in one window survives the second window's dim change | demonstrated | two-window driver (the wallpaper document is already cross-window) |
| 1.7.0 | Hiding idle children no longer buries a busy grandchild | demonstrated | `?idlebusy=1` |
| 1.7.1 | A family's fold and idle filter follow you to every window and machine | demonstrated | two-window driver |
| 1.7.3 | A child in a different group than its parent shows twice | demonstrated | `?dualgroups=1` |
| 1.7.3 | A pinned member keeps its group's dashed frame | demonstrated | `?pinnedgroup=1` |
| 1.7.3 | Two groups can no longer share a name | demonstrated | `?dualgroups=1` plus the picker's rename editor |
| 1.7.4 | Holding a card on touch picks it up to drag it | demonstrated | the storyboard's CDP touch finger (puppeteer touchscreen, the touch suites' 420ms hold) |
| 1.7.4 | A folded family's dots now sit in a capsule for each child that has sub-threads | demonstrated | the demo board's Family D folded through `?collapsed=`, hovered for its name bubble |
| 1.7.4 | A running thread reads Working even while its pane is open | demonstrated | a mid-clip state flip through the harness's `__uat.pushThreadUpdate` |
| 1.7.4 | A phone's board pans under a finger instead of lifting a card | demonstrated | CDP touch moving before the hold arms, the pan the board-touch suite drives |
| 1.7.4 | A slide that starts on the toolbar or a lane's title strip pans the board, never the page behind it | demonstrated | CDP touch from the toolbar origin |
| 1.7.4 | A lane with nothing to its right stops trapping the slide | demonstrated | CDP touch from the board's far right; the slide hands outward |

Still skipped, with the reason:

| Release | Bullet | Why no gif |
|---|---|---|
| 1.5.0 | Chip statuses refetch at the operator's moments | Timing of a network snapshot; the pixels are identical either way. |
| 1.5.0 | The default board view is named Focus | A label rename; a gif would be a still of the View chip. |
| 1.5.0 | The right-click menu uses the room the window gives it | Window-height geometry; no gesture shows it in one shot. |
| 1.5.0 | The right-click menu reads as a menu, not a card | Static surface styling; other menus' gifs already show it. |
| 1.5.0 | A family card's nested rows keep the card's right gutter | A 12px indent mirror; nothing moves. |
| 1.5.0 | A hung chip-status call can no longer freeze the snapshot | Transport timing; the board never changes on screen. |
| 1.5.0 | Ticket-chip dots stay truthful about the cache's age | Needs an aged cache row and an hour of wall clock. |
| 1.5.0 | Hovering a card in the open pane's lane no longer ghosts a lane | Proves an absence; nothing appears on screen to film. |
| 1.5.0 | Board alert banners paint a full-strength surface | A contrast fix; a still shows it and motion adds nothing. |
| 1.6.0 | Hovering a card no longer re-renders the whole board | Render count; identical pixels frame to frame. |
| 1.6.0 | The Parent view's row rail is narrower | A width change; a still. |
| 1.6.0 | Chip dots age honestly instead of spawning gh | Internal process; no on-screen state. |
| 1.6.0 | A board crowded with attention cards no longer crawls | Frame-rate fix; the gif would look identical. |
| 1.7.0 | A wallpaper's letterbox bars take the image's edge color | Needs a CORS-permitted photo whose edge colour differs from the theme; a still. |
| 1.7.0 | A burst of realtime signals refetches the board once | Refetch pacing; no on-screen state. |
| 1.7.0 | A state change repaints only the changed cards | Render count; identical pixels. |
| 1.7.0 | Opening a thread on a big board repaints one card | Render count; identical pixels. |
| 1.7.0 | The wallpaper crop tunes over the image itself | Needs a seeded photo wallpaper; the harness has bundled gradients only. |
| 1.7.0 | The wallpaper frames the window, not the board's viewport | Same photo seed. |
| 1.7.0 | A phone's pane header sizes the done checkbox to its thumb | A target-size measurement; a still. |
| 1.7.0 | The New Thread dialog's header controls no longer touch | 16px of spacing; a still. |
| 1.7.0 | `bb focus-board done list` survives a deleted index entry | A CLI, not the board; the harness renders no terminal. |
| 1.7.1 | The pane's queued-message Send button works on a phone | The mock chat cannot queue a message, so the row never renders. |
| 1.7.2 | A phone stops repainting the whole board when the pane opens | Repaint count; identical pixels. |
| 1.7.3 | The group picker lists groups alphabetically | Shown inside the group-picker gif rather than a second asset. |

## Checklist for a release producer

1. Read the section being published and list every bullet with `demonstrable` or `skip: <reason>`.
2. Write or extend `release-demos/<version>.mjs`; add harness fixtures where the board cannot stage a state, and `windows: 2` where the bullet is a cross-window write.
3. Capture against the tag's build; check each gif's first and last frame show the before and after, that the first second is the board at rest, that a touch clip shows its finger on every frame the gesture moves, and that the gif plays at 15 fps or faster.
4. Upload the assets, embed them under their bullets, keep the body otherwise verbatim, and verify with `gh release view <tag>`.
5. Name every skip, with its reason, in the pull request that ships the release and in the Coverage table above.
