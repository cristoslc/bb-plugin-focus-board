/**
 * "What's new" — the board's in-plugin changelog surface.
 *
 * bb gives plugins no update notification to hook, so the board self-reports:
 * the last-seen plugin version sits in localStorage; when the running build
 * is newer, the toolbar's gift button pulses and the modal lists what
 * changed. The button itself never disappears — dismissing only stops the
 * pulse, and the changelog stays reachable afterwards.
 *
 * On dev, APP_VERSION carries a provisional prerelease number (the next
 * release + "-dev", e.g. "0.6.0-dev"): dev builds describe themselves as
 * unreleased, lead the modal with CHANGELOG.md's [Unreleased] group, and
 * pulse whenever that group's content changes (its fingerprint, not the
 * version, is the "seen" state). The release finalize commit strips the
 * suffix and adds the published entry. A test pins APP_VERSION to
 * package.json's version so they cannot drift apart.
 */

import { UNRELEASED_ITEMS } from "./unreleased-changelog.generated";

export const APP_VERSION = "0.6.0-dev";

export const LAST_SEEN_VERSION_KEY = "focus-board:lastSeenVersion";
export const LAST_SEEN_UNRELEASED_KEY = "focus-board:lastSeenUnreleased";

export interface WhatsNewEntry {
  version: string;
  /** Marks the dev build's [Unreleased] group; the modal heads it without "Version ". */
  unreleased?: boolean;
  items: readonly string[];
}

/** Newest first; condensed highlights, not the full CHANGELOG. */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: "0.5.21",
    items: [
      "Escape now stops a running thread's turn before the pane: press Escape once to interrupt, press again to close. A toggle in the plugin's settings (default on) controls it, and a gear in the sidebar footer opens the settings.",
      "Moving a pinned card out of the Pinned column — a drop onto Unread or Done, or Mark done in its menu — unpins it in the same gesture, so it no longer snaps back into Pinned.",
      "Columns drained to zero by nesting (every card is a nested child) now hide until a card returns.",
    ],
  },
  {
    version: "0.5.20",
    items: [
      "Dropping a card onto a card in a new column (Pinned, Done, Unread) now places it at that spot in the same drop, instead of a state change followed by a second drag to position it.",
    ],
  },
  {
    version: "0.5.19",
    items: [
      "Clicking in the pane's chat while it is scrolled up no longer yanks the transcript back to the bottom. This is a workaround for bb's page-shell scroll manager; the module comes out when the host fix ships.",
    ],
  },
  {
    version: "0.5.18",
    items: [
      "Answered questions now drop their card out of Needs you right away, instead of holding it there until the next unrelated board refresh.",
    ],
  },
  {
    version: "0.5.17",
    items: [
      "Parent lanes now size to fit their cards, and the selected family renders as a wide, readable ruler lane.",
      "Pan the board and the nearest lane snaps in as the ruler: seams stay aligned, clicked subtasks stay on screen, and the board settles without jitter.",
      "The lane-order toggle moved into the left rail as a vertical picker.",
    ],
  },
  {
    version: "0.5.16",
    items: [
      "No board behavior changes in this version — 0.5.16 ships the same build as 0.5.15: drop a card on the Pinned lane to pin it.",
    ],
  },
  {
    version: "0.5.15",
    items: [
      "The board's Pinned column now accepts a dragged card: dropping one there pins it, so pinning no longer needs the card's right-click menu.",
    ],
  },
  {
    version: "0.5.14",
    items: [
      "Thread pane on phones: the actions menu now offers Full Screen, so opening a thread in the main view is one tap even where the full-screen button is hidden.",
    ],
  },
  {
    version: "0.5.13",
    items: [
      "Parent thread lanes: the Group-by dropdown offers \"Parent thread\" — one vertical lane per parent thread with the Attention ladder pivoted into rows, only children as cards, a catch-all Standalone lane, lane order by family recency with a toggle to section lanes by project.",
    ],
  },
  {
    version: "0.5.12",
    items: [
      "The sweep now refuses a parent thread that still has live children, and the CLI sweep mirrors the board's quiet-thread rule: running turns and unseen-activity threads are never archive-eligible. Both certification findings are closed.",
    ],
  },
  {
    version: "0.5.11",
    items: [
      "The What's-new log now includes the 0.5.9 line that shipped without one; no board behavior changes in this version.",
    ],
  },
  {
    version: "0.5.10",
    items: [
      "Threads that pause to ask you for something (like a secrets form) now show in the Needs you column instead of In Progress while they wait.",
    ],
  },
  {
    version: "0.5.9",
    items: [
      "Threads asking you for input (like a secrets form) now wait in the Needs you column instead of In Progress.",
    ],
  },
  {
    version: "0.5.8",
    items: [
      "Security hardening: an opened thread window can no longer reach back into the board, and the board's stored column orders reject malformed keys. No visible board behavior changes.",
    ],
  },
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

