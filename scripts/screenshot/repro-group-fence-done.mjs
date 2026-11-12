/**
 * Group fences in the Done lane probe (thr_e8xdgg5dgq): the dashed
 * feature-group frames that wrap a group's slice in every lane now wrap its
 * done members' slice in Done too (the operator ruling 2026-11-11,
 * dec_yhouj8o5tyjh). This probe is the surface frame for that ruling: it
 * marks a member done through the card's own checkbox and reads the frames
 * off the DOM, so a regression that drops Done from the box plan fails here
 * as well as in the jsdom suite.
 *
 * Drives the `?overview=1` fixture (its four real groups live in
 * `SIM_OVERVIEW_GROUPS`) twice — once on the Attention (status) board, once on
 * the Group board, where each group owns a column — and in each pass:
 *
 * 1. snapshots every lane's frames and cards,
 * 2. marks `thr_ov_work_member` done through the card's own two-click
 *    checkbox (the operator's gesture): a "Release 1.0" member in Working, so
 *    the group still has live members in other lanes afterward,
 * 3. snapshots again,
 * 4. marks `thr_ov_triage` done — the "Triage" GROUP OF ONE, the sharp case:
 *    if done members fall out of the box plan, the group renders no frame
 *    anywhere while its card is still on the board, in Done.
 *
 * Run once vite is up: `npx vite --config scripts/screenshot/vite.config.ts`
 * then `node scripts/screenshot/repro-group-fence-done.mjs`. Exit 0 means the
 * Done lane frames its done slice and keeps the live family's projection card
 * outside it.
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-group-fence-done/", import.meta.url).pathname;

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = await browser.newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err}`));

/**
 * Every lane's frames plus its card inventory, read off the DOM the operator
 * sees. A frame is a `[data-group-box]` slot (the dashed container); nothing
 * about a card inside it is inferred.
 */
const snapshot = () =>
  page.evaluate(() => {
    const lanes = [...document.querySelectorAll('section[aria-label]')].map((section) => {
      const label = section.getAttribute("aria-label") ?? "";
      const laneName = label.split(",")[0]?.trim() ?? label;
      const frames = [...section.querySelectorAll("[data-group-box]")].map((box) => ({
        groupId: box.getAttribute("data-group-box"),
        name:
          box.querySelector("[data-group-box-label]")?.textContent?.trim() ??
          box.getAttribute("data-collapsed-group") ??
          null,
        members: [...box.querySelectorAll("[data-thread-card]")].map((card) =>
          card.getAttribute("data-thread-card"),
        ),
      }));
      const cards = [...section.querySelectorAll("[data-thread-card]")].map((card) => ({
        id: card.getAttribute("data-thread-card"),
        boxed: card.closest("[data-group-box]") !== null,
        boxId: card.closest("[data-group-box]")?.getAttribute("data-group-box") ?? null,
      }));
      return { lane: laneName, frames, cards };
    });
    return {
      lanes,
      frames: lanes.flatMap((lane) =>
        lane.frames.map((frame) => ({ lane: lane.lane, ...frame })),
      ),
    };
  });

/** The card's own two-click Mark Done checkbox: arm, then confirm. */
async function markDone(threadId) {
  const found = await page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    const checkbox = card?.querySelector("[data-done-checkbox]");
    if (!checkbox) return false;
    checkbox.click();
    return true;
  }, threadId);
  if (!found) throw new Error(`no done checkbox on ${threadId}`);
  await sleep(250);
  await page.evaluate((id) => {
    document.querySelector(`[data-thread-card="${id}"] [data-done-checkbox]`)?.click();
  }, threadId);
  await sleep(1400);
}

const assertions = [];

function report(tag, label, snap, ids) {
  console.log(`\n=== ${tag} · ${label}`);
  for (const frame of snap.frames) {
    console.log(
      `  frame ${frame.groupId} (${frame.name}) in ${frame.lane} → ${frame.members.join(", ") || "(no cards)"}`,
    );
  }
  for (const id of ids) {
    const holders = snap.lanes.filter((lane) => lane.cards.some((card) => card.id === id));
    for (const lane of holders) {
      const card = lane.cards.find((candidate) => candidate.id === id);
      console.log(
        `  card ${id} in ${lane.lane} → ${card.boxed ? `inside frame ${card.boxId}` : "standalone (no frame)"}`,
      );
    }
    if (holders.length === 0) console.log(`  card ${id} renders nowhere`);
  }
}

