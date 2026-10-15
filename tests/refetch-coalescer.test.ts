// @vitest-environment jsdom
// The realtime-coalescing contract (issue #186's refetch half): a burst of
// realtime signals must produce ONE bounded refetch pass, not one per
// signal. The scheduler is shared by every refetch-carrying signal (done,
// link, ack, snooze, rank, group), so the tests pin: same unit collapsing
// into one run, a burst of several units running each once in one pass,
// debounce + max-wait bounding (no starvation), a sync throw not killing
// the rest of the pass, later schedules winning, passes re-arming, and
// dispose cancelling pending work.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRefetchScheduler,
  REFETCH_COALESCE_MS,
  REFETCH_COALESCE_MAX_WAIT_MS,
} from "../lib/refetch-coalescer";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    unit(name: string) {
      return vi.fn(() => {
        calls.push(name);
      });
    },
  };
}

describe("the refetch scheduler's burst coalescing", () => {
  it("collapses a burst of the same unit into one run", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    for (let i = 0; i < 10; i++) scheduler.schedule("done", done);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("runs each distinct unit once in one pass for a burst of several", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    const links = recorder().unit("links");
    const groups = recorder().unit("groups");
    scheduler.schedule("done", done);
    scheduler.schedule("links", links);
    scheduler.schedule("done", done);
    scheduler.schedule("groups", groups);
    scheduler.schedule("links", links);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(done).toHaveBeenCalledTimes(1);
    expect(links).toHaveBeenCalledTimes(1);
    expect(groups).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest callback when a unit reschedules inside the burst", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const first = vi.fn();
    const second = vi.fn();
    scheduler.schedule("done", first);
    scheduler.schedule("done", second);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not fire early: a single schedule waits the full delay", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    scheduler.schedule("done", done);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("the refetch scheduler's bounding", () => {
  it("fires within the max wait even when signals keep arriving", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    // A signal every 40ms would starve a plain trailing debounce forever;
    // the last signal here lands exactly at the max-wait mark, so the pass
    // must fire no later than that arrival.
    for (let elapsed = 0; elapsed <= REFETCH_COALESCE_MAX_WAIT_MS; elapsed += 40) {
      scheduler.schedule("done", done);
      vi.advanceTimersByTime(40);
    }
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh pass for signals that arrive after a pass ran", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    scheduler.schedule("done", done);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(done).toHaveBeenCalledTimes(1);
    scheduler.schedule("done", done);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS + REFETCH_COALESCE_MAX_WAIT_MS);
    expect(done).toHaveBeenCalledTimes(2);
  });
});

describe("the refetch scheduler's resilience", () => {
  it("runs the remaining units when one refetch throws synchronously", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const links = recorder().unit("links");
    scheduler.schedule("done", () => {
      throw new Error("sync failure");
    });
    scheduler.schedule("links", links);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(links).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("the refetch scheduler's dispose", () => {
  it("cancels pending units without running them", () => {
    const scheduler = createRefetchScheduler(REFETCH_COALESCE_MS);
    const done = recorder().unit("done");
    scheduler.schedule("done", done);
    scheduler.dispose();
    vi.advanceTimersByTime(REFETCH_COALESCE_MAX_WAIT_MS * 2);
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // The scheduler stays usable after dispose (an unmount/remount cycle):
    // scheduling again arms a fresh pass.
    scheduler.schedule("done", done);
    vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
});