// What the Done lane's sweep pill proposes on the LIVE board, and what arming
// it actually selects, measured against the configured archive threshold.
//
// The operator's report: "minimum age to auto-sweep applies to Done, but it
// looks like the sweep button auto-arms ALL Done issues for archival. There's
// a time threshold in settings for this."
//
// The arm path is filtered in code (armSweepFor → sweepCandidatesFor →
// sweepCandidatesForDoneColumn keeps only doneAt older than the configured
// threshold), and the jsdom lane-pill tests pin that. So the live board is
// where the explanations are ruled apart:
//
//   1. the pill's proposal is filtered and its number is smaller than the
//      lane's Done count, and every armed card's doneAt is past the threshold
//      (the report reflects the data), or
//   2. the pill's number equals the whole lane, or an armed card's doneAt is
//      inside the threshold (an unfiltered path).
//
// It reads the app's own `sweep_config_get` and `done_list` payloads off the
// board's RPC traffic (a fetch wrapper installed before the app script runs),
// so the threshold and each card's age are the board's numbers, not the
// probe's. It arms the pill, reads the armed label and the highlighted ids,
// disarms, then opens the lane menu (the other arm door) and reads whether it
// offers "Sweep this lane…". The Parent view's Done row rail is measured the
// same way, since that board has no lane menu and always draws a broom.
//
// Read-only on the data: arming and disarming write nothing, and the sweep is
// never confirmed. The browser context is the run's own (fresh storage, no
// split layout), so nothing here touched the operator's window or profile.
//
// Usage: node scripts/screenshot/probe-done-sweep-arm.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, WIDTH, HEIGHT.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
const OUT_DIR = process.env.OUT_DIR ?? `docs/screenshots/done-sweep-arm-${stamp}`;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = {
  width: Number(process.env.WIDTH ?? 1800),
  height: Number(process.env.HEIGHT ?? 1100),
};

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Record the focus-board RPC answers the board itself reads. */
const CAPTURE_RPC = () => {
  window.__doneSweepRpc = [];
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    const response = await origFetch(...args);
    if (String(url).includes("/plugins/focus-board/rpc/")) {
      response
        .clone()
        .text()
        .then((text) => {
          try {
            window.__doneSweepRpc.push({ url: String(url), body: JSON.parse(text) });
          } catch {
            /* a non-JSON answer is not one of the payloads under test */
          }
        })
        .catch(() => {});
    }
    return response;
  };
};

/** The Done lane's header facts, pill, cards, and armed selection. */
const READ_DONE_LANE = `(function () {
  const section = document.querySelector('[data-column-id="done"]');
  if (section === null) return { found: false };
  const header = section.querySelector("header");
  const nameEl = header === null ? null : header.querySelector("h3 span");
  const countEl =
    header === null
      ? null
      : [...header.children].find(
          (el) =>
            el.tagName === "SPAN" &&
            el.querySelector("h3") === null &&
            (el.textContent || "").trim() !== "",
        ) ?? null;
  const pill = section.querySelector("[data-sweep-button]");
  const ids = (nodes) => [
    ...new Set(nodes.map((n) => n.getAttribute("data-thread-card"))),
  ];
  return {
    found: true,
    label: nameEl === null ? null : (nameEl.textContent || "").trim(),
    laneCount: countEl === null ? null : Number((countEl.textContent || "").trim()),
    pill:
      pill === null
        ? null
        : {
            text: (pill.textContent || "").trim(),
            label: pill.getAttribute("aria-label"),
            pressed: pill.getAttribute("aria-pressed"),
            disabled: pill.disabled === true,
          },
    cancel: section.querySelector("[data-sweep-cancel]") !== null,
    cardIds: ids([...section.querySelectorAll("[data-thread-card]")]),
    highlightedIds: ids([...section.querySelectorAll("[data-sweep-highlighted]")]),
  };
})()`;

const READ_MENU = `(function () {
  const menu = document.querySelector('[role="menu"]');
  if (menu === null) return { open: false, entries: [] };
  return {
    open: true,
    entries: [...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')]
      .map((el) => (el.textContent || "").trim()),
  };
})()`;

