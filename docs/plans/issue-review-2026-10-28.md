# Issue review: the three remaining open issues

*2026-10-28 · independent second review for the operator · verified against `dev` at `77e8f57` (1.7.2-dev) · no code changed, no issue closed, no issue commented.*

Eleven issues were open on 2026-10-28. The earlier triage pass closed five as already implemented on `dev` and three as fixed by dispatched children. Three were held for you, and those three are the whole scope here. This note re-verifies each against the current tree rather than against the triage notes, then scopes what a fix would touch.

## The three questions

Each issue owes you one word.

| Issue | Question | Recommended answer | Why it is cheap or costly |
| --- | --- | --- | --- |
| #89 Wallpaper crop + imagegen | Build part two, or close? | **close** (part two returns as its own issue only if you want an imagegen host) | Part one already shipped and overshot the ask. Part two buys a new shipped-code network seam, an audited fetch client, and upscaled bytes fighting a 5 MB localStorage quota. |
| #159 One interaction surface | Split, implement now, or close? | **split** (two cuts; the overlay waits on a mock) | The amber grammar and a return-to-pick affordance are small and test-anchored. The floating overlay is the risky half and needs a shape decision first. |
| #282 Dot strip clusters | Implement option D, or close as C-complete? | **implement** (one small cut, screenshot-gated) | Option C already shipped, so D is a tint on an existing group span plus a cluster-level hover. Roughly 20 lines of render and four test cases. |

## How this review was done

I read the three issue bodies from GitHub, then read the current code, tests, coverage matrix, and changelog on `dev`. I ran the greps the triage claimed and re-derived every verdict from what the tree does now. Where a note above disagreed with the tree, the tree wins and the disagreement is recorded below.

## #89: Wallpaper fit, zoom, focal crop, and an optional imagegen backend

### Verdict: partially done. Part one shipped, part two has no trace.

What is true now, cited:

- `components/preferences.ts:556` defines `WallpaperFit = "contain" | "cover"`, and `:569-586` carries the stored fields `fit`, `zoom`, `focusX`, `focusY`, plus a `canvas` letterbox color the issue never asked for.
- `components/wallpaper-picker.tsx:220-270` is the Fit toggle (Letterbox / Fill) and the zoom slider; `:163-182` mounts a live `WallpaperViewport`.
- `components/wallpaper-viewport.tsx` (528 lines) is the part the issue did not specify and the implementation added: a board-ratio crop window drawn over the image, with pointer drag for the focal point, pinch to zoom, lane and card silhouettes, and an averaged-edge-color sample that commits the `canvas` field.
- Per-key tolerance is real, not claimed: `parseWallpaperLayer` at `components/preferences.ts:658-693` drops a garbage crop field and keeps the layer, so an old stored wallpaper renders exactly as before.
- `isAllowedWallpaperUrl` at `components/preferences.ts:649-656` accepts `http:`, `https:` and `data:`.
- Part one rides `tests/wallpaper-picker.test.tsx`, `tests/wallpaper-viewport.test.tsx`, `tests/wallpaper-paint.test.tsx` and `tests/preferences.test.ts`, and holds a matrix row at `docs/test-coverage-matrix.md:31`.

Part two is absent. A case-insensitive grep for `imagegen|outpaint|upscale|fit to screen` over `components`, `lib`, `server` and `docs` returns only `docs/uat/*` hits for a demo feature group named `chat-imagegent`, which is a fixture name and unrelated.

### What part two would cost

Four pieces, in dependency order.

