# 2026-11-16: host workaround audit, what bb 0.49.0 made obsolete and what the 0.43 floor still needs

An audit, not a change. Nothing in this document removes a workaround; each removal rides its own pull request with its own evidence.

The question that commissioned it: bb has shipped fixes upstream, so do we still need the workarounds and patches this plugin carries against the host? The answer below is evidence first. Two facts bound it.

1. The installed host is bb 0.49.0 (`bb --version`), released 2026-11-06.
2. `package.json` declares `engines.bb: ">=0.43"`. bb 0.43.0 shipped 2026-09-11.

So a patch for a gap that upstream closed in 0.44, 0.47 or 0.49 is still load-bearing for every install on 0.43 through 0.48. Removing it is a support-floor decision, not a cleanup. That is the one thing this audit cannot decide on its own, and section 9 states it as the operator's call.

## 1. The answer in one paragraph

Thirteen host compensations are in the tree. Six of them are obsolete on bb 0.49.0 and were proven obsolete by running the live host, not by reading notes: the pane's inline-code link decoration, its relative-link rescue, its click capture for both, the ExternalLink glyph glue, and the New Thread dialog's own New project button with its folder-picker flow. Removing those six deletes about 1,180 production lines and about 950 test and harness lines. Seven compensations still earn their place on 0.49.0, each with a probe or a source reading below. Nothing is removable today without raising the floor, because every obsolete patch answers a gap that 0.43 through 0.48 still have.

## 2. How entries are classified

Every entry gets one class.

- **REMOVABLE NOW**: the host never had the gap in any version this plugin claims to support, or the fix predates 0.43.
- **REMOVABLE IF THE FLOOR RISES**: obsolete on 0.49.0, still needed below it. The entry names the version that fixed it, so raising the floor is an explicit choice.
- **KEEP**: still a gap on 0.49.0, with the probe or source reading that shows it.
- **UNKNOWN**: needs a condition the harness cannot fake. The entry says what the operator would have to do.

A note on where upstream notes live, because this is easy to get wrong in both directions. The release **bodies** are empty: `gh release view desktop-v0.47.0 --json body` returns 17 characters, which is just the title, and the same holds for 0.48.0, 0.48.1 and 0.49.0. There are still notes to read. bb keeps them in `CHANGELOG.md` in the get-bb/bb repository, so they are read here at each release tag: `git show <tag>:CHANGELOG.md` for 0.43.4 through 0.48.1 from the local bb checkout, and the GitHub contents API for 0.49.0, since that checkout stops at 0.48.1. Those sections are real: 0.49.0's is 120 lines with Usability, Plugins, Bug fixes and experiments subsections, and two of its bullets decide entries 2 and 8 below. The one release that genuinely has no notes is 0.48.1, which 0.49.0's own summary says "shipped without notes". A note that does not mention a gap still proves nothing: only the probe does.

## 3. Inventory and upstream check

One row per compensation. "Gap" quotes the tree's own comment verbatim.

### Entry 1: ExternalLink glyph glue

- **File and function**: `components/host-link-glue.ts`, `glueHostLinkIcon` and `installHostLinkGlue`, registered as the `host-link-glue` content script in `app.tsx` (`definePluginApp`, last block).
- **Gap**: "That icon is an atomic inline, so the boundary before it is a legal line-break position and the glyph drops to its own line at wrap widths (measured: ~8-9 of 221 swept widths per path length; filed upstream)."
- **What it does**: fuses the host's `svg[data-icon="ExternalLink"]` with the anchor text's last character inside one `white-space: nowrap` unit, on a rAF-coalesced MutationObserver over the whole document, scoped to `[data-focus-board-panel]`.
- **Surface**: pane DOM, plus a document-wide mutation observer.
- **Written**: `8d70d91`, 2026-09-29.
- **Upstream check**: no 0.44 through 0.48 note mentions link glyph wrapping. On 0.49.0, `apps/app/src/components/ui/markdown-preview.tsx` gains `appendMarkdownLinkIcon`, which wraps the icon with the link text's final grapheme in `span.whitespace-nowrap` (the same technique, from the host side). The 0.49.0 notes do not mention it either. The probe is what settles it.
- **Probe**: `scripts/screenshot/probe-pane-host-markdown.mjs` reads the live 0.49.0 pane. Every host anchor reports `"hostIcon": true, "hostIconInNowrap": true`, and every one also reports `"pluginHostGlue": true` (`pluginHostGlueCount: 5`), so the content script is still running and nesting its own nowrap unit inside the host's.
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0).

### Entry 2: inline-code file links painted by the pane

