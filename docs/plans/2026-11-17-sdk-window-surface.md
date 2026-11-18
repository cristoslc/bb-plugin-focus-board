---
title: The SDK's window and pane surface, quoted
status: reference
updated: 2026-11-17
tags: [sdk, panes, window, reference, bb-0.49]
---

# The SDK's window and pane surface, quoted

A walkthrough of what the plugin SDK says about the app window: the state a plugin can read, the operations it can request, the absences, and the answer to the question that started this thread (can a plugin put a thread beside the board as the window's first split?). Every claim below is either a verbatim quote from the declarations or a line of installed host code, labeled as such.

## 0. Sources, method, and the rule this document follows

Five sources, used in this order.

| Source | Path | Version |
|---|---|---|
| App-side SDK declarations | `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts` | 0.6.19 (this repo declares `^0.6.19`) |
| Shared and server-side declarations | `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` | 0.6.19 |
| Test doubles | `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-testing-app.d.ts` | 0.6.19 |
| Installed host renderer (corroboration only) | `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/` | bb 0.49.0 |
| CLI help text (documentation, not inference) | `bb thread open --help`, `bb thread pane --help` | installed `bb` |

Two rules govern the shape of this document.

1. A quote is the evidence. Anything in a blockquote marked **Quote** is copied character for character from the source named beside it, including its em dashes and its JSX `{@link}` references.
2. Host code never replaces a quote. Where the declarations are silent or ambiguous, the host line appears in its own paragraph, labeled **Host shows**, and it settles what the words mean in practice rather than standing in for words that do not exist.

The SDK version matters. `@get-bb/plugin-sdk` 0.6.19 is the declaration set a plugin author compiles against in this checkout, and the installed host is 0.49.0. Where the two disagree, the disagreement is named in the text rather than smoothed over.

Note on a referenced document: several declarations point at `docs/api_to_audit.md`. That file is not in the published package (`README.md`, `bundled-types/`, `dist/` only), so it cannot be quoted here.

## 1. Window and pane state: everything a plugin can know

Nineteen declarations report something about the window. They fall into five families: the split layout as a whole, one row's place in it, the navigation items, the route and panel identity, and the viewport.

### 1.1 The whole split layout

**Quote** (`bb-plugin-sdk-app.d.ts:18974-18981`, doc comment on `PluginSidebarSplitLayout`):

> The whole split layout (see {@link PluginSdkApp.useSidebarSplitLayout}):
> every pane with its rect as fractions of the split area and the thread it
> shows, or null when there is no split (a single pane, a compact viewport,
> or splits disabled). Use it for group rollups, a collapsed section that
> should show where its threads are open; a row wants
> `experimental_useSidebarThreadSplit` instead.

**Quote** (`:18982-18995`, the shape it returns):

> interface PluginSidebarSplitLayout {
>     panes: readonly {
>         paneId: string;
>         rect: {
>             x: number;
>             y: number;
>             width: number;
>             height: number;
>         };
>         /** The thread this pane shows, or null for non-thread content. */
>         threadId: string | null;
>         isFocused: boolean;
>     }[];
> }

**Quote** (`:20786-20790`, the hook):

>     /**
>      * The whole split layout (see {@link PluginSidebarSplitLayout}), or null
>      * when nothing is split. One subscription for the whole list.
>      */
>     useSidebarSplitLayout(): PluginSidebarSplitLayout | null;

The hook returns either a list of panes or `null`, and the doc comment defines the single-pane case as `null` rather than as a one-element list. Each pane carries an id, a rectangle expressed as fractions of the split area, the thread it shows (or `null` for a pane holding something else), and a focus flag. "One subscription for the whole list" is the only sentence in the SDK that promises a plugin will be re-rendered when the layout changes.

A declaration note: `panes` is typed `readonly` and carries no methods, so this is a snapshot for drawing, not a controller. `paneId` is the only handle it gives you.

**What this means for the board:** this is the one hook that can tell the board whether a thread is open beside it, and it reports `null` for both "one pane" and "splits are off", so the board cannot tell those two situations apart.

### 1.2 One row's place in the layout, and the split drag

**Quote** (`:18996-19011`, doc comment on `PluginSidebarThreadSplit`):

> /**
>  * Drag-to-split support for one row, plus where that thread currently sits in
>  * the split layout.
>  */
> interface PluginSidebarThreadSplit {
>     /**
>      * Spread onto the row's interactive element. Carries the pointer handler
>      * that starts a split drag; empty when splits are unavailable, so spreading
>      * it is always safe.
>      *
>      * The host owns every rule: the gesture engages only once the pointer leaves
>      * the sidebar toward the main area (so a list with its own drag-to-reorder
>      * keeps working), an edge drop splits, a center drop replaces, an
>      * already-open thread focuses its pane, and the pane cap coerces a split
>      * into a replace.
>      */
>     splitProps: {
>         onPointerDown?: (event: react.PointerEvent<HTMLElement>) => void;
>     };

**Quote** (`:19015-19026`, the rest of the interface):

>     /**
>      * False on compact viewports, when the user disabled splits, and for an
>      * unknown thread id. Gate any "open in split" affordance you draw on it.
>      */
>     isAvailable: boolean;
>     /**
>      * Where this thread sits in the split layout, or null when it is not open in
>      * one (including single-pane layouts). Draw a mini-map, a tint, or nothing.
>      */
>     layout: {
>         panes: readonly PluginSidebarSplitPane[];
>     } | null;

**Quote** (`:18961-18973`, the pane shape this one uses):

> /** One pane's place in the split layout, as fractions of the split area. */
> interface PluginSidebarSplitPane {
>     paneId: string;
>     rect: {
>         x: number;
>         y: number;
>         width: number;
>         height: number;
>     };
>     /** This pane holds the thread the row represents. */
>     isMe: boolean;
>     isFocused: boolean;
> }

This is the per-row sibling of the layout hook. It hands a plugin the pointer handler that starts a drag, a boolean saying whether a split is possible at all, and this thread's own place in the layout. The four rules the drag obeys are stated here in one sentence: edge drop splits, center drop replaces, an already-open thread focuses, and the pane cap coerces a split into a replace. The CLI help restates the cap in section 2.6 and the declarations state it nowhere else.

**What this means for the board:** the board renders cards, not sidebar rows, so the drag handler applies to a row it does not own. The `isMe` flag is defined as "this pane holds the thread the row represents", which for a board card means "this is the pane showing that card's thread", not "this is the board's pane".

### 1.3 Navigation items and their split state

**Quote** (`:17853-17875`, the navigation split):

> /**
>  * Per-item drag-to-split support (see
>  * {@link PluginSdkApp.experimental_useSidebarNavigationSplit}). Same contract
>  * as {@link PluginSidebarThreadSplit}.
>  */
> interface ExperimentalSidebarNavigationSplit {
>     /**
>      * Spread onto the item's interactive element. Empty when the item cannot
>      * open in a pane, so spreading it is always safe.
>      */
>     splitProps: {
>         onPointerDown?: (event: react.PointerEvent<HTMLElement>) => void;
>     };
>     /**
>      * False for items that cannot open in a pane (Search, Plugins, Skills), on
>      * compact viewports, and when splits are unavailable.
>      */
>     isAvailable: boolean;
>     /** Where this item's destination sits in the split layout, or null. */
>     layout: {
>         panes: readonly PluginSidebarSplitPane[];
>     } | null;
> }

**Quote** (`:17840-17852`, the state hook):

> /** What {@link PluginSdkApp.experimental_useSidebarNavigation} returns. */
> interface ExperimentalSidebarNavigationState {
>     /** Every item in the user's saved order, visible and hidden. */
>     items: readonly ExperimentalSidebarNavigationItem[];
>     /** The item whose destination the route currently shows, or null. */
>     activeItemId: string | null;
>     /**
>      * True while the user holds the app command modifier, when bb's own rows
>      * reveal their `shortcut` labels. Show yours at the same time.
>      */
>     isShortcutModifierHeld: boolean;
>     actions: ExperimentalSidebarNavigationActions;
> }

This is the same contract applied to sidebar destinations instead of threads, so a panel can be dragged into a pane as a destination in its own right. `activeItemId` answers a different question from the layout: which destination the route shows, which in a split is one of the panes. The doc comment does not say which one.

**What this means for the board:** `activeItemId` is the closest thing to "am I the focused thing on screen", and it answers for the route, not for a named pane.

### 1.4 The route, as app selection

**Quote** (`:20588-20592`):

> /** Current app selection, derived from the route. */
> interface BbContext {
>     projectId: string | null;
>     threadId: string | null;
> }

Two nullable ids and one sentence. The sentence is the whole contract: these come from the route, so they name the selection the URL represents, not every pane on screen.

**Quote** (`:20659-20660`, the hook that returns it):

>     useBbContext(): BbContext;

**What this means for the board:** with a thread open beside the board, `threadId` reports the thread because the route moved to it, so `threadId !== null` is a route fact and not evidence that the board lost its pane. The board's existing use of this hook to decide whether it is "covered" rests on an inference the declaration does not make.

### 1.5 Which panel and subPath you are

**Quote** (`:17650-17661`):

> /** Props passed to a `navPanel` component (it owns its whole route). */
> interface PluginNavPanelProps {
>     /**
>      * The route remainder after the panel root, "" at the root. The panel's
>      * route is `/plugins/<pluginId>/<path>/*`, so a deep link like
>      * `/plugins/notes/notes/work/ideas.md` renders the panel with
>      * `subPath: "work/ideas.md"`. Navigate within the panel via
>      * `useBbNavigate().toPluginPanel(path, { subPath })` — browser
>      * back/forward then walks panel-internal history.
>      */
>     subPath: string;
> }

A panel component receives one prop, the remainder of its own route. "It owns its whole route" is the load-bearing phrase: the panel is a destination, and the SDK describes no relationship between that destination and a pane.

**What this means for the board:** the board's `subPath` (`t/<threadId>` today) is a route fragment inside the panel, so it can be used to persist "which thread this panel is about" but not to claim a pane.

### 1.6 Fixed-tab targets

**Quote** (`:20564-20567`):

> /** The panel surface resolved by the component making the request. */
> type ExperimentalAppPanelSurface = {
>     kind: "current";
> };

**Quote** (`:20568-20586`):

> /**
>  * The owning fixed tab's current memory-only target. It survives tab, panel,
>  * and route remounts during the current app session, but is never persisted
>  * across a refresh. Call `clear` when the owner returns to its untargeted state.
>  */
> interface ExperimentalFixedTabTargetState<Target extends JsonValue$1> {
>     readonly sequence: number;
>     readonly target: Target;
>     clear(): void;
> }
> type ExperimentalOpenFixedTabOptions<Target extends JsonValue$1> = {
>     surface: ExperimentalAppPanelSurface;
>     tab: ExperimentalPluginFixedTabReference<Target>;
>     /** Omit to select the tab without replacing its current session target. */
>     target?: NoInfer<Target>;
> };
> /** Surface-aware controller for selecting owner-scoped fixed tabs. */
> interface ExperimentalAppPanel {
>     openFixedTab<Target extends JsonValue$1 = never>(options: ExperimentalOpenFixedTabOptions<Target>): boolean;
> }

The surface type has exactly one member, `{ kind: "current" }`, so a plugin always addresses the surface it is rendered in and never names a window, pane, or other surface. `openFixedTab` "selects" a tab and can hand it a target object that survives remounts for the session. `surface` exists to keep the request relative.

**What this means for the board:** if the board ever wants a tab in the host's own right panel, the surface is implied rather than chosen. There is no spelling of this call that says "open it in the other pane".

### 1.7 Viewport and compact

The SDK exposes no viewport hook. It passes a boolean in five prop bags (`experimental_sidebarNavigation`, `experimental_sidebarHeader`, `experimental_threadList`, `experimental_threadHeaderAction`, `experimental_browserToolbarAction`) and repeats it in three split-related sentences. Four of the five prop bags:

**Quote** (`:17932-17949`, `PluginThreadListProps`, abridged after `activeProjectId`; the interface continues with `onNavigate: () => void` and a deprecated `searchQuery`):

> interface PluginThreadListProps {
>     /** The thread the route currently shows; null on non-thread routes. */
>     activeThreadId: string | null;
>     /** The project the route currently shows; null when none is selected. */
>     activeProjectId: string | null;
>     /** True on phone-width viewports and coarse pointers. */
>     isCompactViewport: boolean;

**Quote** (`:17955-17969`, `PluginThreadHeaderActionProps`):

> interface PluginThreadHeaderActionProps {
>     /**
>      * The thread this header belongs to. Never null: the slot is not rendered
>      * on the compose screen or other non-thread routes. A split layout renders
>      * one header per pane, so the component mounts once per visible thread,
>      * each with its own id — keep per-thread state in the component, never in a
>      * module-level singleton.
>      */
>     threadId: string;
>     projectId: string;
>     /**
>      * True on phone-width viewports and coarse pointers. Collapse to an
>      * icon-sized control when it is true — the row is short.
>      */
>     isCompactViewport: boolean;
> }

**Quote** (`:17914-17927`, `ExperimentalSidebarHeaderProps`):

> interface ExperimentalSidebarHeaderProps {
>     /**
>      * Width in px of the space the component may use, updated when the sidebar
>      * resizes or the window chrome changes. It can be smaller than
>      * `controlSize` in a narrow sidebar.
>      */
>     width: number;
>     /**
>      * Width and height in px of the header's own buttons, equal to the
>      * `--bb-sidebar-control-size` CSS variable. Size your controls to match.
>      */
>     controlSize: number;
>     isCompactViewport: boolean;
> }

`isCompactViewport` is the SDK's whole notion of screen size: one boolean, true "on phone-width viewports and coarse pointers". The header props add `width` and `controlSize` in pixels, which are the only numeric window measurements in the surface, and their doc comment ties them to sidebar resize and window chrome. The split docs restate the same boolean as a gate: "False on compact viewports", "on compact viewports, and when splits are unavailable", "a single pane, a compact viewport, or splits disabled".

**Quote** (`:17999-18010`, `ExperimentalPluginBrowserToolbarActionProps`, the fourth bag with doc text):

> interface ExperimentalPluginBrowserToolbarActionProps {
>     /** Thread that owns the Browser tab. */
>     threadId: string;
>     /** Browser tab currently rendering the action. */
>     tabId: string;
>     /** Current top-level URL shown in the address bar. */
>     url: string;
>     /** True when the Browser chrome needs compact controls. */
>     isCompactViewport: boolean;
>     /** Script access to this tab's page; `null` outside the desktop app. */
>     experimental_page: ExperimentalPluginBrowserPage | null;
> }

The fifth, `ExperimentalSidebarNavigationProps`, declares the same field with no comment at all (abridged; the interface continues with a deprecated `experimental_Original` component):

**Quote** (`:17898-17907`):

> interface ExperimentalSidebarNavigationProps {
>     isCompactViewport: boolean;

The thread header comment carries the single most useful sentence in this group for a split-aware plugin: "A split layout renders one header per pane, so the component mounts once per visible thread".

**What this means for the board:** a nav panel receives no viewport prop at all, so the board cannot read `isCompactViewport` where it actually lives. Its only indirect signal is `useSidebarSplitLayout() === null`, which collapses three different causes into one.

### 1.8 The one sentence that makes panes first class

**Quote** (`:18297-18307`, `PluginNavPanelRegistration.fixedTabs`):

>     /**
>      * Ordered, non-closable tabs shown in this page's host-owned right panel.
>      * BB owns selection and persistence and always includes its native Browser
>      * and Terminal tools beside them. One tab is active in each visible split
>      * pane, so multiple fixed-tab components can be mounted concurrently. A
>      * component mounts only while its tab is active in a visible pane and the
>      * panel is open, and receives the same `subPath` as the page component.
>      *
>      * Experimental: see docs/api_to_audit.md.
>      */

One panel page, mounted several times concurrently, once per visible split pane. This is the only place a declaration says out loud that a page and its right panel are per-pane things.

**What this means for the board:** the board's page component can be mounted more than once at the same time in a split window, so anything it keeps in module scope (a subscription, a scroll position, a debounce) must survive two instances.

### 1.9 Where the SDK admits a window exists

**Quote** (`:18224-18233`, `ExperimentalAppOverlayRegistration`):

> /**
>  * Render app-wide plugin UI outside BB's layout regions.
>  *
>  * The host mounts each registration once per app window through the ordinary
>  * plugin React boundary. The component therefore keeps PluginContext, router,
>  * query, realtime, and other app-level SDK contexts when it renders fixed UI
>  * or creates a React portal. BB supplies no chrome, positioning, visibility,
>  * or interaction policy; the plugin owns those details and responsive
>  * behavior. Registrations are additive and a crash hides only that overlay.
>  */

"Once per app window" is a mount guarantee for one slot, not a state surface. The SDK uses the word window here to mean the OS-level window, which is also the sense in which the sidebar header "keeps dragging the window" on macOS.

**Quote** (`:19073-19079`, sidebar header, for the same word):

>  * Render a component in the sidebar's header row, between the sidebar toggle
>  * and bb's back and forward buttons. Exclusive: the user picks at most one
>  * header under Settings → Appearance, and by default the header shows only
>  * bb's own controls. Content is clipped to the row, so it cannot move the
>  * thread list or bb's controls. On macOS the empty space keeps dragging the
>  * window; buttons, links, and inputs do not.

**What this means for the board:** an app overlay mounts once per window, so it can count windows but cannot see panes. No declaration anywhere reports the window's size, position, or identity.

## 2. Window management: everything a plugin can do

Sixteen declarations and two CLI help pages describe operations. Order matters here: the first two are the ones that move a thread, and the rest either move something that is not a pane or describe a pane action without a caller.

### 2.1 Open a thread, with split placement

**Quote** (`:18876-18892`, the interface and the `open` method):

> /**
>  * Act on threads from a plugin surface. Every method routes to the host's own
>  * flow, so optimistic updates, toasts, dialogs, pane closing, and route repair
>  * behave exactly as they do in the built-in sidebar. Unknown thread ids are
>  * ignored by `open` and rejected by the rest.
>  */
> interface PluginSidebarThreadActions {
>     /**
>      * Navigate to a thread. `split: true` applies bb's split placement rules —
>      * a right split by default, focus when the thread is already open, replace
>      * at the pane cap — and falls back to plain navigation where splits are off.
>      * Opening also expands the thread's conversation if the secondary panel had
>      * collapsed it, as bb's own row does.
>      */
>     open(threadId: string, options?: {
>         split?: boolean;
>     }): void;

This is the documented way to open a thread with placement. Read it closely: the three placement rules are stated as what `split: true` "applies", and the fallback clause is about splits being off, not about there being no split yet. The method returns `void`, so a plugin gets no report of which branch ran. The interface comment adds that pane closing is one of the host behaviours inherited by every method here.

**What this means for the board:** this is the only call whose doc comment promises a right split. It does not promise that the first call makes the first split, and it cannot tell the caller what happened.

The same interface's other opening method takes no placement at all:

**Quote** (`:18893-18916`, `openNewThread`):

>     /**
>      * Go to the new-thread screen. Passing `projectId` also makes that project
>      * the composer's selection, so the thread is created where you asked.
>      * `sectionId` files the new thread under that section, and
>      * `environmentId` reuses that environment (the "New thread in
>      * environment" affordance), both exactly as bb's own list does.
>      * `experimental_placement` explicitly selects the section and pin state,
>      * overriding `sectionId`. Omitting placement starts unpinned, outside sections
>      * unless `sectionId` is supplied; previous composer placement is cleared.
>      * `hostId` selects a machine for a new environment when it
>      * is known and supports an environment provider. `environmentId` wins when
>      * both are supplied.
>      */
>     openNewThread(options?: {
>         projectId?: string;
>         sectionId?: string;
>         experimental_placement?: {
>             sectionId: string | null;
>             pinned: boolean;
>         };
>         environmentId?: string;
>         hostId?: string;
>         focusPrompt?: boolean;
>     }): void;

Six options and every one of them shapes composer state: project, section, placement, environment, host, prompt focus. The word "placement" here means section and pin placement, which is a naming collision with split placement and nothing more.

**What this means for the board:** a new-thread flow cannot ask for a pane. The only placement it can request is where the thread files in the sidebar.

### 2.2 Navigate without placement

**Quote** (`:20593-20605`, `BbNavigate.toThread` and `toPluginPanel`):

> interface BbNavigate {
>     toThread(threadId: string): void;
>     toProject(projectId: string): void;
>     /**
>      * Navigate to one of this plugin's own nav panels by its `path`.
>      * `subPath` targets a location inside the panel (the component's
>      * `subPath` prop); `replace` swaps the current history entry instead of
>      * pushing — use it for redirects so back does not bounce.
>      */
>     toPluginPanel(path: string, options?: {
>         subPath?: string;
>         replace?: boolean;
>     }): void;

`toThread` is declared with one argument and no doc comment. `toPluginPanel` takes a path, an optional subPath, and a history-replace flag, and its comment is entirely about history and deep links.

**Quote** (`:20596-20605`, continuing in the same interface, plus `toCompose`):

>     /**
>      * Navigate to the root compose surface (the new-thread screen). Pass
>      * `initialPrompt` to seed the composer draft (serialized thread, project,
>      * and section mention tokens become pills) and `focusPrompt` to focus the
>      * composer on arrival — the pairing behind "Create via chat" style entry
>      * points that drop the user into chat with a prefilled prompt.
>      */
>     toCompose(options?: {
>         initialPrompt?: string;
>         focusPrompt?: boolean;
>     }): void;

These navigate the route. None of them takes a placement, a pane, or a surface argument, and none returns anything.

**What this means for the board:** `toThread` is a plain route change. Any split behaviour observed from it is host behaviour the declarations do not document, and a plugin cannot rely on it surviving a version bump.

### 2.3 Open a side-panel tab (a different thing, described in pane words)

**Quote** (`:20617-20622`, `BbNavigate.openThreadPanel`):

>     /**
>      * Open one of this plugin's registered thread-panel actions in the current
>      * thread surface. Returns false when the surface has no thread side panel or
>      * the action is unavailable.
>      */
>     openThreadPanel(options: PluginTargetedPanelActionOpenOptions): boolean;

**Quote** (`:19169-19178`):

> /**
>  * What a caller that is *not* itself a panel action passes to open one — a
>  * `messageAction`'s `run`, or any component via `useBbNavigate()`. A panel
>  * action opening its own tab is already the target, so it passes the bare
>  * {@link PluginPanelActionOpenOptions} instead.
>  */
> interface PluginTargetedPanelActionOpenOptions extends PluginPanelActionOpenOptions {
>     /** A `threadPanelAction` id registered by this same plugin. */
>     actionId: string;
> }

This opens a tab in the thread's side panel. It is the nearest thing in the SDK to "put my surface next to a thread", and it is explicitly scoped to "the current thread surface", with a boolean decline instead of a placement.

**Quote** (`:18327-18342`, the shared options and the reason to read them together):

> /**
>  * What a plugin action passes when it asks the host to open one of its panel
>  * tabs. Shared by every `openPanel` entry point so a plugin registering more
>  * than one kind of action can write a single open routine;
>  * `PluginTargetedPanelActionOpenOptions` adds the `actionId` a caller
>  * outside a panel action must pass to name the panel it wants.
>  */
> interface PluginPanelActionOpenOptions {
>     /** Tab label. Default: the action's `title`. */
>     title?: string;
>     /**
>      * Persisted with the tab and handed to the component as its `params` prop.
>      * Must be a JSON value; anything else is a declined open.
>      */
>     params?: JsonValue$1;
> }

**What this means for the board:** the board can request a tab beside a thread by opening a panel tab in that thread's side panel. The reverse, asking a thread to appear beside the board, has no equivalent and is what section 4 is about.

### 2.4 Activate a navigation item, in a split or not

**Quote** (`:17805-17820`, abridged; the interface continues with `setVisible`, `setOrder`, `openCustomize`, `openDetails`, `disablePlugin`):

> /** How the host should activate a sidebar navigation item. */
> interface ExperimentalSidebarNavigationActivationOptions {
>     openInSplit: boolean;
> }
> /**
>  * Host behavior for sidebar navigation items (see
>  * {@link ExperimentalSidebarNavigationState}). Unknown item ids are ignored.
>  * Calls made after the calling component unmounts do nothing.
>  */
> interface ExperimentalSidebarNavigationActions {
>     /**
>      * Run the item's host behavior and close the mobile sidebar drawer.
>      * `openInSplit` is ignored where splits are unavailable, and disabled or
>      * loading items do nothing.
>      */
>     activate(itemId: string, options: ExperimentalSidebarNavigationActivationOptions): void;

This is the click path for destinations, and its split flag is mandatory rather than optional. The precondition is stated negatively: the flag is "ignored where splits are unavailable", and disabled or loading items do nothing. Unknown ids are ignored, and the method returns `void`, so again nothing is reported back.

**What this means for the board:** this is the documented way to put a panel destination into a split by click. It is reachable only from a component that renders the sidebar navigation slot, which the board does not own.

### 2.5 A panel item's drag request

The `splitProps` handler quoted in 1.3 is also the management surface: spreading it onto an element is how a plugin asks the host to start a split drag for a destination. The option bag that shapes the gesture:

**Quote** (`:17876-17887`):

> /** Options for {@link PluginSdkApp.experimental_useSidebarNavigationSplit}. */
> interface ExperimentalSidebarNavigationSplitOptions {
>     /**
>      * `sidebar` (the default) engages the drag once the pointer leaves the
>      * sidebar, so a row list with its own drag-to-reorder keeps working.
>      * `distance` engages after a short movement in any direction; use it for
>      * rows inside a menu or popover that covers the main area.
>      */
>     activation?: "distance" | "sidebar";
>     /** Called when the drag engages, for example to close the menu the row is in. */
>     onDragStart?: () => void;
> }

Two knobs, both about when the gesture starts and what to do at that instant. The drop rules themselves are the host's, restated in 1.2.

**What this means for the board:** `onDragStart` is the only callback in the entire split surface, and it fires when a drag begins, not when a layout changes.

### 2.6 The RPC pair, and the CLI that documents them

**Quote** (`bb-plugin-sdk-app.d.ts:17392-17400`, the argument shapes):

> interface ThreadOpenArgs {
>     threadId: string;
>     split?: ThreadOpenSplit;
>     file: ThreadOpenFile | null;
> }
> interface ThreadPaneActionArgs {
>     action: ThreadPaneAction;
>     threadId: string;
> }

**Quote** (`:14465-14472`, the placement vocabulary):

> declare const threadOpenSplitSchema: z$1.ZodEnum<{
>     down: "down";
>     left: "left";
>     replace: "replace";
>     right: "right";
>     top: "top";
> }>;
> type ThreadOpenSplit = z$1.infer<typeof threadOpenSplitSchema>;

**Quote** (`:14486-14493`, the pane action vocabulary):

> declare const threadPaneActionSchema: z$1.ZodEnum<{
>     "clear-spotlight": "clear-spotlight";
>     maximize: "maximize";
>     restore: "restore";
>     spotlight: "spotlight";
>     toggle: "toggle";
> }>;
> type ThreadPaneAction = z$1.infer<typeof threadPaneActionSchema>;

**Quote** (`:17541-17542`, how a plugin reaches them):

>     open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
>     paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;

Here is the honest state of the RPC route: the enums are named, and the methods themselves carry no doc comment at all. `split` is optional and takes four named edges plus `replace`; the action takes five verbs, none of them `close`. The result types resolve to `{ delivered: number }` (`:14482-14497`), which reports how many clients received the event rather than what the layout did.

The CLI help for the same operations is prose, and it is the only documentation that states the pane cap:

**Quote** (`bb thread open --help`, option `--split`):

>   --split <placement>  Open in right, down, left, top, or replace placement;
>                        edge placements add panes through pane 8, then replace
>                        the focused pane

**Quote** (`bb thread pane --help`):

> Usage: bb thread pane <maximize|restore|toggle|spotlight|clear-spotlight> [id] [options]
>
> Control an open thread pane in connected BB apps
>
> Arguments:
>   action      Pane action: maximize, restore, toggle, spotlight, or
>               clear-spotlight

**What this means for the board:** the RPC route covers split placement, maximize, spotlight, and restore, keyed by thread id. Nothing here closes a pane, and nothing names a pane.

### 2.7 The pane command vocabulary with no caller

**Quote** (`bb-plugin-sdk.d.ts:162-240`, the `command` field of `appKeybindingOverridesSchema`, abridged to the window-relevant members):

>     command: z$1.ZodUnion<readonly [z$1.ZodEnum<{
>         "app.back": "app.back";
>         ...
>         "pane.close": "pane.close";
>         "pane.focus.1": "pane.focus.1";
>         "pane.focus.2": "pane.focus.2";
>         ...
>         "pane.focus.down": "pane.focus.down";
>         "pane.focus.left": "pane.focus.left";
>         "pane.focus.next": "pane.focus.next";
>         "pane.focus.previous": "pane.focus.previous";
>         "pane.focus.right": "pane.focus.right";
>         "pane.focus.up": "pane.focus.up";
>         "pane.maximize.toggle": "pane.maximize.toggle";
>         "panel.close": "panel.close";
>         "panel.fullScreen.toggle": "panel.fullScreen.toggle";
>         "panel.newTab": "panel.newTab";
>         ...
>         "window.find": "window.find";
>         "window.new": "window.new";
>         "workspace.openPreferred": "workspace.openPreferred";
>     }>, z$1.ZodTemplateLiteral<`plugin:${string}/${string}`>]>;

**Quote** (`:255`, the type the schema feeds):

> type AppKeybindingOverrides = z$1.infer<typeof appKeybindingOverridesSchema>;

The host has a full window vocabulary: close a pane, focus by number or direction, toggle maximize, close and fullscreen a panel, open a new window, find in the window. In the declarations this appears exactly once, as the accepted values of a keybinding override, which is how a user rebinds a command. There is no `executeCommand`, `runCommand`, or `invokeAppCommand` anywhere in either declaration file.

**What this means for the board:** the vocabulary that would answer "close the pane" and "focus the next pane" exists as bindable names. A plugin can see the names and cannot run them.

### 2.8 What a plugin can trigger indirectly

**Quote** (`:18921-18928`, `archive` and `requestDelete`):

>     /** Confirms before including child threads unless archive confirmation is disabled in Settings → General. */
>     archive(threadId: string): void;
>     /**
>      * Opens bb's delete confirmation, which counts child threads first. Deletion
>      * is destructive and recursive, so the host owns the confirmation: there is
>      * deliberately no silent `delete`.
>      */
>     requestDelete(threadId: string): void;

Archive and delete route to the host's own flow, and the interface comment says that flow includes "pane closing". So the one documented way a plugin can cause a pane to close is to archive the thread that pane shows, with the confirmation and dialog that implies.

**What this means for the board:** closing a thread's pane from the board is an archive side effect, not a pane operation. It closes a pane only if the host decides it should.

## 3. The gap, stated plainly

Four absences, then two related ones, each with the sentence that makes it an absence.

### 3.1 A pane count at one pane

The layout hook returns `null` "when nothing is split", and the interface comment spells that as "or null when there is no split (a single pane, a compact viewport, or splits disabled)". There is no declaration that returns the number of panes, and no way to distinguish one pane from splits being off. The harness agrees with the null default: "The split layout `useSidebarSplitLayout()` reports. Omitted → null." (`bb-plugin-sdk-testing-app.d.ts:331-332`).

The per-row variant is not a workaround: its `layout` is "null when it is not open in one (including single-pane layouts)", so it too reports nothing at one pane.

**The declarations are silent on a pane count at one pane.** What they give instead is a count of known threads-in-panes, which is zero at one pane and also zero when the only pane holds the board.

### 3.2 A way to create the first split by click

Three sentences bound what the click paths promise. `open` "applies bb's split placement rules ... and falls back to plain navigation where splits are off". `activate` says "`openInSplit` is ignored where splits are unavailable". The drag handler is "empty when splits are unavailable, so spreading it is always safe".

All three describe what happens when splits are unavailable. None describes what happens when splits are available and only one pane exists. There is no declaration for a named "split state" that a plugin can request, and no return value on any of the three that would distinguish "split created" from "pane replaced".

**The declarations are silent on creating the first split.** The closest sentence is the placement phrase "a right split by default", which describes where content goes, not whether a split happens.

### 3.3 A way to close or replace a named pane

`paneId` appears exactly twice in `bb-plugin-sdk-app.d.ts`, both times as a field of a read-only state shape (`:18963` and `:18984`). `isFocused` appears twice, also read-only. No declaration anywhere accepts a pane id, and no method on any action object names a pane.

The management surface is keyed by thread instead. `threads.paneAction` takes `threadId` and one of five verbs, none of which closes anything. `bb thread pane --help` lists the same five. The only "replace" in the surface is a placement value, `ThreadOpenSplit`'s `replace`, and `pane.close` exists only as a keybinding name a user can rebind.

**The declarations are silent on closing or replacing a named pane.** Replacement exists in one direction only: open content into the focused pane.

### 3.4 A way to be told when a layout changed

The only subscription promise is the layout hook's "One subscription for the whole list." There is no event, no callback, and no subscribe method on the split surface. The per-row split type documents no update behaviour at all, and the one callback anywhere in the split surface (`onDragStart`) fires when a gesture starts.

So a plugin can be re-rendered with a fresh layout, and it cannot be told that a layout change happened or what caused it. Distinguishing "the user closed the board's pane" from "the user opened a thread in the focused pane" is left to diffing snapshots inside a component.

**The declarations are silent on layout change notification.** A re-render carrying new values is the whole of the contract.

### 3.5 Two related absences worth naming

- **No self-pane identity.** `PluginSidebarSplitPane.isMe` means "This pane holds the thread the row represents". For a nav panel there is no row and no equivalent flag, so the board cannot learn its own `paneId` from the state surface.
- **No programmatic focus or maximize by pane.** Focus is a read-only boolean and maximize is a thread-keyed RPC. `useBbContext().threadId` names the route's thread, which is the focused pane's thread, so a plugin can infer focus after the fact and cannot set it.

## 4. The operator's question, answered from the docs

The question: with the board running in a plugin panel, what is the documented, supported route to open a thread beside the board in a native pane as the window's first split?

### 4.1 What the documentation does answer

One call is documented for opening a thread with placement, and one RPC matches it:

- `experimental_useSidebarThreadActions().open(threadId, { split: true })`, quoted in full in 2.1. Its promise is "`split: true` applies bb's split placement rules — a right split by default, focus when the thread is already open, replace at the pane cap — and falls back to plain navigation where splits are off."
- `threads.open({ threadId, split: "right", file: null })`, whose argument type and `ThreadOpenSplit` values are quoted in 2.6, and whose CLI help says edge placements "add panes through pane 8, then replace the focused pane".

Those two sentences together are the documented answer to "how do I split", and "a right split by default" is the documented answer to "where does it go".

### 4.2 What the documentation does not answer

The question has a specific word in it: **first**. The declarations say nothing about the transition from one pane to two. Three facts make that silence checkable rather than a matter of reading care:

1. The state hook defines one pane as `null` and its doc comment groups "a single pane, a compact viewport, or splits disabled" into one value, so there is no documented notion of "one pane that could become two".
2. The one call that would create the split returns `void` and is documented only in terms of what it "applies".
3. The CLI, which is more forthcoming than the declarations, documents the pane cap and the replace rule and still says nothing about the state of the window before the first edge drop.

**The declarations do not answer the first-split question.** That is a documentation gap, not an inference I am declining to make.

### 4.3 The closest documented behaviours, ranked by how much they promise

1. **`open(threadId, { split: true })`.** Documented placement rules, no return value, no statement about the one-pane case. This is the call to use, and it is what the earlier study in `docs/plans/2026-11-17-native-thread-pane.md` also landed on.
2. **`threads.open` with `split: "right"`.** The same operation one layer down, with the CLI adding the cap and the replace rule. Available to a plugin as `useRpc()`, and reachable from outside the app entirely.
3. **`activate(itemId, { openInSplit: true })`.** For destinations rather than threads, reachable only from the sidebar navigation slot, with the same one-pane silence.
4. **`splitProps` drag.** The host's gesture, documented down to the drop rules, available only on a row the plugin renders.

### 4.4 The ambiguity, and what the host shows, kept separate

The ambiguity: "a right split by default" can be read as "it always splits to the right" or as "when it splits, it splits to the right". The declarations permit both readings.

What the host shows, as corroboration rather than documentation. In `index-UJHlXnMg.js` (0.49.0), the persisted layout store is `bb.splitLayout`, initialized to `null`. The placement function is short enough to read whole:

```js
function VP(e,t,n){if(e===null)return MP(t);let r=ON(e.root,t.projectId,t.threadId),i=_P({zone:BP(n),threadAlreadyOpen:r!==null,atMaxPanes:EN(e.root)>=8});if(r!==null)return e.focusedPaneId===r.paneId?e:GN(e,r.paneId);let a=jP(t);return i.zone===`center`?IN(e,e.focusedPaneId,a):FN(e,e.focusedPaneId,i.zone,a)}
```

with the decision table it calls:

```js
function _P({zone:e,threadAlreadyOpen:t,atMaxPanes:n}){return t?{zone:`center`,label:`Already open — focus pane`}:n?{zone:`center`,label:`Replace this chat`}:{zone:e,label:e===`center`?`Replace this chat`:`Split ${e}`}}
```

Read together: a `null` layout is materialized as a single pane holding the requested content (`MP`), the 8-pane cap sends the request to `center`, and `center` means replace the focused pane (`IN`). The plugin-facing view of the same store returns null unless there is more than one pane.

That is what the words "falls back to plain navigation where splits are off" do in practice, and it explains why the declarations never promise a first split: at the moment of the request, if no layout exists, there is nothing to split and the request becomes a one-pane layout. Two limits on this paragraph: it is host behavior at 0.49.0, and the declarations are free to describe it differently at any version.

### 4.5 The call that looks right and is not declared

`useBbNavigate().toThread` is declared as `toThread(threadId: string): void`, with no second parameter (`:20594`). The installed host's implementation accepts an options bag with a split flag. Plugins that pass one are compiling against nothing: a type error in this repo, and an undocumented behaviour everywhere else.

**What this means for the board:** if the board ever needs to open a thread beside itself, `open(threadId, { split: true })` is the declared call and `toThread` with options is not. The board already calls the actions hook elsewhere, so the declared route costs one argument, not a new dependency.

## 5. Quotation inventory

Thirty-five declarations quoted, in two groups, plus two CLI help pages. The count is of declarations; a few are quoted across more than one block (a type and its hook, or an argument shape and its vocabulary), so the document carries more quote blocks than rows below.

| Group | Count | Declarations |
|---|---|---|
| 1. Window and pane state | 19 | `PluginSidebarSplitLayout`, `PluginSidebarSplitPane`, `useSidebarSplitLayout`, `PluginSidebarThreadSplit`, `ExperimentalSidebarNavigationSplit`, `ExperimentalSidebarNavigationState`, `BbContext`/`useBbContext`, `PluginNavPanelProps`, `ExperimentalAppPanelSurface`, `ExperimentalFixedTabTargetState`, `ExperimentalOpenFixedTabOptions`, `ExperimentalAppPanel`, `PluginThreadListProps`, `PluginThreadHeaderActionProps`, `ExperimentalSidebarHeaderProps`, `ExperimentalPluginBrowserToolbarActionProps`, `ExperimentalSidebarNavigationProps`, `PluginNavPanelRegistration.fixedTabs`, `ExperimentalAppOverlayRegistration` |
| 2. Window management | 16 | `PluginSidebarThreadActions` (interface comment), `open`, `openNewThread`, `archive`/`requestDelete`, `BbNavigate.toThread`, `toPluginPanel`, `toCompose`, `openThreadPanel`, `PluginTargetedPanelActionOpenOptions`, `PluginPanelActionOpenOptions`, `ExperimentalSidebarNavigationActivationOptions`/`activate`, `PluginSidebarThreadSplit.splitProps` (as a request), `ExperimentalSidebarNavigationSplitOptions`, `ThreadOpenArgs`/`ThreadOpenSplit`, `ThreadPaneActionArgs`/`ThreadPaneAction`, `AppKeybindingOverrides` pane command ids |
| CLI documentation | 2 pages | `bb thread open --help` (`--split`), `bb thread pane --help` (five actions) |

Absences recorded, each with its supporting sentence: a pane count at one pane (3.1), creating the first split by click (3.2), closing or replacing a named pane (3.3), being told when a layout changed (3.4), self-pane identity and programmatic focus (3.5).

## 6. Source citations

- `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts` at 0.6.19. Declarations cited inline, by first line: 14465, 14482, 14486, 17392, 17541, 17650, 17805, 17840, 17853, 17876, 17898, 17914, 17932, 17955, 17999, 18224, 18297, 18327, 18876, 18893, 18921, 18961, 18963, 18974, 18982, 18984, 18996, 19015, 19073, 19169, 20564, 20568, 20588, 20593, 20594, 20596, 20617, 20659, 20786.
- `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` at 0.6.19: `appKeybindingOverridesSchema` at 162-254, `AppKeybindingOverrides` at 255.
- `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-testing-app.d.ts` at 0.6.19: `sidebarSplitLayout` harness option at 331-332.
- Installed host, bb 0.49.0: `/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/app/dist/assets/index-UJHlXnMg.js`. Functions quoted in 4.4: the split store `nP` (`Mt(KN, null, tP(), {getOnInit:true})`, where `KN` is the string `bb.splitLayout`), the plugin-facing view `rP` (`mt(e=>{let t=e(nP);return t!==null&&EN(t.root)>1?t:null})`), the placement function `VP`, the decision table `_P`, the pane builders `MP`/`NP`/`FN`/`IN`, the pane counter `EN`, and the pane action reducer `HP`. Also `plugin-frontend-0dkOuthv.js`: the plugin-facing layout view `oP`, which returns `null` when the root has fewer than two entries, the compact wrapper `sP` that returns `null` on compact viewports, and the unavailable-splits fallback `cP = {splitProps:{},isAvailable:false,layout:null}`.
- CLI: `bb thread open --help` and `bb thread pane --help` as printed by the installed `bb`.

The declarations in this checkout live in the main checkout's `node_modules` (the focused worktree has no install), read at `@get-bb/plugin-sdk` 0.6.19, which is the version `package.json` declares.

> AGENT GENERATED CONTENT
