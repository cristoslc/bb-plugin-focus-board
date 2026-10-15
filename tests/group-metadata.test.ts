import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import {
  GROUP_METADATA_KEY,
  GROUPS_KV_KEY,
  createGroupRecord,
  groupBoxMenuActions,
  groupMenuActions,
  groupsRowFromStore,
  normalizeGroupName,
  parseGroupMember,
  parseGroupsStore,
  pruneEmptyGroups,
} from "../lib/group-metadata";

describe("parseGroupMember", () => {
  it("absent and null mean unassigned (null out)", () => {
    expect(parseGroupMember(undefined)).toBeNull();
    expect(parseGroupMember(null)).toBeNull();
  });

  it("a well-formed record parses", () => {
    expect(parseGroupMember({ groupId: "grp_1" } as JsonValue)).toEqual({ groupId: "grp_1" });
  });

  it("malformed values throw (fail loud, never coerce)", () => {
    expect(() => parseGroupMember("nope" as JsonValue)).toThrow(/group metadata/);
    expect(() => parseGroupMember([{ groupId: "grp_1" }] as unknown as JsonValue)).toThrow(/expected object/);
    expect(() => parseGroupMember({ groupId: "" } as JsonValue)).toThrow(/invalid groupId/);
    expect(() => parseGroupMember({ groupId: 7 } as JsonValue)).toThrow(/invalid groupId/);
  });
});

describe("parseGroupsStore", () => {
  it("absent and null mean no groups yet (empty store, not a failure)", () => {
    expect(parseGroupsStore(undefined)).toEqual({});
    expect(parseGroupsStore(null)).toEqual({});
  });

  it("a malformed row throws, naming the shape it got", () => {
    expect(() => parseGroupsStore([1, 2])).toThrow(/expected object/);
  });

  it("each record must carry a usable name and createdAt", () => {
    expect(() => parseGroupsStore({ grp_1: { name: "  " } })).toThrow(/invalid name/);
    expect(() =>
      parseGroupsStore({ grp_1: { name: "Auth", createdAt: "not-a-date" } }),
    ).toThrow(/invalid createdAt/);
  });

  it("a __proto__ key is rejected, not interpreted", () => {
    // A KV row arrives through JSON, where "__proto__" becomes an OWN
    // property — the same route a malicious or corrupt row would take.
    const row = JSON.parse('{ "__proto__": { "name": "x", "createdAt": "2026-01-01" } }');
    expect(() => parseGroupsStore(row)).toThrow(/__proto__/);
  });

  it("round-trips through groupsRowFromStore", () => {
    const now = new Date("2026-10-09T00:00:00.000Z");
    const store = { grp_1: createGroupRecord("Auth rework", now) };
    expect(parseGroupsStore(JSON.parse(JSON.stringify(groupsRowFromStore(store))))).toEqual(store);
  });
});

describe("createGroupRecord", () => {
  it("stamps createdAt at now", () => {
    const now = new Date();
    const record = createGroupRecord("Auth rework", now);
    expect(record.name).toBe("Auth rework");
    expect(Date.parse(record.createdAt)).toBe(now.getTime());
  });
});

describe("normalizeGroupName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeGroupName("  Auth rework  ")).toBe("Auth rework");
  });
  it("rejects blank and overlong names with null (disabled confirm, no fallback)", () => {
    expect(normalizeGroupName("   ")).toBeNull();
    expect(normalizeGroupName("")).toBeNull();
    expect(normalizeGroupName("x".repeat(81))).toBeNull();
  });
  it("accepts exactly 80 characters", () => {
    expect(normalizeGroupName("x".repeat(80))).toBe("x".repeat(80));
  });
});

describe("pruneEmptyGroups", () => {
  const now = new Date("2026-10-09T00:00:00.000Z");
  const store = {
    grp_busy: createGroupRecord("Busy", now),
    grp_empty: createGroupRecord("Empty", now),
  };

  it("keeps groups with at least one assigned thread", () => {
    const counts = new Map([["grp_busy", 2]]);
    expect(Object.keys(pruneEmptyGroups(store, counts))).toEqual(["grp_busy"]);
  });

  it("an absent count is zero members", () => {
    expect(Object.keys(pruneEmptyGroups(store, new Map()))).toEqual([]);
  });

  it("archived members still count — the assignment persists", () => {
    const counts = new Map([["grp_empty", 1]]);
    expect(Object.keys(pruneEmptyGroups(store, counts))).toEqual(["grp_empty"]);
  });

  it("mutates nothing: the input store survives", () => {
    pruneEmptyGroups(store, new Map());
    expect(store.grp_empty.name).toBe("Empty");
  });
});

