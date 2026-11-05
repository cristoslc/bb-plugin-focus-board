/**
 * One-off probe: a STAGED load (the modeled profile's sidebarDelay alone) at
 * a small scale, dumping each console.error's argument payloads so the
 * "Maximum update depth" error's component stack is readable.
 */
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { child, base } = await startHarness(5475);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on("console", async (message) => {
  const parts = await Promise.all(
    message.args().slice(0, 4).map(async (handle) => {
      try {
        return await handle.jsonValue();
      } catch {
        return "<unreadable>";
      }
    }),
  );
  console.log(`[${message.type()}] ${message.text()} :: ${JSON.stringify(parts).slice(0, 3000)}`);
});
await page.goto(`${base}?scale=20&sidebarDelay=150`, { waitUntil: "domcontentloaded" });
await sleep(2500);
await browser.close();
child.kill();
