/**
 * Operator-assisted E2E runner: drives a YAML suite from tests/manual/
 * against the real app in the screenshot harness.
 *
 * Every gesture is a real DOM event. The drag dispatches dragstart on the
 * card's anchor (so the card's own handler writes the payload), dragover on
 * the target at the chosen half's coordinates, then drop — which is the
 * sequence a trackpad produces, and the sequence the board's handlers are
 * written against.
 *
 * Usage:
 *   npm run uat                       # runs every suite in tests/manual
 *   npm run uat -- tests/manual/uat-rank.yaml
 *
 * One-time browser setup: the runner uses the system Chrome, so nothing is
 * downloaded. Set CHROME_PATH if Chrome is not in the default place.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { parse } from "yaml";
import { startHarness } from "./harness.mjs";
import { installSettleInstrument } from "./settle-clock.mjs";
import {
  NETWORK_PRESETS,
  parseLoadConditions,
  parseManualFlag,
  partitionSuites,
  withLoadQuery,
} from "./load-conditions.mjs";
import { notifyGateFailure } from "../release-notify.mjs";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Two levels up from scripts/uat/ is the repo root.
const REPORT_DIR = fileURLToPath(new URL("../../docs/uat/", import.meta.url));

const suites = process.argv.slice(2).filter((a) => !a.startsWith("-"));
// No args → every suite in tests/manual, in name order (the README's
// documented behavior); args name individual suites.
const discovered =
  suites.length > 0
    ? suites
    : (await readdir(fileURLToPath(new URL("../../tests/manual", import.meta.url))))
        .filter((name) => name.endsWith(".yaml"))
        .sort()
        .map((name) => fileURLToPath(new URL(`../../tests/manual/${name}`, import.meta.url)));

// The `manual: true` opt-in (issue #265/#266): a suite marked manual is
// runnable on demand but is NOT part of the bare-sweep default, so
// `npm run uat` and the `release-safety` gate that calls it never run a gate
// whose budget is currently red. Naming the file explicitly on the command
// line always runs it, marked or not.
//
// A suite's flag lives at its top level, so the file has to be read here to
// decide. Only the default (no-args) path filters: an explicit argument is
// the operator asking for exactly that suite.
let suiteFiles = discovered;
let skippedManual = [];
if (suites.length === 0) {
  const entries = await Promise.all(
    discovered.map(async (file) => ({
      file,
      manual: parseManualFlag(parse(await readFile(file, "utf8"))),
    })),
  );
  const { run, skipped } = partitionSuites(entries);
  suiteFiles = run.map((entry) => entry.file);
  skippedManual = skipped.map((entry) => entry.file);
}

/**
 * A DataTransfer that enforces the browser's protected mode, which a plain
 * `new DataTransfer()` does NOT.
 *
 * In a real drag the payload is write-only until the drop: `getData` returns
 * "" during `dragover`, and only `setData` (dragstart) / `getData` (drop,
 * dragend) are honoured. `types` stays readable throughout. A harness built
 * on a bare DataTransfer therefore lets code that reads the payload mid-drag
 * look like it works, when in the product it silently sees nothing — which is
 * exactly how a whole-column reorder shipped and then did nothing for the
 * operator. Every drag in this suite runs through here.
 *
 * Installed into the page (not the Node closure) because the drag helpers run
 * in the browser and cannot see anything defined out here.
 */
function installProtectedDrag() {
  window.__protectedDrag = () => {
    // A real DataTransfer, because DragEvent's constructor rejects a plain
    // object. Only `getData` is shadowed, to reproduce protected mode.
    const transfer = new DataTransfer();
    const realGetData = transfer.getData.bind(transfer);
    const reading = { on: false };
    Object.defineProperty(transfer, "getData", {
      configurable: true,
      value: (format) => (reading.on ? realGetData(format) : ""),
    });
    // Test hook: the browser flips these rules per event type, so the harness
    // flips them too. `types` is deliberately left real and readable.
    transfer._armRead = (on) => {
      reading.on = on;
    };
    return transfer;
  };
}
/**
 * Page-context drag. Runs in the browser because HTML5 drag needs a real
 * DataTransfer and coordinates on the target's own box.
 */
const pageDrag = ({ from, to, edge }) => {
  const slot = (id) => document.querySelector(`li[data-rank-slot="${id}"]`);
  const source = slot(from);
  const target = slot(to);
  if (!source) throw new Error(`no drop slot for source ${from}`);
  if (!target) return { dropped: false, reason: `target ${to} is not a ranked slot` };
  const anchor = source.querySelector("a[draggable]");
  if (!anchor) throw new Error(`source ${from} has no draggable anchor`);

  const transfer = window.__protectedDrag();
  transfer._armRead(true); // dragstart: the writer may read back what it wrote
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  const carried = transfer.types.some((type) => type.includes("focus-board-rank"));
  if (!carried) return { dropped: false, reason: "drag payload carried no rank marker" };

  const box = target.getBoundingClientRect();
  // The board's own axis marker picks the split: a vertical lane splits
  // before/after on the pointer's y (top/bottom halves); a horizontal lane
  // row splits on the pointer's x (left/right thirds) and ignores the y.
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const clientX = horizontal
    ? edge === "onto"
      ? box.left + box.width * 0.5
      : edge === "before"
        ? box.left + box.width * 0.2
        : box.left + box.width * 0.8
    : box.left + 8;
  const clientY = horizontal
    ? box.top + 8
    : edge === "onto"
      ? box.top + box.height * 0.5
      : edge === "before"
        ? box.top + box.height * 0.2
        : box.top + box.height * 0.8;
  const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY };

  // Protected mode: the payload is unreadable while the pointer moves.
  transfer._armRead(false);
  const over = new DragEvent("dragover", point);
  target.dispatchEvent(over);
  // A drop is only permitted if some dragover handler called preventDefault.
  const dropAllowed = over.defaultPrevented;

  transfer._armRead(true);
  const drop = new DragEvent("drop", point);
  target.dispatchEvent(drop);
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  return { dropped: true, dropAllowed };
};

/** Thread ids a lane shows, in display order, from the cards' hrefs. */
const pageOrder = (columnId) => {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (!section) return null;
  const idOf = (el) => el.getAttribute("href")?.split("/").pop() ?? "?";
  return {
    // Top-level cards only: nested family rows are <li> too, and would
    // otherwise be read as column members. A group frame counts as its
    // members in their rendered order — the operator sees the member CARD
    // list that way (the frame is a container, not a column member), and
    // hiding the frame's members behind the lead made the one-frame-per-
    // group lane read one card short.
    ids: [...section.querySelectorAll(":scope > div > ul > li")].flatMap((li) =>
      li.getAttribute("data-group-box") !== null
        ? [...li.querySelectorAll(":scope > div > ul > li")].map((slot) =>
            idOf(slot.querySelector("a[href]")),
          )
        : idOf(li.querySelector("a[href]")),
    ),
    // Whether the lane has a STORED order (seed-on-first-intent: created by
    // the first drop, so this is false on a fresh install).
    ranked: section.getAttribute("data-column-ordered") === "true",
  };
};

/** Drag a card onto a whole column, not a card within it (the Done lane). */
const pageDragToColumn = ({ from, column }) => {
  const anchor = document.querySelector(`li[data-rank-slot="${from}"] a[draggable]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  if (!anchor || !section) throw new Error(`drag_to_column: missing ${from} or ${column}`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  const box = section.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.bottom - 12,
  };
  section.dispatchEvent(new DragEvent("dragover", point));
  section.dispatchEvent(new DragEvent("drop", point));
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true };
};

/**
 * Drag a nested child row (or any card anchor) onto a whole column's floor.
 * Split from `pageDragToColumn` because the child anchor is NOT inside its
 * own li[data-rank-slot] — it renders inside the parent's nested rows — so
 * the slot-anchored lookup cannot find it.
 */
const pageDragChildToFloor = ({ from, column }) => {
  const anchor = document.querySelector(`a[data-thread-card="${from}"][draggable]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  if (!anchor || !section) throw new Error(`drag_child_to_floor: missing ${from}=${anchor != null} or ${column}=${section != null}`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = section.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.bottom - 12,
  };
  section.dispatchEvent(new DragEvent("dragover", point));
  section.dispatchEvent(new DragEvent("drop", point));
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true, dropAllowed: true };
};

/** Hover a child over a column floor: does the amber family affordance show? */
const pageFloorAmber = ({ from, column }) => {
  const anchor = document.querySelector(`a[data-thread-card="${from}"][draggable]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  if (!anchor || !section) throw new Error(`floor_amber: missing ${from} or ${column}`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = section.getBoundingClientRect();
  section.dispatchEvent(new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.bottom - 12,
  }));
  const ambered = [...section.classList].some((cls) => cls.startsWith("ring-amber"));
  const result = {
    shown: ambered,
    reason: ambered
      ? "floor rings amber for a family detach drop"
      : `no amber on the floor (classes: ${[...section.classList].join(" ")})`,
  };
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return result;
};

/**
 * A dot gesture on the collapsed strip: dragstart on the source dot with a
 * REAL DataTransfer (the dot's dragstart handler writes the dropped id and
 * the dot mark into it — a bare object cannot carry those into the other
 * handlers), then dragover and drop on the target dot. `edge` picks the
 * hovered dot's half, after by default. Split from `pageDragChildToFloor`
 * because the source is a BUTTON, not an anchor, and the events never
 * carry clientX/undefined or anything in between.
 */
const pageDragDotToDot = ({ from, to, edge }) => {
  const fromDot = document.querySelector(`button[data-child-dot="${from}"]`);
  const toDot = document.querySelector(`button[data-child-dot="${to}"]`);
  if (!fromDot || !toDot) throw new Error(`drag_dot_to_dot: missing ${from}=${fromDot !== null} or ${to}=${toDot !== null}`);
  const dt = new DataTransfer();
  fromDot.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = toDot.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width * (edge === "before" ? 0.25 : 0.75),
    clientY: box.top + box.height / 2,
  };
  const over = new DragEvent("dragover", point);
  toDot.dispatchEvent(over);
  toDot.dispatchEvent(new DragEvent("drop", point));
  fromDot.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true };
};

/**
 * A dot dragged OFF the strip to a column floor: crossing the boundary in a
 * real browser fires dragovers whose coordinates already sit far outside
 * the strip's box — the handoff runs then. The gesture mirrors that
 * stream: an out-of-box dragover (escape), an authorizing dragover at the
 * floor (the card-tail rules now decide), the drop (un-parent write), and
 * the dragend on the source dot, which unwinds the card lifecycle.
 */
const pageDragDotToFloor = ({ from, column }) => {
  const fromDot = document.querySelector(`button[data-child-dot="${from}"]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  if (!fromDot || !section) throw new Error(`drag_dot_to_floor: missing ${from}=${fromDot !== null} or ${column}=${section !== null}`);
  const dt = new DataTransfer();
  fromDot.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = section.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.bottom - 12,
  };
  // The escape: the same boundaring dragover real browsers stream the
  // instant the pointer leaves the strip's box.
  section.dispatchEvent(new DragEvent("dragover", point));
  // The authorizing + drop: the card-tail rules now decide (detach).
  section.dispatchEvent(new DragEvent("dragover", point));
  section.dispatchEvent(new DragEvent("drop", point));
  fromDot.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true };
};

/**
 * A CARD dragged INTO a collapsed family's dot field (issue #249, goal 6):
 * dragstart on the source card's anchor, then dragover + drop dispatched at
 * the family's own strip. The strip's handlers claim the events
 * (stopPropagation keeps the card's own nest zone off the dots), the hover
 * arms tooltip + ghost, and the drop children the card under the family's
 * root through the existing reparent write.
 */
const pageDragCardToStrip = ({ from, strip_of }) => {
  const anchor =
    document.querySelector(`li[data-rank-slot="${from}"] a[draggable]`) ??
    document.querySelector(`a[data-thread-card="${from}"][draggable]`);
  const strip = document.querySelector(
    `[data-thread-card="${strip_of}"] [data-child-thread-dots]`,
  );
  if (!anchor || !strip) throw new Error(`drag_card_to_strip: missing ${from}=${anchor !== null} or strip ${strip_of}=${strip !== null}`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = strip.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  strip.dispatchEvent(new DragEvent("dragover", point));
  strip.dispatchEvent(new DragEvent("drop", point));
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true };
};

/**
 * A DOT hover over the floor, mid-gesture: does the GENESIS morph show? The
 * home card's soft amber ring is the dragged member's in-place card reading
 * (`data-dot-escape`), set the instant the dragover reports coordinates
 * outside the strip's box. The drag ends on the dot, unwinding.
 */
const pageDotEscape = ({ from, column }) => {
  const fromDot = document.querySelector(`button[data-child-dot="${from}"]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  if (!fromDot || !section) throw new Error(`dot_escape: missing ${from} or ${column}`);
  const dt = new DataTransfer();
  fromDot.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = section.getBoundingClientRect();
  section.dispatchEvent(new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.right + 30,
    clientY: box.top + 40,
  }));
  const escaped = document.querySelector("[data-thread-card][data-dot-escape]") !== null;
  const result = {
    shown: escaped,
    reason: escaped
      ? "the dragged dot's family card wears the morph ring"
      : "no morph ring on any family card",
  };
  fromDot.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return result;
};

/**
 * Drop a card (nested child row or top-level) on a column's TITLE strip: the
 * header sits inside the section, so the drop bubbles to the section's own
 * floor handlers — detach for a child, the column's normal floor action for
 * a top-level card. The header is hovered, not the floor: no scroll needed.
 */
const pageDragChildToHeader = ({ from, column }) => {
  // The dragged card may be TOP-LEVEL (its anchor is inside the ranked
  // slot's li, not a nested row) or a nested child row (anchor carries
  // data-thread-card). Try both sources.
  const anchor =
    document.querySelector(`li[data-rank-slot="${from}"] a[draggable]`) ??
    document.querySelector(`a[data-thread-card="${from}"][draggable]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  const header = section?.querySelector("header");
  if (!anchor || !header) throw new Error(`drag_child_to_header: missing ${from}=${anchor != null} or ${column} header=${header != null}`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = header.getBoundingClientRect();
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  header.dispatchEvent(new DragEvent("dragover", point));
  header.dispatchEvent(new DragEvent("drop", point));
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return { ok: true, dropAllowed: true };
};

/** Header hover probe: amber ring on the title strip, and it grew while the drag flew. */
const pageHeaderAmber = ({ from, column }) => {
  const anchor = document.querySelector(`a[data-thread-card="${from}"][draggable]`);
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  const header = section?.querySelector("header");
  if (!anchor || !header) throw new Error(`header_amber: missing ${from} or ${column} header`);
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const box = header.getBoundingClientRect();
  header.dispatchEvent(new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  }));
  const classes = [...header.classList];
  const result = {
    shown: classes.some((cls) => cls.startsWith("ring-amber")),
    grown: classes.includes("pb-2.5"),
    reason: classes.some((cls) => cls.startsWith("ring-amber"))
      ? "header rings amber for a family detach drop"
      : `no amber on the header (classes: ${classes.join(" ")})`,
  };
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return result;
};

/**
 * Hover a card edge with a live drag, then (optionally) have the pointer
 * CROSS OUT of the slot toward the column's title strip, exactly as the
 * browser reports the boundary crossing (dragleave on the slot with the
 * header as relatedTarget). Two keys, one page fn: leave=false sets the
 * insertion line and keeps the drag alive; leave=true fires the crossing.
 * The leave stage checks the line was actually painted before it declares
 * anything cleared — a probe that proves nothing is worse than none.
 */
const pageHoverHeader = ({ from, to, edge, column, leave }) => {
  const source = document.querySelector(`li[data-rank-slot="${from}"]`);
  const target = to !== undefined ? document.querySelector(`li[data-rank-slot="${to}"]`) : null;
  const section = document.querySelector(`section[data-column-id="${column}"]`);
  const header = section?.querySelector("header");
  if (!source || (to !== undefined && !target) || !header) {
    throw new Error(`hover_header: missing from/${from} to/${to} or ${column} header`);
  }
  const transfer = window.__protectedDrag();
  const anchor = source.querySelector("a[draggable]");
  transfer._armRead(true);
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  transfer._armRead(false);
  const lineOn = target ?? source;
  if (!leave) {
    const box = lineOn.getBoundingClientRect();
    // Axis-aware like every drop: a vertical lane splits on y, a horizontal
    // lane row on x (its y is ignored by the drop-zone math).
    const horizontal =
      document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
      "horizontal";
    const clientX = horizontal
      ? edge === "before" ? box.left + box.width * 0.2 : box.left + box.width * 0.8
      : box.left + 8;
    const clientY = horizontal ? box.top + 8 : edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
    const over = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX,
      clientY,
    });
    lineOn.dispatchEvent(over);
    return { stage: "hover", dropAllowed: over.defaultPrevented };
  }
  const classes = [...lineOn.classList];
  // The insertion line rides the flow edge: the cross-axis (inset-*) is
  // what marks it, so a horizontal lane's line matches inset-y-0.
  const wasShown = classes.some((cls) => cls.includes("inset-x-0") || cls.includes("inset-y-0"));
  lineOn.dispatchEvent(
    new DragEvent("dragleave", { bubbles: true, dataTransfer: transfer, relatedTarget: header }),
  );
  const box = header.getBoundingClientRect();
  header.dispatchEvent(
    new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  return { stage: "leave", wasShown };
};

/**
 * Hover a card's chosen half. Split from `pageLineShown` because the dragover
 * sets React state: reading the computed style in the same task would sample
 * the DOM before the commit.
 */
const pageHover = ({ from, to, edge }) => {
  const slot = (id) => document.querySelector(`li[data-rank-slot="${id}"]`);
  const source = slot(from);
  const target = slot(to);
  if (!source || !target) throw new Error(`hover: missing slot (${from} → ${to})`);
  const transfer = window.__protectedDrag();
  const anchor = source.querySelector("a[draggable]");
  transfer._armRead(true);
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  const box = target.getBoundingClientRect();
  // Axis-aware split, same rule pageDrag runs: vertical lanes on y,
  // horizontal lane rows on x (the row's y is ignored by the zone math).
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const clientX = horizontal
    ? edge === "onto" ? box.left + box.width * 0.5 : edge === "before" ? box.left + box.width * 0.2 : box.left + box.width * 0.8
    : box.left + 8;
  const clientY = horizontal
    ? box.top + 8
    : edge === "onto" ? box.top + box.height * 0.5 : edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
  transfer._armRead(false);
  const over = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
    clientX,
    clientY,
  });
  target.dispatchEvent(over);
  return { ok: true, dropAllowed: over.defaultPrevented };
};

/** Is an insertion line rendered on that card's chosen edge? */
const pageLineShown = ({ to, edge }) => {
  const target = document.querySelector(`li[data-rank-slot="${to}"]`);
  if (!target) return { shown: false, reason: "no slot" };
  // The line reads the flow axis: a vertical lane's line spans the width
  // (height is the meaningful size), a horizontal lane row's line is a
  // vertical bar whose width is the meaningful size.
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const style = getComputedStyle(target, edge === "before" ? "::before" : "::after");
  const size = horizontal ? style.width : style.height;
  return {
    shown: style.content !== "none" && size !== "0px" && style.display !== "none",
    reason: `content=${style.content} size=${size}`,
  };
};

