// The New project button's row placement: repro, audit, and proof frames.
//
// The shipped placement the operator reported (the icon button stacked
// BELOW bb's pickers row — "No project ⌄ … Default ⌄ Full Access ⌄" — with
// an empty dead band under it) versus the fixed one: the dialog's own
// plugin-owned button absolute-positions ON the row's line
// (lib/composer-row-anchor), and nothing stays in flow below the composer.
//
// The audit, against the harness (whose mock composer replicates bb's
// structural row verbatim — the row hook, class recipe, and pickers):
//   1. the floating button's right edge meets the row's content start
//      (the boundary the first picker's click area begins at), centered
//      on the row's line;
//   2. the button's box intersects NONE of the three pickers' boxes, and
//      document.elementFromPoint over each picker's center hits the
//      picker (the pointer-events half of the audit); the button's own
//      center hits the button;
//   3. no in-flow footer at rest — [data-new-project-footer] absent — and
//      the dialog's bottom edge sits one padding above the row (the dead
//      band gone);
//   4. the typical flow: clicking the button runs the app's picked-folder
//      hand-off (mock hosts.pickFolder → fixed folder), the create
//      carries bb's typical payload (the folder's own name + the
//      local_path source), and the composer's picker then reads the
//      created project's name.
// The other two pick answers the flow must survive:
//   ?folderPick=cancel       — a null pick rests the dialog, no create;
//   ?folderPick=unavailable  — the picker's refusal arms the inline name
//                              field with the reason shown.
// Exits non-zero on any violation. Frames land in
// docs/screenshots/new-project-row/. Run the vite harness first
// (scripts/screenshot/README): npx vite --config scripts/screenshot/vite.config.ts
// then node scripts/screenshot/repro-new-project-row.mjs; honors
// CHROME_PATH, HARNESS_URL, and OUT_DIR.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const HARNESS_URL = process.env.HARNESS_URL ?? "http://localhost:5173/";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT_DIR ?? "docs/screenshots/new-project-row";

const PICKED_FOLDER = "/Users/cristos/code/auth-rework-fixture";
const PICKED_NAME = "auth-rework-fixture";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars"],
});

mkdirSync(OUT, { recursive: true });
const failures = [];

/** The dialog's audit numbers, read in the page. */
async function audit(page, label) {
  const evidence = await page.evaluate(() => {
    const option = document.querySelector('[data-new-project-option=""]');
    if (option === null) return { error: "no New project option rendered" };
    const wrap = option.closest('[data-composer-wrap=""]');
    if (wrap === null) return { error: "composer wrapper attribute missing" };
    const row = wrap.querySelector('[data-new-thread-footer=""]');
    if (row === null) return { error: "no pickers row inside the wrapper" };
    const pickerNames = [
      "data-mock-project-picker",
      "data-mock-environment-picker",
      "data-mock-permission-picker",
    ];
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rowBox = rect(row);
    const optionBox = rect(option);
    const padding = Number.parseFloat(getComputedStyle(row).paddingLeft);
    const contentStart = rowBox.left + padding;
    const pickers = pickerNames
      .map((name) => {
        const el = row.querySelector(`[${name}=""]`);
        if (el === null) return null;
        const box = rect(el);
        const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const hit = document.elementFromPoint(center.x, center.y);
        return {
          name,
          box,
          hitIsInsidePicker: hit !== null && (hit === el || el.contains(hit)),
        };
      })
      .filter(Boolean);
    const optionCenter = { x: optionBox.left + optionBox.width / 2, y: optionBox.top + optionBox.height / 2 };
    const optionHit = document.elementFromPoint(optionCenter.x, optionCenter.y);
    const dialog = option.closest('[role="dialog"]') ?? wrap.closest('[role="dialog"]');
    const overlaps = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      option: { box: optionBox, ariaLabel: option.getAttribute("aria-label"), isInsideWrapper: option.parentElement === wrap },
      row: { box: rowBox, contentStart, paddingLeft: padding },
      pickers,
      optionHitIsSelf: optionHit !== null && (optionHit === option || option.contains(optionHit)),
      flowFooterAbsentAtRest: document.querySelector('[data-new-project-footer=""]') === null,
      dialog: dialog === null
        ? null
        : {
            box: rect(dialog),
            computedPaddingBottom: Number.parseFloat(getComputedStyle(dialog).paddingBottom),
          },
      overlaps_: pickers.map((p) => overlaps(optionBox, p.box)),
    };
  });
  if (evidence.error !== undefined) {
    failures.push(`${label}: ${evidence.error}`);
    return evidence;
  }
  // 1. the row's line, at the row's content start
  if (evidence.option.ariaLabel !== "New project") {
    failures.push(`${label}: the option's accessible name changed`);
  }
  const rightEdge = evidence.option.box.left + evidence.option.box.width;
  if (Math.abs(rightEdge - evidence.row.contentStart) > 0.5) {
    failures.push(
      `${label}: the button's right edge ${rightEdge.toFixed(1)} misses the row's content start ${evidence.row.contentStart.toFixed(1)}`,
    );
  }
  const rowCenter = evidence.row.box.top + evidence.row.box.height / 2;
  const optionCenterY = evidence.option.box.top + evidence.option.box.height / 2;
  if (Math.abs(rowCenter - optionCenterY) > 1) {
    failures.push(
      `${label}: the button is not on the row's line (center ${optionCenterY.toFixed(1)} vs row center ${rowCenter.toFixed(1)})`,
    );
  }
  // 2. no overlap with any picker's click area; the point audits
  for (const picker of evidence.pickers) {
    const overlap = evidence.overlaps_[evidence.pickers.indexOf(picker)];
    if (overlap) failures.push(`${label}: the button covers ${picker.name}'s click area`);
    if (!picker.hitIsInsidePicker) failures.push(`${label}: a point over ${picker.name}'s center does not hit the picker`);
  }
  if (!evidence.optionHitIsSelf) failures.push(`${label}: a point over the button's center does not hit the button`);
  // 3. the dead band gone
  if (!evidence.flowFooterAbsentAtRest) failures.push(`${label}: an in-flow footer still sits below the composer at rest`);
  if (evidence.dialog !== null) {
    const dead = evidence.dialog.box.bottom - evidence.row.box.bottom - evidence.dialog.computedPaddingBottom;
    if (Math.abs(dead) > 2) {
      failures.push(
        `${label}: ${dead > 0 ? "extra content" : "content"} spans ${Math.abs(dead).toFixed(1)}px beyond the dialog's bottom padding band before the dialog's edge`,
      );
    }
  }
  return evidence;
}

