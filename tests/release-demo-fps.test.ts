import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FPS,
  FPS,
  MIN_FPS,
  resolveFps,
} from "../scripts/screenshot/release-demos/runner.mjs";

const STORYBOARDS = path.join(process.cwd(), "scripts/screenshot/release-demos");

/**
 * The playback floor. The operator's review of the 1.7.4 footage
 * (2026-11-01) named it: a gif below 15 fps reads as a slideshow, so the
 * assembly may play faster but never slower. The rate lives in one constant
 * (`MIN_FPS`) and one resolver, because the convention doc quotes it and the
 * ffmpeg pass consumes it.
 */
describe("demo gif playback rate", () => {
  it("plays every gif at 15 fps or faster", () => {
    expect(MIN_FPS).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_FPS).toBeGreaterThanOrEqual(MIN_FPS);
    expect(FPS).toBeGreaterThanOrEqual(MIN_FPS);
  });

  it("DEMO_FPS may raise the rate but never drop it under the floor", () => {
    expect(resolveFps(undefined)).toBe(DEFAULT_FPS);
    expect(resolveFps("15")).toBe(15);
    expect(resolveFps("24")).toBe(24);
    // Fail loud: a rate under the floor is the exact bug this floor exists
    // for, so it is an error, not a silent clamp to 15.
    for (const bad of ["12", "0", "-24", "abc", "", "NaN", "Infinity"]) {
      expect(() => resolveFps(bad), `DEMO_FPS=${JSON.stringify(bad)}`).toThrow(/DEMO_FPS/u);
    }
  });

  it("assembles at the rate the stage was given, not a hardcoded one", async () => {
    const source = await readFile(path.join(STORYBOARDS, "runner.mjs"), "utf8");
    // The assemble() filters must read the stage's rate; a literal `fps=12`
    // anywhere in there is the regression.
    expect(source).not.toMatch(/fps=12\b/u);
    expect(source).toMatch(/this\.fps/u);
  });

  it("the convention doc names the floor and retires 12 fps", async () => {
    const doc = await readFile(
      path.join(process.cwd(), "docs/releases/demo-gif-convention.md"),
      "utf8",
    );
    expect(doc).not.toMatch(/12\s*fps/iu);
    expect(doc).toMatch(/15\s*fps/iu);
    expect(doc).toMatch(/floor/iu);
    // The scope note: the floor governs new captures, not published footage.
    expect(doc).toMatch(/already published|published assets|older releases|earlier releases/iu);
  });
});

/**
 * The finger. Every touch demo carries a visible contact marker on every
 * frame, so the recorder — not the storyboard — owns the touchscreen: a
 * storyboard that reaches for `page.touchscreen` dispatches a finger the
 * overlay never learns about, and the clip shows a board moving on its own.
 */
describe("touch demos drive the recorder's finger", () => {
  it("no storyboard reaches past the recorder for the touchscreen", async () => {
    const files = (await readdir(STORYBOARDS)).filter((file) =>
      /^v\d+\.\d+\.\d+\.mjs$/u.test(file),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(path.join(STORYBOARDS, file), "utf8");
      expect(source, `${file} drives puppeteer's touchscreen directly`).not.toContain(
        "page.touchscreen",
      );
    }
  });

  it("a touch board lands a finger, and a mouse board never does", async () => {
    const files = (await readdir(STORYBOARDS)).filter((file) =>
      /^v\d+\.\d+\.\d+\.mjs$/u.test(file),
    );
    for (const file of files) {
      const module = await import(path.join(STORYBOARDS, file));
      for (const demo of module.demos) {
        const steps = demo.steps.toString();
        const touch = demo.viewport?.hasTouch === true;
        const label = `${file}/${demo.id}`;
        if (touch) {
          expect(steps, `${label} declares a touch viewport but never touches`).toContain(
            "g.touchStart(",
          );
          expect(steps, `${label} leaves the finger down`).toContain("g.touchEnd(");
        } else {
          expect(steps, `${label} touches a mouse viewport`).not.toContain("touchStart(");
        }
      }
    }
  });
});
