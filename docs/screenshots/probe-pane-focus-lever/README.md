# Probe: can a plugin focus a split pane that shows no thread?

The card click's replace rule is "focus the pane, then navigate into it", because bb lands a navigation in the FOCUSED pane. A pane showing another thread is focused by opening that thread, which is the lever the click already uses. A pane showing no thread at all — the rail's Decisions page, or any route the operator navigated the pane to — has no thread to open, and nothing in this repo knew how to focus it. The operator's ruling of 2026-11-24 (`dec_okjt7e62rg2x`, "always take the pane back") makes that pane the board's, so the click needs the lever.

`scripts/screenshot/probe-pane-focus-lever.mjs` measures it on the installed host, in a throwaway browser context per phase: the board's pane is focused first (the state every card click starts in), then a press is dispatched at the pane's container, then the layout and the container's own `data-focused` marker are read.

## The two candidates, ranked

| Candidate | What was measured | Verdict |
|---|---|---|
| A host command surface | bb's keybinding vocabulary names `pane.focus.1`…`pane.focus.8`, `pane.focus.next`, `.previous` and the four arrow moves, but `@get-bb/plugin-sdk` exposes no way for a plugin to invoke one (no `executeCommand`/`invokeCommand` export, and `useSidebarSplitLayout()` is read-only) | no lever a plugin can reach |
| A synthetic press on the pane container | bb focuses a pane in that element's own pointer handler (`onPointerDown` → `onFocusPane(paneId)`), and the handler is delegated, so the event has to bubble | **works**, phases 1–3 |

## What the press has to look like (phase 2, page pane)

| Dispatch at `[data-split-pane-id="pane-2"]` | `focusedPaneId` before → after | `data-focused` |
|---|---|---|
| `pointerdown`, bubbling, at the container | `pane-1` → `pane-2` | `pane-2` |
| `pointerdown`, no `bubbles` | `pane-1` → `pane-1` | `pane-1` |
| `mousedown` | `pane-1` → `pane-1` | `pane-1` |
| `pointerdown` at a descendant element | `pane-1` → `pane-2` | `pane-2` |

The same bubbling press focused a pane showing a THREAD (phase 1), so the lever does not care what the pane holds. The host's handler also keeps the URL in step with the focused pane, so a press on a page pane first makes the app route that page; the landing navigation replaces it a frame later (phase 3).

## The whole rule, end to end (phase 3)

Board focused, the board's pane showing the Decisions page, the record naming `pane-2`:

```json
{"branch":"replace","layout":[{"paneId":"pane-1","threadId":null,"focused":true},
                              {"paneId":"pane-2","threadId":null,"focused":false}],
 "record":{"paneId":"pane-2","threadId":"thr_tf8zuywpur"},"shownThreadId":null}
```

Press `pane-2` → `focusedPaneId: "pane-2"` (layout and DOM agree) → a plain route navigation lands the thread in it: `pane-2:thr_bkg7afa7nv`, the board still mounted, the pane count flat at two, no in-board `Thread:` aside. That is the click's own sequence, minus the plugin: the probe drives a sidebar row for the landing because it cannot run the plugin's code path.

## Why the press is not trusted on its own

The click treats a press as a REQUEST. bb replaces the FOCUSED pane on navigation, so a press that changed nothing would send the navigation to the board. The click therefore waits for the layout to show the focus moved (its landing effect) and falls back to the board's own pane, never to a navigation, when the focus cannot land. `tests/app-card-click-replaces-board-pane.test.tsx` pins both failed-focus shapes: no pane container at all, and a container that focuses nothing.

## The exact sequence

```sh
node scripts/screenshot/probe-pane-focus-lever.mjs
```

It opens `BB_APP` (default `http://127.0.0.1:38886/plugins/focus-board/board`) in its own browser context per phase — no storage and no split layout shared with the operator's window — and reads only, apart from navigation, the real presses that put the board's pane back in focus, and the dispatches themselves. Frames are `<phase>-<step>.png`; `evidence.json` carries every phase's states.

> AGENT GENERATED CONTENT
