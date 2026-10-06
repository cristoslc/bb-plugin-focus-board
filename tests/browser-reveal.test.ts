// The board card's "Reveal browser tab" action contract (issue #17).
//
// bb's own reveal contract: `desktop.browser.reveal_tab` opens the
// controlled tab's side panel only when the owning thread is already
// focused, and reports `{ok: true}` even when it no-ops silently
// (`presentation: "hidden"` persists). From the Focus Board the owning
// thread is by definition NOT focused, so a naive reveal call can never
// surface anything. This module is the compensating one-step gesture:
// discover the thread's controlled tabs, focus the owning thread FIRST,
// then reveal, then re-read the presentation truth and RE-REVEAL what
// stayed hidden — so the board can be honest about a failed surface
// instead of trusting the core's `{ok: true}`.
//
// The orchestration takes injected ports (hosts/instances/tabs/reveal/
// focus/settle) so these tests pin the exact calls without a host or an
// SDK. `buildBrowserRevealPorts` is the SDK adapter — tested below with
// a fake sdk/navigate to pin the scopes forwarded to the real surfaces.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserRevealPorts,
  revealThreadBrowserTabs,
  REVEAL_RETRY_DELAY_MS,
  REVEAL_SETTLE_MS,
  REVEAL_VERIFY_ATTEMPTS,
  type BrowserRevealPorts,
} from "../lib/browser-reveal";

type Presentation = "hidden" | "reveal";

interface FakeInstance {
  hostId: string;
  generation: string;
  instanceId: string;
}

interface FakeTab {
  hostId: string;
  generation: string;
  instanceId: string;
  tabId: string;
  threadId: string;
  presentation: Presentation;
}

interface FakePortsOptions {
  instances: FakeInstance[];
  tabs: FakeTab[];
  /**
   * Mutation hook run on each `reveal` call, before the orchestrator's
   * next verification read — the test drives whether (and when) the
   * tab actually surfaces, modeling the host's race/no-op: a reveal
   * that lands reads back "reveal", a silent no-op never does.
   */
  onReveal?: (state: FakeTab[], target: { tabId: string }, call: number) => void;
  failConnectedHostIds?: string;
  failInstances?: string;
  failThreadTabs?: string;
}

interface FakeTabRecord {
  tabId: string;
  threadId: string;
  presentation: Presentation;
}

function fakePorts(options: FakePortsOptions) {
  const { instances, tabs, onReveal, ...failures } = options;
  const state = tabs.map((tabItem) => ({ ...tabItem }));
  const log: string[] = [];
  let revealCalls = 0;
  const ports: BrowserRevealPorts = {
    async connectedHostIds() {
      if (failures.failConnectedHostIds !== undefined) {
        throw new Error(failures.failConnectedHostIds);
      }
      log.push("hosts");
      return [...new Set(instances.map((instanceItem) => instanceItem.hostId))];
    },
    async instances(hostId) {
      if (failures.failInstances !== undefined) throw new Error(failures.failInstances);
      log.push(`instances ${hostId}`);
      return instances
        .filter((instanceItem) => instanceItem.hostId === hostId)
        .map(({ generation, instanceId }) => ({ generation, instanceId }));
    },
    async threadTabs(args) {
      if (failures.failThreadTabs !== undefined) throw new Error(failures.failThreadTabs);
      log.push(`tabs ${args.threadId} ${args.instanceId}`);
      // The scope is thread-keyed, but the reader still filters defensively:
      // the orchestrator may only ever act on the ONE thread's tabs.
      return state
        .filter(
          (tabItem) =>
            tabItem.hostId === args.hostId &&
            tabItem.generation === args.generation &&
            tabItem.instanceId === args.instanceId &&
            tabItem.threadId === args.threadId,
        )
        .map(({ tabId, threadId, presentation }): FakeTabRecord => ({ tabId, threadId, presentation }));
    },
    async reveal(args) {
      log.push(`reveal ${args.tabId} @ ${args.instanceId}`);
      revealCalls += 1;
      onReveal?.(state, args, revealCalls);
    },
    focusThread(threadId) {
      log.push(`focus ${threadId}`);
    },
    async delay() {
      log.push("delay");
    },
  };
  return { ports, log, state };
}

function instance(hostId: string, instanceId: string): FakeInstance {
  return { hostId, generation: `gen-${hostId}-${instanceId}`, instanceId };
}