describe("groupMenuActions", () => {
  it("an unassigned card carries one entry that opens the picker", () => {
    let opened = false;
    const actions = groupMenuActions({ grouped: false, openPicker: () => (opened = true) });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "group", label: "Group…", icon: "Tag" });
    actions[0].run();
    expect(opened).toBe(true);
  });

  it("an assigned card says 'Change group…' and carries the same picker target", () => {
    const actions = groupMenuActions({ grouped: true, openPicker: () => undefined });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "group-change", label: "Change group…" });
  });
});

// Silence an unused-import warning while GROUP_METADATA_KEY stays asserted
// only in lib tests: the metadata key contract rides the RPC suite.
describe("the metadata key contract", () => {
  it("the assignment key is the stable string 'group'", () => {
    expect(GROUP_METADATA_KEY).toBe("group");
    expect(GROUPS_KV_KEY).toBe("focus-board:groups");
  });
});

describe("groupBoxMenuActions (the group box's own right-click menu)", () => {
  it("carries all four entries in order: spawn, rename, show-only-group, ungroup-all", () => {
    const actions = groupBoxMenuActions({
      armed: false,
      spawn: () => undefined,
      rename: () => undefined,
      isolate: () => undefined,
      ungroup: () => undefined,
    });
    expect(actions.map((action) => action.id)).toEqual([
      "new-thread-in-group",
      "rename-group",
      "show-only-group",
      "ungroup-all",
    ]);
    expect(actions.map((action) => action.label)).toEqual([
      "New thread in group…",
      "Rename group…",
      "Show only this group's issues",
      "Ungroup all members",
    ]);
  });

  it("runs are the caller's closures", () => {
    let ran = "";
    const actions = groupBoxMenuActions({
      armed: false,
      spawn: () => (ran = "spawn"),
      rename: () => (ran = "rename"),
      isolate: () => (ran = "isolate"),
      ungroup: () => (ran = "ungroup"),
    });
    for (const action of actions) action.run();
    expect(ran).toBe("ungroup");
  });

  it("an unwired capability is omitted, never a dead menu entry", () => {
    expect(
      groupBoxMenuActions({
        armed: false,
        spawn: undefined,
        rename: undefined,
        isolate: undefined,
        ungroup: undefined,
      }),
    ).toEqual([]);
    const spawnOnly = groupBoxMenuActions({
      armed: false,
      spawn: () => undefined,
      rename: undefined,
      isolate: undefined,
      ungroup: undefined,
    });
    expect(spawnOnly.map((action) => action.id)).toEqual(["new-thread-in-group"]);
    const isolateOnly = groupBoxMenuActions({
      armed: false,
      spawn: undefined,
      rename: undefined,
      isolate: () => undefined,
      ungroup: undefined,
    });
    expect(isolateOnly.map((action) => action.id)).toEqual(["show-only-group"]);
  });

  it("the isolate entry never arms: no click-again wording, no danger tint", () => {
    const actions = groupBoxMenuActions({
      armed: true,
      spawn: () => undefined,
      rename: () => undefined,
      isolate: () => undefined,
      ungroup: () => undefined,
    });
    const isolate = actions.find((action) => action.id === "show-only-group")!;
    expect(isolate.label).toBe("Show only this group's issues");
    expect(isolate.danger).toBeUndefined();
  });

  it("the ungroup entry arms in place: the armed menu says click-again and draws danger", () => {
    const armed = groupBoxMenuActions({
      armed: true,
      spawn: () => undefined,
      rename: () => undefined,
      isolate: () => undefined,
      ungroup: () => undefined,
    });
    const ungroup = armed.find((action) => action.id === "ungroup-all")!;
    expect(ungroup.label).toMatch(/click again/i);
    expect(ungroup.danger).toBe(true);
    // The other entries never arm.
    expect(
      armed
        .filter((action) => action.id !== "ungroup-all")
        .every((action) => action.danger !== true && !/click again/i.test(action.label)),
    ).toBe(true);
  });
});