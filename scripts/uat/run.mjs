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
  const clientY = edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
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
    // otherwise be read as column members.
    ids: [...section.querySelectorAll(":scope > div > ul > li")].map((li) =>
      idOf(li.querySelector("a[href]")),
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
  const clientY = edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
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
  const clientY = edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
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
  const marker = document.querySelector('a[aria-current="true"]');
  const card = marker?.closest("[data-thread-card]");
  if (!marker || !card) return { id: null, visible: false };
  const rect = card.getBoundingClientRect();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth;
  return { id: card.getAttribute("data-thread-card"), visible };
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

/** Click a control by accessible name: an aria-label, else the button's own text. */
const pageClickAria = ({ label }) => {
  const el =
    document.querySelector(`button[aria-label="${CSS.escape(label)}"]`) ??
    document.querySelector(`[aria-label="${CSS.escape(label)}"]`) ??
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label,
    );
  if (!el) throw new Error(`click_aria: nothing labelled ${label}`);
  el.click();
  return { ok: true };
};

/**
 * The what's-new surface: the gift button is always present; the pulse and
 * the modal are the state. Read via aria-label so the assertion sees what
 * the operator sees.
 */
const pageWhatsNew = () => {
  const button = document.querySelector('button[aria-label="What\'s new"]');
  const modal =
    document.querySelector("[role=dialog]") ??
    document.querySelector("[data-bb-portaled-overlay] [role=dialog]") ??
    document.querySelector("[data-bb-portaled-overlay] [role=alertdialog]");
  return {
    icon: button !== null,
    // The pulse ships as the motion-safe variant, compiled into one class
    // name; the classList holds exactly that string.
    unseen: button?.classList.contains("motion-safe:animate-pulse") ?? false,
    modal: modal !== null,
  };
};

/** Does a substring appear in the page's visible text? */
const pageTextVisible = (needle) =>
  document.body.textContent?.includes(needle) ?? false;

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
        expect(
          `what's-new ${want.unseen ? "unseen (pulsing)" : "seen (quiet)"}`,
          got.unseen === want.unseen,
          got.unseen ? "pulsing" : "quiet",
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
        await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
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
      const GESTURE_ORDER = ["drag", "drag_unidentified", "drag_to_column", "hover", "key", "back", "click", "click_aria", "press_escape", "push_url"];
      let gestureFailed = false;
      for (const gesture of Object.keys(step).filter((key) => GESTURE_ORDER.includes(key))) {
        if (gesture === "drag") {
          const outcome = await page.evaluate(pageDrag, step.drag);
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
          await page.evaluate(pageDragUnidentified, step.drag_unidentified);
          await sleep(200);
        } else if (gesture === "drag_to_column") {
          await page.evaluate(pageDragToColumn, step.drag_to_column);
          await sleep(200);
        } else if (gesture === "hover") {
          // The insertion_line assertion re-runs the hover; nothing to do here.
        } else if (gesture === "key") {
          await page.evaluate(pageKey, step.key);
          await sleep(200);
        } else if (gesture === "back") {
          // A popstate re-renders React, and the pane effect runs after the
          // commit; settle before assertions sample the DOM.
          await page.evaluate(pageGoBack);
          await sleep(300);
        } else if (gesture === "click") {
          await page.evaluate(pageClickCard, step.click);
          await sleep(300);
        } else if (gesture === "click_aria") {
          await page.evaluate(pageClickAria, step.click_aria);
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
            step.push_url,
          );
          await sleep(200);
        }
        if (gestureFailed) break;
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
const lines = ["# UAT report", ""];
for (const report of reports) {
  lines.push(`## ${report.suite}`, "", `Source: \`${report.file}\` · theme ${report.theme}`, "");
  lines.push("| Step | Result | Detail |", "| --- | --- | --- |");
  for (const step of report.steps) {
    const detail = step.results.map((r) => `${r.ok ? "✓" : "×"} ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`).join("; ");
    lines.push(`| ${step.title} | ${step.ok ? "pass" : "FAIL"} | ${detail} |`);
  }
  lines.push("");
}
const stamp = new Date().toISOString();
lines.unshift(`_Generated ${stamp} by \`npm run uat\`._`, "");
const outFile = `${REPORT_DIR}${reports[0].suite}.md`;
await writeFile(outFile, lines.join("\n"));

console.log(`\n${failed === 0 ? "all steps passed" : `${failed} step(s) failed`}`);
console.log(`report: ${outFile}`);
process.exit(failed === 0 ? 0 : 1);
