import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ThreadCard } from "./thread-card";
import { ThreadCardMenu, type CardMenuAction } from "./thread-card-menu";
import { EmptyState } from "./empty-state";
import { threadState } from "./grouping";
import {
  sectionParentLanes,
  type ParentLane,
  type ParentLaneSection,
} from "./parent-lanes";
import {
  MINI,
  RAIL_TO_LANE_GAP,
  RULER,
  computeParentLaneLayout,
  predictedStart,
  lockIndexFor,
} from "./parent-lane-layout";
import type { ParentLaneOrder } from "./preferences";

interface ParentLaneBoardProps {
  lanes: readonly ParentLane[];
  activeThreadId: string | null;
  doneIds: ReadonlySet<string>;
  /** Members of kept families that did not match the filters/search. */
  dimmedIds: ReadonlySet<string>;
  /** Raw parent → children map, used for the level-1 child +N chip. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  projectNameFor: (projectId: string) => string;
  repoBaseFor: (projectId: string) => string | null;
  statusFor?: (repo: string | null, number: number | undefined) =>
    | { kind: string; state: string }
    | undefined;
  parentLaneOrder: ParentLaneOrder;
  onParentLaneOrderChange: (value: ParentLaneOrder) => void;
  onOpenThread: (threadId: string) => void;
  /** Close the open thread pane when the operator clicks empty board area. */
  onClosePane?: () => void;
  onNewTask: () => void;
  menuActionsFor: (thread: PluginSidebarThread) => readonly CardMenuAction[];
}

/** Ruler+wrap board chrome measurements (shared with parent-lane-layout.ts). */
const RAIL_W = 140;
const HEADER_H = 76;

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

function LaneStateDot({ thread }: { thread: PluginSidebarThread }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT_CLASS[threadState(thread)] ?? "bg-muted-foreground/30",
      )}
      aria-hidden
    />
  );
}

/**
 * Vertical bring-into-view correction for the active card, relative to the
 * board's scroll viewport. Accounts for the sticky header band (cards can
 * hide under it) and leaves a small breathing margin at the edges. Returns
 * the scroll delta to apply; 0 means the card is fully visible.
 */
export function verticalCardCorrection(
  el: HTMLElement,
  card: HTMLElement,
  headerH: number,
): number {
  const boardRect = el.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const visibleTop = boardRect.top + headerH;
  if (cardRect.top < visibleTop) return -(visibleTop - cardRect.top) - 8;
  if (cardRect.bottom > boardRect.bottom) return cardRect.bottom - boardRect.bottom + 8;
  return 0;
}

function ArchivedRider({
  child,
  dimmed,
  isActive,
  onOpenThread,
  menuActions,
}: {
  child: PluginSidebarThread;
  dimmed?: boolean;
  isActive?: boolean;
  onOpenThread: (threadId: string) => void;
  menuActions?: readonly CardMenuAction[];
}) {
  const anchor = (
    <a
      href={child.href}
      data-thread-card={child.id}
      draggable={false}
      aria-current={isActive ? "true" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenThread(child.id);
      }}
      className={cn(
        "block w-32 shrink-0 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-left",
        "transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "opacity-70 hover:opacity-100 saturate-50",
        dimmed && "opacity-50",
        isActive && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-center gap-1.5">
        <LaneStateDot thread={child} />
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
          <Icon name="Archive" className="size-3" aria-hidden />
          archived
        </span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug">{child.displayTitle}</p>
    </a>
  );
  if (menuActions === undefined || menuActions.length === 0) return anchor;
  return (
    <ThreadCardMenu
      anchor={anchor}
      actions={menuActions}
      href={child.href}
      onOpen={() => onOpenThread(child.id)}
      title={child.displayTitle}
    />
  );
}

function LaneHeader({
  lane,
  locked,
  doneIds,
  sectionLabel,
  onOpenThread,
  onLock,
}: {
  lane: ParentLane;
  locked: boolean;
  doneIds: ReadonlySet<string>;
  sectionLabel: string | null;
  onOpenThread: (threadId: string) => void;
  onLock: () => void;
}) {
  const parent = lane.parent;
  const isDone = doneIds.has(parent.id);
  return (
    <button
      type="button"
      onClick={() => {
        onLock();
        onOpenThread(parent.id);
      }}
      aria-label={`Open ${lane.label}`}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDone && "opacity-50 saturate-50",
      )}
    >
      {sectionLabel !== null ? (
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {sectionLabel} ·
        </span>
      ) : null}
      <LaneStateDot thread={parent} />
      <span
        className={cn(
          "truncate text-[13px] font-medium leading-snug",
          locked && "text-foreground",
        )}
      >
        {lane.label}
      </span>
      {lane.childCount > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {lane.childCount}
        </span>
      ) : null}
    </button>
  );
}

