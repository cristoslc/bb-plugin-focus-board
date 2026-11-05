// Runtime probe for the pane-parity audit's Gap 1 claim (2026-11-04): with a
// pending question, the pane shows the plugin's PendingInteractionCard AND
// the host's own question banner at the same time — two forms for one
// interaction. bb 0.48.1 renders the banners in the embedded chat's composer
// for every presentation (ThreadScreen has no presentation gate), so the
// card's premise ("the embedded chat renders no interaction UI") is stale.
//
// Drives the LIVE bb web UI — the host banner is the host's ThreadChat, which
// the mock-SDK harness does not include. Needs a thread whose turn is
// BLOCKED on a pending question (a provider AskUserQuestion call): spawn one
// with bb and let it reach the tool call first, e.g.
//
//   bb thread spawn --project proj_p4562js7v2 --prompt "Call your
//   AskUserQuestion tool ..." --json
//
// Usage:
//   BB_APP=http://127.0.0.1:38886 THREAD_ID=thr_xxx \
//     node scripts/screenshot/repro-pending-question-double.mjs
//
// Exits 0 when the pane shows BOTH surfaces (claim confirmed); exits 1 when
// the pane shows fewer — then the card's premise still holds and Gap 1 must
// not ship. Answering the question from the HOST banner is part of the probe:
// the card should then be stale (still rendered) until its own refetch, the
// audit's second symptom. Screenshots land in
// docs/screenshots/repro-pending-question-double/ unless OUT_DIR is set.
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a thread blocked on a pending question.");
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/repro-pending-question-double";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
page.on("error", (e) => console.log("[page error]", String(e).slice(0, 300)));
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));

const card = await page.evaluate((id) => {
  const cards = [...document.querySelectorAll(`[data-thread-card="${id}"]`)];
  if (cards.length === 0) return null;
  const r = cards[cards.length - 1].getBoundingClientRect();
  return { x: r.x + Math.min(r.width / 2, 200), y: r.y + Math.min(r.height / 2, 40) };
}, THREAD_ID);
if (!card) {
  console.error("board card not found for thread:", THREAD_ID);
  await browser.close();
  process.exit(1);
}
await page.mouse.click(card.x, card.y);
await new Promise((r) => setTimeout(r, 5000));

const state = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (!pane) return { pane: false };
  const pluginCard = pane.querySelector('[data-testid="thread-board-pending-interaction"]') !== null;
  const hostBanner = pane.querySelector('[data-testid="user-question-banner"]') !== null;
  return { pane: true, pluginCard, hostBanner };
});
console.log(JSON.stringify(state));

await page.screenshot({ path: `${OUT_DIR}/pane-before.png` });
const paneBox = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (paneBox) {
  await page.screenshot({
    path: `${OUT_DIR}/pane-before-crop.png`,
    clip: paneBox,
  });
}

const confirmed = state.pane && state.pluginCard && state.hostBanner;
console.log(confirmed
  ? "CONFIRMED: the pane renders the plugin card AND the host's question banner for one pending question."
  : "NOT CONFIRMED — the pane does not show both surfaces; the card's premise may still hold. Gap 1 must not ship without a re-check.");

// Second symptom: answer through the HOST banner, then re-check the plugin
// card inside the pane. A stale card (still rendering a form for the
// answered interaction) is the audit's "answering one leaves the other
// stale" impact — evidence for the deletion, and the reason the card must
// go rather than stay.
if (confirmed) {
  const optionBox = await page.evaluate(() => {
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    const banner = pane?.querySelector('[data-testid="user-question-banner"]');
    if (!banner) return null;
    const options = [...banner.querySelectorAll("button")].filter((el) =>
      (el.textContent ?? "").includes("Option One"),
    );
    if (options.length === 0) return null;
    const r = options[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (optionBox) {
    await page.mouse.click(optionBox.x, optionBox.y);
    await new Promise((r) => setTimeout(r, 1200));
    const after = await page.evaluate(() => {
      const pane = document.querySelector('aside[aria-label^="Thread:"]');
      return {
        pluginCard: pane?.querySelector('[data-testid="thread-board-pending-interaction"]') !== null,
        hostBanner: pane?.querySelector('[data-testid="user-question-banner"]') !== null,
      };
    });
    console.log("after answering via the host banner:", JSON.stringify(after));
    await page.screenshot({ path: `${OUT_DIR}/pane-after-answer-via-host.png`, clip: paneBox });
  } else {
    console.log("host banner's Option One button not found; skipping the answer step.");
  }
}
await browser.close();
process.exit(confirmed ? 0 : 1);