1. **A settings field.** Home: the declared settings block in `server.ts:764` (`bb.settings.define`), which is what the plugin config page and the settings modal's mirror already read through `useSettings()`. Shape: `wallpaperImagegenEndpoint`, a string that accepts `https:` only and defaults to empty. An empty value must mean the feature does not exist rather than a disabled button, so no offline path gains a new dependency.
2. **An endpoint contract.** `POST` a JSON body of `{ imageUrl, targetWidth, targetHeight, mode: "outpaint" | "upscale" }` and accept `{ url }` or `{ dataUrl }` back. Hard rails: a 10 s deadline composed with the caller's signal (the `lib/openverse.ts` shape), no redirects followed, no credentials or referrer, and the response's url re-validated before commit. The re-validation is the sharp edge: `isAllowedWallpaperUrl` admits `http:`, so an imagegen response needs its own stricter predicate (https or data only) at the seam, not a looser shared one.
3. **A new approved fetch seam.** This is the real cost, and it is not optional. `scripts/security-seams.mjs` is the single allowlist both `npm run gates` and `tests/security-fetch-seams.test.ts` read, and each entry carries a reason naming the audit that approved it. A user-hosted endpoint therefore needs a written audit doc plus a seam entry, and `tests/security-fetch-seams.test.ts` fails before the gate would. The matrix row at `docs/test-coverage-matrix.md:32` names the exact precedent: this same file once shipped a raw `fetch(` at `components/wallpaper-picker.tsx:242` and turned the gate red.
4. **Storage reality.** The wallpaper document lives in localStorage under `focus-board:wallpaper` (`components/preferences.ts:550`). A 4K upscale returned as a data url is megabytes, written into a 5 MB origin quota that the board also uses for drafts and folds. Either the contract refuses data urls above a small cap or the feature must store bytes somewhere other than preferences. Nothing in the issue anticipated this, and it is the strongest argument for closing.

Offline and failure paths, stated plainly: no endpoint configured means the control never renders; a configured endpoint that times out, refuses, or returns a shape the parser cannot read shows one error line in the picker and commits nothing, matching the Openverse failure line at `components/wallpaper-picker.tsx:393-395`; the presets, Picsum and Openverse galleries keep working through every failure, so a broken imagegen host can never block the picker.

Cost, honestly: the happy path is a one-day cut. The seam audit, the stricter url predicate, the quota decision and their tests roughly double it, and the quota answer may come back "not worth it".

### Recommendation

Close #89. Part one is done and went past the ask, so the issue's visible complaint is answered. If you want the endpoint at all, let part two return as its own issue seeded with the contract above, because a shipped-code network seam needs its own audit and its own decision.

## #159: One interaction surface for the thread pane

### Verdict: still applies. Nothing on `dev`, and a draft design note already exists on an unmerged branch.

What is true now, cited:

- Two cards, still separate: `components/thread-pane.tsx:22-23` imports both, `:1157` mounts `PendingInteractionCard`, `:1162` mounts `DecidedQuestionsCard`.
- `components/pending-interaction-card.tsx` is 1086 lines; `components/decided-questions-card.tsx` is 232.
- Both wear the same generic casing: `rounded-lg border border-border bg-card shadow-sm` at `components/pending-interaction-card.tsx:1010` and `components/decided-questions-card.tsx:160`. No amber anywhere in either file. A repo-wide grep for `amber` hits `board.tsx`, `sweep-banners.tsx`, `group-boxes.ts`, `card-transport.ts` and the strip's own halo, never the two cards. So #97's amber split never landed, and #97 was closed on 2026-10-15 as superseded by #159 (four seconds before #159 was filed) rather than as done.
- `docs/plans/` holds fifteen notes and none concerns this surface.
- The correction to the triage note: branch `bb/fix-focusboard-ux-thr_3a4twsefrp` carries two commits that never landed, `6e10611` (adds `PURPOSE.md`, the attention philosophy the issue cites) and `690b4a8` (adds a 112-line draft design note, `docs/plans/2026-10-15-interaction-surface-decision-layer-thr_3a4twsefrp.md`). Neither was an ancestor of `dev` at review time, so `PURPOSE.md` was not on `dev` then; it has since landed as [PURPOSE.md](../PURPOSE.md), and the draft note stays superseded. The issue asks for a design note that exists, unmerged and unseen, on a two-week-old branch.

