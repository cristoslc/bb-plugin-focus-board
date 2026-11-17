---
title: One board-opened thread pane — the card click's replacement rule
status: shipped
updated: 2026-11-17
tags: [pane, split, bb-0.49, click, placement]
---

# 2026-11-17: A card click replaces the board's own pane, it does not stack panes

The operator's ruling, in their words: "if there's already a split open for another thread that Focus board opened, then we should replace it, not create a bunch of split panes." The report carried a screenshot of a four-pane window: the board, then one thread pane per card click.

The rule this note records, its evidence, and what it costs. The shipped comments carry the same reasoning next to the code: `lib/native-pane-ownership.ts` (the rule) and `app.tsx`'s `openThreadCardNative` (the wiring).

## 1. What the host allows

A plugin can navigate, and that is all. On bb 0.49.0:

- `PluginSidebarThreadActions.open(threadId, { split })` is the whole placement API (`@get-bb/plugin-sdk` 0.6.19, `bb-plugin-sdk.d.ts`). Its documented rules: "a right split by default, focus when the thread is already open, replace at the pane cap".
- The runtime object the app hands a plugin (`globalThis.__bbPluginRuntime.pluginSdkApp`, read off the installed renderer's `plugin-frontend` bundle) is exactly that declared surface. There is no `closePane`, no `replacePane`, no pane-id parameter.
- `replacePaneContent` and `removePane` live inside bb's own split-layout ops (`apps/app/src/lib/split-layout/ops.ts`) with no plugin hook in front of them, and the pane chrome's close button is a UI affordance, not a callable.
- `useSidebarSplitLayout()` gives a plugin the panes (`paneId`, `threadId`, `isFocused`, `rect`) and nothing writable.

So "replace this pane" cannot be asked for, and neither can "close this pane". The one supported lever is the host's own route reconciliation: when the route's content is in no pane, bb replaces the FOCUSED pane with it (`SplitThreadArea`'s effect → `reconcileLayoutForContent` → `replacePaneContent(layout, layout.focusedPaneId, content)`); when it IS in a pane, bb focuses that pane and changes nothing. The installed 0.49.0 renderer carries both as `LP` (focus-or-replace) and `IN` (replace).

## 2. The mechanism: two navigations, no close

The board's replacement is:

1. Navigate to the thread the board's own pane already shows. bb focuses that pane (content untouched, board still on screen), so the pane a click would land in is now the focused pane.
2. Navigate to the clicked thread. It is in no pane, so the focused pane takes it: same slot, same width, same focus, board untouched.

Nothing unmounts in between, so there is no close-then-open gap, no empty half, and no flicker. The second navigation is only issued once the layout confirms the first one landed on the board's own pane — the safety property, because the second navigation replaces whatever pane is focused, and the board is the focused pane whenever the click came from inside it.

Measured on the installed 0.49.0 (`scripts/screenshot/probe-native-pane-replace.mjs`, evidence in `docs/screenshots/probe-native-pane-replace/`):

| Step | Panes | Board in layout | Focused pane |
|---|---|---|---|
| board route | 1 | yes (pane-1) | pane-1 |
| first open in split | 2 | yes | pane-2 (thread A) |
| board route again (the rule's step 1, applied to the board) | 2 | yes | pane-1 |
| navigate to A (the rule's step 1) | 2 | yes | pane-2 (thread A) |
| navigate to B (the rule's step 2) | 2 | yes | pane-2 (thread B) |

The board's box is identical across every two-pane row (320,48,640,1152). The same probe measured the old behaviour beside it: one pane per open, 1 → 2 → 3.

## 3. How a pane is recognised as the board's

Two candidates were live:

- **(a) Remember the pane the host created and treat it as the board's until it closes.** Chosen.
- **(b) Any thread pane beside the board is replaceable.** Rejected: it discards a pane the operator opened from bb's own sidebar, which is a pane the board has no business overwriting.

The record is `{ paneId, threadId }`: the pane id the host created, plus the thread the board last put there. Both halves are load-bearing. The pane id alone would let a recycled id (bb names panes `pane-N` and reuses the lowest free number) claim a pane the operator opened; the thread alone would forget the pane the moment the board replaced its thread, so clicking back and forth between two cards would open a second pane on the way back.

The record lives in plugin-scoped `localStorage` (`<pluginId>:boardNativeThreadPane`) because bb's split layout persists: a reload must not cost the operator another pane. A record that no longer matches the live layout is ignored, and ignoring it is always safe — the click falls back to the host's opener, which is what the click did before the rule.

Consequences, stated so they are not surprises:

- **Operator drags the board's pane elsewhere** (left of the board, another row): bb's `movePane` keeps the pane id, so the pane is still the board's and the next click replaces it where the operator put it. Moving a pane is arranging, not taking it over.
- **Operator opens a thread in that pane themselves** (sidebar click, a mention, a link): the pane now shows a thread the board never put there, the record stops matching, the board forgets it, and the next click opens its own pane instead of discarding what they opened. The board never closes a pane.
- **Operator closes it**: the record stops matching and the next click opens a fresh pane that the board then owns.
- **Panels already stacked before this rule** are left as they are. The board replaces the pane it owns, one pane; it does not sweep up panes that predate the record.

## 4. What the rule does not change

- The eight-pane ceiling guard (`lib/split-pane-cap.ts`) stays where it was: a click at the ceiling with the board focused opens the board's own in-panel pane, because the host's opener would replace the board itself.
- The phone path is unchanged in its guard but not in its outcome: with splits off the host answers a split with plain navigation, so the click must not ask (see §7).
- A click on the thread the board's pane already shows goes to the host's opener, which focuses that pane — no replacement, nothing moves.

## 5. The regression the first version shipped with

The rule above worked in the probe and in jsdom, and failed on the operator's machine the day it landed: "thread pane doesn't open on first click. Double-clicking switches to home, doesn't open as split." `scripts/screenshot/probe-native-one-click.mjs` and its instrumented twin `probe-native-one-click-trace.mjs` drive the board's own cards on the installed 0.49.0 and read the host's layout every 100ms; evidence in `docs/screenshots/probe-native-one-click/{before,after}/`.

Three separate causes came out of the trace, not one:

1. **The record did not survive the host's own re-render.** The board's DOM marker is gone 100ms after the first click: bb re-creates the plugin panel's subtree when it splits for the first time. The record was written only once the layout confirmed the new pane, which happens after that re-render, so a fresh window never recorded anything. The next click had nothing to replace and split a second pane (`before/fresh-3-after-second-click.png`: three panes).
2. **The focus step could be a no-op forever.** Focusing the board's pane by navigating to the thread it already showed does nothing when the app is already on that route: react-router pushes no entry, the host's reconciliation never runs, the layout keeps its identity, and the confirmation the rule waited for never arrives. The click did nothing at all, silently.
3. **A stale record navigated into nothing.** With a record naming a thread the host could no longer resolve, the focus navigation went down the host's unresolved-thread fallback instead of opening anything, which reads as "switches to home".

What changed, all three in `lib/native-pane-ownership.ts` and `app.tsx`:

- The record is written **at click time**, before the host is asked for anything, so a re-render cannot lose it. A record may now carry `paneId: null` ("the board opened this thread; claim whichever pane shows it that was not there when the click happened"), and its pane id is filled in on the next use.
- The focus step is `actions.open(paneThread, { split: true })`: the host's own opener, which focuses a pane **by id** and never depends on route equality.
- The confirmation waits on the **layout** (`the focused pane is the board's`), never on object identity, and has a 400ms deadline. When the deadline passes without the pane gaining focus, the click falls back to `actions.open(clickedThread, { split: true })`, which opens a pane by the host's own rules and is then recorded. One click always opens something.
- A record whose pane is gone, whose pane shows another thread, or whose thread has left the board's list is treated as stale: the click opens a pane instead of navigating, and the record is overwritten with what the host produced. There is no `focused` shortcut any more, because a stale snapshot of the focus made that shortcut replace the board.
- A second click naming the same thread while a replacement is in flight re-asks for the focus and returns; it never re-plans against a layout that is mid-replacement and never touches the board's route.

## 6. The residue

The replacement's first navigation is a real route change, so the pane's previous thread keeps a history entry: back from the clicked thread steps through the threads the pane showed. That is the same shape the host's own navigation produces everywhere else, and the board's pane (and its in-panel back-arrow trail) is untouched by it.

## 7. The second regression: where the host will not split

The next report was the same sentence with the mechanism named: "clicking is still taking me to home + opening the full-window thread composer." That is not a pane opening badly. It is bb's opener plainly navigating: the plugin panel that held the board is replaced by the thread page, which carries the composer, and the board's route is gone.

### The predicate, from bb's source

Installed bb is 0.49.0; its renderer lives at `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/index-UJHlXnMg.js`. The split open is `jQ` (`openThreadInSplit`), asset offset ~675506:

```js
function jQ({store, navigate, projectId, threadId, isCompact, state}) {
  let route = threadRoute({projectId, threadId}), layout = store.get(splitLayoutAtom);
  if (isCompact || layout === null) { navigate(route, ...); return; }
  ...
}
```

Two disjuncts, two different causes:

- `isCompact` comes from `mk()` (`useIsCompactViewport`), which answers `matchMedia("(max-width: 767px)").matches` unless a React context overrides it (the query constant is at asset offset ~312790, the hook at ~317659). The plugin-facing `experimental_useSidebarThreadActions().open` passes the same value (`plugin-frontend-0dkOuthv.js`, ~287951).
- `layout === null` is the host's split-layout atom: no split has been created for this window yet.

So "splits are off" is exactly: **a viewport at or under 767px wide, or no split layout yet**. Either way `split: true` is a plain navigation.

### What the operator's window was doing

The report's tell is the whole-window thread page with its composer, which only the plain-navigation branch produces. The board's own pane would have shown the board beside it. The compact half is visible in the same report's evidence: the probe re-ran at `COMPACT=1` (a 700px browser window, so `(max-width: 767px)` matches) against the un-fixed 0.49.0 and reproduced it in one click: board unmounted, route `/projects/<id>/threads/<threadId>`, zero cards left (`docs/screenshots/probe-native-one-click/compact/before/evidence.json`). A 1600px window on the same build usually splits; a freshly loaded panel can still hit the null-atom half and plainly navigate, which is what the `wide/before` run records as "no card click opened a pane".

### What a plugin can read

The compact half, fully: this repo already vendors the identical query in `components/ui/hooks/use-compact-viewport.tsx`, used today as `paneCoversBoard`. The atom half, not at all: `useSidebarSplitLayout()` answers null both for "compact" and for "no split yet", so null cannot be read ahead of the click.

### The branch

`planNativeCardPlacement` now takes the environment and returns `in-board` before any pane reasoning where `nativeSplitUnavailable({ compactViewport })` holds, which is compact only (`lib/native-pane-ownership.ts`). In `app.tsx`, `openThreadCardNative` checks it first and calls `openThreadCard(threadId)`: the board's own in-panel pane, the surface the deep link and the cap fallback already use, so the board keeps its place and no route leaves the plugin panel.

Where the unreadable half bites, the click asks the host for the split and repairs itself: `scheduleNativeRepair(threadId, branch)` is a module-level timer (it must outlive the panel it repairs) that at 500ms checks whether the board's marker is gone and the route is now `/threads/<threadId>`; if so it calls `navigate.toPluginPanel("board", { subPath: "t/<threadId>" })`, which brings the board back with that thread in its own pane. The route comes back even though the request could not be predicted.

### The trace

The click logs one `console.debug("[focus-board:native-open]", {...})` line with the thread, the branch, `compactViewport`, the host's layout, the board's record, and after the repair window an `outcome` line. It ships off, behind a new server setting `nativeOpenDebug` ("Developer: trace the card click's pane placement (debug)", default false), the same shape as the existing `scrollDebugInstrumentation`.

### Evidence

| State | Build | After one click |
|---|---|---|
| 700px window | pre-fix 0.49.0 | board unmounted, route is the thread page, no cards (`compact/before`) |
| 700px window | fixed | board mounted, route `/plugins/focus-board/board/t/<id>`, thread in the board's own pane (`compact/after`) |
| 1600px window | pre-fix 0.49.0 | "no card click opened a pane" on a freshly loaded panel (`wide/before`) |
| 1600px window | fixed | two panes, board kept, second click replaces (`after`) |

`docs/screenshots/probe-native-one-click/{compact/{before,after},wide/before,after}/evidence.json` carry the route, layout, board marker and in-board pane label per step. The wide `after` run carries the trace: `"branch":"open: new pane"` then `"outcome":"host plainly navigated: restoring the board's route"`, which is the guard doing its job where the layout atom was not ready yet.
