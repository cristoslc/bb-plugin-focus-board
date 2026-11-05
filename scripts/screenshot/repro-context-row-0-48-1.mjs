// Runtime probe for the pane-parity audit's Gap 10.3 — the pane's
// composer-context fallback row (components/pane-context-row.tsx), built
// against bb 0.46.1's collapsed composer footer
// (docs/composer-context-collapse-2026-10-16.md). The question: on bb
// 0.48.1, does the pane's embedded composer still paint NO project/checkout
// context at rest — the premise the fallback compensates for?
//
// bb 0.48.x rewrote the composer footer: the collapsed state now UNMOUNTS
// the footer (no more attribute-flip collapse), and the desktop editor
// starts expanded (`focusesEditorOnMount = !isPointerCoarse`), so on a
// desktop pane the host's full environment summary may now paint at rest —
// which would make the fallback dead code there, while a touch pane (editor
// starts collapsed → footer unmounted) may still show nothing.
//
// Drives the LIVE bb web UI in both viewports and reads, inside the open
// pane:
//   - the host footer (`[data-follow-up-composer-footer]`): mounted? and do
//     its project/checkout chips reach the eye (the paint walk the app
//     itself uses)?
//   - the pane's own fallback row (`[data-testid="pane-context-row"]`):
//     rendered or self-quieted?
// Screenshots land in docs/screenshots/repro-context-row-0-48-1/ (OUT_DIR
// overrides). Exit 0 always: this probe reports; the verdict is the
// reader's (the audit's decision lives in the docs).
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a board card's thread with a project + checkout environment.");
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/repro-context-row-0-48-1";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PAINT_WALK = `(function () {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (!pane) return null;
  const footer = pane.querySelector('[data-follow-up-composer-footer]');
  const chips = {};
  for (const chip of pane.querySelectorAll('[data-option-display]')) {
    const label = (chip.querySelector('.sr-only')?.textContent ?? '').trim();
    if (label.startsWith('Project:') || label.startsWith('Environment:') || label.startsWith('Checkout')) {
      chips[label] = paintable(chip);
    }
  }
  for (const chip of pane.querySelectorAll('[data-promptbox-hide-branch-compact]')) {
    chips['checkout-chip'] = paintable(chip);
  }
  return {
    footerMounted: footer !== null,
    footerBox: footer === null ? null : box(footer),
    chipsPainted: chips,
    fallbackRow: pane.querySelector('[data-testid="pane-context-row"]') !== null,
  };
  function paintable(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    let current = element.parentElement;
    for (let i = 0; i < 6 && current !== null; i++) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.opacity !== '' && Number(style.opacity) === 0) return false;
      const clipsY = style.overflowY !== '' && style.overflowY !== 'visible';
      const clipsX = style.overflowX !== '' && style.overflowX !== 'visible';
      if (clipsY || clipsX) {
        const clip = current.getBoundingClientRect();
        if ((clipsY && (rect.y < clip.y - 0.5 || rect.y + rect.height > clip.y + clip.height + 0.5)) ||
            (clipsX && (rect.x < clip.x - 0.5 || rect.x + rect.width > clip.x + clip.width + 0.5))) return false;
      }
      current = current.parentElement;
    }
    return true;
  }
  function box(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
})();`;

async function probe(browser, viewport, label) {
  const page = await browser.newPage();
  if (viewport.touch) {
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "hover", value: "none" },
        { name: "pointer", value: "coarse" },
      ],
    });
  }
  await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: viewport.touch, hasTouch: viewport.touch });
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate((id) => {
    const target = document.querySelector(`[data-thread-card="${id}"]`);
    target?.scrollIntoView({ block: "center", inline: "center" });
  }, THREAD_ID);
  await new Promise((r) => setTimeout(r, 800));
  const box = await page.evaluate((id) => {
    const target = document.querySelector(`[data-thread-card="${id}"]`);
    if (!target) return null;
    const r = target.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 150), y: r.y + Math.min(r.height / 2, 40) };
  }, THREAD_ID);
  if (!box) { console.error(`${label}: board card not found`); await page.close(); return; }
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 5000));
  // Settle twice: the app's own probe waits 300ms of quiet — this reads well
  // after the composer's first paint.
  await new Promise((r) => setTimeout(r, 1500));
  const state = await page.evaluate(PAINT_WALK);
  console.log(`${label}:`, JSON.stringify(state));
  await page.screenshot({ path: `${OUT_DIR}/context-row-${label}.png` });
  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--disable-gpu", "--disable-dev-shm-usage"],
});
await probe(browser, { width: 1600, height: 1200, touch: false }, "desktop");
await probe(browser, { width: 390, height: 844, touch: true }, "phone");
await browser.close();
