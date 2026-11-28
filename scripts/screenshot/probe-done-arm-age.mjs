/**
 * The Done-arm age probe: what a live Done sweep arms, and what the board
 * paints while it is armed.
 *
 * The age gate (PR #539) and the rendered-scope narrowing (PR #540) are pinned
 * by unit tests, but both run on injected state. This probe asks the installed
 * host instead: it opens the running board in a throwaway browser context,
 * reads the Done lane's pill, clicks it so the arm happens, and records three
 * things the operator's report hangs on:
 *
 *   1. which cards the arm captures, and each one's Done age from
 *      `bb focus-board done list --json` (the same records the board's
 *      `done_list` RPC serves);
 *   2. what each armed card LABELS ITSELF (the age chip the operator reads);
 *   3. which non-armed cards wear the sweep-mode amber affordance at rest.
 *
 * It repeats all three on the Parent view's Done row, because
 * `armParentLaneSweepFor` takes a row id and the two boards hand in different
 * scopes.
 *
 * It only ever ARMS and backs out (Escape). It never confirms: no archive, no
 * `--confirm`, nothing written. The real board carries the operator's threads.
 *
 *   node scripts/screenshot/probe-done-arm-age.mjs
 *
 * Honors BB_APP (default http://127.0.0.1:38886/plugins/focus-board/board),
 * CHROME_PATH, OUT_DIR and REPORT. Frames default under
 * docs/screenshots/done-arm-age-<stamp>/, the report under
 * docs/uat/done-arm-age-<stamp>.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOARD_URL = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
const FRAMES = process.env.OUT_DIR ?? `${ROOT}docs/screenshots/done-arm-age-${STAMP}`;
const REPORT = process.env.REPORT ?? `${ROOT}docs/uat/done-arm-age-${STAMP}.md`;
const PLUGIN_ID = "focus-board";
const GROUP_BY_KEY = `${PLUGIN_ID}:groupBy`;
const PANEL_ATTR = "data-focus-board-panel";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bbJson(args) {
  return JSON.parse(
    execFileSync("bb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );
}

/** The operator's resolved Done threshold, from the live settings. */
function liveThreshold() {
  const out = execFileSync("bb", ["plugin", "config", PLUGIN_ID], { encoding: "utf8" });
  const value = /^doneArchiveValue = (\d+)/m.exec(out);
  const unit = /^doneArchiveUnit = "(\w+)"/m.exec(out);
  if (value === null || unit === null) {
    throw new Error(`could not read the Done threshold from:\n${out}`);
  }
  const factor = { hours: 3600_000, days: 86_400_000, weeks: 604_800_000 }[unit[1]];
  if (factor === undefined) throw new Error(`unknown Done archive unit ${unit[1]}`);
  return { value: Number(value[1]), unit: unit[1], ms: Number(value[1]) * factor };
}

/** Read the sweep pill and every card's paint state without arming. */
const readSurface = (surface) => {
  const board =
    surface === "focus"
      ? document.querySelector("[data-columns-board]") ?? document
      : document.querySelector("[data-parent-board]");
  if (board === null) return { ok: false, reason: `no ${surface} board mounted` };
  const holder =
    surface === "focus"
      ? document.querySelector('section[data-column-id="done"] header')
      : document.querySelector('[data-rail-row="done"]');
  if (holder === null) {
    return { ok: false, reason: surface === "focus" ? "no Done lane header" : "no Done rail row" };
  }
  const pill = holder.querySelector("[data-sweep-button]");
  // The scope is the Done lane's own cards (Focus) or the Done row's cells
  // across every lane (Parent) — not every card on the board.
  const scope =
    surface === "focus"
      ? [...board.querySelectorAll('section[data-column-id="done"] [data-thread-card]')]
      : [...board.querySelectorAll('[data-band="done"] [data-thread-card]')];
  const agePattern = /^(just now|\d+[mhd] ago|Done .+ ago)$/;
  const cards = scope.map((el) => {
    // The live bundle may predate the data-age marker, so fall back to the
    // card's own age chip: the last leaf span that reads like an age.
    const marked = el.querySelector("[data-age]");
    const fallback = [...el.querySelectorAll("span")]
      .filter((span) => span.children.length === 0 && agePattern.test((span.textContent ?? "").trim()))
      .pop();
    const age = marked ?? fallback ?? null;
    const rest = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((token) => token.length > 0 && !token.includes(":"));
    return {
      id: el.getAttribute("data-thread-card"),
      nested: el.parentElement?.closest("[data-thread-card]") !== null,
      highlighted: el.hasAttribute("data-sweep-highlighted"),
      selectable: el.hasAttribute("data-sweep-selectable"),
      amberAtRest: rest.includes("ring-amber-500/40") || rest.includes("ring-amber-500"),
      ageText: age?.textContent?.trim() ?? null,
      ageSource: age?.getAttribute("data-age-source") ?? null,
    };
  });
  return {
    ok: true,
    laneCardCount: cards.length,
    pillPresent: pill !== null,
    pillText: pill?.textContent?.trim() ?? "",
    pillLabel: pill?.getAttribute("aria-label") ?? null,
    armed: pill?.getAttribute("aria-pressed") === "true",
    cards,
  };
};

