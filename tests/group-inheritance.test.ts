// The child-spawn group inheritance rule: a child thread spawned from a
// grouped parent carries the parent's feature-group membership as real
// metadata (the operator's decided design, 2026-10-12 — "Metadata at
// spawn"). The resolver is pure so the app's spawn-success path stays thin
// and the precedence is pinned here instead of buried in app.tsx.
import { describe, expect, it } from "vitest";
import { spawnInheritedGroupId } from "../lib/group-inheritance";

describe("spawnInheritedGroupId — which group the composer's spawn tags into", () => {
  it("a child preset over a grouped parent inherits the parent's group", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: null,
        parentThreadId: "thr_p",
        parentGroupId: "grp_auth",
      }),
    ).toBe("grp_auth");
  });

  it("a armed group preset tags its own group (explicit intent wins)", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: "grp_auth",
        parentThreadId: null,
        parentGroupId: undefined,
      }),
    ).toBe("grp_auth");
  });

  it("a child preset over an ungrouped parent tags nothing", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: null,
        parentThreadId: "thr_p",
        parentGroupId: undefined,
      }),
    ).toBeUndefined();
  });

  it("a plain root spawn with no presets tags nothing", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: null,
        parentThreadId: null,
        parentGroupId: undefined,
      }),
    ).toBeUndefined();
  });

  it("an armed group preset beats parent inheritance when both could fire (the presets are exclusive; the explicit one wins the corner)", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: "grp_explicit",
        parentThreadId: "thr_p",
        parentGroupId: "grp_parent",
      }),
    ).toBe("grp_explicit");
  });

  it("a preset armed with an id that turns out empty tags nothing (fail loud, never coerce an empty string into a membership)", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: "",
        parentThreadId: null,
        parentGroupId: undefined,
      }),
    ).toBeUndefined();
  });

  it("a parent-preset id that turns out empty tags nothing the same way", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: null,
        parentThreadId: "",
        parentGroupId: "grp_auth",
      }),
    ).toBeUndefined();
  });

  it("a parent with null membership (unassigned) tags nothing", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: null,
        parentThreadId: "thr_p",
        parentGroupId: null,
      }),
    ).toBeUndefined();
  });

  it("an armed preset that later resolved to a group no longer in the registry still tags (membership validity is the RPC's concern, not the resolver's)", () => {
    expect(
      spawnInheritedGroupId({
        presetGroupId: "grp_gone",
        parentThreadId: null,
        parentGroupId: undefined,
      }),
    ).toBe("grp_gone");
  });
});