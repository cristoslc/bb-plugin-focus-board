// The board's aggregate mount read (issue #424). Two laws:
//
// - the payload is the SAME body the per-list handlers answer with, for every
//   one of the six lists, so a mount and a realtime refetch of the same list
//   can never disagree (the mount's shapes are built by the same projection
//   helpers, and this suite pins that they stay that way);
// - it costs ONE plugin-metadata read per thread. That is the whole point:
//   six per-thread walks fired together serialize on bb's bridge, so the
//   mount fan-in cost the sum (~2s on a 358-thread workspace, measured live),
//   which is what made the readiness gate's ceiling the active path.
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { setup } from "./helpers/done-fake-host";
import { DONE_METADATA_KEY } from "../lib/done-metadata";
import { PIN_PARK_METADATA_KEY } from "../lib/pin-park";
import { ERROR_ACK_METADATA_KEY } from "../lib/error-ack-metadata";
import { SNOOZE_METADATA_KEY } from "../lib/snooze";
import { LINK_METADATA_KEY } from "../lib/link-metadata";
import { GROUP_METADATA_KEY, GROUPS_KV_KEY } from "../lib/group-metadata";

const STAMP = "2026-11-10T12:00:00.000Z";
const LATER = "2026-11-10T13:00:00.000Z";

/** Three live threads carrying every board-state key the mount reads. */
function seedBoard(meta: Map<string, JsonValue>): void {
  meta.set("thr_a", {
    [DONE_METADATA_KEY]: { doneAt: STAMP, keep: true },
    [PIN_PARK_METADATA_KEY]: { parkedAt: STAMP },
    [ERROR_ACK_METADATA_KEY]: { ackedAt: STAMP },
    [SNOOZE_METADATA_KEY]: { wakeAt: LATER, setAt: STAMP },
    [LINK_METADATA_KEY]: [
      {
        tracker: "github",
        repo: "cristoslc/bb-plugin-focus-board",
        issue: 424,
        kind: "issue",
        href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/424",
        createdAt: STAMP,
        source: "agent",
      },
    ],
    [GROUP_METADATA_KEY]: { groupId: "grp_one" },
  } as JsonValue);
  meta.set("thr_b", {
    [GROUP_METADATA_KEY]: { groupId: "grp_one" },
  } as JsonValue);
  // thr_c carries nothing: every projection must skip it rather than invent
  // an entry (absent key = no state).
  meta.set("thr_c", {} as JsonValue);
}

async function seedGroups(
  kvSet: (key: string, value: unknown) => Promise<void>,
): Promise<void> {
  // The registry row the group listing reads (lib/group-metadata's store
  // shape: id → { name, createdAt }).
  await kvSet(GROUPS_KV_KEY, { grp_one: { name: "Release", createdAt: STAMP } });
}

const metadataReads = (
  harness: Awaited<ReturnType<typeof setup>>["harness"],
): number => harness.inspection.sdk.callsTo("threads.getPluginMetadata").length;

describe("board_state_get", () => {
  it("returns exactly the bodies the per-list handlers answer with", async () => {
    const { callRpc, meta, kvSet } = await setup({ threads: ["thr_a", "thr_b", "thr_c"] });
    seedBoard(meta);
    await seedGroups(kvSet);

    const aggregate = (await callRpc("board_state_get")) as {
      done: unknown;
      parks: unknown;
      links: unknown;
      acks: unknown;
      snoozes: unknown;
      groups: unknown;
    };

    expect(aggregate.done).toEqual(await callRpc("done_list"));
    expect(aggregate.parks).toEqual(await callRpc("pin_parks_list"));
    expect(aggregate.links).toEqual(await callRpc("link_list"));
    expect(aggregate.acks).toEqual(await callRpc("error_acks_list"));
    expect(aggregate.snoozes).toEqual(await callRpc("snooze_list"));
    expect(aggregate.groups).toEqual(await callRpc("groups_list"));
  });

  it("reads each thread's namespace once, whatever the number of lists", async () => {
    const { callRpc, harness, meta, kvSet } = await setup({
      threads: ["thr_a", "thr_b", "thr_c", "thr_d"],
    });
    seedBoard(meta);
    await seedGroups(kvSet);

    // Let the plugin's own background snooze-wake arming drain first: it reads
    // each thread's snooze record once at load, off the mount path, and a
    // count taken while it runs would price the wrong read.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = metadataReads(harness);
    await callRpc("board_state_get");    const aggregateReads = metadataReads(harness) - before;
    expect(aggregateReads).toBe(4); // one per live thread, not six per thread

    const beforeSeparate = metadataReads(harness);
    for (const method of [
      "done_list",
      "pin_parks_list",
      "link_list",
      "error_acks_list",
      "snooze_list",
      "groups_list",
    ]) {
      await callRpc(method);
    }
    const separateReads = metadataReads(harness) - beforeSeparate;
    expect(separateReads).toBe(24); // the six walks this read replaces
  });

  it("reports no state for a thread whose namespace is empty", async () => {
    const { callRpc, meta, kvSet } = await setup({ threads: ["thr_a", "thr_b", "thr_c"] });
    seedBoard(meta);
    await seedGroups(kvSet);

    const aggregate = (await callRpc("board_state_get")) as {
      done: { doneIds: string[] };
      parks: { parks: Record<string, unknown> };
      links: { links: Record<string, unknown> };
      acks: { ackIds: string[] };
      snoozes: { snoozes: Record<string, unknown> };
      groups: { memberships: Record<string, string> };
    };
    expect(aggregate.done.doneIds).toEqual(["thr_a"]);
    expect(Object.keys(aggregate.parks.parks)).toEqual(["thr_a"]);
    expect(Object.keys(aggregate.links.links)).toEqual(["thr_a"]);
    expect(aggregate.acks.ackIds).toEqual(["thr_a"]);
    expect(Object.keys(aggregate.snoozes.snoozes)).toEqual(["thr_a"]);
    expect(aggregate.groups.memberships).toEqual({
      thr_a: "grp_one",
      thr_b: "grp_one",
    });
  });
});
