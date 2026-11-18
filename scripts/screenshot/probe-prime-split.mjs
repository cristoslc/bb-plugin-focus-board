// One cheap probe at the "prime a split, then replace it" idea: at ONE pane,
// does creating a terminal (the host's own terminal RPC, the same one the
// plugin SDK's `terminals.create` calls) put a second pane in the layout?
//
// The layout's pane content union is thread | new-thread | plugin-panel |
// plugin-detail (renderer `qN`, strictly parsed), so a terminal cannot hold a
// pane slot. This run records the answer rather than arguing from the schema,
// and closes the terminal it created.
//
// Usage: node scripts/screenshot/probe-prime-split.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-card-click-focus";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READ_LAYOUT = `(function () {
  let layout = null;
  try {
    const raw = localStorage.getItem('bb.splitLayout');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      layout = parsed && parsed.layout ? parsed.layout : parsed;
    }
  } catch {}
  const flatten = (node, out) => {
    if (node === null || node === undefined) return out;
    if (node.type === 'pane') { out.push(node); return out; }
    for (const child of node.children ?? []) flatten(child, out);
    return out;
  };
  const panes = layout === null ? [] : flatten(layout.root, []);
  return {
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    kinds: panes.map((pane) => pane.content && pane.content.kind),
    route: location.pathname,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) =>
      (tab.textContent || '').trim().slice(0, 30),
    ),
  };
})()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await (await browser.createBrowserContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(6000);

const before = await page.evaluate(READ_LAYOUT);

const thread = await page.evaluate(() => {
  const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find((candidate) =>
    /\/threads\/thr_[A-Za-z0-9]+/.test(candidate.getAttribute("href") || ""),
  );
  const match = anchor === null ? null : /\/threads\/(thr_[A-Za-z0-9]+)/.exec(
    anchor.getAttribute("href") || "",
  );
  return match === null ? null : match[1];
});

const created = await page.evaluate(async (threadId) => {
  const response = await fetch("/api/v1/terminals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cols: 80,
      rows: 20,
      start: { mode: "shell" },
      target: { kind: "thread", threadId },
      title: "focus-board split-prime probe",
    }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return {
    status: response.status,
    id: (parsed && (parsed.id ?? parsed.terminalId ?? parsed.session?.id)) ?? null,
    shape: text.slice(0, 240),
  };
}, thread);

await sleep(3000);
const afterCreate = await page.evaluate(READ_LAYOUT);

// The host's own terminal surface, reached by route, is the other half of the
// idea: if the terminal lives in a tab inside one pane, opening it cannot
// split the window either.
await page.goto(`${APP.replace(/\/board$/, "/board")}`, { waitUntil: "networkidle2" });
await sleep(1500);
const afterReload = await page.evaluate(READ_LAYOUT);

let closed = null;
if (created.id !== null) {
  closed = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/terminals/${encodeURIComponent(id)}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "force", reason: "user" }),
    });
    return { status: response.status, body: (await response.text()).slice(0, 160) };
  }, created.id);
}

const verdict = {
  panesBefore: before.paneCount,
  panesAfterTerminalCreate: afterCreate.paneCount,
  panesAfterReload: afterReload.paneCount,
  splitCreated: afterCreate.paneCount > before.paneCount || afterReload.paneCount > before.paneCount,
  created,
  closed,
};
console.log(JSON.stringify({ before, afterCreate, afterReload, verdict, errors }, null, 2));
writeFileSync(`${OUT_DIR}/prime-split.json`, JSON.stringify({ before, afterCreate, afterReload, verdict, errors }, null, 2));
await browser.close();
process.exit(0);
