import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import server from "../server";

type Bb = BbPluginApi;

/**
 * The sweep threshold config's behavior through the real server handlers:
 * defaults when the KV row is absent, partial writes merge and persist, and
 * a corrupt row fails loud instead of silently resetting the thresholds.
 */
describe("sweep threshold config RPC", () => {
  let bb: Bb;
  let harness: FakePluginHarness;

  async function load(): Promise<void> {
    const host = createFakePluginHost({ pluginId: "focus-board" });
    bb = host.bb;
    harness = host.harness;
    await server(bb);
  }

  afterEach(async () => {
    await harness.lifecycle.dispose();
  });

  it("returns the defaults when nothing is stored", async () => {
    await load();
    await expect(harness.behavior.callRpc("sweep_settings_get", null)).resolves.toEqual({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 2,
      idleArchiveUnit: "days",
    });
  });

  it("a partial write merges, persists, and echoes the whole config", async () => {
    await load();
    await expect(
      harness.behavior.callRpc("sweep_settings_set", { idleArchiveUnit: "weeks" }),
    ).resolves.toEqual({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 2,
      idleArchiveUnit: "weeks",
    });
    // Persisted: a fresh read sees the written unit, and sweep_config_get
    // resolves it to exact epoch ms (2 weeks).
    await expect(harness.behavior.callRpc("sweep_settings_get", null)).resolves.toMatchObject({
      idleArchiveUnit: "weeks",
    });
    await expect(harness.behavior.callRpc("sweep_config_get", null)).resolves.toEqual({
      doneArchiveMs: 2 * 24 * 60 * 60 * 1000,
      idleArchiveMs: 2 * 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("rejects a patch that violates an arm's schema", async () => {
    await load();
    await expect(
      harness.behavior.callRpc("sweep_settings_set", { doneArchiveValue: 366 }),
    ).rejects.toThrow();
    // The stored config is untouched by the rejected write.
    await expect(harness.behavior.callRpc("sweep_settings_get", null)).resolves.toEqual({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 2,
      idleArchiveUnit: "days",
    });
  });

  it("fails loud on a stored row that fails validation", async () => {
    await load();
    await bb.storage.kv.set("sweep-config", { doneArchiveValue: "lots" });
    await expect(harness.behavior.callRpc("sweep_settings_get", null)).rejects.toThrow(
      /sweep-config.*failed validation/s,
    );
  });
});
