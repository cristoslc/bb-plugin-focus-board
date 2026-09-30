// Repro probe for the "click in the chat pane yanks the transcript back to
// the bottom" bug. Drives the LIVE bb web UI (not the mock SDK harness — the
// buggy code is bb's host scroll shell, which the mock does not include).
//
// Usage:
//   BB_APP=http://127.0.0.1:38886 THREAD_TITLE="scaffolding" node scripts/probe-chat-click-jump.mjs
// (BB_APP = the running bb server URL; THREAD_TITLE = a substring of a board
// card title whose pane transcript is several pages long.)
//
// What it does: opens the Focus Board, opens the matching card's pane, then:
//   1. wheels the transcript up ~500px (about half the pane viewport),
//   2. clicks in the transcript near the bottom, above the composer,
//   3. reports whether the scroll position snapped back down to the bottom.
// It also monkey-patches the scroller's scrollTop setter, so a bogus write
// (observed: scrollTop set to a value far beyond the real maximum, clamped
// to the bottom) is logged with the calling stack — that stack is the
// evidence trail: it names the affected host module/function.
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/";
const TITLE = process.env.THREAD_TITLE ?? "";
if (!TITLE) {
  console.error("Set THREAD_TITLE to a long-transcript board card title substring.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
page.on("error", (e) => console.log("[page error]", String(e).slice(0, 300)));
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim() === "Focus Board")?.click();
});
await new Promise((r) => setTimeout(r, 2500));

const card = await page.evaluate((title) => {
  const cards = [...document.querySelectorAll("[data-thread-card]")];
  const target = cards.find((e) => (e.textContent ?? "").includes(title));
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 30) };
}, TITLE);
if (!card) { console.error("card not found:", TITLE); await browser.close(); process.exit(1); }
await page.mouse.click(card.x, card.y);
await new Promise((r) => setTimeout(r, 5000));

const ok = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label^="Thread:"]');
  const el = [...aside.querySelectorAll("*")].find((e) => (e.className ?? "").toString().includes("thread-scrollbar"));
  if (!el) return "no chat scroller in pane";
  window.__el = el;
  window.__t0 = performance.now();
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(el, "scrollTop", {
    get() { return desc.get.call(this); },
    set(v) {
      const was = desc.get.call(this);
      // Log writes that overshoot the real maximum of the live content (the
      // bogus restore clamps to the bottom, so catch it before the clamp).
      if (v > el.scrollHeight) {
        window.__bug = {
          at: Math.round(performance.now() - window.__t0),
          wrote: Math.round(v),
          liveMax: Math.round(el.scrollHeight - el.clientHeight),
          stack: (new Error().stack || "").split("\n").slice(2, 6).map((s) => s.trim().replace(/https?:\/\/[^)]*?assets\//, "").replace(/:\d+:\d+/g, "")).join(" | "),
        };
      }
      desc.set.call(this, v);
    },
    configurable: true,
  });
  return true;
});
if (ok !== true) { console.error(ok); await browser.close(); process.exit(1); }

const rect = await page.evaluate(() => {
  const r = window.__el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const before = await page.evaluate(() => Math.round(window.__el.scrollTop));

// 1. wheel up ~half a viewport
await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
await page.mouse.wheel({ deltaY: -Math.round(rect.h / 2) });
await new Promise((r) => setTimeout(r, 1000));
const mid = await page.evaluate(() => Math.round(window.__el.scrollTop));
console.log("scrolled up: %d -> %d (of max %s)", before, mid, JSON.stringify(await page.evaluate(() => Math.round(window.__el.scrollHeight - window.__el.clientHeight))));

// 2. click in the transcript near the bottom, above the composer
await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h - 25);
await new Promise((r) => setTimeout(r, 2000));
const after = await page.evaluate(() => Math.round(window.__el.scrollTop));
console.log("after click: %d (jumped %s)", after, after - mid === 0 ? "0px" : (after - mid > 0 ? "+" : "") + (after - mid) + "px DOWN to the bottom");

const bug = await page.evaluate(() => window.__bug ?? null);
if (bug) {
  console.log("BOGUS scrollTop write captured:", JSON.stringify(bug, null, 2));
  console.log("=> the click-triggered jump is a host scroll-manager write;");
  console.log("   stack above names the module+function to report upstream.");
} else {
  console.log("no bogus write this run (the bug is intermittent: needs a stale");
  console.log("pending scrollAnchor capture — see docs/chat-click-jump-2026-09-29.md).");
}
await page.screenshot({ path: "/tmp/probe-chat-click-jump.png" });
await browser.close();