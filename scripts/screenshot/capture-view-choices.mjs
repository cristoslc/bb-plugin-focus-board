/**
 * One-shot headless capture for the View menu's two-state choices (lane
 * direction and Nest child threads as Vertical | Horizontal and Off | On).
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   HARNESS_URL=http://localhost:5173/ node scripts/screenshot/capture-view-choices.mjs
 *
 * Writes frames to docs/screenshots/view-choices/ and an evidence.json with
 * each pair's chosen segment and the board's `data-lane-direction`, so the
 * stills and the state they claim can be checked against each other.
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = `${new URL("../../docs/screenshots/", import.meta.url).pathname}view-choices/`;

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  touch: { width: 1180, height: 820, deviceScaleFactor: 2, hasTouch: true },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const evidence = [];

/** The open View menu plus its trigger, padded, as a clip box. */
async function menuClip(page) {
  return page.evaluate(() => {
    const trigger = document.querySelector('button[aria-label="View"]');
    const menu = document.querySelector('[role="presentation"][aria-label="View"]');
    if (trigger === null || menu === null) return null;
    const a = trigger.getBoundingClientRect();
    const b = menu.getBoundingClientRect();
    const pad = 16;
    const left = Math.max(0, Math.min(a.x, b.x) - pad);
    const top = Math.max(0, Math.min(a.y, b.y) - pad);
    const right = Math.max(a.x + a.width, b.x + b.width) + pad;
    const bottom = Math.max(a.y + a.height, b.y + b.height) + pad;
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

/** The chosen segment of one pair, by the group's accessible name. */
async function chosen(page, name) {
  return page.evaluate((label) => {
    const group = document.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
    if (group === null) return null;
    const picked = [...group.querySelectorAll('[role="radio"]')].find(
      (radio) => radio.getAttribute("aria-checked") === "true",
    );
    return picked?.textContent?.trim() ?? null;
  }, name);
}

/** Tap one segment by its label, inside its own pair. Re-opens the View menu
 *  if a previous pick closed it, so every frame starts from a known menu. */
async function pick(page, name, label) {
  if ((await page.$('[role="radiogroup"][aria-label="Lane direction"]')) === null) {
    await page.click('button[aria-label="View"]');
    await page.waitForSelector('[role="radiogroup"][aria-label="Lane direction"]', {
      timeout: 10_000,
    });
    await sleep(250);
  }
  const point = await page.evaluate(
    ({ groupLabel, optionLabel }) => {
      const group = document.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`);
      const option = [...(group?.querySelectorAll('[role="radio"]') ?? [])].find(
        (radio) => radio.textContent?.trim() === optionLabel,
      );
      if (!option) return null;
      const r = option.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { groupLabel: name, optionLabel: label },
  );
  if (point === null) throw new Error(`view-choices: no ${name}/${label} segment`);
  await page.mouse.click(point.x, point.y);
  await sleep(700);
}

for (const [variant, viewport] of Object.entries(VIEWPORTS)) {
  console.log(`capturing ${variant}`);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  // Each frame set starts from the stored defaults, not the last viewport's
  // picks.
  await page.evaluateOnNewDocument(() => window.localStorage.clear());
  await page.goto(`${BASE}?groupBy=status&lastSeenUnreleased=current`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await sleep(400);

  await page.click('button[aria-label="View"]');
  await page.waitForSelector('[role="radiogroup"][aria-label="Lane direction"]', {
    timeout: 10_000,
  });
  await sleep(300);

  const openClip = await menuClip(page);
  const row = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent?.includes("Last activity"),
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (row !== null) await page.mouse.move(row.x, row.y);
  await sleep(200);
  await page.screenshot({
    path: `${OUT}${variant}-menu-open.png`,
    ...(openClip === null ? {} : { clip: openClip }),
  });
  evidence.push({
    frame: `${variant}-menu-open.png`,
    laneDirection: await chosen(page, "Lane direction"),
    nestChildren: await chosen(page, "Nest child threads"),
    board: await page.evaluate(
      () => document.querySelector("[data-lane-direction]")?.getAttribute("data-lane-direction") ?? null,
    ),
  });

  // Tap Horizontal: the pair follows, the board re-lays as rows behind it.
  await pick(page, "Lane direction", "Horizontal");
  await page.screenshot({
    path: `${OUT}${variant}-horizontal-tapped.png`,
    ...(await menuClip(page).then((clip) => (clip === null ? {} : { clip }))),
  });
  evidence.push({
    frame: `${variant}-horizontal-tapped.png`,
    laneDirection: await chosen(page, "Lane direction"),
    board: await page.evaluate(
      () => document.querySelector("[data-lane-direction]")?.getAttribute("data-lane-direction") ?? null,
    ),
  });

  // Tap Off: the family rows flatten while the pair reads Off.
  await pick(page, "Nest child threads", "Off");
  await page.screenshot({
    path: `${OUT}${variant}-nest-off-tapped.png`,
    ...(await menuClip(page).then((clip) => (clip === null ? {} : { clip }))),
  });
  evidence.push({
    frame: `${variant}-nest-off-tapped.png`,
    nestChildren: await chosen(page, "Nest child threads"),
    familyRows: await page.evaluate(
      () => document.querySelector("[data-nested-rows]") !== null,
    ),
  });

  await page.close();
}

await browser.close();
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
