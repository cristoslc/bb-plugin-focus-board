/**
 * Screenshot harness entry: mounts the real plugin app (app.tsx) against the
 * mocked SDK, after seeding persisted board state from the query string.
 */
import "../../dist/app.css";
import "../../app";
import { mountRegisteredPanel } from "./mock-sdk";

// Seed before the app's useState initializers read localStorage (they run at
// render time below, after these writes).
const params = new URLSearchParams(window.location.search);
const groupBy = params.get("groupBy") ?? "status";
window.localStorage.setItem("focus-board:groupBy", groupBy);
window.localStorage.setItem("focus-board:search", "");
window.localStorage.setItem("focus-board:filter:projects", "[]");
window.localStorage.setItem("focus-board:filter:providers", "[]");
window.localStorage.setItem("focus-board:filter:states", "[]");
window.localStorage.setItem(
  "focus-board:paneWidth",
  params.get("paneWidth") ?? "480",
);
// Seed the stored last-seen plugin version (the what's-new gift button's
// state): `?lastSeenVersion=0.4.4` simulates an upgrade from that version;
// absent, the first visit stamps the running version as seen.
const lastSeenVersion = params.get("lastSeenVersion");
if (lastSeenVersion !== null) {
  window.localStorage.setItem("focus-board:lastSeenVersion", lastSeenVersion);
}

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

mountRegisteredPanel();