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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const DEFAULT_SUITE = fileURLToPath(new URL("../../tests/manual/uat-rank.yaml", import.meta.url));
const suiteFiles = suites.length > 0 ? suites : [DEFAULT_SUITE];

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

  const transfer = new DataTransfer();
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  if (transfer.getData("text/focus-board-rank") === "") {
    return { dropped: false, reason: "drag payload carried no rank key" };
  }

  const box = target.getBoundingClientRect();
  const clientY = edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
  const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: box.left + 8, clientY };
  target.dispatchEvent(new DragEvent("dragover", point));
  const hadLine = target.matches(":before") || getComputedStyle(target, "::before").content !== "none";
  target.dispatchEvent(new DragEvent("drop", point));
  anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  return { dropped: true, hadLine };
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
 * Hover a card's chosen half and report the insertion line. Split from
 * `pageLineShown` because the dragover sets React state: reading the computed
 * style in the same task would sample the DOM before the commit.
 */
const pageHover = ({ from, to, edge }) => {
  const slot = (id) => document.querySelector(`li[data-rank-slot="${id}"]`);
  const source = slot(from);
  const target = slot(to);
  if (!source || !target) throw new Error(`hover: missing slot (${from} → ${to})`);
  const transfer = new DataTransfer();
  const anchor = source.querySelector("a[draggable]");
  anchor.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  const box = target.getBoundingClientRect();
  const clientY = edge === "before" ? box.top + box.height * 0.2 : box.top + box.height * 0.8;
  target.dispatchEvent(
    new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: box.left + 8,
      clientY,
    }),
  );
  return { ok: true };
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

/** Turn one YAML step's assertions into pass/fail records. */
async function check(step, page) {
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
      const calls = await page.evaluate(() =>
        globalThis.__uat.calls().filter((call) => call.method === rule.rpc_not_called),
      );
      expect(`no ${rule.rpc_not_called} call`, calls.length === 0, `${calls.length} call(s) made`);
    }
    if (rule.insertion_line !== undefined || rule.no_insertion_line !== undefined) {
      // Hover first, then sample after React has committed the line.
      const wants = [rule.insertion_line, rule.no_insertion_line].filter((r) => r !== undefined);
      for (const want of wants) {
        await page.evaluate(pageHover, want);
        await sleep(150);
        const probe = { to: want.to, edge: want.edge };
        const line = await page.evaluate(pageLineShown, probe);
        if (want === rule.insertion_line) {
          expect("insertion line visible", line.shown, line.reason);
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
  const { child, base } = await startHarness(port);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const report = { suite: suite.suite, file, theme, steps: [] };

  try {
    for (const step of suite.steps) {
      if (step.goto !== undefined) {
        await page.goto(`${base}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
        await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
        await page.evaluate(() => globalThis.__uat.resetCalls());
        await sleep(300);
      }
      // Assertions declared before the gesture, so a step can prove both the
      // starting state and the resulting one.
      const preResults = step.assert_before_drag
        ? await check({ assert: step.assert_before_drag }, page)
        : [];
      if (step.drag !== undefined) {
        const outcome = await page.evaluate(pageDrag, step.drag);
        if (outcome.dropped === false) {
          report.steps.push({ id: step.id, title: step.title, ok: false, results: [
            { name: "drag gesture", ok: false, detail: outcome.reason },
          ] });
          continue;
        }
        await sleep(200);
      }
      if (step.drag_to_column !== undefined) {
        await page.evaluate(pageDragToColumn, step.drag_to_column);
        await sleep(200);
      }
      if (step.hover !== undefined) {
        // The insertion_line assertion re-runs the hover; nothing to do here.
      }
      if (step.key !== undefined) {
        await page.evaluate(pageKey, step.key);
        await sleep(200);
      }
      const results = [...preResults, ...(await check(step, page))];
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