/** The Parent view's Done row: rail label, pill, every lane's Done band. */
const READ_DONE_ROW = `(function () {
  const row = document.querySelector('[data-rail-row="done"]');
  if (row === null) return { found: false };
  const pill = row.querySelector("[data-sweep-button]");
  const bands = [...document.querySelectorAll('[data-sweep-row="done"]')];
  const ids = (nodes) => [
    ...new Set(nodes.map((n) => n.getAttribute("data-thread-card"))),
  ];
  // Cards a non-locked lane's band hides behind its "+N more" chip: in the
  // lane's data and in the row sweep, but with no rendered card to highlight.
  const chipped = bands.flatMap((band) =>
    [...band.querySelectorAll("span")]
      .map((span) => (span.textContent || "").trim())
      .filter((text) => /^\\+\\d+ more$/.test(text))
      .map((text) => Number(text.replace(/\\D/g, ""))),
  );
  return {
    found: true,
    railText: (row.innerText || "").replace(/\\s+/g, " ").trim(),
    laneCount: document.querySelectorAll("[data-lane-id]").length,
    doneBands: bands.length,
    chippedCards: chipped.reduce((total, count) => total + count, 0),
    chipCounts: chipped,
    pill:
      pill === null
        ? null
        : {
            text: (pill.textContent || "").trim(),
            label: pill.getAttribute("aria-label"),
          },
    cardIds: ids(bands.flatMap((band) => [...band.querySelectorAll("[data-thread-card]")])),
    highlightedIds: ids(
      bands.flatMap((band) => [...band.querySelectorAll("[data-sweep-highlighted]")]),
    ),
  };
})()`;

const READ_LANES = `(function () {
  const lanes = [];
  for (const section of document.querySelectorAll("[data-column-id]")) {
    const header = section.querySelector("header");
    const pill = section.querySelector("[data-sweep-button]");
    lanes.push({
      id: section.getAttribute("data-column-id"),
      headerText: header === null ? null : (header.innerText || "").replace(/\\s+/g, " ").trim(),
      cards: new Set(
        [...section.querySelectorAll("[data-thread-card]")].map((n) =>
          n.getAttribute("data-thread-card"),
        ),
      ).size,
      pill: pill === null ? null : (pill.textContent || "").trim(),
    });
  }
  return { lanes };
})()`;

const census = (state) =>
  state.lanes.map((lane) => `${lane.id}:${lane.headerText}:${lane.cards}`).join("|");

/** Wait for a settled board: four identical censuses 700ms apart. */
async function settle(page, label) {
  await sleep(4000);
  let read = await page.evaluate(READ_LANES);
  let stable = 0;
  for (let attempt = 0; attempt < 40 && stable < 4; attempt += 1) {
    await sleep(700);
    const next = await page.evaluate(READ_LANES);
    stable = census(next) === census(read) && next.lanes.length > 0 ? stable + 1 : 0;
    read = next;
  }
  if (stable < 4) {
    throw new Error(`board never settled (${label}) at ${stable}/4: ${census(read)}`);
  }
  return read;
}

/** The app's own threshold and done stamps, read off its RPC traffic. */
async function appState(page) {
  return await page.evaluate(() => {
    const calls = window.__doneSweepRpc ?? [];
    const find = (method) => calls.filter((call) => call.url.endsWith(`/${method}`)).at(-1)?.body?.result;
    const config = find("sweep_config_get") ?? null;
    const direct = find("done_list");
    const board = find("board_state_get");
    const done = direct ?? board?.done ?? null;
    return {
      thresholdMs: config?.doneArchiveMs ?? null,
      idleThresholdMs: config?.idleArchiveMs ?? null,
      records: done?.records ?? null,
      doneCount: done?.doneIds?.length ?? null,
      now: Date.now(),
      rpcMethods: [...new Set(calls.map((call) => call.url.split("/").at(-1)))],
    };
  });
}

/** Per-id ages (in days) against the board's own records and clock. */
function agesOf(ids, state) {
  const out = [];
  for (const id of ids) {
    const iso = state.records?.[id]?.doneAt;
    if (typeof iso !== "string") {
      out.push({ id, ageDays: null, keep: state.records?.[id]?.keep === true });
      continue;
    }
    out.push({
      id,
      ageDays: (state.now - Date.parse(iso)) / 86_400_000,
      keep: state.records?.[id]?.keep === true,
    });
  }
  return out;
}

const round = (value) => (value === null ? null : Math.round(value * 100) / 100);

/** Age summary over one id set, split by the board's own threshold. */
function ageSummary(ids, state) {
  const thresholdDays = (state.thresholdMs ?? 0) / 86_400_000;
  const ages = agesOf(ids, state);
  const known = ages.filter((entry) => entry.ageDays !== null);
  const fresh = known.filter((entry) => entry.ageDays < thresholdDays);
  return {
    count: ids.length,
    withStamp: known.length,
    withoutStamp: ages.length - known.length,
    kept: known.filter((entry) => entry.keep).length,
    pastThreshold: known.filter((entry) => entry.ageDays >= thresholdDays).length,
    underThreshold: fresh.length,
    minAgeDays: known.length === 0 ? null : round(Math.min(...known.map((entry) => entry.ageDays))),
    maxAgeDays: known.length === 0 ? null : round(Math.max(...known.map((entry) => entry.ageDays))),
    underThresholdIds: fresh.map((entry) => ({ id: entry.id, ageDays: round(entry.ageDays) })),
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: VIEWPORT,
});

