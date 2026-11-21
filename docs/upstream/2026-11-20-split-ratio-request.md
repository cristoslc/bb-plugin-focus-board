# The split-ratio ask, filed

Filed at https://github.com/get-bb/bb/issues/7965 on 2026-11-21, as its own feature request rather than a comment on #3891, because it asks for one number on an existing call while #3891 asks for a supported way to set a whole layout.

Operator ruling: `dec_c47zhrxphn4p` (file-the-ask), corpus entry `dl-20261121T014644-0a0f`.

## What the ask is

An optional size on the open request, so a plugin can ask for the proportion its surface needs:

```ts
open(threadId, { split: true, ratio: 2 / 3 });
// or, closer to the stored shape:
threads.open({ threadId, split: "right", sizes: [0.667, 0.333] });
```

With the host keeping the details that make it safe: the request is a preference the host clamps to its own minimum pane widths, it is ignored where splits are off or the viewport is compact exactly as `split: true` already falls back, an even spread stays the default when a pane joins a split of three or more, and the operator's own drag keeps winning for the lifetime of the split.

## Why it matters to Focus Board

The board is scanned and the thread beside it is read, so the useful proportion is about two thirds to the board and one third to the thread. Every fresh split is halves by construction, and the plugin has no argument that reaches that number.

Measured on bb 0.50.1 (`scripts/screenshot/probe-split-ratio.mjs`, record in `docs/screenshots/probe-split-ratio/evidence.json`): `sizes: [0.5, 0.5]` at each click, `[0.6665, 0.3335]` after a drag, the drag surviving a reload while both panes stay open, and halves again on the next click after the thread pane closes.

## What our side does until it lands

Nothing changes in the click path: the board asks for the pane and the host picks the width. `tests/host-split-ratio-surface.test.ts` is the canary. It pins `open()`'s options to `{ split?: boolean }` across the reachable split types and fails, naming this ask site, the day a host release grows a size lever. When it does, the ratio goes in at `app.tsx`'s one-pane ask in `openThreadForInteraction`, and the probe re-measures it.
