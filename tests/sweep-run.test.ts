// The sweep confirm loop must archive EVERY captured candidate, and it must
// do so strictly one at a time. The host's sidebar archive action aborts the
// previous in-flight archive when a new one starts (a single-slot design for
// one row at a time), so a synchronous loop over `actions.archive` archives
// only the last candidate — observed 2026-10-01: sweeping 4 Done threads
// archived exactly one, with one toast. The runner awaits each archive before
// starting the next, which is the contract the host path cannot give us.
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
    const archive = vi.fn((threadId: string) => {
      calls.push(threadId);
      return threadId === "thr_a" ? gate.promise : Promise.resolve({ ok: true });
    });
    const run = runSweepArchive(["thr_a", "thr_b", "thr_c"], { archive });
    // Flush microtasks: the runner must still be waiting on thr_a.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["thr_a"]);
    gate.release();
    const failures = await run;
    expect(calls).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(failures).toEqual([]);
  });

  it("collects a failed archive and still archives the rest", async () => {
    const archive = vi.fn((threadId: string) =>
      threadId === "thr_bad"
        ? Promise.reject(new Error("host refused"))
        : Promise.resolve({ ok: true }),
    );
    const failures = await runSweepArchive(
      ["thr_ok1", "thr_bad", "thr_ok2"],
      { archive },
    );
    expect(archive).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([{ threadId: "thr_bad", message: "host refused" }]);
  });

  it("names non-Error rejections in the failure list", async () => {
    const failures = await runSweepArchive(["thr_x"], {
      archive: () => Promise.reject("boom"),
    });
    expect(failures).toEqual([{ threadId: "thr_x", message: "boom" }]);
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