/** True when the version carries a prerelease suffix — e.g. dev's "0.6.0-dev". */
export function isPrereleaseVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+-.+$/.test(version);
}

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

/**
 * The stored fingerprint of the [Unreleased] group the reader last had open,
 * or null when nothing was stored yet.
 */
export function readLastSeenUnreleased(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_UNRELEASED_KEY);
  } catch {
    // localStorage can throw in embedded contexts; a null means "fresh".
    return null;
  }
}

export function writeLastSeenUnreleased(fingerprint: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_UNRELEASED_KEY, fingerprint);
  } catch {
    // Best effort only; the board works without the persistence.
  }
}

/** FNV-1a 32-bit over the joined items: cheap, stable, no dependency. */
export function unreleasedFingerprint(items: readonly string[]): string {
  let hash = 0x811c9dc5;
  const source = `\n${items.join("\n")}\n`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Fingerprint of the unreleased group embedded in this build. */
export const CURRENT_UNRELEASED_FINGERPRINT = unreleasedFingerprint(UNRELEASED_ITEMS);

export interface WhatsNewUnseenState {
  runningVersion: string;
  lastSeenVersion: string | null;
  unreleasedFingerprint: string;
  lastSeenUnreleasedFingerprint: string | null;
}

/**
 * Whether the toolbar's gift button should pulse.
 *
 * Stable builds compare versions: running > last-seen pulses exactly once
 * per release. A prerelease build never does that — "0.6.0-dev" outranks
 * several stored releases at once and would pulse at the version's author.
 * On dev, "seen" is the [Unreleased] group's CONTENT: the pulse fires again
 * whenever that group changed since the modal was last opened, which is the
 * changelog-update signal the reader asked for. A missing fingerprint is
 * stamped silently at load (fresh-install rules), so adopting the guard
 * does not retroactively pulse old content.
 */
export function hasUnseenWhatsNew(state: WhatsNewUnseenState): boolean {
  if (isPrereleaseVersion(state.runningVersion)) {
    return (
      state.lastSeenUnreleasedFingerprint !== null &&
      state.unreleasedFingerprint !== state.lastSeenUnreleasedFingerprint
    );
  }
  return (
    state.lastSeenVersion !== null &&
    compareVersions(state.runningVersion, state.lastSeenVersion) > 0
  );
}

/**
 * The entries the modal shows.
 *
 * A prerelease build leads with its [Unreleased] group (the only thing that
 * is actually new to its reader) followed by the published feed; a stable
 * build shows the pending delta or the full recent feed as before.
 */
export function whatsNewEntriesFor(
  runningVersion: string,
  unseen: boolean,
  lastSeenVersion: string | null,
): readonly WhatsNewEntry[] {
  if (isPrereleaseVersion(runningVersion)) {
    const unreleased: WhatsNewEntry | null = UNRELEASED_ITEMS.length
      ? { version: runningVersion, unreleased: true, items: UNRELEASED_ITEMS }
      : null;
    const published = unseen
      ? entriesSince(lastSeenVersion)
      : [...WHATS_NEW];
    return unreleased === null
      ? published
      : [unreleased, ...published];
  }
  return unseen ? entriesSince(lastSeenVersion) : [...WHATS_NEW];
}