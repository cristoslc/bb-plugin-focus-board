// Runtime probe for the pane's markdown compensations against the LIVE bb
// app: does bb 0.49.0's embedded `ThreadChat` now route local files itself —
// inline-code file links and relative markdown links — inside a plugin pane?
//
// The pane patches three things here (2026-09-29, bb 0.44 era): it paints
// inline-code `.md` links itself (components/decorate-inline-code.ts), it
// reopens relative anchor hrefs against the thread's environment
// (components/chat-link-intercept.ts + the pane's click capture), and it
// fuses the host's ExternalLink glyph with the link's last character
// (components/host-link-glue.ts) because the glyph could wrap alone.
//
// bb 0.49.0's source says the plugin chat now mounts its own
// `ThreadTimelineNavigationProvider` with the thread's hostId and an
// `onOpenLocalFileLink`, and that inline code gains a local-file anchor when
// the file exists (`MarkdownInlineCodeFileLink`, gated by
// `useHostPathExists`), with the icon wrapped in `span.whitespace-nowrap`.
// This probe is the host's own answer: it reads the rendered pane.
//
// Usage: THREAD_ID=<thread whose message carries the fixtures> \
//   node scripts/screenshot/probe-pane-host-markdown.mjs
//
// Fixtures the probe expects in the thread's newest message (see
// docs/tech-debt/host-workaround-audit-2026-11-16.md):
//   `docs/test-coverage-matrix.md`   inline code, file exists
//   `docs/no-such-file.md`           inline code, file missing
//   `components/thread-pane.tsx`     inline code, non-markdown
//   [x](CHANGELOG.md)                relative link, resolves
//   [x](docs/no-such-file.md)        relative link, missing
//
// Honors BB_APP, CHROME_PATH, OUT_DIR. Exits 0 when the pane opened and the
// fixtures rendered; the verdict line says whether the host now owns the
// surface. Exits 1 when the pane or the fixtures are missing, so a scheduled
// run notices its own rot.
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a thread whose newest message carries the markdown fixtures.");
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-pane-host-markdown";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Reads the pane's chat body and reports, per code span and per anchor,
 *  which side painted the link: the host or the plugin. */
const READ_PANE = `(function () {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (pane === null) return { paneOpen: false };
  const body = pane.querySelector('[data-pane-chat-body]') ?? pane;
  const codes = [];
  for (const code of body.querySelectorAll('code')) {
    if (code.closest('pre') !== null) continue;
    const anchor = code.closest('a');
    codes.push({
      text: (code.textContent ?? '').trim().slice(0, 60),
      inAnchor: anchor !== null,
      anchorHref: anchor === null ? null : anchor.getAttribute('href'),
      hostIcon: anchor !== null && anchor.querySelector('svg[data-icon="ExternalLink"]') !== null,
      hostIconInNowrap: anchor !== null && anchor.querySelector('span.whitespace-nowrap') !== null,
      pluginPathFlag: code.hasAttribute('data-focus-board-path-link'),
      pluginGlue: code.querySelector('[data-focus-board-path-link-glue]') !== null,
      hostInlineCodeAttr: anchor !== null && anchor.hasAttribute('data-clipboard-inline-code'),
    });
  }
  const anchors = [];
  for (const anchor of body.querySelectorAll('a')) {
    anchors.push({
      text: (anchor.textContent ?? '').trim().slice(0, 40),
      href: anchor.getAttribute('href'),
      hostIcon: anchor.querySelector('svg[data-icon="ExternalLink"]') !== null,
      hostIconInNowrap: anchor.querySelector('span.whitespace-nowrap') !== null,
      pluginHostGlue: anchor.querySelector('[data-focus-board-host-glue]') !== null,
    });
  }
  return {
    paneOpen: true,
    codes,
    anchors,
    pluginHostGlueCount: body.querySelectorAll('[data-focus-board-host-glue]').length,
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate((id) => {
  document
    .querySelector(`[data-thread-card="${id}"]`)
    ?.scrollIntoView({ block: "center", inline: "center" });
}, THREAD_ID);
await new Promise((r) => setTimeout(r, 800));
const target = await page.evaluate((id) => {
  const card = document.querySelector(`[data-thread-card="${id}"]`);
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { x: r.x + Math.min(r.width / 2, 150), y: r.y + Math.min(r.height / 2, 40) };
}, THREAD_ID);
if (!target) {
  console.error("board card not found:", THREAD_ID);
  await browser.close();
  process.exit(1);
}
await page.mouse.click(target.x, target.y);
// The pane restores bb's persisted reading position, so wheel to the end
// before reading: the fixtures are in the newest message.
await new Promise((r) => setTimeout(r, 5000));
const paneBox = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (paneBox === null) {
  console.error("the pane did not open");
  await browser.close();
  process.exit(1);
}
await page.mouse.move(paneBox.x, paneBox.y);
for (let i = 0; i < 12; i += 1) {
  await page.mouse.wheel({ deltaY: 900 });
  await new Promise((r) => setTimeout(r, 120));
}
// The plugin's decoration is a post-render scan (mutation observer, one per
// frame) plus one existence RPC per path, so let it settle before reading.
await new Promise((r) => setTimeout(r, 2500));

const state = await page.evaluate(READ_PANE);
if (!state.paneOpen) {
  console.error("the pane closed before the read");
  await browser.close();
  process.exit(1);
}
await page.screenshot({ path: `${OUT_DIR}/pane-markdown.png`, clip: undefined });

const inline = state.codes.find((c) => c.text.includes("test-coverage-matrix"));
const missing = state.codes.find((c) => c.text.includes("no-such-file.md") && !c.inAnchor);
const relative = state.anchors.find((a) => (a.text ?? "").includes("changelog"));

console.log(JSON.stringify({ threadId: THREAD_ID, ...state, verdict: {
  fixtureRendered: inline !== undefined,
  inlineCodeHostLinked: inline?.inAnchor === true && inline?.hostInlineCodeAttr === true,
  inlineCodePluginPainted: inline?.pluginPathFlag === true,
  missingFileLeftPlain: missing === undefined ? null : missing.inAnchor === false,
  relativeLinkHostRouted: relative !== undefined && relative.href !== null && relative.href.startsWith("file:"),
  relativeLinkPluginGlued: relative?.pluginHostGlue === true,
  pluginHostGlueCount: state.pluginHostGlueCount,
}}, null, 2));

await browser.close();
process.exit(inline === undefined ? 1 : 0);
