---
title: Native thread pane feasibility — drop our pane for bb's native split
status: draft
updated: 2026-11-17
tags: [pane, bb-0.49, feasibility, architecture]
---

# 2026-11-17: Can the board drop its own thread pane for bb's native one?

A feasibility study, not a change. Nothing here touches product code; every claim is grounded in the installed host (bb 0.49.0, `bb --version`), the SDK declarations bundled in this checkout (`@get-bb/plugin-sdk` 0.6.19), and a live probe run against the installed app on 2026-11-17. The operator's two questions are answered in section 1; the capability map is section 4; the residue — what cannot be re-added — is section 5; cost and sequence are section 6; the fork the study hands to the operator is section 7.

## 1. The two answers

**Can a plugin drop its built-in thread pane and open threads in bb's native right pane? Yes, and the board stays on screen.** The Focus Board panel already lives as a pane in bb's split-layout system (probe evidence below: the board route renders as pane content `{"kind":"plugin-panel","pluginId":"focus-board"}`), and the SDK-declared call `experimental_useSidebarThreadActions().open(threadId, { split: true })` inserts the native thread page as a right-hand pane beside it, halves the board pane, and focuses the thread — verified live. The plain (non-split) open replaces the board's pane with the thread, so the `{ split: true }` option is the load-bearing half of the answer.

**Can our custom surfaces (menus, renaming, and the rest) still be added? Mostly yes, through three real hooks plus what bb's own pane already does natively.** Renaming, read state, pin, archive, regenerate title, and copy link are native pane affordances on 0.49 (verified by driving the pane's own overflow menu). The Focus Board's own metadata actions — done, snooze, new-child-thread — have no native equivalent but `experimental_threadHeaderAction` renders a plugin control in the native pane's header action row, which can host them in a popover. The honest residue is small: the pane's custom Escape semantics (the `escStopsRunningThread` setting), the `@project:` reference chips, the board's routing preference for reference chips, and the developer scroll instrumentation have no injection point and would be lost, not moved.

> [!NOTE]
> The counts from the capability table in section 4: **23 COVERED, 3 PARTIAL, 4 LOST** across 30 rows.

## 2. Evidence base

Three sources, each named where it is used.

