// The board_state_get mount aggregate (server.ts): ONE answer serving what
// the mount's nine per-list calls each read, over one shared scan — one
// `threads.list({})` plus ONE `getPluginMetadata` hop per live row whose
// record carries every per-thread key at once. The pin here is the
// CONJUNCTION: every sub-payload must deep-equal the per-list methods'
// answers on the same seeded host, because the per-list handlers stay the
// signal path's truth and the aggregate must never drift from them. Red
// first: the fake host has no board_state_get until server.ts grows it.
import { describe, expect, it } from "vitest";
import { setup, doneRecordOf } from "./helpers/done-fake-host";
import { DONE_METADATA_KEY } from "../lib/done-metadata";
import { ERROR_ACK_METADATA_KEY } from "../lib/error-ack-metadata";
import { LINK_METADATA_KEY } from "../lib/link-metadata";
import { PIN_PARK_METADATA_KEY } from "../lib/pin-park";
import { SNOOZE_METADATA_KEY } from "../lib/snooze";
import { GROUP_METADATA_KEY, GROUPS_KV_KEY } from "../lib/group-metadata";

// Key literals server.ts owns as module consts (the done CLI's migration
// suite hardcodes its key the same way — no export was warranted there).
const LEGACY_DONE_KEY = "done-thread-ids";
const KEEP_KEY = "sweep-keep-flags";

const ISO = "2026-11-04T10:00:00.000Z";
// A wake well in the future: the server's load-time wake re-arm runs during
// the test's await, and an already-expired seed would be consumed (mark-unread)
// mid-test — an expired record reads as a passed wake, not one to list.
const WAKE = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

type BoardState = {
  done: { doneIds: string[]; records: Record<string, unknown> };
  links: { links: Record<string, unknown> };
  parks: { parks: Record<string, unknown> };
  acks: { ackIds: string[]; records: Record<string, unknown> };
  snoozes: { snoozes: Record<string, unknown> };
  ranks: { orders: Record<string, string[]> };
  groups: { groups: Record<string, unknown>; memberships: Record<string, string> };
  familyState: { collapsedFamilies: string[]; hideIdleChildren: string[] };
  sweep: { doneArchiveMs: number; idleArchiveMs: number };
};

const stateOf = (value: unknown): BoardState => value as BoardState;

/** Seed one thread's metadata namespace with the given board-state keys. */
function withMeta(
  meta: Map<string, { [key: string]: unknown }>,
  threadId: string,
  keys: Record<string, unknown>,
): void
{
  meta.set(threadId, { ...(meta.get(threadId) ?? {}), ...keys });
}

