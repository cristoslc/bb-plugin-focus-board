import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FocusBoardLaneEyeIcon } from "../components/ui/icon";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(`${repoRoot}/assets/icon.svg`, "utf8");

/**
 * bb renders plugin brand icons as CSS masks keyed off alpha coverage.
 * Stroked-outline shapes are not mask-safe at icon sizes: a bold stroked
 * lane hollows, and its interior reads as dark breaks around the pupil.
 * The brand mark must therefore be solid alpha geometry: filled lanes,
 * the pupil an evenodd hole in the bold lane.
 */
describe("brand mark (assets/icon.svg)", () => {
  it("uses no stroked shapes — solid fills only (alpha-geometry safe)", () => {
    expect(svg).not.toMatch(/stroke\s*=/);
    expect(svg).not.toMatch(/stroke-width/i);
  });

  it("dims the two side lanes at 55% alpha and keeps the bold lane opaque", () => {
    const dim = svg.match(/opacity=["'.]/g) ?? [];
    expect(dim.length).toBe(2);
    expect(svg).toMatch(/opacity=["'.]0?\.55["']/);
  });

  it("carves the pupil as an evenodd hole inside the bold lane", () => {
    const bold = svg.match(/<path[^>]*fill-rule=["']evenodd["'][^>]*d=["']([^"']+)["']/);
    expect(bold).not.toBeNull();
    const d = bold![1];
    const subpaths = d.split(/[Zz]/).filter((s) => s.trim().length > 0);
    expect(subpaths).toHaveLength(2); // lane rect + pupil circle
    expect(d).toMatch(/a3\.4/);
  });
});

describe("inline FocusBoard brand element", () => {
  const paths = FocusBoardLaneEyeIcon.map(
    ([tag, attrs]) => [tag, attrs] as const,
  );

  it("mirrors the asset: no strokes, filled shapes only", () => {
    for (const [, attrs] of paths) {
      expect(attrs).not.toHaveProperty("stroke");
      expect(attrs).not.toHaveProperty("strokeWidth");
    }
  });

  it("dims the side lanes and punches the pupil with evenodd", () => {
    const lanes = paths.filter(([, attrs]) => attrs.opacity === "0.55");
    expect(lanes).toHaveLength(2);
    const bold = paths.find(([, attrs]) => attrs.fillRule === "evenodd");
    expect(bold).toBeDefined();
    expect(bold![1].d).toMatch(/a3\.4/);
  });
});