- **File and function**: `components/decorate-inline-code.ts`, `decorateVerifiedInlineCodeLinks` and `decorateCode`; called from the pane's decoration effect at `components/thread-pane.tsx:864` and `:881`.
- **Gap**: "The embedded `ThreadChat` in this pane never receives local-file link routing — the host wires that through the app-panel context, gated on the panel's environment matching the thread's, and a board pane spans many environments — so the same spans render as plain `<code>` here."
- **What it does**: scans the pane DOM for inline `<code>` naming a `.md`/`.markdown` path, asks the plugin backend whether the file exists in the thread's workspace (`workspace_files_exist` RPC, `server.ts:2713`), and on a hit adds an underline, a pointer cursor, a trailing icon, and a `data-focus-board-path-link` flag the pane's click capture reads.
- **Surface**: pane, plus one RPC and one host `pathsExist` call per batch.
- **Written**: `373d48d`, 2026-09-29.
- **Upstream check**: 0.49.0 Usability says "Inline code that looks like a file name becomes a link only when the file exists." In source, `markdown-preview.tsx` gains `resolveInlineCodeFileTarget` and `MarkdownInlineCodeFileLink`, gated on `useHostPathExists(hostId, path)`. `PluginThreadChat.tsx` also stops gating `onOpenLocalFileLink` on the panel's environment: at 0.48.1 it is `const onOpenLocalFileLink = canUseHostFileNavigation ? timelineNavigation.onOpenLocalFileLink : undefined;`, and at 0.49.0 it is `useThreadFileLinkOpener({ environment, openFilePreview, threadId }).openLink`, passed unconditionally through a `ThreadTimelineNavigationProvider` the plugin chat now mounts itself.
- **Probe**: `probe-pane-host-markdown.mjs` on the live host with four inline-code fixtures. `docs/test-coverage-matrix.md` (exists, markdown) rendered as an anchor with `href: "file:///…/docs/test-coverage-matrix.md"`. `components/thread-pane.tsx` (exists, not markdown) rendered as an anchor too. `docs/no-such-file.md` stayed a plain `<code>`, which is the host's existence gate working. No `<code>` element in the pane carried `data-focus-board-path-link`, so the plugin decoration had nothing left to paint.
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0).

### Entry 3: relative markdown link rescue

- **File and function**: `components/chat-link-intercept.ts`, `workspacePathFromHref` and `isExternalHref`, consumed by the pane's click capture.
- **Gap**: "The host's `ThreadChat` renders markdown links with their raw destination, so a message like `[ERD](docs/erd.mmd)` produces `<a href="docs/erd.mmd">`. The browser then resolves that against the bb app's origin and the user lands on an error page."
- **What it does**: classifies anchor hrefs, reduces relative ones to workspace-root-relative paths, and reopens them through `navigate.experimental_openFilePreview` against the thread's environment.
- **Surface**: pane.
- **Written**: `074f032`, 2026-09-29.
- **Upstream check**: 0.45.0 Fixes lists "Fix Claude permission handling, Pi model discovery, OpenCode questions, mobile submit taps, timeline history, file links, and plugin popup focus." That "file links" line is unscoped, and the 0.48.1 source still lacked the routing, so it did not close this gap. 0.49.0's `PluginThreadChat` change above is the one that does: the plugin chat now supplies `onOpenLocalFileLink` itself, so `useMessageLinkRouting` produces `localFile` routing for transcript rows.
- **Probe**: same fixture run. `[the changelog](CHANGELOG.md)` rendered as `href: "file:///…/bb-plugin-focus-board/CHANGELOG.md"`, i.e. the host resolved the relative href against the workspace root before the browser saw it.
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0).

### Entry 4: the pane's click capture for anchors and code spans

- **File and function**: `components/thread-pane.tsx`, `onChatClickCapture` (anchor branch and code-span branch) with `openWorkspacePreview`.
- **Gap**: the same two gaps, mirrored in the pane's own handler: "The same routing gap also hides the host's inline-code file links (see the decoration effect below), so inline code that names a workspace markdown file is claimed here too."
- **What it does**: intercepts left clicks inside the pane's chat body, claims relative anchors and decorated code spans, and opens a file preview.
- **Surface**: pane.
- **Written**: the handler predates the 2026-11-04 rewrite (`960c130`) that added the reference-chip and file-change-title branches.
- **Upstream check**: same as entries 2 and 3. With the host rewriting hrefs to `file://` and painting its own anchors, `isExternalHref` now returns true for every host-routed link, so the pane's anchor branch no longer fires on them.
- **Probe**: `probe-pane-host-markdown.mjs` read zero anchors with a relative href inside the pane, so the branch that claims them cannot match. The click itself was not driven; the branch is unreachable given the hrefs the host now emits.
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0). The file-change-title branch (pane-parity Gap 4) and the reference-chip branch stay.

### Entry 5: pane reference chips