async function openDialog(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "New thread",
    );
    if (!button) throw new Error("the toolbar's New thread button not found");
    button.click();
  });
  await page.waitForSelector('[data-new-thread-footer=""]', { timeout: 10_000 });
  await page.waitForSelector('[data-new-project-option=""]', { timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function closeDialog(page) {
  // The dialog's X control's "Close" name lives in an sr-only span (the
  // shadcn close button carries no aria-label attribute).
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('[role="dialog"] span.sr-only')].find(
      (el) => el.textContent === "Close",
    )?.closest("button");
    if (close) close.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// ── Pass 1: wide desktop, dark, the placement + pointer audit + the flow ──
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
await page.goto(`${HARNESS_URL}?demo=1`, { waitUntil: "networkidle0" });
await new Promise((resolve) => setTimeout(resolve, 1000));
await openDialog(page);
const wideDark = await audit(page, "wide dark");
await page.screenshot({
  path: `${OUT}/dialog-wide-dark.png`,
  clip: await dialogClip(page),
});

/** The dialog's clip with a small frame for theme/row context. */
async function dialogClip(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const r = dialog.getBoundingClientRect();
    const pad = 16;
    return {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: Math.min(window.innerWidth, r.width + pad * 2),
      height: Math.min(window.innerHeight, r.height + pad * 2),
    };
  });
}

// The typical flow through the mock's fixed pick: the create + the seed.
const flowEvidence = await page.evaluate((picked) => {
  const option = document.querySelector('[data-new-project-option=""]');
  if (option === null) return { error: "option vanished before the flow" };
  option.click();
  return { clicked: true, picked };
}, PICKED_FOLDER);
await new Promise((resolve) => setTimeout(resolve, 600));
const flowAfter = await page.evaluate((folder) => {
  const picker = document.querySelector('[data-mock-project-picker=""]');
  const footer = document.querySelector('[data-new-project-footer=""]');
  return {
    pickerLabel: picker?.textContent ?? null,
    footerAbsentAfterCreate: footer === null,
    folder,
  };
}, PICKED_FOLDER);
if (typeof flowEvidence.error === "string") {
  failures.push(`flow: ${flowEvidence.error}`);
} else if (!flowAfter.pickerLabel?.includes(flowAfter.folder.split("/").pop())) {
  failures.push(`flow: the composer's picker reads "${flowAfter.pickerLabel}", not the created project`);
} else if (!flowAfter.footerAbsentAfterCreate) {
  failures.push("flow: the dialog grew an in-flow footer after the picked create");
}
// The strongest "part of the row" frame: the button beside the picker now
// reading the created project's name, the geometry audited against the
// GROWN label (the row's left boundary the placement holds at).
const wideDarkAfterPick = await audit(page, "wide dark after the picked create");
await page.screenshot({ path: `${OUT}/dialog-wide-dark-after-pick.png`, clip: await dialogClip(page) });