/** Click the lane's or row's sweep pill. */
const clickPill = (surface) => {
  const holder =
    surface === "focus"
      ? document.querySelector('section[data-column-id="done"] header')
      : document.querySelector('[data-rail-row="done"]');
  const pill = holder?.querySelector("[data-sweep-button]");
  if (!pill) return false;
  pill.click();
  return true;
};

/** The board's own done_list answer, so the ages are the board's numbers. */
const callDoneList = async () => {
  const response = await fetch(`/api/v1/plugins/focus-board/rpc/done_list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, text: text.slice(0, 400), parsed };
};

const hoursAgo = (iso, now) => {
  const at = Date.parse(iso ?? "");
  return Number.isNaN(at) ? null : Math.round(((now - at) / 3600_000) * 10) / 10;
};

async function main() {
  if (!existsSync(CHROME)) throw new Error(`expected a browser at ${CHROME} (set CHROME_PATH)`);
  mkdirSync(FRAMES, { recursive: true });

  const threshold = liveThreshold();
  const doneList = bbJson(["focus-board", "done", "list", "--json"]);
  const doneById = new Map(doneList.map((entry) => [entry.id, entry]));
  const now = Date.now();
  const threads = bbJson(["thread", "list", "--json"]);
  const liveIds = new Set(
    threads.filter((row) => row.archivedAt === null && row.deletedAt === null).map((row) => row.id),
  );
  const liveDone = doneList.filter(
    (entry) => liveIds.has(entry.id) && entry.stale !== true,
  );
  const parentIds = new Set();
  for (const row of threads) {
    if (row.parentThreadId !== null && liveIds.has(row.id)) parentIds.add(row.parentThreadId);
  }
  const aged = liveDone.filter((entry) => {
    const age = hoursAgo(entry.doneAt, now);
    return age !== null && age * 3600_000 >= threshold.ms && entry.keep !== true;
  });
  const expected = aged.filter((entry) => !parentIds.has(entry.id)).length;
  const young = liveDone.filter((entry) => {
    const age = hoursAgo(entry.doneAt, now);
    return age !== null && age * 3600_000 < threshold.ms;
  });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1600, height: 1200 },
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setCacheEnabled(false);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));

  const rounds = [];
  let rpc = { status: 0, text: "", parsed: null };
  try {
    await page.goto(BOARD_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(`[${PANEL_ATTR}]`, { timeout: 25000 });
    await page
      .waitForFunction(() => document.querySelectorAll("[data-thread-card]").length >= 3, {
        timeout: 25000,
      })
      .catch(() => {});
    rpc = await page.evaluate(callDoneList);

    for (const surface of ["focus", "parent"]) {
      if (surface === "parent") {
        await page.evaluate((key) => localStorage.setItem(key, "parent"), GROUP_BY_KEY);
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForSelector(`[${PANEL_ATTR}]`, { timeout: 25000 });
        await page.waitForSelector("[data-parent-board]", { timeout: 25000 });
        await sleep(1500);
      }
      if (surface === "focus") {
        await page.evaluate(() =>
          document
            .querySelector('section[data-column-id="done"]')
            ?.scrollIntoView({ block: "start", inline: "center" }),
        );
        await sleep(600);
        await page.screenshot({ path: `${FRAMES}/focus-done-before.png` });
      } else {
        await page.screenshot({ path: `${FRAMES}/parent-done-before.png` });
      }
      const before = await page.evaluate(readSurface, surface);
      const clicked = await page.evaluate(clickPill, surface);
      await sleep(500);
      const armed = await page.evaluate(readSurface, surface);
      if (surface === "focus") {
        await page.evaluate(() =>
          document
            .querySelector('section[data-column-id="done"]')
            ?.scrollIntoView({ block: "start", inline: "center" }),
        );
        await sleep(400);
      }
      await page.screenshot({ path: `${FRAMES}/${surface}-done-armed.png` });
      await page.keyboard.press("Escape");
      await sleep(300);
      const disarmed = await page.evaluate(readSurface, surface);
      if (surface === "focus") {
        await page.screenshot({ path: `${FRAMES}/focus-done-disarmed.png` });
      }
      rounds.push({ surface, before, clicked, armed, disarmed });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const describeCard = (card) => {
    const entry = doneById.get(card.id);
    const doneAge = entry === undefined ? null : hoursAgo(entry.doneAt, now);
    return {
      id: card.id,
      doneAt: entry?.doneAt ?? null,
      doneAgeHours: doneAge,
      labelled: card.ageText,
      ageSource: card.ageSource,
      nested: card.nested,
      young: doneAge !== null && doneAge * 3600_000 < threshold.ms,
    };
  };

  const summary = [];
  const lines = [];
  lines.push(`# Done-arm age probe (${STAMP})`);
  lines.push("");
  lines.push(`- board: ${BOARD_URL}`);
  lines.push(`- Done threshold: ${threshold.value} ${threshold.unit} = ${threshold.ms} ms`);
  lines.push(`- live threads carrying a Done record: ${liveDone.length}`);
  lines.push(`- live Done past the threshold, unkept: ${aged.length}`);
  lines.push(`- minus live-child parents (the arm's ceiling): ${expected}`);
  lines.push(`- live Done marked inside the threshold: ${young.length}`);
  lines.push("");
  for (const round of rounds) {
    const armedCards = round.armed.cards.filter((card) => card.highlighted).map(describeCard);
    const tooYoung = armedCards.filter((card) => card.young);
    const labelledYoung = armedCards.filter(
      (card) => card.labelled !== null && /^(just now|\d+m ago|\d+h ago)$/.test(card.labelled),
    );
    const falseAmber = round.armed.cards
      .filter((card) => card.amberAtRest && !card.highlighted)
      .map(describeCard);
    const falseAmberYoung = falseAmber.filter((card) => card.young);
    round.armedCards = armedCards;
    round.falseAmber = falseAmber;
    lines.push(`### ${round.surface}`);
    lines.push("");
    lines.push(`- pill before arming: ${JSON.stringify(round.before.pillText)} (${round.before.pillLabel ?? "no label"})`);
    lines.push(`- clicked the pill: ${round.clicked}`);
    lines.push(`- armed pill reads: ${JSON.stringify(round.armed.pillText)}`);
    lines.push(`- cards painted as armed: ${armedCards.length}`);
    lines.push(`- armed cards YOUNGER than the threshold: ${tooYoung.length}`);
    lines.push(`- armed cards LABELLED younger than 1 day: ${labelledYoung.length}`);
    if (labelledYoung.length > 0) {
      lines.push("");
      lines.push("| armed id | Done stamp | Done age (h) | the card says |");
      lines.push("| --- | --- | --- | --- |");
      for (const card of labelledYoung.slice(0, 12)) {
        lines.push(`| ${card.id} | ${card.doneAt} | ${card.doneAgeHours} | ${card.labelled} |`);
      }
      if (labelledYoung.length > 12) {
        lines.push("");
        lines.push(`(${labelledYoung.length - 12} more in evidence.json)`);
      }
    }
    lines.push("");
    lines.push(`- non-armed cards wearing amber at rest: ${falseAmber.length}`);
    lines.push(`- of those, younger than the threshold: ${falseAmberYoung.length}`);
    if (falseAmberYoung.length > 0) {
      lines.push("");
      lines.push("| young id | Done stamp | Done age (h) | the card says |");
      lines.push("| --- | --- | --- | --- |");
      for (const card of falseAmberYoung.slice(0, 12)) {
        lines.push(`| ${card.id} | ${card.doneAt} | ${card.doneAgeHours} | ${card.labelled} |`);
      }
      if (falseAmberYoung.length > 12) {
        lines.push("");
        lines.push(`(${falseAmberYoung.length - 12} more in evidence.json)`);
      }
    }
    lines.push("");
    lines.push(`- disarmed after Escape: ${round.disarmed.armed === false}`);
    lines.push("");
  }
  const records = rpc.parsed?.result?.records ?? null;
  const badStamps =
    records === null
      ? []
      : Object.entries(records).filter(
          ([, record]) => record.doneAt !== undefined && typeof record.doneAt !== "string",
        );
  lines.push("## The board's own Done records");
  lines.push("");
  lines.push(`- done_list HTTP ${rpc.status}`);
  lines.push(`- records read: ${records === null ? "unreadable" : Object.keys(records).length}`);
  lines.push(`- non-string doneAt values: ${badStamps.length}`);
  lines.push("");
  lines.push(`Frames: ${FRAMES}`);
  if (pageErrors.length > 0) {
    lines.push("");
    lines.push("## Page errors");
    for (const error of pageErrors) lines.push(`- ${error}`);
  }
  writeFileSync(REPORT, `${lines.join("\n")}\n`);
  writeFileSync(
    `${FRAMES}/evidence.json`,
    `${JSON.stringify(
      {
        app: BOARD_URL,
        capturedAt: new Date().toISOString(),
        threshold,
        census: {
          liveDone: liveDone.length,
          agedUnkept: aged.length,
          armCeiling: expected,
          young: young.length,
        },
        rpc: { status: rpc.status, records: records === null ? null : Object.keys(records).length },
        rounds: rounds.map((round) => ({
          surface: round.surface,
          pill: { before: round.before.pillText, armed: round.armed.pillText },
          armedCards: round.armedCards,
          falseAmber: round.falseAmber,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(lines.join("\n"));
  console.log(`\nreport: ${REPORT}`);
  console.log(`frames: ${FRAMES}`);
}

await main();
