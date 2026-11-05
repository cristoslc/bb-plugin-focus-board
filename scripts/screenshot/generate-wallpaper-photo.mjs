/**
 * The screenshot harness's photo-wallpaper fixture, painted deterministically.
 *
 *   node scripts/screenshot/generate-wallpaper-photo.mjs
 *
 * Writes `scripts/screenshot/assets/wallpaper-photo.png` byte-identically on
 * every run: the only "randomness" is a fixed-seed PRNG and the renderer is
 * pure arithmetic — no canvas, no sharp, no network fetch. The release
 * wallpaper demos needed a staged image that reads as a photograph rather
 * than one of the shipped gradients, so the crop controls have features to
 * rest on: the pine cluster holds the left third (where the thread pane
 * carves it away), the sun sits right of centre, the ridges and their
 * reflection cross the middle, and the shore and rocks ground the bottom.
 *
 * 1280×720 (16:9) on purpose: against the demos' 1400×900 window (≈14:9) the
 * letterbox/fill toggle, the crop window, and the pane carve all move by
 * clearly visible amounts.
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1280;
const HEIGHT = 720;
const HORIZON = 455; // water sits at and below this row
const SUN = { x: 855, y: 185, r: 30, glow: 150 };

/** Deterministic PRNG (mulberry32): rock and reed placement never varies. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Multi-stop vertical gradient; stops are [position, r, g, b] in horizon
 *  space (0 = top of the sky, 1 = the waterline): dusk indigo into amber. */
function skyColor(t) {
  const stops = [
    [0.0, 0x1d, 0x25, 0x47],
    [0.42, 0x4b, 0x4f, 0x86],
    [0.74, 0x8f, 0x64, 0x89],
    [1.0, 0xe5, 0x9a, 0x62],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0] || i === stops.length - 1) {
      const [p0, r0, g0, b0] = stops[i - 1];
      const [p1, r1, g1, b1] = stops[i];
      const f = Math.min(1, Math.max(0, (t - p0) / (p1 - p0)));
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  throw new Error("unreachable gradient stop");
}

/** Ridge silhouettes: two ranges, each a height field over x. The far range
 *  rides higher (smaller y) than the near one so both read above the shore. */
function farRidgeTop(x) {
  return 402 - (22 + 26 * Math.sin(x * 0.0062 + 1.7) + 18 * Math.sin(x * 0.0134 + 0.4) + 9 * Math.sin(x * 0.0291 + 2.9));
}
function nearRidgeTop(x) {
  return 436 - (14 + 20 * Math.sin(x * 0.0091 + 3.1) + 12 * Math.sin(x * 0.0227 + 0.9) + 6 * Math.sin(x * 0.041 + 1.4));
}

function blend(base, over, alpha) {
  return [base[0] + (over[0] - base[0]) * alpha, base[1] + (over[1] - base[1]) * alpha, base[2] + (over[2] - base[2]) * alpha];
}

/** A soft ellipse (cloud, rock) blended at a falloff alpha. */
function ellipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, (1 - d) * 1.35));
}

/** One pine as a silhouette test: a trunk plus a stacked pyramid of tiers
 *  (each tier's half-width at its base). Returns 1 where the tree covers. */
function pineSilhouette(px, py, baseX, baseY, trunkH, tiers) {
  if (Math.abs(px - baseX) <= 2 && py <= baseY && py >= baseY - trunkH) return 1;
  for (let i = 0; i < tiers.length; i += 1) {
    const topY = baseY - trunkH - (i + 1) * 34;
    const footY = baseY - trunkH - i * 34 - 4;
    if (py < topY || py > footY) continue;
    const f = (py - topY) / (footY - topY);
    if (Math.abs(px - baseX) <= tiers[i] * f + 1.5) return 1;
  }
  return 0;
}

const random = mulberry32(0xc0ffee);
const rocks = Array.from({ length: 9 }, (_, index) => ({
  x: 90 + index * 130 + random() * 60,
  y: 668 + random() * 26,
  rx: 16 + random() * 26,
  ry: 7 + random() * 8,
  tone: 0.16 + random() * 0.2,
}));
const reeds = Array.from({ length: 44 }, () => ({
  x: random() < 0.55 ? 300 + random() * 180 : 880 + random() * 200,
  top: 596 + random() * 18,
}));
const pines = [
  // baseX, baseY, trunk height, tier half-widths bottom → top
  [120, 692, 110, [30, 26, 22, 18, 14, 10, 7]],
  [196, 696, 76, [26, 22, 18, 14, 10]],
  [262, 694, 88, [28, 24, 20, 15, 11, 8]],
];

/** The Bayer 4×4 matrix, at small amplitude: the ordered pattern repeats, so
 *  it breaks gradient banding without wrecking deflate, and keeps the gif
 *  palette pass cheap. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const DITHER = 1.1;

/** The water's color at (x, y): a compressed reflection of the sky and the
 *  two ridges, a gentle ripple modulation, and a glitter path under the sun.
 *  The ripples stay near-flat on purpose: the fixture must read as a photo,
 *  but high-frequency pixel noise defeats the gif's palette pass (the first
 *  fixture's rough water landed the crop demo at 39MB). */
