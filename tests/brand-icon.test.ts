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
 * true evenodd hole (the surface shows through on every theme). No
 * pupil, no outlines, no card stack. bb renders plugin icons as CSS
 * masks keyed off alpha coverage; solid fills + one honest hole are
 * exactly what the pipeline survives, and the theme inversion rides the
 * mask (currentColor tints per row) with no asset pair needed.
 */
describe("brand mark (assets/icon.svg) — inverted lane, one card", () => {
  it("has no pupil and no outline strokes", () => {
    expect(svg).not.toMatch(/<circle/i);
    expect(svg).not.toMatch(/a3\.4|a2\.6/);
    expect(svg).not.toMatch(/stroke-width|stroke=/);
  });

  it("dims the two side lanes at 55% alpha, flush top, right one short", () => {
    const dim = svg.match(/opacity=["'.]/g) ?? [];
    expect(dim).toHaveLength(2);
    expect(svg).toMatch(/M3\.25 4\.5H7\.25V19\.5H3\.25Z/);
    expect(svg).toMatch(/M16\.75 4\.5H20\.75V16\.5H16\.75Z/);
  });

  it("fills the middle lane solid with exactly one card punched through", () => {
    const lane = svg.match(/<path[^>]*fill-rule=["']evenodd["'][^>]*d=["']([^"']+)["']/);
    expect(lane).not.toBeNull();
    const subpaths = lane![1].split(/[Zz]/).filter((s) => s.trim().length > 0);
    expect(subpaths).toHaveLength(2); // lane body + one card
  });

  it("sizes the card generously and centers it in the lane", () => {
    const lane = svg.match(/<path[^>]*fill-rule=["']evenodd["'][^>]*d=["']([^"']+)["']/)!;
    const card = lane![1].split(/[Zz]/).filter((s) => s.trim().length > 0)[1];
    const vs = [...card.matchAll(/V(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    const height = Math.round((Math.abs(vs[1] - vs[0]) + 2) * 10) / 10; // 1.0-radius corners
    expect(height).toBeGreaterThanOrEqual(4.5);
    // centered in the 5.5-unit lane: 1.2 padding each side
    expect(card).toMatch(/M11\.45 /);
    expect(card).toMatch(/H12\.55/);
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
    const subpaths = lane![1].d.split(/[Zz]/).filter((s) => s.trim().length > 0);
    expect(subpaths).toHaveLength(2);
  });
});