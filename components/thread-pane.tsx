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
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeWakeAt } from "@/lib/snooze";
import type { SnoozeMenuAction } from "@/lib/snooze";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
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

// Shared header-button classes: a 28px ghost icon button that grows to a
// 36px touch target on coarse pointers (phones), matching bb's own headers.
const HEADER_ICON_BUTTON_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} shrink-0 text-muted-foreground hover:text-foreground`;

const PANE_WIDTH_KEY = "focus-board:paneWidth";
const PANE_MIN_WIDTH = 320;
const PANE_MAX_WIDTH = 900;
const PANE_DEFAULT_WIDTH = 480;

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
  /** Debug: attach the scroll-instrumentation session to this pane's transcript (ships off). */
  scrollDebug?: boolean;
}

interface ActionMenuItem {
  id: string;
  label: string;
  icon: string;
  run: () => void;
  /** The snooze entries arrive grouped: a divider above the group's head. */
  dividerAbove?: boolean;
}

function EditableTitle({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed !== "" && trimmed !== title) {
      void onRename(trimmed).catch(() => {});
    }
    setEditing(false);
  }, [draft, title, onRename]);

  const cancel = useCallback(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

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
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
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
      className="min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-ring"
      aria-label="Thread title"
    />
  );
}

function ActionsMenu({ items }: { items: readonly ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className={HEADER_ICON_BUTTON_CLASS}
        aria-label="More thread actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="ChevronDown" className="size-4" />
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
    </div>
  );
}

export function ThreadPane({
  thread,
  isArchived,
  isDone,
  scrollDebug = false,
  onToggleDone,
  onToggleArchived,
  onTogglePinned,
  onToggleUnread,
  snoozeMenuItems,
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
        if (escStopsRunningThread) {
          // bb sorts "starting", "active", and "stopping" as busy threads.
          // Escape interrupts the running turn first — closing the pane
          // while the agent still runs would feel like the stop did
          // nothing — and only closes once nothing is running. "stopping"
          // means a stop is already in flight; keep the pane open until it
          // settles so the result stays visible.
          if (thread.status === "active" || thread.status === "starting") {
            event.preventDefault();
            void sdk.threads.stop({ threadId: thread.id }).catch(() => {});
            return;
          }
          if (thread.status === "stopping") {
            event.preventDefault();
            return;
          }
        }
        event.preventDefault();
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
  const scrollDebugSessionRef = useRef<ReturnType<typeof attachScrollDebug> | null>(null);
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
  // bounded log, with a copy affordance in the header and a window
  // handle for automation to read. Detach restores everything.
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
    // Expose a copy affordance for the operator: the header button gets a
    // fresher copy from this ref each click.
    scrollDebugSessionRef.current = session;
    return () => {
      session.detach();
      if (view !== null) delete (view as Record<string, unknown> & typeof view)["__focusBoardScrollDebug"];
      scrollDebugSessionRef.current = null;
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
        <EditableTitle title={thread.displayTitle} onRename={onRename} />
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
        <Button
          variant="ghost"
          size="sm"
          className={isCompact ? HEADER_ICON_BUTTON_CLASS : "h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"}
          aria-label={thread.isUnread ? "Mark thread read" : "Mark thread unread"}
          onClick={onToggleUnread}
        >
          <Icon name={thread.isUnread ? "MailOpen" : "Mail"} className="size-3.5" aria-hidden />
          {!isCompact ? (thread.isUnread ? "Mark Read" : "Mark Unread") : null}
        </Button>
        {(() => {
          const actionItems: (ActionMenuItem | SnoozeMenuAction)[] = [
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
          // On compact viewports the full-screen button is dropped from the
          // header to save space, so the menu carries "Full Screen" instead.
          if (isCompact) {
            actionItems.push({
              id: "maximize",
              label: "Full Screen",
              icon: "Maximize2",
              run: onMaximize,
            });
          }
          return <ActionsMenu items={actionItems} />;
        })()}
        {!isCompact ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open thread full screen"
            onClick={onMaximize}
          >
            <Icon name="Maximize2" className="size-4" />
          </Button>
        ) : null}
        {(() => {
          // Debug-mode affordance: copying the bounded instrumentation log
          // (setting "Developer: instrument pane chat scrolling"). Rendered
          // only while the debug session may be attached.
          if (!scrollDebug) return null;
          return (
            <Button
              variant="ghost"
              size="icon"
              className={HEADER_ICON_BUTTON_CLASS}
              aria-label="Copy pane scroll debug log"
              onClick={() => {
                const session = scrollDebugSessionRef.current;
                if (session === null) return;
                void navigator.clipboard
                  ?.writeText(session.dump())
                  .catch(() => {
                    console.debug("[focus-board:scroll-debug dump]");
                    console.debug(session.dump());
                  });
              }}
            >
              <Icon name="Bug" className="size-4" />
            </Button>
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