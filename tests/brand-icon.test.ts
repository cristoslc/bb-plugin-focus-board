import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FocusBoardLaneEyeIcon } from "../components/ui/icon";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(`${repoRoot}/assets/icon.svg`, "utf8");

/**
 * The brand mark is the plain-kanban triptych with the focal card: three
 * outlined columns, all flush at the top, the right one riding short, and
 * a single solid card sitting in the middle column — the card that needs
 * you. No pupil, no eye, no punched holes: the card is the only solid
 * form, so the mark is one strong alpha shape among bold outlines, which
 * is what survives bb's alpha-mask pipeline at 16px.
 */
describe("brand mark (assets/icon.svg) — focal card triptych", () => {
  it("has no pupil — no circle element, no round-dot arc", () => {
    expect(svg).not.toMatch(/<circle/i);
    expect(svg).not.toMatch(/a3\.4|a2\.6/);
  });

  it("draws the three columns as full-strength outlined strokes", () => {
    const lanes = svg.match(/stroke-width=["']2\.5["']/g) ?? [];
    expect(lanes).toHaveLength(3);
    expect(svg).not.toMatch(/opacity=/);
  });

  it("keeps the columns flush at the top with the right one riding short", () => {
    expect(svg).toMatch(/M3\.25 4\.5H7\.25V19\.5H3\.25Z/);
    expect(svg).toMatch(/M16\.75 4\.5H20\.75V16\.5H16\.75Z/);
  });

  it("sits one solid card in the middle column, tall and near the top", () => {
    const card = svg.match(/<rect[^>]*fill=["']currentColor["'][^>]*\/>/);
    expect(card).not.toBeNull();
    const tag = card![0];
    const num = (attr: string) => parseFloat(tag.match(new RegExp(`${attr}=["']([\\d.]+)["']`))![1]);
    expect(num("x")).toBeGreaterThanOrEqual(10.4); // inside the lane rails
    expect(num("x") + num("width")).toBeLessThanOrEqual(13.6);
    expect(num("height")).toBeGreaterThanOrEqual(5); // grew relative to the lanes
    expect(num("y")).toBeLessThanOrEqual(7); // less lane above it
  });
});

describe("inline FocusBoard element — focal card parity", () => {
  const elements = FocusBoardLaneEyeIcon as unknown as Array<
    [string, Record<string, string>]
  >;

  it("mirrors the asset: three stroked columns, no pupil", () => {
    const stroked = elements.filter(([, a]) => a.stroke === "currentColor");
    expect(stroked).toHaveLength(3);
    expect(elements.some(([, a]) => a.cx !== undefined)).toBe(false);
    expect(elements.some(([, a]) => a.fillRule === "evenodd")).toBe(false);
  });

  it("carries the solid card as a filled rounded rect", () => {
    const card = elements.find(([, a]) => a.fill === "currentColor" && a.d);
    expect(card).toBeDefined();
    expect(card![1].d).toMatch(/A1\.3/);
  });
});