async function openPage(context, seedGroupBy) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.evaluateOnNewDocument(CAPTURE_RPC);
  if (seedGroupBy !== null) {
    await page.evaluateOnNewDocument((value) => {
      try {
        window.localStorage.setItem("focus-board:groupBy", value);
      } catch {
        /* storage unavailable: the run reads whatever view mounts */
      }
    }, seedGroupBy);
  }
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 60000 });
  return { page, errors };
}

/** The Focus view: Done lane header, pill proposal, armed selection, menu. */
async function focusView(context) {
  const { page, errors } = await openPage(context, null);
  const lanes = await settle(page, "focus");
  const state = await appState(page);
  const before = await page.evaluate(READ_DONE_LANE);
  const thresholdDays = (state.thresholdMs ?? 0) / 86_400_000;

  await page.evaluate(() => {
    document
      .querySelector('[data-column-id="done"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  });
  await sleep(500);
  await page.screenshot({ path: `${OUT_DIR}/01-focus-done-lane.png` });

  const armedClick = await page.evaluate(() => {
    const pill = document.querySelector('[data-column-id="done"] [data-sweep-button]');
    if (pill === null) return false;
    pill.click();
    return true;
  });
  await sleep(1200);
  const armed = await page.evaluate(READ_DONE_LANE);
  await page.screenshot({ path: `${OUT_DIR}/02-focus-done-armed.png` });

  const disarmedClick = await page.evaluate(() => {
    const cancel = document.querySelector('[data-column-id="done"] [data-sweep-cancel]');
    if (cancel === null) return false;
    cancel.click();
    return true;
  });
  await sleep(600);
  const after = await page.evaluate(READ_DONE_LANE);
  await page.screenshot({ path: `${OUT_DIR}/03-focus-done-disarmed.png` });

  const menuOpen = await page.evaluate(() => {
    const trigger = document.querySelector('[data-column-id="done"] [data-lane-menu-trigger]');
    if (trigger === null) return false;
    trigger.click();
    return true;
  });
  await sleep(500);
  const menu = await page.evaluate(READ_MENU);
  await page.screenshot({ path: `${OUT_DIR}/04-focus-done-lane-menu.png` });
  await page.keyboard.press("Escape");
  await page.close();

  const laneAges = ageSummary(before.cardIds, state);
  const armedAges = ageSummary(armed.highlightedIds, state);
  const armedSet = new Set(armed.highlightedIds);
  const oldInLane = agesOf(before.cardIds, state).filter(
    (entry) => entry.ageDays !== null && entry.ageDays >= thresholdDays,
  );
  return {
    lanes: lanes.lanes,
    thresholdDays: round(thresholdDays),
    lane: {
      label: before.label,
      laneCountHeader: before.laneCount,
      renderedCards: before.cardIds.length,
      pill: { text: before.pill?.text ?? null, label: before.pill?.label ?? null },
      ages: laneAges,
    },
    arm: {
      clicked: armedClick,
      pill: { text: armed.pill?.text ?? null, label: armed.pill?.label ?? null },
      highlighted: armed.highlightedIds.length,
      ages: armedAges,
      // Every card past the threshold that arming did NOT take (kept, a
      // live-child parent, a projection, or a snoozed thread).
      oldButNotArmed: oldInLane.filter((entry) => !armedSet.has(entry.id)).map((entry) => ({
        id: entry.id,
        ageDays: round(entry.ageDays),
      })),
      underThresholdArmed: armedAges.underThresholdIds,
    },
    disarm: {
      clicked: disarmedClick,
      highlightedAfter: after.highlightedIds.length,
      pill: after.pill?.text ?? null,
    },
    laneMenu: { opened: menuOpen, entries: menu.entries, carriesSweep: menu.entries.some((entry) => /sweep/i.test(entry)) },
    errors,
  };
}

/** The Parent view: the Done row rail's pill and its armed selection. */
async function parentView(context) {
  const { page, errors } = await openPage(context, "parent");
  await sleep(6000);
  const state = await appState(page);
  const thresholdDays = (state.thresholdMs ?? 0) / 86_400_000;
  const before = await page.evaluate(READ_DONE_ROW);
  await page.screenshot({ path: `${OUT_DIR}/05-parent-view.png` });

  let armed = null;
  let clicked = false;
  if (before.found && before.pill !== null) {
    clicked = await page.evaluate(() => {
      const pill = document.querySelector('[data-rail-row="done"] [data-sweep-button]');
      if (pill === null) return false;
      pill.click();
      return true;
    });
    await sleep(1200);
    armed = await page.evaluate(READ_DONE_ROW);
    await page.screenshot({ path: `${OUT_DIR}/06-parent-done-armed.png` });
    await page.evaluate(() => {
      document.querySelector('[data-rail-row="done"] [data-sweep-cancel]')?.click();
    });
    await sleep(400);
    await page.screenshot({ path: `${OUT_DIR}/07-parent-done-disarmed.png` });
  }
  await page.close();
  const pillCount = Number((before.pill?.text ?? "").replace(/\D/g, ""));
  return {
    thresholdDays: round(thresholdDays),
    rail: {
      railText: before.railText ?? null,
      lanes: before.laneCount ?? null,
      doneBands: before.doneBands ?? null,
      chippedCards: before.chippedCards ?? null,
      chipCounts: before.chipCounts ?? [],
      renderedCards: before.cardIds?.length ?? 0,
      pill: { text: before.pill?.text ?? null, label: before.pill?.label ?? null },
      ages: ageSummary(before.cardIds ?? [], state),
    },
    arm: armed === null
      ? { clicked, pill: null, highlighted: 0, ages: null }
      : {
          clicked,
          pill: { text: armed.pill?.text ?? null, label: armed.pill?.label ?? null },
          highlighted: armed.highlightedIds.length,
          ages: ageSummary(armed.highlightedIds, state),
          // The rail's candidate count minus the cards it actually lit: the
          // cards behind a non-locked lane's "+N more" chip are in the sweep
          // but have no rendered card to highlight.
          candidatesWithoutRenderedCard: Number.isFinite(pillCount)
            ? pillCount - armed.highlightedIds.length
            : null,
        },
    errors,
  };
}

const context = await browser.createBrowserContext();
let focus = null;
let parent = null;
let failure = null;
try {
  focus = await focusView(context);
  parent = await parentView(context);
} catch (error) {
  failure = String(error?.message ?? error);
} finally {
  await browser.close();
}

const evidence = {
  app: APP,
  viewport: VIEWPORT,
  capturedAt: new Date().toISOString(),
  declaredSettings: "bb plugin config focus-board (doneArchiveValue 2, doneArchiveUnit days)",
  focus,
  parent,
  failure,
};
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));

const brief = (summary) =>
  summary === null
    ? null
    : {
        count: summary.count,
        pastThreshold: summary.pastThreshold,
        underThreshold: summary.underThreshold,
        minAgeDays: summary.minAgeDays,
        maxAgeDays: summary.maxAgeDays,
      };
console.log("=== focus lanes ===");
for (const lane of focus?.lanes ?? []) console.log(JSON.stringify(lane));
console.log("=== focus done lane ===", JSON.stringify({
  laneCount: focus?.lane.laneCountHeader,
  rendered: focus?.lane.renderedCards,
  pill: focus?.lane.pill,
  ages: brief(focus?.lane.ages),
  thresholdDays: focus?.thresholdDays,
}));
console.log("=== focus armed ===", JSON.stringify({
  pill: focus?.arm.pill,
  highlighted: focus?.arm.highlighted,
  ages: brief(focus?.arm.ages),
  underThresholdArmed: focus?.arm.underThresholdArmed,
  oldButNotArmed: focus?.arm.oldButNotArmed?.length,
}));
console.log("=== focus disarm ===", JSON.stringify(focus?.disarm));
console.log("=== focus lane menu ===", JSON.stringify(focus?.laneMenu));
console.log("=== parent row ===", JSON.stringify({
  railText: parent?.rail.railText,
  rendered: parent?.rail.renderedCards,
  pill: parent?.rail.pill,
  ages: brief(parent?.rail.ages),
}));
console.log("=== parent armed ===", JSON.stringify({
  pill: parent?.arm.pill,
  highlighted: parent?.arm.highlighted,
  ages: brief(parent?.arm.ages),
  candidatesWithoutRenderedCard: parent?.arm.candidatesWithoutRenderedCard,
}));
console.log("=== errors ===", JSON.stringify({ focus: focus?.errors, parent: parent?.errors }));
console.log("=== failure ===", failure);
console.log("=== evidence ===", `${OUT_DIR}/evidence.json`);
process.exit(failure === null ? 0 : 1);
