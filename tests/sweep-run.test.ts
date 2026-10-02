// The sweep confirm loop must archive EVERY captured candidate, and it must
// do so strictly one at a time. The host's sidebar archive action aborts the
// previous in-flight archive when a new one starts (a single-slot design for
// one row at a time), so a synchronous loop over `actions.archive` archives
// only the last candidate — observed 2026-10-01: sweeping 4 Done threads
// archived exactly one, with one toast. The runner awaits each archive before
// starting the next, which is the contract the host path cannot give us.
//
// The runner is also cancellable: a cancel between archives stops the loop
// and reports what it never started. The archive already in flight always
// finishes — cancel means "no more", not "yank the current one".
import { describe, expect, it, vi } from "vitest";
import { runSweepArchive } from "../lib/sweep";

/** A promise resolved by hand, for gating the runner mid-loop. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("runSweepArchive archives every candidate, one at a time", () => {
  it("starts the next archive only after the previous one settles", async () => {
    const gate = deferred();
    const calls: string[] = [];
    let releaseFirst = () => {};
    const first = new Promise<void>((r) => { releaseFirst = r; });
    const archive = vi.fn((threadId: string) => {
      calls.push(threadId);
      return threadId === "thr_a" ? first.then(() => ({ ok: true })) : Promise.resolve({ ok: true });
    });
    const run = runSweepArchive(["thr_a", "thr_b", "thr_c"], { archive });
    // Flush microtasks: the runner must still be waiting on thr_a.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["thr_a"]);
    releaseFirst();
    const result = await run;
    expect(calls).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(result).toEqual({ failures: [], cancelled: false, remaining: [] });
  });

  it("collects a failed archive and still archives the rest", async () => {
    const archive = vi.fn((threadId: string) =>
      threadId === "thr_bad"
        ? Promise.reject(new Error("host refused"))
        : Promise.resolve({ ok: true }),
    );
    const result = await runSweepArchive(
      ["thr_ok1", "thr_bad", "thr_ok2"],
      { archive },
    );
    expect(archive).toHaveBeenCalledTimes(3);
    expect(result.failures).toEqual([{ threadId: "thr_bad", message: "host refused" }]);
    expect(result.cancelled).toBe(false);
  });

  it("names non-Error rejections in the failure list", async () => {
    const result = await runSweepArchive(["thr_x"], {
      archive: () => Promise.reject("boom"),
    });
    expect(result.failures).toEqual([{ threadId: "thr_x", message: "boom" }]);
  });

  it("fires onActive before each archive and onSettled after it", async () => {
    const events: string[] = [];
    await runSweepArchive(["thr_a", "thr_b"], {
      archive: async (threadId: string) => {
        events.push(`archive:${threadId}`);
      },
      onActive: (threadId) => events.push(`active:${threadId}`),
      onSettled: (threadId) => events.push(`settled:${threadId}`),
    });
    expect(events).toEqual([
      "active:thr_a",
      "archive:thr_a",
      "settled:thr_a",
      "active:thr_b",
      "archive:thr_b",
      "settled:thr_b",
    ]);
  });
});

describe("runSweepArchive cancellation", () => {
  it("stops before the next archive when shouldContinue turns false", async () => {
    const archive = vi.fn((threadId: string) => Promise.resolve({ ok: true }));
    // The first archive always runs; each subsequent one asks first.
    const continueFlags = [true, false];
    let call = 0;
    const result = await runSweepArchive(["thr_a", "thr_b", "thr_c"], {
      archive,
      shouldContinue: () => continueFlags[call++] ?? false,
    });
    // thr_a and thr_b ran; the check before thr_c said stop.
    expect(archive).toHaveBeenCalledTimes(2);
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toEqual(["thr_c"]);
    expect(result.failures).toEqual([]);
  });

  it("the in-flight archive finishes before the cancel takes hold", async () => {
    const gate = deferred();
    const archive = vi.fn(() => gate.promise);
    let proceed = true;
    const run = runSweepArchive(["thr_a", "thr_b"], {
      archive,
      shouldContinue: () => proceed,
    });
    proceed = false; // cancel while thr_a is still in flight
    gate.release();
    const result = await run;
    expect(archive).toHaveBeenCalledTimes(1); // thr_b never started
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toEqual(["thr_b"]);
  });

  it("a cancel that lands after the last archive is just a normal completion", async () => {
    const result = await runSweepArchive(["thr_a"], {
      archive: () => Promise.resolve({ ok: true }),
      shouldContinue: () => false,
    });
    expect(result.cancelled).toBe(false);
    expect(result.remaining).toEqual([]);
  });

  it("a cancelled run still reports failures it already collected", async () => {
    const result = await runSweepArchive(["thr_bad", "thr_b"], {
      archive: (threadId: string) =>
        threadId === "thr_bad" ? Promise.reject(new Error("refused")) : Promise.resolve({ ok: true }),
      shouldContinue: () => false,
    });
    expect(result.failures).toEqual([{ threadId: "thr_bad", message: "refused" }]);
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toEqual(["thr_b"]);
  });
});
