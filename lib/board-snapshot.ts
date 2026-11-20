/**
 * What survives bb re-creating the board's panel.
 *
 * The operator's report, 2026-11-17: "when the window splits/unsplits, focus
 * board reloads every time."
 *
 * The reload was the host's, and it was measured before anything was written
 * (scripts/screenshot/probe-board-remount-on-split.mjs against the installed
 * 0.49.0, evidence in docs/screenshots/probe-board-remount/):
 *
 * | transition | board root nodes | loading views | board scroll | RPC |
 * |---|---|---|---|---|
 * | split (1 → 2 panes) | 2 | 1 (1.7s) | 260 → 0 | 55 |
 * | unsplit (2 → 1) | 3 | 1 (0.9s) | 0 → 0 | 32 |
 *
 * The mechanism is a branch swap inside bb's workspace split renderer
 * (`workspace-route-CD2nP00F.js`, the component whose props are
 * `{closePane, focusPane, isSplitActive, layout, …}`): with exactly one pane it
 * returns the pane's content component on its own —
 *
 *   let Y = D.length === 1 && D[0] !== void 0 ? D[0] : null;
 *   if (Y !== null) return <>{Oe}<td content={…} paneId={Y.paneId}
 *     isSplitPane={false} … /></>;
 *
 * — and with two or more it returns the recursive pane tree instead:
 *
 *   <div ref={N} className="relative -m-4 flex …">
 *     <Wu …><ed node={T.root} … /></Wu>
 *   </div>
 *
 * Different parent element types at the same position, so React unmounts the
 * whole subtree: the board's app root is destroyed on the first split and
 * again on the last unsplit. Nothing the panel can do prevents that (the
 * panel is the thing being re-created), so the panel's job is to make the
 * re-creation invisible. That is this module: the previous instance leaves
 * behind the state it had painted and the scroll offsets the operator was
 * looking at, and the next instance starts from them instead of from empty
 * sets.
 *
 * WHERE IT LIVES, AND WHY NOT sessionStorage. The state lives in a
 * module-scope slot, so it survives exactly as long as the plugin bundle in
 * this document — which is exactly as long as a remount can happen. It is
 * never serialized (no JSON round trip on a 358-thread workspace's metadata),
 * it cannot go stale across a real page load because it does not exist then,
 * and it costs one object reference. sessionStorage would outlive the tab's
 * document and let a hard reload paint yesterday's board as if it were fresh,
 * which is the one thing a first-paint cache must not do.
 *
 * WHAT IT COSTS. One plain object per state change (the writer effect in
 * app.tsx, after every settled change) and one DOM read per panel unmount.
 * Nothing is written while the panel merely re-renders.
 *
 * WHAT IT DOES NOT DO. It never replaces a fetch. The mount fan-in in app.tsx
 * still runs on every mount, including a seeded one, because a remount can
 * follow any gap and only the server knows what changed during it; the
 * snapshot only decides what the FIRST PAINT shows, and the fetch lands on
 * rows that already read correctly instead of emptying lanes and refilling
 * them.
 *
 * Parsing is strict and a rejected snapshot is a cache miss, never a coercion
 * (the fail-loud rule, applied to a cache: a corrupt cache cannot be repaired,
 * only dropped, and dropping it just means the old, slower mount).
 */

import { parseLinkedIssues, type ThreadLink } from "./link-metadata";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { SnoozeRecord } from "./snooze";

/** Bumped when the stored shape changes; an older snapshot is a cache miss. */
export const BOARD_SNAPSHOT_VERSION = 3;

/** The done-age stamp and sweep override one thread carries. */
export interface SnapshotDoneExtra {
  readonly doneAt?: number;
  readonly keep?: boolean;
}

/** One feature group's registry row. */
export interface SnapshotGroup {
  readonly name: string;
  readonly createdAt: string;
}

/** The sweep thresholds the board read at mount. */
export interface SnapshotSweepConfig {
  readonly doneArchiveMs: number;
  readonly idleArchiveMs: number;
}

/**
 * Every piece of state the mount fan-in seeds, in plain JSON shapes (the
 * Sets become id arrays and come back as Sets).
 */
