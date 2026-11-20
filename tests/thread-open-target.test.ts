// The card click's surface choice (lib/thread-open-target.ts): the value the
// declared `threadOpenTarget` setting stores, read the way the board reads it.
// The one thing this parser must never do is invent an answer — an unset
// install is the setup dialog's marker, not a default, so "answered" and
// "effective" are two different questions here.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_OPEN_TARGET,
  THREAD_OPEN_TARGETS,
  isThreadOpenTarget,
  threadOpenTargetAnswered,
  threadOpenTargetFromSetting,
} from "../lib/thread-open-target";

describe("threadOpenTargetFromSetting", () => {
  it("reads both declared tokens back unchanged", () => {
    expect(threadOpenTargetFromSetting("beside")).toBe("beside");
    expect(threadOpenTargetFromSetting("panel")).toBe("panel");
  });

  it("falls back to the shipped split pane while loading, unset, or foreign", () => {
    // Undefined is the loading state AND the never-answered state: neither is
    // evidence for a choice, so today's behaviour applies.
    expect(threadOpenTargetFromSetting(undefined)).toBe(DEFAULT_THREAD_OPEN_TARGET);
    for (const foreign of ["", "Panel", "split-pane", "in-panel", "null", 0, 1, true, false]) {
      expect(threadOpenTargetFromSetting(foreign)).toBe(DEFAULT_THREAD_OPEN_TARGET);
    }
  });

  it("declares exactly the two surfaces it can report", () => {
    expect([...THREAD_OPEN_TARGETS]).toEqual(["beside", "panel"]);
    for (const target of THREAD_OPEN_TARGETS) {
      expect(threadOpenTargetFromSetting(target)).toBe(target);
      expect(isThreadOpenTarget(target)).toBe(true);
    }
  });
});

describe("threadOpenTargetAnswered", () => {
  it("counts only a stored token as answered", () => {
    expect(threadOpenTargetAnswered("beside")).toBe(true);
    expect(threadOpenTargetAnswered("panel")).toBe(true);
  });

  it("treats the unset, loading, and foreign shapes as still unanswered", () => {
    // This is the dialog's once-only marker: anything but a declared token
    // means this install still owes an answer.
    for (const value of [undefined, "", "Panel", "split-pane", 0, 1, true, false]) {
      expect(threadOpenTargetAnswered(value)).toBe(false);
    }
  });
});
