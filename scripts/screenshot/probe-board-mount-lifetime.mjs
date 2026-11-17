// Host-shape check behind the narrowed hotkey rule: how long does the board's
// panel stay in the document?
//
// The rule is "the letter is the board's only while the board's own pane is
// the focused pane", which needs two host facts a jsdom test cannot settle:
//   1. bb's pane containers carry the pane id the split layout reports, so the
//      board's pane can be named (scripts/screenshot/probe-native-split-pane.mjs
//      observed `data-split-pane-id="pane-1"` matching the persisted layout);
//   2. a plugin panel leaves the document when the route leaves it, so a
//      document-level listener cannot outlive the board being on screen in a
//      single-pane layout.
//
// Read-only: it loads the board route, follows a sidebar thread link, and
// counts. No renames, no writes, no split changes.
//
// Usage: node scripts/screenshot/probe-board-mount-lifetime.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-board-mount-lifetime";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const READ = `(() => {
  const panel = document.querySelector('[data-focus-board-panel]');
  const pane = panel === null ? null : panel.closest('[data-split-pane-id]');
  const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
    (a) => a.getBoundingClientRect().x < 320,
  );
  const first = rows[0] === undefined ? null : rows[0];
  const box = first === null ? null : first.getBoundingClientRect();
  return {
    url: location.href,
    boardPanelInDocument: panel !== null,
    boardPanelPaneId: pane === null ? null : pane.getAttribute('data-split-pane-id'),
    paneContainers: [...document.querySelectorAll('[data-split-pane-id]')].map(
      (el) => el.getAttribute('data-split-pane-id'),
    ),
    firstThreadRow: box === null ? null : {
      href: first.getAttribute('href'),
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    },
  };
})()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
await sleep(2500);

const boardRoute = await page.evaluate(READ);
await page.screenshot({ path: `${OUT_DIR}/01-board-route.png` });

const rowsBefore = boardRoute.firstThreadRow;
if (rowsBefore === null) {
  console.error("No sidebar thread row found; cannot follow the route away.");
  await browser.close();
  process.exit(1);
}
await page.mouse.click(rowsBefore.x, rowsBefore.y);
await sleep(2500);

const threadRoute = await page.evaluate(READ);
await page.screenshot({ path: `${OUT_DIR}/02-thread-route.png` });

const evidence = {
  checkedAt: new Date().toISOString(),
  boardRoute,
  threadRoute,
  verdict: {
    boardPanelLeavesTheDocument:
      boardRoute.boardPanelInDocument && threadRoute.boardPanelInDocument === false,
    boardPaneNamedByPaneAttribute: boardRoute.boardPanelPaneId !== null,
  },
};
writeFileSync(`${OUT_DIR}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
process.exit(evidence.verdict.boardPanelLeavesTheDocument ? 0 : 1);
