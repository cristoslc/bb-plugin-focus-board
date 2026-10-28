/**
 * The release-safety runner (scripts/release-safety.mjs) replaced the old
 * package.json `a && b && c && d` chain so a failure can name its gate in the
 * release notification (issue #294). These tests pin the exit-code contract:
 * the runner returns the failing stage's own code, and a notification failure
 * can never change it.
 */
import { describe, expect, it, vi } from "vitest";
import { RELEASE_SAFETY_STAGES, runReleaseSafety } from "../scripts/release-safety.mjs";

const quiet = { log: () => {}, warn: () => {} };

describe("runReleaseSafety", () => {
  it("runs every stage in order and returns 0 on a clean pass", async () => {
    const ran: string[] = [];
    const notify = vi.fn();
    const code = await runReleaseSafety({
      stages: [{ name: "a" }, { name: "b" }],
      run: (stage: { name: string }) => {
        ran.push(stage.name);
        return { status: 0 };
      },
      notify,
      ...quiet,
    });
    expect(code).toBe(0);
    expect(ran).toEqual(["a", "b"]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stops at the first failing stage and notifies naming it", async () => {
    const ran: string[] = [];
    const notify = vi.fn(async () => ({ sent: true }));
    const code = await runReleaseSafety({
      stages: [{ name: "build" }, { name: "uat" }],
      run: (stage: { name: string }) => {
        ran.push(stage.name);
        return { status: stage.name === "build" ? 7 : 0 };
      },
      notify,
      ...quiet,
    });
    expect(code).toBe(7);
    expect(ran).toEqual(["build"]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ gate: "release-safety:build" }),
    );
  });

  it("a notification failure never changes the gate's exit code", async () => {
    const code = await runReleaseSafety({
      stages: [{ name: "uat" }],
      run: () => ({ status: 3 }),
      notify: async () => {
        throw new Error("ntfy down");
      },
      ...quiet,
    });
    expect(code).toBe(3);
  });

  it("maps a spawn-level failure (null status) to a non-zero code", async () => {
    const code = await runReleaseSafety({
      stages: [{ name: "release-shots" }],
      run: () => ({ status: 1 }),
      notify: vi.fn(async () => ({ sent: false })),
      ...quiet,
    });
    expect(code).toBe(1);
  });

  it("exposes the four documented stages in order", () => {
    expect(RELEASE_SAFETY_STAGES.map((stage: { name: string }) => stage.name)).toEqual([
      "check-node-modules",
      "build",
      "uat",
      "release-shots",
    ]);
  });
});