export interface BoardSnapshotData {
  readonly doneIds: readonly string[];
  readonly doneExtras: Readonly<Record<string, SnapshotDoneExtra>>;
  readonly parkIds: readonly string[];
  readonly linksByThread: Readonly<Record<string, ThreadLink[]>>;
  readonly errorAckIds: readonly string[];
  readonly snoozeRecords: Readonly<Record<string, SnoozeRecord>>;
  readonly ranks: Readonly<Record<string, readonly string[]>>;
  readonly groupRegistry: Readonly<Record<string, SnapshotGroup>>;
  readonly groupAssignments: Readonly<Record<string, string>>;
  readonly collapsedFamilies: readonly string[];
  readonly hideIdleFamilies: readonly string[];
  readonly sweepConfig: SnapshotSweepConfig;
}

/** One scroll offset, in whole pixels. */
export interface ScrollBox {
  readonly x: number;
  readonly y: number;
}

/**
 * The scroll offsets the operator was looking at: the board's own scroller and
 * each lane's card list, keyed by the lane's `data-column-id`.
 *
 * `viewportWidth` is the board scroller's own width when those offsets were
 * read. It is not needed to replay them, but it records what the position was
 * a position IN: bb re-creates the panel on a pane split, and that same
 * gesture halves the board, so a restored scroll captured at the wide pre-split
 * viewport no longer describes the narrow new one (the card the click focused
 * can fall outside it). The next mount compares the two and refits only when
 * the host resized the board under the restored position (components/board.tsx,
 * the keep-in-view effect).
 */
export interface BoardScroll {
  readonly board: ScrollBox;
  readonly viewportWidth: number;
  readonly lanes: Readonly<Record<string, ScrollBox>>;
}

export interface BoardSnapshot {
  readonly version: typeof BOARD_SNAPSHOT_VERSION;
  readonly takenAt: number;
  readonly data: BoardSnapshotData;
  readonly scroll: BoardScroll | null;
}

// --- parsing ---------------------------------------------------------------

