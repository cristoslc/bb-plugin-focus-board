// The composer's project seed precedence (lib/new-thread-seed): a child
// preset copies its PARENT'S project, even when a single-project board
// filter names something else; without a parent the single filter-selected
// project seeds, and stale project ids seed nothing so bb falls back to its
// default pick.
import { describe, expect, it } from "vitest";
import { newThreadSeedProjectId } from "../lib/new-thread-seed";

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