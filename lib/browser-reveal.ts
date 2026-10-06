// One-step "surface a thread's controlled browser tab" from the board
// (issue #17).
//
// bb's documented reveal contract (`bb guide browser`): the side panel
// opens and selects the tab only when the OWNING thread is already
// focused; otherwise nothing changes on screen. Worse for scripts and
// agents, the surface still answers `{ok: true}` when it no-ops, so a
// caller cannot tell success from a silent no-op — the reporting thread
// watched `bb browser reveal` return ok while `bb browser tabs` kept
// `presentation: "hidden"`.
//
// From the Focus Board the owning thread is never focused, so a naive
// reveal call can never work. This module makes the board do the whole
// gesture the operator actually wants:
//
//   1. scan the connected hosts' desktop-browser instances for tabs
//      owned by the thread (read-only, cheap, no side effects);
//   2. if none, stop — no navigation, no reveal calls, no guessing;
//   3. focus the owning thread's conversation view FIRST (the reveal
//      precondition), briefly settle (the router applies the focus
//      asynchronously), then reveal each owned tab;
//   4. re-read the presentation truth and re-reveal whatever still
//      shows "hidden", a bounded number of times — the core's `{ok:
//      true}` is not trusted as evidence;
//   5. report the final truth: `revealed` vs `stillHidden` per tab, so
//      the caller can be honest with the operator.
//
// Everything runs over injected ports; the SDK adapter
// (`buildBrowserRevealPorts`) is the only piece that touches the real
// surfaces, and its call shapes are pinned by tests/browser-reveal.

export type BrowserTabPresentation = "hidden" | "reveal";

export interface BrowserRevealScope {
  hostId: string;
  generation: string;
  instanceId: string;
  threadId: string;
}

export interface BrowserRevealPorts {
  /** Host ids to scan. Only connected hosts belong here. */
  connectedHostIds(): Promise<string[]>;
  /** The desktop-browser instances (generation + id) a host knows. */
  instances(hostId: string): Promise<Array<{ generation: string; instanceId: string }>>;
  /**
   * A thread-scoped tab read on one instance. The scope carries the
   * thread; the orchestrator additionally filters on it defensively.
   */
  threadTabs(scope: BrowserRevealScope): Promise<
    Array<{ tabId: string; threadId: string; presentation: BrowserTabPresentation }>
  >;
  /** Bring one tab's side panel forward (may no-op when focus hasn't landed). */
  reveal(scope: BrowserRevealScope & { tabId: string }): Promise<void>;
  /** Focus the thread's conversation view — the reveal precondition. */
  focusThread(threadId: string): void;
  /** Injectable wait (post-focus settle and between reveal attempts). */
  delay(ms: number): Promise<void>;
}

/** A controlled tab as the orchestrator saw it, with its scan location. */
export interface BrowserTabRecord {
  hostId: string;
  generation: string;
  instanceId: string;
  tabId: string;
  threadId: string;
  presentation: BrowserTabPresentation;
}

export interface BrowserRevealResult {
  threadId: string;
  /** The thread's controlled tabs at scan time. */
  discovered: BrowserTabRecord[];
  /** Tabs whose presentation read "reveal" at the final verification. */
  revealed: BrowserTabRecord[];
  /** Tabs that stayed "hidden" through every attempt the bounds allow. */
  stillHidden: BrowserTabRecord[];
}

/** The board banner's payload for a reveal gesture the operator must hear about. */
export interface BrowserRevealNotice {
  message: string;
}

/**
 * Wait between the focus call and the first reveal: bb's router applies
 * `navigate.toThread` asynchronously, and the host checks focus at
 * reveal time — too early is the race the action exists to absorb.
 */
export const REVEAL_SETTLE_MS = 300;
/** Wait between a no-op reveal attempt and the next one. */
export const REVEAL_RETRY_DELAY_MS = 300;
/** Total reveal rounds per tab: one initial + this many-1 retries. */
export const REVEAL_VERIFY_ATTEMPTS = 4;

/**
 * Discover, focus, reveal, verify — see the module header. Throws when
 * listing fails (fail loud: the caller reports the named failure rather
 * than an empty-looking success).
 */
