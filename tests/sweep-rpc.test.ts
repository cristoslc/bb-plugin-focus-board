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

  it("sweep_settings_get returns the full value+unit config", () => {
    const parsed = rpcContract.sweep_settings_get.output.parse({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 3,
      idleArchiveUnit: "weeks",
    });
    expect(parsed).toEqual({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 3,
      idleArchiveUnit: "weeks",
    });
  });

  it("sweep_settings_set accepts a partial patch and rejects bad fields", () => {
    expect(rpcContract.sweep_settings_set.input.parse({})).toEqual({});
    expect(rpcContract.sweep_settings_set.input.parse({ doneArchiveValue: 14 })).toEqual({
      doneArchiveValue: 14,
    });
    expect(
      rpcContract.sweep_settings_set.input.parse({ idleArchiveUnit: "hours" }),
    ).toEqual({ idleArchiveUnit: "hours" });
    // Out-of-cap, fractional, and foreign-unit patches all reject.
    expect(() => rpcContract.sweep_settings_set.input.parse({ doneArchiveValue: 366 })).toThrow(
      z.ZodError,
    );
    expect(() => rpcContract.sweep_settings_set.input.parse({ idleArchiveValue: 0.5 })).toThrow(
      z.ZodError,
    );
    expect(() => rpcContract.sweep_settings_set.input.parse({ doneArchiveUnit: "years" })).toThrow(
      z.ZodError,
    );
  });

  it("sweep_settings_set output carries the whole effective config", () => {
    const output = {
      doneArchiveValue: 14,
      doneArchiveUnit: "days",
      idleArchiveValue: 2,
      idleArchiveUnit: "days",
    };
    expect(rpcContract.sweep_settings_set.output.parse(output)).toEqual(output);
    // A partial write's response is never partial: a missing field rejects.
    expect(() => rpcContract.sweep_settings_set.output.parse({ doneArchiveValue: 14 })).toThrow(
      z.ZodError,
    );
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