- **The installed host**: bb 0.49.0, renderer at `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/` (the same location the 2026-11-16 audit established as the real renderer; the desktop `app.asar` carries none). Navigation code read from `index-UJHlXnMg.js`, native thread page from `thread-detail-DObhspNc.js`, embedded plugin chat from `PluginThreadChat-CHvX4Yi2.js`.
- **The SDK declarations**: `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` and `bb-plugin-sdk-app.d.ts` at 0.6.19, plus the host-side contract history in the local bb checkout (`~/Documents/code/bb`, tags `desktop-v0.43.4` through `desktop-v0.48.1`).
- **A live probe**: `scripts/screenshot/probe-native-split-pane.mjs` (new in this branch, modeled on the audit's probes) drove the installed app with system Chrome in a throwaway profile. Evidence: `docs/screenshots/probe-native-split-pane/evidence.json` plus screenshots `01`–`07`. One scratch thread (`thr_j6vpfixgij`, "Native split-pane probe scratchpad") was spawned in the plugin's own project for the probe and deleted afterwards, the same procedure the audit used.

## 3. What actually happens when the board opens a thread natively

### 3.1 The three navigation behaviours, measured

The probe opened the board route, then a thread from bb's own sidebar with **Open in split**, then the same thread with a plain row click. Read after each step:

- **State A — board route**: one pane, `pane-1`, content `{"kind":"plugin-panel","pluginId":"focus-board","panelPath":"board","subPath":""}`, `focusedPaneId: "pane-1"`. The board route is not "a page" in the split system; it is a pane, persisted in `localStorage` under `bb.splitLayout`.
- **State B — after Open in split**: two panes, board at x=320 w=640, native thread page at x=961 w=640, layout `{"root":{"type":"split","dir":"row","sizes":[0.5,0.5],"children":[{pane, plugin-panel(focus-board)},{pane, thread(proj_p4562js7v2, thr_j6vpfixgij)}]},"focusedPaneId":"pane-2"}`. URL is the thread route. **The board is still on screen** (screenshot `03-after-split.png`).
- **State C — plain row click afterwards**: layout unchanged, focus stays on the thread pane. An already-open thread is focused, not duplicated, exactly as the SDK documents.
- **Plain open from a fresh single-pane state** (separate run, `05-plain-open-no-split.png`): `pane-1`'s content becomes `{"kind":"thread",…}`, the board is gone from the main area, URL is the thread route. **Without `split: true` the board's pane is replaced.**

The screenshot of state B was read by the vision dispatch (`llm cove/vision:heavy`): the native pane carries the full thread page — title header with overflow menu, the "NEW" unread divider, the composer with the model chip ("cove/vision:standard High ▾"), mic and send, and a footer with project ("Focus Board plugin"), environment ("Worktree"), branch, and the permission picker ("Full Access ▾"). Those last two — the editable model/provider chip and the editable permission picker — are things the embedded `ThreadChat` in our pane can never show: the SDK pins plugin surfaces to `permissionPolicy: "inherit"` ("a plugin surface can never widen it", `bb-plugin-sdk.d.ts:20389`) and renders the picker as a dimmed label.

### 3.2 The host code behind it

The plugin-facing navigate object (`index-UJHlXnMg.js`, the `e1` factory that also serves `bb--core`) implements `toThread(threadId, options)` with the split branch inline — from the installed build:

```js
// e1's toThread (deobfuscated shape):
u = (threadId, options) => {
  // resolve projectId from the sidebar cache or threads.get
  options?.split
    ? jQ({ store, navigate, projectId, threadId, isCompact })
    : navigate(J_({ projectId, threadId }));   // "/projects/:pid/threads/:tid"
};

// jQ — split placement, verbatim logic:
if (isCompact || layout === null) { navigate(route); return; }      // plain open
if (paneWith(threadId)) { focus(pane); navigate(route, {replace:true}); return; }
zone = pickZone({ zone: 'right', atMaxPanes: countPanes(root) >= 8 });
layout = zone === 'center'
  ? replaceFocusedPane(layout, focusedPaneId, {kind:'thread', projectId, threadId})  // pane cap: replaces the focused pane
  : insertPane(layout, focusedPaneId, 'right', {kind:'thread', projectId, threadId});
store.set(splitLayout, layout); navigate(route);
```

The pane content schema (`KN`, persisted as `bb.splitLayout`) accepts `thread`, `new-thread`, `plugin-panel`, and `plugin-detail` kinds — so a plugin panel and a thread pane are first-class siblings in one layout. Placement rules: right split by default, focus when already open, replace the focused pane at the 8-pane cap. On compact viewports (or where splits are off) split degrades to plain navigation.

### 3.3 Which SDK call to use

| Call | Declared in SDK 0.6.19 | Host since | Verdict |
|---|---|---|---|
| `experimental_useSidebarThreadActions().open(threadId, { split?: boolean })` | Yes — `bb-plugin-sdk.d.ts:19066` ("`split: true` applies bb's split placement rules — a right split by default, focus when the thread is already open, replace at the pane cap — and falls back to plain navigation where splits are off") | 0.43.4 (`app-contract.ts:1261`) | **The call to use.** The board already calls this hook (`app.tsx:361`) for card actions. |
| `useBbNavigate().toThread(threadId)` | Yes — `bb-plugin-sdk.d.ts:20770`, no options in the 0.6.19 d.ts | all | Plain open; replaces the board pane. The board's maximize already uses it (`app.tsx:4080`). |
| `useBbNavigate().toThread(id, { split: true })` | No (the options bag is missing from the bundled d.ts) | 0.46.0 (`app-contract.ts:3414` at 0.46.0) | Works at runtime on the installed host but is a type error against the bundled declarations; use the actions hook instead. |

## 4. The capability map

One row per thing the pane does today (`components/thread-pane.tsx` and its satellites, read in full). "Native + hook" names the surface that covers it in the native pane. Verdicts are honest: COVERED means a declaration or live probe backs it, PARTIAL means the capability survives with changed shape or extra work, LOST means no injection point exists.

| # | Capability | Where it lives today | Native pane + hook | Verdict |
|---|---|---|---|---|
| 1 | Inline rename (click title, edit, blur commits) | `EditableTitle`, thread-pane.tsx:197 | Native pane overflow menu has "Rename" (probe `07`); `PluginSidebarThreadActions.rename` offers silent rename for a custom inline editor | COVERED |
| 2 | Regenerate title | ✨ flow, thread-pane.tsx:1005 | Native overflow "Regenerate title" (probe `07`), bb's own title service | COVERED |
| 3 | ✨ autotitle with service-picker fallback modal | `thread_autotitle` RPC + `AutotitleFallbackModal` | bb's regenerate uses bb's service, not the plugin's registered thread-title services; keeping ours needs a `threadHeaderAction` control | PARTIAL |
| 4 | Mark read / unread toggle | pane header split control | Native overflow "Mark unread" (probe `07`) | COVERED |
| 5 | Done toggle (header checkbox) | pane header, `done-metadata` | `experimental_threadHeaderAction` icon control in the native header's action row | COVERED |
| 6 | Snooze chip + snooze menu items | pane header + `snoozeMenuItems` | `threadHeaderAction` control with popover (Focus Board's own RPC data) | COVERED |
| 7 | New child thread… | pane actions menu | `threadHeaderAction` entry; also stays on the board card menu | COVERED |
| 8 | Pin / Unpin | pane actions menu | Native overflow "Pin" (probe `07`) | COVERED |
| 9 | Archive / Unarchive | pane actions menu | Native overflow "Archive"; unarchive from the board (archived cards) | COVERED |
| 10 | Copy thread link | workspace-open dropdown | Native overflow "Copy link" (probe `07`) | COVERED |
| 11 | Per-message actions (copy message, open in main view) | `messageActions` prop, thread-pane.tsx:499 | Copy is native; "open in main view" is moot (the pane *is* the main view); plugin `messageAction`s render in the native pane by default (`includePluginMessageActions !== false` in `thread-detail`), resolving pane-parity Gap 5 | COVERED |
| 12 | Unread divider + reading-position landing | missing in pane (Gap 3) | Native "NEW" divider (probe `03`); native scroll persistence | COVERED |
| 13 | File-change title clicks (Gap 4 dead clicks) | click capture → maximize | Native pane passes its own title-action resolver; the diff opens in the pane's tabs | COVERED |
| 14 | Question forms (Gap 1: rendered twice) | `PendingInteractionCard` + native banner | Native single form; both plugin-side cards delete | COVERED |
| 15 | Decided-questions card (Gap 2 duplicate) | `DecidedQuestionsCard` | Native answered-question rows | COVERED |
| 16 | TOC, thread context cards, composer menu entries (Gaps 6, 7, 9) | absent in pane | Native pane has them (upstream batch get-bb/bb#7091 closes as moot) | COVERED |
| 17 | Tabs: Terminal / Diff / Info / Browser / plugin panel tabs (Gap 18) | absent; "Maximize pane" as the answer | Native pane's own panel tabs; `threadPanelAction` can add Focus Board tabs inside it | COVERED |
| 18 | Model/provider chip + editable permission picker | impossible in pane (`permissionPolicy: "inherit"`, `ThreadChatProps` :20389) | Native composer footer shows both (probe `03`) | COVERED |
| 19 | Composer context chips (project/environment/checkout) | `PaneContextRow` fallback (audit entry 6) | Native footer paints all three (probe `03`); the paint-walking compensation deletes | COVERED |
| 20 | Composer focus on open (Gap 8) | `composerFocusRequest` counter | Native page owns focus on navigation; confirm once in UAT | COVERED |
| 21 | Attachments, paste, queued sends, editing, forking, steering, approvals, images | embedded `ThreadChat` (shared `ThreadScreen`) | Same components, native presentation (pane-parity audit §"at parity" 1–17) | COVERED |
| 22 | Inline-code file links, relative markdown links, ExternalLink glyph, click capture (audit entries 1–4) | `decorate-inline-code`, `chat-link-intercept`, `host-link-glue`, capture handlers | Native on 0.49 (audit's probes); REMOVABLE IF THE FLOOR RISES, unchanged by this study | COVERED |
| 23 | `@thread:` reference chips | `decorate-reference-mentions` paint pass | Native `ThreadMentionElement` resolves tokens without metadata on 0.49; board-routing preference lost (row 25) | COVERED |
| 24 | `@project:` reference chips | same paint pass | Upstream still autolinks `@thread` only (`THREAD_MENTION_PREFIX`, unchanged 0.43→0.49); native pane shows dead text | LOST |
| 25 | Chip routing choice (open in the board pane vs bb's main view) | `referenceMentions.onOpen` | No hook decides native mention routing; chips route natively | LOST |
| 26 | Escape: stop-then-close rules, double-tap debounce (`escStopsRunningThread`) | document-level keydown, thread-pane.tsx:711 | No injection point into the native pane's Escape handling; the setting and its preferences row retire | LOST |
| 27 | Touch reveal echo for queued-send actions (audit entry 7) | re-emitted host utilities in the pane subtree | The native pane is host CSS; plugin scoping no longer bites | COVERED |
| 28 | Pane resize, stored width, board lane floor, narrow-sheet fallback | `width` state, `PANE_*` constants, sheet logic | Native split panes resize by drag and persist in `bb.splitLayout`; at <640px panel width today's sheet-over-board becomes a native halved split (desktop) or plain navigation (compact) | PARTIAL |
| 29 | Open-thread state: subPath `t/<id>` deep links, back-arrow restore, covered-board quiet open | app.tsx:1262–1290, `paneCoversBoard` | bb persists the split layout itself per browser; the board re-wires open-thread awareness through `useSidebarSplitLayout()` (declared, `bb-plugin-sdk.d.ts:20966`) and `useBbContext()` | PARTIAL |
| 30 | Developer scroll instrumentation | `attachScrollDebug`, setting `scrollDebugInstrumentation` | Developer-only, pane-DOM-specific; deletes with the pane | LOST |

Tally: **23 COVERED, 3 PARTIAL (rows 3, 28, 29), 4 LOST (rows 24, 25, 26, 30).**

Two design constraints on the COVERED-by-hook rows, stated so they are not surprises later:

- The native header action row is "a 48px chrome row with 28px controls: render one inline control that fits, and put anything taller in a portalled popover" (`PluginThreadHeaderActionRegistration`, `bb-plugin-sdk.d.ts:19107`). The pane's split-control grammar (labeled primary + caret menu) collapses into one icon control with a popover; the label-verbosity of today's header does not carry.
- `experimental_threadHeaderAction` is experimental-prefixed ("Experimental: see docs/api_to_audit.md"), as are `experimental_timelineRenderer` and `experimental_threadList`. The stable hooks that matter here are `threadPanelAction`, `messageAction`, `messageDirective`, `navPanel`, `commands`, `composer.customize`, and the sidebar actions hook. The board already builds on experimental surfaces (`experimental_useSidebarThreads`), so this is a continuity note, not a new risk class.

### 4.1 The injection points, enumerated

For the record, the real 0.49 extension points a migration would use, with what they allow and where they appear:

- `experimental_threadHeaderAction` (`PluginThreadHeaderActionProps`: `threadId`, `projectId`, `isCompactViewport`; "rendered in the thread header's action row", left end, before the workspace button): the done toggle, snooze, new-child, and ✨ live here. One per pane in a split; state must live in the component, not a singleton.
- `messageAction` (`run({threadId, message, selectedText?, openPanel, composer})`): per-message bar entries and selection-menu entries in the native timeline; our "copy message" is redundant with native copy, but any board-specific action belongs here.
- `threadPanelAction` (`openPanel({title, params})` → a tab in the thread page's side panel; `layout: "flush"` exists for app-like content): the place for a Focus Board side tab (e.g. the thread's family/board context) inside the native pane.
- `experimental_timelineRenderer` (per-kind row body for this plugin's own extension items and tools) and `messageDirective` (host-rendered directive components with `openWorkspaceFile`): not needed by the current plan, listed so the survey is complete.
- `pendingInteraction` (custom interaction forms), `commands` (palette), `composer.customize` (`ComposerCustomization` regions in the native composer), `fileOpener`: available, none load-bearing for this move.
- `experimental_useSidebarThreadActions` (open with split, openNewThread, setPinned, setRead, rename, archive, requestDelete — "Every method routes to the host's own flow, so optimistic updates, toasts, dialogs, pane closing, and route repair behave exactly as they do in the built-in sidebar").
- `useSidebarSplitLayout()` (stable) / `experimental_useSidebarThreadSplit(threadId)` (per-row drag-to-split + placement): the board's open-thread awareness and per-card "where is this open" affordances.
- `PluginComposerApi` via `useComposer()`/`useComposers()`: "Every composer on screen… oldest first: the thread page's composer, a `ThreadChat`'s composer…" — the native pane's composer is programmatically reachable from a plugin surface if the board wants write-into-composer flows.

What does **not** exist (checked against the 0.6.19 declarations and the installed host): any hook into the native pane's Escape handling, any way to replace the native pane's header or composer chrome, any plugin CSS reaching the native pane's DOM (plugin stylesheets are scoped to `[data-bb-plugin]` roots), and any way to keep the in-board sheet-over-board presentation at narrow desktop widths.

## 5. The residue — what cannot be re-added

Stated plainly, per the brief: these are capabilities the pane has today that the native pane plus hooks cannot host, not gaps a cleverer workaround would close.

- **The custom Escape contract.** "Esc stops a running thread, closes the pane when idle" with a 500ms double-tap debounce, gated on the `escStopsRunningThread` setting (thread-pane.tsx:711–765). The native pane owns its Escape key; no declaration touches it. The setting, its preferences row, and its tests retire. bb's native behaviour (Escape stops a running thread) covers the common case, but the configurable rule is gone.
- **`@project:` chips and the board's routing preference.** Raw `@project:proj_…` tokens stay dead text in every surface (upstream `markdown-thread-mentions.tsx` defines only `THREAD_MENTION_PREFIX`), and `@thread:` chips route wherever bb routes them, not into the board's choice of pane. The board keeps painting chips on its own cards and board surfaces; the transcript loses the decoration. This is audit entry 5's project-token half and routing half, kept honest: they were board-pane-only capabilities.
- **The narrow-panel sheet and the covered-board choreography.** Today a <640px panel dims the board and covers it with the pane-as-sheet (quiet-open dance, `paneCoversBoard`, `PaneSheetCoverageProvider`). Natively, a squeezed board pane splits in half again (usable, but the board loses more width than today's floor-capped pane allows) and compact viewports fall back to plain navigation (board replaced; back returns to the board route — functionally close to today's phone sheet, since the phone pane is full-screen too).
- **Developer scroll instrumentation.** Pane-DOM-specific (`scroll-debug.ts`, 204 lines, setting-gated); deletes with the pane. If a future bug needs it, it needs rebuilding against the native scroller.

> [!IMPORTANT]
> One residue item is deliberately **not** on this list: the maintenance burden itself. Recreating the decoration passes (reference chips, link rescue) as content scripts that paint the *native* pane's DOM would rebuild the exact class of host-compensation code this move deletes, under a new name. The study treats that door as closed: if the native pane cannot host a behaviour, it is lost, not re-implemented.

## 6. Cost and sequence

### 6.1 What deletes, in lines

| Layer | Files | Lines |
|---|---|---|
| Pane component | `components/thread-pane.tsx` | 1,231 |
| Pane satellites (production) | `pane-context-row` (183), `decorate-inline-code` (225), `chat-link-intercept` (98), `decorate-reference-mentions` (344), `host-link-glue` (134), `pane-sheet-coverage` (56), `scroll-debug` (204), `lib/pane-context` (63), `lib/pane-chrome` (9) | 1,316 |
| Board wiring | app.tsx pane flow (subPath sync `1262–1290`, `openThread` assembly `2601–2700`, open/close callbacks, `ThreadPane` render `3997–4130`, `escStopsRunningThread` plumbing), `thread-card.tsx` `usePaneCoversBoard`, `new-thread-modal.tsx` type import | ~400–500 |
| Tests | 16 pane test files (`tests/thread-pane-*`, `pane-context-row`, `decorate-*`, `chat-link-intercept`, `host-link-glue`, `workspace-paths`) | 3,553 |
| Manual + harness | `tests/manual/uat-pane-reference-chips.yaml` (52), `probe-pane-host-markdown` (159), `clip-pane` (65), `repro-context-row-0-48-1` (125), `repro-touch-reveal-cascade` (175), mock-sdk pane plumbing | ~600+ |

**Deletion total: roughly 6,300–6,700 lines** (≈3,000 production, ≈3,300–3,700 test and harness). About 1,020 of the production lines (entries 1–4 satellites) are the same lines the audit already prices as floor-gated removals; this move deletes them by the same floor decision, not a second one.

New code the migration requires: the card-click switch to `actions.open(id, { split: true })` (~20 lines), open-thread awareness via `useSidebarSplitLayout`/`useBbContext` (~60), one `experimental_threadHeaderAction` component (done + snooze + new-child popover, ~250 with its tests ~300), a new UAT suite for the native open flow (~60), preferences cleanup for the retired Escape setting (~20). **Addition total: roughly 700 lines, net deletion ≈ 5,600–6,000 lines.**

### 6.2 Migration order (no broken middle state)

1. **The floor decision** (operator's, section 7): the move pairs with raising `engines.bb` to `>=0.49`, because `@thread:` token resolution without metadata and the native file-link routing parity both land in 0.49 (audit entries 2, 3, 5). On 0.43–0.48 the native pane still works, but the move would regress thread-token chips relative to our painted pane. This is the same decision the audit's section 9 already hands over, with one more consequence attached.
2. **Add before removing.** Register the `threadHeaderAction` control (it renders harmlessly even while our pane is the primary surface — it appears in bb's own thread page immediately, which is a feature, not a conflict) and the split-layout awareness. All additive; `npm test` green after each; no behavior change yet.
3. **Switch the click.** Card click, card-menu "Open thread", and reference routing change from opening the in-board pane to `actions.open(id, { split: true })`. The pane component becomes unreachable but still present — the board is never broken, and a one-line revert restores the old behavior if the field verdict is bad. New UAT suite runs here; release-safety screenshots capture the split flow.
4. **Delete in slices, each PR green alone**: (a) the pane component + board wiring + its 16 test files; (b) the satellites already priced by the audit (ride its removal PRs if they land first, else include them); (c) harness/probe/UAT retirement; (d) the Escape setting and preferences row. Changelog bullets under `[Unreleased]` for the user-visible switch.

### 6.3 Risk per step

- Step 2 risks experimental-surface drift (`threadHeaderAction` contract change across bb versions): contained by the 28px-control constraint and the crash-boundary wrapper; low.
- Step 3 is the behavioral cut-over. The risks: (i) operators who relied on the sheet mode at narrow desktop widths get a halved split instead — visible, needs the UAT's width matrix; (ii) card click now marks threads read (native pane opens) where the pane's open also did — no change, both mark read; (iii) `toThread`-with-split is *not* in the bundled d.ts, so the code must use the actions hook — a type-level trap the migration's lint will catch. Medium, front-loaded, revertible.
- Step 4 is mechanical deletion; the risk is only ordering (keep `browser-reveal`, the card menus, and `workspace-open-menu`'s folder-target enumeration, which the audit's section 5b already flagged as separate).

## 7. The fork this hands to the operator

The study's recommendation is the full move (Option A), gated on the 0.49 floor decision the audit already queued. The board's differentiating surfaces (cards, lanes, groups, sweeps, family zoom) are all board-side and untouched by it; the pane was a parity project, and bb 0.49's native pane is now the superset (rows 11–22 of the table are things our pane *cannot* do, not the reverse). The residue is four capabilities, none load-bearing for the board's job.

- **Option A — full move (recommended).** Click opens the native split; a header action hosts done/snooze/new-child; delete the pane block. Cost: ~700 lines added, ~6,300–6,700 deleted; loses Escape rules, `@project:` chips, chip routing, scroll-debug, the narrow sheet.
- **Option B — keep the pane (status quo).** Cost: the pane-parity gap list stays ours (upstream batch get-bb/bb#7091 blocks four of them), every embedded-`ThreadChat` drift lands on us again each host release, and the audit's floor-gated removals still need their own floor decision later. No new risk today.
- **Option C — hybrid (native split as the click default, keep the pane compiled for a card-menu "Open in board pane" entry).** Buys a transition period at the cost of keeping the entire pane block, its tests, and its compensations alive for a menu entry's sake — the study recommends against it; if a transition is wanted, step 3's one-line revert is the cheaper insurance.

A decision card (dec_) files this fork with the options and costs above; this document is its evidence annex.

## 8. Method note

Host citations are minified-chunk readings from `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/` (bb 0.49.0): `index-UJHlXnMg.js` (navigate factory, split placement `jQ`, pane schema `KN`, thread actions `WZ`), `thread-detail-DObhspNc.js` (native thread page: `threadHeaderActions` rendering, `includePluginMessageActions` default-on, unread divider plumbing), `PluginThreadChat-CHvX4Yi2.js` (embedded chat: `includePluginMessageActions: false`, `unreadDividerAutoScroll: false`, `unreadDividerPlacement: null` hardcoded — the pane-parity gaps 3, 5 confirmed in the installed build). SDK citations are `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` at 0.6.19 with line numbers, cross-checked against the host-side contract at `desktop-v0.43.4`/`0.46.0`/`0.48.1` in the local bb checkout (the bundled d.ts's `toThread` omits the options bag the host contract has carried since 0.46.0 — the actions hook is the declared route on the whole supported floor). Live evidence: `scripts/screenshot/probe-native-split-pane.mjs` against `http://127.0.0.1:38886` (read-only navigation; throwaway Chrome profile; scratch thread thr_j6vpfixgij spawned in proj_p4562js7v2 and deleted after the run), artifacts in `docs/screenshots/probe-native-split-pane/`. Focus Board citations are `file:line` at `dev` `4ccf86a`. Screenshots were evaluated through the vision dispatch (`llm`, `cove/vision:heavy`) since this thread's model is not a vision model.

> AGENT GENERATED CONTENT
