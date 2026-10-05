import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
import {
  decorateVerifiedInlineCodeLinks,
  decoratedCodePath,
  type PathExistenceChecker,
} from "@/components/decorate-inline-code";
import type { rpcContract } from "@/server";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  createChatClickJumpGuard,
  type ChatClickJumpGuard,
} from "@/components/chat-jump-guard";
import { attachScrollDebug } from "@/components/scroll-debug";
import { AutotitleFallbackModal } from "@/components/autotitle-fallback-modal";
import { WorkspaceOpenMenu, OPEN_LABEL_MIN_PANE_WIDTH } from "@/components/workspace-open-menu";
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
   * menu's "Open in new window" and "Copy thread link" destinations.
   */
  href: string;
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
  escStopsRunningThread,
  escapeSuppressed = false,
}: ThreadPaneProps) {
  const [width, setWidth] = useState(readStoredPaneWidth);
  const isCompact = useIsCompactViewport();
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
    [openWorkspacePreview],
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
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
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
  }, [width, onPointerMove, endDrag]);

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
  const chatJumpGuardRef = useRef<ChatClickJumpGuard | null>(null);
  const onChatBodyClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      chatJumpGuardRef.current?.onChatClickCapture(event);
      onChatClickCapture(event);
    },
    [onChatClickCapture],
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
  }, [thread.id, sdk, checkWorkspacePaths]);

  return (
    <aside
      role="complementary"
      aria-label={`Thread: ${thread.displayTitle}`}
      className={
        isCompact
          ? // Compact viewport: the pane covers the board as a full-screen
            // sheet with the X close button in the header. As a fixed element
            // it escapes the host panel's own safe-area padding, so it pads
            // for the home indicator / notch itself.
            "fixed inset-0 z-30 flex min-h-0 flex-col bg-background pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))]"
          : "relative flex h-full min-h-0 flex-col border-l border-border bg-background shadow-lg"
      }
      style={isCompact ? undefined : { width }}
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
        <Icon
          name={thread.status === "active" ? "Loading" : "MessageSquare"}
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
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
          // on desktop they render as ONE split control — the same grammar
          // as the open menu: labeled primary (Mark Unread / Mark Read) on
          // the left, attached caret opening the thread-actions menu (done,
          // pin, snooze, archive) on the right. No floating ellipsis. The
          // compact header keeps the icon toggle plus the standalone ⋯
          // menu, since there is no room for a labeled split there.
          const actionItems: (ActionMenuItem | SnoozeMenuAction)[] = [
            // The family-spawn entry leads: a creation action is categorically
            // apart from the state toggles below it. Archived rows carry it
            // too — bb accepts a child of an archived parent (the child
            // re-roots to render standalone), and the operator's call.
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
              id: "done",
              label: isDone ? "Mark Not Done" : "Mark Done",
              icon: isDone ? "CircleCheck" : "Check",
              run: () => onToggleDone(!isDone),
            },
            // Pin sits after the done toggle. An archived row pins nothing:
            // its only way out is Unarchive.
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
            // The single snooze entry (Snooze… / Edit snooze…), then archive.
            ...(snoozeMenuItems ?? []),
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
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={HEADER_ICON_BUTTON_CLASS}
                  aria-label={thread.isUnread ? "Mark thread read" : "Mark thread unread"}
                  onClick={onToggleUnread}
                >
                  <Icon name={thread.isUnread ? "MailOpen" : "Mail"} className="size-4" />
                </Button>
                <ActionsMenu items={actionItems} />
              </>
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
      <div
        ref={chatBodyRef}
        className="min-h-0 flex-1"
        onClickCapture={onChatBodyClickCapture}
      >
        <ThreadChat threadId={thread.id} variant="compact" layout="contained" />
      </div>
    </aside>
  );
}