describe("board_state_get — the mount aggregate", () => {
  it("answers every mount list's payload for an empty board, so a fresh workspace mounts from one call", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    expect(await callRpc("board_state_get", null)).toEqual({
      done: { doneIds: [], records: {} },
      links: { links: {} },
      parks: { parks: {} },
      acks: { ackIds: [], records: {} },
      snoozes: { snoozes: {} },
      ranks: { orders: {} },
      groups: { groups: {}, memberships: {} },
      familyState: { collapsedFamilies: [], hideIdleChildren: [] },
      // The declared defaults: both sweep thresholds at 2 days.
      sweep: { doneArchiveMs: 172800000, idleArchiveMs: 172800000 },
    });
  });

  it("pays ONE threads.list scan and ONE getPluginMetadata hop per live row", async () => {
    const { callRpc, harness } = await setup({
      threads: ["thr_a", "thr_b", "thr_c"],
    });
    // Delta, not absolute: the snooze arm's load-time re-arm (armAllSnoozes,
    // kicked un-awaited at plugin load) reads the same sdk methods; let it
    // settle first, then price THIS call's contribution alone.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const listBefore = harness.inspection.sdk.callsTo("threads.list").length;
    const hopBefore = harness.inspection.sdk.callsTo("threads.getPluginMetadata").length;
    await callRpc("board_state_get", null);
    const listAfter = harness.inspection.sdk.callsTo("threads.list").length;
    const hopAfter = harness.inspection.sdk.callsTo("threads.getPluginMetadata").length;
    expect(listAfter - listBefore).toBe(1);
    expect(hopAfter - hopBefore).toBe(3);
  });

  it("every sub-payload deep-equals the per-list method's answer on the same seeded state", async () => {
    const { callRpc, meta, kvSet } = await setup({
      threads: ["thr_done", "thr_link", "thr_parked", "thr_acked", "thr_snoozed", "thr_grouped"],
    });
    withMeta(meta, "thr_done", {
      [DONE_METADATA_KEY]: { doneAt: ISO },
    });
    withMeta(meta, "thr_link", {
      [LINK_METADATA_KEY]: [
        {
          tracker: "github",
          repo: "a/b",
          issue: 12,
          kind: "issue",
          href: "https://github.com/a/b/issues/12",
          createdAt: ISO,
          source: "operator",
        },
      ],
    });
    withMeta(meta, "thr_parked", { [PIN_PARK_METADATA_KEY]: { parkedAt: ISO } });
    withMeta(meta, "thr_acked", { [ERROR_ACK_METADATA_KEY]: { ackedAt: ISO } });
    withMeta(meta, "thr_snoozed", {
      [SNOOZE_METADATA_KEY]: { wakeAt: WAKE, setAt: ISO },
    });
    withMeta(meta, "thr_grouped", { [GROUP_METADATA_KEY]: { groupId: "grp_a" } });
    await kvSet(GROUPS_KV_KEY, { grp_a: { name: "Auth rework", createdAt: ISO } });
    await kvSet(KEEP_KEY, { thr_done: { keep: true } });

    const state = stateOf(await callRpc("board_state_get", null));
    expect(state.done).toEqual(await callRpc("done_list", null));
    expect(state.links).toEqual(await callRpc("link_list", null));
    expect(state.parks).toEqual(await callRpc("pin_parks_list", null));
    expect(state.acks).toEqual(await callRpc("error_acks_list", null));
    expect(state.snoozes).toEqual(await callRpc("snooze_list", null));
    expect(state.ranks).toEqual(await callRpc("rank_list", null));
    expect(state.groups).toEqual(await callRpc("groups_list", null));
    expect(state.familyState).toEqual(await callRpc("family_state_list", null));
    expect(state.sweep).toEqual(await callRpc("sweep_config_get", null));
  });

  it("carries done's kept-merge: a never-done thread with a keep flag reports { keep: true }", async () => {
    const { callRpc, meta, kvSet } = await setup({ threads: ["thr_kept", "thr_marked"] });
    withMeta(meta, "thr_marked", { [DONE_METADATA_KEY]: { doneAt: ISO } });
    await kvSet(KEEP_KEY, { thr_kept: { keep: true }, thr_marked: { keep: true } });
    expect(stateOf(await callRpc("board_state_get", null)).done).toEqual({
      doneIds: ["thr_marked"],
      records: {
        thr_marked: { doneAt: ISO, keep: true },
        thr_kept: { keep: true },
      },
    });
  });

  it("sorts doneIds and ackIds like the per-list methods do", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_c", "thr_b", "thr_a"] });
    withMeta(meta, "thr_c", { [DONE_METADATA_KEY]: { doneAt: ISO } });
    withMeta(meta, "thr_a", { [DONE_METADATA_KEY]: { doneAt: ISO } });
    withMeta(meta, "thr_b", { [ERROR_ACK_METADATA_KEY]: { ackedAt: ISO } });
    const state = stateOf(await callRpc("board_state_get", null));
    expect(state.done.doneIds).toEqual(["thr_a", "thr_c"]);
    expect(state.acks.ackIds).toEqual(["thr_b"]);
  });

  it("a membership record pointing at a group the registry lost reports nothing (the orphan rule)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_ghost"] });
    withMeta(meta, "thr_ghost", { [GROUP_METADATA_KEY]: { groupId: "grp_ghost" } });
    const state = stateOf(await callRpc("board_state_get", null));
    expect(state.groups.memberships).toEqual({});
    expect(state.groups.groups).toEqual({});
  });

  it("an empty linkedIssues array carries no links in the aggregate (link_list's same rule)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_empty"] });
    withMeta(meta, "thr_empty", { [LINK_METADATA_KEY]: [] });
    const state = stateOf(await callRpc("board_state_get", null));
    expect(state.links.links).toEqual({});
  });

  it("fails loud on a malformed done record, exactly like done_list (never coerces)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_bad"] });
    withMeta(meta, "thr_bad", { [DONE_METADATA_KEY]: { doneAt: 123 } });
    await expect(callRpc("board_state_get", null)).rejects.toThrow(/doneAt/);
  });

  it("fails loud on a malformed group member record, exactly like groups_list", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_bad"] });
    withMeta(meta, "thr_bad", { [GROUP_METADATA_KEY]: "nope" });
    await expect(callRpc("board_state_get", null)).rejects.toThrow(/group metadata/);
  });

  it("runs the one-time legacy-done import before the read (listDoneRecords' guard, same position)", async () => {
    const { callRpc, kv, meta } = await setup({ threads: ["thr_b", "thr_a"] });
    await kv.set(LEGACY_DONE_KEY, ["thr_b", "thr_a"]);
    const state = stateOf(await callRpc("board_state_get", null));
    // The import landed its records into metadata before the aggregate read them.
    expect(state.done.doneIds).toEqual(["thr_a", "thr_b"]);
    expect(typeof doneRecordOf(meta, "thr_b")?.doneAt).toBe("string");
    // The key is gone, so no later read can resurrect it.
    expect(await kv.get(LEGACY_DONE_KEY)).toBeUndefined();
  });
});