export async function revealThreadBrowserTabs(
  ports: BrowserRevealPorts,
  threadId: string,
): Promise<BrowserRevealResult> {
  const empty: BrowserRevealResult = {
    threadId,
    discovered: [],
    revealed: [],
    stillHidden: [],
  };

  const hostIds = await ports.connectedHostIds();
  const readerScopes: BrowserRevealScope[] = [];
  const discovered: BrowserTabRecord[] = [];
  for (const hostId of hostIds) {
    for (const { generation, instanceId } of await ports.instances(hostId)) {
      const where = { hostId, generation, instanceId, threadId };
      readerScopes.push(where);
      for (const entry of await ports.threadTabs(where)) {
        if (entry.threadId !== threadId) continue;
        discovered.push({ ...where, ...entry });
      }
    }
  }
  if (discovered.length === 0) {
    // No controlled tab owns — or is owned by — this thread. Navigating
    // away from the board for nothing would itself be a silent no-op.
    return empty;
  }

  // The reveal precondition, done by us: the board's surface IS the
  // no-focus state this module exists to compensate.
  ports.focusThread(threadId);
  await ports.delay(REVEAL_SETTLE_MS);

  let final = discovered;
  let pending = discovered;
  for (let attempt = 1; attempt <= REVEAL_VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await ports.delay(REVEAL_RETRY_DELAY_MS);
    for (const entry of pending) {
      await ports.reveal({
        hostId: entry.hostId,
        generation: entry.generation,
        instanceId: entry.instanceId,
        tabId: entry.tabId,
        threadId,
      });
    }
    // Re-read the truth; the core's {ok:true} proves nothing.
    const fresh: BrowserTabRecord[] = [];
    for (const reader of readerScopes) {
      for (const entry of await ports.threadTabs(reader)) {
        if (entry.threadId !== threadId) continue;
        fresh.push({ ...reader, tabId: entry.tabId, threadId, presentation: entry.presentation });
      }
    }
    final = fresh;
    pending = fresh.filter((entry) => entry.presentation !== "reveal");
    if (pending.length === 0) break;
  }

  return {
    threadId,
    discovered,
    revealed: final.filter((entry) => entry.presentation === "reveal"),
    stillHidden: final.filter((entry) => entry.presentation === "hidden"),
  };
}

/** Minimal structural views of the SDK surfaces the adapter reads. */
export interface BrowserRevealSdkLike {
  hosts: {
    list(args?: unknown): Promise<Array<{ id: string; status: string }>>;
  };
  experimental_desktopBrowsers: {
    listInstances(args: { hostId: string }): Promise<{
      instances: Array<{ generation: string; instanceId: string }>;
    }>;
    listTabs(scope: BrowserRevealScope): Promise<{
      tabs: Array<{ tabId: string; threadId: string; presentation: BrowserTabPresentation }>;
    }>;
    revealTab(scope: BrowserRevealScope & { tabId: string }): Promise<{ ok: true }>;
  };
}

export interface BrowserRevealNavigateLike {
  toThread(threadId: string): void;
}

/**
 * Wire the orchestrator's ports to the real surfaces: the SDK's hosts
 * area (connected hosts), its experimental desktop-browser area
 * (instances/tabs/reveal), and the host router (thread focus).
 */
export function buildBrowserRevealPorts(
  sdk: BrowserRevealSdkLike,
  navigate: BrowserRevealNavigateLike,
): BrowserRevealPorts {
  return {
    async connectedHostIds() {
      const hosts = await sdk.hosts.list();
      return hosts
        .filter((host) => host.status === "connected")
        .map((host) => host.id);
    },
    async instances(hostId) {
      const result = await sdk.experimental_desktopBrowsers.listInstances({ hostId });
      return result.instances.map(({ generation, instanceId }) => ({ generation, instanceId }));
    },
    async threadTabs(scope) {
      const result = await sdk.experimental_desktopBrowsers.listTabs(scope);
      return result.tabs.map(({ tabId, threadId, presentation }) => ({
        tabId,
        threadId,
        presentation,
      }));
    },
    async reveal(scope) {
      await sdk.experimental_desktopBrowsers.revealTab(scope);
    },
    focusThread(threadId) {
      navigate.toThread(threadId);
    },
    delay(ms) {
      return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}