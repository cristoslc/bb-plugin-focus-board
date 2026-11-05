// @vitest-environment jsdom
// The idle-callback seam (issue #373): the callbacks the load-tail attributions
// moved off the mount burst. The contract the two chip surfaces ride: one
// firing, at the host's idle callback or the fallback timer's ceiling,
// cancellable, and loud when no window host exists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_CALLBACK_FALLBACK_MS,
  scheduleIdleCallback,
} from "../lib/idle-callback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduleIdleCallback", () => {
  it("runs exactly once at the fallback ceiling on a host without requestIdleCallback (jsdom)", () => {
    const calls: string[] = [];
    scheduleIdleCallback(() => calls.push("fired"));
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(IDLE_CALLBACK_FALLBACK_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["fired"]);
  });

  it("prefers an early host idle callback and leaves the ceiling timer a no-op", async () => {
    // jsdom carries neither global; the seam's rIC path is real Chrome's.
    // The mock obeys the real contract: the idle callback fires ASYNC (the
    // browser never fires it during the scheduling call), so the seam has
    // its handle before any fire.
    const windowWithIdle = window as unknown as Record<string, unknown>;
    const originalIdle = windowWithIdle.requestIdleCallback;
    const originalCancel = windowWithIdle.cancelIdleCallback;
    const cancelSpy = vi.fn();
    try {
      windowWithIdle.requestIdleCallback = (cb: (deadline: unknown) => void) => {
        queueMicrotask(() => cb({ didTimeout: false }));
        return 1;
      };
      windowWithIdle.cancelIdleCallback = cancelSpy;
      const calls: string[] = [];
      scheduleIdleCallback(() => calls.push("fired"));
      await Promise.resolve(); // the mocked idle callback's own turn
      expect(calls).toEqual(["fired"]);
      // The ceiling timer was cleared under the callback's own cancel.
      vi.advanceTimersByTime(IDLE_CALLBACK_FALLBACK_MS + 1000);
      expect(calls).toEqual(["fired"]);
      expect(cancelSpy).toHaveBeenCalledWith(1);
    } finally {
      windowWithIdle.requestIdleCallback = originalIdle;
      windowWithIdle.cancelIdleCallback = originalCancel;
    }
  });

  it("the ceiling fires on a host whose idle callback never does", () => {
    const windowWithIdle = window as unknown as Record<string, unknown>;
    const originalIdle = windowWithIdle.requestIdleCallback;
    const originalCancel = windowWithIdle.cancelIdleCallback;
    const cancelSpy = vi.fn();
    try {
      windowWithIdle.requestIdleCallback = () => 7;
      windowWithIdle.cancelIdleCallback = cancelSpy;
      const calls: string[] = [];
      scheduleIdleCallback(() => calls.push("fired"));
      vi.advanceTimersByTime(IDLE_CALLBACK_FALLBACK_MS);
      expect(calls).toEqual(["fired"]);
      // The host's own ceiling would fire later; the seam cancels it too.
      vi.advanceTimersByTime(5_000);
      expect(calls).toEqual(["fired"]);
      expect(cancelSpy).toHaveBeenCalledWith(7);
    } finally {
      windowWithIdle.requestIdleCallback = originalIdle;
      windowWithIdle.cancelIdleCallback = originalCancel;
    }
  });

  it("cancel stops an unfired callback from ever running", () => {
    const cancel = scheduleIdleCallback(() => {
      throw new Error("a canceled callback must not run");
    });
    cancel();
    vi.advanceTimersByTime(IDLE_CALLBACK_FALLBACK_MS + 5000);
  });

  it("runs loud when no window host exists (hook contexts always have one)", () => {
    const original = (globalThis as { window?: unknown }).window;
    try {
      // @ts-expect-error forcing a host-less environment for the loud path
      delete (globalThis as { window?: unknown }).window;
      expect(() => scheduleIdleCallback(() => {})).toThrow(/scheduleIdleCallback/);
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});