function waterColor(x, y) {
  const source = Math.max(0, HORIZON - (y - HORIZON) * 0.92);
  let color = skyColor(Math.min(source, HORIZON - 1) / HORIZON).map((c) => c * 0.56);
  if (source >= farRidgeTop(x)) color = blend(color, [0x2a, 0x2f, 0x50], 0.5);
  if (source >= nearRidgeTop(x)) color = blend(color, [0x21, 0x26, 0x40], 0.55);
  const ripple = Math.sin(y * 1.6 + x * 0.09) * 2.5 + Math.sin(y * 0.8 - x * 0.037 + 1.2) * 2;
  color = [color[0] + ripple, color[1] + ripple * 0.9, color[2] + ripple * 0.7];
  const glitter = Math.abs(x - SUN.x);
  if (glitter < 42 && Math.sin(y * 1.7) > 0.55) {
    const g = (1 - glitter / 42) * 78;
    color = [color[0] + g * 1.5, color[1] + g, color[2] + g * 0.5];
  }
  for (const reed of reeds) {
    const sway = Math.sin((660 - y) * 0.12 + reed.x) * 2.4;
    if (y >= reed.top && y <= 662 && Math.abs(x - (reed.x + sway)) <= 0.8) {
      return [0x14, 0x17, 0x0f];
    }
  }
  return color;
}

function pixel(x, y) {
  let color;
  if (y < HORIZON) {
    // Sky, the two ridges, clouds, and the sun over it.
    color = skyColor(y / HORIZON);
    if (y >= farRidgeTop(x)) {
      color = blend(skyColor(farRidgeTop(x) / HORIZON), [0x3d, 0x44, 0x70], 0.78);
    }
    if (y >= nearRidgeTop(x)) color = blend([0x2e, 0x35, 0x57], color, 0.14);
    for (const [cx, cy, rx, ry, alpha] of [
      [200, 122, 150, 24, 0.3],
      [478, 96, 108, 20, 0.26],
      [1042, 148, 168, 28, 0.3],
      [700, 182, 92, 15, 0.2],
    ]) {
      const cover = ellipse(x, y, cx, cy, rx, ry);
      if (cover > 0) color = blend(color, [0xd9, 0xc9, 0xe8], cover * alpha);
    }
    const dx = (x - SUN.x) / SUN.glow;
    const dy = (y - SUN.y) / (SUN.glow * 0.8);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) color = blend(color, [0xff, 0xd0, 0x8a], (1 - d) ** 2 * 0.85);
    const core = Math.max(0, 1 - Math.sqrt((x - SUN.x) ** 2 + (y - SUN.y) ** 2) / SUN.r);
    if (core > 0) color = blend(color, [0xff, 0xf2, 0xd0], core);
  } else {
    // The bank's uneven top edge rises toward the left; water everywhere
    // above it (the reflection formula holds to the bank), the dark shore
    // and its rocks below.
    const bank = 650 + Math.sin(x * 0.0085 + 2) * 7 + Math.max(0, 620 - x) * 0.06;
    if (y < bank) {
      color = waterColor(x, y);
    } else {
      const depth = Math.min(1, (y - bank) / 70);
      color = blend([0x23, 0x28, 0x1f], [0x17, 0x1a, 0x13], depth);
      for (const rock of rocks) {
        const cover = ellipse(x, y, rock.x, rock.y, rock.rx, rock.ry);
        if (cover > 0) {
          const tone = 0x3a + rock.tone * 0x30;
          color = blend(color, [tone * 0.9, tone, tone * 0.92], Math.min(1, cover));
        }
      }
    }
  }
  for (const [baseX, baseY, trunkH, tiers] of pines) {
    if (pineSilhouette(x, y, baseX, baseY, trunkH, tiers) === 1) return [0x10, 0x15, 0x12];
  }
  return color;
}

function render() {
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * (WIDTH * 3 + 1);
    raw[rowStart] = 1; // Sub filter
    let prevR = 0;
    let prevG = 0;
    let prevB = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const color = pixel(x, y);
      const dither = (BAYER[y & 3][x & 3] / 16 - 0.5) * DITHER;
      // True sample values first; the stored byte is the Sub difference
      // against the previous pixel's true values (0 at the row's start).
      const vR = Math.max(0, Math.min(255, Math.round(color[0] + dither)));
      const vG = Math.max(0, Math.min(255, Math.round(color[1] + dither)));
      const vB = Math.max(0, Math.min(255, Math.round(color[2] + dither)));
      const i = rowStart + 1 + x * 3;
      raw[i] = (vR - prevR) & 0xff;
      raw[i + 1] = (vG - prevG) & 0xff;
      raw[i + 2] = (vB - prevB) & 0xff;
      prevR = vR;
      prevG = vG;
      prevB = vB;
    }
  }
  return raw;
}

/** A minimal PNG writer: signature, IHDR, IDAT (one deflate of the filtered
 *  scanlines), IEND. RGB, 8-bit, no interlace. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outPath = fileURLToPath(new URL("./assets/wallpaper-photo.png", import.meta.url));
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, encodePng(render()));
console.log(`wrote ${outPath} (${WIDTH}x${HEIGHT})`);
