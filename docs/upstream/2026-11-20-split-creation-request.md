Status: our capability request, filed as a comment on this thread because it is the same ask.

**Focus Board** (a bb plugin, `cristoslc/bb-plugin-focus-board`) needs exactly this capability, in the narrowest possible form: it cannot create a window's **first** split from a user gesture. The board lives in a plugin-panel pane; a click on a card is supposed to put the thread beside it, and on a one-pane window there is no supported way to make that second pane exist.

Reproduced against the installed host (bb 0.49.0, `@get-bb/plugin-sdk` 0.6.19), with a browser probe driving the real app:

- `experimental_useSidebarThreadActions().open(threadId, { split: true })` on a window with no split **materializes a single pane holding the thread**. The plugin panel unmounts and the thread takes the window. The renderer's placement function short-circuits on a null layout (`if (layout === null) return materialize(content)`), so this call can never produce a second pane from one.
- Inside a layout it inserts a right pane for content that is not already open, so the capability exists — it is only reachable once a split already exists.
- Pane-targeted operations do not exist: the pane action vocabulary is `maximize | restore | toggle | spotlight | clear-spotlight`, and no call accepts a `paneId`.
- The drag-to-split hook (`experimental_useSidebarThreadSplit().splitProps`) engages only once the pointer leaves the sidebar toward the main area, so a plugin's own cards cannot borrow it.
- A terminal or browser cannot be used to prime a split: the pane content union is `thread | new-thread | plugin-panel | plugin-detail` (measured: `POST /api/v1/terminals` returns a session and the layout stays at one pane).
- "Navigate to the thread, then navigate back to the plugin panel" does not work, because route reconciliation replaces the focused pane, so the board comes back and the thread is gone.

So the outcome for a plugin in this position is a workaround: show the thread inside the plugin's own pane, at the cost of the native composer, editor and file view.

**What we would expect.** Either shape solves it:

1. the `setLayout` contract proposed in this issue (a plugin builds a two-pane layout from a one-pane one and the host applies it), or
2. a minimal pane-creating call, e.g. `open(threadId, { split: "right", create: true })` for content that is not open yet, or `openInNewPane(content)`.

Either one turns a plugin's card click into "thread beside my panel", which is the whole feature.

**Context and alternatives.** Today we open the thread in the plugin's own pane. Related: #4672 (pinning a plugin pane so navigation opens beside it instead of replacing it) covers the other half of the same workflow, where a click inside the plugin pane focuses it and the next navigation replaces it.

**Evidence** (public, our repo): the declaration walkthrough with the quoted host functions is `docs/plans/2026-11-17-sdk-window-surface.md` (§3.2 names this gap, §4.4 quotes the null-layout branch), and a live rerun of the click at one pane is `docs/screenshots/probe-native-one-click/post-472/evidence.json` at `github.com/cristoslc/bb-plugin-focus-board`.

Searched open and closed issues first: this request is the same capability, so it belongs here rather than in a duplicate.

> AGENT GENERATED

---

Filed at https://github.com/get-bb/bb/issues/3891#issuecomment-7030740018 on 2026-11-20, as a comment on the open layout-restoration request rather than a duplicate issue. Operator ruling: `dec_po29u18sf0ak` (file-upstream), corpus entry `dl-20261120T044830-0afb`.

What happens next on our side: nothing until bb ships a pane-creating or layout-setting call. When it does, the one-pane card click can create a split instead of opening the thread in the board own pane, and `lib/native-pane-ownership.ts` gains a creation branch beside its focus and replace branches.