- **File and function**: `components/decorate-reference-mentions.ts`, `decorateReferenceMentions` and `decoratedReferencePaneTarget`; wired at `components/thread-pane.tsx:859` and in `onChatKeyDownCapture`.
- **Gap**: "The host's shared markdown renderer autolinks only raw `@thread:` tokens, and paints a chip for one only when the message carries mention metadata; without it the rendered `bb-thread-mention` element stays an EMPTY inline custom element and the token vanishes from view altogether. Raw `@project:` tokens are not autolinked anywhere."
- **What it does**: turns `@thread:`/`@project:`/bare `@thr_`/`@proj_` tokens and empty `bb-thread-mention` elements into labeled buttons, and routes their clicks to the board's pane or to bb's main view.
- **Surface**: pane.
- **Written**: `aec137f`, 2026-10-15 on the file; the wiring landed at `592a45c`, 2026-10-14 (issue #161).
- **Upstream check**: 0.49.0's `ThreadMentionElement` resolves a thread token from `useSidebarThreadMentionResource(threadId)` or the message's own mentions, then falls back to `ThreadMentionPillWithQuery`. The "empty element" premise therefore no longer holds for thread tokens on 0.49.0. Nothing in 0.43 through 0.49 adds project mentions: `markdown-thread-mentions.tsx` still defines `THREAD_MENTION_PREFIX = "@thread"` and no project equivalent.
- **Probe**: source reading only. A live fixture needs a message whose agent-written text carries `@thread:thr_…` and `@project:proj_…`; that is one cheap thread, and it belongs to whichever pull request narrows this entry.
- **Class**: **KEEP**, narrowed. The project-token half and the board-routing half are live. The empty-thread-mention half looks stale on 0.49.0 and needs the fixture before anyone deletes it.

### Entry 6: composer context fallback row

- **File and function**: `components/pane-context-row.tsx` (`usePaneContextRowMissing`, `composerContextVisible`, `paintable`) with `lib/pane-context.ts`.
- **Gap**: "bb's own thread page passes both an `environmentSummary` and a `compactEnvironmentSummary` to its promptbox, and on a narrow container the promptbox renders only the compact one. The embedded `ThreadChat` the SDK hands plugin panels receives no `compactEnvironmentSummary`". The comment also records that "the desktop footer is mounted but collapsed to height 0 (the chips stay mounted and their rects keep measuring, exactly the 0.46.1 trap), and a touch pane's footer is unmounted outright".
- **What it does**: watches the pane's chat DOM, decides by a paint walk whether the host shows project, environment or checkout context, and paints its own line only when it does not.
- **Surface**: pane composer.
- **Written**: `a8ad822`, 2026-10-15; re-verified and rewritten at `960c130`, 2026-11-04 for 0.48.1; details in `docs/composer-context-collapse-2026-10-16.md`.
- **Upstream check**: 0.48.0 says "Side chat and plugin thread chats match the main thread view: interactions, editing and forking messages, context usage, and the cards above the composer." No 0.49.0 note mentions the composer footer's context chips.
- **Probe**: `scripts/screenshot/repro-context-row-0-48-1.mjs` against the live 0.49.0 app (artifacts in `docs/screenshots/repro-context-row-0-49/`). Desktop: `{"footerMounted":true,"footerBox":{…,"h":0},"chipsPainted":{"Project:":false,"Environment:":false,"checkout-chip":false},"fallbackRow":true}`. Phone: `{"footerMounted":false,"chipsPainted":{},"fallbackRow":true}`.
- **Class**: **KEEP**. The gap is unchanged on 0.49.0, and the fallback self-quiets if it ever closes.

### Entry 7: queued-send touch reveal echo

- **File and function**: `components/thread-pane.tsx`, the chat body's `[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100` classes, with a long comment above the element.
- **Gap**: "bb scopes our plugin stylesheet with `:where([data-bb-plugin="focus-board"], [data-bb-plugin-root]:not([data-bb-plugin]))` and appends it after bb's global utilities, so our own scoped `.pointer-events-none` and `.opacity-0` outrank the host's `[@media(hover:none)]` touch reveal on any host element inside this root … The queued-message row's actions control is the case that bites: on a phone it stays `opacity:0` and `pointer-events:none`, so the row's "…" is invisible and Send is unreachable."
- **What it does**: re-emits the host's own hover-none utilities from the pane's subtree so they land in the plugin's scoped sheet and win by order.
- **Surface**: pane.
- **Written**: `da2b22e`, 2026-10-27 (issue #296); re-verified at `960c130`, 2026-11-04.
- **Upstream check**: no 0.44 through 0.49 note mentions plugin stylesheet scoping. 0.49.0's New experiments adds "**Faster plugin styles:** each plugin's stylesheet only matches that plugin's own UI, which makes style updates cheaper", off by default. If that ships, the cascade this patch depends on can move, which would break or obsolete the echo.
- **Probe**: last live run is `scripts/screenshot/repro-touch-reveal-cascade.mjs` on 0.48.1, which measured the row's "…" untappable with the utilities stripped and tappable with them. The scoping mechanism is unchanged in source at 0.49.0: `packages/plugin-build/src/scope-plugin-utilities.ts` still exports `scopePluginUtilities` and the build still scopes utilities. Not re-run on 0.49.0 this pass.
- **Class**: **KEEP**, with the new experiment watched.

### Entry 8: the New Thread dialog's own New project button

- **File and function**: `components/new-thread-modal.tsx` (the `onCreateProject` and `onCreateProjectFromPicker` props, `startCreateProject`, the floating button and its inline name field) with `lib/composer-row-anchor.ts` (`measureFooterRowAnchor`, `composeFooterRowPlacement`) and `components/use-footer-row-anchor.ts`.
- **Gap**: "the plugin-facing `experimental_NewThreadComposer` wrapper drops bb's `createProject` capability (upstream request get-bb/bb#7015), so the row cannot host a plugin-rendered control, and no composer-customization region reaches it either."
- **What it does**: renders its own New project control and positions it, by measuring the host footer row's geometry per render, with its right edge on the row's content start.
- **Surface**: modal.
- **Written**: `0447e50`, 2026-11-04 (issue #355).
- **Upstream check**: 0.49.0 Plugins lists "and New project in `experimental_NewThreadComposer`" among new surfaces. In source, `apps/app/src/components/plugin/PluginNewThreadComposer.tsx:85` passes `createProject: { onCreate: () => quickCreateProject.openCreateDialogThen(setPickedProjectId), … }`, and `apps/app/src/components/pickers/ProjectSelector.tsx:307` renders a `CommandItem` for it labeled "New project". The capability is absent at 0.48.1 and every earlier tag checked (`grep -c createProject` over `PluginNewThreadComposer.tsx` returns 0 at 0.43.4, 0.46.0, 0.47.0, 0.48.0 and 0.48.1).
- **Probe**: `scripts/screenshot/probe-new-project-control.mjs` against the live 0.49.0 app. It opens the board's own New Thread dialog and reads `{"pluginButtons":[{"side":"plugin","text":"","anchored":true}],"hostProjectPicker":{"label":"Project: No project"},"footerRowMounted":true}` and, with the project picker open, `{"menuItemCount":59,"createEntries":["New project"]}`. Two New project affordances, one per side.
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0).

### Entry 9: the folder-picker create flow

- **File and function**: `lib/project-create-flow.ts`, `createProjectFromPickedFolder`, wired in `app.tsx` as `pickedFolderCreate`.
- **Gap**: "The plugin cannot read bb's own client-host id (the desktop API's `localDaemonHostId` is not exposed to plugins; BbContext carries only project and thread ids), so the host can be honestly named as the machine to ask only where the board's host list leaves no ambiguity: one connected persistent host IS the bb client's machine."
- **What it does**: runs bb's native folder picker through `hosts.pickFolder` when exactly one persistent host serves the board, names the project after the folder, and creates it with a `local_path` source.
- **Surface**: modal.
- **Written**: `0447e50`, 2026-11-04, the same change as entry 8.
- **Upstream check**: the host's own `createProject` path (entry 8) owns folder selection now, inside the host, where the client host id is known.
- **Probe**: covered by entry 8's probe. The host entry exists and is enabled (`disabled: !quickCreateProject.isAvailable || isCreating`).
- **Class**: **REMOVABLE IF THE FLOOR RISES** (0.49.0), with entry 8.

### Entry 10: needs-you flag guard

- **File and function**: `lib/interaction-sync.ts`, the `thread:changed` extractor and `InteractionFlagStore` overlay.
- **Gap**: "the server clears that flag the moment an interaction settles …, but rows the board renders come from the host's sidebar cache, which does not always pick the settle event up in time: a card can sit in the Needs-you column after the user already answered (observed 2026-09-29 on thr_6fzk5sjz79, answered via the host's main-view form at 22:39:45 while the board row kept the stale flag)."
- **What it does**: listens for `interactions-changed` realtime events, verifies the flag, and overlays the verified value on sidebar rows until the sidebar catches up.
- **Surface**: board.
- **Written**: `671a921`, 2026-09-29.
- **Upstream check**: 0.48.0 Reliability has "No more stale state: sidebar spinners stop when a thread stops, pull request status updates in every open view …, collapsed sidebar groups stay collapsed when background threads become unread, and switching threads keeps cached plugin data." That is the same family of cache-staleness work but names neither interactions nor the sidebar thread flag, so it does not close this. `interactions-changed` still exists as a change kind at 0.49.0 (`packages/domain/src/change-kinds.ts:20`) and still drives the realtime cache registry (`apps/app/src/hooks/cache-owners/realtime-cache-registry.ts:381`), so the guard's input still arrives.
- **Probe**: none this pass. Proving the overlay is still needed means reproducing a settle race: answer an ask and read the sidebar row inside the window before the refetch lands. A cheaper direction first is to check whether the guard's verification path still fires at all, which needs one answered interaction on a watched board.
- **Class**: **UNKNOWN**. The guard is cheap and self-correcting (it verifies before it overlays), so the risk of keeping it is low; the risk of removing it is a stale Needs-you card, which is the bug it was written for.

### Entry 11: sequential sweep runner

- **File and function**: `lib/sweep.ts`, `runSweep`.
- **Gap**: "the host's sidebar actions run one row at a time (a new write aborts the previous in-flight one — a single-slot design), so firing the loop without awaiting applies only the last candidate."
- **What it does**: awaits each per-thread gesture, collects failures instead of stopping, and reports the remainder.
- **Surface**: board.
- **Written**: `ee21464`, 2026-10-01 on the behaviour; the file was last touched at `e6a3e2d`, 2026-10-14.
- **Upstream check**: no note in 0.44 through 0.49 mentions sidebar write concurrency. 0.49.0 Performance says sidebar clicks and renames "redraw only the affected rows", which is rendering, not write ordering.
- **Probe**: none. A probe would archive several threads in one unawaited burst through the host's own action path and count the writes that landed; doing that on the operator's board is not a read-only check.
- **Class**: **KEEP**. The sequential loop is 8 lines of control flow and costs only latency on a sweep.

### Entry 12: open in browser

- **File and function**: `lib/card-menu.ts` (`openInBrowser` handler and its doc comment), the "Open in browser" entry that replaced "Open in new window".
- **Gap**: "The thread's fresh-surface open, run with the card's app-relative href (the host's window guard routes the raw open to the user's browser: the system browser on desktop, a detached tab on the web)."
- **What it does**: hands the thread URL to a raw `window.open` and lets the host's deny path send it to the user's browser.
- **Surface**: board routing.
- **Written**: `9e122d8`, 2026-10-10; the underlying gap is written up in `docs/upstream/bb-feature-request-thread-window.md`.
- **Upstream check**: 0.49.0 adds no window-creation surface for plugins. Its Plugins section lists new slots and helpers (message metadata, panel tabs, servers, host path helpers, thread read events, regenerate title, RPC cancellation, collapsible stack card, app update scheduling, New project) and none of them opens a native window. The SDK contract at 0.49.0 still has no `createApplicationWindow`, `openWindow`, or window-targeted open; `packages/plugin-sdk/src/app-contract.ts` mentions windows only in a doc comment about URLs that already "open in a new window".
- **Probe**: source reading of `packages/plugin-sdk/src/app-contract.ts` at `desktop-v0.49.0`.
- **Class**: **KEEP**.

### Entry 13: the `rank_move` optional-member spread

- **File and function**: `app.tsx`, the `rank_move` call's `...(unitIds !== undefined && unitIds.length > 1 ? { unitIds: [...] } : {})` spread.
- **Gap**: "a literal member set to `undefined` is an own property whose value JSON has no equivalent, and the host's input validation walks it as a JSON value and rejects — every solo drag was refused at the bridge with `$input.unitIds is not a JSON value` (issue #240)."
- **What it does**: writes the member only when a multi-thread unit exists.
- **Surface**: host RPC.
- **Written**: `d9378fe`, 2026-10-16.
- **Upstream check**: the validation is still there at 0.49.0: `apps/app/src/lib/plugin-sdk-hooks.ts:119` throws `` `rpc input at ${path} is not a JSON value` ``. No note mentions it.
- **Probe**: source reading of that throw at 0.49.0.
- **Class**: **KEEP**. Two lines.

## 4. What is not a workaround, so the inventory stays honest

These sit near the same grep and are deliberately not entries.

- `components/settings-modal.tsx:523` ("the host's schema is the write authority; the modal's cap only keeps obvious garbage out of the input") and `components/preferences.ts:379` ("The caps mirror the descriptor schemas as an input rail only") describe a deliberate authority split. The host declares the setting; the modal mirrors the cap so a bad entry fails inline. Deleting the mirror would not make the modal simpler, it would make it trust a stale local copy.
- `components/thread-pane.tsx`'s `composerFocusRequest` (pane-parity Gap 8) and its `messageActions` (Gap 5) are plugin-side work the SDK already supports. They are not compensating for a host gap and removing them would remove features.
- `components/parent-lanes.ts:237` and `components/grouping.ts:98,606` mention "upstream" and "the host's live count" as data sources, not as gaps being patched.
- `lib/project-create-flow.ts`'s host-ambiguity rule is a workaround and is entry 9 above, listed here only because the same comment carries an honest statement of what the plugin cannot see.

## 5. Probes: what was run, and what came back

Two new scripts live in the tree so the next reader can re-run them rather than trust this document. Both drive the live app at `BB_APP` (default `http://127.0.0.1:38886/plugins/focus-board/board`) with the system Chrome.

**`scripts/screenshot/probe-pane-host-markdown.mjs`** opens one thread's pane, wheels to the newest message, and reports every inline `<code>` span and every anchor with which side painted it. Fixtures needed in the thread's newest message: `docs/test-coverage-matrix.md` (exists), `docs/no-such-file.md` (missing), `components/thread-pane.tsx` (exists, not markdown), `[the changelog](CHANGELOG.md)`, `[nothing](docs/no-such-file.md)`. The run recorded for this audit used a scratch thread (`thr_k7iz4mdb63`, deleted afterwards) in the plugin's own project.

Key output:

```json
{
  "codes": [
    { "text": "docs/no-such-file.md", "inAnchor": false, "pluginPathFlag": false }
  ],
  "anchors": [
    { "text": "docs/test-coverage-matrix.md", "href": "file:///…/docs/test-coverage-matrix.md", "hostIcon": true, "hostIconInNowrap": true, "pluginHostGlue": true },
    { "text": "components/thread-pane.tsx", "href": "file:///…/components/thread-pane.tsx", "hostIcon": true, "hostIconInNowrap": true, "pluginHostGlue": true },
    { "text": "the changelog", "href": "file:///…/CHANGELOG.md", "hostIcon": true, "hostIconInNowrap": true, "pluginHostGlue": true },
    { "text": "nothing", "href": "file:///…/docs/no-such-file.md", "hostIcon": true, "hostIconInNowrap": true, "pluginHostGlue": true }
  ],
  "pluginHostGlueCount": 5
}
```

Read it three ways. The host owns inline-code file links and relative link routing on 0.49.0, and it gates them on existence. The plugin's glyph glue still runs and now nests inside the host's own nowrap unit. Relative markdown links are routed without an existence check (the `nothing` anchor points at a missing file), which is the host's behaviour, not ours.

**`scripts/screenshot/probe-new-project-control.mjs`** opens the board's own New Thread dialog and reads the project control. Output for this audit:

```json
{
  "dialogOpen": true,
  "pluginButtons": [{ "side": "plugin", "text": "", "anchored": true }],
  "hostProjectPicker": { "label": "Project: No project", "paintsCreate": false },
  "footerRowMounted": true,
  "projectMenu": { "menuOpen": true, "menuItemCount": 59, "createEntries": ["New project"] }
}
```

The dialog paints the plugin's floating button and the host's own "New project" menu row in the same picker.

**Re-run, not new**: `scripts/screenshot/repro-context-row-0-48-1.mjs` against 0.49.0, results quoted in entry 6 and the screenshots in `docs/screenshots/repro-context-row-0-49/`.

**Source readings, no probe needed**: entries 5, 7, 12 and 13 turn on a line of host source or a still-present symbol, quoted above with its file and line at `desktop-v0.49.0`. Each entry says so, so a reader can tell a probe from a reading.

### 5a. Corroboration from the installed build

The probes above ran against the installed app, so they are already the strongest evidence. One more check was run afterwards because the published tag and the installed binary are not the same artifact: the routing code was read out of the build that is actually running.

Start with where that build lives, since the obvious guess is wrong. `/Applications/bb.app/Contents/Resources/app.asar` is the 22 MB desktop bundle and it carries no renderer code: grepping it for `Ask anything`, `whitespace-nowrap` or `data-clipboard-inline-code` returns zero hits on all three. The app the browser talks to is served from the unpacked bb package, `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/` (1,509 chunks), and that is where the routing lives.

Three readings from those chunks, all on the installed 0.49.0:

- `canUseHostFileNavigation` appears in **none** of the 1,509 installed chunks. That is the gate the pane's comments name. It exists in the published source for 0.43.4 through 0.48.1, so its absence is the floor boundary showing up in the binary.
- `PluginThreadChat-CHvX4Yi2.js` mounts the navigation provider with the opener passed straight through: `jsx(me,{environmentId:T.environmentId,hostId:Ze,onOpenLocalFileLink:Ue,resolveMentionLink:G,threadId:T.id,workspaceRootPath:Ge,children:Z})`, with `Ue` computed unconditionally. That is entries 2 and 3 closed in the shipped build.
- `thread-detail-DObhspNc.js` carries the inline-code file link and its existence gate: `function YL(e){…if(!Br(i,s.link.path))return n;…jsx(WL,{"data-clipboard-inline-code":"",href:s.href,…children:r})}`, where `Br` is the host path-existence hook and `WL` is the markdown anchor. That is entry 2's replacement, and the reason the missing-file fixture stayed a plain `<code>` in the probe.

### 5b. What the SDK surface now offers, and what it does not replace

The plugin SDK's bundled declarations ship in this checkout (`node_modules/@get-bb/plugin-sdk/bundled-types/`, 0.6.19: 20,968 lines for `bb-plugin-sdk-app.d.ts` and 23,509 for `bb-plugin-sdk.d.ts`). Three families there looked like they might make some of this obsolete outright, so each was read and checked against where the pane actually renders.

- **`experimental_FileLink`** (`ExperimentalFileLinkProps`, `bb-plugin-sdk.d.ts:20736`): "Props for BB's host-rendered semantic file link. Valid targets receive a scheme-safe anchor href; traversal paths, ill-formed Unicode, and other malformed runtime targets remain inert." This is a component a plugin renders in **its own** markdown. The pane does not render its own transcript markdown; it embeds the host's `ThreadChat` and paints onto the host's DOM. The component therefore replaces nothing here. It is the right tool for a plugin surface that renders markdown itself, and this plugin has none of those in the scope of entries 1 through 4.
- **`PluginMessageDirectiveProps.openWorkspaceFile`** (`bb-plugin-sdk.d.ts:18363`): "Opens a worktree-relative file in the host's workspace file viewer. Null when the message surface has no workspace viewer available", delivered to a registered `messageDirective` component with the message it appeared in. This *is* a host-rendered path inside the real transcript, which makes it the most interesting of the three. It still does not reach entries 2 through 5: a directive is something an agent writes as a directive, and the gaps here are markdown inline code, markdown links and `@` tokens that agents already write. Adopting directives would mean asking for new agent output, not reading existing output. Worth remembering as a design option for entry 5 if the project ever wants chips that survive a host restyle.
- **`experimental_openFilePreview` and `experimental_openFileExternally`** (`bb-plugin-sdk.d.ts:20806` and `:20808`): the pane already uses the first (`openWorkspacePreview`). The second is new to the audit and opens "a live file in this client's preferred external file target". It is a candidate for **simplifying**, not removing, `components/workspace-open-menu.tsx`: that menu enumerates targets and opens the workspace *folder*, which it does through the plugin server's `workspace_open_targets` and `workspace_open_in_target` RPCs and the loopback host daemon (`lib/workspace-open.ts`). The SDK call takes a file target and the client's preferred app, with no enumeration, so replacing the menu with it would drop the picker rather than simplify it. Not a host-gap workaround, so not an entry, but the next person to touch that menu should know the SDK grew a one-call external open.

No verdict in section 3 changed after reading these. The three families either serve a surface this plugin does not have, or answer a question nobody is asking the transcript.

## 6. Count by class

Thirteen entries.

- **REMOVABLE NOW**: 0.
- **REMOVABLE IF THE FLOOR RISES**: 6 (entries 1, 2, 3, 4, 8, 9), all for the same version, bb 0.49.0.
- **KEEP**: 6 (entries 5, 6, 7, 11, 12, 13).
- **UNKNOWN**: 1 (entry 10).

The zero on REMOVABLE NOW is the audit's main finding. Every obsolete patch in this tree answers a gap bb 0.43 through 0.48 still has, so nothing here can be deleted by a maintenance pass alone. The unit of work is the floor, and the six removals follow it.

## 7. Ranked removals: payoff, risk, and the exact edit

Ordered by what I would ship first. Every one of them is blocked behind the floor decision in section 9; none can land on `dev` while `engines.bb` says `>=0.43`, because on a 0.43 host each removal would ship a regression.

### First: the ExternalLink glyph glue (about 307 lines)

- **Edit**: delete `components/host-link-glue.ts` (134 lines) and `tests/host-link-glue.test.ts` (162 lines). In `app.tsx`, delete the `host-link-glue` registration and the seven-line comment above it, and the `installHostLinkGlue` import.
- **Payoff**: about 145 production lines and 162 test lines, plus a document-wide MutationObserver that runs a rAF-coalesced sweep on every DOM change in the app shell, in every window where the plugin is loaded.
- **Risk if the removal is wrong**: cosmetic on an older host, where the link glyph can wrap onto its own line at some pane widths. No dead click, no broken contract. The probe already shows the host's own nowrap unit is the one doing the work on 0.49.0.

### Second: inline-code and relative-link routing (about 1,020 lines)

- **Edit**: delete `components/decorate-inline-code.ts` (225), `components/chat-link-intercept.ts` (98), `tests/decorate-inline-code.test.ts` (259), `tests/chat-link-intercept.test.ts` (157) and `tests/workspace-paths.test.ts` (39). In `components/thread-pane.tsx`, delete `openWorkspacePreview`, `checkWorkspacePaths`, the decoration effect (`useEffect` at about line 843 through 910), the anchor and code branches of `onChatClickCapture` (about lines 640 through 660), and the now-unused imports. In `server.ts`, delete the `workspace_files_exist` contract (about lines 473 through 483) and its implementation (about lines 2713 through 2747). In `scripts/screenshot/`, drop the mocked RPC from `mock-sdk.tsx:1450` and its fixture list from `data.ts:32`, and the matching rows in `tests/rpc-contract-hardening.test.ts`.
- **Payoff**: the largest single cut in the tree, about 550 production lines and 475 test and fixture lines, one RPC, one host `pathsExist` call per pane scan, and one mutation-driven decoration pass that runs on every frame the transcript changes.
- **Risk if the removal is wrong**: the exact bugs this code was written for come back on an older host. Inline-code `.md` spans stop being links, and a relative markdown link opens an error page against the bb app's origin instead of the file. This is the one removal where a wrong guess is user-visible, so it should land with the floor bump in the same release, not ahead of it.

### Third: the New Thread dialog's New project button (about 800 lines)

- **Edit**: delete `lib/composer-row-anchor.ts` (122), `components/use-footer-row-anchor.ts` (108), `lib/project-create-flow.ts` (96), `tests/composer-row-anchor.test.tsx` (148) and `tests/project-create-flow.test.ts` (143). In `components/new-thread-modal.tsx`, delete the `onCreateProject` and `onCreateProjectFromPicker` props, the `newProjectName`, `createPending`, `pickingPending` and `creatingProject` state, `startCreateProject`, `submitCreateProject`, the `useFooterRowAnchor` call, the floating button block and the inline name-field block (about lines 425 through 510), and the `composer-row-anchor` imports. In `app.tsx`, delete `pickedFolderCreate` and the `onCreateProjectFromPicker` prop, keep `createProject` (the board toolbar's group dialog still uses it), and drop it from the modal's props. Retire `scripts/screenshot/repro-new-project-row.mjs` and the `?folderPick=` mock with it.
- **Payoff**: about 486 production lines and 311 test and harness lines, plus a duplicated control in the dialog today and a per-render geometry measurement of the host's footer row.
- **Risk if the removal is wrong**: on an older host the dialog loses project creation, since the guest composer there has no `createProject` at all. On 0.49.0 nothing is lost: the host's entry creates the project and selects it in the picker, which is exactly what the plugin's button did.

The other three floor-gated entries ride with these. Entry 3's module is deleted as part of the second removal, and entry 4's two branches with it; entry 9 goes with the third.

## 8. What is still load-bearing on 0.49.0, and the proof

Four of the seven KEEP entries carry a probe or a source reading that names the live gap.

- **Composer context row** (entry 6): the live 0.49.0 run reads the host footer at height 0 on desktop with no chip painted, and unmounted on a touch viewport, while the fallback row renders in both. Artifacts in `docs/screenshots/repro-context-row-0-49/`.
- **New project duplicate** (entry 8, removed only by the same floor bump): the live dialog carries both controls. Until the floor moves, the duplicate is the shipped state.
- **Reference chips** (entry 5): the host still autolinks `@thread` only, so `@project:proj_…` is dead text in every surface, and the board still wants its own routing for tokens that name a thread the board lists.
- **`rank_move` spread** (entry 13) and **open in browser** (entry 12): both rest on a symbol that is still present at 0.49.0, quoted in their entries.

The plainest statement of the floor's cost: the plugin's own pane is at parity with the main thread view on 0.49.0 for the two surfaces it patches most (inline file links and relative links), and those two patches are the largest block of compensation code in the repository.

## 9. The decision this audit hands to the operator

The six REMOVABLE IF THE FLOOR RISES entries exist because `package.json` says `engines.bb: ">=0.43"`. Raising that line to `>=0.49` is what makes them deletable. Three consequences have to be weighed together.

1. **Reach**: bb installs a plugin by semver range, so a floor of 0.49 means a 0.43 through 0.48 host refuses to load or update the plugin until it upgrades bb. Nobody can tell from this repository how many installs sit on those versions.
2. **Payoff**: about 1,180 production lines and 950 test and harness lines, one RPC, one content script, one document-wide observer, and two host behaviours the plugin duplicates.
3. **Reversibility**: the floor is one line and can be lowered again in a later release, but an install that already updated into a floor bump has no way back to an older plugin version through bb's own update path.

There is a fourth option that does not require the floor to move: runtime feature detection. The pane already proves it can read the host's rendered behaviour (`usePaneContextRowMissing` walks the paint). A detection pass could check whether the host painted a `file://` anchor for a relative link and skip the plugin's modules when it did. That keeps 0.43 support and still lets the compensation code be deleted, at the cost of one more probe on a path that already carries several.

This is filed as a decision for the operator rather than assumed, because the blast radius is every install of the plugin rather than this thread's work.

## 10. Cross-references, not second investigations

- **Sibling thread `thr_3k9eas3d6j`** (a directory reference in the pane opening a file preview that cannot render it): entries 2, 3 and 4 are in its scope, and this audit adds one fact worth carrying over. On 0.49.0 the host routes a relative markdown link through its local-file resolver without checking that the target exists (the `nothing` anchor above points at `docs/no-such-file.md`), and it accepts any extension for inline code once existence passes (`components/thread-pane.tsx` rendered as a link). A directory or unrenderable target therefore reaches the preview untouched, and the pane's own decoration is no longer in that path at all. The investigation stays on that thread.
- **`docs/plans/pane-parity-audit-2026-11-04.md`**: the pane-parity audit's Gap 10 asked for exactly this re-verification on a newer host. Its three items resolved as follows: the chat-click jump guard is already retired (`960c130`), the touch reveal still holds (entry 7), the context row still holds (entry 6). Gaps 1 and 2 are already fixed in the tree; gaps 3, 5, 6, 7 and 9 are still open on 0.49.0 (`PluginThreadChat.tsx` still hardcodes `includePluginMessageActions: false`, `unreadDividerAutoScroll: false` and `unreadDividerPlacement: null`, and still passes no `onTitleAction`).
- **`docs/composer-context-collapse-2026-10-16.md`**: the history behind entry 6.
- **`docs/upstream/bb-feature-request-thread-window.md`**: the write-up behind entry 12.
- **`docs/tech-debt/react-dom-warnings.md`**, **`docs/tech-debt/2026-10-15-preexisting-typecheck-failures-tracker-freshness.md`**: unrelated tech debt, listed so a reader does not assume this audit covered them.

## 11. Method note

bb-side citations are paths at `desktop-v0.49.0` in get-bb/bb, read from a source tarball of the tag; versions below 0.49.0 were read from the local bb checkout's tags (`desktop-v0.43.4` through `desktop-v0.48.1`), which is where the per-version `grep -c` counts in entries 2 and 8 come from. Release-note quotes are from `CHANGELOG.md` at each tag, because the desktop release bodies are 17-byte titles. The installed build was read from `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/`, not from the desktop `app.asar`, which holds no renderer code. The SDK surface was read from `node_modules/@get-bb/plugin-sdk/bundled-types/` (0.6.19). Focus Board citations are `file:line` at `dev` `9c030ae` (1.7.16-dev). Live probe results are from bb 0.49.0 on macOS with the system Chrome, recorded in `docs/screenshots/probe-pane-host-markdown/`, `docs/screenshots/probe-new-project-control/` and `docs/screenshots/repro-context-row-0-49/`. One scratch thread was used for the pane probe and deleted afterwards.

> AGENT GENERATED CONTENT
