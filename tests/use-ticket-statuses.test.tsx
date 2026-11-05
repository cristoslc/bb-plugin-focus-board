// @vitest-environment jsdom
// Issue #92: a ticket chip's status dot froze at whatever the first fetch
// saw — the refetch ran only when the visible ref set changed, so a PR
// merging (same ref, new state in the plugin's cache) never reached the
// chip. The hook must also refetch on a poll interval and on window
// focus: change the mocked cache state between two ticks with the ref
// set unchanged and the dot has to update. Issue #205 adds the operator
// moments on top: a refresh-signal bump (the app fingerprints pane
// open/close, lane transitions, and re-sorts) refetches immediately.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  TICKET_STATUS_TIMEOUT_MS,
  useTicketStatuses,
  type TrackerStatusRpc,
} from "../hooks/use-ticket-statuses";
import { IDLE_CALLBACK_FALLBACK_MS } from "../lib/idle-callback";

const REF_KEY = "o/r#91";
const REF = 91;
const POLL_MS = 30_000;

/**
 * The mount fetch's idle gate (issue #373): the hook's fetches issued before
 * its first snapshot landed ride the idle seam, whose jsdom path is the
 * fallback timer. Every test with a mount fetch advances to that wall first;
 * the law each moved assertion still proves is the poll firing and the state
 * landing — the timing moved to the ceiling, nothing else.
 */
const FIRE_IDLE = IDLE_CALLBACK_FALLBACK_MS + 5;
async function fireIdleFetch(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(FIRE_IDLE);
  });
}

/** Mutable fake plugin cache behind a controllable rpc mock. */
function makeRpcMock() {
  const cache: Record<number, { kind: string; state: string }> = {
    [REF]: { kind: "pull", state: "OPEN" },
  };
  const resolvers: Array<(v: { statuses: Record<number, { kind: string; state: string }> }) => void> = [];
  const calls: Array<{ repo: string; numbers: number[] }> = [];
  const rpc: TrackerStatusRpc = {
    call: (_method, input) => {
      calls.push(input);
      return new Promise((resolve) => {
        resolvers.push((state) => resolve({ statuses: { ...state } }));
      });
    },
  };
  const settleAll = async (): Promise<void> => {
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(cache);
    });
  };
  return { rpc, cache, calls, resolvers, settleAll };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTicketStatuses refreshing behavior (issue #92)", () => {
  it("a cache state change between two ticks updates the statuses with the ref set unchanged", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "OPEN" } },
    });

    // The PR merges: only the cache changes, the ref set is identical.
    mock.cache[REF] = { kind: "pull", state: "MERGED" };

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "MERGED" } },
    });
  });

  it("refetches when the window regains focus, ref set unchanged", async () => {
    const mock = makeRpcMock();
    renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    const callsAfterFirstFetch = mock.calls.length;

    mock.cache[REF] = { kind: "pull", state: "CLOSED" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await mock.settleAll();
    expect(mock.calls.length).toBe(callsAfterFirstFetch + 1);
  });

  it("an interval tick skips while a fetch is still in flight (no overlapping calls)", async () => {
    const mock = makeRpcMock();
    renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    expect(mock.calls.length).toBe(1);
    // A focus refetch starts five seconds before a poll tick and hangs well
    // past it — still inside issue #214's timeout window, so the tick must
    // skip rather than overlap the in-flight call...
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS - 5_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mock.calls.length).toBe(2);
    // ...and the next tick, after that call has been given up on, refetches.
    await act(async () => {
      vi.advanceTimersByTime(TICKET_STATUS_TIMEOUT_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    expect(mock.calls.length).toBe(3);
  }, 10_000);

  it("an empty ref set clears statuses and never calls the RPC", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: "" } },
    );
    expect(result.current).toEqual({});
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    expect(mock.calls.length).toBe(0);
  });

  it("a visible-ref key change still refetches with the new refs (pre-existing behavior)", async () => {
    const mock = makeRpcMock();
    mock.cache[REF] = { kind: "pull", state: "MERGED" };
    const { rerender } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    expect(mock.calls[0]).toEqual({ repo: "o/r", numbers: [REF] });

    rerender({ k: "o/r#91,o/r#92" });
    await mock.settleAll();
    expect(mock.calls[1]).toEqual({ repo: "o/r", numbers: [91, 92] });
  });

  it("a key change back to the empty set clears statuses", async () => {
    const mock = makeRpcMock();
    const { rerender, result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    expect(result.current).not.toEqual({});

    rerender({ k: "" });
    expect(result.current).toEqual({});
  });

  it("unmount stops the poll interval (no calls after cleanup)", async () => {
    const mock = makeRpcMock();
    const { unmount } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    const callsAtUnmount = mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 3);
    });
    expect(mock.calls.length).toBe(callsAtUnmount);
  });
});

