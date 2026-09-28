import { describe, expect, it } from "vitest";
import { paneSubPathFor, paneThreadIdFromSubPath } from "../lib/pane-route";

describe("paneSubPathFor", () => {
  it("routes a thread id under the t/ prefix", () => {
    expect(paneSubPathFor("thr_abc123")).toBe("t/thr_abc123");
  });

  it("passes arbitrary ids through unchanged", () => {
    // The codec does not validate bb id format; the board only ever pushes
    // ids it got from the host's thread list.
    expect(paneSubPathFor("x")).toBe("t/x");
  });
});

describe("paneThreadIdFromSubPath", () => {
  it("reads back what paneSubPathFor wrote", () => {
    expect(paneThreadIdFromSubPath(paneSubPathFor("thr_abc123"))).toBe("thr_abc123");
  });

  it("treats the panel root as no pane", () => {
    expect(paneThreadIdFromSubPath("")).toBeNull();
  });

  it("treats unknown route segments as no pane, not a broken pane", () => {
    // A future sub-location (or a stale link to one) must degrade to the
    // plain board, never open a pane for a garbage id.
    expect(paneThreadIdFromSubPath("settings")).toBeNull();
    expect(paneThreadIdFromSubPath("t")).toBeNull();
    expect(paneThreadIdFromSubPath("t/")).toBeNull();
  });

  it("rejects malformed thread ids", () => {
    // Slashes would make the id a different route depth; whitespace and
    // punctuation would be a push the board never made.
    expect(paneThreadIdFromSubPath("t/a/b")).toBeNull();
    expect(paneThreadIdFromSubPath("t/a b")).toBeNull();
    expect(paneThreadIdFromSubPath("t/a.b")).toBeNull();
    expect(paneThreadIdFromSubPath("t/..")).toBeNull();
  });

  it("accepts ids with underscores, digits, and hyphens", () => {
    expect(paneThreadIdFromSubPath("t/thr_2F-a9")).toBe("thr_2F-a9");
  });

  it("does not mistake a longer prefix for the pane route", () => {
    // A future "ticket/…" segment shares the letter t but not the prefix.
    expect(paneThreadIdFromSubPath("ticket/thr_abc")).toBeNull();
  });
});
