import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ThreadChat,
  useBbNavigate,
  useRpc,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeWakeAt } from "@/lib/snooze";
import type { SnoozeMenuAction } from "@/lib/snooze";
import { PendingInteractionCard } from "@/components/pending-interaction-card";
import { DecidedQuestionsCard } from "@/components/decided-questions-card";
import {
  isExternalHref,
  workspacePathFromHref,
} from "@/components/chat-link-intercept";
import type { PaneContextInfo } from "@/lib/pane-context";
import {
  decorateVerifiedInlineCodeLinks,
  decoratedCodePath,
  type PathExistenceChecker,
} from "@/components/decorate-inline-code";
import {
  decorateReferenceMentions,
  decoratedReferencePaneTarget,
  type ReferenceMentions,
} from "@/components/decorate-reference-mentions";
import type { rpcContract } from "@/server";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  createChatClickJumpGuard,
  type ChatClickJumpGuard,
} from "@/components/chat-jump-guard";
import { attachScrollDebug } from "@/components/scroll-debug";
import { AutotitleFallbackModal } from "@/components/autotitle-fallback-modal";
import { WorkspaceOpenMenu, OPEN_LABEL_MIN_PANE_WIDTH } from "@/components/workspace-open-menu";
import { usePaneContextRowMissing, PaneContextRow } from "@/components/pane-context-row";
import { HEADER_ICON_BUTTON_CLASS } from "@/lib/pane-chrome";
import type {
  AutotitleFallbackState,
  AutotitleTarget,
} from "@/lib/autotitle";
// The header buttons share lib/pane-chrome's class so the workspace-open
// menu can render matching buttons without importing this module back.

const PANE_WIDTH_KEY = "focus-board:paneWidth";
const PANE_MIN_WIDTH = 320;
const PANE_MAX_WIDTH = 900;
const PANE_DEFAULT_WIDTH = 480;

/** The narrowest panel row that still hosts the board and the side-by-side
 *  pane together. At or below this measured row width the pane covers the
 *  board as a sheet. Measured on the pane's row itself — the plugin
 *  panel inside the host — not the window: a desktop bb window can squeeze
 *  the panel far below any window media query, and the stored pane width
 *  (480px on a 250px panel) would otherwise overrun the panel edge. */
export const PANE_SHEET_MAX_PANEL_WIDTH = 640;

/** The board margin the side-by-side pane must leave for the board's lanes:
 *  1.25 lanes of 256px (the lane width in `components/board.tsx`). Above the
 *  sheet threshold a pane dragged wider than the row minus this floor would
 *  squeeze the board column below its toolbar's min-content width, and the
 *  board's chrome (toolbar controls, lane headers) then paints past the board's
 *  own edge — over the pane when a wallpaper makes the board column a z-10
 *  stacking context, and flush against the pane's seam otherwise. The pane
 *  stops at the floor instead, so the board always keeps a lane and a quarter
 *  of room. */
export const PANE_BOARD_LANE_FLOOR = 320;

/**
 * Debounce window for the pane's Escape handling (see the keydown effect in
 * ThreadPane). Matches the OS double-click convention (~500 ms): wide enough
 * to cover a double-tap aimed at stopping a running thread, narrow enough
 * that a deliberate "stop, read the result, then close" pair — pressed
 * seconds apart — still goes through.
 */
const ESCAPE_DEBOUNCE_MS = 500;

function readStoredPaneWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANE_WIDTH_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, value));
      }
    }
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return PANE_DEFAULT_WIDTH;
}

/** What the pane needs from a thread; archived rows come from the SDK list. */
export interface ThreadPaneThread {
  id: string;
  displayTitle: string;
  status: PluginSidebarThread["status"];
  isUnread: boolean;
  /** Drives the actions menu's Pin/Unpin entry, the card menu's wording. */
  isPinned: boolean;
  /**
   * The thread's app-relative URL (the sidebar row's href) for the open
   * menu's "Open in browser" and "Copy thread link" destinations.
   */
  href: string;
  /**
   * Project + checkout facts (lib/pane-context) backing the composer-context
   * fallback row: null when the thread has no environment to describe
   * (archived rows, provisional spawns) — the same threads bb's own page
   * shows no context row for. Absent means the same, so older call shapes
   * stay quiet rather than flash a wrong line.
   */
  context?: PaneContextInfo | null;
}

