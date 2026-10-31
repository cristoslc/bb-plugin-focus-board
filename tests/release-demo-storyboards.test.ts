import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STORYBOARDS = path.join(process.cwd(), "scripts/screenshot/release-demos");

/**
 * The release-demo storyboards are the contract between a release and its
 * notes: `docs/releases/demo-gif-convention.md` promises one gif per
 * demonstrable bullet, and the recorder walks these files to produce them. A
 * malformed storyboard would fail at capture time, hours after the release
 * page was written, so the shape is pinned here.
 */
describe("release demo storyboards", () => {
  it("every release storyboard names its demos and their steps", async () => {
    const files = (await readdir(STORYBOARDS)).filter((file) =>
      /^v\d+\.\d+\.\d+\.mjs$/u.test(file),
    );
    // The captured gifs are release assets, not fixtures: the storyboards are
    // the only thing this directory holds.
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const module = await import(path.join(STORYBOARDS, file));
      expect(typeof module.baseParams, `${file} baseParams`).toBe("string");
      expect(Array.isArray(module.demos), `${file} demos`).toBe(true);
      expect(module.demos.length, `${file} has no demos`).toBeGreaterThan(0);

      const ids = module.demos.map((demo: { id: string }) => demo.id);
      expect(new Set(ids).size, `${file} repeats a demo id`).toBe(ids.length);

      for (const demo of module.demos) {
        expect(typeof demo.id, `${file} demo id`).toBe("string");
        expect(demo.id.length, `${file} demo id is empty`).toBeGreaterThan(0);
        expect(typeof demo.steps, `${file}/${demo.id} steps`).toBe("function");
        if (demo.clip !== undefined) {
          expect(typeof demo.clip, `${file}/${demo.id} clip`).toBe("string");
        }
        if (demo.viewport !== undefined) {
          expect(typeof demo.viewport.width, `${file}/${demo.id} viewport`).toBe("number");
        }
      }
    }
  });

  it("keeps captured gifs out of the repo", async () => {
    const ignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    // A gif committed to the repo lives in every clone and every future tag;
    // the convention routes them through release assets instead.
    expect(ignore.split("\n").map((line) => line.trim())).toContain(
      "docs/screenshots/release-demos/",
    );
  });

  it("the release procedure links the convention it must follow", async () => {
    const spoke = await readFile(
      path.join(process.cwd(), ".agents/agents-md-detail/release.md"),
      "utf8",
    );
    expect(spoke).toContain("docs/releases/demo-gif-convention.md");
    expect(spoke).toContain("demo gif per demonstrable feature");
  });
});
