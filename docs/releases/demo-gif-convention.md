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
| Recorder (shared gestures, cursor, ffmpeg assembly) | `scripts/screenshot/release-demos/runner.mjs` |
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

- Target 15 seconds, hard ceiling 45. A single-gesture demo (one menu pick, one toggle) may run 8 to 15 seconds, because padding a one-click story to 15 seconds is dead air the reader scrolls past; anything past 45 is a video nobody finishes.
- A few MB per gif. Keep the source viewport honest and let the palette-optimized ffmpeg pass (`palettegen` 192 colors at 12 fps) keep the file small; a demo that needs more is doing too much in one gif, so split it by feature.
- Real app, real gestures, synthetic cursor: the harness renders the shipped components, the driver moves a real pointer (or dispatches the drag events the app itself listens for), and an overlay arrow makes the pointer visible because headless screenshots carry no OS cursor.
- One feature per gif. If a bullet's story needs two scenes, it is two bullets or two gifs.

## Checklist for a release producer

1. Read the section being published and list every bullet with `demonstrable` or `skip: <reason>`.
2. Write or extend `release-demos/<version>.mjs`; add harness fixtures where the board cannot stage a state.
3. Capture against the tag's build; check each gif's first and last frame show the before and after.
4. Upload the assets, embed them under their bullets, keep the body otherwise verbatim, and verify with `gh release view <tag>`.
5. Name every skip, with its reason, in the pull request that ships the release.
