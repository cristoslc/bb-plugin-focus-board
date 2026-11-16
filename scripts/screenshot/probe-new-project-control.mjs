// Runtime probe for the New Thread dialog's New project control against the
// LIVE bb app: bb 0.49.0's `PluginNewThreadComposer` now hands the host
// composer a `createProject` capability (PluginNewThreadComposer.tsx:85,
// "New project in experimental_NewThreadComposer", bb CHANGELOG 0.49.0
// Plugins), so the pickers row renders bb's own "New project" entry. The
// board shipped its own floating button for that gap (issue #355, get-bb/bb
// #7015; components/new-thread-modal.tsx + lib/composer-row-anchor.ts), so
// the dialog may now carry two.
//
// Reads the dialog and reports every "New project" control it paints, with
// which side owns it: the host's `[data-promptbox-project-control]` picker
// menu entry, or the plugin's own row-anchored icon button.
//
// Usage: node scripts/screenshot/probe-new-project-control.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR. Exits 1 when the dialog cannot be
// opened; the verdict line is the answer otherwise.
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-new-project-control";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const READ_DIALOG = `(function () {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) return { dialogOpen: false };
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const pluginButtons = [...dialog.querySelectorAll('button[aria-label="New project"]')]
    .filter(visible)
    .map((button) => ({
      side: 'plugin',
      text: (button.textContent ?? '').trim(),
      anchored: button.getAttribute('data-new-thread-footer-anchor') !== null ||
        getComputedStyle(button).position === 'absolute',
    }));
  const picker = dialog.querySelector('[data-promptbox-project-control]');
  const footer = dialog.querySelector('[data-new-thread-footer]');
  return {
    dialogOpen: true,
    pluginButtons,
    hostProjectPicker: picker === null ? null : {
      label: (picker.getAttribute('aria-label') ?? picker.textContent ?? '').trim(),
      paintsCreate: /new project/i.test(picker.textContent ?? ''),
    },
    footerRowMounted: footer !== null,
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
// The host shell paints first and the plugin panel mounts after it; finding
// the button too early falls through to bb's own sidebar "New thread".
await page
  .waitForSelector('[data-bb-plugin="focus-board"]', { timeout: 30000 })
  .catch(() => {
    console.error("the focus-board plugin panel never mounted");
  });
await new Promise((r) => setTimeout(r, 3000));
// bb's own sidebar carries a "New thread" button too, and clicking it leaves
// the plugin panel entirely, so the board's toolbar button is the one inside
// this plugin's panel root — never a document-wide match.
const target = await page.evaluate(() => {
  const root = document.querySelector('[data-bb-plugin="focus-board"]');
  if (root === null) return null;
  const button = [...root.querySelectorAll("button")].find(
    (candidate) => (candidate.textContent ?? "").trim() === "New thread",
  );
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
if (target === null) {
  console.error("the board's own New thread button was not found inside the plugin panel");
  await browser.close();
  process.exit(1);
}
await page.mouse.click(target.x, target.y);
let opened = false;
for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
  opened = await page
    .waitForSelector('[role="dialog"]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await page.mouse.click(target.x, target.y);
  }
}
if (!opened) {
  await page.screenshot({ path: `${OUT_DIR}/dialog-not-opened.png` });
  console.error("the New thread dialog did not open");
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 3000));
const state = await page.evaluate(READ_DIALOG);
await page.screenshot({ path: `${OUT_DIR}/new-thread-dialog.png` });
// The host's New project entry lives inside the project picker's menu, so a
// closed menu cannot show it. Open the picker and read again.
const menuOpen = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const picker = dialog?.querySelector('[data-promptbox-project-control]');
  if (!picker) return false;
  picker.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1200));
const menuState = await page.evaluate(`(function () {
  // The picker's list is a cmdk command menu; older shapes use role=menuitem.
  const items = [
    ...document.querySelectorAll('[cmdk-item], [role="menuitem"], [role="option"]'),
  ];
  const labels = [];
  for (const item of items) {
    const text = (item.textContent ?? '').trim();
    if (/new project/i.test(text)) labels.push(text.slice(0, 60));
  }
  return {
    menuOpen: ${menuOpen},
    menuItemCount: items.length,
    createEntries: [...new Set(labels)],
  };
})()`);
await page.screenshot({ path: `${OUT_DIR}/new-thread-project-menu.png` });
console.log(
  JSON.stringify(
    {
      ...state,
      projectMenu: menuState,
      verdict: {
        pluginNewProjectControls: state.pluginButtons?.length ?? 0,
        hostPickerPresent: state.hostProjectPicker !== null,
        hostCreateEntry: menuState.createEntries,
        duplicatesOnHost: (state.pluginButtons?.length ?? 0) > 0 && menuState.createEntries.length > 0,
      },
    },
    null,
    2,
  ),
);
await browser.close();
