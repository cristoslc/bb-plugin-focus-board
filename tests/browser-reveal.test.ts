// The board card's "Reveal browser tab" action contract (issue #17).
//
// bb's own reveal contract (`bb guide browser`): the side panel opens
// and selects the tab only when the OWNING thread is already focused;
// otherwise nothing changes on screen. Worse for scripts and agents,
// the surface still answers `{ok: true}` when it no-ops silently — the
// reporting thread watched `bb browser reveal` return ok while
// `bb browser tabs` kept `presentation: "hidden"`.
//
// From the Focus Board the owning thread is never focused, so a naive
// reveal call can never work. This module makes the board do the whole
// gesture: discover the thread's controlled tabs, focus the owning
// thread FIRST (the reveal precondition), settle for the router, then
// reveal.
//
// Deliberately NO post-reveal verification: live evidence (2026-10-06,
// a 2-second poll log in the reporting thread) shows list_tabs'
// `presentation` is a recorded creation attribute, not live panel
// visibility — it stayed "hidden" through a reveal that visibly opened
// the panel, and `create --reveal` reported "hidden" at creation. No
// observable success signal exists in the SDK, so the orchestrator
// claims none: it reports what it targeted and the opened side panel
// is its own feedback. Blank shell tabs (the automation session's
// about:blank carrier) are skipped when a real page tab exists, so the
// panel's selection lands on something with content.
//
// The orchestration takes injected ports (hosts/instances/tabs/reveal/
// focus/settle) so these tests pin the exact calls without a host or
// an SDK. `buildBrowserRevealPorts` is the SDK adapter — tested below
// with a fake sdk/navigate to pin the scopes forwarded to the real
// surfaces.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserRevealPorts,
  isBlankTabUrl,
  revealThreadBrowserTabs,
  REVEAL_SETTLE_MS,
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
  url: string;
  presentation: Presentation;
}

interface FakePortsOptions {
  instances: FakeInstance[];
  tabs: FakeTab[];
  failConnectedHostIds?: string;
  failInstances?: string;
  failThreadTabs?: string;
}

function fakePorts(options: FakePortsOptions) {
  const { instances, tabs, ...failures } = options;
  const state = tabs.map((tabItem) => ({ ...tabItem }));
  const log: string[] = [];
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
        .map(({ tabId, threadId, url, presentation }) => ({
          tabId,
          threadId,
          url,
          presentation,
        }));
    },
    async reveal(args) {
      log.push(`reveal ${args.tabId} @ ${args.instanceId}`);
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
  url: string,
  presentation: Presentation = "hidden",
): FakeTab {
  return {
    hostId: target.hostId,
    generation: target.generation,
    instanceId: target.instanceId,
    tabId,
    threadId,
    url,
    presentation,
  };
}

