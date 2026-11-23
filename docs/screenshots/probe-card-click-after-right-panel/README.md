# Probe: does an action in the native pane send the next card click to the legacy pane?

Operator report, 2026-11-21, reproduced here in a throwaway browser profile against the live host and then re-measured on the fixed build.

> sometimes (uncertain on repro steps) when the native thread pane is open, clicking on a card then opens the legacy focus board thread pane instead of swapping the native one. This _may_ be occurring after an action is taken in the native pane that causes the right sidebar to open in bb.

`scripts/screenshot/probe-card-click-after-right-panel.mjs` drives the board's own cards with the click trace on (`nativeOpenDebug`, set for the run and put back afterwards) and reads, after every step: the branch the click took, the host's split layout, the board's record, the in-panel pane and bb's right panel.

| Phase | Action in the native pane | Next card click |
|---|---|---|
| A | nothing (baseline) | replaced the pane's thread |
| B | opened bb's right panel (`Show right panel`) | replaced the pane's thread |
| C | clicked a sidebar row: the pane navigated from inside itself | **before: opened the board's own in-panel pane. after: a fresh native pane beside the board** |
| D | right panel open, then the same navigation | same as C |
| E | the stale state, then bb's own "Open in split" for a third thread | a pane beside the board, the board's slot kept, the operator's pane untouched |

## What the trace said, before the fix (`before/`)

Phase C and D, one line per click, verbatim:

```json
{"threadId":"thr_cvvvkw6rjz","branch":"in-board: no pane of the board's to use",
 "compactViewport":false,
 "layout":[{"paneId":"pane-1","threadId":null,"focused":true},
           {"paneId":"pane-2","threadId":"thr_bkg7afa7nv","focused":false}],
 "record":{"paneId":"pane-2","threadId":"thr_9hvf4kvdnn"}}
```

`record.threadId` no longer matches `pane-2`'s thread: the operator's navigation replaced it. That branch is the reported symptom, and the frame (`before/C-4-card-click-after-rethread.png`) shows it: the board's own `Thread: Refine strategic engineering goals` pane over the board, the native pane still on the navigated thread.

Phase B is the control: the right panel opening changes nothing the click reads (pane ids intact, record matching) and the replacement works, so the right panel alone is not the trigger.

## What the trace said, after the fix (`after/`)

The same probe with `SERVE_BUNDLE=dist/app.js`, which answers the host's own `plugin-app-assets/<hash>/app.js` request from the candidate build (the trick `probe-board-remount-on-split.mjs` uses; the operator's install is untouched, and every state line's `candidateBundle` reads `swapped` to prove the page ran it). Phase C, verbatim:

```json
{"threadId":"thr_29gxjg77x4","branch":"fresh pane: asking the opener beside the board",
 "layout":[{"paneId":"pane-1","threadId":null,"focused":true},
           {"paneId":"pane-2","threadId":"thr_bkg7afa7nv","focused":false}],
 "record":{"paneId":"pane-2","threadId":"thr_8nbzpbmm3c"},"priorPaneIds":["pane-1","pane-2"]}
{"step":"fresh-pane-ask","outcome":"adopted","threadId":"thr_29gxjg77x4","paneId":"pane-3","priorPaneIds":["pane-1","pane-2"]}
{"threadId":"thr_29gxjg77x4","branch":"fresh pane: the host split","paneId":"pane-3","priorPaneIds":["pane-1","pane-2"]}
```

The window ends with `pane-1` (the board), `pane-3` (the clicked thread, focused, recorded) and the operator's `pane-2` untouched. No in-panel `Thread:` aside on any phase. Phase A and B still replace in place, so the shipped path did not move.

## The exact sequence

```sh
bb plugin config focus-board set nativeOpenDebug true   # the click trace; put back afterwards
node scripts/screenshot/probe-card-click-after-right-panel.mjs                    # before
npm run build && SERVE_BUNDLE=dist/app.js OUT_DIR=docs/screenshots/probe-card-click-after-right-panel/after \
  node scripts/screenshot/probe-card-click-after-right-panel.mjs                  # after
bb plugin config focus-board set nativeOpenDebug false
```

The probe opens `BB_APP` (default `http://127.0.0.1:38886/plugins/focus-board/board`) in its own browser context per phase — no storage and no split layout shared with the operator's window — clicks the first board card to let the board open and adopt a native pane, then does the phase's action and clicks the next card. It reads only, apart from navigation and the two debug-setting writes above.

Each run's `evidence.json` carries every phase's states, the click trace payloads, the console and the main-frame navigations; frames are `<phase>-<step>.png`.

## What it means

Reproduced: a card click in a window with a native pane opened the board's own in-panel pane, exactly as reported, whenever the board's pane record no longer matched the live pane. Not reproduced: the right panel alone. The fix and its tests are in `lib/native-fresh-pane.ts` and `docs/plans/2026-11-17-one-board-pane.md` §11.

> AGENT GENERATED CONTENT
