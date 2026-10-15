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
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { parse } from "yaml";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";
// Two levels up from scripts/uat/ is the repo root.
const REPORT_DIR = fileURLToPath(new URL("../../docs/uat/", import.meta.url));

const suites = process.argv.slice(2).filter((a) => !a.startsWith("-"));
// No args → every suite in tests/manual, in name order (the README's
// documented behavior); args name individual suites.
const suiteFiles =
  suites.length > 0
    ? suites
    : (await readdir(fileURLToPath(new URL("../../tests/manual", import.meta.url))))
        .filter((name) => name.endsWith(".yaml"))
        .sort()
        .map((name) => fileURLToPath(new URL(`../../tests/manual/${name}`, import.meta.url)));

/** Start vite and resolve once the harness is serving. */
async function startHarness(port) {
  const child = spawn(
    "npx",
    ["vite", "--config", HARNESS_CONFIG, "--port", String(port), "--strictPort"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (/error/i.test(text)) process.stderr.write(`  vite: ${text}`);
  });
  const base = `http://localhost:${port}/`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base);
      if (response.ok) return { child, base };
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  child.kill();
  throw new Error(`harness did not come up on ${base}`);
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
  const clientY =
    edge === "onto" ? box.top + box.height * 0.5
    : edge === "before" ? box.top + box.height * 0.2
    : box.top + box.height * 0.8;
  const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: box.left + 8, clientY };

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
    const clientY =
      edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
    const over = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: box.left + 8,
      clientY,
    });
    lineOn.dispatchEvent(over);
    return { stage: "hover", dropAllowed: over.defaultPrevented };
  }
  const classes = [...lineOn.classList];
  const wasShown = classes.some((cls) => cls.includes("inset-x-0"));
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
  const clientY =
    edge === "onto" ? box.top + box.height * 0.5
    : edge === "before" ? box.top + box.height * 0.2
    : box.top + box.height * 0.8;
  transfer._armRead(false);
  const over = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
    clientX: box.left + 8,
    clientY,
  });
  target.dispatchEvent(over);
  return { ok: true, dropAllowed: over.defaultPrevented };
};

/** Is an insertion line rendered on that card's chosen edge? */
const pageLineShown = ({ to, edge }) => {
  const target = document.querySelector(`li[data-rank-slot="${to}"]`);
  if (!target) return { shown: false, reason: "no slot" };
  const style = getComputedStyle(target, edge === "before" ? "::before" : "::after");
  return {
    shown: style.content !== "none" && style.height !== "0px" && style.display !== "none",
    reason: `content=${style.content} height=${style.height}`,
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
  const clientY =
    edge === "onto" ? box.top + box.height * 0.5
    : edge === "before" ? box.top + box.height * 0.2
    : box.top + box.height * 0.8;
  const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: box.left + 8, clientY };
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
 * so controlled React inputs see real input events, not a value assignment). */
