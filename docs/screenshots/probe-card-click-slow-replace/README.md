# Probe: does one card click ever leave two thread surfaces?

The operator's report of 2026-11-24, with a screenshot:

> clicking a card BOTH took over the (correct) existing pane AND also launched the in-fb-pane side panel. EXPECTED: existing pane takeover, NO in-fb-pane panel

The screenshot shows the board, a native pane holding the clicked thread, and the board's own in-panel pane holding it too.

## Why this needs a slow window

The replacement click asks the host twice and then arms a deadline:

1. `open(thread, { split: true })` focuses the board's pane (the thread the pane already shows);
2. once the layout shows that pane focused, a route navigation the host reconciles into it;
3. `REPLACE_CONFIRM_MS` (400ms) is the net for a host that never answers: it opens the board's own pane and drops the record.

On a small, warm window both host steps land inside the click's own flush and the net never fires. The operator's window carries 308 threads on the board, so a host step can land after the net. This probe slows the renderer deliberately (CDP `Emulation.setCPUThrottlingRate`) in its own browser context per rate, clicks one card to open a native pane, then clicks a second card to replace in it, and samples the window every 100ms for three seconds. A sample where the native pane holds the clicked thread AND the in-panel pane is mounted is the reported state.

## What it measured

`before/` is the bundle the operator's install serves (a build of `dev` before this change, served over the installed one with `SERVE_BUNDLE`); `after/` is this change's build. Both at the same four throttle rates, same click sequence.

| CPU throttle | Old bundle | This change |
|---|---|---|
| 3x | net fired with the focus step still pending: the board's own pane opened (15 samples), the native pane never took the clicked thread (0) | net fired with the landing navigation already issued: the board's own pane never opened (0), the native pane took the clicked thread (17 samples) |
| 5x | in-panel pane 4 samples, native pane 0 | in-panel pane 0, native pane 4 |
| 10x | in-panel pane 1, native pane 0 | in-panel pane 0, native pane 1 |
| 20x | in-panel pane 0 samples by the final read, native pane 0 | in-panel pane 0, native pane 1 |

`before-1x-6x/` brackets the net on the old bundle: at 1x and 2x the host answered inside the click's flush and the net never fired; at 4x and 6x it fired with the focus step still pending. The two runs above happened to catch different halves of the same race: the old bundle had focus pending at the net, this change had the landing in flight.

The trace names the half. Old bundle, verbatim:

```json
{"threadId":"thr_r282wvvnkf","branch":"replace", ...}
{"threadId":"thr_r282wvvnkf","branch":"in-board: replacement not confirmed", ...}
```

This change, same click:

```json
{"threadId":"thr_r282wvvnkf","branch":"replace", ...}
{"threadId":"thr_r282wvvnkf","branch":"replace: the host still owes the landing", ...}
```

## Where the two-surface state is reproduced exactly

The window between "the landing navigation is issued" and "the host applies it" is narrow on a live window even when throttled, so the exact two-surface sample is not in these directories. It is reproduced deterministically in `tests/app-card-click-replaces-board-pane.test.tsx`, "a slow host": the test holds the fake host's route application back, lets the net fire, and asserts the board's own pane never opens. That test fails against the logic this change replaces (the net opened the in-panel pane while the host had the landing in flight) and passes now.

## The two rules this change pins

- The net settles against the rendered layout before it gives up: a pane that shows the clicked thread keeps the record and opens nothing, and a host that already has the landing navigation is left to deliver it.
- The landing effect treats the pane's content as the succeeded state, not its focus. Focus gates the navigation and nothing else.

Neither rule raises the deadline. 400ms stays the net for a host that never answers; it is no longer a race the click runs against its own request.

## The exact sequence

```sh
bb plugin config focus-board set nativeOpenDebug true
# the operator's current build, served over the installed bundle
CPU_RATES=3,5,10,20 SERVE_BUNDLE=<a build of dev before this change>/dist/app.js \
  OUT_DIR=docs/screenshots/probe-card-click-slow-replace/before \
  node scripts/screenshot/probe-card-click-slow-replace.mjs
# this change
npm run build
CPU_RATES=3,5,10,20 SERVE_BUNDLE=dist/app.js \
  OUT_DIR=docs/screenshots/probe-card-click-slow-replace/after \
  node scripts/screenshot/probe-card-click-slow-replace.mjs
bb plugin config focus-board set nativeOpenDebug false
```

The probe opens `BB_APP` (default `http://127.0.0.1:38886/plugins/focus-board/board`) in its own browser context per rate, loads unthrottled, then applies the throttle before the clicks. Frames are `<rate>-<step>.png`; `evidence.json` carries every sample and trace payload.

> AGENT GENERATED CONTENT
