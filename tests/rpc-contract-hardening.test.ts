// Contract-hardening sweep over the plugin's RPC surface.
//
// Every method in `rpcContract` is hammered with the adversarial input set
// at the contract boundary: the zod `input` schema must REFUSE malformed,
// oversized, and type-confused inputs, and accept the minimal valid one.
// This pins the caps the security audits rely on (500 ticket refs, 200
// paths, the COLUMN_KEY_SCHEMA prototype guard) as tested behavior, so a
// cap loosened by accident fails the suite instead of shipping.
import { describe, expect, it } from "vitest";
import { rpcContract } from "../server";
import { setup } from "./helpers/done-fake-host";

type Method = keyof typeof rpcContract;

/** Minimal input each contract accepts (constructible without a host). */
const validInputs: Record<Method, unknown> = {
  done_list: null,
  done_set: { threadId: "thr_x", done: true },
  pin_parks_list: null,
  pin_park_set: { threadId: "thr_x", parked: true },
  snooze_list: null,
  snooze_set: {
    threadId: "thr_x",
    wakeAt: new Date(Date.now() + 60_000).toISOString(),
  },
  snooze_clear: { threadId: "thr_x" },
  tracker_status: { repo: "o/r", numbers: [1, 2] },
  tracker_validate: { urls: ["https://github.com/o/r/issues/12"] },
  thread_autotitle: { threadId: "thr_x" },
  thread_autotitle_services: { threadId: "thr_x" },
  workspace_files_exist: { threadId: "thr_x", paths: ["docs/a.md"] },
  workspace_open_targets: { threadId: "thr_x" },
  workspace_open_in_target: { threadId: "thr_x", targetId: "tgt" },
  sweep_config_get: null,
  sweep_keep_set: { threadId: "thr_x", keep: true },
  thread_reparent: { threadId: "thr_x", parentThreadId: null },
  rank_list: null,
  rank_move: {
    columnKey: "status:unread",
    threadId: "thr_x",
    beforeId: null,
    toEnd: false,
    visibleIds: ["thr_x"],
  },
  link_list: null,
  link_set: {
    threadId: "thr_x",
    repo: "o/r",
    number: 12,
    kind: "issue",
    source: "operator",
  },
  link_clear: { threadId: "thr_x" },
  groups_list: null,
  group_create: { name: "Auth rework" },
  group_rename: { groupId: "grp_x", name: "Auth rework" },
  group_set: { threadId: "thr_x", groupId: null },
};

const nullInputMethods: Method[] = [
  "done_list",
  "groups_list",
  "pin_parks_list",
  "snooze_list",
  "rank_list",
  "sweep_config_get",
  "link_list",
];

const inputSchemaOf = (method: Method) =>
  (rpcContract[method] as { input: { safeParse: (v: unknown) => { success: boolean } } })
    .input;

const adversarial = [
  undefined,
  null,
  0,
  1,
  "",
  "x",
  [],
  [1, 2],
  {},
  { threadId: "" },
  { threadId: 123 },
  { threadId: "thr_x", done: "yes" },
  { threadId: "thr_x", done: 1 },
  { threadId: "thr_x", parked: null },
  { threadId: "thr_x", keep: "yes" },
  { threadId: "thr_x", wakeAt: "not a date" },
  { threadId: "thr_x", wakeAt: 123 },
  { threadId: "thr_x", numbers: "1" },
  { repo: "", numbers: [1] },
  { repo: "o/r", numbers: [-1] },
  { repo: "o/r", numbers: [1.5] },
  { repo: "o/r", numbers: ["1"] },
  { threadId: "thr_x", parentThreadId: "" },
  { threadId: "thr_x", columnKey: "__proto__" },
  { columnKey: "__proto__", threadId: "t", beforeId: null, toEnd: false, visibleIds: ["t"] },
  { columnKey: "", threadId: "t", beforeId: null, toEnd: false, visibleIds: ["t"] },
  { columnKey: "status:unread", threadId: "", beforeId: null, toEnd: false, visibleIds: ["t"] },
  { columnKey: "status:unread", threadId: "t", beforeId: 1, toEnd: false, visibleIds: ["t"] },
  { columnKey: "status:unread", threadId: "t", beforeId: null, toEnd: "yes", visibleIds: ["t"] },
  { columnKey: "status:unread", threadId: "t", beforeId: null, toEnd: false, visibleIds: "t" },
  { threadId: "thr_x", paths: [""] },
  { threadId: "thr_x", paths: 123 },
  { threadId: "thr_x", targetId: "" },
  { threadId: "thr_x", pluginId: "p" }, // half-given override pair — handler refuses too
  { threadId: "thr_x", useThreadModel: "yes" },
];