function tab(
  target: FakeInstance,
  tabId: string,
  threadId: string,
  presentation: Presentation,
): FakeTab {
  return {
    hostId: target.hostId,
    generation: target.generation,
    instanceId: target.instanceId,
    tabId,
    threadId,
    presentation,
  };
}

const INSTANCES = [instance("local", "win41"), instance("remote", "win7")];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("revealThreadBrowserTabs", () => {
  it("focuses the owning thread first, then reveals its hidden tab, and reports it revealed", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", "hidden")],
      onReveal: (state) => {
        // A reveal that lands: the tab presents (and stays presented).
        state[0]!.presentation = "reveal";
      },
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    // Order IS the fix: discovery happens first (a thread with no tabs must
    // not steal focus), the owning thread's conversation view must be focused
    // before the first reveal (core's precondition), and a settle wait
    // bridges the router's async focus application.
    expect(log).toEqual([
      "hosts",
      "instances local",
      "tabs thr_a win41",
      "focus thr_a",
      "delay",
      "reveal t1 @ win41",
      "tabs thr_a win41", // verification re-read
    ]);
    expect(result.discovered).toHaveLength(1);
    expect(result.revealed.map((entry) => entry.tabId)).toEqual(["t1"]);
    expect(result.stillHidden).toEqual([]);
  });

  it("re-reveals a tab that stayed hidden right after focus (the router race)", async () => {
    const win41 = instance("local", "win41");
    // The host no-ops the first reveal (thread view not focused yet); the
    // second lands. The orchestrator must re-read, wait, and re-reveal.
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", "hidden")],
      onReveal: (state, target, call) => {
        if (call >= 2) {
          const landed = state.find((entry) => entry.tabId === target.tabId);
          if (landed !== undefined) landed.presentation = "reveal";
        }
      },
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toEqual([
      "hosts",
      "instances local",
      "tabs thr_a win41",
      "focus thr_a",
      "delay",
      "reveal t1 @ win41",
      "tabs thr_a win41", // still hidden
      "delay", // retry wait
      "reveal t1 @ win41", // second attempt lands
      "tabs thr_a win41", // now visible
    ]);
    expect(result.revealed.map((entry) => entry.tabId)).toEqual(["t1"]);
    expect(result.stillHidden).toEqual([]);
  });

  it("a tab that never surfaces is reported stillHidden, never claimed as revealed", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", "hidden")],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    // Every verification round ran...
    expect(log.filter((entry) => entry.startsWith("reveal "))).toHaveLength(
      REVEAL_VERIFY_ATTEMPTS,
    );
    // ...each retry waited, on top of the post-focus settle...
    expect(log.filter((entry) => entry === "delay")).toHaveLength(1 + REVEAL_VERIFY_ATTEMPTS - 1);
    // ...and the report names the tab as still hidden rather than lying.
    expect(result.revealed).toEqual([]);
    expect(result.stillHidden.map((entry) => entry.tabId)).toEqual(["t1"]);
  });

  it("a thread with no controlled tabs never steals focus or fires a reveal", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_other", "hidden")],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toEqual(["hosts", "instances local", "tabs thr_a win41"]);
    expect(result.discovered).toEqual([]);
    expect(result.revealed).toEqual([]);
    expect(result.stillHidden).toEqual([]);
  });

  it("an already-presented tab still goes through the reveal call — the gesture selects it", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", "reveal")],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toContain("focus thr_a");
    expect(log).toContain("reveal t1 @ win41");
    expect(result.revealed.map((entry) => entry.tabId)).toEqual(["t1"]);
    expect(result.stillHidden).toEqual([]);
  });

  it("sweeps every host and instance, revealing each controlled tab with its own scope", async () => {
    const { ports, log } = fakePorts({
      instances: INSTANCES,
      tabs: [
        tab(INSTANCES[0]!, "t1", "thr_a", "hidden"),
        tab(INSTANCES[0]!, "t2", "thr_a", "hidden"),
        tab(INSTANCES[1]!, "t3", "thr_a", "hidden"),
      ],
      onReveal: (state, target) => {
        const landed = state.find((entry) => entry.tabId === target.tabId);
        if (landed !== undefined) landed.presentation = "reveal";
      },
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    const reveals = log.filter((entry) => entry.startsWith("reveal "));
    expect(reveals).toEqual([
      "reveal t1 @ win41",
      "reveal t2 @ win41",
      "reveal t3 @ win7",
    ]);
    expect(result.discovered).toHaveLength(3);
    expect(result.revealed).toHaveLength(3);
    expect(result.stillHidden).toEqual([]);
    expect(log.filter((entry) => entry.startsWith("tabs "))).toHaveLength(4);
  });

  it("listing failures throw with the failure named — the board can tell the operator why", async () => {
    const win41 = instance("local", "win41");
    const base = { instances: [win41], tabs: [tab(win41, "t1", "thr_a", "hidden")] };

    await expect(
      revealThreadBrowserTabs(fakePorts({ ...base, failConnectedHostIds: "hosts down" }).ports, "thr_a"),
    ).rejects.toThrow("hosts down");
    await expect(
      revealThreadBrowserTabs(fakePorts({ ...base, failInstances: "no daemon" }).ports, "thr_a"),
    ).rejects.toThrow("no daemon");
    await expect(
      revealThreadBrowserTabs(fakePorts({ ...base, failThreadTabs: "tabs unreachable" }).ports, "thr_a"),
    ).rejects.toThrow("tabs unreachable");
  });

  it("the retry bound and settle waits are real, positive values", () => {
    expect(REVEAL_VERIFY_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(REVEAL_SETTLE_MS).toBeGreaterThan(0);
    expect(REVEAL_RETRY_DELAY_MS).toBeGreaterThan(0);
  });
});

describe("buildBrowserRevealPorts (SDK adapter)", () => {
  function fakeSdk() {
    const hostsList = vi.fn(async () => [
      { id: "host_local", status: "connected" },
      { id: "host_down", status: "disconnected" },
    ]);
    const listInstances = vi.fn(async ({ hostId }: { hostId: string }) => ({
      instances:
        hostId === "host_local"
          ? [{ generation: "g1", instanceId: "win41", label: "BB window 41" }]
          : [],
    }));
    const listTabs = vi.fn(async () => ({
      tabs: [
        {
          tabId: "t1",
          threadId: "thr_a",
          title: "Example",
          url: "https://example.test/",
          presentation: "reveal",
          control: null,
        },
      ],
    }));
    const revealTab = vi.fn(async () => ({ ok: true as const }));
    const toThread = vi.fn();
    return {
      sdk: {
        hosts: { list: hostsList },
        experimental_desktopBrowsers: { listInstances, listTabs, revealTab },
      },
      navigate: { toThread },
      spies: { hostsList, listInstances, listTabs, revealTab, toThread },
    };
  }

  it("routes connected hosts only, and forwards each SDK call with the exact scope", async () => {
    const fake = fakeSdk();
    const ports = buildBrowserRevealPorts(fake.sdk as never, fake.navigate as never);

    expect(await ports.connectedHostIds()).toEqual(["host_local"]);

    expect(await ports.instances("host_local")).toEqual([
      { generation: "g1", instanceId: "win41" },
    ]);
    expect(fake.spies.listInstances.mock.calls[0]).toEqual([{ hostId: "host_local" }]);

    expect(
      await ports.threadTabs({
        hostId: "host_local",
        generation: "g1",
        instanceId: "win41",
        threadId: "thr_a",
      }),
    ).toEqual([{ tabId: "t1", threadId: "thr_a", presentation: "reveal" }]);
    expect(fake.spies.listTabs.mock.calls[0]).toEqual([
      { generation: "g1", hostId: "host_local", instanceId: "win41", threadId: "thr_a" },
    ]);

    await ports.reveal({
      hostId: "host_local",
      generation: "g1",
      instanceId: "win41",
      tabId: "t1",
      threadId: "thr_a",
    });
    expect(fake.spies.revealTab.mock.calls[0]).toEqual([
      { generation: "g1", hostId: "host_local", instanceId: "win41", tabId: "t1", threadId: "thr_a" },
    ]);

    ports.focusThread("thr_a");
    expect(fake.spies.toThread.mock.calls[0]).toEqual(["thr_a"]);
  });

  it("the adapters' connectedHostIds drops disconnected hosts", async () => {
    const fake = fakeSdk();
    const ports = buildBrowserRevealPorts(fake.sdk as never, fake.navigate as never);
    expect(await ports.connectedHostIds()).toEqual(["host_local"]);
  });

  it("delay is a real timer the retry pauses on", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSdk();
      const ports = buildBrowserRevealPorts(fake.sdk as never, fake.navigate as never);
      const settled = ports.delay(REVEAL_RETRY_DELAY_MS);
      let settledLength = 0;
      void settled.then(() => {
        settledLength += 1;
      });
      vi.advanceTimersByTime(REVEAL_RETRY_DELAY_MS - 1);
      expect(settledLength).toBe(0);
      vi.advanceTimersByTime(1);
      await expect(settled).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});