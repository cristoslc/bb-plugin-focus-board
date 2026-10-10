// Branch-rename side channel of the done gesture: marking a thread done
// renames its managed worktree branch under bb/done/, un-marking restores
// the original name. Driven through done_set on the fake host with a fake
// git terminal (the same surfaces the server glue uses).
import { describe, expect, it } from "vitest";
import { setup, type DoneTestHost } from "./helpers/done-fake-host";
import { WORKTREE_BRANCH_METADATA_KEY } from "../lib/worktree-branch";

/** The rename record written to the thread's metadata namespace. */
function renameRecordOf(
  meta: Map<string, unknown>,
  threadId: string,
): { originalBranch: string; doneBranch: string; at: string } | undefined {
  const namespace = meta.get(threadId) as Record<string, unknown> | undefined;
  return namespace?.[WORKTREE_BRANCH_METADATA_KEY] as
    | { originalBranch: string; doneBranch: string; at: string }
    | undefined;
}

/**
 * Wait for the fire-and-forget branch channel to quiesce: three identical
 * consecutive snapshots of the fake git state plus every thread's metadata
 * (15 ms apart, 2 s cap). The channel is intentionally unawaited in the
 * server, so tests settle on observable state instead of racing it.
 */
async function settleChannel(git: DoneTestHost["git"], meta: Map<string, unknown>): Promise<void> {
  const snapshot = () =>
    JSON.stringify([git.branches(), git.renames(), [...meta.entries()]]);
  let last = snapshot();
  let streak = 0;
  const deadline = Date.now() + 2_000;
  for (;;) {
      if (streak >= 3) return;
      if (Date.now() > deadline) {
        throw new Error(
          `branch channel did not quiesce (last: ${last.slice(0, 300)})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
      const next = snapshot();
      if (next === last) streak += 1;
      else {
        streak = 0;
        last = next;
      }
  }
}

/** Every done_set in this file targets thr_a; settle the channel after. */
async function setDone(host: DoneTestHost, done: boolean): Promise<void> {
  await host.callRpc("done_set", { threadId: "thr_a", done });
  await settleChannel(host.git, host.meta);
}

describe("done_set branch rename", () => {
  it("marks done and renames the managed branch under bb/done/, recording the original", async () => {
    const s = await setup({ branchByThread: { thr_a: "bb/mark-done-thr_a" } });
    await setDone(s, true);

    expect(s.git.branches()).toEqual(["bb/done/mark-done-thr_a"]);
    expect(s.git.history()).toContain(
      "branch -m bb/mark-done-thr_a bb/done/mark-done-thr_a ; exit",
    );
    const record = renameRecordOf(s.meta, "thr_a")!;
    expect(record.originalBranch).toBe("bb/mark-done-thr_a");
    expect(record.doneBranch).toBe("bb/done/mark-done-thr_a");
    expect(Number.isNaN(Date.parse(record.at))).toBe(false);
  });

  it("re-marking a done thread renames only once", async () => {
    const s = await setup({ branchByThread: { thr_a: "bb/mark-done-thr_a" } });
    await setDone(s, true);
    await setDone(s, true);
    expect(s.git.renames()).toBe(1);
  });

  it("skips a thread without an environment", async () => {
    const s = await setup({ threads: ["thr_a"] });
    await setDone(s, true);
    expect(s.git.renames()).toBe(0);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("skips a non-worktree (attached) environment", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/managed-thr_a" },
      provisionType: "unmanaged",
    });
    await setDone(s, true);
    expect(s.git.renames()).toBe(0);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("skips a branch outside the managed bb/ prefix", async () => {
    const s = await setup({ branchByThread: { thr_a: "feature/foo" } });
    await setDone(s, true);
    expect(s.git.renames()).toBe(0);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("does not rename when the done branch already exists (collision)", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/mark-done-thr_a" },
      extraBranches: ["bb/done/mark-done-thr_a"],
    });
    await setDone(s, true);
    expect(s.git.renames()).toBe(0);
    expect(s.git.history()).not.toContain("branch -m");
    // No rename happened, so no rename record may be written either —
    // un-do must never act on a rename that never occurred.
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("no-op when the rename setting is off", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/mark-done-thr_a" },
      renameBranchOnDone: false,
    });
    await setDone(s, true);
    expect(s.git.renames()).toBe(0);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });
});

describe("done_set branch restore on un-done", () => {
  it("renames the branch back to its original name and clears the record", async () => {
    const s = await setup({ branchByThread: { thr_a: "bb/mark-done-thr_a" } });
    await setDone(s, true);
    await setDone(s, false);

    expect(s.git.branches()).toEqual(["bb/mark-done-thr_a"]);
    expect(s.git.renames()).toBe(2);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("refuses the restore when the original branch name is now occupied", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/mark-done-thr_a" },
      occupyOriginalAfterRename: true,
    });
    await setDone(s, true);
    await setDone(s, false);

    // The renamed branch stays under bb/done/ (unmerged work is not lost);
    // the original is re-occupied, done is already cleared, and the stale
    // record is dropped so a later un-done retries nothing.
    expect(s.git.renames()).toBe(1);
    expect(s.git.branches()).toEqual([
      "bb/done/mark-done-thr_a",
      "bb/mark-done-thr_a",
    ]);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("drops the record without touching git when the environment is gone", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/mark-done-thr_a" },
      environmentGoneAfterRename: true,
    });
    await setDone(s, true);
    await setDone(s, false);

    expect(s.git.renames()).toBe(1);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });

  it("un-done without a rename record (setting was off at mark time) touches nothing", async () => {
    const s = await setup({
      branchByThread: { thr_a: "bb/mark-done-thr_a" },
      renameBranchOnDone: false,
    });
    await setDone(s, true);
    await setDone(s, false);
    expect(s.git.renames()).toBe(0);
    expect(renameRecordOf(s.meta, "thr_a")).toBeUndefined();
  });
});