/**
 * Screenshot harness entry: mounts the real plugin app (app.tsx) against the
 * mocked SDK, after seeding persisted board state from the query string.
 */
import "../../dist/app.css";
import "../../app";
import {
  mountRegisteredConfigSection,
  mountRegisteredPanel,
  seedSimSettings,
} from "./mock-sdk";
import { CURRENT_UNRELEASED_FINGERPRINT } from "../../lib/whats-new";

// Seed before the app's useState initializers read localStorage (they run at
// render time below, after these writes).
const params = new URLSearchParams(window.location.search);
const groupBy = params.get("groupBy") ?? "status";
window.localStorage.setItem("focus-board:groupBy", groupBy);
window.localStorage.setItem("focus-board:search", "");
window.localStorage.setItem("focus-board:filter:projects", "[]");
window.localStorage.setItem("focus-board:filter:providers", "[]");
window.localStorage.setItem("focus-board:filter:states", "[]");
// The group-restrict set: the UAT battery re-seeds the stored filters on
// every goto like the other three sets, unless `?groups=<id>` (repeatable)
// seeds the restrict — the shape the app's own filter writes store, so a
// suite can prove the restore path after a "reload".
window.localStorage.setItem(
  "focus-board:filter:groups",
  JSON.stringify(params.getAll("groups")),
);
window.localStorage.setItem(
  "focus-board:paneWidth",
  params.get("paneWidth") ?? "480",
);
window.localStorage.setItem(
  "focus-board:search",
  params.get("q") ?? "",
);
// Seed the stored last-seen plugin version (the what's-new gift button's
// state): `?lastSeenVersion=0.4.4` simulates an upgrade from that version;
// absent, the first visit stamps the running version as seen.
// `?lastSeenUnreleased=…` seeds the [Unreleased]-group fingerprint a
// prerelease build keys its pulse on; absent, nothing is stored.
const lastSeenVersion = params.get("lastSeenVersion");
if (lastSeenVersion !== null) {
  window.localStorage.setItem("focus-board:lastSeenVersion", lastSeenVersion);
}
const lastSeenUnreleased = params.get("lastSeenUnreleased");
if (lastSeenUnreleased !== null) {
  // A "current" seed means this build's own fingerprint: the harness mounts
  // with the What's-new pulse quiet (the plain settings gear) without
  // knowing the changelog's current unreleased fingerprint from YAML.
  window.localStorage.setItem(
    "focus-board:lastSeenUnreleased",
    lastSeenUnreleased === "current"
      ? CURRENT_UNRELEASED_FINGERPRINT
      : lastSeenUnreleased,
  );
}

// Seed the board lane direction (the Appearance tab's choice): absent →
// "vertical", so no stale value from an earlier page load can leak into a
// run. `?laneDirection=horizontal` mounts the horizontal row board.
window.localStorage.setItem(
  "focus-board:laneDirection",
  params.get("laneDirection") ?? "vertical",
);

// Seed the persisted collapsed-family store: `?collapsed=id1,id2` folds those
// family cards in the shot (the COLLAPSED_FAMILIES_KEY list the app's fold
// toggle writes). Absent → empty, so a stale value from an earlier page load
// can't leak into a run.
const collapsed = params.get("collapsed");
window.localStorage.setItem(
  "focus-board:collapsedFamilies",
  JSON.stringify(collapsed === null ? [] : collapsed.split(",").filter(Boolean)),
);

// Seed the persisted collapsed-GROUP store the same way: `?collapsedGroups=id1,id2`
// folds those feature-group boxes into one card (the COLLAPSED_GROUPS_KEY the
// box's own chevron writes). Absent → empty, so the default board keeps every
// box expanded. The rate-pulse probe (#279) uses this to paint the folded
// boxes' member dots, which is where the working-dot pulse lives.
const collapsedGroups = params.get("collapsedGroups");
window.localStorage.setItem(
  "focus-board:collapsedGroups",
  JSON.stringify(collapsedGroups === null ? [] : collapsedGroups.split(",").filter(Boolean)),
);

// Seed the harness's rank store before the app's first rank_list call, so a
// UAT pass can start from a column that already has a stored order.
const seedRanks = params.get("ranks");
if (seedRanks !== null) {
  const uat = (globalThis as unknown as {
    __uat?: { seedRanks: (orders: Record<string, string[]>) => void };
  }).__uat;
  if (!uat) throw new Error("harness: rank seeding requested but __uat is missing");
  uat.seedRanks(JSON.parse(seedRanks) as Record<string, string[]>);
}

// Seed the harness's simulated plugin settings (the declared settings the
// modal's Behavior tab reads through useSettings): `?settings={"key":value}`
// JSON. Absent → empty, so defaults apply with no stale residue.
const settingsSeed = params.get("settings");
if (settingsSeed !== null) {
  seedSimSettings(JSON.parse(settingsSeed) as Record<string, string | number | boolean>);
}

// Seed the harness's family-state server row (the plugin KV row the fold and
// idle-hide gestures write): `?familyState={"collapsedFamilies":[...]}` JSON.
// The app reads this row on mount, so a suite can prove the mount hydration
// from the server. The `?collapsed=` localStorage seed above still folds
// cards, now through the one-time migration.
const familyStateSeed = params.get("familyState");
if (familyStateSeed !== null) {
  const uat = (globalThis as unknown as {
    __uat?: { seedFamilyState: (state: { collapsedFamilies?: string[]; hideIdleChildren?: string[] }) => void };
  }).__uat;
  if (!uat) throw new Error("harness: family-state seeding requested but __uat is missing");
  uat.seedFamilyState(
    JSON.parse(familyStateSeed) as { collapsedFamilies?: string[]; hideIdleChildren?: string[] },
  );
}

// `?page=configuration` mounts the registered settings section bare (the
// harness has no host plugin-detail page) instead of the board panel, so
// the headless verify can drive the mirrored Appearance controls.
if (params.get("page") === "configuration") {
  mountRegisteredConfigSection();
} else {
  mountRegisteredPanel();
}