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
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { PendingInteractionCard } from "@/components/pending-interaction-card";
import { DecidedQuestionsCard } from "@/components/decided-questions-card";
import { isExternalHref, workspacePathFromHref } from "@/components/chat-link-intercept";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";

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
}

interface ThreadPaneProps {
  thread: ThreadPaneThread;
  isArchived: boolean;
  isDone: boolean;
  onToggleDone: (done: boolean) => void;
  onToggleArchived: () => void;
  onToggleUnread: () => void;
  onRename: (title: string) => Promise<void>;
  onMaximize: () => void;
  onClose: () => void;
}

interface ActionMenuItem {
  id: string;
  label: string;
  icon: string;
  run: () => void;
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
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
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
  onToggleDone,
  onToggleArchived,
  onToggleUnread,
  onRename,
  onMaximize,
  onClose,
}: ThreadPaneProps) {
  const [width, setWidth] = useState(readStoredPaneWidth);
  const isCompact = useIsCompactViewport();
  const sdk = useSdk();
  const navigate = useBbNavigate();
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
  // against the thread's environment instead.
  const onChatClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (anchor === null) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href === "" || isExternalHref(href)) return;
      const path = workspacePathFromHref(href);
      if (path === null) return;
      event.preventDefault();
      event.stopPropagation();
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
        // Inline editors (rename) consume Escape to cancel the edit; let them.
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          return;
        }
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);

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
          const actionItems: ActionMenuItem[] = [
            {
              id: "done",
              label: isDone ? "Mark Not Done" : "Mark Done",
              icon: isDone ? "CircleCheck" : "Check",
              run: () => onToggleDone(!isDone),
            },
            {
              id: "archive",
              label: isArchived ? "Unarchive" : "Archive",
              icon: isArchived ? "ArchiveRestore" : "Archive",
              run: onToggleArchived,
            },
          ];
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
        className="min-h-0 flex-1"
        onClickCapture={onChatClickCapture}
      >
        <ThreadChat threadId={thread.id} variant="compact" layout="contained" />
      </div>
    </aside>
  );
}