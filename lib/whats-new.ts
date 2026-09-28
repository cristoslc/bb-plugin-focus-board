/**
 * "What's new" — the board's in-plugin changelog surface.
 *
 * bb gives plugins no update notification to hook, so the board self-reports:
 * the last-seen plugin version sits in localStorage; when the running build
 * is newer, the toolbar's gift button pulses and the modal lists what
 * changed. The button itself never disappears — dismissing only stops the
 * pulse, and the changelog stays reachable afterwards.
 *
 * APP_VERSION is maintained by hand next to package.json's version; a test
 * pins them together so a version bump cannot drift past it.
 */

export const APP_VERSION = "0.5.7";

export const LAST_SEEN_VERSION_KEY = "focus-board:lastSeenVersion";

export interface WhatsNewEntry {
  version: string;
  items: readonly string[];
}

/** Newest first; condensed highlights, not the full CHANGELOG. */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: "0.5.7",
    items: [
      "Urgent child threads now float to the top of the rows nested under a parent card, so a child that needs you can't get buried under quieter siblings.",
    ],
  },
  {
    version: "0.5.6",
    items: [
      "Child threads now nest as one family: the family's card sits in the column of its most attention-requiring member, with urgent children rendered as rows under the parent card instead of floating away as standalone cards.",
      "A pinned parent keeps its whole family in the Pinned column — an active child no longer detaches into its own column.",
    ],
  },
  {
    version: "0.5.5",
    items: [
      "Backticked workspace paths now only show as clickable links when the file actually exists: a path the model merely planned (or a bare `.md`) stays plain text instead of opening a dead preview.",
    ],
  },
  {
    version: "0.5.4",
    items: [
      "The thread pane now keeps a record of recent AskUserQuestion decisions — bb's transcript drops the answers once a question card is submitted, so the pane rebuilds them from the event log in a collapsed 'Recent decisions' card.",
    ],
  },
  {
    version: "0.5.3",
    items: [
      "Backticked workspace paths in thread messages are now clickable in the board's thread pane: clicking a `.md` path opens the file preview, with the same underline and icon the main thread pane shows.",
    ],
  },
  {
    version: "0.5.2",
    items: [
      "Right-clicking a nested child thread now opens the child's own menu instead of the parent card's, and every card menu names the thread it acts on.",
    ],
  },
  {
    version: "0.5.1",
    items: [
      "The Done column now sorts by when each thread was marked done, newest first; dragging still applies a manual order on top.",
    ],
  },
  {
    version: "0.5.0",
    items: [
      "The open pane is part of the panel URL: bb's back arrow returns you to the pane you left after following a link out to a full thread, and walks back through cards you lost track of.",
      "The board keeps the active card in view — when a pane is restored from history, and when the card relocates (pin, done, grouping change).",
      "A What's-new button now lives in the toolbar (this one).",
    ],
  },
  {
    version: "0.4.4",
    items: [
      "Thread mention links in pane messages navigate again — the 0.4.3 link interceptor had swallowed them.",
    ],
  },
  {
    version: "0.4.3",
    items: [
      "Relative file links in pane messages (like [ERD](docs/erd.mmd)) open as live files in bb's preview panel instead of dead browser URLs.",
    ],
  },
  {
    version: "0.4.2",
    items: [
      "Rank refusal banners can be dismissed, and auto-dismiss after 10 seconds.",
    ],
  },
];

/** Negative when a < b, positive when a > b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const order = compareVersionSegments(pa[i] ?? "", pb[i] ?? "");
    if (order !== 0) return order;
  }
  return 0;
}

/** One dot-separated segment: a numeric core plus an optional suffix (`0-beta`). */
function compareVersionSegments(a: string, b: string): number {
  const parse = (segment: string): { num: number; suffix: string } => {
    // A missing segment ("0.5" vs "0.5.0") is 0, not a string fallback.
    if (segment === "") return { num: 0, suffix: "" };
    const match = /^(\d+)(.*)$/.exec(segment);
    return match === null
      ? { num: NaN, suffix: segment }
      : { num: Number(match[1]), suffix: match[2] };
  };
  const va = parse(a);
  const vb = parse(b);
  // A segment that is not number-led at all (no digits) falls back to a
  // plain string comparison rather than pretending to be 0.
  if (Number.isNaN(va.num) || Number.isNaN(vb.num)) {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (va.num !== vb.num) return va.num < vb.num ? -1 : 1;
  // Same number: a suffix sorts BELOW the bare segment (semver pre-release
  // order — "0-beta" < "0"), and two suffixes compare as strings.
  if (va.suffix === vb.suffix) return 0;
  if (va.suffix === "") return 1;
  if (vb.suffix === "") return -1;
  return va.suffix < vb.suffix ? -1 : 1;
}

/** The stored last-seen version, or null when nothing was stored (fresh install). */
export function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch {
    // localStorage can throw in embedded contexts; a null means "fresh".
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
  } catch {
    // Best effort only; the board works without the persistence.
  }
}

/**
 * Entries strictly newer than `lastSeen`, newest first. A null `lastSeen` is
 * a fresh install — nothing counts as new, because everything does; the
 * first visit simply records the running version.
 */
export function entriesSince(lastSeen: string | null): readonly WhatsNewEntry[] {
  if (lastSeen === null) return [];
  return WHATS_NEW.filter((entry) => compareVersions(entry.version, lastSeen) > 0);
}