That changes the shape of the work: #159 is a recovery, not a start. The design note in this PR carries the stale note's thinking forward at current line numbers instead of duplicating it blind.

### Smallest shippable slice

Cut one, and it is small:

1. The amber grammar for the live question only, neutral casing for history. That is a token swap on two section roots plus one shared left-edge rule. It closes the surviving half of #97.
2. A return-to-pick affordance for the mid-reading state, inside the card rather than as an overlay. The picker is docked and always visible, but it folds only by hand and a folded card leaves no trace of the question or the step. A one-line amber rail with the step and a one-step return is the smallest fix, and it needs no observer on host DOM.

Cut two, the deferred half: the floating overlay or two-pane shape. It needs a screenshot mock first, because both candidates fight pane plumbing that no test covers.

### Files and tests a fix touches

- `components/pending-interaction-card.tsx` (section casing, the return affordance, its collapse state).
- `components/decided-questions-card.tsx` (neutral restyle, record formatting).
- `components/thread-pane.tsx:1150-1165` (mount geometry if the two cards become one family).
- `tests/pending-interaction-card.test.ts`, `tests/pending-interaction-card-draft.test.tsx`, `tests/decided-questions-card.test.tsx`, and the eight pane suites that mock both cards (`tests/thread-pane-escape`, `-actions`, `-narrow-panel`, `-reference-chips`, `-coarse-controls`, `-queued-send-reveal`, `-workspace-open`, and `tests/pane-context-row`), which pin module names and must move in the same commit.
- `docs/test-coverage-matrix.md:153-154`.
- Screenshot captures at desktop and phone through `scripts/screenshot`, per the issue's acceptance item 5.
- No changelog bullet until user-facing behavior changes, then one under a `#### Thread pane` surface.

### Risks

- Both components are pinned by DOM-level suites, so a shared wrapper is a test migration before it is a feature.
- The pane does not own the transcript scroller. It finds the host's `.thread-scrollbar` by query (`components/thread-pane.tsx:802-805`, the debug path), so any affordance keyed to "the operator scrolled away" depends on host DOM it does not control. A card-local affordance sidesteps that; an overlay cannot.
- The pane already has two compact modes (`isCompact` at `components/thread-pane.tsx:510` from `windowCompact` or a panel under `PANE_SHEET_MAX_PANEL_WIDTH = 640`, plus `panelScopedSheet` for a narrow panel that is not a narrow window). Phone mechanics must reuse that split instead of inventing a third.

### Recommendation

Split. Land cut one (amber, neutral history, return-to-pick) behind the design note in this PR, then decide the overlay after a screenshot mock of both candidates. Do not build the overlay on a shape nobody has looked at.

## #282: The collapsed family's dot strip groups each child with its own grandchildren

### Verdict: partially done, and further along than the triage note says. Option C shipped; option D is the leftover.

What is true now, cited:

- The strip is already family-clustered at the DOM level. `components/thread-card.tsx:2001-2010` maps each visible child into its own `<span data-child-dot-group="…">` containing that child's dot and then `visibleSubsFor(child.id)` sub-dots.
- The strip container uses `gap-2.5` between groups (`:1991`) and each group uses `gap-1` internally (`:2005`), with `flex-nowrap` inside a group so a family never splits across a wrap.
- Sub-dots draw one size step down: `isSub ? "size-1" : "size-1.5"` at `:1482`.
- A parent dot's hover preview already names its sub-thread count (`previewSubCount` at `:1336-1339`, passed to `DotPreviewBubble` at `:2162`). That is the musing's option F, folded in with C.
- Option C landed as commit `7e4748b` ("The collapsed dot strip paints the family family-ordered, sub-dots after their parent's dot") and is pinned by `tests/thread-card-child-dots.test.tsx:416` (family order), `:421` (size step), `:428` (a family wraps as a unit), and `:467` (the count-dots agreement invariant, the 9 + 10 fixture reading "19 child threads" over 19 dots).
- `FAMILY_ROWS_BEFORE_FOLD = 5` at `components/thread-card.tsx:421` is the rows fold, untouched by the strip and unrelated to this issue.