const check = (tag, name, pass) => {
  assertions.push({ tag, name, pass });
};

async function run(tag, query) {
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
  await sleep(1200);

  const before = await snapshot();
  await page.screenshot({ path: `${OUT}${tag}-before.png`, timeout: 20_000 });

  await markDone("thr_ov_work_member");
  const afterMember = await snapshot();
  await page.screenshot({ path: `${OUT}${tag}-after-member-done.png`, timeout: 20_000 });

  await markDone("thr_ov_triage");
  const afterGroupOfOne = await snapshot();
  await page.screenshot({ path: `${OUT}${tag}-after-group-of-one-done.png`, timeout: 20_000 });

  const doneLane = await page.$('section[aria-label^="Done"]');
  if (doneLane) await doneLane.screenshot({ path: `${OUT}${tag}-done-lane.png` });

  report(tag, "BEFORE (no member done)", before, ["thr_ov_work_member", "thr_ov_triage"]);
  report(tag, "AFTER Release 1.0 member marked done", afterMember, ["thr_ov_work_member"]);
  report(tag, "AFTER the Triage group-of-one member marked done", afterGroupOfOne, ["thr_ov_triage"]);

  check(
    tag,
    "before: the Release 1.0 frame wraps its member",
    before.frames.some(
      (frame) => frame.groupId === "grp_release" && frame.members.includes("thr_ov_work_member"),
    ),
  );
  check(
    tag,
    "after: the done member's card is in the Done lane",
    afterMember.lanes.some(
      (lane) => lane.lane === "Done" && lane.cards.some((card) => card.id === "thr_ov_work_member"),
    ),
  );
  check(
    tag,
    "after: the Done lane's frame wraps the group's done member",
    afterMember.frames.some(
      (frame) =>
        frame.lane === "Done" &&
        frame.groupId === "grp_release" &&
        frame.members.includes("thr_ov_work_member"),
    ),
  );
  check(
    tag,
    "before: the Triage group-of-one renders exactly one frame, in the member's own lane",
    before.frames.filter((frame) => frame.groupId === "grp_triage").length === 1 &&
      before.frames.find((frame) => frame.groupId === "grp_triage")?.lane ===
        before.lanes.find((lane) => lane.cards.some((card) => card.id === "thr_ov_triage"))?.lane,
  );
  check(
    tag,
    "after: the Triage card is in the Done lane",
    afterGroupOfOne.lanes.some(
      (lane) => lane.lane === "Done" && lane.cards.some((card) => card.id === "thr_ov_triage"),
    ),
  );
  check(
    tag,
    "after: the Triage group-of-one keeps its frame in the Done lane",
    afterGroupOfOne.frames.some(
      (frame) =>
        frame.lane === "Done" &&
        frame.groupId === "grp_triage" &&
        frame.members.includes("thr_ov_triage"),
    ),
  );
  check(
    tag,
    "after: the Triage group renders exactly one frame, in Done",
    afterGroupOfOne.frames.filter((frame) => frame.groupId === "grp_triage").length === 1,
  );
  // The projection rule: a live parent's Done projection card is the family's
  // Done half, not the group's done thread, so it keeps its own slot and the
  // frame holds the group's done members only.
  const doneFrames = afterGroupOfOne.frames.filter((frame) => frame.lane === "Done");
  check(
    tag,
    "after: the live parent's Done projection card stays outside the group's Done frame",
    doneFrames.some((frame) => frame.groupId === "grp_release") &&
      doneFrames.every((frame) => !frame.members.includes("thr_ov_release_parent")),
  );
}

await run("status", "?overview=1");
await run("group", "?overview=1&groupBy=group");

console.log("\n=== assertions");
for (const assertion of assertions) {
  console.log(`  ${assertion.pass ? "PASS" : "FAIL"}  [${assertion.tag}] ${assertion.name}`);
}
console.log(`\nframes → ${OUT}`);

await browser.close();
process.exitCode = assertions.every((assertion) => assertion.pass) ? 0 : 1;
