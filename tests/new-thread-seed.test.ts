// The composer's project seed precedence (lib/new-thread-seed): a child
// preset copies its PARENT'S project, even when a single-project board
// filter names something else; without a parent the single filter-selected
// project seeds, and stale project ids seed nothing so bb falls back to its
// default pick.
import { describe, expect, it } from "vitest";
import {
  newThreadSeedEnvironment,
  newThreadSeedProjectId,
} from "../lib/new-thread-seed";

const known = ["proj_home", "proj_side", "personal_default"];

describe("newThreadSeedProjectId", () => {
  it("a child copies the parent's project even against the filter", () => {
    const seed = newThreadSeedProjectId({
      parentProjectId: "proj_home",
      filterProjectId: "proj_side",
      knownProjectIds: known,
    });
    expect(seed).toBe("proj_home");
  });

  it("without a parent, the single filter-selected project seeds", () => {
    const seed = newThreadSeedProjectId({
      filterProjectId: "proj_side",
      knownProjectIds: known,
    });
    expect(seed).toBe("proj_side");
  });

  it("a stale filter id seeds nothing (inverse)", () => {
    const seed = newThreadSeedProjectId({
      filterProjectId: "proj_deleted",
      knownProjectIds: known,
    });
    expect(seed).toBeUndefined();
  });

  it("no parent and no filter selects nothing", () => {
    const seed = newThreadSeedProjectId({ knownProjectIds: known });
    expect(seed).toBeUndefined();
  });

  it("an unresolvable parent falls back to the filter seed", () => {
    // The preset is about the parent: with the parent row missing (deleted
    // while the dialog is open) the spawn still carries parentThreadId, and
    // the seed degrades the same way any deleted-parent lookup does.
    const seed = newThreadSeedProjectId({
      parentProjectId: undefined,
      filterProjectId: "proj_side",
      knownProjectIds: known,
    });
    expect(seed).toBe("proj_side");
  });
});

describe("newThreadSeedEnvironment", () => {
  it("a worktree parent seeds a reuse environment", () => {
    // `reuse` is the composer's round-trippable "use this worktree as-is"
    // variant: the child starts in the parent's checkout, not a fresh
    // project-default one.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_1", isWorktree: true },
    });
    expect(seed).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("a non-worktree parent seeds nothing (inverse)", () => {
    // A plain checkout or provider machine cannot be expressed from a
    // sidebar row (no host or provider inputs); the composer's own default
    // for the already-seeded project is the honest fallback.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_2", isWorktree: false },
    });
    expect(seed).toBeUndefined();
  });

  it("an unknown worktree kind seeds nothing", () => {
    // isWorktree null: bb cannot say what the checkout is. A `reuse` guess
    // could point at a personal machine; no seed is the safe pick.
    const seed = newThreadSeedEnvironment({
      parentEnvironment: { id: "env_3", isWorktree: null },
    });
    expect(seed).toBeUndefined();
  });

  it("a parent with no environment seeds nothing", () => {
    expect(
      newThreadSeedEnvironment({ parentEnvironment: undefined }),
    ).toBeUndefined();
  });
});