/**
 * Is the nest ring rendered around that card? The middle third of a card is
 * the drop-ONTO zone; while hovering it the card rings (and NO insertion
 * line shows, because a drop there nests instead of reordering).
 */
const pageNestRing = ({ to }) => {
  const target = document.querySelector(`li[data-rank-slot="${to}"]`);
  if (!target) return { shown: false, reason: "no slot" };
  // The family (nest) zone is amber on purpose — lane edges keep the theme's
  // ring color, so the probe must match the amber ring specifically to verify
  // the two affordances stay visually distinct.
  const ringed = [...target.classList].some((cls) => cls.startsWith("after:ring-amber"));
  return {
    shown: ringed,
    reason: ringed
      ? "card rings for a nest drop"
      : `no ring on the slot (classes: ${[...target.classList].join(" ")})`,
  };
};

/**
 * Depth-2 (three-tier) sub-row probe (issue #192's UAT coverage): the
 * grandchild row renders inside the `[data-child-sub-rows]` list that hangs
 * under its parent row's list item, and indents — the sub-row's left edge
 * sits right of its parent row's in Chrome's real layout (jsdom can wrap
 * text but cannot measure where an indent lands).
 */
const pageSubRow = ({ id, under }) => {
  const parentRow = document.querySelector(`[data-nested-rows] [data-thread-card="${under}"]`);
  if (!parentRow) {
    return { present: false, indented: false, indentPx: 0, reason: `no nested row for parent ${under}` };
  }
  const row = document.querySelector(`[data-child-sub-rows] [data-thread-card="${id}"]`);
  if (!row) {
    return { present: false, indented: false, indentPx: 0, reason: `no sub-row ${id}` };
  }
  const underSameParent = parentRow.closest("li")?.contains(row) ?? false;
  if (!underSameParent) {
    return { present: true, indented: false, indentPx: 0, reason: `sub-row ${id} renders under a different parent` };
  }
  const indentPx = row.getBoundingClientRect().left - parentRow.getBoundingClientRect().left;
  return {
    present: true,
    indented: indentPx > 0,
    indentPx: Math.round(indentPx * 100) / 100,
    reason: `sub-row indents ${Math.round(indentPx * 100) / 100}px under its parent row`,
  };
};

/**
 * A nested row's own condensed chips (PR #194, the #191 behavior): the row
 * renders `[data-child-chip-rows]` with inert id spans (`data-ticket-id`).
 * The probe reports which id texts the row carries and which tier it lives
 * in — a sub-row (grandchild) chip is the depth-2 case.
 */
const pageChildChip = ({ id, text }) => {
  const row = document.querySelector(`[data-nested-rows] [data-thread-card="${id}"]`);
  if (!row) return { shown: false, tier: null, chips: [], reason: `no nested row ${id}` };
  const chips = [...row.querySelectorAll("[data-child-chip-rows] [data-ticket-id]")].map(
    (el) => el.getAttribute("data-ticket-id"),
  );
  const tier = row.closest("[data-child-sub-rows]") !== null ? "sub-row" : "child-row";
  return {
    shown: chips.includes(text),
    tier,
    chips,
    reason: chips.length > 0 ? `row chips: ${chips.join(", ")}` : "the row carries no chips",
  };
};

/**
 * The family card's right gutter (issue #192): every content surface —
 * title, project line, the anchor's time stamp, chip rows, and every row
 * tier's box — must stop short of the card's right edge by at least
 * minInset px, and the card box must stop short of its lane's right edge.
 * The probe fails loudly with one line per leaking surface.
 */
const pageRightGutter = ({ card, minInset }) => {
  const cardEl = document.querySelector(`[data-thread-card="${card}"]`);
  if (!cardEl) return { ok: false, failures: [`no such card (${card})`] };
  const lane = cardEl.closest("[data-column-id]") ?? cardEl.closest("[data-lane-id]");
  if (!lane) return { ok: false, failures: ["the card has no lane ancestor"] };
  const cardRect = cardEl.getBoundingClientRect();
  const laneRect = lane.getBoundingClientRect();
  const failures = [];
  if (cardRect.right >= laneRect.right) {
    failures.push(`card box crosses the lane's right edge by ${Math.round(cardRect.right - laneRect.right)}px`);
  }
  const surfaces = [
    ["title", "[data-title]"],
    ["project-line", null],
    ["time", "a span.ml-auto"],
    ["chip-rows", "[data-provider-row]"],
    ["nested-rows", "[data-nested-rows]"],
    ["nested-child-row", "[data-nested-rows] [data-thread-card]"],
    ["sub-rows", "[data-child-sub-rows]"],
    ["sub-row", "[data-child-sub-rows] [data-thread-card]"],
  ];
  for (const [name, sel] of surfaces) {
    let node = null;
    if (name === "project-line") {
      // The anchor's second <p> — title's following sibling.
      const title = cardEl.querySelector("[data-title]");
      node = title?.nextElementSibling ?? null;
    } else if (name === "time") {
      // The card's OWN anchor is its first <a>; its trailing time stamp.
      node = cardEl.querySelector("a span.ml-auto");
    } else {
      node = cardEl.querySelector(sel);
    }
    if (!node) continue;
    const inset = cardRect.right - node.getBoundingClientRect().right;
    if (inset < minInset) {
      failures.push(`${name} sits ${Math.round(inset * 100) / 100}px from the card's right edge`);
    }
  }
  return { ok: failures.length === 0, failures };
};

/**
 * Issue #104's chip placement contract, measured in the real card: the issues
 * region stays inside the midpoint + gutter cap (or claims the whole row when
 * it holds a single ticket name), the PRs region ends at the row's right edge
 * and is bumped to the next row only when the issues claim the room, and the
 * tag block is right-anchored at no more than 75% of the row, under the PR
 * when there is one. Also asserts the id text never breaks mid-token, that a
 * lone long id scaled instead of breaking, and that a tag keeps its text size
 * and only breaks at its hyphens.
 */
const pageChipPlacement = ({ card, cap, prBumped, tagsUnderPr, tagsSameRow, shrinks }) => {
  const cardEl = document.querySelector(`[data-thread-card="${card}"]`);
  if (!cardEl) return { ok: false, failures: [`no such card (${card})`] };
  const area = cardEl.querySelector("[data-ticket-chip-area]");
  if (!area) return { ok: false, failures: ["the card has no chip area"] };
  const areaRect = area.getBoundingClientRect();
  const style = getComputedStyle(area);
  const left = areaRect.left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
  const right = areaRect.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth);
  const width = right - left;
  const midpoint = left + width / 2;
  const region = (name) => cardEl.querySelector(`[data-ticket-chip-region="${name}"]`);
  const rect = (el) => (el === null ? null : el.getBoundingClientRect());
  const issues = rect(region("issues"));
  const pulls = rect(region("pulls"));
  const tags = rect(region("tags"));
  const failures = [];

  const ids = Array.from(cardEl.querySelectorAll("[data-ticket-id]")).filter(
    (el) => el.closest("[data-ticket-tag]") === null,
  );
  for (const id of ids) {
    const box = id.getBoundingClientRect();
    if (box.height > 18) failures.push(`id ${id.textContent} wraps across lines (${Math.round(box.height)}px tall)`);
    if (!(getComputedStyle(id).whiteSpace ?? "").includes("nowrap")) {
      failures.push(`id ${id.textContent} may break mid-token`);
    }
  }

  if (cap === "midpoint") {
    if (issues === null) failures.push("no issues region");
    else if (issues.right > midpoint + 1) {
      failures.push(`issues region crosses the midpoint (right ${Math.round(issues.right)} > ${Math.round(midpoint)})`);
    }
  } else if (issues !== null && issues.right > right + 1) {
    failures.push("issues region overruns the row");
  }

  if (issues !== null && pulls !== null && prBumped !== undefined) {
    const bumped = pulls.top > issues.top + 2;
    if (bumped !== prBumped) failures.push(`PR ${bumped ? "was" : "was not"} bumped to the next row`);
  }
  if (pulls !== null && pulls.right < right - 2) {
    failures.push(`pulls region is not right-anchored (${Math.round(pulls.right)} < ${Math.round(right)})`);
  }

  const tagIds = Array.from(cardEl.querySelectorAll("[data-ticket-tag] [data-ticket-id]"));
  for (const tag of tagIds) {
    if (Number.parseFloat(getComputedStyle(tag).fontSize) < 9.9) {
      failures.push(`tag ${tag.textContent} shrank its text`);
    }
    if (!(tag.textContent ?? "").includes("-") && tag.getClientRects().length > 1) {
      failures.push(`tag ${tag.textContent} broke with no hyphen to break at`);
    }
  }
  if (tags !== null) {
    if (tags.right < right - 2) failures.push("tag block is not right-anchored");
    if (tags.width > width * 0.75 + 1) failures.push(`tag block claims ${Math.round((tags.width / width) * 100)}% of the row`);
    if (tagsUnderPr === true && pulls !== null && tags.top < pulls.bottom - 1) {
      failures.push("tag block is not below the PR block");
    }
    if (tagsSameRow === true && issues !== null && Math.abs(tags.top - issues.top) > 2) {
      failures.push("tag block did not ride the first row");
    }
  } else if (tagsUnderPr === true || tagsSameRow === true) {
    failures.push("no tags region");
  }

  if (shrinks === true) {
    const flow = cardEl.querySelector("[data-ticket-ids]");
    const size = flow === null ? 10 : Number.parseFloat(getComputedStyle(flow).fontSize);
    if (!(size < 9.9)) failures.push(`the long id did not scale (${size}px)`);
  }

  return { ok: failures.length === 0, failures, width: Math.round(width) };
};

/**
 * A drop whose payload carries no card id — the shape of the failure where the
 * board cannot attribute the gesture to a card. The rank type is still set, so
 * the drop is accepted, but the id is empty.
 */
const pageDragUnidentified = ({ from, to, edge }) => {
  const slot = (id) => document.querySelector(`li[data-rank-slot="${id}"]`);
  const source = slot(from);
  const target = slot(to);
  if (!source || !target) throw new Error(`drag: missing slot (${from} → ${to})`);
  const anchor = source.querySelector("a[draggable]");
  const transfer = window.__protectedDrag();
  transfer._armRead(true);
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  // Strip the id, keeping the lane marker: the lane is known, the card is not.
  transfer.clearData("text/focus-board-id");
  const box = target.getBoundingClientRect();
  // Axis-aware split, same rule pageDrag runs: vertical lanes on y,
  // horizontal lane rows on x.
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const clientX = horizontal
    ? edge === "onto" ? box.left + box.width * 0.5 : edge === "before" ? box.left + box.width * 0.2 : box.left + box.width * 0.8
    : box.left + 8;
  const clientY = horizontal
    ? box.top + 8
    : edge === "onto" ? box.top + box.height * 0.5 : edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
  const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY };
  transfer._armRead(false);
  target.dispatchEvent(new DragEvent("dragover", point));
  transfer._armRead(true);
  target.dispatchEvent(new DragEvent("drop", point));
  return { ok: true };
};

const pageKey = ({ card, key, alt }) => {
  const target = document.querySelector(`li[data-rank-slot="${card}"] a[href]`);
  if (!target) throw new Error(`key: no focusable card ${card}`);
  target.focus();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, altKey: alt, bubbles: true, cancelable: true }),
  );
  return true;
};

const pageLiveRegion = () =>
  [...document.querySelectorAll('[aria-live="polite"]')].map((el) => el.textContent?.trim() ?? "").join(" | ");

/**
 * The thread card the board itself considers active (`aria-current="true"`),
 * plus whether it is actually visible in the viewport: a card that history
 * restored but that no scroll brought into view would read as a board that
 * forgot what the user was doing. The marker lives on the card's anchor,
 * inside the element carrying data-thread-card.
 */
const pageActiveCard = () => {
  // Resolve the marker the way the board's own card lookups do
  // (firstRealCard): a transport ghost renders the same anchor in the OLD
  // lane — DOM-first on a forward move — and must never satisfy the lookup,
  // or the "active card visible" check reads the dissolving decoration the
  // destination scroll just left offscreen (issue #105).
  for (const marker of document.querySelectorAll('a[aria-current="true"]')) {
    if (marker.closest("[data-transport-ghost]") !== null) continue;
    const card = marker.closest("[data-thread-card]");
    if (!card) continue;
    const rect = card.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    return { id: card.getAttribute("data-thread-card"), visible };
  }
  return { id: null, visible: false };
};

/** A real history back gesture, as the browser's back arrow performs it. */
const pageGoBack = () => {
  history.back();
  return { ok: true };
};

/**
 * A plain left click, programmatic because a real Puppeteer click can be
 * swallowed by an HTML5 drag interaction on the same anchor. The card's
 * handlers live on its anchor; a template wraps the anchor in a div that
 * also carries data-thread-card, and that wrapper precedes the anchor in
 * document order — so resolve the anchor explicitly instead of trusting
 * the first attribute match.
 */
const pageClickCard = ({ card }) => {
  const host = document.querySelector(`[data-thread-card="${card}"]`);
  if (!host) throw new Error(`click: no card ${card}`);
  const el = host.matches("a[href]") ? host : host.querySelector("a[href]");
  if (!el) throw new Error(`click: card ${card} has no anchor`);
  el.click();
  return { ok: true };
};

/** Click a control by accessible name: an aria-label, else the button's own
 * text. The payload is either the label string itself (the `gestures:` list
 * spells `- { click_aria: "Label" }`) or `{ label: "…" }`. */
const pageClickAria = (payload) => {
  const label = typeof payload === "string" ? payload : payload?.label;
  const within = payload?.within;
  // `within` scopes the search to one card's subtree — the label repeats on
  // every family card ("Collapse subthreads"), so a suite folding a specific
  // family must not grab a neighbor's toggle.
  const scope = within !== undefined
    ? document.querySelector(`[data-thread-card="${CSS.escape(within)}"]`)
    : document;
  if (scope === null) throw new Error(`click_aria: within names no card (${within})`);
  const el =
    scope.querySelector(`button[aria-label="${CSS.escape(label)}"]`) ??
    scope.querySelector(`[aria-label="${CSS.escape(label)}"]`) ??
    [...scope.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label,
    );
  if (!el) throw new Error(`click_aria: nothing labelled ${label}`);
  el.click();
  return { ok: true };
};

/** Focus a labelled form control, the setup half of a `type` gesture (the
 * keystrokes themselves travel through Puppeteer's input pipeline from Node,
 * so controlled React inputs see real input events, not a value assignment).
 * `select: true` selects the field's current text first, so the typed keys
 * replace it — the rename editor opens prefilled with the group's name. */
const pageFocusLabelled = ({ label, select }) => {
  const el = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  if (!el) throw new Error(`type: nothing labelled ${label}`);
  el.focus();
  if (select === true && typeof el.select === "function") el.select();
  return { ok: true, tag: el.tagName };
};

/** Probe whether a control with this exact aria-label is on the page — the
 *  presence assertion for surfaces the page text cannot see (the search
 *  button is a labelled icon button, with no visible text of its own). */
const pageAriaProbe = (label) => {
  const el = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  return { present: el !== null };
};

/**
 * The queued-message row's touch reveal, end to end (issue #296). bb's row
 * control is `opacity-0 pointer-events-none` at rest and leans on the host's
 * `@media (hover:none)` reveal utilities to become tappable on a touch device.
 * Inside the plugin root bb's scoped plugin sheet could outrank those host
 * utilities, so the control stayed invisible and Send was unreachable. This
 * probe demands the real thing: the control must compute painted AND be the
 * element at its own center (hit-testable), the Send control must be hidden
 * first, then the probe taps the reveal, taps Send, and requires the row to go
 * away. Every check is computed-style or hit-test work in the live document,
 * so a class-presence change alone cannot satisfy it.
 */
/**
 * Where a `touch_pan` finger lands. `from` names the origin the way an
 * operator's finger would find it:
 *   { card: thr_x }                 — on a card's own body
 *   { between: [thr_a, thr_b] }     — the gap between two cards of one lane
 *                                     (the operator's case: the pan that must
 *                                     scroll instead of dragging a card)
 *   { column: unread, empty: true } — the lane's empty card-list space
 *   { board: true }                 — the board's own padding, outside lanes
 *   { point: { x, y } }             — literal viewport coordinates
 * Returns the viewport point plus what sits under it, so a step can prove the
 * finger started where it claims to.
 */
const pageTouchPanOrigin = (from) => {
  const rect = (el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const card = (id) => {
    const el = document.querySelector(`[data-thread-card="${id}"]`);
    if (el === null) throw new Error(`touch_pan: no card ${id}`);
    return el;
  };
  let point = null;
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  if (from.point !== undefined) {
    point = { x: Number(from.point.x), y: Number(from.point.y) };
  } else if (from.card !== undefined) {
    const box = rect(card(from.card));
    point = { x: box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 16) };
  } else if (from.between !== undefined) {
    // The real gap between two cards: vertically on a column board, across
    // the row on a rows board.
    const [first, second] = from.between.map(card);
    const a = rect(first);
    const b = rect(second);
    point = horizontal
      ? { x: (a.right + b.left) / 2, y: (a.top + a.bottom) / 2 }
      : { x: (a.left + a.right) / 2, y: (a.bottom + b.top) / 2 };
  } else if (from.column !== undefined) {
    const list = document.querySelector(`section[data-column-id="${from.column}"] [data-card-list]`);
    if (list === null) throw new Error(`touch_pan: no lane ${from.column}`);
    const box = rect(list);
    const cards = [...list.querySelectorAll("[data-thread-card]")].map(rect);
    if (horizontal) {
      const right = cards.reduce((far, b) => Math.max(far, b.right), box.left);
      const x = right + 24 <= box.right - 4 ? right + 24 : box.right - 6;
      point = { x, y: box.top + box.height / 2 };
    } else {
      const bottom = cards.reduce((low, b) => Math.max(low, b.bottom), box.top);
      // The lane's empty space under its last card; a lane packed to the
      // bottom edge pans from its padding row instead.
      const y = bottom + 24 <= box.bottom - 4 ? bottom + 24 : box.bottom - 6;
      point = { x: box.left + box.width / 2, y };
    }
  } else if (from.board === true) {
    const board = document.querySelector("[data-columns-board]");
    const box = rect(board);
    point = { x: box.left + 10, y: box.bottom - 10 };
  }
  if (point === null) throw new Error(`touch_pan: unreadable origin ${JSON.stringify(from)}`);
  point = { x: Math.round(point.x), y: Math.round(point.y) };
  const hit = document.elementFromPoint(point.x, point.y);
  return {
    point,
    under: hit === null
      ? null
      : {
          tag: hit.tagName.toLowerCase(),
          card: hit.closest("[data-thread-card]")?.getAttribute("data-thread-card") ?? null,
          column: hit.closest("[data-column-id]")?.getAttribute("data-column-id") ?? null,
          lane: hit.closest("[data-lane-id]")?.getAttribute("data-lane-id") ?? null,
        },
  };
};

/**
 * Arms the touch reading: the scroll offsets every scroller sits at before the
 * finger moves, the element under the finger, and the listeners that catch a
 * gesture the browser turned into something other than a pan (a native drag,
 * or a cancelled pointer). The listeners install once per document so repeated
 * pan steps in one page cannot double-count.
 */
