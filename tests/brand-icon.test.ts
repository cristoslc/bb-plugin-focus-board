import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FocusBoardLaneEyeIcon } from "../components/ui/icon";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(`${repoRoot}/assets/icon.svg`, "utf8");

/**
 * The settled brand mark: two side lanes as dim solid fills (no outline
 * strokes), flush at the top with the right one riding short, and the
 * middle lane inverted — filled solid with ONE card punched through as a
 * true evenodd hole. The artwork fills the 24 grid to a ~2-unit margin
 * (it rendered small at the old 3.25–4.5 margin). No pupil, no outlines.
 */
describe("brand mark (assets/icon.svg) — inverted lane, one card, full-bleed", () => {
  it("has no pupil and no outline strokes", () => {
    expect(svg).not.toMatch(/<circle/i);
    expect(svg).not.toMatch(/a3\.4|a2\.6/);
    expect(svg).not.toMatch(/stroke-width|stroke=/);
  });

  it("fills the grid to a 2-unit margin (bigger than the old 3.25/4.5)", () => {
    expect(svg).not.toMatch(/M3\.25 4\.5/);
    const bounds = svg.match(/M2 3H|H22V|V21H|V17\.5H/g) ?? [];
    expect(bounds.length).toBeGreaterThanOrEqual(3);
  });

  it("dims the two side lanes at 55% alpha, flush top, right one short", () => {
    const dim = svg.match(/opacity=["'.]/g) ?? [];
    expect(dim).toHaveLength(2);
    expect(svg).toMatch(/M2 3H6\.5V21H2Z/);
    expect(svg).toMatch(/M17\.5 3H22V17\.5H17\.5Z/);
  });

  it("fills the middle lane solid with exactly one card punched through", () => {
    const lane = svg.match(/<path[^>]*fill-rule=["']evenodd["'][^>]*d=["']([^"']+)["']/);
    expect(lane).not.toBeNull();
    expect(lane![1]).toMatch(/^M8\.75 3H15\.25V21H8\.75Z/);
    const subpaths = lane![1].split(/[Zz]/).filter((s) => s.trim().length > 0);
    expect(subpaths).toHaveLength(2); // lane body + one card
  });

  it("sizes the card generously and centers it in the lane", () => {
    const lane = svg.match(/<path[^>]*fill-rule=["']evenodd["'][^>]*d=["']([^"']+)["']/)!;
    const card = lane![1].split(/[Zz]/).filter((s) => s.trim().length > 0)[1];
    const vs = [...card.matchAll(/V(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    const height = Math.round((Math.abs(vs[1] - vs[0]) + 2) * 10) / 10; // 1.0-radius corners
    expect(height).toBeGreaterThanOrEqual(5.5);
    // centered in the 6.5-unit lane: 1.4 padding each side
    expect(card).toMatch(/M11\.15 /);
    expect(card).toMatch(/H12\.85/);
  });
});

describe("inline FocusBoard element — inverted lane parity", () => {
  const elements = FocusBoardLaneEyeIcon as unknown as Array<
    [string, Record<string, string>]
  >;

  it("mirrors the asset: two dim side lanes, no strokes, no pupil", () => {
    const dim = elements.filter(([, a]) => a.opacity === "0.55");
    expect(dim).toHaveLength(2);
    expect(elements.some(([, a]) => a.stroke !== undefined)).toBe(false);
    expect(elements.some(([, a]) => a.cx !== undefined)).toBe(false);
  });

  it("carries the same evenodd lane with one punched card", () => {
    const lane = elements.find(([, a]) => a.fillRule === "evenodd");
    expect(lane).toBeDefined();
    expect(lane![1].d).toMatch(/^M8\.75 3H15\.25V21H8\.75Z/);
    const subpaths = lane![1].d.split(/[Zz]/).filter((s) => s.trim().length > 0);
    expect(subpaths).toHaveLength(2);
  });
});