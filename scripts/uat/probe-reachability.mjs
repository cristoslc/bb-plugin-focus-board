#!/usr/bin/env node
/**
 * Release probe: can an operator who has never run a UAT suite reach the
 * reorder at all? Renders the board with NO seeded rank store and attempts a
 * real drag in the Unread lane — the path a first-time user takes.
 *
 * This is the question every other test in the repo assumes the answer to.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5311;

const child = spawn(
  "npx",
  ["vite", "--config", "scripts/screenshot/vite.config.ts", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);
const base = `http://localhost:${PORT}/`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await sleep(200);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
// No `ranks=` seed: exactly what a fresh install looks like.
await page.goto(`${base}?groupBy=status`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("section[data-column-id]");
await sleep(500);

const probe = await page.evaluate(() => {
  const section = document.querySelector('section[data-column-id="unread"]');
  const ids = [...section.querySelectorAll(":scope > div > ul > li")].map((li) =>
    li.querySelector("a[href]")?.getAttribute("href")?.split("/").pop(),
  );
  // Does any card advertise itself as droppable for a reorder?
  const slots = section.querySelectorAll("li[data-rank-slot]").length;
  // Does any control offer to create an order (a menu, a button, a grip)?
  const board = document.querySelector("section[data-column-id='unread']").closest("div[style], div")
    ?.parentElement ?? document.body;
  const controls = [...board.querySelectorAll("button,[role='menuitem'],[draggable]")].map(
    (el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName,
  );
  return { ids, rankedSlots: slots, controls };
});

// Attempt the real gesture anyway, to confirm it cannot land.
const attempt = await page.evaluate(() => {
  const li = document.querySelector(
    'section[data-column-id="unread"] > div > ul > li',
  );
  const anchor = li?.querySelector("a[draggable]");
  if (!anchor) return { dispatched: false, reason: "no draggable card found" };
  const dt = new DataTransfer();
  anchor.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  return { dispatched: true, rankKey: dt.getData("text/focus-board-rank") };
});

console.log("unread lane cards:      ", probe.ids.join(", "));
console.log("rank drop slots found:  ", probe.rankedSlots);
console.log("controls in the lane:   ", probe.controls.length ? probe.controls.join(" | ") : "(none)");
console.log("drag dispatched:        ", attempt.dispatched);
console.log("rank key in payload:    ", JSON.stringify(attempt.rankKey));
const reachable = probe.rankedSlots > 0;
console.log(`\nREORDER REACHABLE BY A FIRST-TIME USER: ${reachable ? "yes" : "NO"}`);

await browser.close();
child.kill();
process.exit(reachable ? 0 : 1);