const pageTouchPanPrepare = ({ point, under }) => {
  if (globalThis.__uatTouchHooked !== true) {
    globalThis.__uatTouchHooked = true;
    document.addEventListener(
      "dragstart",
      (event) => {
        const reading = globalThis.__uatTouch;
        if (reading === null || reading === undefined) return;
        const target = event.target;
        reading.dragStarts.push({
          at: Math.round(performance.now()),
          card: target instanceof Element
            ? target.closest("[data-thread-card]")?.getAttribute("data-thread-card") ?? null
            : null,
          tag: target instanceof Element ? target.tagName.toLowerCase() : String(target),
        });
      },
      { capture: true, passive: true },
    );
  }
  const board = document.querySelector("[data-columns-board]");
  const start = document.elementFromPoint(point.x, point.y);
  const laneList = start?.closest("[data-card-list]") ?? null;
  globalThis.__uatTouch = {
    point,
    under,
    layout: board.getAttribute("data-lane-direction") ?? "vertical",
    laneColumn: laneList?.closest("[data-column-id]")?.getAttribute("data-column-id") ?? null,
    before: {
      boardX: Math.round(board.scrollLeft),
      boardY: Math.round(board.scrollTop),
      laneX: Math.round(laneList?.scrollLeft ?? 0),
      laneY: Math.round(laneList?.scrollTop ?? 0),
    },
    dragStarts: [],
  };
  return true;
};

/** Reads the gesture's aftermath into the same reading (called after settle). */
const pageTouchPanRead = () => {
  const reading = globalThis.__uatTouch;
  if (reading === null || reading === undefined) return null;
  const board = document.querySelector("[data-columns-board]");
  const laneList =
    reading.laneColumn === null
      ? null
      : document.querySelector(
          `section[data-column-id="${reading.laneColumn}"] [data-card-list]`,
        );
  const after = {
    boardX: Math.round(board.scrollLeft),
    boardY: Math.round(board.scrollTop),
    laneX: Math.round(laneList?.scrollLeft ?? 0),
    laneY: Math.round(laneList?.scrollTop ?? 0),
  };
  const readingOut = {
    ...reading,
    after,
    delta: {
      board: { x: after.boardX - reading.before.boardX, y: after.boardY - reading.before.boardY },
      lane: { x: after.laneX - reading.before.laneX, y: after.laneY - reading.before.laneY },
    },
  };
  globalThis.__uatTouch = readingOut;
  return readingOut;
};

/**
 * The touch contract of the board surface. On a phone the only gesture the
 * surface may hand the browser is a PAN: a native drag source in the lanes
 * (every card anchor is `draggable` on a fine pointer) lets the platform's
 * touch-drag recognizer lift a card out of a finger's pan, and selectable card
 * text turns a long press into a selection/callout instead of a scroll
 * (issue #328). This probe reads the live document, not the source: the armed
 * drag sources in the board, the anchor's own `draggable` and computed
 * `user-select`, and the `touch-action` the scroll surfaces declare.
 */
const pageTouchDragArmor = (payload) => {
  const board = document.querySelector("[data-columns-board]");
  if (board === null) return { ok: false, reason: "no [data-columns-board] on the page" };
  const card =
    payload?.card === undefined
      ? board.querySelector("[data-thread-card]")
      : document.querySelector(`[data-thread-card="${payload.card}"]`);
  if (card === null) return { ok: false, reason: "no card rendered on the board" };
  const anchor = card.querySelector("a");
  const list = card.closest("[data-card-list]");
  const sources = [...board.querySelectorAll('[draggable="true"]')];
  const touchAction = (el) => (el === null ? "" : getComputedStyle(el).touchAction);
  const box = (el) => {
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  };
  return {
    ok: true,
    layout: board.getAttribute("data-lane-direction") ?? "vertical",
    coarse: matchMedia("(pointer: coarse)").matches,
    hoverNone: matchMedia("(hover: none)").matches,
    cardDrag: card.getAttribute("draggable"),
    anchorDrag: anchor === null ? null : anchor.getAttribute("draggable"),
    anchorUserSelect: anchor === null ? "" : getComputedStyle(anchor).userSelect,
    anchorBox: box(anchor),
    boardTouchAction: touchAction(board),
    laneTouchAction: touchAction(list),
    sources: sources.length,
    sourceSample: sources
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-thread-card") === null ? "" : `[${el.getAttribute("data-thread-card")}]`}`),
  };
};

const pageQueuedSendReach = async (payload) => {
  const row = payload?.row ?? 1;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const revealLabel = `Queued message ${row} actions`;
  const sendLabel = `Send queued message ${row} now`;
  const reveal = document.querySelector(`[aria-label="${revealLabel}"]`);
  if (reveal === null) return { ok: false, reason: `no reveal control (${revealLabel})` };
  const revealCs = getComputedStyle(reveal);
  const revealBox = reveal.getBoundingClientRect();
  if (
    revealCs.opacity === "0" ||
    revealCs.pointerEvents === "none" ||
    revealBox.width === 0 ||
    revealBox.height === 0
  ) {
    return {
      ok: false,
      reason: `reveal not painted on touch: opacity ${revealCs.opacity}, pointer-events ${revealCs.pointerEvents}, box ${Math.round(revealBox.width)}x${Math.round(revealBox.height)}`,
    };
  }
  const cx = revealBox.left + revealBox.width / 2;
  const cy = revealBox.top + revealBox.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  if (hit === null || !(hit === reveal || reveal.contains(hit))) {
    return {
      ok: false,
      reason: `reveal not hit-testable: center (${Math.round(cx)},${Math.round(cy)}) lands on ${
        hit?.getAttribute?.("aria-label") ?? hit?.tagName ?? "nothing"
      }`,
    };
  }
  const send = document.querySelector(`[aria-label="${sendLabel}"]`);
  const sendBox = send?.getBoundingClientRect() ?? null;
  const sendHiddenBefore =
    send === null ||
    sendBox.width === 0 ||
    sendBox.height === 0 ||
    getComputedStyle(send).pointerEvents === "none";
  if (!sendHiddenBefore) {
    return { ok: false, reason: "Send was reachable before the reveal was tapped" };
  }
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(160);
  const sendAfter = document.querySelector(`[aria-label="${sendLabel}"]`);
  if (sendAfter === null) {
    return { ok: false, reason: "tapping the reveal removed the row instead of revealing Send" };
  }
  const sendCs = getComputedStyle(sendAfter);
  const sendBoxAfter = sendAfter.getBoundingClientRect();
  if (
    sendCs.opacity === "0" ||
    sendCs.pointerEvents === "none" ||
    sendBoxAfter.width === 0 ||
    sendBoxAfter.height === 0
  ) {
    return {
      ok: false,
      reason: `Send stayed hidden after the reveal tap: opacity ${sendCs.opacity}, pointer-events ${sendCs.pointerEvents}, box ${Math.round(sendBoxAfter.width)}x${Math.round(sendBoxAfter.height)}`,
    };
  }
  sendAfter.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(160);
  const gone =
    document.querySelector(`[data-queued-message-row="${row}"]`) === null &&
    document.querySelector(`[aria-label="${sendLabel}"]`) === null;
  return { ok: gone, reason: gone ? "" : "the queued row survived the Send tap" };
};

/**
 * A card's right-click menu: dispatch a real contextmenu event on the card
 * (the menu handler lives on ThreadCardMenu's wrapper and the card's anchor
 * contextmenu bubbles up to it), wait for the menu to open, then click the
 * item whose text matches the label exactly. Dispatching and clicking in one
 * page.evaluate is safe: the open and the menuitem are both committed by
 * React's synchronous discrete-event flush by the time the search retries
 * land — the retry only covers React scheduling jitter, it never clicks a
 * stale item.
 */
/**
 * The board invariants a suite with `invariants: true` (and the fuzz and
 * race engines) asserts after every gesture. Three hold regardless of what
 * the gesture was, so any future step inherits them:
 *
 * 1. Every thread renders top-level in exactly ONE lane — the family's Done
 *    projection card is the one legal second home, and only beside "done"
 *    (the same multiplicity rule the transport planner applies).
 * 2. The cards of a lane that ARE in its stored rank keep the stored
 *    relative order (a sparse order constrains its members, nothing more).
 * 3. No refusal or sweep-refusal banner is on screen, EXCEPT the board's own
 *    no-move report ("... resolved to no move"). That refusal is correct by
 *    design: the drop's insertion slot already holds the dragged card, so
 *    the release changes nothing (lib/rank.ts moveTargetFor), and a random
 *    gesture sequence (the fuzz) reaches it by dropping a card onto its own
 *    neighbour. Every OTHER refusal — an unidentified card, an unavailable
 *    order, a strip-nest refusal, a sweep refusal — is a silent-failure
 *    tripwire for gesture sequences nobody hand-wrote and still fails.
 */
const pageInvariants = () => {
  const problems = [];
  const laneOf = new Map();
  const displayedOf = new Map();
  for (const section of document.querySelectorAll("section[data-column-id]")) {
    const columnId = section.getAttribute("data-column-id");
    const topSlots = [...section.querySelectorAll(":scope > div > ul > li")].filter(
      // Transport ghosts hold the card's id in its OLD lane for a second;
      // they are decoration, not board state.
      (li) => li.getAttribute("data-transport-ghost") === null && li.getAttribute("aria-hidden") !== "true",
    );
    const displayed = topSlots.flatMap((li) => {
      if (li.getAttribute("data-group-box") !== null) {
        // A group frame's members each own a slot inside the frame; the
        // frame itself owns none.
        return [...li.querySelectorAll(":scope > div > ul > li")].flatMap((slot) => {
          if (slot.getAttribute("data-transport-ghost") !== null) return [];
          return [slot.querySelector("a[href]")?.getAttribute("href")?.split("/").pop() ?? "?"];
        });
      }
      return [li.querySelector(":scope a[href]")?.getAttribute("href")?.split("/").pop() ?? "?"];
    });
    displayedOf.set(columnId, displayed);
    for (const threadId of displayed) {
      const lanes = laneOf.get(threadId) ?? [];
      lanes.push(columnId);
      laneOf.set(threadId, lanes);
    }
  }
  for (const [threadId, lanes] of laneOf) {
    const okMultiplicity = lanes.length === 1 || (lanes.length === 2 && lanes.includes("done"));
    if (!okMultiplicity) {
      problems.push(`thread ${threadId} renders top-level in ${lanes.join("+")}`);
    }
  }
  const groupBy = window.localStorage.getItem("focus-board:groupBy") ?? "status";
  const ranks = window.__uat.ranks();
  for (const [columnId, displayed] of displayedOf) {
    const rankKey = columnId === "pinned" || columnId === "done" ? columnId : `${groupBy}:${columnId}`;
    const stored = ranks[rankKey] ?? [];
    const displayedSet = new Set(displayed);
    const displayedStored = displayed.filter((id) => stored.includes(id));
    // The stored order belongs to the column: cards that left (pinned away,
    // archived) keep their entries without rendering here, so the display
    // must match the stored RELATIVE order of the cards still in the lane,
    // not the raw stored array's positions.
    const storedVisible = stored.filter((id) => displayedSet.has(id));
    for (let index = 0; index < displayedStored.length; index += 1) {
      if (displayedStored[index] !== storedVisible[index]) {
        problems.push(
          `lane ${columnId} shows its stored cards out of stored order (${displayedStored.join(",")} vs stored-visible ${storedVisible.join(",")})`,
        );
        break;
      }
    }
  }
  // Two banners report a refusal: the rank-error banner and the sweep
  // refusal. The rank-error banner ALSO carries the board's correct no-op
  // report — a release whose insertion slot already holds the dragged card
  // (lib/rank.ts moveTargetFor: "the slot directly above the hovered card,
  // when the dragged card is that hover's direct upper neighbour"). The
  // operator's release asked for a move that resolved to none, so the board
  // saying so is right, and the acceptance is deliberately narrow: only the
  // rank banner, only a "resolved to no move" reason. The sweep refusal and
  // every other rank refusal still fail, which is what keeps this a
  // tripwire rather than a blanket amnesty.
  const rankBanner = document.querySelector('[data-testid="rank-error-banner"]');
  const sweepBanner = document.querySelector('[data-testid="sweep-refusal"]');
  const banner = rankBanner ?? sweepBanner;
  if (banner !== null) {
    const text = banner.textContent?.trim() ?? "";
    const noOpRefusal = rankBanner !== null && /\bresolved to no move\b/.test(text);
    if (!noOpRefusal) {
      problems.push(`refusal banner on screen: ${text.slice(0, 90)}`);
    }
  }
  return { ok: problems.length === 0, problems };
};

/**
 * The board state the fuzz engine reads between gestures: whatever lanes
 * exist right now, the top-level cards in each, and whether the settings
 * modal is open (so a stray Escape closes it before the next gesture).
 */
const pageFuzzState = () => {
  const lanes = [];
  for (const section of document.querySelectorAll("section[data-column-id]")) {
    const columnId = section.getAttribute("data-column-id");
    const cards = [...section.querySelectorAll(":scope > div > ul > li")]
      .filter((li) => li.getAttribute("data-transport-ghost") === null && li.getAttribute("aria-hidden") !== "true")
      .flatMap((li) =>
        li.getAttribute("data-group-box") !== null
          ? [...li.querySelectorAll(":scope > div > ul > li")]
              .filter((slot) => slot.getAttribute("data-transport-ghost") === null)
              .map((slot) => slot.querySelector("a[href]")?.getAttribute("href")?.split("/").pop() ?? "?")
          : [li.querySelector(":scope a[href]")?.getAttribute("href")?.split("/").pop() ?? "?"],
      );
    lanes.push({ columnId, cards });
  }
  return {
    lanes,
    boardOpen: document.querySelector("[data-columns-board]") !== null,
    modalOpen: document.querySelector('[role="dialog"]') !== null,
  };
};

/**
 * One seeded RNG (mulberry32): the fuzz engine is deterministic per seed,
 * so a failing sequence replays exactly.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pageMenu = async ({ card, box, item }) => {
  // `box` right-clicks a feature-group box's own surface — its label — whose
  // contextmenu bubbles to the dashed container's guarded handler; `card`
  // stays the card path. The box's member cards stop their own menus'
  // propagation, so a label right-click can only ever open the box's menu.
  const host =
    box !== undefined
      ? document.querySelector(`[data-group-box-label="${CSS.escape(box)}"]`)
      : document.querySelector(`[data-thread-card="${CSS.escape(card)}"]`);
  if (!host) throw new Error(`menu: no card ${card} or box ${box}`);
  const rect = host.getBoundingClientRect();
  host.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
  const deadline = window.performance.now() + 2000;
  while (window.performance.now() < deadline) {
    const target = [...document.querySelectorAll('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === item,
    );
    if (target !== undefined) {
      target.click();
      return { ok: true, items: document.querySelectorAll('[role="menuitem"]').length };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`menu: no item ${item} offered (menu never opened)`);
};

/**
 * Is a card fully inside the columns board's scroll viewport? Unlike the
 * active-card probe (window-level, pane-open threads), this measures against
 * the board itself — the viewport a keep-in-view gesture must reach, e.g. the
 * far-left Pinned lane after a right-click pin. (`card_visible`, the
 * parent-lane board's rule, measures against `[data-parent-board]` instead.)
 */
const pageColumnCardVisible = (threadId) => {
  const board = document.querySelector("[data-columns-board]");
  if (!board) return { ok: false, reason: "no columns board on the page" };
  const host = document.querySelector(`[data-thread-card="${CSS.escape(threadId)}"]`);
  if (!host) return { ok: false, reason: `no card ${threadId}` };
  const b = board.getBoundingClientRect();
  const c = host.getBoundingClientRect();
  if (c.width === 0) return { ok: false, reason: `card ${threadId} rendered with no size` };
  if (c.left < b.left || c.right > b.right) {
    return {
      ok: false,
      reason: `card ${Math.round(c.left)}…${Math.round(c.right)} sits outside the board's visible range ${Math.round(b.left)}…${Math.round(b.right)}`,
    };
  }
  return { ok: true, reason: `card ${threadId} fully within the board's visible range` };
};

/**
 * The what's-new surface: the gift button is always present; the pulse and
 * the modal are the state. Read via aria-label so the assertion sees what
 * the operator sees.
 */
const pageWhatsNew = () => {
  // The gear/gift double-duty icon: a pulse (gift) while the changelog has
  // unseen content, a settings gear otherwise — one button, one label
  // whichever state it is in.
  const button =
    document.querySelector('button[aria-label="What\'s new"]') ??
    document.querySelector('button[aria-label="Focus Board settings"]');
  const modal =
    document.querySelector("[role=dialog]") ??
    document.querySelector("[data-bb-portaled-overlay] [role=dialog]") ??
    document.querySelector("[data-bb-portaled-overlay] [role=alertdialog]");
  const tab = document.querySelector('[role="tab"][aria-selected="true"]');
  return {
    icon: button !== null,
    modal: modal !== null,
    tab: tab?.textContent ?? null,
  };
};

/** Does a substring appear in the page's visible text? */
const pageTextVisible = (needle) =>
  document.body.textContent?.includes(needle) ?? false;

/**
 * Horizontal pan over a board: a programmatic scrollLeft delta, which fires a
 * real scroll event. `target` picks the board: "lanes" (default — the
 * parent-lane board) or "columns" (the grouped column board, for scrolled
 * viewport setup before a keep-in-view gesture).
 */
const pageBoardScroll = ({ dx, dy, target = "lanes" }) => {
  const selector = target === "columns" ? "[data-columns-board]" : "[data-parent-board]";
  const board = document.querySelector(selector);
  if (!board) throw new Error(`scroll: no ${selector} on the page`);
  if (dx !== undefined) board.scrollLeft += dx;
  if (dy !== undefined) board.scrollTop += dy;
  return { scrollLeft: board.scrollLeft, scrollTop: board.scrollTop };
};

/**
 * The Parent view's row sweep: read the rail's pill for a row, its rendered
 * label, its armed state, and which cards board-wide carry the sweep marks.
 * The row scope is the same column vocabulary the Focus view uses, so a
 * suite can assert both views through one probe. `present: false` reads the
 * absence side: the row exists with no pill on it.
 */
const pageParentRowSweep = (rowId) => {
  const rail = document.querySelector("[data-rail]");
  if (!rail) return { ok: false, reason: "no rail" };
  const cell = rail.querySelector(`[data-rail-row="${rowId}"]`);
  if (!cell) return { ok: false, reason: `no rail row ${rowId}` };
  const pill = cell.querySelector("[data-sweep-button]");
  const board = document.querySelector("[data-parent-board]");
  const highlighted = [...(board?.querySelectorAll("[data-sweep-highlighted]") ?? [])].map(
    (el) => el.getAttribute("data-thread-card"),
  );
  const active = board?.querySelector("[data-sweep-active]") ?? null;
  return {
    ok: true,
    present: pill !== null,
    label: cell.textContent?.trim() ?? "",
    pill: pill?.textContent?.trim() ?? "",
    armed: pill?.getAttribute("aria-pressed") === "true",
    cancel: cell.querySelector("[data-sweep-cancel]") !== null,
    highlighted,
    activeId: active === null ? null : active.getAttribute("data-thread-card"),
  };
};

