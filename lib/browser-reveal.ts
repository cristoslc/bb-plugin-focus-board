// The board card's "Reveal browser tab" action contract (issue #17).
//
// bb's own reveal contract (`bb guide browser`): the side panel opens
// and selects the tab only when the OWNING thread is already focused;
// otherwise nothing changes on screen. Worse for scripts and agents,
// the surface still answers `{ok: true}` when it no-ops, so a caller
// cannot tell success from a silent no-op — the reporting thread
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
//      precondition), let the focus settle, then reveal each owned tab.
//
// Deliberately NO post-reveal verification: live evidence (2026-10-06,
// this thread, a 2-second poll log) shows `list_tabs`' `presentation`
// is a recorded creation attribute, not live panel visibility — it
// stayed "hidden" through a reveal that visibly opened the panel, and
// `create --reveal` reported "hidden" at creation. There is no
// observable success signal in the SDK, so the module claims none: it
// reports what it targeted and lets the opened side panel be the
// feedback. Blank shell tabs (the automation session's about:blank
// carrier) are skipped when a real page tab exists, so the panel's
// selection lands on something with actual content.
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
    Array<{ tabId: string; threadId: string; url: string; presentation: BrowserTabPresentation }>
  >;
  /** Bring one tab's side panel forward (may no-op when focus hasn't landed). */
  reveal(scope: BrowserRevealScope & { tabId: string }): Promise<void>;
  /** Focus the thread's conversation view — the reveal precondition. */
  focusThread(threadId: string): void;
  /** Injectable wait (post-focus settle). */
  delay(ms: number): Promise<void>;
}

/** A controlled tab as the orchestrator saw it, with its scan location. */
export interface BrowserTabRecord {
  hostId: string;
  generation: string;
  instanceId: string;
  tabId: string;
  threadId: string;
  url: string;
  presentation: BrowserTabPresentation;
}

export interface BrowserRevealResult {
  threadId: string;
  /** The thread's controlled tabs at scan time. */
  discovered: BrowserTabRecord[];
  /** The tabs the reveal gesture was actually fired for. */
  targeted: BrowserTabRecord[];
}

/** The board banner's payload for a reveal gesture the operator must hear about. */
export interface BrowserRevealNotice {
  message: string;
}

/**
 * Wait between the focus call and the reveal: bb's router applies
 * `navigate.toThread` asynchronously, and the host checks focus at
 * reveal time — too early is the race the action exists to absorb.
 */
export const REVEAL_SETTLE_MS = 300;

/**
 * Discover, focus, reveal — see the module header. Throws when listing
 * fails (fail loud: the caller reports the named failure rather than an
 * empty-looking success).
 */
export async function revealThreadBrowserTabs(
  ports: BrowserRevealPorts,
  threadId: string,
): Promise<BrowserRevealResult> {
  const hostIds = await ports.connectedHostIds();
  const discovered: BrowserTabRecord[] = [];
  for (const hostId of hostIds) {
    for (const { generation, instanceId } of await ports.instances(hostId)) {
      const where = { hostId, generation, instanceId, threadId };
      for (const entry of await ports.threadTabs(where)) {
        if (entry.threadId !== threadId) continue;
        discovered.push({ ...where, ...entry });
      }
    }
  }
  if (discovered.length === 0) {
    // Navigating away from the board for nothing would itself be a
    // silent no-op; the caller tells the operator instead.
    return { threadId, discovered, targeted: [] };
  }

  // The reveal precondition, done by us: the board's surface IS the
  // no-focus state this module exists to compensate.
  ports.focusThread(threadId);
  await ports.delay(REVEAL_SETTLE_MS);

  // Blank shell tabs carry no content; when a real page tab exists,
  // skip the blanks so the panel's final selection lands on the page.
  const withContent = discovered.filter((entry) => !isBlankTabUrl(entry.url));
  const targeted = withContent.length > 0 ? withContent : discovered;
  for (const entry of targeted) {
    await ports.reveal({
      hostId: entry.hostId,
      generation: entry.generation,
      instanceId: entry.instanceId,
      tabId: entry.tabId,
      threadId,
    });
  }
  return { threadId, discovered, targeted };
}

/**
 * About:blank (and empty) tabs are the automation session's carriers,
 * not pages. Pinned so the reveal gesture never parks the operator's
 * selection on an empty tab when real ones exist.
 */
export function isBlankTabUrl(url: string): boolean {
  return url === "" || url === "about:blank";
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
      tabs: Array<{
        tabId: string;
        threadId: string;
        url: string;
        title: string;
        presentation: BrowserTabPresentation;
      }>;
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
      return result.tabs.map(({ tabId, threadId, url, presentation }) => ({
        tabId,
        threadId,
        url,
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