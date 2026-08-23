/**
 * Proves the reveal behaves: nothing fires before it is on screen, nothing is
 * left invisible afterwards, and the path is a vertical-dominant curve.
 *
 *   node qa/arc.mjs [--url http://localhost:3000]
 */
import { chromium } from "playwright";

const i = process.argv.indexOf("--url");
const url = i >= 0 ? process.argv[i + 1] : "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// 1. sit at the top long enough that any stray timer would betray itself
await page.waitForTimeout(4000);
const idle = await page.evaluate(() => {
  const rv = [...document.querySelectorAll(".rv")];
  const off = rv.filter((e) => e.getBoundingClientRect().top > innerHeight);
  return { off: off.length, fired: off.filter((e) => e.classList.contains("rv-in")).length };
});
console.log(`idle 4s at top — off-screen: ${idle.off}, wrongly fired: ${idle.fired}`);

// 2. sample the arc as it plays
const samples = await page.evaluate(async () => {
  const el = document.querySelector("#reconciliation .rv-frame");
  if (!el) return [];
  const out = [];
  el.scrollIntoView({ block: "center" });
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      out.push({
        t: Math.round(performance.now() - t0),
        x: +m.m41.toFixed(1),
        y: +m.m42.toFixed(1),
        op: +(+getComputedStyle(el).opacity).toFixed(2),
      });
      if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  return out.filter((_, n) => n % 8 === 0);
});

console.log("\n t(ms)      x       y   opacity");
for (const s of samples) {
  console.log(
    String(s.t).padStart(6),
    String(s.x).padStart(7),
    String(s.y).padStart(7),
    String(s.op).padStart(9),
  );
}
const mx = Math.max(...samples.map((s) => Math.abs(s.x)));
const my = Math.max(...samples.map((s) => Math.abs(s.y)));
console.log(`\npeak |x|=${mx}  peak |y|=${my}  vertical-dominant: ${my > mx * 2}`);

// 3. walk the page, then confirm nothing is left invisible
await page.evaluate(async () => {
  const step = innerHeight * 0.6;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 650));
  }
});
await page.waitForTimeout(2200);
const after = await page.evaluate(() => {
  const rv = [...document.querySelectorAll(".rv")];
  const bad = [];
  rv.forEach((e, n) => {
    if (parseFloat(getComputedStyle(e).opacity) < 0.99) bad.push(`rv#${n}`);
    [...e.children].forEach((ch, j) => {
      if (parseFloat(getComputedStyle(ch).opacity) < 0.99) bad.push(`rv#${n} child${j}`);
    });
  });
  return { total: rv.length, played: rv.filter((e) => e.classList.contains("rv-in")).length, bad };
});
console.log(
  `\nreveals: ${after.total}  played: ${after.played}  still invisible: ${
    after.bad.length ? after.bad.join(", ") : "none"
  }`,
);

await browser.close();