const pageFocusLabelled = ({ label }) => {
  const el = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  if (!el) throw new Error(`type: nothing labelled ${label}`);
  el.focus();
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
 * A card's right-click menu: dispatch a real contextmenu event on the card
 * (the menu handler lives on ThreadCardMenu's wrapper and the card's anchor
 * contextmenu bubbles up to it), wait for the menu to open, then click the
 * item whose text matches the label exactly. Dispatching and clicking in one
 * page.evaluate is safe: the open and the menuitem are both committed by
 * React's synchronous discrete-event flush by the time the search retries
 * land — the retry only covers React scheduling jitter, it never clicks a
 * stale item.
 */
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
const wheelPan = async (page, dx) => {
  const board = await page.$("[data-parent-board]");
  if (!board) throw new Error("board_quiet wheel: no board element");
  const box = await board.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel({ deltaX: dx / 10 });
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
async function check(step, page, gestureResults = []) {
  const results = [];
  const expect = (name, ok, detail) => results.push({ name, ok, detail });

  for (const rule of step.assert ?? []) {
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
        const el = document.querySelector('p[role="status"]');
        return el?.textContent?.trim() ?? "";
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
        await wheelPan(page, want.dx ?? 480);
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
    if (rule.live_region !== undefined) {
      const text = await page.evaluate(pageLiveRegion);
      const re = rule.live_region instanceof RegExp ? rule.live_region : new RegExp(rule.live_region);
      expect("move announced", re.test(text), `live region said ${JSON.stringify(text)}`);
    }
  }
  return results;
}

async function runSuite(file, { port, browser }) {
  const suite = parse(await readFile(file, "utf8"));
  const theme = suite.defaults?.theme ?? "dark";
  const groupBy = suite.defaults?.groupBy ?? "status";
  const viewport = suite.defaults?.viewport ?? { width: 1920, height: 1080 };
  const { child, base } = await startHarness(port);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const report = { suite: suite.suite, file, theme, steps: [] };

  try {
    for (const step of suite.steps) {
      if (step.goto !== undefined) {
        // Before any document script runs, so the app and the helpers share
        // one page.
        await page.evaluateOnNewDocument(installProtectedDrag);
        await page.goto(`${base}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        // The board surface: a grouped board (sections) or an empty state.
        // The parent-thread view legitimately renders no sections when a
        // filter/search drops every family, so the wait must accept both.
        await page.waitForSelector("section[aria-label], [role=status]", { timeout: 30_000 });
        // The theme rides BOTH switches (production parity): the `dark` class
        // drives the token set, and `prefers-color-scheme` emulation drives
        // Tailwind's media-based `dark:` utilities — the class alone cannot
        // flip a `dark:` variant. A step may override the suite's default
        // (`theme: light`), which is how one suite covers both schemes.
        const effectiveTheme = step.theme ?? theme;
        await page.evaluate(
          (t) => document.documentElement.classList.toggle("dark", t === "dark"),
          effectiveTheme,
        );
        await page.emulateMediaFeatures([
          { name: "prefers-color-scheme", value: effectiveTheme },
        ]);
        await page.evaluate(() => globalThis.__uat.resetCalls());
        await sleep(300);
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
      // Gestures run in the order the step declares them (YAML mapping order
      // is insertion order), not in this runner's historical fixed order — a
      // pane-history step sequences pushes and backs deliberately, and
      // silently reordering them rewrites the history under test.
      const GESTURE_ORDER = ["drag", "drag_unidentified", "drag_to_column", "drag_child_to_floor", "drag_child_to_header", "hover_header", "hover", "hover_card", "mouse_to", "key", "back", "click", "click_aria", "type", "menu", "scroll", "wheel_pan", "resize", "sleep", "blur", "press_escape", "push_url"];
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
            // swimlane band (used by the band_hover assertion); other hovers
            // carry their own assertion-side evaluation already.
            if (payload && payload.board_y !== undefined) {
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
          } else if (gesture === "type") {
            // Focus the labelled field, then type through the real input
            // pipeline (per-keystroke input events, not a value assignment) —
            // the same path an operator's keyboard uses, which controlled
            // React inputs require. `{ into: <aria-label>, text: "…" }`.
            await page.evaluate(pageFocusLabelled, { label: payload.into });
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
            await wheelPan(page, payload?.dx ?? 130);
            await sleep(Math.max(0, Number(payload?.settle_ms ?? 2500)));
          } else if (gesture === "resize") {
            // A viewport change while the lock is held re-runs the layout; let
            // the resize observer commit before assertions sample the DOM.
            await page.setViewport({ width: payload.width, height: payload.height });
            await sleep(800);
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
          }
          if (gestureFailed) break;
        }
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
      const results = [
        ...preResults,
        ...(rule_has(step, "expect_drop_refused") ? [] : gestureResults),
        ...(await check(step, page, gestureResults)),
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
let port = 5199;
for (const file of suiteFiles) {
  console.log(`\n${file}`);
  reports.push(await runSuite(file, { port: port++, browser }));
}
await browser.close();

const failed = reports.flatMap((r) => r.steps).filter((s) => !s.ok).length;
const stamp = new Date().toISOString();
// One report per suite, named after it: a combined run that wrote a single
// file (the first suite's name) left every other suite's report stale — an
// old pass sitting in docs/uat while the run that just failed wrote nothing
// to the file someone actually opens.
if (reports.length === 0) throw new Error("no suites ran");
const outFiles = [];
for (const report of reports) {
  const suiteLines = ["# UAT report", "", `_Generated ${stamp} by \`npm run uat\`._`, ""];
  suiteLines.push(`## ${report.suite}`, "", `Source: \`${report.file}\` · theme ${report.theme}`, "");
  suiteLines.push("| Step | Result | Detail |", "| --- | --- | --- |");
  for (const step of report.steps) {
    const detail = step.results.map((r) => `${r.ok ? "✓" : "×"} ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`).join("; ");
    suiteLines.push(`| ${step.title} | ${step.ok ? "pass" : "FAIL"} | ${detail} |`);
  }
  suiteLines.push("");
  const outFile = `${REPORT_DIR}${report.suite}.md`;
  await writeFile(outFile, suiteLines.join("\n"));
  outFiles.push(outFile);
}

console.log(`\n${failed === 0 ? "all steps passed" : `${failed} step(s) failed`}`);
console.log(`reports:\n${outFiles.map((f) => `  ${f}`).join("\n")}`);
process.exit(failed === 0 ? 0 : 1);
