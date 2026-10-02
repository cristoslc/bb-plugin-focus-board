import { describe, expect, it } from "vitest";
import { z } from "zod";
import { rpcContract } from "../server";

describe("sweep RPC contract", () => {
  it("sweep_config_get returns both thresholds as positive ms integers", () => {
    const parsed = rpcContract.sweep_config_get.output.parse({
      doneArchiveMs: 2 * 24 * 60 * 60 * 1000,
      idleArchiveMs: 12 * 60 * 60 * 1000,
    });
    expect(parsed.doneArchiveMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(parsed.idleArchiveMs).toBe(12 * 60 * 60 * 1000);
  });

  it("sweep_config_get output rejects non-integers and non-positives", () => {
    expect(() =>
      rpcContract.sweep_config_get.output.parse({ doneArchiveMs: 1.5, idleArchiveMs: 1000 }),
    ).toThrow(z.ZodError);
    expect(() =>
      rpcContract.sweep_config_get.output.parse({ doneArchiveMs: 0, idleArchiveMs: 1000 }),
    ).toThrow(z.ZodError);
  });

  it("sweep_keep_set round-trips a keep flag", () => {
    const input = rpcContract.sweep_keep_set.input.parse({ threadId: "thr_x", keep: true });
    expect(input).toEqual({ threadId: "thr_x", keep: true });
    const output = rpcContract.sweep_keep_set.output.parse({ threadId: "thr_x", keep: true });
    expect(output.keep).toBe(true);
  });

  it("sweep_keep_set rejects an empty thread id", () => {
    expect(() => rpcContract.sweep_keep_set.input.parse({ threadId: "", keep: true })).toThrow();
  });
});