interface ThreadPaneProps {
  thread: ThreadPaneThread;
  isArchived: boolean;
  isDone: boolean;
  onToggleDone: (done: boolean) => void;
  onToggleArchived: () => void;
  onTogglePinned: () => void;
  onToggleUnread: () => void;
  onRename: (title: string) => Promise<void>;
  onMaximize: () => void;
  onClose: () => void;
  /**
   * The open thread's controlled browser-tab reveal, the one-step gesture
   * the board card menu carries (lib/browser-reveal). Offered in the
   * workspace-open dropdown's thread group; outcome reporting rides the
   * board banner the caller wires up. Optional: absent leaves the menu
   * without the entry (render sites with no banner to report on).
   */
  onRevealBrowserTab?: () => void;
  /**
   * Snooze entries for the "More thread actions" menu, already resolved for
   * the open thread: "Snooze…" while unsnoozed, "Edit snooze…" while snoozed
   * (lib/snooze `snoozeMenuActions`). The runs call
   * the same RPC-backed snooze handlers the cards use. Optional: absent or
   * empty leaves the menu exactly as before this prop existed.
   */
  snoozeMenuItems?: readonly (SnoozeMenuAction | ActionMenuItem)[];
  /**
   * Opens the board's new-thread composer preset to spawn a child of THIS
   * pane's thread (the "New child thread…" entry in the actions menu).
   * Optional: absent when the board cannot open the composer, leaving the
   * menu exactly as before this prop existed.
   */
  onNewChildThread?: () => void;
  /**
   * The open thread's wake time (epoch ms) while it is snoozed, null/absent
   * otherwise. Drives the header's muted "Snoozed · wakes …" chip, so the
   * open pane says the state the card already carries.
   */
  snoozeWakeAt?: number | null;
  /**
   * Escape behavior (the "Esc stops running thread" toolbar toggle): when
   * true, Escape stops a running thread and only closes the pane when the
   * thread is not running; when false, Escape always closes the pane.
   */
  escStopsRunningThread: boolean;
  /**
   * Wiring for the pane's reference chips (issue #161): the paint pass
   * converts agent-written `@thread:`/`@project:` tokens — and the host's
   * own empty mention elements — into labeled chips inside the embedded
   * chat, and `onOpen` decides their routing (the board's thread pane for a
   * thread it lists, bb's main thread/project view otherwise). Optional:
   * absent, the pane keeps the host's rendering untouched.
   */
  referenceMentions?: ReferenceMentions;
  /**
   * True while an overlay above the pane (the new-thread composer modal)
   * owns Escape. This pane's Escape listener is a capture-phase document
   * listener, so it would otherwise win the race against the overlay's own
   * handling and close the pane — or stop the thread — underneath the modal.
   */
  escapeSuppressed?: boolean;
}

interface ActionMenuItem {
  id: string;
  label: string;
  icon: string;
  run: () => void;
  /** The snooze entries arrive grouped: a divider above the group's head. */
  dividerAbove?: boolean;
}

