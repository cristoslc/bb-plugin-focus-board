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
import { grandchildCountFor } from "./nesting";
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
/** Snap target: lanes rest flush against the rail (rail + gap + 1px kiss). */
const SNAP_MARGIN = RAIL_W + RAIL_TO_LANE_GAP + 1;
/** Board-level CSS snap; muted inline during pin glides. */
const SNAP_TYPE = "x mandatory";

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
  return (
    <div
      role="radiogroup"
      aria-label="Lane order"
      className="flex h-6 items-center self-start rounded-md border border-border bg-background p-0.5 text-[11px] font-medium"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "recency"}
        onClick={() => onChange("recency")}
        className={cn(
          "rounded px-1.5 py-0.5 transition-colors",
          value === "recency"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Recency
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "project"}
        onClick={() => onChange("project")}
        className={cn(
          "rounded px-1.5 py-0.5 transition-colors",
          value === "project"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        By project
      </button>
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
  const flatRef = useRef<{ lane: ParentLane; sectionLabel: string | null }[]>([]);
  const layoutRef = useRef<ReturnType<typeof computeParentLaneLayout> | null>(null);
  const viewportRef = useRef(0);
  const frozenTotalRef = useRef(0);
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

    const nearestLane = () => {
      const widths = layoutRef.current?.laneWidths ?? [];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < widths.length; i += 1) {
        const dist = Math.abs(el.scrollLeft - (predictedStart(i, widths, RAIL_W) - 1));
        if (dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      }
      return best;
    };

    const assign = (laneIndex: number) => {
      glidingRef.current = false;
      glideLaneRef.current = null;
      glideTargetRef.current = null;
      pendingLockRef.current = null;
      if (el.style.scrollSnapType !== "") el.style.scrollSnapType = "";
      if (laneIndex !== geoIdxRef.current) {
        prevRectsRef.current = captureCardRects(el);
        frozenTotalRef.current = layoutRef.current?.totalWidth ?? 0;
        geoIdxRef.current = laneIndex;
        setGeoIdx(laneIndex);
      }
      releasedRef.current = false;
      setReleased(false);
    };

    const glideCheck = () => {
      if (
        !glidingRef.current ||
        glideLaneRef.current === null ||
        glideTargetRef.current === null
      ) {
        return;
      }
      if (Math.abs(el.scrollLeft - glideTargetRef.current) <= 3) {
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
        predictedStart(laneIndex, predicted.laneWidths, RAIL_W) - 1,
      );
      ensureReachable(target);
      glidingRef.current = true;
      glideLaneRef.current = laneIndex;
      glideTargetRef.current = target;
      // Mute the mandatory snap so CSS cannot re-align to the pre-recut
      // flush position while the glide approaches the predicted one.
      el.style.scrollSnapType = "none";
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
      if (laneIndex === geoIdxRef.current && !releasedRef.current) return;
      pendingLockRef.current = laneIndex;
      releasedRef.current = true;
      setReleased(true);
      settle();
    };
    lockToRef.current = lockTo;

    const onScroll = () => {
      const dx = el.scrollLeft - lastLeft;
      lastLeft = el.scrollLeft;
      if (glidingRef.current) return; // glide progress is polled by its timer
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || activeThreadId === null || activeLaneId === null) return;
    const index = flat.findIndex((entry) => entry.lane.id === activeLaneId);
    if (index >= 0) lockToRef.current(index);
    const card = el.querySelector(`[data-thread-card="${CSS.escape(activeThreadId)}"]`);
    if (card instanceof HTMLElement) {
      const cardRect = card.getBoundingClientRect();
      const boardRect = el.getBoundingClientRect();
      if (cardRect.top < boardRect.top) {
        el.scrollTop -= boardRect.top - cardRect.top;
      } else if (cardRect.bottom > boardRect.bottom) {
        el.scrollTop += cardRect.bottom - boardRect.bottom;
      }
    }
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
        node.style.transition = "transform 240ms ease";
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
  // Spacer: trailing negative space so the last lane can reach the locked
  // position. It also guarantees the pinned position stays reachable across
  // the recut's width transition: coverage is computed against the smaller
  // of the frozen and final totals (the board can only shrink mid-flip).
  const spacerMin = Math.max(0, viewportW - RAIL_W - RAIL_TO_LANE_GAP);
  const scrollLeftNow = scrollRef.current?.scrollLeft ?? 0;
  const coverageTotal = Math.min(
    frozenTotalRef.current === 0 ? layout.totalWidth : frozenTotalRef.current,
    layout.totalWidth,
  );
  const spacerW = Math.max(
    spacerMin,
    scrollLeftNow + viewportW - coverageTotal + RAIL_TO_LANE_GAP,
  );

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
            the rest minis, all sharing the same per-row band heights. */}
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
              style={{ width: laneLayout.width, scrollMarginLeft: SNAP_MARGIN }}
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
                      locked && "bg-primary/[0.04]",
                    )}
                  >
                    {cells.length === 0 && chip === undefined ? (
                      <div data-slab className="h-full min-w-4 flex-1 rounded-md bg-muted/20" aria-hidden />
                    ) : null}
                    {cells.map((cell) => (
                      <div
                        key={cell.thread.id}
                        data-key={cell.thread.id}
                        data-cell
                        data-variant={cell.variant}
                        style={{
                          width: cell.variant === "ruler" ? RULER.w : MINI.w,
                          height: cell.variant === "ruler" ? RULER.h : MINI.h,
                        }}
                        className="shrink-0 overflow-hidden rounded-md"
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
                          childCount={grandchildCountFor(cell.thread, childrenByParent)}
                          childrenByParent={childrenByParent}
                          activeThreadId={activeThreadId}
                          dimmed={dimmedIds.has(cell.thread.id)}
                          onOpen={() => onOpenThread(cell.thread.id)}
                          onOpenThread={onOpenThread}
                        />
                      </div>
                    ))}
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
      <style>{`[data-parent-board]{scroll-snap-type:${SNAP_TYPE};}[data-parent-board] > div > section{scroll-snap-align:start;}`}</style>
    </div>
  );
}