function LaneOrderToggle({
  value,
  onChange,
}: {
  value: ParentLaneOrder;
  onChange: (value: ParentLaneOrder) => void;
}) {
  const option = (id: ParentLaneOrder, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === id}
      onClick={() => onChange(id)}
      className={cn(
        "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left w-full transition-colors",
        value === id
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "block size-1.5 rounded-full shrink-0",
          value === id ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      {label}
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Lane order"
      className="flex flex-col gap-0.5 text-[11px] font-medium"
    >
      {option("recency", "Recency")}
      {option("project", "By project")}
    </div>
  );
}

/** Capture every placed card's rect keyed by thread id, for the recut FLIP. */
function captureCardRects(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-cell]"))) {
    const key = el.getAttribute("data-key");
    if (key !== null) rects.set(key, el.getBoundingClientRect());
  }
  return rects;
}

export function ParentLaneBoard({
  lanes,
  activeThreadId,
  doneIds,
  dimmedIds,
  childrenByParent,
  projectNameFor,
  repoBaseFor,
  statusFor,
  parentLaneOrder,
  onParentLaneOrderChange,
  onOpenThread,
  onClosePane,
  onNewTask,
  menuActionsFor,
}: ParentLaneBoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const [geoIdx, setGeoIdx] = useState(0);
  const [released, setReleased] = useState(false);
  const [viewportW, setViewportW] = useState(RAIL_W + 900);

  // Latest-value refs the imperative scroll manager reads without re-binding.
  const geoIdxRef = useRef(0);
  const releasedRef = useRef(false);
  const glidingRef = useRef(false);
  const pendingLockRef = useRef<number | null>(null);
  const glideLaneRef = useRef<number | null>(null);
  const glideTargetRef = useRef<number | null>(null);
  /** True while a post-recut correction is self-scrolling, so the scroll
   *  listener does not mistake its own events for a user pan. */
  const postPinRef = useRef(false);
  const flatRef = useRef<{ lane: ParentLane; sectionLabel: string | null }[]>([]);
  const layoutRef = useRef<ReturnType<typeof computeParentLaneLayout> | null>(null);
  const viewportRef = useRef(0);
  const activeThreadIdRef = useRef<string | null>(null);
  const prevRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const lockToRef = useRef<(index: number) => void>(() => {});

  // Flat lane list with project-section labeling (R5). "By project" keeps
  // sections contiguous and marks each section's first lane with its label,
  // so the row-major geometry stays one flat ruler+wrap grid.
  const flat = useMemo(() => {
    if (parentLaneOrder === "project") {
      const sections: ParentLaneSection[] = sectionParentLanes(lanes, projectNameFor);
      const out: { lane: ParentLane; sectionLabel: string | null }[] = [];
      for (const section of sections) {
        section.lanes.forEach((lane, index) => {
          out.push({ lane, sectionLabel: index === 0 ? section.label : null });
        });
      }
      return out;
    }
    return lanes.map((lane) => ({ lane, sectionLabel: null }));
  }, [lanes, parentLaneOrder, projectNameFor]);

  const lockedIndex = flat.length > 0 ? Math.min(geoIdx, flat.length - 1) : null;
  const layout = useMemo(
    () =>
      computeParentLaneLayout(
        flat.map((entry) => entry.lane),
        lockedIndex,
        viewportW,
        RAIL_W,
      ),
    [flat, lockedIndex, viewportW],
  );

  // Publish the latest render values to the scroll manager's refs.
  geoIdxRef.current = lockedIndex ?? 0;
  releasedRef.current = released;
  flatRef.current = flat;
  layoutRef.current = layout;
  viewportRef.current = viewportW;
  activeThreadIdRef.current = activeThreadId;

  // Measure the scrollport for the context-column cap.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const measure = () => {
      // jsdom reports 0 — keep the initial estimate rather than collapsing
      // the context cap to nothing in tests.
      if (el.clientWidth > 0) setViewportW(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return; // jsdom
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The scroll manager: a pan releases the lock (geometry frozen); when the
  // scroll rests, the pending (clicked) or nearest lane is pinned first — a
  // smooth glide to its predicted post-recut flush position — and only then
  // re-cut (state flip). Recut waits for the pin.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || lanes.length === 0) return;
    let lastLeft = el.scrollLeft;
    let settleTimer = 0;
    let glideTimer = 0;
    let postPinTimer = 0;

    /** DOM-measured corrections, shared by the post-pin timer and the
     *  same-lane fast path: re-pin the locked lane's flush edge and bring
     *  the active card into vertical view (instant on the fast path — no
     *  glide is pending there, so nothing races). */
    const runCorrections = () => {
      const locked = el.querySelector("section[data-locked]");
      if (locked instanceof HTMLElement) {
        const drift =
          locked.getBoundingClientRect().left -
          (el.getBoundingClientRect().left + RAIL_W + RAIL_TO_LANE_GAP);
        if (Math.abs(drift) > 2) el.scrollLeft += drift;
      }
      const id = activeThreadIdRef.current;
      if (id !== null) {
        const card = el.querySelector(`[data-thread-card="${CSS.escape(id)}"]`);
        if (card instanceof HTMLElement) {
          const delta = verticalCardCorrection(el, card, HEADER_H);
          if (delta !== 0) el.scrollTop += delta;
        }
      }
    };

    /** After a recut's transitions settle: re-measure the pinned lane's
     *  flush against the DOM (correcting prediction drift or transition
     *  clamping) and bring the active card back into vertical view — the
     *  recut resizes bands above it, which can push it off-screen. */
    const schedulePostPin = () => {
      window.clearTimeout(postPinTimer);
      postPinRef.current = true;
      postPinTimer = window.setTimeout(() => {
        if (releasedRef.current || glidingRef.current) {
          postPinRef.current = false;
          return;
        }
        runCorrections();
        // Keep the guard up through the corrections' own scroll events, so
        // the drift jump and the smooth glide are not misread as a user pan.
        window.clearTimeout(postPinTimer);
        postPinTimer = window.setTimeout(() => {
          postPinRef.current = false;
        }, 250);
      }, 300);
    };

    const nearestLane = () => {
      const widths = layoutRef.current?.laneWidths ?? [];
      const flush = widths.map((_, i) => predictedStart(i, widths, RAIL_W) - 1);
      // Padded grab range: a lane grabs a little before its flush point, so
      // a stop with the previous lane's right sliver at the lock point still
      // locks it (operator: "a wider grab range for the left-most column").
      return lockIndexFor(el.scrollLeft, flush);
    };

    const assign = (laneIndex: number) => {
      glidingRef.current = false;
      glideLaneRef.current = null;
      glideTargetRef.current = null;
      pendingLockRef.current = null;
      if (laneIndex !== geoIdxRef.current) {
        prevRectsRef.current = captureCardRects(el);
        geoIdxRef.current = laneIndex;
        setGeoIdx(laneIndex);
      }
      // Both paths: a recut needs the drift/vertical corrections after its
      // transitions; a same-lane re-lock still owes the active card a
      // vertical bring-into-view.
      schedulePostPin();
      releasedRef.current = false;
      setReleased(false);
    };

    let glideDeadline = 0;

    const glideCheck = () => {
      if (
        !glidingRef.current ||
        glideLaneRef.current === null ||
        glideTargetRef.current === null
      ) {
        return;
      }
      // Converged to the predicted flush, or the glide stalled (another
      // scroll claimed the element): assign the intended lane either way.
      if (
        Math.abs(el.scrollLeft - glideTargetRef.current) <= 3 ||
        performance.now() > glideDeadline
      ) {
        assign(glideLaneRef.current);
        return;
      }
      glideTimer = window.setTimeout(glideCheck, 150);
    };

    const ensureReachable = (target: number) => {
      const spacer = spacerRef.current;
      const needed = target + el.clientWidth - RAIL_W + 4;
      if (el.scrollWidth < needed && spacer !== null) {
        // The spacer absorbs exactly the deficit on the frozen board.
        const grow = needed - el.scrollWidth + 4;
        spacer.style.width = `${Math.max(0, spacer.getBoundingClientRect().width + grow)}px`;
      }
    };

    const beginGlide = (laneIndex: number) => {
      const laneList = flatRef.current.map((entry) => entry.lane);
      const predicted = computeParentLaneLayout(
        laneList,
        laneIndex,
        viewportRef.current,
        RAIL_W,
      );
      const target = Math.max(
        0,
        predictedStart(laneIndex, predicted.laneWidths, RAIL_W) - (RAIL_W + RAIL_TO_LANE_GAP),
      );
      ensureReachable(target);
      glidingRef.current = true;
      glideLaneRef.current = laneIndex;
      glideTargetRef.current = target;
      glideDeadline = performance.now() + 2500;
      el.scrollTo({ left: target, behavior: "smooth" });
      glideTimer = window.setTimeout(glideCheck, 400);
    };

    const settle = () => {
      const pending = pendingLockRef.current;
      const laneIndex = pending !== null ? pending : nearestLane();
      pendingLockRef.current = null;
      if (laneIndex === geoIdxRef.current) {
        releasedRef.current = false;
        setReleased(false);
        return;
      }
      beginGlide(laneIndex);
    };

    const lockTo = (laneIndex: number) => {
      if (laneIndex === geoIdxRef.current && !releasedRef.current) {
        // Same lane, still locked: no recut and no glide pending, so correct
        // immediately (a delayed fix would show a deep-linked card below the
        // fold), then re-check after any pane-driven relayout.
        postPinRef.current = true;
        runCorrections();
        window.clearTimeout(postPinTimer);
        postPinTimer = window.setTimeout(() => {
          postPinRef.current = false;
        }, 250);
        return;
      }
      pendingLockRef.current = laneIndex;
      releasedRef.current = true;
      setReleased(true);
      settle();
    };
    lockToRef.current = lockTo;

    const onScroll = () => {
      const dx = el.scrollLeft - lastLeft;
      lastLeft = el.scrollLeft;
      if (glidingRef.current || postPinRef.current) return; // managed scrolls poll their own timers
      if (dx === 0) return; // vertical scroll never releases the lock
      if (!releasedRef.current) {
        releasedRef.current = true;
        setReleased(true);
      }
      pendingLockRef.current = null;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 200);
    };

    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(settleTimer);
      window.clearTimeout(glideTimer);
      window.clearTimeout(postPinTimer);
    };
    // The manager binds once per lane-count change; live state flows
    // through refs, so the handlers never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes.length]);

  // Active thread: its lane becomes the locked (pinned) lane, and the card
  // is brought into vertical view in the shared scroll.
  const activeLaneId = useMemo(() => {
    if (activeThreadId === null) return null;
    for (const { lane } of flat) {
      if (lane.id === activeThreadId) return lane.id;
      for (const row of lane.rows) {
        if (row.threads.some((t) => t.id === activeThreadId)) return lane.id;
      }
      if (lane.archivedChildren.some((t) => t.id === activeThreadId)) return lane.id;
    }
    return null;
  }, [flat, activeThreadId]);

  // Active thread: its lane becomes the locked (pinned) lane. The vertical
  // card bring-into-view does NOT run here: a programmatic smooth scroll
  // cancels Chrome's previous one, so it would kill the horizontal pin
  // glide mid-flight and leave the board drifting. The correction rides the
  // post-pin schedule instead (assign → 300ms post-transition).
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || activeThreadId === null || activeLaneId === null) return;
    const index = flat.findIndex((entry) => entry.lane.id === activeLaneId);
    if (index >= 0) lockToRef.current(index);
  }, [activeThreadId, activeLaneId, flat]);

  // FLIP: cards moved by a recut glide from their pre-recut rects into place.
  useLayoutEffect(() => {
    const prev = prevRectsRef.current;
    prevRectsRef.current = null;
    const el = scrollRef.current;
    if (prev === null || el === null) return;
    for (const node of Array.from(el.querySelectorAll<HTMLElement>("[data-cell]"))) {
      const key = node.getAttribute("data-key");
      const before = key === null ? undefined : prev.get(key);
      if (before === undefined) continue;
      const now = node.getBoundingClientRect();
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      const sx = now.width === 0 ? 1 : before.width / now.width;
      const sy = now.height === 0 ? 1 : before.height / now.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02) continue;
      node.style.transformOrigin = "top left";
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 200ms ease";
        node.style.transform = "";
      });
    }
  }, [geoIdx]);

  const handleBackgroundClick = (event: MouseEvent) => {
    if (activeThreadId === null || onClosePane === undefined) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        "[data-thread-card], [data-lane-header], button, a, input, textarea, select, [role='menu'], [role='menuitem']",
      ) !== null
    )
      return;
    onClosePane();
  };

  if (lanes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState>
          No thread families to show yet. Loose (unparented) threads stay in the Attention
          view — set a parent on a thread to start a lane here.
        </EmptyState>
      </div>
    );
  }

  const rowIds = flat[0].lane.rows.map((row) => row.id);
  const rowLabels = flat[0].lane.rows.map((row) => row.label);
  const lockedLane = lockedIndex === null ? undefined : flat[lockedIndex].lane;
  // Trailing spacer: enough room for a full viewport past the last lane so
  // it can reach the locked position. Constant per viewport — it never
  // depends on the live scroll position, so it cannot wobble mid-pan
  // (ensureReachable grows it only while a glide needs the reach).
  const spacerW = Math.max(0, viewportW - RAIL_W - RAIL_TO_LANE_GAP);

  return (
    <div
      ref={scrollRef}
      onClick={handleBackgroundClick}
      data-parent-board
      className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2"
    >
      <div className="flex min-h-full w-max items-stretch">
        {/* Row rail: pinned left; labels ride their band heights, so labels
            and seams line up board-wide by construction. */}
        <div
          data-rail
          className="sticky left-0 z-20 shrink-0 bg-background"
          style={{ width: RAIL_W }}
        >
          <div style={{ height: HEADER_H }} className="flex flex-col justify-center gap-1 px-1.5">
            <LaneOrderToggle value={parentLaneOrder} onChange={onParentLaneOrderChange} />
            <button
              type="button"
              onClick={onNewTask}
              className={cn(
                "flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1",
                "text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Icon name="Plus" className="size-3" aria-hidden />
              New Task
            </button>
          </div>
          {rowLabels.map((label, index) => {
            const count =
              released || lockedLane === undefined
                ? null
                : lockedLane.rows[index].threads.length;
            return (
              <div
                key={rowIds[index]}
                style={{ height: layout.bandHeights[index] }}
                className={cn(
                  "flex flex-col justify-center border-b border-border/40 px-1.5",
                  "transition-[height] duration-200",
                )}
              >
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  {label}
                </span>
                {released || count === null || count === 0 || lockedLane === undefined ? null : (
                  <span
                    data-rail-attribution
                    className="truncate text-[10px] tabular-nums text-primary"
                  >
                    {count} · {lockedLane.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="w-4 shrink-0" aria-hidden />
        {/* Lanes: one column per family; the locked lane renders rulers,
            the rest minis, all sharing the same per-row band heights. From
            lane 2 on, each section carries the 16px lane-gap margin that
            predictedStart models (the w-4 div covers the rail → lane 1 gap). */}
        {flat.map((entry, laneIndex) => {
          const laneLayout = layout.lanes[laneIndex];
          const lane = entry.lane;
          const locked = laneIndex === lockedIndex && !released;
          return (
            <section
              key={lane.id}
              data-lane-id={lane.id}
              aria-label={lane.label}
              data-locked={locked ? "true" : undefined}
              style={{
                width: laneLayout.width,
                marginLeft: laneIndex === 0 ? 0 : RAIL_TO_LANE_GAP,
              }}
              className={cn(
                "shrink-0",
                locked && "rounded-lg bg-primary/[0.02] shadow-[inset_0_0_0_1px] shadow-primary/20",
              )}
            >
              <div
                data-lane-header
                style={{ height: HEADER_H }}
                className={cn(
                  "sticky top-0 z-10 space-y-1 overflow-hidden bg-background px-1",
                  locked && "border-b border-primary/40",
                )}
              >
                <LaneHeader
                  lane={lane}
                  locked={locked}
                  doneIds={doneIds}
                  sectionLabel={entry.sectionLabel}
                  onOpenThread={onOpenThread}
                  onLock={() => lockToRef.current(laneIndex)}
                />
                {lane.archivedChildren.length > 0 ? (
                  <div className="flex gap-1 overflow-x-auto pb-0.5">
                    {lane.archivedChildren.map((child) => (
                      <ArchivedRider
                        key={child.id}
                        child={child}
                        dimmed={dimmedIds.has(child.id)}
                        isActive={child.id === activeThreadId}
                        onOpenThread={onOpenThread}
                        menuActions={menuActionsFor(child)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              {lane.rows.map((row, rowIndex) => {
                const cells = laneLayout.cells.filter((cell) => cell.row === rowIndex);
                const chip = laneLayout.chipFor[rowIndex];
                return (
                  <div
                    key={row.id}
                    data-band={row.id}
                    style={{ height: layout.bandHeights[rowIndex] }}
                    className={cn(
                      "flex flex-wrap content-start gap-2 overflow-hidden p-1",
                      "border-b border-border/40 last:border-b-0",
                      "transition-[height] duration-200",
                      // Ruler bands left-pack so a lone card stays pinned to
                      // the flush edge (visible even on narrow scrollports);
                      // context bands center their minis.
                      locked ? "" : "justify-center",
                      locked && "bg-primary/[0.04]",
                    )}
                  >
                    {cells.length === 0 && chip === undefined ? (
                      <div data-slab className="rounded-md bg-muted/10 outline outline-1 outline-dashed outline-border/25 flex-1 min-w-4 h-full" aria-hidden />
                    ) : null}
                    {cells.map((cell) => {
                      // A lone context card fills its band row instead of
                      // leaving dead space on both sides; rulers stay
                      // uniform and center.
                      const fillRow =
                        cell.variant === "mini" && cells.length === 1 && chip === undefined;
                      return (
                        <div
                          key={cell.thread.id}
                          data-key={cell.thread.id}
                          data-cell
                          data-variant={cell.variant}
                          style={
                            fillRow
                              ? { height: MINI.h }
                              : {
                                  width: cell.variant === "ruler" ? RULER.w : MINI.w,
                                  height: cell.variant === "ruler" ? RULER.h : MINI.h,
                                }
                          }
                          className={cn(
                            "shrink-0 overflow-hidden rounded-md",
                            fillRow && "min-w-[136px] flex-1",
                          )}
                        >
                        <ThreadCard
                          thread={cell.thread}
                          compact={cell.variant === "mini"}
                          stateDot={<LaneStateDot thread={cell.thread} />}
                          isActive={cell.thread.id === activeThreadId}
                          isDone={doneIds.has(cell.thread.id)}
                          projectName={projectNameFor(cell.thread.projectId)}
                          repoHrefBase={repoBaseFor(cell.thread.projectId) ?? undefined}
                          statusFor={statusFor}
                          menuActions={menuActionsFor(cell.thread)}
                          activeThreadId={activeThreadId}
                          dimmed={dimmedIds.has(cell.thread.id)}
                          onOpen={() => onOpenThread(cell.thread.id)}
                          onOpenThread={onOpenThread}
                        />
                        </div>
                      );
                    })}
                    {chip === undefined ? null : (
                      <div
                        data-cell
                        data-variant="mini"
                        style={{ width: MINI.w, height: MINI.h }}
                        className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/30"
                      >
                        <span className="text-[11px] font-medium text-muted-foreground">
                          +{chip} more
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
        {/* Trailing spacer: enough room for a full viewport past the last
            lane; grows when a pin target would otherwise clamp. */}
        <div
          ref={spacerRef}
          aria-hidden
          style={{ width: spacerW }}
          className="shrink-0 transition-[width] duration-200"
        />
      </div>
    </div>
  );
}