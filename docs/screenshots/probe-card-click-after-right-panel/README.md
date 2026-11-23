# Probe: does an action in the native pane send the next card click to the legacy pane?

Operator reports on 2026-11-21 and 2026-11-23, reproduced here in a throwaway browser profile against the live host and measured on the fixed build and on the build before it.

> sometimes (uncertain on repro steps) when the native thread pane is open, clicking on a card then opens the legacy focus board thread pane instead of swapping the native one. This _may_ be occurring after an action is taken in the native pane that causes the right sidebar to open in bb.

`scripts/screenshot/probe-card-click-after-right-panel.mjs` drives the board's own cards with the click trace on (`nativeOpenDebug`, set for the run and put back afterwards) and reads, after every step: the branch the click took, the host's split layout, the board's record, the in-panel pane and bb's right panel.

| Phase | Action in the native pane | Next card click |
|---|---|---|
| A | nothing (baseline) | replaced the pane's thread |
| B | opened bb's right panel (`Show right panel`) | replaced the pane's thread |
| C | clicked a sidebar row: the pane navigated from inside itself | **before: opened the board's own in-panel pane. after: a fresh native pane beside the board** |
| D | right panel open, then the same navigation | same as C |
| E | the stale state, then bb's own "Open in split" for a third thread | a pane beside the board, the board's slot kept, the operator's pane untouched |
| F | clicked the rail's **Decisions** entry: the pane navigated to a page, not a thread | the shipped bundle: a fresh native pane beside the board (three panes, the page pane untouched). The pre-1.8.2 bundle: **the board's own in-panel pane** (two panes) |
| G | F repeated, a different page each cycle | the shipped bundle: one extra pane per page the window has not shown yet (2 → 3 → 4 → 5). The pre-1.8.2 bundle: no growth, the in-panel pane every time |

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

## The page-route shape, measured on both bundles (2026-11-23)

The operator reported again on 2026-11-23, and named a shape phases A–E never produced:

> I think I'm still seeing the pane confusion, mostly when I navigate the native pane to a different location (like Decisions). Is there any way to keep track of the pane even if the thread is different? Or to create a new split instead of switching to the fb-internal pane?

A page is not a thread. Navigating the pane there leaves it in the layout with `threadId: null`, so the board's `{paneId, threadId}` record stops matching it the same way phase C's rethread does, but through a route the record cannot even name.

**The shipped bundle (this directory's A–G frames, `evidence.json`).** The installed host at 1.8.3-dev, bundle `824ef69d2bb8e752`, which carries the fresh-pane rule. Phase F, verbatim:

```json
{"threadId":"thr_bcymmhtpms","branch":"fresh pane: asking the opener beside the board",
 "compactViewport":false,
 "layout":[{"paneId":"pane-1","threadId":null,"focused":true},
           {"paneId":"pane-2","threadId":null,"focused":false}],
 "record":{"paneId":"pane-2","threadId":"thr_8nbzpbmm3c"},"priorPaneIds":["pane-1","pane-2"]}
{"step":"fresh-pane-ask","outcome":"adopted","threadId":"thr_bcymmhtpms","paneId":"pane-3","priorPaneIds":["pane-1","pane-2"]}
{"threadId":"thr_bcymmhtpms","branch":"fresh pane: the host split","paneId":"pane-3","priorPaneIds":["pane-1","pane-2"]}
```

`record` still names `pane-2` and the thread the board put there; the layout reports `pane-2` with no thread at all. The click asks the opener for the clicked thread, gets `pane-3`, and adopts it. The window ends with the board, `pane-3` focused on the clicked thread, and the Decisions pane untouched. No in-panel `Thread:` aside: `F-4-card-click-after-decisions.png`.

**The pre-1.8.2 bundle (`before-1.8.2/`).** The same probe with `SERVE_BUNDLE` pointed at a build of `6c9eb2f3`, the merge before the fresh-pane rule landed (every state line's `candidateBundle` reads `swapped`, so the page ran it). Phase F:

```json
{"threadId":"thr_bcymmhtpms","branch":"in-board: no pane of the board's to use", ...}
```
→ route `/plugins/focus-board/board/t/thr_bcymmhtpms`, two panes, `inBoardPane: "Thread: Orchestrate media stack threads"`.

That is the reported symptom, exactly, and `before-1.8.2/F-4-card-click-after-decisions.png` is the frame: the board's own thread pane over the board, the Decisions page still beside it. Only phases F and G are kept from that run, since `before/` already holds A–E on the older bundle.

## What phase G measures

A page route lands in the pane that already holds it, and otherwise replaces the focused pane, so a page the window has not shown yet costs a pane of its own. On the shipped bundle each cycle of "navigate the board's pane to a new page, click a card" adds one: 2 → 3 → 4 → 5 panes over three cycles. The board keeps tracking the pane it adopts, so every later card click replaces there correctly. What is left over is the page pane the board no longer names, and the split the first click after each navigation spends.

On the pre-1.8.2 bundle the count never moves off two, because the click never splits: the thread always lands in the board's own pane, which is the same reason the window feels stuck on that pane.

## The exact sequence

```sh
bb plugin config focus-board set nativeOpenDebug true   # the click trace; put back afterwards
node scripts/screenshot/probe-card-click-after-right-panel.mjs                    # before
npm run build && SERVE_BUNDLE=dist/app.js OUT_DIR=docs/screenshots/probe-card-click-after-right-panel/after \
  node scripts/screenshot/probe-card-click-after-right-panel.mjs                  # after
bb plugin config focus-board set nativeOpenDebug false
```

The 2026-11-23 run adds the two comparisons above:

```sh
bb plugin config focus-board set nativeOpenDebug true
node scripts/screenshot/probe-card-click-after-right-panel.mjs                    # the shipped bundle, phases A-G
SERVE_BUNDLE=<a build of 6c9eb2f3>/dist/app.js \
  OUT_DIR=docs/screenshots/probe-card-click-after-right-panel/before-1.8.2 \
  node scripts/screenshot/probe-card-click-after-right-panel.mjs                  # the same, pre-1.8.2
bb plugin config focus-board set nativeOpenDebug false
```

The probe opens `BB_APP` (default `http://127.0.0.1:38886/plugins/focus-board/board`) in its own browser context per phase — no storage and no split layout shared with the operator's window — clicks the first board card to let the board open and adopt a native pane, then does the phase's action and clicks the next card. It reads only, apart from navigation and the two debug-setting writes above.

Each run's `evidence.json` carries every phase's states, the click trace payloads, the console and the main-frame navigations; frames are `<phase>-<step>.png`.

## What it means

Phases A–E: reproduced and fixed. A card click in a window with a native pane opened the board's own in-panel pane whenever the board's pane record no longer matched the live pane. The right panel alone was never the trigger. The fix and its tests are in `lib/native-fresh-pane.ts` and `docs/plans/2026-11-17-one-board-pane.md` §11.

Phase F, the page-route shape, does not reproduce on the bundle bb serves today: the click opens a fresh native pane and the board's own pane never appears. It does reproduce on the bundle from before the fresh-pane rule, so the window that showed the operator the in-panel pane was running that older bundle and has not loaded the new one. A reload of that window is what changes the behaviour, not another code change.

Phase G records what the fresh split leaves behind: a page pane the board no longer names, and one extra split the first click after each navigation pays for. Reusing the recorded pane when it holds no thread would remove both, and that is the open question this run leaves, not a defect it found.

> AGENT GENERATED CONTENT
