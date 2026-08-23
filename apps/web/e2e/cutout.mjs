/**
 * Background removal for logo.png.
 *
 *   node qa/cutout.mjs <in.png> <outDir>
 *
 * Uses Chromium's canvas (already a dependency via Playwright) rather than
 * adding an image library.
 *
 * A naive colour-key would also punch holes anywhere the artwork happens to
 * contain the background colour. So instead this flood-fills inward from the
 * border: only background that is actually *connected to the edge* is removed.
 * The boundary is then feathered by colour distance so the cutout does not
 * alias into a hard jagged edge.
 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [, , inPath = "e2e/shots/logo.png", outDir = "public"] = process.argv;

const b64 = (await readFile(inPath)).toString("base64");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");

const result = await page.evaluate(
  async ({ dataUrl, tol }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const W = img.width;
    const H = img.height;
    const c = document.getElementById("c");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    let recolourStats = null;
    const im = ctx.getImageData(0, 0, W, H);
    const d = im.data;

    // background colour = median of the four corners
    const at = (x, y) => {
      const k = (y * W + x) * 4;
      return [d[k], d[k + 1], d[k + 2]];
    };
    const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
    const bg = [0, 1, 2].map((i) => {
      const v = corners.map((c2) => c2[i]).sort((a, b) => a - b);
      return Math.round((v[1] + v[2]) / 2);
    });

    const dist = (k) => {
      const dr = d[k] - bg[0], dg = d[k + 1] - bg[1], db = d[k + 2] - bg[2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    // The artwork is green; the background is a blue-tinted near-black. Any
    // pixel whose green channel leads is artwork — however dark it is. Without
    // this guard the dark shading inside the fold falls within tolerance of the
    // background and gets eaten, which severs the fold from the ribbon.
    const isArtwork = (k) => d[k + 1] > d[k] + 5 && d[k + 1] > d[k + 2] + 3;

    // flood fill inward from every border pixel — only edge-connected
    // background is removed, so interior artwork is safe
    const outside = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) {
      stack.push(x, 0, x, H - 1);
    }
    for (let y = 0; y < H; y++) {
      stack.push(0, y, W - 1, y);
    }
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (outside[p]) continue;
      if (isArtwork(p * 4)) continue;
      if (dist(p * 4) > tol) continue;
      outside[p] = 1;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }

    // ---- sever leaked pockets -----------------------------------------
    // The darkest shading inside the fold is EXACTLY the background colour, so
    // no tolerance can separate them: the fill walks down that shadow like a
    // channel and eats the pocket behind it. Colour cannot fix this; geometry
    // can. Opening the mask (erode, re-flood from the border, dilate back)
    // pinches off narrow channels, so a pocket reachable only through one
    // becomes unreachable and is handed back to the artwork. Intersecting with
    // the original mask at the end keeps the true edge pixel-accurate.
    const K = 4;
    const erode = (src) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let all = 1;
          for (let dy = -K; dy <= K && all; dy++) {
            for (let dx = -K; dx <= K; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (!src[ny * W + nx]) { all = 0; break; }
            }
          }
          out[y * W + x] = all;
        }
      }
      return out;
    };
    const dilate = (src) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!src[y * W + x]) continue;
          for (let dy = -K; dy <= K; dy++) {
            for (let dx = -K; dx <= K; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              out[ny * W + nx] = 1;
            }
          }
        }
      }
      return out;
    };

    {
      const eroded = erode(outside);
      const keep = new Uint8Array(W * H);
      const st = [];
      for (let x = 0; x < W; x++) st.push(x, 0, x, H - 1);
      for (let y = 0; y < H; y++) st.push(0, y, W - 1, y);
      while (st.length) {
        const y = st.pop(), x = st.pop();
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const q = y * W + x;
        if (keep[q] || !eroded[q]) continue;
        keep[q] = 1;
        st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      const grown = dilate(keep);
      for (let q = 0; q < W * H; q++) outside[q] = outside[q] && grown[q] ? 1 : 0;
    }

    // ---- alpha matting on a narrow boundary band ----------------------
    // The source is effectively PREMULTIPLIED against a near-black ground, so
    // an edge pixel is a blend: P = a*F + (1-a)*B. Two failure modes to avoid:
    //   * treating dark shading as background  -> the fold gets eaten
    //   * treating edge blends as opaque       -> a dark jagged halo on paper
    // Both were hit in earlier passes. The fix is to matte ONLY pixels within a
    // couple of px of the removed background: estimate their coverage from
    // local brightness, then un-premultiply to strip the dark contamination.
    // Interior pixels are left completely alone, so genuine dark shading stays.
    const BAND = 2;
    const inBand = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (outside[p]) continue;
        let near = false;
        for (let dy = -BAND; dy <= BAND && !near; dy++) {
          for (let dx = -BAND; dx <= BAND; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (outside[ny * W + nx]) { near = true; break; }
          }
        }
        if (near) inBand[p] = 1;
      }
    }

    // brightness above the background, per pixel
    const lift = (k) =>
      Math.max(d[k] - bg[0], d[k + 1] - bg[1], d[k + 2] - bg[2], 0);

    let cleared = 0, matted = 0;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const k = p * 4;

        if (outside[p]) { d[k + 3] = 0; cleared++; continue; }

        if (!inBand[p]) {
          d[k + 3] = 255; // interior artwork, including dark fold shading
        } else {
          // local reference = brightest solid neighbour, so shaded edges are
          // matted against their own tone rather than a global constant
          let ref = 1;
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const q = ny * W + nx;
              if (outside[q] || inBand[q]) continue;
              const v = lift(q * 4);
              if (v > ref) ref = v;
            }
          }
          const a = Math.max(0, Math.min(1, lift(k) / ref));
          d[k + 3] = Math.round(a * 255);
          if (a > 0.02) {
            // un-premultiply: recover F from P = a*F + (1-a)*B
            for (let ch = 0; ch < 3; ch++) {
              const v = bg[ch] + (d[k + ch] - bg[ch]) / a;
              d[k + ch] = Math.max(0, Math.min(255, Math.round(v)));
            }
            matted++;
          }
        }

        if (d[k + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // ---- recolour the fold shadow ---------------------------------------
    // The shading inside the fold is drawn as near-black. That works on the
    // dark ground it was designed for, but on warm paper it reads as a hole
    // punched through the mark. Remap the dark artwork onto the logo's OWN
    // green, scaled by brightness, so it reads as shading of the same material
    // instead of a black notch. Mid-tones and highlights are untouched: the
    // blend only ramps in below TH_HI and is full below TH_LO.
    {
      // base green = mean of the brightest, most green-dominant artwork pixels
      let br = 0, bg2 = 0, bb = 0, n = 0;
      for (let q = 0; q < W * H; q++) {
        const k = q * 4;
        if (d[k + 3] < 250) continue;
        const g2 = d[k + 1];
        if (g2 < 170 || g2 <= d[k] + 20 || g2 <= d[k + 2] + 20) continue;
        br += d[k]; bg2 += g2; bb += d[k + 2]; n++;
      }
      const base = n
        ? [br / n, bg2 / n, bb / n]
        : [60, 224, 143];

      const TH_HI = 135; // above this, leave the pixel alone
      const TH_LO = 38;  // below this, fully recoloured
      const FLOOR = 0.30; // darkest shading keeps 30% of the green, never black
      let touched = 0;
      for (let q = 0; q < W * H; q++) {
        const k = q * 4;
        if (d[k + 3] < 8) continue;
        const v = Math.max(d[k], d[k + 1], d[k + 2]);
        if (v >= TH_HI) continue;
        // 0 at TH_HI, 1 at TH_LO — smooth so there is no banding at the seam
        let t = (TH_HI - v) / (TH_HI - TH_LO);
        t = Math.max(0, Math.min(1, t));
        t = t * t * (3 - 2 * t);
        const lift = FLOOR + (1 - FLOOR) * (v / TH_HI);
        for (let ch = 0; ch < 3; ch++) {
          const target = base[ch] * lift;
          d[k + ch] = Math.round(d[k + ch] * (1 - t) + target * t);
        }
        touched++;
      }
      recolourStats = { base: base.map((x) => Math.round(x)), touched };
    }

    ctx.putImageData(im, 0, 0);

    // trim to the artwork, keeping a small even margin
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(W - sx, maxX - minX + 1 + pad * 2);
    const sh = Math.min(H - sy, maxY - minY + 1 + pad * 2);

    // square it so the mark never distorts in a square slot
    const side = Math.max(sw, sh);
    const out = document.createElement("canvas");
    out.width = side;
    out.height = side;
    const o = out.getContext("2d");
    o.drawImage(c, sx, sy, sw, sh, (side - sw) / 2, (side - sh) / 2, sw, sh);

    const sizes = {};
    for (const s of [512, 180, 64, 32]) {
      const t = document.createElement("canvas");
      t.width = s;
      t.height = s;
      const tc = t.getContext("2d");
      tc.imageSmoothingQuality = "high";
      tc.drawImage(out, 0, 0, s, s);
      sizes[s] = t.toDataURL("image/png");
    }

    // self-check: a TRUE hole is a transparent pixel unreachable from the image
    // border through other transparent pixels. An earlier version tested for
    // opaque pixels in all four directions, which false-flagged the letter's
    // own counter-space (7,043 px) as eaten artwork. Connectivity is the test.
    const oi = o.getImageData(0, 0, side, side).data;
    const clear = (q) => oi[q * 4 + 3] <= 10;
    const seen = new Uint8Array(side * side);
    const st2 = [];
    for (let x = 0; x < side; x++) st2.push(x, 0, x, side - 1);
    for (let y = 0; y < side; y++) st2.push(0, y, side - 1, y);
    while (st2.length) {
      const y = st2.pop(), x = st2.pop();
      if (x < 0 || y < 0 || x >= side || y >= side) continue;
      const q = y * side + x;
      if (seen[q] || !clear(q)) continue;
      seen[q] = 1;
      st2.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    let holes = 0;
    for (let q = 0; q < side * side; q++) if (clear(q) && !seen[q]) holes++;

    return {
      bg,
      holes,
      recolourStats,
      W, H,
      clearedPct: +((cleared / (W * H)) * 100).toFixed(1),
      matted,
      bounds: { minX, minY, maxX, maxY },
      side,
      full: out.toDataURL("image/png"),
      sizes,
    };
  },
  // tol is set from MEASURED background flatness (max deviation 6.4 on this
  // source), not guessed. A loose tolerance lets the fill walk down the dark
  // shadow inside the fold and eat the pocket behind it — that produced 8,085
  // enclosed transparent pixels before this was measured.
  { dataUrl: `data:image/png;base64,${b64}`, tol: 10 },
);

const write = async (name, dataUrl) => {
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(path.join(outDir, name), buf);
  return buf.length;
};

const sizes = [];
sizes.push(["logo.png", await write("logo.png", result.full)]);
for (const [s, url] of Object.entries(result.sizes)) {
  sizes.push([`logo-${s}.png`, await write(`logo-${s}.png`, url)]);
}

console.log(`source        ${result.W}x${result.H}`);
console.log(`background    rgb(${result.bg.join(", ")})`);
console.log(`cleared       ${result.clearedPct}% of pixels`);
console.log(`matted        ${result.matted} boundary pixels decontaminated`);
console.log(`recoloured    ${result.recolourStats.touched} dark px onto base green rgb(${result.recolourStats.base.join(", ")})`);
console.log(`holes         ${result.holes} enclosed transparent px  ${result.holes ? "<-- ARTWORK EATEN" : "(none — mark is intact)"}`);
console.log(
  `artwork bbox  x ${result.bounds.minX}–${result.bounds.maxX}, y ${result.bounds.minY}–${result.bounds.maxY}`,
);
console.log(`squared to    ${result.side}x${result.side}`);
for (const [n, b] of sizes) console.log(`  ${n.padEnd(16)} ${(b / 1024).toFixed(1)} KB`);

await browser.close();
