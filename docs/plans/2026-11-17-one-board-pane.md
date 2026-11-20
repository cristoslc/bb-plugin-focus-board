---
title: One board-opened thread pane — the card click's replacement rule
status: shipped
updated: 2026-11-20
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

## 8. The third report: "still opening new, not replacing, panes"

The merged rule (#466 plus #467) still stacked panes on the operator's machine. The question this section answers, with the click trace from a real window, is whether the plugin can read the host's layout at all.

### The read is null exactly where every session starts

`useSidebarSplitLayout()` is `rP` in the renderer bundle: it returns the layout only when `EN(root) > 1`, so a ONE-PANE layout reads null. That is the state of a freshly opened board, and therefore of the first card click of every session. It is not a broken reader: the same hook answers fully once a second pane exists, measured live on the installed 0.49.0 with `nativeOpenDebug` on and three panes up:

```json
["[focus-board:native-open]",{"threadId":"thr_9hvf4kvdnn","branch":"focus: already in the board's pane","compactViewport":false,"layout":[{"paneId":"pane-1","threadId":null,"focused":true},{"paneId":"pane-3","threadId":"thr_6yqnhfqhmm","focused":false},{"paneId":"pane-2","threadId":"thr_9hvf4kvdnn","focused":false}],"record":{"paneId":null,"threadId":"thr_9hvf4kvdnn","priorPaneIds":[]}}]
```

and a first click reads null because there is nothing to read yet:

```json
["[focus-board:native-open]",{"threadId":"thr_9hvf4kvdnn","branch":"open: new pane","compactViewport":false,"layout":null,"record":null}]
```

### What that means for the rule

Creating a pane is the only ask the board makes while blind, and it is the ask that cannot be followed: the record is written with no pane id, so the next click re-plans from a layout the board could not name, and each click that cannot resolve a record opens another pane. On my window the second and third clicks did replace (trace branch `replace`, pane ids intact), which is why the probe kept disagreeing with the report; the difference is state, not code, and a rule that depends on state the panel cannot see is a rule that fails quietly.

So the rule changed: **a native split is only asked for to focus or replace a pane the board can name.** Everything else opens the board's own in-panel pane, which is one pane that changes thread and cannot be lost. The creation branch is gone, the replacement's deadline fallback opens the board's pane instead of asking the opener for a new one, and #467's repair stays wired into the replacement as a safety net. It now also checks that no pane holds the thread before restoring the route, because bb re-creates the plugin panel's subtree on a split that worked (the marker is briefly absent after a successful replace).

Option 1 from the review (count panes from the DOM, `data-split-pane-id` plus the focused pane's marker) is the way back to native creation, and it is not in this change: proving it against bb's own count for 1, 2, 5 and 8 panes needs a live matrix this change does not have.

## 9. The simplification: three questions and one measurement

The rule kept growing because one host fact was assumed rather than measured: **whether a card click starts with the board focused.** Every piece of machinery after §8 (the persisted record's null pane id, the prior-pane rule, the intent, the deadline) existed to survive that assumption and the panel re-creation around it. The operator's reading, in their words: "I think you've been massively overcomplicating the side pane integration with host."

`scripts/screenshot/probe-card-click-focus-trace.mjs` measures it in a fresh browser profile, at two panes (board plus a thread pane opened from bb's own sidebar), with the pointer parked over a board card. Evidence: `docs/screenshots/probe-card-click-focus/evidence.json`. Focus per pane, per step:

| Step | pane-1 (board) | pane-2 (thread) | route |
|---|---|---|---|
| pointer parked over the card | ─ | **focused** | the thread's |
| `pointerdown`, document capture | ─ | **focused** | the thread's |
| `pointerdown` handler done, `mousedown` | **focused** | ─ | the board panel |
| `click` (before the board's own handler) | **focused** | ─ | the board panel |

So the assumption holds: the host focuses a pane on press (`onPointerDown` → `focusPane` in `SplitThreadArea`), which means the board is focused by the time a card's handler runs, bb replaces the FOCUSED pane, and a click that wants Focus Board's pane has to focus it first. The focus step is forced by the host, not by the board's design.

What that leaves, and what it costs:

- **Kept, because the host forces it**: the two-step replacement (focus Focus Board's pane by opening the thread it shows, then navigate the clicked thread into the focused pane), the 400ms deadline that turns an unconfirmed focus into the board's own pane, the persisted record (bb re-creates the plugin panel's subtree when the layout changes, so anything the click keeps only in React state can be gone before the host answers), the layout-based recognition, and the eight-pane guard.
- **Deleted**, all of it machinery for a record that could not name its pane: the null-`paneId` claiming rule, the whole `priorPaneIds` rule ("claim whichever pane shows the thread that was not there at click time"), the record write in the focus branch (a record always names a pane now), the `NativeCardPlacement` type and `planNativeCardPlacement`/`nativeSplitUnavailable` (the branches read top to bottom in the click), and the separate `clearReplaceDeadline` callback (the unmount cleanup owns the timer). Line counts: `lib/native-pane-ownership.ts` 286 → 142, `tests/native-pane-ownership.test.ts` 237 → 131, and the click path in `app.tsx` (`app.tsx:3025-3137`, comment block included) 141 → 113. The whole diff is 491 lines removed against 309 added, and 62 of the added lines are tests.
- **A record on disk with `paneId: null`** reads as no record: such a pane cannot be named, and adopting a pane the board cannot name is the guess §8 removed.
- **The double click** now re-asks for the focus on the thread the pane still shows, not on the clicked one. The clicked thread is in no pane, so asking the opener for it with `split: true` was a request for a new right-hand pane.

Two host facts were checked before anything was deleted:

- `PluginSidebarSplitLayout.panes[]` is `{ paneId, rect, threadId: string | null, isFocused }`, documented "The thread this pane shows, or null for non-thread content" (`@get-bb/plugin-sdk` `bb-plugin-sdk.d.ts`), so a pane showing a thread is recognisable and a pane showing plugin content is not.
- The pane cap needs no new branch: at the eight-pane ceiling the guard still answers first, and every remaining host call is either a focus of an open thread or a navigation into an already-focused pane, neither of which creates a pane.

### Can anything else create the first split?

The operator proposed priming a split with something guaranteed to open one (a terminal, a browser pane) and then putting the thread into the pane it created. On paper there is no channel: `BbNavigate` has three destinations, `openFixedTab` addresses only the current surface, and `terminal.open`/`browser.*` exist only as keybinding names. The pane content union is the reason: `qN` in the renderer strictly parses `thread | new-thread | plugin-panel | plugin-detail`, so no terminal or browser can occupy a pane slot at all.

Measured anyway, once, at one pane (`scripts/screenshot/probe-prime-split.mjs`, evidence `docs/screenshots/probe-card-click-focus/prime-split.json`): `POST /api/v1/terminals` answered 201 with a real terminal session and the layout stayed at ONE pane, before and after a reload; the plugin runtime carries no `openFixedTab` at all. Nothing splits a one-pane window except a thread, a new-thread screen, or a plugin panel, and every one of those openers sits behind the same `layout === null → navigate` gate. **There is no priming channel**, so the fallback to the board's own pane at one pane is the answer, not a workaround.

That conclusion was overturned two days later by measuring the gate itself rather than the panes: a one-pane window on 0.50.1 already carries a one-pane layout, so the gate never fires and the opener splits. Section 10 records the measurement, which is why the one-pane click now asks the host.

## 10. The one-pane click, measured on 0.50.1: the opener splits

The operator's ruling `dec_a4lrjn0gqqmk` asked for the deliberate dance, "navigate, then bring the board back", and the commission that carried it asked the second half be proved before it was built. It was measured first, on the installed host (bb 0.50.1, `scripts/screenshot/probe-split-dance.mjs`, evidence in `docs/screenshots/probe-split-dance/`), in a window the probe opened itself, reading `bb.splitLayout`, the route, the board's marker and the rendered panes at every step.

### What the probe found

| Phase | Step | Panes | Board | Route |
|---|---|---|---|---|
| A | board alone (a fresh profile) | 1, `pane-1` = the board panel | mounted | the board's |
| A | a plain thread navigation | 1, `pane-1` = the thread | gone | the thread's |
| A | the board's panel route with `t/<thread>` | 1, `pane-1` = the board panel, thread in its own in-panel pane | mounted | `/plugins/focus-board/board/t/<thread>` |
| B | the thread in the only pane | 1 | gone | the thread's |
| B | the board's panel route again | 1, `pane-1` = the board panel | mounted | the board's |
| B | the opener for that thread, `split: true` | **2**, `pane-1` board, `pane-2` thread | **mounted** | the thread's |
| C | the opener for a different thread from a thread-only window | 2, two thread panes | gone | that thread's |

Two facts decide the shape, both 0.50.1 facts rather than the 0.49.0 ones §4 quoted:

1. **A one-pane window already carries a one-pane layout.** The persisted atom holds `{root: pane-1, content: the board's panel}` from the first render of a fresh profile, never null. So the host's opener reaches its placement branch, and `openThreadInSplit`'s `layout === null → plain navigation` gate never fires here.
2. **`useSidebarSplitLayout()` still answers null**, because the plugin-facing view returns a layout only from two panes up. That is why a one-pane window reads as "no split" to a plugin even though the host has a layout to split.

So the ruling's two steps collapse into its first one: the opener splits, the board keeps its pane, the thread arrives beside it, and nothing unmounts, so there is nothing to bring back.

### What the dance is still for

Two states measured no split, and both are real:

- **Splits off** (bb's own setting) leaves the window with no layout at all, so the opener plainly navigates and the panel is replaced by the thread page. That is the state the operator's report described, and only code outside React can repair it, because the component is gone by the time the answer is visible. The continuation puts the board's panel route back with the thread's subPath, which is the board plus its own in-panel pane (phase A's last row), so the click never ends with the board back and the thread gone.
- **A host that ignores the ask** leaves the panel mounted, one pane, route untouched; the deadline opens the board's own pane there, which is the contract a window bb will not split already had.

`lib/native-one-pane-dance.ts` carries those rules: one dance at a time (a second click replaces the pending one), a 250ms deadline, module scope so the state outlives the panel, and an observation read from the host's own rendered truth (the count of `data-split-pane-id` pane containers, the board's panel root, the route's thread). A rendered split wins however early the deadline is asked, which is what keeps a slow frame from opening the board's own pane beside a split that landed.

The click's other branches are unchanged: the eight-pane ceiling guard, the compact viewport's own pane, and the replacement rule for a pane the board owns (§2). The UAT suite that owns the click contract, `tests/manual/uat-native-open.yaml`, now drives a one-pane click and asserts what the operator ends with: the thread in a native pane, the board still rendering its cards, and a two-pane layout.

> AGENT GENERATED CONTENT
