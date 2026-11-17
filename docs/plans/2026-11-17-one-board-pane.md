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
- The phone path is unchanged: with splits off, `useSidebarSplitLayout()` answers null, the plan answers "open", and the host degrades the split to plain navigation.
- A click on the thread the board's pane already shows goes to the host's opener, which focuses that pane — no replacement, nothing moves.

## 5. The residue

The replacement's first navigation is a real route change, so the pane's previous thread keeps a history entry: back from the clicked thread steps through the threads the pane showed. That is the same shape the host's own navigation produces everywhere else, and the board's pane (and its in-panel back-arrow trail) is untouched by it.
