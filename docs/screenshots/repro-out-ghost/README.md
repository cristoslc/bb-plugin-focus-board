# Repro and evidence: a lane that empties mid-dissolve (issue #391)

> [!NOTE]
> Issue: [#391 — A relocation that empties its lane drops the transporter dissolve's out-ghost](https://github.com/cristoslc/bb-plugin-focus-board/issues/391). Cosmetic, pre-existing (proven on `47ffa8b` by the perf lane's ledger before the mount-age transport guard landed).

The board renders a lane only while that lane holds cards (`components/grouping`'s "columns exist only while they hold cards" rule). A relocation that takes a lane's last card out therefore removed the lane from the next commit, and the departing ghost dissolved into a lane that was no longer on the board: the card popped instead of easing out.

`scripts/screenshot/repro-out-ghost.mjs` drives the shape as a data move on the harness: the last card of the Idle · Earlier lane (`thr_env_edge`, after a pre-roll moves `thr_icon_lazy` out) relocates to Pinned through the mock sidebar's own push, with the dissolve transport selected (`focus-board:cardTransport` = `teleport`).

## The two runs

| Run | Tree | Ghost frames | Phases sampled | Lane held | Read |
|---|---|---|---|---|---|
| `before` | dev without the fix | 0 | none | 0ms, gone at 0ms | the pop: the wipe never got a frame |
| `after` | dev with the fix | 25 (`0ms` to `597ms`) | `wiping-out` then `collapsing` | 25 samples, lane left at `620ms` | the ghost plays the whole dissolve inside a held frame, which closes right behind it |

`evidence-before.json` and `evidence-after.json` carry the full sampled timeline (one reading every ~20ms: lane present, `data-column-closing`, ghost present, ghost phase, ghost opacity) plus the frame verdicts.

## Frames

| File | What it shows |
|---|---|
| `before-pre.png` / `after-pre.png` | the lane still holds its last card, before the move |
| `before-mid.png` | the row without the Idle · Earlier lane and without a ghost: the pop |
| `after-mid.png` | the held `Idle · Earlier` frame in place, the departing card dissolving inside it |
| `after-collapse.png` | the same frame at the ghost's slot collapse (the card is gone, the lane still stands) |
| `before-post.png` / `after-post.png` | settled: the card in Pinned, the emptied lane closed |

## Reproduce it

```bash
npm run build                                    # the harness loads dist/app.css
npx vite --config scripts/screenshot/vite.config.ts &
LABEL=after node scripts/screenshot/repro-out-ghost.mjs
```

`LABEL=before` on a tree without the fix prints `popped with the lane: true` and exits 1 only if the read disagrees with the tree it is pointed at, so the same script proves both directions.
