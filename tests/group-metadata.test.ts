import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import {
  GROUP_METADATA_KEY,
  GROUPS_KV_KEY,
  createGroupRecord,
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