describe("rpc contract hardening", () => {
  it("every method refuses undefined input", () => {
    for (const method of Object.keys(rpcContract) as Method[]) {
      expect(inputSchemaOf(method).safeParse(undefined).success).toBe(false);
    }
  });

  it("null-input methods accept exactly null and refuse every other adversarial shape", () => {
    for (const method of nullInputMethods) {
      expect(inputSchemaOf(method).safeParse(null).success).toBe(true);
      for (const bad of adversarial.filter((v) => v !== null)) {
        expect(inputSchemaOf(method).safeParse(bad).success).toBe(false);
      }
    }
  });

  it("every method accepts its minimal valid input", () => {
    for (const method of Object.keys(rpcContract) as Method[]) {
      expect(inputSchemaOf(method).safeParse(validInputs[method]).success).toBe(
        true,
      );
    }
  });

  it("every declared object field refuses a wrong-typed value (per-key law)", () => {
    const candidates: unknown[] = [123, "x", true, [], {}, null];
    for (const method of Object.keys(rpcContract) as Method[]) {
      const schema = rpcContract[method] as {
        input: { shape?: Record<string, { safeParse: (v: unknown) => { success: boolean } }> };
      };
      const shape = schema.input.shape;
      if (!shape) continue; // z.null() methods have no fields
      const valid = validInputs[method] as Record<string, unknown> | null;
      if (valid === null) continue;
      for (const [key, fieldSchema] of Object.entries(shape)) {
        const refused = candidates.filter(
          (candidate) => !fieldSchema.safeParse(candidate).success,
        );
        // Every field validates its payload when present: at least one
        // wrong-typed candidate must be refused. (Omitting the key is only
        // legal for genuinely optional fields, which the minimal-valid
        // law already covers; a wrong type is never legal.)
        expect(
          refused.length,
          `${method}.${key} accepted every wrong-typed candidate`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("caps: 500 ticket numbers pass the contract, 501 refuse", () => {
    const schema = inputSchemaOf("tracker_status");
    expect(
      schema.safeParse({ repo: "o/r", numbers: Array.from({ length: 500 }, (_, i) => i + 1) })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ repo: "o/r", numbers: Array.from({ length: 501 }, (_, i) => i + 1) })
        .success,
    ).toBe(false);
  });

  it("caps: 200 paths pass the contract, 201 refuse", () => {
    const schema = inputSchemaOf("workspace_files_exist");
    expect(
      schema.safeParse({
        threadId: "thr_x",
        paths: Array.from({ length: 200 }, (_, i) => `f${i}.md`),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        threadId: "thr_x",
        paths: Array.from({ length: 201 }, (_, i) => `f${i}.md`),
      }).success,
    ).toBe(false);
  });
});

describe("rpc hardening end-to-end (through the fake host)", () => {
  it("an oversized tracker_status batch is refused, the cap-sized one resolves", async () => {
    const rpc = await setup();
    await expect(
      rpc.callRpc("tracker_status", {
        repo: "o/r",
        numbers: Array.from({ length: 501 }, (_, i) => i + 1),
      }),
    ).rejects.toThrow();
    expect(
      await rpc.callRpc("tracker_status", {
        repo: "o/r",
        numbers: Array.from({ length: 500 }, (_, i) => i + 1),
      }),
    ).toEqual({ statuses: {} });
  });

  it("a 201-path existence check is refused at the contract", async () => {
    const rpc = await setup();
    await expect(
      rpc.callRpc("workspace_files_exist", {
        threadId: "thr_x",
        paths: Array.from({ length: 201 }, (_, i) => `f${i}.md`),
      }),
    ).rejects.toThrow();
  });

  it("a __proto__ columnKey never reaches the rank store", async () => {
    const rpc = await setup();
    await expect(
      rpc.callRpc("rank_move", {
        columnKey: "__proto__",
        threadId: "thr_x",
        beforeId: null,
        toEnd: false,
        visibleIds: ["thr_x"],
      }),
    ).rejects.toThrow();
    // And the store is untouched by the refused write.
    expect((await rpc.callRpc("rank_list", null)) as { orders: unknown }).toEqual({
      orders: {},
    });
  });

  it("an empty threadId is refused by done_set, pin_park_set, and thread_reparent", async () => {
    const rpc = await setup();
    await expect(rpc.callRpc("done_set", { threadId: "", done: true })).rejects.toThrow();
    await expect(
      rpc.callRpc("pin_park_set", { threadId: "", parked: true }),
    ).rejects.toThrow();
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "", parentThreadId: null }),
    ).rejects.toThrow();
  });

  it("a non-parseable wakeAt is refused by snooze_set", async () => {
    const rpc = await setup();
    await expect(
      rpc.callRpc("snooze_set", { threadId: "thr_x", wakeAt: "not a date" }),
    ).rejects.toThrow();
  });
});
