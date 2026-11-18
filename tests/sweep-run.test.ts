// The sweep confirm loop applies the sweep's per-thread gesture (archive,
// mark Done, unpin, mark read) to EVERY captured candidate, strictly one at
// a time. The host's sidebar actions run one row at a time (a new write
// aborts the previous in-flight one), so a synchronous loop over the action
// applies only the last candidate — observed 2026-10-01: sweeping 4 Done
// threads archived exactly one, with one toast. The runner awaits each
// gesture before starting the next, which is the contract the host path
// cannot give us.
//
// The runner is also cancellable: a cancel between gestures stops the loop
// and reports what it never started. The gesture already in flight always
// finishes — cancel means "no more", not "yank the current one".
import { describe, expect, it, vi } from "vitest";
import { runSweep } from "../lib/sweep";

/** A promise resolved by hand, for gating the runner mid-loop. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("runSweep archives every candidate, one at a time", () => {
  it("starts the next archive only after the previous one settles", async () => {
    const gate = deferred();
    const calls: string[] = [];
    let releaseFirst = () => {};
    const first = new Promise<void>((r) => { releaseFirst = r; });
    const archive = vi.fn((threadId: string) => {
      calls.push(threadId);
      return threadId === "thr_a" ? first.then(() => ({ ok: true })) : Promise.resolve({ ok: true });
    });
    const run = runSweep(["thr_a", "thr_b", "thr_c"], { act: archive });
    // Flush microtasks: the runner must still be waiting on thr_a.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["thr_a"]);
    releaseFirst();
    const result = await run;
    expect(calls).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(result).toEqual({
      failures: [],
      cancelled: false,
      remaining: [],
      swept: ["thr_a", "thr_b", "thr_c"],
    });
  });

  it("collects a failed archive and still archives the rest", async () => {
    const archive = vi.fn((threadId: string) =>
      threadId === "thr_bad"
        ? Promise.reject(new Error("host refused"))
        : Promise.resolve({ ok: true }),
    );
    const result = await runSweep(
      ["thr_ok1", "thr_bad", "thr_ok2"],
      { act: archive },
    );
    expect(archive).toHaveBeenCalledTimes(3);
    expect(result.failures).toEqual([{ threadId: "thr_bad", message: "host refused" }]);
    expect(result.cancelled).toBe(false);
  });

  it("reports exactly the ids whose gestures resolved", async () => {
    const result = await runSweep(["thr_ok1", "thr_bad", "thr_ok2"], {
      act: (threadId: string) =>
        threadId === "thr_bad"
          ? Promise.reject(new Error("host refused"))
          : Promise.resolve({ ok: true }),
    });
    expect(result.swept).toEqual(["thr_ok1", "thr_ok2"]);
  });

  it("a cancelled run still names the ids it did archive", async () => {
    const result = await runSweep(["thr_a", "thr_b", "thr_c"], {
      act: () => Promise.resolve({ ok: true }),
      shouldContinue: () => false,
    });
    expect(result.swept).toEqual(["thr_a"]);
    expect(result.remaining).toEqual(["thr_b", "thr_c"]);
  });

  it("names non-Error rejections in the failure list", async () => {
    const result = await runSweep(["thr_x"], {
      act: () => Promise.reject("boom"),
    });
    expect(result.failures).toEqual([{ threadId: "thr_x", message: "boom" }]);
  });

  it("fires onActive before each archive and onSettled after it", async () => {
    const events: string[] = [];
    await runSweep(["thr_a", "thr_b"], {
      act: async (threadId: string) => {
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

describe("runSweep batching", () => {
  /** A promise resolved by hand, per id. */
  function gate() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  it("runs up to `concurrency` gestures at once and reports each batch once", async () => {
    const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
    const started: string[] = [];
    const batches: string[][] = [];
    const run = runSweep(["a", "b", "c", "d", "e"], {
      concurrency: 3,
      act: (threadId) => {
        started.push(threadId);
        const gateFor = gate();
        gates.set(threadId, gateFor);
        return gateFor.promise;
      },
      onBatchSettled: (ids) => batches.push([...ids]),
    });
    await Promise.resolve();
    await Promise.resolve();
    // The first window is in flight; nothing past it has started.
    expect(started).toEqual(["a", "b", "c"]);
    for (const id of ["c", "b", "a"]) gates.get(id)!.release();
    // The second window opens only once the first has fully settled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    for (const id of ["d", "e"]) gates.get(id)!.release();
    await run;
    expect(batches).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("names one failure inside a batch and never counts it as swept", async () => {
    const batches: string[][] = [];
    const result = await runSweep(["ok1", "bad", "ok2"], {
      concurrency: 3,
      act: (threadId) =>
        threadId === "bad" ? Promise.reject(new Error("host refused")) : Promise.resolve(true),
      onBatchSettled: (ids) => batches.push([...ids]),
    });
    expect(result.swept).toEqual(["ok1", "ok2"]);
    expect(result.failures).toEqual([{ threadId: "bad", message: "host refused" }]);
    expect(result.cancelled).toBe(false);
    expect(batches).toEqual([["ok1", "ok2"]]);
  });

  it("collects a synchronous throw inside a batch like a rejection", async () => {
    const batches: string[][] = [];
    const result = await runSweep(["throws", "ok"], {
      concurrency: 2,
      act: (threadId) => {
        if (threadId === "throws") throw new Error("thrown before the promise");
        return Promise.resolve(true);
      },
      onBatchSettled: (ids) => batches.push([...ids]),
    });
    expect(result.failures).toEqual([
      { threadId: "throws", message: "thrown before the promise" },
    ]);
    expect(result.swept).toEqual(["ok"]);
    expect(batches).toEqual([["ok"]]);
  });

  it("a cancel between batches leaves the unstarted ids remaining", async () => {
    const started: string[] = [];
    let proceed = true;
    const result = await runSweep(["a", "b", "c", "d", "e"], {
      concurrency: 2,
      act: (threadId) => {
        started.push(threadId);
        // The cancel lands while the first batch is in flight: the batch
        // finishes, nothing after it starts.
        if (threadId === "b") proceed = false;
        return Promise.resolve(true);
      },
      shouldContinue: () => proceed,
    });
    expect(started).toEqual(["a", "b"]);
    expect(result.cancelled).toBe(true);
    expect(result.swept).toEqual(["a", "b"]);
    expect(result.remaining).toEqual(["c", "d", "e"]);
  });

  it("an empty confirmed set runs nothing and applies no batch", async () => {
    const act = vi.fn(() => Promise.resolve(true));
    const onBatchSettled = vi.fn();
    const result = await runSweep([], {
      concurrency: 6,
      act,
      onBatchSettled,
    });
    expect(act).not.toHaveBeenCalled();
    expect(onBatchSettled).not.toHaveBeenCalled();
    expect(result).toEqual({ failures: [], cancelled: false, remaining: [], swept: [] });
  });

  it("a batch that settles nothing fires no batch callback", async () => {
    const onBatchSettled = vi.fn();
    const result = await runSweep(["a", "b"], {
      concurrency: 2,
      act: () => Promise.reject(new Error("host refused")),
      onBatchSettled,
    });
    expect(result.failures).toHaveLength(2);
    expect(onBatchSettled).not.toHaveBeenCalled();
  });

  it("without `concurrency` the runner stays strictly one at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    await runSweep(["a", "b", "c"], {
      act: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      },
    });
    expect(peak).toBe(1);
  });
});

describe("runSweep cancellation", () => {
  it("stops before the next archive when shouldContinue turns false", async () => {
    const archive = vi.fn((threadId: string) => Promise.resolve({ ok: true }));
    // The first archive always runs; each subsequent one asks first.
    const continueFlags = [true, false];
    let call = 0;
    const result = await runSweep(["thr_a", "thr_b", "thr_c"], {
      act: archive,
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
    const run = runSweep(["thr_a", "thr_b"], {
      act: archive,
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
    const result = await runSweep(["thr_a"], {
      act: () => Promise.resolve({ ok: true }),
      shouldContinue: () => false,
    });
    expect(result.cancelled).toBe(false);
    expect(result.remaining).toEqual([]);
  });

  it("a cancelled run still reports failures it already collected", async () => {
    const result = await runSweep(["thr_bad", "thr_b"], {
      act: (threadId: string) =>
        threadId === "thr_bad" ? Promise.reject(new Error("refused")) : Promise.resolve({ ok: true }),
      shouldContinue: () => false,
    });
    expect(result.failures).toEqual([{ threadId: "thr_bad", message: "refused" }]);
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toEqual(["thr_b"]);
  });
});
