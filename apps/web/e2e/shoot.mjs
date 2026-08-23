/**
 * Visual QA capture — design spec §11.
 *
 *   node qa/shoot.mjs <label> [--url http://localhost:3000] [--reduced] [--full]
 *
 * Writes e2e/shots/<label>-desktop.png (1440x900) and <label>-mobile.png (390x844).
 * --full captures the whole scrollable page instead of the viewport.
 * --reduced emulates prefers-reduced-motion: reduce.
 *
 * Exists so that "the easing matches the spec" can be checked by looking,
 * not asserted.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "shot";
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const url = opt("url", "http://localhost:3000");
const fullPage = flag("full");
const reduced = flag("reduced");
const settle = Number(opt("settle", fullPage ? "6000" : "5000"));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

// resolve against THIS file, not the cwd — otherwise running it from the
// repo root scatters screenshots into a stray top-level e2e/shots directory
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "shots");
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  if (fullPage) {
    // walk the page so scroll-driven entrances have all fired
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
  }

  await page.waitForTimeout(settle);

  const suffix = `${reduced ? "-reduced" : ""}${fullPage ? "-full" : ""}`;
  const file = path.join(SHOTS, `${label}-${vp.name}${suffix}.png`);
  await page.screenshot({ path: file, fullPage });

  // horizontal overflow is a spec violation, so report it every time
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const height = await page.evaluate(() => document.body.scrollHeight);

  console.log(
    `${file}  page=${height}px  h-overflow=${overflow}px${
      overflow > 0 ? "  <-- VIOLATION" : ""
    }${errors.length ? `  console-errors=${errors.length}` : ""}`,
  );
  for (const e of errors.slice(0, 3)) console.log(`    ! ${e.slice(0, 160)}`);

  await context.close();
}

await browser.close();