/** Click the Parent view's sweep pill on one row (arm or confirm, per state):
 *  the same gesture an operator makes, keyed by row id so the suite need not
 *  know the pill's count-bearing aria-label. */
const pageClickRowSweepPill = ({ row }) => {
  const rail = document.querySelector("[data-rail]");
  if (!rail) throw new Error("no rail");
  const cell = rail.querySelector(`[data-rail-row="${row}"]`);
  if (!cell) throw new Error(`no rail row ${row}`);
  const pill = cell.querySelector("[data-sweep-button]");
  if (!pill) throw new Error(`no sweep pill on row ${row}`);
  if (pill.disabled) throw new Error(`the sweep pill on row ${row} is disabled`);
  pill.click();
  return { ok: true };
};

/** Which lanes hold highlighted cards for the armed row, and how many. */
const pageParentRowSweepSpread = () => {
  const byLane = {};
  for (const lane of document.querySelectorAll("[data-parent-board] section[data-lane-id]")) {
    const n = lane.querySelectorAll("[data-sweep-highlighted]").length;
    if (n > 0) byLane[lane.getAttribute("data-lane-id")] = n;
  }
  return byLane;
};

/** The banner a sweep outcome paints, on either board. */
const pageSweepBanner = () => {
  const notice = document.querySelector('[data-testid="sweep-notice"]');
  const refusal = document.querySelector('[data-testid="sweep-refusal"]');
  return {
    notice: notice?.textContent?.trim() ?? null,
    refusal: refusal?.textContent?.trim() ?? null,
    undo: document.querySelector("[data-sweep-undo]") !== null,
  };
};
/** The ARCHIVED thread ids the harness's mock moved out of the sidebar. */
const pageSweepArchived = () =>
  globalThis.__uat.sweepArchived();

/** Which lane is the locked ruler lane (or null when the lock is released)? */
const pageLockedLane = () => {
  const locked = document.querySelector("section[data-locked]");
  if (!locked) return null;
  return locked.getAttribute("data-lane-id");
};

/**
 * Do the shared band tracks line up across lanes? Groups band cells by their
 * status id and compares the top edge of each group's members: a working
 * band must start at the same y in every lane, or the rail labels lie.
 */
const pageBandsAligned = () => {
  const byId = new Map();
  for (const band of document.querySelectorAll("[data-band]")) {
    const id = band.getAttribute("data-band");
    const list = byId.get(id) ?? [];
    list.push(band.getBoundingClientRect().top);
    byId.set(id, list);
  }
  if (byId.size === 0) return { ok: false, reason: "no bands rendered" };
  for (const [id, tops] of byId) {
    const spread = Math.max(...tops) - Math.min(...tops);
    if (spread > 2) return { ok: false, reason: `band ${id} spread ${spread.toFixed(1)}px` };
  }
  return { ok: true, reason: `${byId.size} bands aligned` };
};

/**
 * How noisy is the board after a pan? A real scroll event listener records
 * every horizontal scroll event from a programmatic pan (the same gesture
 * the scroll step uses) through the whole settle sequence — release, quiet
 * debounce, pin glide, recut, post-pin corrections — and reports the event
 * count plus how long the board has been still at the end.
 *
 * The regression "super jittery" produced: events continuing indefinitely
 * (settle re-arming its own glide) and lock churn. A quiet board shows a
 * bounded event count (glide motion is legitimate, capped) and a tail of
 * stillness at the end of the hold window.
 */
const pageBoardNoise = ({ dx, holdMs }) => {
  const board = document.querySelector("[data-parent-board]");
  if (!board) throw new Error("board_quiet: no [data-parent-board] on the page");
  const times = [];
  let prev = board.scrollLeft;
  const onScroll = () => {
    if (Math.abs(board.scrollLeft - prev) > 1) times.push(window.performance.now());
    prev = board.scrollLeft;
  };
  board.addEventListener("scroll", onScroll, { passive: true });
  board.scrollLeft += dx;
  return new Promise((resolve) => {
    setTimeout(() => {
      board.removeEventListener("scroll", onScroll);
      const now = window.performance.now();
      const tail = times.length > 0 ? now - times[times.length - 1] : holdMs;
      resolve({ events: times.length, tail });
    }, holdMs);
  });
};

/**
 * Armed variant of the noise listener for REAL wheel input: arm it in the
 * page first (the listener must already exist when the wheel arrives), pump
 * wheel events through Puppeteer's input pipeline from Node, then read the
 * signature. This exercises the same input path a trackpad pan uses —
 * smooth-animated wheel deltas — instead of a bare scrollLeft assignment.
 */
const pageBoardNoiseArm = () => {
  const board = document.querySelector("[data-parent-board]");
  if (!board) throw new Error("board_quiet wheel: no [data-parent-board]");
  const times = [];
  let prev = board.scrollLeft;
  board.addEventListener(
    "scroll",
    () => {
      if (Math.abs(board.scrollLeft - prev) > 1) times.push(window.performance.now());
      prev = board.scrollLeft;
    },
    { passive: true },
  );
  window.__uatNoise = { times, start: window.performance.now() };
};

const pageBoardNoiseRead = ({ holdMs }) =>
  new Promise((resolve) => {
    setTimeout(() => {
      const noise = window.__uatNoise;
      const now = window.performance.now();
      const tail = noise.times.length > 0 ? now - noise.times[noise.times.length - 1] : now - noise.start;
      resolve({ events: noise.times.length, tail });
    }, holdMs);
  });

/** Real wheel input: 10 discrete wheel ticks through the input pipeline. */
const wheelPan = async (page, { dx = 130, dy = 0, target = "lanes", over = undefined }) => {
  const board = await page.$(
    target === "columns" ? "[data-columns-board]" : "[data-parent-board]",
  );
  if (!board) throw new Error("board_quiet wheel: no board element");
  const box = await board.boundingBox();
  let point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (over !== undefined) {
    // The same origin vocabulary the touch gesture uses (`card`, `between`,
    // `column`, `board`): `over: { card }` parks the pointer on a card's own
    // body so the wheel is delivered to the surface a drag source covers —
    // the shape of a trackpad scroll that must pan and never start a drag
    // (issue #328).
    const origin = await page.evaluate(pageTouchPanOrigin, over);
    point = origin.point;
  }
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel({ deltaX: dx / 10, deltaY: dy / 10 });
  }
};

/**
 * Is the given thread card fully visible inside the board's scroll viewport?
 * The sticky rail (left) and the sticky lane headers (top) overlay the
 * viewport edges, so a card under either is treated as hidden — that is the
 * regression the clicked-card-off-screen bug report described. Both occluders
 * are measured from the live DOM so header/rail size changes stay honest.
 */
const pageCardVisible = (threadId) => {
  const board = document.querySelector("[data-parent-board]");
  if (!board) return { ok: false, reason: "no board" };
  const host = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (!host) return { ok: false, reason: `no card ${threadId}` };
  const b = board.getBoundingClientRect();
  const c = host.getBoundingClientRect();
  const hdr = board.querySelector("[data-lane-header]");
  const minTop = hdr ? hdr.getBoundingClientRect().bottom : b.top + 88;
  const rail = board.querySelector("[data-rail]");
  const minLeft = rail ? rail.getBoundingClientRect().right + 16 : b.left + 140 + 16;
  if (c.top < minTop) return { ok: false, reason: `top ${Math.round(c.top)} hides behind the header` };
  if (c.bottom > b.bottom) return { ok: false, reason: `bottom ${Math.round(c.bottom)} falls below the fold` };
  if (c.left < minLeft) return { ok: false, reason: `left ${Math.round(c.left)} hides behind the rail` };
  if (c.right > b.right) return { ok: false, reason: `right ${Math.round(c.right)} runs past the viewport` };
  return { ok: true, reason: `card ${threadId} fully visible` };
};

/**
 * The swimlane hover: which band row (if any) carries the shared shading
 * attribute, and whether it extends across more than one lane at one seam.
 */
const pageBandHover = () => {
  const bands = [...document.querySelectorAll('[data-band-hover="true"]')];
  if (bands.length === 0) return { ok: false, reason: "no band carries the hover shading" };
  const ids = new Set(bands.map((band) => band.getAttribute("data-band")));
  const tops = new Set(bands.map((band) => Math.round(band.getBoundingClientRect().top)));
  if (ids.size !== 1) return { ok: false, reason: `hover spans ${ids.size} different rows` };
  if (tops.size !== 1) return { ok: false, reason: `hovered bands sit at ${tops.size} different tops` };
  return { ok: true, count: bands.length, reason: `${bands.length} bands share the shaded row` };
};

/**
 * Hover-prominence probe (issue #195): sampled WHILE the real pointer rests
 * on a top-level card's center (the hover_card gesture moved it). Reads the
 * hovered card's computed surface, a non-hovered sibling's surface as the
 * rest reference (the spotlight dims OPACITY, so a dimmed sibling's
 * background-color is still the resting card token), and the harness's
 * active theme class. The direction the hovered surface may take is
 * theme-dependent: the dark theme's surface is pinned to darken
 * (the #123 follow-up's emphasis); the light theme's must NOT — darkening a
 * near-white card reads as muting, not emphasis (#195).
 */
const pageHoverProminence = (id) => {
  const lightness = (color) => {
    const lch = color.match(/oklch\(\s*([0-9.]+)(%?)\b/);
    if (lch !== null) return lch[2] === "%" ? parseFloat(lch[1]) / 100 : parseFloat(lch[1]);
    const lab = color.match(/oklab\(\s*([0-9.]+)\b/);
    return lab === null ? null : parseFloat(lab[1]);
  };
  const alpha = (color) => {
    const slash = color.match(/\/\s*([0-9.]+)\s*\)\s*$/);
    if (slash !== null) return parseFloat(slash[1]);
    const comma = color.match(/,\s*([0-9.]+)\s*\)\s*$/);
    return comma !== null ? parseFloat(comma[1]) : 1;
  };
  const cards = [...document.querySelectorAll("div[data-thread-card]")];
  const card = cards.find((el) => el.getAttribute("data-thread-card") === id);
  if (!card) return { ok: false, reason: `no card div ${id}` };
  const hovered = getComputedStyle(card).backgroundColor;
  const restCard = cards.find(
    (el) =>
      el !== card &&
      !el.hasAttribute("data-spotlight-immune") &&
      !el.matches(":hover") &&
      el.getBoundingClientRect().width > 100 &&
      el.getBoundingClientRect().height > 40 &&
      el.getBoundingClientRect().bottom < innerHeight,
  );
  if (!restCard) return { ok: false, reason: "no rest-state sibling card found to read" };
  const rest = getComputedStyle(restCard).backgroundColor;
  return {
    ok: true,
    pointerHover: card.matches(":hover"),
    dark: document.documentElement.classList.contains("dark"),
    hovered,
    hoveredL: lightness(hovered),
    alpha: alpha(hovered),
    rest,
    restL: lightness(rest),
    siblingId: restCard.getAttribute("data-thread-card"),
    siblingOpacity: getComputedStyle(restCard).opacity,
    siblingImmune: restCard.hasAttribute("data-spotlight-immune"),
  };
};

/**
 * The attention pulse gate's census (#260): every `[data-attention-pulse]`
 * overlay on the board, how many are parked (off screen), how many really
 * intersect the scrollable board (the rule the gate itself uses — an
 * IntersectionObserver against the viewport intersected with the lane's own
 * clipping container, not a plain viewport-rect test, which counts a card
 * clipped by its lane as visible), and whether any parked element is STILL
 * animating, which is the gate's contract and reads computed `animationName`
 * (what the compositor runs), not the class list.
 */
const pageAttentionPulse = () => {
  const pulses = [...document.querySelectorAll("[data-attention-pulse]")];
  // The authoritative visibility rule: an IntersectionObserver would report
  // exactly this, so the census never disagrees with the gate about a card
  // clipped by its lane's scroll container.
  const intersects = (el) => {
    const r = el.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    let top = Math.max(r.top, 0);
    let bottom = Math.min(r.bottom, vh);
    let left = Math.max(r.left, 0);
    let right = Math.min(r.right, vw);
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const cr = node.getBoundingClientRect();
        top = Math.max(top, cr.top);
        bottom = Math.min(bottom, cr.bottom);
        left = Math.max(left, cr.left);
        right = Math.min(right, cr.right);
      }
    }
    return bottom > top && right > left;
  };
  let parked = 0;
  let visible = 0;
  let runningVisible = 0;
  let runningParked = 0;
  for (const el of pulses) {
    const onScreen = intersects(el);
    const isParked = el.hasAttribute("data-pulse-parked");
    const animating = getComputedStyle(el).animationName !== "none";
    if (onScreen) visible += 1;
    if (isParked) parked += 1;
    if (animating && onScreen) runningVisible += 1;
    if (animating && isParked) runningParked += 1;
  }
  return { total: pulses.length, parked, visible, runningVisible, runningParked };
};

/**
 * Is the locked lane pinned flush against the rail? A wheel overshoot inside
 * the locked lane's own grab window must snap the board BACK to the flush
 * position (runCorrections drift re-pin) rather than leave the ruler sitting
 * visibly off-flush with its rail attribution still showing.
 */
const pageLockedFlush = () => {
  const board = document.querySelector("[data-parent-board]");
  if (!board) return { ok: false, reason: "no board" };
  const locked = board.querySelector("section[data-locked]");
  if (!locked) return { ok: false, reason: "no lane is locked" };
  const rail = board.querySelector("[data-rail]");
  if (!rail) return { ok: false, reason: "no rail" };
  const want = rail.getBoundingClientRect().right + 16;
  const left = locked.getBoundingClientRect().left;
  const drift = Math.abs(left - want);
  if (drift > 4) {
    return { ok: false, reason: `locked lane sits ${Math.round(drift)}px off flush` };
  }
  return { ok: true, reason: `locked lane flush (drift ${Math.round(drift)}px)` };
};

/**
 * The "Nest child threads" toggle, read as the operator sees it: the View
 * menu's footer row — role=checkbox, checked = aria-checked, disabled =
 * aria-disabled present. The row only exists while the View menu is open,
 * so this opens the menu on the View trigger (closed, the footer is not in
 * the DOM at all), reads the row, and closes the menu again. Returns
 * { present: false } rather than throwing when the toggle cannot be found:
 * the nest_locked rule turns that into the step's failed assertion.
 */
