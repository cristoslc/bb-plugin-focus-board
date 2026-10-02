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
 * suffix; the published entry then exists already, derived from the renamed
 * section. No feed entry is hand-written anymore: WHATS_NEW is scraped from
 * CHANGELOG.md (each bullet's opening sentence at test/build time) merged
 * with the frozen LEGACY_WHATS_NEW hand-written records for versions the
 * changelog predates. A test pins APP_VERSION to package.json's version so
 * they cannot drift apart.
 */

import { UNRELEASED_ITEMS } from "./unreleased-changelog.generated";
import { DERIVED_WHATS_NEW } from "./whats-new.generated";
import { leadFromBullet } from "./changelog-markdown";

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
const LEGACY_WHATS_NEW: readonly WhatsNewEntry[] = [
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
];

/**
 * The published feed: derived from CHANGELOG.md (H2 = version, H3 = change
 * kind, each bullet's opening sentence is the item) at test/build time by
 * scripts/generate-whats-new.mjs, merged with the hand-written legacy
 * entries for the versions (0.5.6–0.5.12) the published record predates.
 */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
  ...DERIVED_WHATS_NEW,
  ...LEGACY_WHATS_NEW.filter((entry) => !DERIVED_WHATS_NEW.some((derived) => derived.version === entry.version)),
].sort((a, b) => compareVersions(b.version, a.version));

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

/** Fingerprint of a group with no bullets: dev builds holding one never pulse. */
export const EMPTY_UNRELEASED_FINGERPRINT = unreleasedFingerprint([]);

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
 * per release. A prerelease build keys "seen" to the [Unreleased] group's
 * CONTENT instead: the pulse fires whenever the group is non-empty and its
 * fingerprint differs from the last-open snapshot — a null snapshot is
 * "never opened", not "seen empty", so the group standing in the build
 * always advertises itself until the reader opens the modal. Empty groups
 * never pulse: no bullets is nothing to read, whatever the snapshot says.
 */
export function hasUnseenWhatsNew(state: WhatsNewUnseenState): boolean {
  if (isPrereleaseVersion(state.runningVersion)) {
    // Null snapshot = "never opened" — the standing group advertises itself,
    // so its pulse survives until the reader opens the modal once. An empty
    // group never pulses: no bullets is nothing to read.
    return (
      state.unreleasedFingerprint !== EMPTY_UNRELEASED_FINGERPRINT &&
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
      ? { version: runningVersion, unreleased: true, items: UNRELEASED_ITEMS.map(leadFromBullet) }
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