const ISSUE_URL = "https://github.com/cristoslc/bb-plugin-focus-board/issues/17";
const INSTANCES = [instance("local", "win41"), instance("remote", "win7")];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("revealThreadBrowserTabs", () => {
  it("focuses the owning thread first, then reveals its controlled tab, in one honest pass", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", ISSUE_URL)],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    // Order IS the fix: discovery happens first (a thread with no tabs must
    // not steal focus), the owning thread's conversation view must be focused
    // before the reveal (core's precondition), and a settle wait bridges the
    // router's async focus application. NO reads after the reveal — there is
    // no truthful signal to read (see the module header).
    expect(log).toEqual([
      "hosts",
      "instances local",
      "tabs thr_a win41",
      "focus thr_a",
      "delay",
      "reveal t1 @ win41",
    ]);
    expect(result.discovered).toHaveLength(1);
    expect(result.targeted.map((entry) => entry.tabId)).toEqual(["t1"]);
  });

  it("skips blank shell tabs when a real page tab exists, so the selection lands on the page", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t_blank", "thr_a", "about:blank"), tab(win41, "t_page", "thr_a", ISSUE_URL)],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).not.toContain("reveal t_blank @ win41");
    expect(log).toContain("reveal t_page @ win41");
    expect(result.discovered).toHaveLength(2);
    expect(result.targeted.map((entry) => entry.tabId)).toEqual(["t_page"]);
  });

  it("when every tab is blank, the tabs are still revealed — the panel must show something", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t_blank", "thr_a", "about:blank"), tab(win41, "t_empty", "thr_a", "")],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toContain("reveal t_blank @ win41");
    expect(log).toContain("reveal t_empty @ win41");
    expect(result.targeted).toHaveLength(2);
  });

  it("presentation is carried verbatim but never read as truth — an already-hidden and an already-reveal tab behave the same", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_a", ISSUE_URL, "reveal")],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toContain("reveal t1 @ win41");
    expect(result.targeted).toHaveLength(1);
  });

  it("a thread with no controlled tabs never steals focus or fires a reveal", async () => {
    const win41 = instance("local", "win41");
    const { ports, log } = fakePorts({
      instances: [win41],
      tabs: [tab(win41, "t1", "thr_other", ISSUE_URL)],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log).toEqual(["hosts", "instances local", "tabs thr_a win41"]);
    expect(result.discovered).toEqual([]);
    expect(result.targeted).toEqual([]);
  });

  it("sweeps every host and instance, revealing each controlled tab with its own scope", async () => {
    const { ports, log } = fakePorts({
      instances: INSTANCES,
      tabs: [
        tab(INSTANCES[0]!, "t1", "thr_a", ISSUE_URL),
        tab(INSTANCES[0]!, "t2", "thr_a", "https://bb.dev/other"),
        tab(INSTANCES[1]!, "t3", "thr_a", ISSUE_URL),
      ],
    });
    const result = await revealThreadBrowserTabs(ports, "thr_a");

    expect(log.filter((entry) => entry.startsWith("reveal "))).toEqual([
      "reveal t1 @ win41",
      "reveal t2 @ win41",
      "reveal t3 @ win7",
    ]);
    expect(result.discovered).toHaveLength(3);
    expect(result.targeted).toHaveLength(3);
  });

  it("listing failures throw with the failure named — the board can tell the operator why", async () => {
    const win41 = instance("local", "win41");
    const base = { instances: [win41], tabs: [tab(win41, "t1", "thr_a", ISSUE_URL)] };

    await expect(
      revealThreadBrowserTabs(
        fakePorts({ ...base, failConnectedHostIds: "hosts down" }).ports,
        "thr_a",
      ),
    ).rejects.toThrow("hosts down");
    await expect(
      revealThreadBrowserTabs(fakePorts({ ...base, failInstances: "no daemon" }).ports, "thr_a"),
    ).rejects.toThrow("no daemon");
    await expect(
      revealThreadBrowserTabs(
        fakePorts({ ...base, failThreadTabs: "tabs unreachable" }).ports,
        "thr_a",
      ),
    ).rejects.toThrow("tabs unreachable");
  });

  it("the settle wait is a real, positive value", () => {
    expect(REVEAL_SETTLE_MS).toBeGreaterThan(0);
  });

  it("isBlankTabUrl pins the blank-carrier definition", () => {
    expect(isBlankTabUrl("about:blank")).toBe(true);
    expect(isBlankTabUrl("")).toBe(true);
    expect(isBlankTabUrl("https://bb.dev/")).toBe(false);
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
    ).toEqual([
      { tabId: "t1", threadId: "thr_a", url: "https://example.test/", presentation: "reveal" },
    ]);
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

  it("delay is a real timer", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSdk();
      const ports = buildBrowserRevealPorts(fake.sdk as never, fake.navigate as never);
      const settled = ports.delay(REVEAL_SETTLE_MS);
      vi.advanceTimersByTime(REVEAL_SETTLE_MS - 1);
      // Not settled yet: a promise with no resolution in this window.
      const pending = Promise.race([settled, Promise.resolve("still-pending")]);
      await expect(pending).resolves.toBe("still-pending");
      vi.advanceTimersByTime(1);
      await expect(settled).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});