// Reopen for the remaining frames: reset the dialog state.
await closeDialog(page);

// ── Pass 2: light theme, wide ──
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await new Promise((resolve) => setTimeout(resolve, 400));
await openDialog(page);
const wideLight = await audit(page, "wide light");
await page.screenshot({ path: `${OUT}/dialog-wide-light.png`, clip: await dialogClip(page) });
await closeDialog(page);
await page.evaluate(() => document.documentElement.classList.add("dark"));

// ── Pass 3: narrow (compact drawer), dark and light ──
await page.setViewport({ width: 600, height: 900, deviceScaleFactor: 2 });
await new Promise((resolve) => setTimeout(resolve, 400));
await openDialog(page);
const narrowDark = await page.evaluate(() => {
  const option = document.querySelector('[data-new-project-option=""]');
  const footer = document.querySelector('[data-new-project-footer=""]');
  const row = document.querySelector('[data-new-thread-footer=""]');
  return {
    optionPresent: option !== null,
    inFlowFooterPresent: footer !== null,
    optionInFooter: option !== null && footer !== null && footer.contains(option),
    optionHasInlinePlacement: option === null ? null : option.style.left !== "" && option.style.top !== "",
    rowPresent: row !== null,
  };
});
await page.screenshot({ path: `${OUT}/dialog-narrow-dark.png` });
if (!narrowDark.optionPresent || !narrowDark.inFlowFooterPresent || !narrowDark.optionInFooter) {
  failures.push("narrow dark: the stacked fallback shape is missing");
}
if (narrowDark.optionHasInlinePlacement === true) {
  failures.push("narrow dark: the option floats at a viewport that cannot hold it beside the pickers");
}
await closeDialog(page);

await page.evaluate(() => document.documentElement.classList.remove("dark"));
await new Promise((resolve) => setTimeout(resolve, 300));
await openDialog(page);
const narrowLight = await page.evaluate(() => ({
  optionPresent: document.querySelector('[data-new-project-option=""]') !== null,
  inFlowFooterPresent: document.querySelector('[data-new-project-footer=""]') !== null,
}));
await page.screenshot({ path: `${OUT}/dialog-narrow-light.png` });
if (!narrowLight.optionPresent || !narrowLight.inFlowFooterPresent) {
  failures.push("narrow light: the stacked fallback shape is missing");
}

// ── Pass 4: the picker's other two answers, wide ──
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
await Promise.all([page.evaluate(() => document.documentElement.classList.add("dark"))]);
await closeDialog(page);
for (const mode of ["cancel", "unavailable"]) {
  await page.goto(`${HARNESS_URL}?demo=1&folderPick=${mode}`, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 800));
  await openDialog(page);
  const answer = await page.evaluate(() => {
    const option = document.querySelector('[data-new-project-option=""]');
    if (option === null) return { error: "no option" };
    option.click();
    return { clicked: true };
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const settled = await page.evaluate(() => {
    const option = document.querySelector('[data-new-project-option=""]');
    const footer = document.querySelector('[data-new-project-footer=""]');
    const field = document.querySelector('[aria-label="New project name"]');
    const error = document.querySelector('[data-new-project-error=""]');
    return {
      optionPresent: option !== null,
      footerPresent: footer !== null,
      fieldArmed: field !== null,
      errorText: error?.textContent ?? null,
    };
  });
  if (typeof answer.error === "string") {
    failures.push(`folderPick=${mode}: ${answer.error}`);
  } else if (mode === "cancel") {
    if (!settled.optionPresent || settled.fieldArmed || settled.errorText !== null) {
      failures.push(`folderPick=${mode}: a cancelled pick did not rest the dialog cleanly`);
    }
  } else if (!settled.fieldArmed || settled.errorText === null || !settled.errorText.includes("Folder picker unavailable")) {
    failures.push(`folderPick=${mode}: the refused pick did not arm the name field with the reason (error: ${settled.errorText})`);
  }
  await page.screenshot({ path: `${OUT}/dialog-folderpick-${mode}.png` });
  await closeDialog(page);
}

await browser.close();

const evidence = {
  wideDark,
  wideDarkAfterPick,
  wideLight,
  narrow: { dark: narrowDark, light: narrowLight },
  flowAfterCreate: flowAfter,
  failures,
};
writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));

if (failures.length > 0) {
  console.error("FAILURES:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("audit clean: the New project button sits on the pickers row's line, the dead band is gone, the pickers stay clickable, and the typical flow creates from the picked folder.");
console.log(JSON.stringify({ wideDark, wideLight, narrow: { dark: narrowDark, light: narrowLight }, flowAfterCreate: flowAfter }, null, 2));
