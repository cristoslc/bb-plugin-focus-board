// Runtime probe for the pane-parity audit's Gap 10.2 — the pane's
// touch-reveal CSS overrides (Focus Board #296, fixed by workaround in
// #297 against bb 0.47.1). The question: on bb 0.48.1, does the collision
// the overrides compensate still exist, and do the overrides still do the
// work?
//
// Drives the LIVE bb web UI (the collision lives between the host's global
// utilities sheet and bb's runtime-scoped plugin sheet; the repo's mock-SDK
// harness does not apply the runtime scoping). Mechanism:
//
//   1. Stage a queued message (bb thread queue create <id> "probe") so the
//      pane's composer shows the queued row with its host "…" actions
//      control.
//   2. Emulate a touch phone (hover: none + pointer: coarse, 390x844), open
//      the pane, expand the queued-messages drawer.
//   3. Measure the actions control: computed opacity and pointer-events,
//      plus a real hit test. With the pane's overrides in place the control
//      is visible and tappable (the #297 workaround at work on 0.48.1).
//   4. CASCADE SURGERY: from the plugin-scoped sheet, delete every rule the
//      overrides contributed (the `[@media(hover:none)]` reveal utilities);
//      re-measure. If the control flips back to invisible and untappable,
//      the host scoping on 0.48.1 still lets the plugin's plain `.opacity-0`
//      outrank the host's touch-reveal utility — the overrides still earn
//      their place.
//
// Exits 0 when the with-overrides/without-overrides pair reads exactly
// (tappable, then untappable); anything else exits 1 and prints the readings.
//
// Stage the queued row first and delete it after:
//   bb thread queue create thr_x "probe" && node
//   scripts/screenshot/repro-touch-reveal-cascade.mjs && bb thread queue
//   delete thr_x <messageId>
// Env: BB_APP (default the local board URL), THREAD_ID (default the code-pane
// probe thread), CHROME_PATH, OUT_DIR (default
// docs/screenshots/repro-touch-reveal-cascade).
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a board card's thread with a queued message.");
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/repro-touch-reveal-cascade";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=390,844", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
// This puppeteer build's emulateMediaFeatures does not support hover/pointer;
// drive CDP's own setEmulatedMedia for the touch-phone media state.
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setEmulatedMedia", {
  features: [
    { name: "hover", value: "none" },
    { name: "pointer", value: "coarse" },
  ],
});
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));

const cardBox = await page.evaluate((id) => {
  const target = document.querySelector(`[data-thread-card="${id}"]`);
  if (!target) return null;
  target.scrollIntoView({ block: "center", inline: "center" });
  const r = target.getBoundingClientRect();
  return { x: r.x + Math.min(r.width / 2, 150), y: r.y + Math.min(r.height / 2, 40) };
}, THREAD_ID);
if (!cardBox) { console.error("board card not found:", THREAD_ID); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 800));
await page.mouse.click(cardBox.x, cardBox.y);
await new Promise((r) => setTimeout(r, 4000));

// The queued-messages collapsed bar is host markup: expand to the drawer.
const toggled = await page.evaluate(() => {
  const bar = [...document.querySelectorAll('button[aria-label="Toggle queued messages"]')].pop();
  if (bar) { bar.click(); return true; }
  return false;
});
await new Promise((r) => setTimeout(r, 900));
console.log("queue drawer toggled:", toggled);

const measure = () => page.evaluate(() => {
  const control = [...document.querySelectorAll('[aria-label^="Queued message"]')].find((el) =>
    (el.getAttribute("aria-label") ?? "").includes("actions"),
  );
  if (!control) return { present: false };
  const styled = getComputedStyle(control);
  const rect = control.getBoundingClientRect();
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(midX, midY);
  return {
    present: true,
    opacity: styled.opacity,
    pointerEvents: styled.pointerEvents,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    hitIsSelfOrChild: hit !== null && (hit === control || control.contains(hit)),
  };
});

const withOverrides = await measure();
console.log("WITH the pane's touch-reveal overrides:", JSON.stringify(withOverrides));
await page.screenshot({ path: `${OUT_DIR}/pane-queue-with-overrides.png` });

// Cascade surgery: strip the plugin sheet's hover:none reveal rules — the
// ones the pane re-emits (issue #297). bb scopes and layers the plugin CSS
// before serving it (`@layer utilities` under a `@media`-nested surface), so
// the walk recurses through layer/media groupings inside every sheet
// (adopted sheets included) and deletes the hover:none media blocks whose
// body carries a hover\:none reveal selector.
const removed = await page.evaluate(() => {
  let removedRules = 0;
  const walkRules = (rules) => {
    for (const rule of Array.from(rules)) {
      if (rule.cssRules !== undefined) walkRules(rule.cssRules);
      const sel = rule.selectorText ?? "";
      if (sel.includes("data-bb-plugin") || sel.includes("data-bb-plugin-root")) {
        pluginScoped = true;
      }
    }
  };
  let pluginScoped = false;
  const deleteHoverNone = (container) => {
    const rules = Array.from(container.cssRules);
    rules.forEach((rule, index) => {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes("hover: none")) {
        const inner = Array.from(rule.cssRules);
        if (inner.some((r) => (r.selectorText ?? "").includes("hover\\:none"))) {
          container.deleteRule(index);
          removedRules += 1;
        }
        return;
      }
      if (rule.cssRules !== undefined) deleteHoverNone(rule);
    });
  };
  const sheets = [
    ...Array.from(document.styleSheets),
    ...Array.from(document.adoptedStyleSheets ?? []),
  ];
  for (const sheet of sheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    pluginScoped = false;
    walkRules(rules);
    if (!pluginScoped) continue;
    deleteHoverNone(sheet);
  }
  return removedRules;
});
console.log("media(hover:none) rules removed from the plugin-scoped sheet:", removed);

const withoutOverrides = await measure();
console.log("WITH the overrides stripped:", JSON.stringify(withoutOverrides));
await page.screenshot({ path: `${OUT_DIR}/pane-queue-overrides-stripped.png` });

const revealed = withOverrides.present && withOverrides.opacity === "1" &&
  withOverrides.pointerEvents === "auto" && withOverrides.hitIsSelfOrChild;
const broken = withoutOverrides.present && (
  withoutOverrides.opacity !== "1" || withoutOverrides.pointerEvents !== "auto"
);
console.log(revealed
  ? "the overrides reveal the control on bb 0.48.1 (tap path works)."
  : "WARNING: the control is not tappable even WITH the overrides — re-check #296's fix.");
console.log(broken
  ? "stripping the overrides breaks the control: the collision premise still holds on bb 0.48.1 — KEEP the overrides."
  : "stripping the overrides changed nothing visible: re-check the premise; the overrides may be dead.");

await browser.close();
process.exit(revealed && broken ? 0 : 1);