/** The result of reading a snapshot: either the value or why it was refused. */
export type SnapshotRead =
  | { readonly snapshot: BoardSnapshot }
  | { readonly problem: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`${path}[${index}]: expected a non-empty string`);
    }
    return entry;
  });
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}: expected a finite number`);
  }
  return value;
}

function recordOf<T>(
  value: unknown,
  path: string,
  read: (entry: unknown, entryPath: string) => T,
): Record<string, T> {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = read(entry, `${path}.${key}`);
  }
  return out;
}

function readDoneExtra(value: unknown, path: string): SnapshotDoneExtra {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const doneAt = value.doneAt;
  const keep = value.keep;
  if (doneAt !== undefined) finiteNumber(doneAt, `${path}.doneAt`);
  if (keep !== undefined && typeof keep !== "boolean") {
    throw new Error(`${path}.keep: expected a boolean`);
  }
  return {
    ...(doneAt === undefined ? {} : { doneAt: doneAt as number }),
    ...(keep === undefined ? {} : { keep: keep as boolean }),
  };
}

function readSnooze(value: unknown, path: string): SnoozeRecord {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  if (typeof value.wakeAt !== "string" || value.wakeAt === "") {
    throw new Error(`${path}.wakeAt: expected an ISO stamp`);
  }
  if (typeof value.setAt !== "string" || value.setAt === "") {
    throw new Error(`${path}.setAt: expected an ISO stamp`);
  }
  return { wakeAt: value.wakeAt, setAt: value.setAt };
}

function readLinkList(value: unknown, path: string): ThreadLink[] {
  // The authoritative link parser (lib/link-metadata) decides the shape: two
  // tracker kinds with different identity fields (github repo/number, external
  // URL). A second validation here would be a second truth, and the first
  // version of this module proved the cost — it demanded an `href` on every
  // link, refused every board that carried an external chip, and dropped the
  // whole snapshot because of it.
  try {
    const parsed = parseLinkedIssues(value as JsonValue | undefined);
    if (parsed === null) throw new Error(`${path}: expected an array`);
    return parsed;
  } catch (error) {
    throw new Error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readGroup(value: unknown, path: string): SnapshotGroup {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  if (typeof value.name !== "string") throw new Error(`${path}.name: expected a string`);
  if (typeof value.createdAt !== "string") {
    throw new Error(`${path}.createdAt: expected a stamp`);
  }
  return { name: value.name, createdAt: value.createdAt };
}

function readScrollBox(value: unknown, path: string): ScrollBox {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  return {
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
  };
}

function readScroll(value: unknown, path: string): BoardScroll {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  return {
    board: readScrollBox(value.board, `${path}.board`),
    viewportWidth: finiteNumber(value.viewportWidth, `${path}.viewportWidth`),
    lanes: recordOf(value.lanes, `${path}.lanes`, readScrollBox),
  };
}

function readData(value: unknown, path: string): BoardSnapshotData {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const sweep = value.sweepConfig;
  if (!isRecord(sweep)) throw new Error(`${path}.sweepConfig: expected an object`);
  return {
    doneIds: idList(value.doneIds, `${path}.doneIds`),
    doneExtras: recordOf(value.doneExtras, `${path}.doneExtras`, readDoneExtra),
    parkIds: idList(value.parkIds, `${path}.parkIds`),
    linksByThread: recordOf(value.linksByThread, `${path}.linksByThread`, readLinkList),
    errorAckIds: idList(value.errorAckIds, `${path}.errorAckIds`),
    snoozeRecords: recordOf(value.snoozeRecords, `${path}.snoozeRecords`, readSnooze),
    ranks: recordOf(value.ranks, `${path}.ranks`, (entry, entryPath) =>
      idList(entry, entryPath),
    ),
    groupRegistry: recordOf(value.groupRegistry, `${path}.groupRegistry`, readGroup),
    groupAssignments: recordOf(value.groupAssignments, `${path}.groupAssignments`, (entry, entryPath) => {
      if (typeof entry !== "string" || entry === "") {
        throw new Error(`${entryPath}: expected a group id`);
      }
      return entry;
    }),
    collapsedFamilies: idList(value.collapsedFamilies, `${path}.collapsedFamilies`),
    hideIdleFamilies: idList(value.hideIdleFamilies, `${path}.hideIdleFamilies`),
    sweepConfig: {
      doneArchiveMs: finiteNumber(sweep.doneArchiveMs, `${path}.sweepConfig.doneArchiveMs`),
      idleArchiveMs: finiteNumber(sweep.idleArchiveMs, `${path}.sweepConfig.idleArchiveMs`),
    },
  };
}

/**
 * Read a snapshot, or say why it cannot be used. Never throws: the caller is a
 * component's first render, and a cache that throws there takes the panel down
 * for a state that only costs a slower mount.
 */
export function parseBoardSnapshot(raw: unknown): SnapshotRead {
  if (!isRecord(raw)) return { problem: "expected an object" };
  if (raw.version !== BOARD_SNAPSHOT_VERSION) {
    return { problem: `version ${String(raw.version)} is not ${BOARD_SNAPSHOT_VERSION}` };
  }
  try {
    const data = readData(raw.data, "data");
    return {
      snapshot: {
        version: BOARD_SNAPSHOT_VERSION,
        takenAt: finiteNumber(raw.takenAt, "takenAt"),
        data,
        scroll: raw.scroll === null ? null : readScroll(raw.scroll, "scroll"),
      },
    };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

// --- the slot the next instance reads --------------------------------------

/** The snapshot, module-scoped: the document's bundle lifetime is the bridge. */
let held: BoardSnapshot | null = null;

/**
 * Replace the remembered state (called by the panel's own writer effect once
 * its data has settled), keeping whatever scroll was last captured.
 */
export function rememberBoardData(data: BoardSnapshotData, now: number = Date.now()): void {
  held = {
    version: BOARD_SNAPSHOT_VERSION,
    takenAt: now,
    data,
    scroll: held?.scroll ?? null,
  };
}

/**
 * Replace the remembered scroll offsets (called by the panel's unmount
 * cleanup, while the DOM it reads is still attached), keeping the data.
 */
export function rememberBoardScroll(scroll: BoardScroll): void {
  if (held === null) {
    // A board unmounted before its first settle: the scroll is still worth
    // keeping, so the next mount restores it even though the data was never
    // snapshotted. An empty data set is honest here — it is exactly what this
    // instance had painted.
    held = {
      version: BOARD_SNAPSHOT_VERSION,
      takenAt: Date.now(),
      data: EMPTY_SNAPSHOT_DATA,
      scroll,
    };
    return;
  }
  held = { ...held, scroll };
}

/** The last state this document's board painted, or null on a first mount. */
export function recallBoard(): BoardSnapshot | null {
  if (held === null) return null;
  const read = parseBoardSnapshot(held);
  if ("problem" in read) {
    // A slot that cannot round-trip is a bug in this module, not bad input, so
    // it is loud — but the panel still mounts, on empty state.
    console.warn(`[focus-board] dropping the remount snapshot: ${read.problem}`);
    held = null;
    return null;
  }
  return read.snapshot;
}

/** Drop the remembered state (tests; nothing in the app clears it). */
export function forgetBoardSnapshot(): void {
  held = null;
}

/** The data a snapshot carries when only scroll survived (see above). */
export const EMPTY_SNAPSHOT_DATA: BoardSnapshotData = {
  doneIds: [],
  doneExtras: {},
  parkIds: [],
  linksByThread: {},
  errorAckIds: [],
  snoozeRecords: {},
  ranks: {},
  groupRegistry: {},
  groupAssignments: {},
  collapsedFamilies: [],
  hideIdleFamilies: [],
  sweepConfig: { doneArchiveMs: 0, idleArchiveMs: 0 },
};

// --- the scroll half, which needs the DOM --------------------------------

/** The board's own scroller (the horizontal/vertical lane scrollport). */
export const BOARD_SCROLLER_SELECTOR = "[data-columns-board]";

/** One lane's frame; the list inside it is the lane's own scrollport. */
export const LANE_SELECTOR = "[data-column-id]";

/** One lane's card list: `readBoardScroll` reads it, `applyBoardScroll` sets it. */
export const LANE_LIST_SELECTOR = "[data-card-list]";

function scrollBoxOf(element: Element): ScrollBox {
  return { x: Math.round(element.scrollLeft), y: Math.round(element.scrollTop) };
}

/**
 * Whether a remembered scroll holds anything to restore: any box off its rest
 * position. A board the operator never scrolled records all zeros, and on that
 * mount the board's own mount-time fit of the open card should still run —
 * there is no position to defend, and the fit is what keeps the card visible
 * when a pane opens.
 */
export function hasRestoredPosition(scroll: BoardScroll): boolean {
  const offRest = (box: ScrollBox): boolean => box.x !== 0 || box.y !== 0;
  if (offRest(scroll.board)) return true;
  return Object.values(scroll.lanes).some(offRest);
}

/**
 * Read the offsets from a painted board. Null when the root holds no board
 * scroller, which is the loading view's commit: there is nothing to remember
 * yet and remembering zeros would overwrite a real position.
 *
 * Also null for a root that is no longer in the document: a detached
 * element's `scrollTop`/`scrollLeft` read 0, and the host detaches the panel's
 * subtree in the same commit its effect cleanups run, so the last read on the
 * way out can be a wall of zeros that would overwrite the operator's real
 * position with "the top of every lane".
 */
export function readBoardScroll(root: ParentNode): BoardScroll | null {
  if (root instanceof Node && !root.isConnected) return null;
  const board = root.querySelector(BOARD_SCROLLER_SELECTOR);
  if (board === null) return null;
  const lanes: Record<string, ScrollBox> = {};
  for (const lane of Array.from(root.querySelectorAll(LANE_SELECTOR))) {
    const id = lane.getAttribute("data-column-id");
    const list = lane.querySelector(LANE_LIST_SELECTOR);
    if (id === null || list === null) continue;
    lanes[id] = scrollBoxOf(list);
  }
  return {
    board: scrollBoxOf(board),
    // The visible width the box had when these offsets were read, rounded the
    // same way the keep-in-view fit compares it (components/board.tsx). The
    // rect, not clientWidth: it is the very number the fit's width observer
    // reads, so a split's resize lands on the same integer on both sides.
    viewportWidth: Math.round(board.getBoundingClientRect().width),
    lanes,
  };
}

/**
 * Put the offsets back on a freshly painted board. Returns how many scrolled
 * boxes it restored, so a caller (and a test) can tell "restored" from
 * "restored nothing".
 *
 * A remembered lane that no longer exists is skipped, never re-created: the
 * operator may have hidden it, changed grouping, or filtered it out, and a
 * positioned scroll for a lane that is not on screen means nothing.
 */
export function applyBoardScroll(root: ParentNode, scroll: BoardScroll): number {
  const board = root.querySelector(BOARD_SCROLLER_SELECTOR);
  let restored = 0;
  if (board !== null) {
    board.scrollLeft = scroll.board.x;
    board.scrollTop = scroll.board.y;
    restored += 1;
  }
  for (const lane of Array.from(root.querySelectorAll(LANE_SELECTOR))) {
    const id = lane.getAttribute("data-column-id");
    const list = lane.querySelector(LANE_LIST_SELECTOR);
    if (id === null || list === null) continue;
    const box = scroll.lanes[id];
    if (box === undefined) continue;
    list.scrollLeft = box.x;
    list.scrollTop = box.y;
    restored += 1;
  }
  return restored;
}