/** Exported for the ✨ auto-rename editor tests; ThreadPane renders it. */
export function EditableTitle({
  title,
  onRename,
  onAutotitle,
  loadFallbackServices,
}: {
  title: string;
  onRename: (title: string) => Promise<void>;
  /**
   * The ✨ auto-rename: ask the server for a generated title (thread_autotitle)
   * and commit the rename with it. Absent on surfaces without the bridge —
   * the SDK type is what carries it; the button only renders when wired.
   */
  onAutotitle?: (target?: AutotitleTarget) => Promise<string>;
  /**
   * The fallback modal's menu (server.ts thread_autotitle_services): the
   * registered thread-title services plus the current selection. Optional —
   * the modal still names the failure and takes a manual rename without it.
   */
  loadFallbackServices?: () => Promise<AutotitleFallbackState>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  /**
   * In-flight / failed state of the ✨ request. Failure keeps the editor
   * open with the error named on the button (retry on the next click) —
   * a failed generation never commits anything.
   */
  const [autotitle, setAutotitle] = useState<
    { phase: "idle" } | { phase: "running" } | { phase: "failed"; message: string }
  >({ phase: "idle" });
  /** The fallback modal: auto-opens on a failed generation, ⚠️ reopens it. */
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set by cancel/commit so a late ✨ reply cannot rename a closed editor. */
  const sessionDoneRef = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      sessionDoneRef.current = false;
      setAutotitle({ phase: "idle" });
      setFallbackOpen(false);
    }
  }, [editing]);

  const commit = useCallback(
    (next?: string) => {
      const trimmed = (next ?? draft).trim();
      if (trimmed !== "" && trimmed !== title) {
        void onRename(trimmed).catch(() => {});
      }
      // The editor is gone; any in-flight ✨ reply must not rename afterwards.
      sessionDoneRef.current = true;
      setEditing(false);
    },
    [draft, title, onRename],
  );

  const cancel = useCallback(() => {
    sessionDoneRef.current = true;
    setDraft(title);
    setEditing(false);
  }, [title]);

  const runAutotitle = useCallback(
    (target?: AutotitleTarget) => {
      if (onAutotitle === undefined || autotitle.phase === "running") return;
      sessionDoneRef.current = false;
      setAutotitle({ phase: "running" });
      onAutotitle(target)
        .then((generated) => {
          if (sessionDoneRef.current) return;
          setDraft(generated);
          commit(generated);
        })
        .catch((error: unknown) => {
          if (sessionDoneRef.current) return;
          setAutotitle({
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
          // A failure must not be a silent ⚠️: the modal names the reason
          // and offers the ways out (other services, manual rename).
          setFallbackOpen(true);
        });
    },
    [onAutotitle, autotitle.phase, commit],
  );

  /** Manual title from the fallback modal — same commit path as typing. */
  const renameManually = useCallback(
    (value: string) => {
      setFallbackOpen(false);
      commit(value);
    },
    [commit],
  );

  if (!editing) {
    return (
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left hover:bg-accent"
        title="Rename thread"
        onClick={(event) => {
          event.stopPropagation();
          setDraft(title);
          setEditing(true);
        }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      </button>
    );
  }
  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        // Blur commits, except when the blur is the ✨ click: the button
        // prevents default on mousedown, so the input keeps focus and the
        // generated rename is the only commit the gesture produces. While
        // the fallback modal is open the modal itself owns the gesture, so
        // the blur it causes must not close the editor out from under it.
        onBlur={() => {
          if (fallbackOpen) return;
          commit();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
        className="w-full min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 pr-7 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-ring"
        aria-label="Thread title"
      />
      {onAutotitle !== undefined ? (
        <button
          type="button"
          disabled={autotitle.phase === "running"}
          aria-label={
            autotitle.phase === "failed"
              ? `Auto-rename failed, click for options: ${autotitle.message}`
              : "Auto-rename from the thread prompt"
          }
          title={
            autotitle.phase === "failed"
              ? `Auto-rename failed, click for options: ${autotitle.message}`
              : "Auto-rename from the thread prompt"
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            // A failed generation is the modal's job now; ✨ regenerates.
            if (autotitle.phase === "failed") setFallbackOpen(true);
            else runAutotitle();
          }}
          className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-sm leading-none hover:bg-accent disabled:opacity-60"
        >
          {autotitle.phase === "running" ? (
            <Icon name="Spinner" className="size-3 animate-spin" aria-hidden />
          ) : autotitle.phase === "failed" ? (
            <span aria-hidden>⚠️</span>
          ) : (
            <span aria-hidden>✨</span>
          )}
        </button>
      ) : null}
      {fallbackOpen ? (
        <AutotitleFallbackModal
          open={fallbackOpen}
          onOpenChange={setFallbackOpen}
          message={autotitle.phase === "failed" ? autotitle.message : ""}
          load={loadFallbackServices}
          onPick={(target) => {
            setFallbackOpen(false);
            runAutotitle(target);
          }}
          onManualTitle={renameManually}
        />
      ) : null}
    </div>
  );
}

function ActionsMenu({
  items,
  attached = false,
}: {
  items: readonly ActionMenuItem[];
  /**
   * Attached mode: the trigger is the right half of a split control (a
   * caret beside a labeled primary — the same grammar as the open menu),
   * so it renders no wrapper of its own; the split wrapper positions the
   * menu. Standalone mode keeps its own positioned wrapper and the 28px
   * ellipsis button — without the wrapper the absolutely-positioned menu
   * would anchor to the pane instead of dropping under the button.
   */
  attached?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const control = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={
          attached
            ? "h-7 w-7 shrink-0 rounded-l-none px-0 text-muted-foreground hover:text-foreground max-md:pointer-coarse:size-9"
            : HEADER_ICON_BUTTON_CLASS
        }
        aria-label="More thread actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={attached ? "ChevronDown" : "More"} className={attached ? "size-3" : "size-4"} />
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            aria-label="More thread actions"
            className="absolute right-0 top-8 z-50 min-w-40 rounded-md border border-border bg-popover p-1 shadow-md"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.run();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent",
                  item.dividerAbove && "mt-1 border-t border-border pt-2",
                )}
              >
                <Icon
                  name={item.icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
  if (attached) return control;
  return <div className="relative">{control}</div>;
}

export function ThreadPane({
  thread,
  isArchived,
  isDone,
  onToggleDone,
  onToggleArchived,
  onTogglePinned,
  onToggleUnread,
  snoozeMenuItems,
  onNewChildThread,
  snoozeWakeAt = null,
  onRename,
  onMaximize,
  onClose,
  onRevealBrowserTab,
  escStopsRunningThread,
  escapeSuppressed = false,
  referenceMentions,
}: ThreadPaneProps) {
  const [width, setWidth] = useState(readStoredPaneWidth);
  const windowCompact = useIsCompactViewport();
  // A squeezed panel on a desktop window: the compact media query never
  // fires there (the window is wide), so the side-by-side pane stayed
  // alive and the stored pane width overran the panel — the board flexed
  // away and the pane's header painted past the panel edge (reproduced in
  // docs/screenshots/repro-narrow-panel/). The pane measures its row (the
  // plugin panel inside the host) the way the toolbar band measures
  // itself; ResizeObserver is guarded because jsdom has none.
  const paneRef = useRef<HTMLElement | null>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  useEffect(() => {
    const pane = paneRef.current;
    const row = pane?.parentElement;
    if (pane === null || row === undefined || row === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? row.clientWidth;
      setPanelWidth(width);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const panelNarrow = panelWidth !== null && panelWidth < PANE_SHEET_MAX_PANEL_WIDTH;
  const isCompact = windowCompact || panelNarrow;
  // The sheet anchors to the PLUGIN PANEL (absolute within it), never the
  // window: the narrowness here is the panel's, not the host's — the
  // host's own chrome (sidebar, chat) must stay visible, unlike the true
  // mobile path, whose fixed sheet covers the phone's whole window.
  const panelScopedSheet = panelNarrow && !windowCompact;
  // A stored pane width can exceed the panel (a wide pane stored on a
  // wider panel that later narrowed): clamp to the measured row so the
  // pane can never jut past the panel edge. Above the sheet threshold the
  // pane also stops PANE_BOARD_LANE_FLOOR short of the row, so the board
  // behind it keeps 1.25 lanes of room and its chrome never runs out of
  // width and paints over the pane (see the constant's comment).
  const boardFloor = panelWidth === null ? 0 : Math.max(0, panelWidth - PANE_BOARD_LANE_FLOOR);
  const effectiveWidth =
    panelWidth === null ? width : Math.min(width, boardFloor, panelWidth);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  // The developer scroll instrumentation (setting "Developer: instrument
  // pane chat scrolling (debug)") is read here instead of threaded through
  // a prop: its only remaining output is console-side, so no caller needs
  // to know about it.
  const scrollDebug = useSettings().values?.scrollDebugInstrumentation === true;
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(
    null,
  );
  const edgeRef = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragStateRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // The pane hugs the right edge, so dragging left grows it.
    const delta = drag.startX - event.clientX;
    const next = Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, drag.startWidth + delta));
    setWidth(next);
  }, [setWidth]);

  // The host's embedded ThreadChat renders markdown links with their raw
  // destination, so a message like `[ERD](docs/erd.mmd)` becomes an anchor
  // the browser resolves against the bb app's origin — an error page. The
  // host's own thread view owns message link routing; this pane does not.
  // Capture clicks on relative anchors here and reopen them as live files
  // against the thread's environment instead. The same routing gap also
  // hides the host's inline-code file links (see the decoration effect
  // below), so inline code that names a workspace markdown file is claimed
  // here too.
  const openWorkspacePreview = useCallback(
    (path: string) => {
      void sdk.threads
        .get({ threadId: thread.id })
        .then((result) => {
          const environmentId =
            "environmentId" in result ? result.environmentId : null;
          if (environmentId === null) return;
          navigate.experimental_openFilePreview({
            target: { kind: "workspace", environmentId, path },
            location: null,
          });
        })
        .catch(() => {
          // Without a resolvable environment there is nothing better to do;
          // swallowing keeps the dead click from also being an error page.
        });
    },
    [sdk, navigate, thread.id],
  );

  const onChatClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // A reference chip (issue #161) claims its click outright: the chip's
      // own routing (referenceMentions.onOpen) decides where the target
      // opens — the pane for a listed thread, bb's main view otherwise —
      // and nothing underneath the chip runs (no anchor navigation, no
      // workspace preview on a stray wrapped code span). The chip is either
      // the painted button or the repainted host mention element.
      const reference = decoratedReferencePaneTarget(target);
      if (reference !== null && referenceMentions !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        referenceMentions.onOpen(reference);
        return;
      }
      // Explicit markdown links win; code spans are only claimed when no
      // anchor is involved.
      const anchor = target.closest("a[href]");
      if (anchor !== null) {
        const href = anchor.getAttribute("href") ?? "";
        if (href === "" || isExternalHref(href)) return;
        const path = workspacePathFromHref(href);
        if (path === null) return;
        event.preventDefault();
        event.stopPropagation();
        openWorkspacePreview(path);
        return;
      }
      const code = target.closest("code");
      if (code === null || code.closest("pre") !== null) return;
      // Only verified paths claim clicks: the decorator flags a code span
      // after its path checked out against the workspace, so unverified or
      // missing files stay inert instead of opening a dead preview.
      const path = decoratedCodePath(code);
      if (path === null) return;
      event.preventDefault();
      event.stopPropagation();
      openWorkspacePreview(path);
    },
    [openWorkspacePreview, referenceMentions],
  );

  const endDrag = useCallback((event: PointerEvent) => {
    const drag = dragStateRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    dragStateRef.current = null;
    try {
      window.localStorage.setItem(PANE_WIDTH_KEY, String(width));
    } catch {
      // Best effort only; the pane still works without persistence.
    }
  }, [width]);

  useEffect(() => {
    const edge = edgeRef.current;
    if (edge === null) return;
    const startDrag = (event: PointerEvent) => {
      // The baseline is the RENDERED width (effectiveWidth), not the stored
      // one: when the row's board floor clamps a stored wide pane, the edge
      // under the pointer sits at the clamp, and a stored-width baseline would
      // swallow the first drag step before the pane moved.
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: effectiveWidth,
      };
      edge.setPointerCapture(event.pointerId);
    };
    edge.addEventListener("pointerdown", startDrag);
    edge.addEventListener("pointermove", onPointerMove);
    edge.addEventListener("pointerup", endDrag);
    edge.addEventListener("pointercancel", endDrag);
    return () => {
      edge.removeEventListener("pointerdown", startDrag);
      edge.removeEventListener("pointermove", onPointerMove);
      edge.removeEventListener("pointerup", endDrag);
      edge.removeEventListener("pointercancel", endDrag);
    };
  }, [width, effectiveWidth, onPointerMove, endDrag]);

  // Double-tap debounce state for the pane's Escape handling. A ref, not
  // effect-local: the keydown effect re-runs whenever the thread's status
  // flips (active → stopping → idle) and the window must survive those
  // re-subscriptions; a remount (pane reopened) starts fresh. Only real
  // actions — a stop or a close — arm it.
  const lastEscapeActionAtRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // An overlay above the pane owns Escape (see escapeSuppressed).
        if (escapeSuppressed) return;
        // Inline editors (rename) consume Escape to cancel the edit; let them.
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          return;
        }
        // Held-key auto-repeat is never a deliberate second gesture.
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        const now = Date.now();
        if (now - lastEscapeActionAtRef.current < ESCAPE_DEBOUNCE_MS) {
          // Inside the double-tap window: swallow the press — still claiming
          // Escape so no other surface acts on the doubled key — without
          // extending the window.
          event.preventDefault();
          return;
        }
        if (escStopsRunningThread) {
          // bb sorts "starting", "active", and "stopping" as busy threads.
          // Escape interrupts the running turn first — closing the pane
          // while the agent still runs would feel like the stop did
          // nothing — and only closes once nothing is running. "stopping"
          // means a stop is already in flight; keep the pane open until it
          // settles so the result stays visible.
          if (thread.status === "active" || thread.status === "starting") {
            event.preventDefault();
            lastEscapeActionAtRef.current = now;
            void sdk.threads.stop({ threadId: thread.id }).catch(() => {});
            return;
          }
          if (thread.status === "stopping") {
            // Holding the pane open is not an action; it does not arm the
            // debounce window.
            event.preventDefault();
            return;
          }
        }
        event.preventDefault();
        lastEscapeActionAtRef.current = now;
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, escStopsRunningThread, escapeSuppressed, thread.status, thread.id, sdk]);

  // Existence checks for the inline-code file links (see
  // decorate-inline-code.ts): a path verdict comes from the plugin
  // backend, which resolves the thread's environment and stats the file
  // on the environment's own host.
  const checkWorkspacePaths = useCallback<PathExistenceChecker>(
    (paths) => {
      return rpc
        .call("workspace_files_exist", { threadId: thread.id, paths })
        .then((result) => new Map(Object.entries(result.existence)));
    },
    [rpc, thread.id],
  );

  // Paint the host's missing inline-code file links (see
  // decorate-inline-code.ts), gated on workspace existence: ThreadChat
  // streams and React rewrites its markdown over time, so verify once
  // for the content already on screen, then re-scan on mutations,
  // coalesced to one scan per frame. The environment id scopes the
  // verdict cache (the same relative path exists in one workspace but
  // not another) and is resolved once per thread.
  // bb's page-shell scroll manager behind the embedded ThreadChat has a
  // pending-capture bug that can clamp the transcript to the bottom right
  // after a click while it is scrolled up ("chat jumps up a half-page").
  // The SDK offers no access to that manager's state, so the pane arms a
  // defensive revert guard on chat clicks until bb ships the fix (see
  // docs/chat-click-jump-2026-09-29.md, where this module is covered too).
  const chatBodyRef = useRef<HTMLDivElement>(null);
  // The embedded ThreadChat's composer footer carries the project/checkout
  // chips but COLLAPSES to height 0 whenever the composer sits unexpanded,
  // so at rest in a pane the compose area paints none of it. Watch the
  // chat DOM (attributes included: the collapse is an attribute flip) and
  // fall back to our own project + checkout line when nothing shows there.
  const contextRowMissing = usePaneContextRowMissing(chatBodyRef, thread.id);
  const chatJumpGuardRef = useRef<ChatClickJumpGuard | null>(null);
  const onChatBodyClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      chatJumpGuardRef.current?.onChatClickCapture(event);
      onChatClickCapture(event);
    },
    [onChatClickCapture],
  );

  // The repainted host mention elements (role=button) and the painted chips
  // are keyboard-operable: Enter or Space on a focused chip routes the same
  // target the click-capture handler does.
  const onChatKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const reference = decoratedReferencePaneTarget(target);
      if (reference === null || referenceMentions === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      referenceMentions.onOpen(reference);
    },
    [referenceMentions],
  );
  useEffect(() => {
    const guard = createChatClickJumpGuard(() => chatBodyRef.current);
    chatJumpGuardRef.current = guard;
    return () => {
      guard.dispose();
      if (chatJumpGuardRef.current === guard) chatJumpGuardRef.current = null;
    };
  }, []);

  // Developer-only scroll instrumentation (setting "Developer: instrument
  // pane chat scrolling (debug)"), shipped off everywhere and enabled
  // through the config panel in a developer environment. This is the
  // persistent version of the ad-hoc probe instrumentation: every scroll
  // write with its stack, event stream, and 1 Hz geometry samples in a
  // bounded log. The log is console-side only — the pane header carries no
  // debug button; automation reads `__focusBoardScrollDebug.dump()`.
  // Detach restores everything.
  useEffect(() => {
    if (!scrollDebug) return;
    const root = chatBodyRef.current;
    if (root === null) return;
    const aside = document.querySelector('aside[aria-label^="Thread:"]');
    const marked = root.querySelector<HTMLElement>(".thread-scrollbar");
    const scroller = marked ?? Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((el) => (el.style?.overflowY ?? "") === "auto" && el.scrollHeight > el.clientHeight)
      .reduce<HTMLElement | null>((best, el) => (best === null || el.scrollHeight > best.scrollHeight ? el : best), null);
    if (scroller === null) return;
    const session = attachScrollDebug(scroller, `thread ${thread.id} (pane)`, window);
    const view = root.ownerDocument.defaultView;
    if (view !== null) {
      (view as Record<string, unknown> & typeof view)["__focusBoardScrollDebug"] = session;
    }
    return () => {
      session.detach();
      if (view !== null) delete (view as Record<string, unknown> & typeof view)["__focusBoardScrollDebug"];
    };
  }, [scrollDebug, thread.id, isCompact]);

  useEffect(() => {
    const root = chatBodyRef.current;
    if (root === null) return;
    const view = root.ownerDocument.defaultView;
    if (view === null) return;
    // undefined = not yet resolved, null = thread has no workspace
    // (stop retrying), string = scope for verdicts and decoration.
    let environmentId: string | null | undefined;
    let resolutionPending = false;
    const decorate = () => {
      // Reference chips (issue #161) convert without an environment — the
      // labels come from the board's own thread and project rows, so they
      // paint even while the workspace resolution is pending or failed.
      if (referenceMentions !== undefined) {
        decorateReferenceMentions(root, referenceMentions.labels);
      }
      if (environmentId === null) return;
      const scope = environmentId;
      if (scope !== undefined) {
        void decorateVerifiedInlineCodeLinks(
          root,
          scope,
          checkWorkspacePaths,
        ).catch(() => {});
        return;
      }
      if (resolutionPending) return;
      resolutionPending = true;
      sdk.threads
        .get({ threadId: thread.id })
        .then((result) => {
          resolutionPending = false;
          const resolved =
            "environmentId" in result ? result.environmentId : null;
          environmentId = resolved;
          if (resolved === null) return;
          return decorateVerifiedInlineCodeLinks(
            root,
            resolved,
            checkWorkspacePaths,
          );
        })
        // A transient resolution failure retries on the next mutation
        // scan; without a resolvable environment there is nothing
        // better to do.
        .catch(() => {
          resolutionPending = false;
        });
    };
    decorate();
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = view.requestAnimationFrame(() => {
        frame = null;
        decorate();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== null) view.cancelAnimationFrame(frame);
    };
  }, [thread.id, sdk, checkWorkspacePaths, referenceMentions]);

  return (
    <aside
      ref={paneRef}
      role="complementary"
      aria-label={`Thread: ${thread.displayTitle}`}
      className={
        windowCompact
          ? // Compact viewport: the pane covers the board as a full-screen
            // sheet with the X close button in the header. As a fixed element
            // it escapes the host panel's own safe-area padding, so it pads
            // for the home indicator / notch itself.
            "fixed inset-0 z-30 flex min-h-0 flex-col bg-background pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))]"
          : panelScopedSheet
            ? // A narrow panel on a desktop window: the sheet anchors to the
              // plugin panel only, so the host's chrome stays visible.
              "absolute inset-0 z-30 flex min-h-0 flex-col bg-background"
            : "relative flex h-full min-h-0 flex-col border-l border-border bg-background shadow-lg"
      }
      style={
        windowCompact || panelScopedSheet ? undefined : { width: effectiveWidth }
      }
    >
      {!isCompact ? (
        <div
          ref={edgeRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize thread pane"
          className="absolute inset-y-0 left-0 z-10 w-1.5 -ml-0.75 cursor-col-resize touch-none hover:bg-primary/20"
        />
      ) : null}
      <header
        className={
          isCompact
            ? "flex items-center gap-2 border-b border-border px-2 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]"
            : "flex items-center gap-2 border-b border-border px-3 py-2"
        }
      >
        {isCompact ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-foreground max-md:pointer-coarse:size-9"
            aria-label="Back to board"
            onClick={onClose}
          >
            <Icon name="ChevronLeft" className="size-5" />
          </Button>
        ) : null}
        {(() => {
          // The done checkbox, in the slot the chat icon used to hold just
          // left of the title. Same checkbox language as the board cards'
          // done checkbox (thread-card.tsx): an empty box on not-done
          // threads, a checked one on done. There is no arming here — the
          // card arms only because its checkbox is a hover-revealed target
          // inside a clickable anchor, while this button is a standalone
          // header control, so one click toggles, like the actions menu's
          // own "Mark Done" item. aria-label stays off the "Mark thread"
          // prefix, which is the read-state toggle's namespace.
          const doneLabel = isDone ? "Mark not done" : "Mark done";
          return (
            <button
              type="button"
              data-pane-done-checkbox=""
              aria-label={doneLabel}
              title={doneLabel}
              onClick={() => onToggleDone(!isDone)}
              className={cn(
                // The header's coarse-pointer ladder (issue #267): this was the
                // one control that never joined it, so on a phone it measured
                // 18x22 against its 36px siblings. A bare button, not a Button,
                // because its glyph sits in the card-checkbox slot, so it
                // carries the ladder itself: a 36px box below md on a coarse
                // pointer, with the glyph stepped to 20px to match.
                "flex items-center justify-center shrink-0 rounded-sm p-0.5",
                "max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9",
                "max-md:pointer-coarse:[&_[data-icon-root]]:size-5",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isDone
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              <Icon
                name={isDone ? "CheckboxChecked" : "Checkbox"}
                className="size-3.5"
                aria-hidden
              />
            </button>
          );
        })()}
        <EditableTitle
          title={thread.displayTitle}
          onRename={onRename}
          onAutotitle={(target) =>
            // ✨ auto-rename (server.ts thread_autotitle): the title comes
            // back already cleaned; commit it immediately. A target names
            // the way out the fallback modal picked: an alternative service
            // pair or the thread's own model probe.
            rpc
              .call(
                "thread_autotitle",
                target === undefined
                  ? { threadId: thread.id }
                  : "useThreadModel" in target
                    ? { threadId: thread.id, useThreadModel: true }
                    : {
                        threadId: thread.id,
                        pluginId: target.pluginId,
                        serviceId: target.serviceId,
                      },
              )
              .then((result) => result.title)
          }
          loadFallbackServices={() =>
            rpc
              .call("thread_autotitle_services", { threadId: thread.id })
              .then((result) => result as unknown as AutotitleFallbackState)
          }
        />
        {snoozeWakeAt !== null ? (
          // Muted chip on the pane's header: the open pane carries the same
          // "snoozed, wakes at …" language the board card does.
          <span
            data-pane-snooze-chip=""
            title={`Wakes ${describeWakeAt(snoozeWakeAt, Date.now())}`}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground"
          >
            <Icon name="Clock" className="size-3" aria-hidden />
            {isCompact ? "" : `Snoozed · wakes ${describeWakeAt(snoozeWakeAt, Date.now())}`}
          </span>
        ) : null}
        {(() => {
          // The read-state toggle and the thread actions are one family, so
          // they render as ONE split control at every width — the same
          // grammar as the open menu. On compact there is no room for a
          // labeled primary, so the split goes icon-only (Mail / MailOpen
          // toggle, rounded open toward the divider), then the attached
          // caret opening the thread-actions menu (done, pin, snooze,
          // archive). No floating ellipsis at any width.
          const actionItems: (ActionMenuItem | SnoozeMenuAction)[] = [
            // State toggles first, in the menu's frequency-of-use order: the
            // done toggle, then the pin (an archived row pins nothing —
            // its only way out is Unarchive), the snooze entry under its
            // divider, then the family-spawn entry ("New child thread…")
            // behind the snooze: a creation action stays categorically
            // apart from the state toggles. Archived rows carry it
            // too — bb accepts a child of an archived parent (the child
            // re-roots to render standalone), and the operator's call.
            {
              id: "done",
              label: isDone ? "Mark Not Done" : "Mark Done",
              icon: isDone ? "CircleCheck" : "Check",
              run: () => onToggleDone(!isDone),
            },
            ...(isArchived
              ? []
              : [
                  {
                    id: "pin",
                    label: thread.isPinned ? "Unpin" : "Pin",
                    icon: thread.isPinned ? "PinOff" : "Pin",
                    run: onTogglePinned,
                  },
                ]),
            ...(snoozeMenuItems ?? []),
            ...(onNewChildThread !== undefined
              ? [
                  {
                    id: "new-child",
                    label: "New child thread…",
                    icon: "Fork",
                    run: onNewChildThread,
                  },
                ]
              : []),
            {
              id: "archive",
              label: isArchived ? "Unarchive" : "Archive",
              icon: isArchived ? "ArchiveRestore" : "Archive",
              run: onToggleArchived,
            },
          ];
          if (isCompact) {
            // On compact viewports the full-screen button is dropped from
            // the header to save space, so the menu carries it instead
            // (bb's compact term; the desktop open dropdown has "Maximize
            // pane").
            actionItems.push({
              id: "maximize",
              label: "Full Screen",
              icon: "Maximize2",
              run: onMaximize,
            });
            return (
              // Same split grammar as the open menu at every width: the
              // icon-only read-state toggle is the primary, a hairline
              // divider, then the attached caret dropping the menu. No
              // overflow-hidden — the halves round themselves.
              <div className="relative inline-flex shrink-0 items-stretch rounded-md">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(HEADER_ICON_BUTTON_CLASS, "rounded-r-none")}
                  aria-label={thread.isUnread ? "Mark thread read" : "Mark thread unread"}
                  onClick={onToggleUnread}
                >
                  <Icon name={thread.isUnread ? "MailOpen" : "Mail"} className="size-4" />
                </Button>
                <div className="w-px self-stretch my-1.5 bg-border" aria-hidden />
                <ActionsMenu items={actionItems} attached />
              </div>
            );
          }
          return (
            // No overflow-hidden here: the dropdown the caret opens is a
            // descendant of this wrapper, and clipping for rounded corners
            // would clip the menu out of view. The halves round themselves.
            <div className="relative inline-flex shrink-0 items-stretch rounded-md">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 rounded-r-none px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label={thread.isUnread ? "Mark thread read" : "Mark thread unread"}
                onClick={onToggleUnread}
              >
                <Icon
                  name={thread.isUnread ? "MailOpen" : "Mail"}
                  className="size-3.5"
                  aria-hidden
                />
                {thread.isUnread ? "Mark Read" : "Mark Unread"}
              </Button>
              <div className="w-px self-stretch my-1.5 bg-border" aria-hidden />
              <ActionsMenu items={actionItems} attached />
            </div>
          );
        })()}
        {(() => {
          // The pane's take on the main view's workspace-open button: an
          // icon that opens the thread's workspace in the preferred editor
          // plus a dropdown (file explorer, terminal, Maximize pane, new
          // window, copy link). The standalone full-screen button is gone —
          // its action lives in this dropdown as bb's "Maximize pane". On a
          // wide pane the primary grows an "Open in editor" label; the
          // default width keeps it icon-only so the title keeps its room.
          // Renders nothing when no local open applies — no workspace,
          // daemon down, or the workspace on another host.
          return (
            <WorkspaceOpenMenu
              threadId={thread.id}
              threadHref={thread.href}
              onMaximize={onMaximize}
              onRevealBrowserTab={onRevealBrowserTab}
              showLabel={!isCompact && width >= OPEN_LABEL_MIN_PANE_WIDTH}
            />
          );
        })()}
        <Button
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BUTTON_CLASS}
          aria-label="Close thread pane"
          onClick={onClose}
        >
          <Icon name="X" className="size-4" />
        </Button>
      </header>
      {/* The host's embedded ThreadChat renders no pending-interaction UI
          (only the main thread view does), so a question asked while this
          pane is open would block the tool call until timeout. This card
          renders the host's question form in the pane instead. */}
      <PendingInteractionCard threadId={thread.id} onOpenInMainView={onMaximize} />
      {/* The host transcript drops every trace of an answered AskUserQuestion
          (suppressed tool call, hidden delivered result, answers never stored
          on the interaction row), so this card rebuilds recent decisions from
          the raw event log. */}
      <DecidedQuestionsCard threadId={thread.id} />
      {/* The host's embedded ThreadChat lives here. bb scopes our plugin
          stylesheet with `:where([data-bb-plugin="focus-board"],
          [data-bb-plugin-root]:not([data-bb-plugin]))` and appends it after
          bb's global utilities, so our own scoped `.pointer-events-none` and
          `.opacity-0` outrank the host's `[@media(hover:none)]` touch reveal
          on any host element inside this root. The queued-message row's
          actions control is the case that bites: on a phone it stays
          `opacity:0` and `pointer-events:none`, so the row's "…" is invisible
          and Send is unreachable. Emitting the host's own touch utilities
          from this subtree carries them into our scoped sheet, where they win
          by order and restore the host control exactly as bb's own thread
          page renders it. The host class names are mirrored on purpose; the
          durable fix belongs to bb's plugin CSS scoping (issue #296). */}
      <div
        ref={chatBodyRef}
        data-pane-chat-body=""
        className="min-h-0 flex-1 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        onClickCapture={onChatBodyClickCapture}
        onKeyDownCapture={onChatKeyDownCapture}
      >
        <ThreadChat threadId={thread.id} variant="compact" layout="contained" />
      </div>
      {/* bb's embedded chat shows no project/checkout context on a pane
          container; when its row is genuinely absent from the chat DOM this
          line answers "where does my next message land". The probe stays
          quiet whenever the host paints its own context, so bb fixing the
          gap never duplicates the line. */}
      {contextRowMissing && thread.context !== null && thread.context !== undefined ? (
        <PaneContextRow info={thread.context} />
      ) : null}
    </aside>
  );
}