What is not there: the issue names option D, and D's distinguishing device is a visible capsule per family (`rounded-full bg-muted/50 px-1`, per the musing) plus a cluster-level hover naming the child and its count. Today the boundary is carried only by gap width plus glyph size, which is option C's "convention the eye learns" and D's stated reason to exist.

The triage note called this "not started: the strip still renders child dots and sub-dots in one flat flow". That flat flow is option C, the musing's own recommendation, shipped. The accurate verdict is: the skeleton landed, D's tint and cluster hover did not.

### The acceptance sketch, as a testable checklist

Each line is a testable assertion for the implementation. The first two fail today.

- [ ] On the `?orchestrator=1` fixture with the family collapsed, each child's dot and its sub-dots sit inside one cluster element with a visible boundary, and the boundary survives a wrap onto a second line.
- [ ] Hovering a cluster (not a dot) names the child and its sub-thread count, and every dot inside still previews and opens its own thread.
- [ ] With the idle filter on and off, the strip's dot count still equals the fold label's count, member for member, so the count-dots agreement invariant at `tests/thread-card-child-dots.test.tsx:467` keeps passing unchanged.
- [ ] A family with one child and no grandchildren renders one unclustered dot, with no empty capsule and no stray tint.
- [ ] The capsule carries no hover surface of its own that reads as clickable, and the strip's expand role (background click) keeps working around it.

### The one open choice

Option C stays as shipped, or option D's capsule lands on top of it. The musing says to settle that with a screenshot mock on a real 86-dot board rather than in prose, and the issue already picked D on that promise. So the answer is not a new design question, it is a permission: either take the mock as the gate for D, or call C complete and close.

### Files and tests a fix touches

- `components/thread-card.tsx:1991-2010` (the group span gains the capsule tint and the cluster hover), `:1344-1490` (`stripDot`, if the cluster hover reuses the preview bubble's props).
- `tests/thread-card-child-dots.test.tsx` (capsule class, cluster hover text, the count-dots invariant unchanged), `tests/thread-card-idle-children.test.tsx` (the filter's effect inside a cluster).
- `docs/test-coverage-matrix.md:35`, whose row already describes the flattened strip and would gain the capsule clause.
- No changelog bullet until the tint ships, then one line under the cards surface, with the modal lead naming the dot strip.

### Risks

Two, both from the musing. Stacked tints add noise on a strip that already wraps, and a tinted pill reads as its own control, so an operator reaches for something that does nothing. The mitigation is a near-invisible tint (`bg-muted/30` to `/50`) with no hover surface of its own, and the screenshot mock is what proves the tint reads as grouping rather than as a button.

### Recommendation

Implement D, gated by the mock. It is a small change on a skeleton that already carries the ordering, the size step and the agreement invariant, and the only real question is whether the tint reads at 86 dots. If the mock says it does not, close #282 with C recorded as the answer.

## What this review deliberately left alone

- No implementation for any of the three. The two documents are the whole deliverable.
- No issue closed, no comment posted, no label applied. Those are your calls, and each one needs the word in the table above.
- No changelog bullet: docs earn none, per `CONTRIBUTING.md:91`.
- No coverage-matrix row: no workflow path changed, per `CONTRIBUTING.md:72`.
- The stale `bb/fix-focusboard-ux-thr_3a4twsefrp` branch is untouched. Nothing was rebased, cherry-picked, or deleted, so its `PURPOSE.md` stayed there at review time and the choice about landing it was yours; it has since landed on `dev` as [PURPOSE.md](../PURPOSE.md).

> AGENT GENERATED CONTENT