const pageNestToggle = async () => {
  let trigger = document.querySelector('button[aria-label="View"]');
  if (!trigger) {
    // The compact header tucks the View menu inside the collapsed filter
    // ribbon (board-toolbar.tsx): expand the ribbon the way an operator
    // would, then look again. The wait loop rides React's re-render; if the
    // ribbon is already open (a "Hide filter palette" toggle) the trigger
    // simply needs another beat to exist.
    const deadline = window.performance.now() + 2000;
    const ribbonToggle = document.querySelector(
      'button[title="Show filter palette"], button[title="Hide filter palette"]',
    );
    if (ribbonToggle && ribbonToggle.getAttribute("title") === "Show filter palette") {
      ribbonToggle.click();
    }
    while (window.performance.now() < deadline) {
      trigger = document.querySelector('button[aria-label="View"]');
      if (trigger) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!trigger) return { present: false, reason: "no View menu trigger on the toolbar or the expanded ribbon" };
  const readRow = () =>
    [...document.querySelectorAll('button[role="checkbox"]')].find(
      (el) => el.textContent?.includes("Nest child threads"),
    );
  const wasOpen = readRow() !== undefined;
  if (!wasOpen) {
    trigger.click();
    const deadline = window.performance.now() + 2000;
    while (window.performance.now() < deadline) {
      if (readRow() !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const row = readRow();
  if (!row) {
    return { present: false, reason: "the Nest child threads row never appeared in the open View menu" };
  }
  const state = {
    present: true,
    checked: row.getAttribute("aria-checked") === "true",
    disabled: row.hasAttribute("aria-disabled"),
  };
  if (!wasOpen) trigger.click();
  return state;
};

/**
 * The pane's side of the route: which thread it is showing, or whether it is
 * closed. Read from the aside's aria-label so the assertion sees what the
 * operator sees, not internal state.
 */
const pagePaneState = () => {
  const aside = document.querySelector('aside[aria-label^="Thread: "]');
  if (!aside) return { open: false, threadId: null };
  const label = aside.getAttribute("aria-label") ?? "";
  return { open: true, threadId: label.startsWith("Thread: ") ? label.slice(8) : null };
};

/**
 * The pane's board-lane floor (issue #273): with the pane's left edge dragged
 * as far left as it goes, the board must keep PANE_BOARD_LANE_FLOOR (320px =
 * 1.25 lanes of 256px) to the pane's left, and the board's own chrome must not
 * paint past its box (the overflow that, on a wallpaper's z-10 board column,
 * paints over the pane). Overlap is sampled by hit-testing inside the pane: a
 * clipped lane scrolled out of the overflow container is not an overlap, so a
 * rect test alone would miscount it.
 */
const pagePaneBoardFloor = ({ floor }) => {
  const panel = document.querySelector('[data-bb-plugin="focus-board"]');
  const aside = document.querySelector('aside[aria-label^="Thread: "]');
  if (panel === null || aside === null) {
    return { ok: false, detail: "no pane or no panel on the page" };
  }
  const board = panel.querySelector(":scope > div > div.flex-1");
  if (board === null) return { ok: false, detail: "the board column is not beside the pane" };
  const band = board.querySelector(":scope > div");
  const paneRect = aside.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  const margin = Math.round(paneRect.left - boardRect.left);
  // The board's own chrome painted past the board's box: the overflow that
  // turns into an on-top overlap when a wallpaper makes the board z-10.
  let bandOut = -Infinity;
  if (band !== null) {
    for (const el of band.querySelectorAll("button, input, div, span")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      bandOut = Math.max(bandOut, r.right - boardRect.right);
    }
  }
  // Hit-test grid inside the pane's upper region: a board element winning a
  // sample is the operator's overlap symptom (and respects clipping).
  let boardWins = 0;
  let samples = 0;
  for (let y = 8; y < Math.min(240, paneRect.height); y += 16) {
    for (let x = Math.max(6, paneRect.left + 6); x < Math.min(paneRect.right - 6, paneRect.left + 400); x += 24) {
      const el = document.elementFromPoint(x, y);
      if (el === null) continue;
      samples += 1;
      if (board.contains(el) && !aside.contains(el)) boardWins += 1;
    }
  }
  const ok = margin >= floor - 1 && boardWins === 0;
  return {
    ok,
    margin,
    floor,
    paneWidth: Math.round(paneRect.width),
    boardWidth: Math.round(boardRect.width),
    boardZ: getComputedStyle(board).zIndex,
    bandOut: Number.isFinite(bandOut) ? Math.round(bandOut) : null,
    boardWins,
    samples,
    detail: `margin ${margin}px (floor ${floor}px), board ${Math.round(boardRect.width)}px wide, ${boardWins}/${samples} pane samples landed on board chrome, band overflow ${Number.isFinite(bandOut) ? Math.round(bandOut) : "n/a"}px, board z-index ${getComputedStyle(board).zIndex}`,
  };
};

/**
 * The inline-code open glyph, measured in a real line breaker. jsdom cannot
 * wrap text, so this probe is the automated counterpart of staring at a
 * narrow pane: wait for the decoration (its verdict flow is async — environment
 * resolution plus an existence RPC — so poll rather than sample once), then
 * measure. The regression this pins: the glyph appended after a long code
 * text is an atomic inline, a legal break position, so the glyph dropped to
 * its own line when the path filled the pane. Chromium ignores U+2060 word
 * joiners at that boundary, so decorateCode fuses the icon with the code's
 * final character inside one white-space-nowrap unit: the glyph may move
 * with the text but never alone — the icon and the code's last path
 * character must share a visual line.
 */
const pageGlyphGlue = async () => {
  const deadline = window.performance.now() + 4000;
  let code = null;
  while (window.performance.now() < deadline) {
    code = document.querySelector(
      'aside[aria-label^="Thread: "] code[data-focus-board-path-link]',
    );
    if (code !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (code === null) {
    return { ok: false, reason: "no decorated code span appeared in the pane (decoration never fired?)" };
  }
  const icon = code.querySelector("[data-focus-board-path-link-icon]");
  if (icon === null) {
    return { ok: false, reason: "decorated code carries no icon span" };
  }
  const glue = icon.closest("[data-focus-board-path-link-glue]");
  if (
    glue === null ||
    glue.style.whiteSpace !== "nowrap" ||
    icon.parentElement !== glue
  ) {
    return {
      ok: false,
      reason: "icon is not fused into a nowrap glue unit — it can wrap onto its own line",
    };
  }
  // Sanity: the path must actually wrap at this pane width, or the same-line
  // assertion below passes vacuously.
  if (code.getClientRects().length < 2) {
    return { ok: false, reason: "the code span did not wrap; this check would be vacuous" };
  }
  // Same-line check: a Range over the code's final visible text character —
  // the one the glue unit carries next to the icon — shares a baseline with
  // the icon.
  const textNodes = [];
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    if (node.textContent.replace(/\u2060/gu, "").length > 0) textNodes.push(node);
  }
  const lastText = textNodes[textNodes.length - 1];
  if (lastText === undefined) {
    return { ok: false, reason: "the decorated code carries no visible text" };
  }
  const range = document.createRange();
  range.setStart(lastText, lastText.textContent.length - 1);
  range.setEnd(lastText, lastText.textContent.length);
  const charRect = range.getClientRects();
  const iconRect = icon.getBoundingClientRect();
  if (charRect.length === 0) {
    return { ok: false, reason: "the last path character produced no line box" };
  }
  const top = charRect[0].top;
  const sameLine = Math.abs(top - iconRect.top) < 4;
  return {
    ok: sameLine,
    reason: sameLine
      ? `glyph shares the line with the path's last character (tops ${top.toFixed(1)} / ${iconRect.top.toFixed(1)}), path wraps across ${code.getClientRects().length} line boxes`
      : `glyph dropped off the path's last line (char top ${top.toFixed(1)} vs icon top ${iconRect.top.toFixed(1)})`,
  };
};

/** Does this step declare a top-level assertion of that name? */
function rule_has(step, name) {
  return (step.assert ?? []).some((rule) => rule[name] !== undefined);
}

/** Turn one YAML step's assertions into pass/fail records. */
async function check(step, page, gestureResults = [], gestureTimings = []) {
  const results = [];
  const expect = (name, ok, detail) => results.push({ name, ok, detail });

  for (const rule of step.assert ?? []) {
    if (rule.gesture_budget !== undefined) {
      // The gesture's own round trip against a millisecond budget (issue
      // #266). Payload: `{ max_ms, gesture? }`; `gesture` defaults to the
      // step's first timed gesture. A missing reading is a FAIL, never a
      // silent pass: an un-timed budget proves nothing.
      const want = rule.gesture_budget;
      const gestureName = want.gesture;
      const readings =
        gestureName === undefined
          ? gestureTimings
          : gestureTimings.filter((t) => t.gesture === gestureName);
      const reading = readings.at(-1);
      if (reading === undefined || reading.ms === null) {
        expect(
          `gesture_budget ${gestureName ?? "(any)"} ≤${want.max_ms}ms`,
          false,
          readings.length === 0
            ? "no timed gesture matched — the step must declare a timed gesture"
            : "the gesture never settled inside the read window",
        );
      } else {
        expect(
          `gesture_budget ${reading.gesture} ≤${want.max_ms}ms`,
          reading.ms <= want.max_ms,
          `measured ${reading.ms}ms`,
        );
      }
    }
    if (rule.column !== undefined) {
      const state = await page.evaluate(pageOrder, rule.column);
      if (state === null) {
        expect(`column ${rule.column} exists`, false, "column not found on the board");
        continue;
      }
      if (rule.ordered !== undefined) {
        const want = rule.ordered.join(",");
        const got = state.ids.join(",");
        expect(
          `${rule.column} order`,
          want === got,
          `want [${want}] got [${got}]`,
        );
      }
      if (rule.ranked !== undefined) {
        expect(
          `${rule.column} ranked=${rule.ranked}`,
          state.ranked === rule.ranked,
          state.ranked ? "lane offers a reorder" : "lane shows no reorder affordance",
        );
      }
    }
    if (rule.column_ordered !== undefined) {
      const got = await page.evaluate(
        (id) =>
          document.querySelector(`section[data-column-id="${id}"]`)?.getAttribute(
            "data-column-ordered",
          ) === "true",
        rule.column_ordered.column,
      );
      expect(
        `${rule.column_ordered.column} hand-ordered=${rule.column_ordered.ordered}`,
        got === rule.column_ordered.ordered,
        got ? "lane has a stored order" : "lane has no stored order",
      );
    }
    if (rule.rank_slots !== undefined) {
      // How many cards in this lane offer themselves as reorder drop targets.
      const got = await page.evaluate(
        (id) =>
          document.querySelectorAll(`section[data-column-id="${id}"] li[data-rank-slot]`).length,
        rule.rank_slots.column,
      );
      expect(
        `${rule.rank_slots.column} has ${rule.rank_slots.count} reorder slots`,
        got === rule.rank_slots.count,
        `found ${got}`,
      );
    }
    if (rule.store !== undefined) {
      const got = await page.evaluate(() => globalThis.__uat.ranks());
      const want = rule.store;
      expect(
        `stored order ${JSON.stringify(want)}`,
        JSON.stringify(got) === JSON.stringify(want),
        `stored ${JSON.stringify(got)}`,
      );
    }
    if (rule.rpc_called !== undefined) {
      const calls = await page.evaluate(() =>
        globalThis.__uat.calls().filter((call) => call.method === "rank_move"),
      );
      const last = calls.at(-1)?.args ?? null;
      const want = rule.rpc_called;
      const hit =
        last !== null &&
        Object.entries(want).every(([k, v]) => last[k] === v);
      expect(`rank_move ${JSON.stringify(want)}`, hit, `last call args ${JSON.stringify(last)}`);
    }
    if (rule.expect_drop_refused === true) {
      // The inverse of the normal rule: a cross-lane reorder is refused by
      // design, so nothing must authorise it. A `true` here is the pass.
      expect(
        "cross-lane drop refused",
        gestureResults.some((r) => r.name === "drop permitted during drag" && r.ok === false),
        "the drop was permitted, so a cross-lane reorder could land",
      );
    }
    if (rule.visible_error !== undefined) {
      const text = await page.evaluate(() => {
        // The refusal banners carry role="status" on their wrapper with the
        // text inside a <p>: read the wrapper's own text, with the failure
        // banner's testid first so the answer is never an unrelated status.
        const banner = document.querySelector('[data-testid="rank-error-banner"]');
        const el = banner ?? document.querySelector('p[role="status"]');
        return (el instanceof Element ? el.textContent : el?.textContent ?? "")?.trim() ?? "";
      });
      const re =
        rule.visible_error instanceof RegExp
          ? rule.visible_error
          : new RegExp(rule.visible_error);
      expect("failure reported on screen", re.test(text), `banner said ${JSON.stringify(text)}`);
    }
    if (rule.no_visible_error === true) {
      const text = await page.evaluate(
        () => document.querySelector('p[role="status"]')?.textContent?.trim() ?? "",
      );
      expect("no refusal banner", text === "", `banner said ${JSON.stringify(text)}`);
    }
    if (rule.parent_row_sweep !== undefined) {
      const want = rule.parent_row_sweep;
      const got = await page.evaluate(pageParentRowSweep, want.row);
      if (!got.ok) {
        expect(`parent row sweep (${want.row})`, false, got.reason);
      } else {
        if (want.present !== undefined) {
          expect(
            `row ${want.row} sweep pill ${want.present ? "present" : "absent"}`,
            got.present === want.present,
            `pill ${want.present ? "present" : "absent"} (cell reads ${JSON.stringify(got.label)})`,
          );
        }
        if (want.count !== undefined) {
          expect(
            `row ${want.row} pill reads ${want.count}`,
            got.pill.startsWith(String(want.count)),
            `pill reads ${JSON.stringify(got.pill)}`,
          );
        }
        if (want.pill !== undefined) {
          const re = new RegExp(want.pill);
          expect(
            `row ${want.row} pill matches ${want.pill}`,
            re.test(got.pill),
            `pill reads ${JSON.stringify(got.pill)}`,
          );
        }
        if (want.cancel !== undefined) {
          expect(
            `row ${want.row} ${want.cancel ? "offers" : "hides"} the sweep exit`,
            got.cancel === want.cancel,
            got.cancel ? "exit button present" : "no exit button",
          );
        }
        if (want.excludes !== undefined) {
          expect(
            `row ${want.row} excludes ${want.excludes.join(",")}`,
            want.excludes.every((id) => !got.highlighted.includes(id)),
            `highlighted ${JSON.stringify(got.highlighted)}`,
          );
        }
        if (want.armed !== undefined) {
          expect(
            `row ${want.row} ${want.armed ? "armed" : "not armed"}`,
            got.armed === want.armed,
            got.armed ? "armed" : "not armed",
          );
        }
        if (want.highlighted !== undefined) {
          expect(
            `row ${want.row} highlights ${want.highlighted.join(",") || "(none)"}`,
            JSON.stringify([...got.highlighted].sort()) ===
              JSON.stringify([...want.highlighted].sort()),
            `highlighted ${JSON.stringify(got.highlighted)}`,
          );
        }
        if (want.includes !== undefined) {
          expect(
            `row ${want.row} highlights ${want.includes.join(",")}`,
            want.includes.every((id) => got.highlighted.includes(id)),
            `highlighted ${JSON.stringify(got.highlighted)}`,
          );
        }
        if (want.active !== undefined) {
          expect(
            `row ${want.row} active sweep card is ${want.active}`,
            got.activeId === want.active,
            `active ${JSON.stringify(got.activeId)}`,
          );
        }
      }
    }
    if (rule.parent_row_sweep_lanes !== undefined) {
      // Each named lane must hold that many highlighted cards (a subset
      // check, not equality: context lanes chip their overflow, so the
      // rendered spread is a lower bound on the row's preselect).
      const want = rule.parent_row_sweep_lanes;
      const got = await page.evaluate(pageParentRowSweepSpread);
      const missing = Object.entries(want).filter(([lane, n]) => got[lane] !== n);
      expect(
        `row sweep reaches ${Object.entries(want).map(([lane, n]) => `${lane}:${n}`).join(", ")}`,
        missing.length === 0,
        missing.length === 0
          ? `spread ${JSON.stringify(got)}`
          : `spread ${JSON.stringify(got)} misses ${JSON.stringify(Object.fromEntries(missing))}`,
      );
    }
    if (rule.sweep_banner !== undefined) {
      const want = rule.sweep_banner;
      const got = await page.evaluate(pageSweepBanner);
      if (want.notice !== undefined) {
        const re = new RegExp(want.notice);
        expect(
          `sweep notice matches ${want.notice}`,
          got.notice !== null && re.test(got.notice),
          `notice ${JSON.stringify(got.notice)}`,
        );
      }
      if (want.refusal !== undefined) {
        const re = new RegExp(want.refusal);
        expect(
          `sweep refusal matches ${want.refusal}`,
          got.refusal !== null && re.test(got.refusal),
          `refusal ${JSON.stringify(got.refusal)}`,
        );
      }
      if (want.undo !== undefined) {
        expect(
          `sweep undo ${want.undo ? "offered" : "absent"}`,
          got.undo === want.undo,
          got.undo ? "undo button present" : "no undo button",
        );
      }
    }
    if (rule.sweep_archived !== undefined) {
      const got = await page.evaluate(pageSweepArchived);
      const want = rule.sweep_archived;
      expect(
        `archived set is ${JSON.stringify(want)}`,
        JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()),
        `archived ${JSON.stringify(got)}`,
      );
    }
    if (rule.sweep_done_set !== undefined) {
      // The last done_set call's args must carry every key/value given — the
      // Focus view's idle arm and the Parent view's row arm both write here.
      const want = rule.sweep_done_set;
      const last = await page.evaluate(() => {
        const calls = globalThis.__uat.calls().filter((call) => call.method === "done_set");
        return calls.at(-1)?.args ?? null;
      });
      const hit =
        last !== null &&
        typeof last === "object" &&
        Object.entries(want).every(([key, value]) => last[key] === value);
      expect(
        `done_set ${JSON.stringify(want)}`,
        hit,
        `last call args ${JSON.stringify(last)}`,
      );
    }
    if (rule.column_card_visible !== undefined) {
      const got = await page.evaluate(pageColumnCardVisible, rule.column_card_visible);
      expect(
        `card ${rule.column_card_visible} in the columns board's view`,
        got.ok === true,
        got.reason,
      );
    }
    if (rule.pane !== undefined) {
      const got = await page.evaluate(pagePaneState);
      const want = rule.pane;
      if (want.threadId !== undefined) {
        // The pane's aria-label carries the thread's display title, not its
        // id; assert on the title the card and the pane share.
        const title = await page.evaluate(
          (id) =>
            document.querySelector(`[data-thread-card="${id}"] p`)?.textContent?.trim() ??
            null,
          want.threadId,
        );
        expect(
          `pane shows ${want.threadId}`,
          want.threadId === null ? got.open === false : got.open && got.threadId === title,
          `pane ${got.open ? `showing ${JSON.stringify(got.threadId)}` : "closed"}`,
        );
      } else {
        expect(
          `pane ${want.open ? "open" : "closed"}`,
          got.open === want.open,
          got.open ? "pane open" : "pane closed",
        );
      }
    }
    if (rule.active_card !== undefined) {
      const want = rule.active_card;
      const got = await page.evaluate(pageActiveCard);
      expect(
        `active card is ${want.id ?? "(none)"}`,
        got.id === (want.id ?? null),
        got.id === null ? "no active card" : `active card is ${got.id}`,
      );
      if (want.visible !== undefined) {
        expect(
          `active card ${want.visible ? "visible" : "offscreen"}`,
          got.visible === want.visible,
          got.visible ? "card in view" : "card scrolled out of view",
        );
      }
    }
    if (rule.url !== undefined) {
      // URL assertions, not history.length: Chrome reads history.length
      // stale after a back-then-push sequence (the entry is added — forward
      // reaches it — but the count lags), so length is not a trustworthy
      // assertion. The URL is the feature's own record.
      const got = await page.evaluate(() => window.location.href);
      const want = rule.url.suffix ?? rule.url;
      expect(
        `url ends with ${want}`,
        got.endsWith(want),
        `url is ${got}`,
      );
    }
    if (rule.whats_new !== undefined) {
      const want = rule.whats_new;
      const got = await page.evaluate(pageWhatsNew);
      if (want.icon !== undefined) {
        expect(
          `what's-new button ${want.icon ? "present" : "absent"}`,
          got.icon === want.icon,
          got.icon ? "gift button present" : "gift button absent",
        );
      }
      if (want.unseen !== undefined) {
        // Binary costume: unseen renders the "What's new" gift; seen renders
        // the "Focus Board settings" gear. The pulse class alone can't tell
        // the two states apart once the gear takes over, so assert the class
        // AND the label together.
        const [unseen, giftLabel, gearLabel] = await page.evaluate(() => {
          const gift = document.querySelector('button[aria-label="What\'s new"]');
          const gear = document.querySelector('button[aria-label="Focus Board settings"]');
          return [
            gift?.classList.contains("motion-safe:animate-pulse") ?? false,
            gift !== null && gear === null,
            gear !== null && gift === null,
          ];
        });
        const labelMatches = want.unseen ? giftLabel : gearLabel;
        expect(
          `what's-new ${want.unseen ? "unseen (pulsing gift)" : "seen (quiet gear)"}`,
          unseen === want.unseen && labelMatches,
          unseen ? "pulsing" : "quiet",
        );
      }
      if (want.tab !== undefined) {
        expect(
          `settings modal selected tab ${JSON.stringify(want.tab)}`,
          got.tab === want.tab,
          got.tab === null ? "no tab selected" : `selected: ${got.tab}`,
        );
      }
      if (want.modal !== undefined) {
        expect(
          `what's-new modal ${want.modal ? "open" : "closed"}`,
          got.modal === want.modal,
          got.modal ? "modal open" : "modal closed",
        );
      }
    }
    if (rule.aria_present !== undefined) {
      const got = await page.evaluate(pageAriaProbe, rule.aria_present);
      expect(
        `control present: ${JSON.stringify(rule.aria_present)}`,
        got.present,
        got.present ? "present" : "absent",
      );
    }
    if (rule.aria_absent !== undefined) {
      const got = await page.evaluate(pageAriaProbe, rule.aria_absent);
      expect(
        `control absent: ${JSON.stringify(rule.aria_absent)}`,
        !got.present,
        got.present ? "still on the page" : "absent",
      );
    }
    if (rule.queued_send_reach !== undefined) {
      const payload = rule.queued_send_reach === true ? {} : rule.queued_send_reach;
      const got = await page.evaluate(pageQueuedSendReach, payload);
      expect(
        "queued-send reveal is tappable on touch and Send sends the row",
        got.ok,
        got.ok ? "tapped the reveal, tapped Send, row gone" : got.reason,
      );
    }
    // ── Touch surface (issue #328) ───────────────────────────────────────
    // The four rules below read the reading a `touch_pan` gesture leaves in
    // the page (`__uatTouch`) plus the live DOM. A rule with no reading behind
    // it FAILS rather than passing vacuously: a step that forgot its gesture
    // proves nothing about touch.
    if (
      rule.touch_origin !== undefined ||
      rule.touch_scroll !== undefined ||
      rule.no_native_drag !== undefined
    ) {
      const reading = await page.evaluate(() => globalThis.__uatTouch ?? null);
      if (reading === null) {
        expect(
          "a touch pan ran in this step",
          false,
          "no touch_pan reading on the page — the touch assertions would prove nothing",
        );
      } else {
        if (rule.touch_origin !== undefined) {
          const want = rule.touch_origin;
          const got = reading.under ?? {};
          const mismatched = Object.entries(want).filter(([key, value]) => got[key] !== value);
          expect(
            `the finger landed on ${JSON.stringify(want)}`,
            mismatched.length === 0,
            mismatched.length === 0
              ? `landed on ${JSON.stringify(got)}`
              : `landed on ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
          );
        }
        if (rule.touch_scroll !== undefined) {
          const want = rule.touch_scroll; // { target, axis, min?, direction? }
          const axis = want.axis === "y" ? "y" : "x";
          const moved = reading.delta[want.target === "lane" ? "lane" : "board"][axis];
          const min = Number(want.min ?? 1);
          const direction = want.direction ?? "any";
          const sign = Math.sign(moved);
          const directionOk =
            direction === "positive" ? sign > 0 : direction === "negative" ? sign < 0 : true;
          expect(
            `the ${want.target ?? "board"} ${axis} scrolled ${direction === "any" ? "at least" : direction} ${min}px`,
            Math.abs(moved) >= min && directionOk,
            `${want.target ?? "board"} ${axis} moved ${moved}px ` +
              `(board ${reading.before.boardX},${reading.before.boardY} → ${reading.after.boardX},${reading.after.boardY}; ` +
              `lane ${reading.before.laneX},${reading.before.laneY} → ${reading.after.laneX},${reading.after.laneY})`,
          );
        }
        if (rule.no_native_drag !== undefined) {
          const wanted = rule.no_native_drag === true;
          expect(
            wanted ? "the browser started no native drag" : "the browser started a native drag",
            (reading.dragStarts.length === 0) === wanted,
            reading.dragStarts.length === 0
              ? "no dragstart fired during the pan"
              : `${reading.dragStarts.length} dragstart(s): ${JSON.stringify(reading.dragStarts)}`,
          );
        }
      }
    }
    if (rule.drag_source !== undefined) {
      // The per-card half of the touch contract, in both directions: on a
      // fine pointer the card must stay an armed HTML5 drag source (the
      // cursor reorder suites ride on this), and on a coarse one it must not
      // (a finger must pan, issue #328).
      const want = rule.drag_source;
      const got = await page.evaluate((id) => {
        const card = document.querySelector(`[data-thread-card="${id}"]`);
        if (card === null) return null;
        const anchor = card.querySelector("a");
        return {
          anchor: anchor?.getAttribute("draggable") ?? null,
          coarse: matchMedia("(pointer: coarse)").matches,
        };
      }, want.card);
      if (got === null) {
        expect(`card ${want.card} drag source`, false, "no such card on the board");
      } else {
        expect(
          `card ${want.card} is ${want.armed === false ? "not " : ""}a native drag source`,
          got.anchor === String(want.armed !== false),
          `draggable=${JSON.stringify(got.anchor)} on a ${got.coarse ? "coarse" : "fine"} pointer`,
        );
      }
    }
    if (rule.scroll_offset !== undefined) {
      // A scroll offset of the board or of one lane's card list. Paired with
      // an `assert_before_drag` of the same rule, it proves a scroll gesture
      // moved that surface (and that a drag gesture did not).
      const want = rule.scroll_offset; // { target?, column?, axis, min?, max?, equals? }
      const target = want.target === "lane" ? "lane" : "board";
      const got = await page.evaluate(
        ({ target, column }) => {
          const el =
            target === "lane"
              ? document.querySelector(`section[data-column-id="${column}"] [data-card-list]`)
              : document.querySelector("[data-columns-board]");
          if (el === null) return null;
          return {
            x: Math.round(el.scrollLeft),
            y: Math.round(el.scrollTop),
            maxX: el.scrollWidth - el.clientWidth,
            maxY: el.scrollHeight - el.clientHeight,
          };
        },
        { target, column: want.column },
      );
      const name = target === "lane" ? `lane ${want.column}` : "board";
      if (got === null) {
        expect(`${name} offset`, false, `no ${target} scroller on the page`);
      } else {
        const axis = want.axis === "y" ? "y" : "x";
        const value = got[axis];
        const ok =
          (want.min === undefined || value >= Number(want.min)) &&
          (want.max === undefined || value <= Number(want.max)) &&
          (want.equals === undefined || value === Number(want.equals));
        expect(
          `${name} ${axis} offset ${want.equals === undefined ? `${want.min ?? ""}≤${value}≤${want.max ?? ""}` : `= ${want.equals}`}`,
          ok,
          `${name} ${axis}=${value} (max ${axis === "x" ? got.maxX : got.maxY})`,
        );
      }
    }
    if (rule.touch_drag_armor !== undefined) {
      const payload = rule.touch_drag_armor === true ? {} : rule.touch_drag_armor;
      const got = await page.evaluate(pageTouchDragArmor, payload);
      if (!got.ok) {
        expect("touch drag armor", false, got.reason);
      } else {
        // The premise first: a fine-pointer viewport (no `hasTouch`) hides the
        // touch utilities by design, so every assertion below would pass for
        // the wrong reason.
        expect(
          "the viewport presents a coarse pointer and no hover",
          got.coarse && got.hoverNone,
          `(pointer: coarse)=${got.coarse}, (hover: none)=${got.hoverNone} — set viewport { hasTouch: true, isMobile: true }`,
        );
        expect(
          "no card is a native drag source, so a finger's pan cannot lift one",
          got.sources === 0,
          `${got.sources} armed drag source(s) inside the board: ${got.sourceSample.join(", ")}`,
        );
        expect(
          "the card's anchor is not draggable",
          got.anchorDrag === "false",
          `draggable=${JSON.stringify(got.anchorDrag)} (box ${got.anchorBox})`,
        );
        expect(
          "the card's text is not touch-selectable, so a long press pans",
          got.anchorUserSelect === "none",
          `user-select=${JSON.stringify(got.anchorUserSelect)}`,
        );
        // The pan must never be forbidden: these surfaces declare
        // `manipulation` (pan both axes, keep pinch), not `none` or a single
        // axis, which would eat one of the two scroll directions.
        for (const [name, value] of [
          ["board", got.boardTouchAction],
          ["lane list", got.laneTouchAction],
        ]) {
          expect(
            `the ${name} allows both pan axes`,
            value === "manipulation",
            `touch-action=${JSON.stringify(value)}`,
          );
        }
      }
    }
    if (rule.text_visible !== undefined) {
      const got = await page.evaluate(pageTextVisible, rule.text_visible);
      expect(
        `text visible: ${JSON.stringify(rule.text_visible)}`,
        got,
        got ? "present" : "not found in page text",
      );
    }
    if (rule.text_hidden !== undefined) {
      const got = await page.evaluate(pageTextVisible, rule.text_hidden);
      expect(
        `text hidden: ${JSON.stringify(rule.text_hidden)}`,
        !got,
        !got ? "absent" : "found in page text",
      );
    }
    if (rule.text_count !== undefined) {
      // An exact occurrence count over the page's rendered text — the way a
      // suite proves ONE row/label exists where a duplicate would render a
      // second (a group box per group, a picker row per registry record).
      const want = rule.text_count; // { text, count }
      const got = await page.evaluate((text) => {
        const body = document.body.innerText ?? "";
        return body.split(text).length - 1;
      }, want.text);
      expect(
        `text ${JSON.stringify(want.text)} appears exactly ${want.count} time(s)`,
        got === want.count,
        `appeared ${got} time(s)`,
      );
    }
    if (rule.locked_lane !== undefined) {
      const got = await page.evaluate(pageLockedLane);
      const want = rule.locked_lane;
      const ok = want === true ? got !== null : got === want;
      expect(
        `locked lane: ${JSON.stringify(want)}`,
        ok,
        ok ? `locked=${got}` : `locked=${got}`,
      );
    }
    if (rule.locked_flush !== undefined) {
      const got = await page.evaluate(pageLockedFlush);
      expect(
        "locked lane pinned flush against the rail",
        got.ok === rule.locked_flush,
        got.reason,
      );
    }
    if (rule.bands_aligned !== undefined) {
      const got = await page.evaluate(pageBandsAligned);
      expect(
        "bands aligned across lanes",
        got.ok === rule.bands_aligned,
        got.reason,
      );
    }
    if (rule.card_visible !== undefined) {
      const got = await page.evaluate(pageCardVisible, rule.card_visible);
      expect(`card visible: ${rule.card_visible}`, got.ok === true, got.reason);
    }
    if (rule.attention_pulse !== undefined) {
      const want = rule.attention_pulse; // { visible_animate?, parked_still?, parked_at_least? }
      const got = await page.evaluate(pageAttentionPulse);
      if (want.parked_at_least !== undefined) {
        expect(
          `at least ${want.parked_at_least} attention pulse(s) parked off screen`,
          got.parked >= want.parked_at_least,
          `parked ${got.parked} of ${got.total} (visible ${got.visible})`,
        );
      }
      if (want.visible_animate !== undefined) {
        expect(
          `on-screen pulses animate (${got.runningVisible}/${got.visible})`,
          want.visible_animate ? got.runningVisible === got.visible && got.visible > 0 : true,
          `visible ${got.visible}, animating ${got.runningVisible}`,
        );
      }
      if (want.parked_still !== undefined) {
        // The gate's contract: a parked pulse must NOT be animating.
        expect(
          `off-screen pulses hold still (${got.runningParked} of ${got.parked} still animating)`,
          want.parked_still ? got.runningParked === 0 : true,
          `${got.parked} parked, ${got.runningParked} still animating`,
        );
      }
    }
    if (rule.lane_direction !== undefined) {
      // The board declares its lane direction on the scroll container
      // (data-lane-direction), so a suite can pin the layout the
      // lane-direction preference produced (issue #153's UAT surface). The
      // read retries briefly: the goto's own wait can resolve on a surface
      // that precedes the columns board's commit, and a bare moment-read
      // then reports a null that was never a real board state.
      const got = await (async () => {
        const deadline = Date.now() + 2000;
        let value = null;
        while (Date.now() < deadline) {
          value = await page.evaluate(
            () => document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ?? null,
          );
          if (value !== null) return value;
          await sleep(200);
        }
        return value;
      })();
      expect(
        `lane direction: ${rule.lane_direction}`,
        got === rule.lane_direction,
        `board declared ${JSON.stringify(got)}`,
      );
    }
    if (rule.band_hover !== undefined) {
      const got = await page.evaluate(pageBandHover);
      expect(`swimlane hover shades one row across lanes`, got.ok === rule.band_hover, got.reason ?? "");
    }
    if (rule.hover_prominence !== undefined) {
      const want = rule.hover_prominence; // { card, pointer_hover? }
      const got = await page.evaluate(pageHoverProminence, want.card);
      if (got.ok === false) {
        expect(`hover prominence (${want.card})`, false, got.reason);
      } else if (want.pointer_hover === false) {
        // The release case: the pointer has been parked elsewhere, so the
        // surface hands back — the card reads the resting token again, and
        // the recede dim has let go of the sibling (rule removes, dim eases
        // out over the card's own 150ms transition).
        expect(
          `the pointer left ${want.card}`,
          got.pointerHover === false,
          got.pointerHover ? "still hovered" : "not hovered",
        );
        expect(
          "the card surface is the resting token again",
          got.hoveredL !== null && Math.abs(got.hoveredL - got.restL) < 0.001,
          `rest ${got.rest} (${got.restL}) hovered ${got.hovered} (${got.hoveredL})`,
        );
        expect(
          "the recede dim let go",
          parseFloat(got.siblingOpacity) === 1,
          `sibling ${got.siblingId} opacity ${got.siblingOpacity}`,
        );
      } else {
        expect(
          `hover probe landed on ${want.card}`,
          got.pointerHover === true,
          got.pointerHover ? "hovered" : "the pointer never produced a :hover on the card",
        );
        expect(
          "hovered surface opaque — the lane/wallpaper never bleeds through",
          got.alpha >= 1,
          `alpha ${got.alpha} (${got.hovered})`,
        );
        if (got.restL === null || got.hoveredL === null) {
          expect("rest and hovered surfaces readable", false, `not OK-space colors: rest ${got.rest} / hovered ${got.hovered}`);
        } else if (got.dark) {
          expect(
            "dark theme: the hovered surface DARKENS (the emphasis direction, 19.5% → ~15.6%)",
            got.hoveredL < got.restL,
            `dark rest L ${got.restL} hovered L ${got.hoveredL}`,
          );
        } else {
          expect(
            "light theme: the hovered surface NEVER darkens (#195 — darkening there reads as muting)",
            got.hoveredL >= got.restL - 0.001,
            `light rest L ${got.restL} hovered L ${got.hoveredL} (hovered surface ${got.hovered})`,
          );
        }
        expect(
          "spotlight recedes another card while a card is under the pointer",
          parseFloat(got.siblingOpacity) < 1,
          `sibling ${got.siblingId} opacity ${got.siblingOpacity}`,
        );
      }
    }
    if (rule.nest_locked !== undefined) {
      const toggle = await page.evaluate(pageNestToggle);
      if (!toggle.present) {
        expect(
          `nest toggle locked: ${rule.nest_locked}`,
          false,
          toggle.reason ?? "Nest child threads checkbox not found",
        );
      } else {
        const ok = rule.nest_locked
          ? toggle.checked === true && toggle.disabled === true
          : toggle.checked === true && toggle.disabled !== true;
        expect(
          `nest toggle: aria-checked=${String(toggle.checked)} aria-disabled=${String(toggle.disabled)}`,
          ok,
          `locked=${String(rule.nest_locked)}`,
        );
      }
    }
    if (rule.board_quiet !== undefined) {
      const want = rule.board_quiet;
      let noise;
      if (want.mode === "wheel") {
        // mode: wheel pans with real wheel events through the browser's
        // input pipeline instead of a scrollLeft assignment.
        await page.evaluate(pageBoardNoiseArm);
        await wheelPan(page, { dx: want.dx ?? 480 });
        noise = await page.evaluate(pageBoardNoiseRead, { holdMs: want.hold_ms ?? 2500 });
      } else {
        noise = await page.evaluate(pageBoardNoise, {
          dx: want.dx ?? 480,
          holdMs: want.hold_ms ?? 2500,
        });
      }
      const quietOk = noise.events <= (want.max_events ?? 60) && noise.tail >= (want.max_tail_ms ?? 500);
      expect(
        `board quiet after pan: ≤${want.max_events ?? 60} events, still ≥${want.max_tail_ms ?? 500}ms`,
        quietOk,
        `${noise.events} events over the hold, last ${Math.round(noise.tail)}ms ago`,
      );
    }
    if (rule.rpc_called_method !== undefined) {
      const methods = await page.evaluate(() =>
        globalThis.__uat.calls().map((call) => call.method),
      );
      expect(
        `called ${rule.rpc_called_method}`,
        methods.includes(rule.rpc_called_method),
        `calls: ${methods.join(", ") || "(none)"}`,
      );
    }
    if (rule.rpc_not_called !== undefined) {
      // The method name goes in as an argument: a closure over `rule` here
      // throws inside the page, but only once the call log is non-empty and
      // the filter actually runs.
      const method = rule.rpc_not_called;
      const calls = await page.evaluate(
        (name) => globalThis.__uat.calls().filter((call) => call.method === name),
        method,
      );
      expect(`no ${method} call`, calls.length === 0, `${calls.length} call(s) made`);
    }
    if (rule.rpc_last !== undefined) {
      // The LAST call of a method carries the args the handler actually
      // received ({ method, args } subset-match), so a suite can assert the
      // path a control chose (e.g. thread_autotitle with useThreadModel:
      // true, or a pluginId/serviceId override pair from the fallback modal).
      const { method, args: wantArgs } = rule.rpc_last;
      const last = await page.evaluate(
        (name) => globalThis.__uat.calls().filter((call) => call.method === name).at(-1) ?? null,
        method,
      );
      const hit =
        last !== null &&
        last.args !== undefined &&
        typeof last.args === "object" &&
        Object.entries(wantArgs).every(([k, v]) => last.args[k] === v);
      expect(
        `${method} last called with ${JSON.stringify(wantArgs)}`,
        hit,
        `last ${method} call args ${JSON.stringify(last?.args ?? null)}`,
      );
    }
    if (rule.nest_ring !== undefined) {
      // Hover first (the ring rides the dragover commit), then sample.
      const want = rule.nest_ring; // { to: id, shown: boolean }
      const hoverOutcome = await page.evaluate(pageHover, {
        from: want.from,
        to: want.to,
        edge: "onto",
      });
      await sleep(150);
      const shown = await page.evaluate(pageNestRing, { to: want.to });
      expect(
        want.shown ? "nest ring visible on the hovered card" : "no nest ring",
        shown.shown === want.shown,
        shown.reason,
      );
      if (want.shown) {
        // A hovered nest zone must also be a permitted drop — some handler
        // called preventDefault — or a real browser refuses the drop with
        // only "can't drop" for an explanation.
        expect(
          "drop permitted during nest hover",
          hoverOutcome.dropAllowed !== false,
          "no dragover handler called preventDefault on the nest zone",
        );
      }
    }
    if (rule.nested_row !== undefined) {
      const want = rule.nested_row; // { id: threadId, shown: boolean }
      const found = await page.evaluate((id) => {
        const row = document.querySelector(`[data-nested-rows] [data-thread-card="${id}"]`);
        return { found: row !== null };
      }, want.id);
      expect(
        want.shown ? `nested row under the family card (${want.id})` : `no nested row (${want.id})`,
        found.found === want.shown,
        `nested-row slot ${want.shown ? "absent" : "present"}`,
      );
    }
    if (rule.sub_row !== undefined) {
      // Depth-2 (issue #192's UAT coverage): the grandchild row renders under
      // its parent row and indents.
      const want = rule.sub_row; // { id, under, shown }
      const probe = await page.evaluate(pageSubRow, { id: want.id, under: want.under });
      expect(
        want.shown
          ? `sub-row under its parent row (${want.id} under ${want.under})`
          : `no sub-row (${want.id})`,
        probe.present === want.shown && (want.shown ? probe.indented : true),
        probe.reason,
      );
    }
    if (rule.child_chip !== undefined) {
      // The nested row's own condensed chip (PR #194, the #191 behavior).
      // `in_sub_rows: true` pins the depth-2 case: a grandchild's chip.
      const want = rule.child_chip; // { id, text, in_sub_rows?: boolean }
      const probe = await page.evaluate(pageChildChip, { id: want.id, text: want.text });
      const tierOk =
        want.in_sub_rows === undefined || (want.in_sub_rows === (probe.tier === "sub-row"));
      expect(
        `nested row chips its ticket ${want.text} (${want.id})`,
        probe.shown === true && tierOk,
        probe.reason,
      );
    }
    if (rule.right_gutter !== undefined) {
      // The family card's right gutter (issue #192): content surfaces stop
      // short of the card's right edge, the card box stops short of the lane's.
      const want = rule.right_gutter; // { card, min_inset? }
      const probe = await page.evaluate(pageRightGutter, {
        card: want.card,
        minInset: want.min_inset ?? 4,
      });
      expect(
        `${want.card} respects the right gutter (≥${want.min_inset ?? 4}px on every surface)`,
        probe.ok,
        probe.failures.length > 0 ? probe.failures.join("; ") : "all surfaces measured",
      );
    }
    if (rule.pane_board_floor !== undefined) {
      // The pane's board-lane floor (issue #273): after the pane is dragged
      // wide, the board keeps its lane floor and no board element crosses the
      // pane's left edge.
      const want = rule.pane_board_floor; // { floor?: px }
      const floor = want.floor ?? 320;
      const probe = await page.evaluate(pagePaneBoardFloor, { floor });
      expect(
        `the board keeps its ${floor}px lane floor beside a wide pane`,
        probe.ok,
        probe.detail,
      );
    }
    if (rule.floor_amber !== undefined) {
      // Hover a child over the floor (the amber rides the dragover commit),
      // sample, then clean the drag up — no drop is performed.
      const want = rule.floor_amber; // { from: threadId, column, shown: boolean }
      const shown = await page.evaluate(pageFloorAmber, want);
      expect(
        want.shown ? "floor rings amber for the family detach hover" : "no amber floor ring",
        shown.shown === want.shown,
        shown.reason,
      );
    }
    if (rule.header_amber !== undefined) {
      // The title strip is the near detach target: probe its amber hover
      // ring, plus its growth while the drag is in flight.
      const want = rule.header_amber; // { from: threadId, column, shown: boolean }
      const shown = await page.evaluate(pageHeaderAmber, want);
      expect(
        want.shown ? "header rings amber for the family detach hover" : "no amber header ring",
        shown.shown === want.shown && (want.grown === undefined || shown.grown === want.grown),
        shown.reason,
      );
    }
    if (rule.reparent_called !== undefined) {
      // The last thread_reparent call's args must carry every key/value given
      // — child drops assert {threadId, parentThreadId: null} this way.
      const want = rule.reparent_called;
      const last = await page.evaluate(() => {
        const calls = globalThis
          .__uat.calls()
          .filter((call) => call.method === "thread_reparent");
        return calls.at(-1)?.args ?? null;
      });
      const hit =
        last !== null &&
        Object.entries(want).every(([k, v]) => last[k] === v);
      expect(
        `thread_reparent ${JSON.stringify(want)}`,
        hit,
        `last call args ${JSON.stringify(last)}`,
      );
    }
    if (rule.dot_order !== undefined) {
      // The collapsed strip's dot sequence, read off the family card's own
      // strip by DOM order: { family: <thread id>, dots: [...] }.
      const want = rule.dot_order;
      const got = await page.evaluate((familyCardId) => {
        const strip = document.querySelector(
          `[data-thread-card="${familyCardId}"] [data-child-thread-dots]`,
        );
        if (strip === null) return null;
        return [...strip.querySelectorAll("button[data-child-dot]")].map((button) =>
          button.getAttribute("data-child-dot"),
        );
      }, want.family);
      if (got === null) {
        expect(`strip dots of ${want.family}`, false, "no collapsed strip rendered for this family");
      } else {
        const hit = JSON.stringify(got) === JSON.stringify(want.dots ?? want.order ?? want);
        expect(
          `strip dots of ${want.family}`,
          hit,
          `painted ${JSON.stringify(got)} want ${JSON.stringify(want.dots ?? want.order ?? want)}`,
        );
      }
    }
    if (rule.dot_escape_hover !== undefined) {
      // The morph read LIVE: a dot drags out over another column and the
      // home card's ring is sampled mid-gesture, then the drag unwinds.
      // { from: <dot>, column: <a section to hover over>, shown: boolean }.
      const got = await page.evaluate(pageDotEscape, rule.dot_escape_hover);
      expect(
        "the morph ring shows while the drag is out of its strip",
        got.shown === (rule.dot_escape_hover.shown ?? true),
        got.reason,
      );
    }
    if (rule.dot_escape !== undefined) {
      // The morph's in-place marker while a dragged dot is outside its
      // strip: the dragged member's family card wears data-dot-escape.
      const want = rule.dot_escape;
      const got = await page.evaluate((cardId) => {
        const card = document.querySelector(`[data-thread-card="${cardId}"]`);
        if (card === null) return null;
        return card.hasAttribute("data-dot-escape");
      }, want.card);
      if (got === null) {
        expect(`morph ring on ${want.card}`, false, "no card rendered");
      } else {
        expect(
          `morph ring on ${want.card}`,
          got === (want.shown ?? true),
          got
            ? "the family card wears the morph ring"
            : "no family card wears the morph ring",
        );
      }
    }
    if (rule.cleared_line !== undefined) {
      // The hover's promise must die when the pointer crosses out of the slot
      // toward the title strip — sample the slot the line was parked on,
      // without re-hovering (the hover_header gesture already did the leave).
      const want = rule.cleared_line;
      await sleep(150);
      const line = await page.evaluate(pageLineShown, {
        to: want.to,
        edge: want.edge ?? "before",
      });
      expect("the line cleared when the drag left the card", !line.shown, `still painted: ${line.reason}`);
    }
    if (rule.insertion_line !== undefined || rule.no_insertion_line !== undefined) {
      // Hover first, then sample after React has committed the line.
      const wants = [rule.insertion_line, rule.no_insertion_line].filter((r) => r !== undefined);
      for (const want of wants) {
        const hoverOutcome = await page.evaluate(pageHover, want);
        await sleep(150);
        const probe = { to: want.to, edge: want.edge };
        const line = await page.evaluate(pageLineShown, probe);
        if (want === rule.insertion_line) {
          expect("insertion line visible", line.shown, line.reason);
          expect(
            "drop permitted during hover",
            hoverOutcome.dropAllowed !== false,
            "no dragover handler called preventDefault — a real browser would refuse this drop",
          );
        } else {
          expect("no insertion line", !line.shown, `a line rendered anyway (${line.reason})`);
        }
      }
    }
    if (rule.glyph_glue !== undefined) {
      const got = await page.evaluate(pageGlyphGlue);
      expect("open glyph glued to the code text", got.ok === true, got.reason);
    }
    if (rule.chip_placement !== undefined) {
      const got = await page.evaluate(pageChipPlacement, rule.chip_placement);
      expect("chip placement contract (issue #104)", got.ok === true, (got.failures ?? []).join("; "));
    }
    if (rule.live_region !== undefined) {
      const text = await page.evaluate(pageLiveRegion);
      const re = rule.live_region instanceof RegExp ? rule.live_region : new RegExp(rule.live_region);
      expect("move announced", re.test(text), `live region said ${JSON.stringify(text)}`);
    }
  }
  return results;
}

/**
 * The gesture fuzz (suite-level `fuzz: { steps, seed }`): a deterministic
 * per-seed sequence of board gestures picked off the live DOM — same-lane
 * reorders (edges and the nest third included), cross-lane state drops,
 * keyboard reorders through the REAL input pipeline (focus + Alt+arrow on
 * the browser's own key delivery), real-pointer card clicks, right-click
 * menu actions, host pushes that re-derive the lanes mid-suite, and Escape.
 * After every gesture the board invariants must hold, or the run fails with
 * the seed and the gesture trail that broke it. This is the difference
 * between "every behavior we scripted is tested" and "every sequence that
 * can happen gets tested".
 */
async function runFuzz(suite, { page, report }) {
  const steps = Number(suite.fuzz.steps ?? 120);
  const seed = Number(suite.fuzz.seed ?? 1);
  const rng = mulberry32(seed);
  const trail = [];
  const results = [];
  let ok = true;
  const stop = (problem) => {
    ok = false;
    results.push({ name: "fuzz invariant broke", ok: false, detail: problem });
  };
  const PUSH_PATCHES = [
    { isUnread: true },
    { isUnread: false },
    { status: "active" },
    { status: "idle" },
    { hasPendingInteraction: true },
    { hasPendingInteraction: false },
  ];
  const MENU_ITEMS = ["Pin", "Unpin", "Mark Done", "Mark Not Done", "Mark Unread", "Mark Read"];
  for (let index = 0; index < steps && ok; index += 1) {
    let state = null;
    try {
      state = await page.evaluate(pageFuzzState);
    } catch (error) {
      stop(`state read failed: ${String(error?.message ?? error)}`);
      break;
    }
    const lanes = state.lanes.filter((lane) => lane.cards.length > 0);
    const cardIds = [...new Set(lanes.flatMap((lane) => lane.cards))];
    const pick = (list) => list[Math.floor(rng() * list.length)];
    let gesture = { kind: "noop" };
    const roll = rng();
    if (state.modalOpen) {
      gesture = { kind: "press_escape" };
    } else if (state.boardOpen && lanes.length > 0 && cardIds.length > 0) {
      if (roll < 0.28) {
        const lane = pick(lanes);
        if (lane.cards.length >= 2) {
          const from = pick(lane.cards);
          const others = lane.cards.filter((id) => id !== from);
          gesture = {
            kind: "drag",
            from,
            to: pick(others),
            edge: roll < 0.18 ? "onto" : roll < 0.23 ? "before" : "after",
          };
        }
      } else if (roll < 0.48) {
        const lane = pick(lanes);
        const from = pick(lane.cards);
        const wanted =
          lane.columnId === "done" ? ["pinned"]
          : lane.columnId === "pinned" ? ["done", "unread"]
          : lane.columnId === "unread" ? ["done", "pinned"]
          : ["done", "pinned", "unread"];
        // A target column that is not on the board cannot take the drop: an
        // empty lane renders no section (the status "unread" lane with no
        // unread threads, for one), so there is nothing to aim at and a real
        // operator has no gesture to make. The pick still runs so the RNG
        // stream stays the one the seed names, then falls back to a rendered
        // target, or to a no-op when the lane offers none.
        const rendered = new Set(state.lanes.map((entry) => entry.columnId));
        const picked = pick(wanted);
        const column = rendered.has(picked)
          ? picked
          : wanted.find((id) => rendered.has(id));
        if (column !== undefined) {
          gesture = { kind: "drag_to_column", from, column };
        }
      } else if (roll < 0.60) {
        const steppable = lanes.filter((lane) => lane.cards.length >= 2);
        if (steppable.length > 0) {
          const lane = pick(steppable);
          gesture = {
            kind: "real_key",
            card: pick(lane.cards),
            key: pick(["ArrowUp", "ArrowDown"]),
          };
        }
      } else if (roll < 0.72) {
        const lane = pick(lanes);
        gesture = { kind: "menu", card: pick(lane.cards), item: pick(MENU_ITEMS) };
      } else if (roll < 0.80) {
        gesture = { kind: "click", card: pick(cardIds) };
      } else if (roll < 0.94) {
        gesture = { kind: "push_update", threadId: pick(cardIds), patch: pick(PUSH_PATCHES) };
      } else {
        gesture = { kind: "press_escape" };
      }
    }
    trail.push(JSON.stringify(gesture));
    try {
      if (gesture.kind === "drag") {
        const outcome = await page.evaluate(pageDrag, gesture);
        if (outcome.dropped === false) trail.push(`skipped: ${outcome.reason}`);
        await sleep(250);
      } else if (gesture.kind === "drag_to_column") {
        await page.evaluate(pageDragToColumn, gesture);
        await sleep(250);
      } else if (gesture.kind === "real_key") {
        // The keyboard path a real operator uses: focus the card, then the
        // browser's own key delivery carries the Alt+arrow.
        const focused = await page.evaluate((card) => {
          const anchor = document.querySelector(
            `li[data-rank-slot="${CSS.escape(card)}"] a[href]`,
          );
          if (anchor === null) return false;
          anchor.focus();
          return document.activeElement === anchor;
        }, gesture.card);
        trail.push(`focused:${focused}`);
        if (focused) {
          await page.keyboard.down("Alt");
          await page.keyboard.press(gesture.key);
          await page.keyboard.up("Alt");
        }
        await sleep(300);
      } else if (gesture.kind === "menu") {
        try {
          await page.evaluate(pageMenu, gesture);
        } catch {
          trail.push("menu item not offered — skipped");
        }
        await sleep(500);
      } else if (gesture.kind === "click") {
        // Real pointer travel, not el.click(): hits whatever is on top and
        // exercises the hover-driven attention captures like a person.
        const box = await page.evaluate((card) => {
          const el = document.querySelector(`[data-thread-card="${CSS.escape(card)}"] a[href], a[data-thread-card="${CSS.escape(card)}"]`);
          if (el === null) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }, gesture.card);
        if (box !== null) {
          await page.mouse.move(box.x, box.y);
          await page.mouse.click(box.x, box.y);
        }
        await sleep(300);
      } else if (gesture.kind === "press_escape") {
        await page.keyboard.press("Escape");
        await sleep(200);
      } else if (gesture.kind === "push_update") {
        await page.evaluate(
          (p) => globalThis.__uat.pushThreadUpdate(p.threadId, p.patch),
          { threadId: gesture.threadId, patch: gesture.patch },
        );
        await sleep(400);
      }
    } catch (error) {
      stop(`gesture ${JSON.stringify(gesture)} threw: ${String(error?.message ?? error)}`);
      break;
    }
    const inv = await page.evaluate(pageInvariants);
    if (!inv.ok) {
      stop(inv.problems.join("; "));
    }
  }
  results.push({
    name: `fuzz: ${steps} seeded gestures (seed ${seed})`,
    ok,
    detail: ok ? "every gesture left the board consistent" : "board invariant failed",
  });
  report.steps.push({
    id: `fuzz-${steps}-seed-${seed}`,
    title: `Fuzz ${steps} gestures (seed ${seed})`,
    ok,
    results,
  });
  const mark = ok ? "pass" : "FAIL";
  console.log(`  ${mark}  fuzz-${steps}-seed-${seed}`);
  if (!ok) {
    // The trail lands IN the report so a failed sequence replays: the last
    // 30 gestures before the break are what matter.
    console.log("        gesture trail (last 30):");
    for (const entry of trail.slice(-30)) console.log(`          ${entry}`);
    report.fuzzTrail = trail.slice(-30);
  }
}

async function runSuite(file, { port, browser, cell = null }) {
  const suite = parse(await readFile(file, "utf8"));
  const theme = cell?.theme ?? suite.defaults?.theme ?? "dark";
  const groupBy = suite.defaults?.groupBy ?? "status";
  const viewport = cell?.viewport ?? suite.defaults?.viewport ?? { width: 1920, height: 1080 };
  // A matrix cell gets a report-space suffix (`v768x1024-light`) so per-cell
  // shots and filenames never collide across cells.
  const cellSuffix = cell === null ? "" : `-${cell.label}`;
  // Declared load conditions (issue #266). A suite that declares none runs
  // exactly as it always did: full desktop speed, base fixture. Bad values
  // throw here, before the browser is launched, so a typo cannot silently
  // disable the throttle a perf suite depends on.
  const load = parseLoadConditions(suite.defaults ?? {});
  const { child, base } = await startHarness(port);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const report = {
    suite: suite.suite,
    file,
    theme,
    load,
    cell: cell?.label ?? null,
    steps: [],
  };

  // Throttling is PER PAGE through a CDP session, so a suite's conditions
  // never leak to the next suite (each runSuite makes its own page). The
  // instrument is installed before any document script, alongside the drag
  // shim, so `gesture_budget` can arm it from the first goto on.
  await page.evaluateOnNewDocument(installSettleInstrument);
  const cdp = await page.createCDPSession();
  if (load.cpuThrottle > 0) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: load.cpuThrottle });
  }
  if (load.network !== "none") {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", NETWORK_PRESETS[load.network]);
  }

  try {
    let navigated = false;
    const gotoBoard = async (url, themeOverride = undefined) => {
      // Before any document script runs, so the app and the helpers share
      // one page.
      await page.evaluateOnNewDocument(installProtectedDrag);
      await page.goto(`${base}${withLoadQuery(url, load)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      // The board surface: a grouped board (sections) or an empty state.
      // The parent-thread view legitimately renders no sections when a
      // filter/search drops every family, so the wait must accept both.
      await page.waitForSelector("section[aria-label], [role=status]", { timeout: 30_000 });
      // The theme rides BOTH switches (production parity): the `dark` class
      // drives the token set, and `prefers-color-scheme` emulation drives
      // Tailwind's media-based `dark:` utilities — the class alone cannot
      // flip a `dark:` variant.
      const effectiveTheme = themeOverride ?? theme;
      await page.evaluate(
        (t) => document.documentElement.classList.toggle("dark", t === "dark"),
        effectiveTheme,
      );
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: effectiveTheme },
      ]);
      await page.evaluate(() => globalThis.__uat.resetCalls());
      await sleep(300);
      navigated = true;
    };
    for (const step of suite.steps) {
      if (step.goto !== undefined) {
        // The theme rides BOTH switches (production parity): the `dark` class
        // drives the token set, and `prefers-color-scheme` emulation drives
        // Tailwind's media-based `dark:` utilities — the class alone cannot
        // flip a `dark:` variant. A step may override the suite's default
        // (`theme: light`), which is how one suite covers both schemes.
        await gotoBoard(step.goto, step.theme);
      }
      // Assertions declared before the gesture, so a step can prove both the
      // starting state and the resulting one.
      const preResults = step.assert_before_drag
        ? await check({ assert: step.assert_before_drag }, page)
        : [];
      // Failures recorded here still fall through to the step's own
      // assertions, so a broken drop shows up alongside what it broke rather
      // than replacing it.
      const gestureResults = [];
      // `gesture_budget` (issue #266): each gesture is timed by its own
      // round trip in page time. The settle instrument is armed immediately
      // before the gesture is dispatched and read immediately after, so the
      // number is dispatch to DOM-quiet — not the suite's own `sleep` waits,
      // and not the CDP round trip.
      const wantsBudget = rule_has(step, "gesture_budget");
      const gestureTimings = [];
      const pendingSettles = [];
      const armSettle = () =>
        wantsBudget
          ? page.evaluate(() => globalThis.__uatSettle?.arm() ?? null).catch(() => {})
          : Promise.resolve();
      const readSettle = (gesture) =>
        wantsBudget
          ? page
              .evaluate(() => globalThis.__uatSettle?.read(8000) ?? null)
              .then((ms) => gestureTimings.push({ gesture, ms }))
              .catch(() => gestureTimings.push({ gesture, ms: null }))
          : Promise.resolve();
      // Gestures run in the order the step declares them (YAML mapping order
      // is insertion order), not in this runner's historical fixed order — a
      // pane-history step sequences pushes and backs deliberately, and
      // silently reordering them rewrites the history under test.
      const GESTURE_ORDER = ["drag", "drag_unidentified", "drag_to_column", "drag_child_to_floor", "drag_child_to_header", "drag_dot_to_dot", "drag_dot_to_floor", "drag_card_to_strip", "hover_header", "hover", "hover_card", "mouse_to", "key", "back", "click", "click_aria", "click_row_sweep", "type", "menu", "scroll", "wheel_pan", "touch_pan", "resize", "resize_pane", "sleep", "blur", "press_escape", "push_url", "push_update"];
      let gestureFailed = false;
      // A gesture that cannot even run (its own element is absent — a
      // regression deleted what the step targets) records the step and
      // moves on; a hard crash here would take the whole suite down
      // instead of naming the one step that broke.
      try {
        // An explicit `gestures:` list runs its entries in ARRAY order — the
        // shape a round-trip step needs (nest, then detach, then nest again),
        // which cannot be spelled with one key per gesture kind. Each entry
        // holds one gesture key; the key-per-step kinds keep their
        // GESTURE_ORDER habit inside a single entry.
        const orderedGestures = step.gestures !== undefined
          ? step.gestures.flatMap((entry) =>
              Object.entries(entry)
                .filter(([key]) => GESTURE_ORDER.includes(key))
                .map(([key, value]) => [key, value]),
            )
          : Object.keys(step)
              .filter((key) => GESTURE_ORDER.includes(key))
              .map((key) => [key, step[key]]);
        for (const [gesture, payload] of orderedGestures) {
          // The budget clock wraps the DISPATCH only: arm, dispatch, read the
          // settle. Everything the branch does after (its own settle sleeps,
          // assertion setup) is outside the measurement.
          await armSettle();
          pendingSettles.push(readSettle(gesture));
          if (gesture === "drag") {
            const outcome = await page.evaluate(pageDrag, payload);
            if (outcome.dropped === false) {
              gestureFailed = true;
              report.steps.push({ id: step.id, title: step.title, ok: false, results: [
                { name: "drag gesture", ok: false, detail: outcome.reason },
              ] });
            } else {
              // The rule a real browser enforces and a bare DataTransfer does
              // not: some dragover handler must call preventDefault or the
              // browser refuses the drop. `false` here means the reorder
              // "works" in this harness and does nothing at all for the
              // operator.
              gestureResults.push({
                name: "drop permitted during drag",
                ok: outcome.dropAllowed !== false,
                detail: "no dragover handler called preventDefault — a real browser would refuse this drop",
              });
              await sleep(200);
            }
          } else if (gesture === "drag_unidentified") {
            await page.evaluate(pageDragUnidentified, payload);
            await sleep(200);
          } else if (gesture === "drag_to_column") {
            await page.evaluate(pageDragToColumn, payload);
            await sleep(200);
          } else if (gesture === "drag_child_to_floor") {
            await page.evaluate(pageDragChildToFloor, payload);
          } else if (gesture === "drag_child_to_header") {
            await page.evaluate(pageDragChildToHeader, payload);
            await sleep(200);
          } else if (gesture === "drag_dot_to_dot") {
            await page.evaluate(pageDragDotToDot, payload);
            await sleep(200);
          } else if (gesture === "drag_dot_to_floor") {
            await page.evaluate(pageDragDotToFloor, payload);
          } else if (gesture === "drag_card_to_strip") {
            await page.evaluate(pageDragCardToStrip, payload);
          } else if (gesture === "hover_header") {
            // Two-stage: hover=false sets the line and keeps the drag alive;
            // hover=true is the pointer's boundary crossing out of the slot
            // toward the title. The leave stage self-checks that a line was
            // even painted — a probe that clears nothing proves nothing.
            const outcome = await page.evaluate(pageHoverHeader, payload);
            if (outcome.stage === "leave" && outcome.wasShown === false) {
              gestureFailed = true;
              report.steps.push({
                id: step.id,
                title: step.title,
                ok: false,
                results: [
                  {
                    name: "hover_header",
                    ok: false,
                    detail: "no insertion line was painted before the leave — the probe would prove nothing",
                  },
                ],
              });
            } else {
              await sleep(200);
            }
          } else if (gesture === "hover") {
            // A hover with a board y-fraction moves the real mouse into that
            // swimlane band (used by the band_hover assertion); a card hover
            // ({ from, to, edge }) arms the insertion line THROUGH the
            // protected-drag machinery and keeps the drag alive — the state a
            // host push then races in the race suites. Other hovers
            // carry their own assertion-side evaluation already.
            if (payload && payload.from !== undefined) {
              await page.evaluate(pageHover, payload);
              await sleep(200);
            } else if (payload && payload.board_y !== undefined) {
              const rect = await page.evaluate(() => {
                const board = document.querySelector("[data-parent-board]");
                if (!board) return null;
                const box = board.getBoundingClientRect();
                return { top: box.top, height: box.height, left: box.left + box.width / 2 };
              });
              if (rect === null) throw new Error("no [data-parent-board] to hover");
              const y = rect.top + rect.height * Number(payload.board_y);
              await page.mouse.move(rect.left, y);
              await sleep(120);
            }
          } else if (gesture === "hover_card") {
            // The real pointer rests on a top-level card's center, so the CSS
            // :hover and the spotlight's :has() rule both arm — the same
            // state an operator's idle pointer produces. The settle waits past
            // the spotlight's 300ms debounce plus its 300ms ease, so an
            // assertion samples the settled dim. The card must sit inside the
            // viewport: a hover the operator cannot even make proves nothing.
            const hoverRect = await page.evaluate(
              (id) => {
                const card = document.querySelector(`div[data-thread-card="${id}"]`);
                if (!card) return null;
                const box = card.getBoundingClientRect();
                return {
                  x: box.left + box.width / 2,
                  y: box.top + box.height / 2,
                  visible: box.top > 0 && box.bottom < innerHeight && box.left > 0 &&
                    box.right < innerWidth && box.width > 100 && box.height > 40,
                };
              },
              payload.card,
            );
            if (hoverRect === null) throw new Error(`no card div to hover: ${payload.card}`);
            if (!hoverRect.visible) throw new Error(`${payload.card} is not fully in the viewport`);
            await page.mouse.move(hoverRect.x, hoverRect.y);
            await sleep(800);
          } else if (gesture === "mouse_to") {
            // Absolute viewport coordinates (`{ x, y, wait_ms }`): parking the
            // pointer somewhere specific — e.g. off every card, to let a
            // hover's promise hand the surface back.
            await page.mouse.move(Number(payload.x), Number(payload.y));
            await sleep(Math.max(0, Number(payload.wait_ms ?? 300)));
          } else if (gesture === "key") {
            await page.evaluate(pageKey, payload);
            await sleep(200);
          } else if (gesture === "back") {
            // A popstate re-renders React, and the pane effect runs after the
            // commit; settle before assertions sample the DOM.
            await page.evaluate(pageGoBack);
            await sleep(300);
          } else if (gesture === "click") {
            await page.evaluate(pageClickCard, payload);
            await sleep(300);
          } else if (gesture === "click_aria") {
            await page.evaluate(pageClickAria, payload);
            await sleep(300);
          } else if (gesture === "click_row_sweep") {
            // The Parent view's row pill, keyed by row id. A confirm kicks off
            // the sequential sweep (async writes), so the settle is longer
            // than a plain click's.
            await page.evaluate(pageClickRowSweepPill, payload);
            await sleep(900);
          } else if (gesture === "type") {
            // Focus the labelled field, then type through the real input
            // pipeline (per-keystroke input events, not a value assignment) —
            // the same path an operator's keyboard uses, which controlled
            // React inputs require. `{ into: <aria-label>, text: "…" }`, plus
            // `clear: true` when the field opens prefilled.
            await page.evaluate(pageFocusLabelled, {
              label: payload.into,
              select: payload.clear === true,
            });
            await page.keyboard.type(payload.text, { delay: 15 });
            await sleep(300);
          } else if (gesture === "menu") {
            // Right-click a card and choose an item (e.g. "Pin"): the menu is
            // the same surface a live operator uses, and the state change that
            // follows (setPinned → board re-render → keep/reveal scroll) needs
            // the mock's async settle before assertions sample the DOM.
            await page.evaluate(pageMenu, payload);
            await sleep(500);
          } else if (gesture === "scroll") {
            await page.evaluate(pageBoardScroll, payload);
            // The board settles on a 200ms quiet-period debounce plus a smooth
            // pin glide before it re-locks; give it room before assertions.
            // settle_ms: 0 skips the wait so a following click lands while the
            // glide is in flight (the click-during-glide adversarial step).
            await sleep(Math.max(0, Number(payload?.settle_ms ?? 1200)));
          } else if (gesture === "wheel_pan") {
            // A real wheel pan through the input pipeline (the same path the
            // operator's trackpad uses), then a settle wait.
            await wheelPan(page, {
              dx: payload?.dx ?? 130,
              dy: payload?.dy ?? 0,
              target: payload?.target ?? "lanes",
              over: payload?.over,
            });
            await sleep(Math.max(0, Number(payload?.settle_ms ?? 2500)));
          } else if (gesture === "touch_pan") {
            // A real finger (issue #328): page.touchscreen drives CDP
            // Input.dispatchTouchEvent against the suite's touch viewport, so
            // the browser's own gesture recognizer — and the surface's
            // `touch-action` and drag sources — decide the outcome, not this
            // runner. `from` names where the finger lands (`card`, `between`,
            // `column`, `board`, `point`), and the reading it leaves behind
            // (board and lane scroll deltas, plus any native drag the browser
            // started) is what `touch_scroll` / `no_native_drag` /
            // `touch_origin` assert.
            //
            // What the harness cannot do is documented in the README: a
            // synthetic touch never lifts a platform drag (Chrome starts touch
            // DnD from a long press in its input pipeline, which
            // Input.dispatchTouchEvent does not enter), so the drag-source half
            // of the bug is asserted as a live-DOM contract by
            // `touch_drag_armor` and the pan half by this gesture.
            const origin = await page.evaluate(pageTouchPanOrigin, payload.from ?? { board: true });
            await page.evaluate(pageTouchPanPrepare, origin);
            const dx = Number(payload.dx ?? 0);
            const dy = Number(payload.dy ?? 0);
            const steps = Math.max(2, Number(payload.steps ?? 8));
            const stepDelay = Math.max(0, Number(payload.step_ms ?? 16));
            const touch = page.touchscreen;
            await touch.touchStart(origin.point.x, origin.point.y);
            if (payload.hold_ms !== undefined) await sleep(Math.max(0, Number(payload.hold_ms)));
            for (let i = 1; i <= steps; i += 1) {
              await touch.touchMove(
                origin.point.x + (dx * i) / steps,
                origin.point.y + (dy * i) / steps,
              );
              if (stepDelay > 0) await sleep(stepDelay);
            }
            await touch.touchEnd();
            // The browser's momentum and settle run after the finger lifts;
            // the reading is taken once the surface is quiet again.
            await sleep(Math.max(0, Number(payload.settle_ms ?? 700)));
            await page.evaluate(pageTouchPanRead);
          } else if (gesture === "resize") {
            // A viewport change while the lock is held re-runs the layout; let
            // the resize observer commit before assertions sample the DOM.
            await page.setViewport({ width: payload.width, height: payload.height });
            await sleep(800);
          } else if (gesture === "resize_pane") {
            // Drag the thread pane's left edge as far left as it goes, through
            // the real pointer pipeline (the pane's resize handle listens for
            // pointerdown/move/up with pointer capture). `pane_to` pins an
            // absolute pane width instead of dragging to the panel edge. The
            // handle moves with the pane, so it is re-read after each step.
            const paneTo = payload?.pane_to;
            for (let attempt = 0; attempt < 24; attempt += 1) {
              const handle = await page.$('[aria-label="Resize thread pane"]');
              if (handle === null) break;
              const box = await handle.boundingBox();
              const pane = await page.$('aside[aria-label^="Thread: "]');
              const paneBox = pane === null ? null : await pane.boundingBox();
              if (box === null || paneBox === null || paneBox.width === 0) break;
              const grabX = Math.round(box.x + box.width / 2);
              const grabY = Math.round(box.y + box.height / 2);
              // Default: one more step leftward (wider). `pane_to` targets an
              // absolute width, so the drag stops once it lands.
              const target = paneTo !== undefined ? paneTo : paneBox.width + 60;
              const dx = target - paneBox.width;
              if (Math.abs(dx) < 0.5) break;
              await page.mouse.move(grabX, grabY);
              await page.mouse.down();
              for (let i = 1; i <= 8; i += 1) await page.mouse.move(grabX - (dx * i) / 8, grabY);
              await page.mouse.up();
              await sleep(150);
            }
          } else if (gesture === "sleep") {
            // A wait between gestures, for multi-phase board reactions (pin
            // glide, recut, post-recut corrections) that no single event
            // boundary covers.
            await sleep(Math.max(0, Number(payload) || 0));
          } else if (gesture === "blur") {
            // The labelled control lets its focus go (the gesture behind
            // "press into the board background"): the shape of a pointer
            // click somewhere outside a focused field.
            await page.evaluate((label) => {
              const el = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
              if (!el) throw new Error(`blur: nothing labelled ${label}`);
              el.blur();
            }, payload);
            await sleep(300);
          } else if (gesture === "press_escape") {
            // The pane listens on document capture, so a bubbling keydown from
            // the body reaches it — the same path a real Escape takes.
            await page.evaluate(() => {
              document.body.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
              );
            });
            await sleep(300);
          } else if (gesture === "push_url") {
            // A push to a surface the mock router does not own — the shape of
            // a link-out to main bb. The app's own state is untouched by it.
            await page.evaluate(
              (url) => history.pushState(null, "", url),
              payload,
            );
            await sleep(200);
          } else if (gesture === "push_update") {
            // A host push with the gesture's patch (status, flags, age): the
            // simulated sidebar rewrites and the board re-derives live — the
            // thing a real bb does while an operator gestures.
            await page.evaluate(
              (p) => globalThis.__uat.pushThreadUpdate(p.threadId, p.patch ?? {}),
              { threadId: payload.threadId, patch: payload.patch ?? {} },
            );
            await sleep(400);
          }
          if (gestureFailed) break;
        }
        // Collect the budget readings before the step's own assertions run.
        await Promise.all(pendingSettles);
      } catch (error) {
        gestureFailed = true;
        report.steps.push({
          id: step.id,
          title: step.title,
          ok: false,
          results: [
            { name: "gesture failed to run", ok: false, detail: String(error?.message ?? error) },
          ],
        });
      }
      // A drag that cannot start records itself and skips the step's own
      // assertions, as before the gesture loop existed.
      if (gestureFailed) continue;
      // Suite-level invariants: the three board laws (one lane per thread
      // with the Done projection the only second home, stored cards keep
      // their stored order, no refusal banner) hold after whatever gesture
      // just ran. A step may opt out with `invariants: false`.
      const invariantResults =
        suite.defaults?.invariants === true && step.invariants !== false
          ? await (async () => {
              const inv = await page.evaluate(pageInvariants);
              return [
                {
                  name: "board invariants",
                  ok: inv.ok,
                  detail: inv.problems.join("; ") || "lane membership, stored order, and banners all clean",
                },
              ];
            })()
          : [];
      const results = [
        ...invariantResults,
        ...preResults,
        ...(rule_has(step, "expect_drop_refused") ? [] : gestureResults),
        ...(await check(step, page, gestureResults, gestureTimings)),
      ];
      report.steps.push({
        id: step.id,
        title: step.title,
        ok: results.every((r) => r.ok),
        results,
      });
      const mark = report.steps.at(-1).ok ? "pass" : "FAIL";
      console.log(`  ${mark}  ${step.id}`);
      for (const r of results) {
        if (!r.ok) console.log(`        × ${r.name}: ${r.detail}`);
      }
      if (suite.defaults?.shots === true) {
        // A per-step artifact for humans (no pixel diffing — the value is
        // "what did the board look like at this step", kept beside the
        // report). Cell suffixes keep matrix cells out of each other's way.
        await mkdir(`${REPORT_DIR}shots/${report.suite}`, { recursive: true });
        await page.screenshot({
          path: `${REPORT_DIR}shots/${report.suite}/${step.id}${cellSuffix}.png`,
        });
      }
    }
    if (suite.fuzz !== undefined) {
      // A fuzz-only suite declares no steps; the engine still needs the
      // mounted board, so drive one navigation from the suite defaults.
      if (!navigated) {
        await gotoBoard(`?groupBy=${groupBy}&laneDirection=vertical`);
      }
      await runFuzz(suite, { page, report });
    }
  } finally {
    await page.close();
    child.kill();
  }
  return report;
}

await mkdir(REPORT_DIR, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const reports = [];
let port = 21000 + (process.pid % 20000);
for (const file of suiteFiles) {
  console.log(`\n${file}`);
  const suite = parse(await readFile(file, "utf8"));
  // A suite may declare a matrix (viewports × themes): every cell re-runs
  // the same steps with that cell's viewport and theme, each writing its own
  // report so a regression names its cell.
  const cells = [];
  for (const viewport of suite.matrix?.viewports ?? [null]) {
    for (const theme of suite.matrix?.themes ?? [null]) {
      const label =
        viewport === null && theme === null
          ? null
          : `v${viewport?.width ?? 1920}x${viewport?.height ?? 1080}-${theme ?? "dark"}`;
      cells.push({
        label,
        viewport: viewport ?? undefined,
        theme: theme ?? undefined,
      });
    }
  }
  for (const cell of cells) {
    // Port handout with retry: another runner (a concurrent bb thread's UAT,
    // a crashed session's stray vite) can own a handed-out port; retrying a
    // few ports ahead beats a confusing cross-runner test run.
    let attemptPort = port;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        reports.push(await runSuite(file, { port: attemptPort, browser, cell }));
        port = attemptPort;
        break;
      } catch (error) {
        if (attempt === 3 || !String(error?.message ?? error).includes("owned by another runner")) {
          throw error;
        }
        attemptPort += 7;
        port = attemptPort;
        console.log(`  (port ${attemptPort - 7} taken; retrying on ${attemptPort})`);
      }
    }
  }
}
await browser.close();

const failed = reports.flatMap((r) => r.steps).filter((s) => !s.ok).length;
const stamp = new Date().toISOString();
// One report per suite, named after it: a combined run that wrote a single
// file (the first suite's name) left every other suite's report stale — an
// old pass sitting in docs/uat while the run that just failed wrote nothing
// to the file someone actually opens. A matrix cell appends its cell label.
if (reports.length === 0) throw new Error("no suites ran");
const outFiles = [];
for (const report of reports) {
  const suiteLines = ["# UAT report", "", `_Generated ${stamp} by \`npm run uat\`._`, ""];
  suiteLines.push(
    `## ${report.suite}${report.cell === null ? "" : ` (${report.cell})`}`,
    "",
    `Source: \`${report.file}\` · theme ${report.theme}`,
    "",
  );
  suiteLines.push("| Step | Result | Detail |", "| --- | --- | --- |");
  for (const step of report.steps) {
    const detail = step.results.map((r) => `${r.ok ? "✓" : "×"} ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`).join("; ");
    suiteLines.push(`| ${step.title} | ${step.ok ? "pass" : "FAIL"} | ${detail} |`);
  }
  if (report.fuzzTrail !== undefined) {
    suiteLines.push("", "Fuzz gesture trail (last 30 before the break):", "");
    for (const entry of report.fuzzTrail) suiteLines.push(`- \`${entry}\``);
    suiteLines.push("");
  }
  suiteLines.push("");
  const outFile = `${REPORT_DIR}${report.suite}${report.cell === null ? "" : `.${report.cell}`}.md`;
  await writeFile(outFile, suiteLines.join("\n"));
  outFiles.push(outFile);
}

console.log(`\n${failed === 0 ? "all steps passed" : `${failed} step(s) failed`}`);
if (skippedManual.length > 0) {
  // Name what the sweep left out, so a skipped gate is visible rather than
  // silently missing (the reason it is opt-in is documented in the suite and
  // in load-conditions.mjs).
  console.log(`skipped (manual: true) — run by path to include:`);
  for (const file of skippedManual) console.log(`  ${file}`);
}
console.log(`reports:\n${outFiles.map((f) => `  ${f}`).join("\n")}`);
if (failed > 0) {
  // The release notification contract (release.md §2b): a failing UAT sweep
  // names its gate on the operator's channel. Best effort; the exit code
  // below is the gate's own.
  await notifyGateFailure({ gate: "uat", detail: `${failed} step(s) failed` });
}
process.exit(failed === 0 ? 0 : 1);