describe("useTicketStatuses refresh triggers (issue #205)", () => {
  it("a refresh-signal bump refetches with the ref set unchanged", async () => {
    const mock = makeRpcMock();
    const { result, rerender } = renderHook(
      ({ k, s }: { k: string; s: string }) =>
        useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k, refreshSignal: s }),
      { initialProps: { k: REF_KEY, s: "before" } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "OPEN" } },
    });

    // The board repainted (a lane transition or a re-sort): only the
    // display fingerprint changes, the ref set is identical.
    mock.cache[REF] = { kind: "pull", state: "MERGED" };
    rerender({ k: REF_KEY, s: "after" });
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "MERGED" } },
    });
  });

  it("a fingerprint-equal rerender never refetches", async () => {
    const mock = makeRpcMock();
    const { rerender } = renderHook(
      ({ k, s }: { k: string; s: string }) =>
        useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k, refreshSignal: s }),
      { initialProps: { k: REF_KEY, s: "same" } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    const callsAfterFirstFetch = mock.calls.length;
    rerender({ k: REF_KEY, s: "same" });
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS / 2); // well before the next poll tick
    });
    expect(mock.calls.length).toBe(callsAfterFirstFetch);
  });

  it("a signal bump inside the poll cadence still refetches (operator moments do not wait)", async () => {
    const mock = makeRpcMock();
    const { rerender } = renderHook(
      ({ k, s }: { k: string; s: string }) =>
        useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k, refreshSignal: s }),
      { initialProps: { k: REF_KEY, s: "a" } },
    );
    await fireIdleFetch();
    await mock.settleAll();
    const callsAfterFirstFetch = mock.calls.length;
    // Pane opened a second after the last fetch: the bump lands immediately.
    rerender({ k: REF_KEY, s: "b" });
    await mock.settleAll();
    expect(mock.calls.length).toBe(callsAfterFirstFetch + 1);
  });
});

describe("useTicketStatuses hung-call degradation (issue #214)", () => {
  /** Two-repo fake cache behind a controllable rpc mock whose calls may
   *  hang forever or reject late, settled per repo or all at once. */
  function makeTwoRepoRpcMock() {
    const state: Record<
      string,
      Record<number, { kind: string; state: string }>
    > = {
      "o/a": { 91: { kind: "pull", state: "MERGED" } },
      "o/b": { 7: { kind: "pull", state: "OPEN" } },
    };
    const calls: Array<{ repo: string; numbers: number[] }> = [];
    const calls_ = calls as Array<{ repo: string; numbers: number[] }>;
    const settle: Array<{
      resolve: () => void;
      reject: (e: unknown) => void;
      repo: () => string;
    }> = [];
    const rpc: TrackerStatusRpc = {
      call: (_method, input) => {
        calls_.push(input);
        return new Promise((resolve, reject) => {
          settle.push({
            repo: () => input.repo,
            resolve: () => resolve({ statuses: { ...state[input.repo] } }),
            reject,
          });
        });
      },
    };
    const resolveRepo = async (repo: string): Promise<void> => {
      await act(async () => {
        for (const s of settle.splice(0)) {
          if (s.repo() === repo) s.resolve();
          else settle.push(s);
        }
      });
    };
    const resolveAll = async (): Promise<void> => {
      await act(async () => {
        for (const s of settle.splice(0)) s.resolve();
      });
    };
    const rejectAll = async (): Promise<void> => {
      await act(async () => {
        for (const s of settle.splice(0)) s.reject(new Error("late transport"));
      });
    };
    return { rpc, calls, state, resolveRepo, resolveAll, rejectAll };
  }

  it("a call that never settles frees the guard, and the next poll tick refetches", async () => {
    const mock = makeTwoRepoRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: "o/a#91" } },
    );
    // Moved to the idle wall (issue #373): the mount fetch now fires at the
    // seam's fallback ceiling. The law is unchanged: the call was issued, and
    // the state (here the degraded-to-empty snapshot) lands.
    await fireIdleFetch();
    expect(mock.calls.length).toBe(1);
    // The transport never answers: at the timeout wall the guard has freed
    // and the hung repo degrades to "no status known".
    await act(async () => {
      vi.advanceTimersByTime(TICKET_STATUS_TIMEOUT_MS + 5);
    });
    expect(result.current["o/a"]?.[91]).toBeUndefined();
    // The next poll tick refetches instead of skipping forever. The advance
    // stops exactly at the tick (the tick's own call still has its full 8s
    // wall ahead) so the refetch can answer like a real transport.
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS - TICKET_STATUS_TIMEOUT_MS - 5);
    });
    expect(mock.calls.length).toBe(2);
    // Settling the refetch paints the hung-again statuses.
    await mock.resolveAll();
    expect(result.current).toEqual({
      "o/a": { 91: { kind: "pull", state: "MERGED" } },
    });
  });

  it("repo A resolving while repo B hangs still paints repo A's statuses", async () => {
    const mock = makeTwoRepoRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: "o/a#91,o/b#7" } },
    );
    await fireIdleFetch();
    expect(mock.calls.length).toBe(2);
    await mock.resolveRepo("o/a");
    // Repo B hangs; at the timeout wall the batch settles on its leg and
    // what answered paints.
    await act(async () => {
      vi.advanceTimersByTime(TICKET_STATUS_TIMEOUT_MS + 5);
    });
    expect(result.current["o/a"]?.[91]).toEqual({ kind: "pull", state: "MERGED" });
    expect(result.current["o/b"]?.[7]).toBeUndefined();
  });

  it("the timed-out call must not reject unhandled across a rerender", async () => {
    const mock = makeTwoRepoRpcMock();
    const { rerender, result } = renderHook(
      ({ k, s }: { k: string; s: string }) =>
        useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k, refreshSignal: s }),
      { initialProps: { k: "o/a#91", s: "a" } },
    );
    // The idle fire first (issue #373), then the timeout wall from the call's
    // own start; the transport then answers late with a rejection.
    await fireIdleFetch();
    await act(async () => {
      vi.advanceTimersByTime(TICKET_STATUS_TIMEOUT_MS + 5);
    });
    await mock.rejectAll();
    // The operator-moment bump refetches across the late rejection. No
    // unhandled rejection may surface on either path (vitest fails this
    // test on any unhandledRejection).
    rerender({ k: "o/a#91", s: "b" });
    await mock.resolveAll();
    expect(result.current).toEqual({
      "o/a": { 91: { kind: "pull", state: "MERGED" } },
    });
  });
});