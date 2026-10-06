// Unit B: link_set / link_clear / link_list RPCs, mirroring the done-RPC
// suite. Red-first: the fake host has no link handlers until server.ts
// grows them, so these suites fail before the wiring lands.
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { setup, linksOf } from "./helpers/link-fake-host";

describe("link_set over plugin metadata", () => {
  it("writing a link stamps the array under the linkedIssues key", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("link_set", {
      threadId: "thr_a",
      repo: "cristoslc/bb-plugin-focus-board",
      number: 12,
      kind: "issue",
      source: "operator",
    });
    const links = linksOf(meta, "thr_a");
    expect(links).toHaveLength(1);
    expect(links![0]).toMatchObject({
      repo: "cristoslc/bb-plugin-focus-board",
      issue: 12,
      kind: "issue",
      source: "operator",
    });
    expect(links![0].href).toBe(
      "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
    );
    expect(Number.isNaN(Date.parse(links![0].createdAt))).toBe(false);
  });

  it("publishes link-changed with the threadId", async () => {
    const { callRpc, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("link_set", {
      threadId: "thr_a",
      repo: "a/b",
      number: 12,
      kind: "issue",
      source: "agent",
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "link-changed",
      payload: { threadIds: ["thr_a"] },
    });
  });

  it("a re-set number stays one entry and moves to primary", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 9, kind: "pull", source: "agent" });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "agent" });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "pull", source: "agent" });
    const links = linksOf(meta, "thr_a");
    expect(links).toHaveLength(2);
    expect(links![0].issue).toBe(12);
    expect(links![0].kind).toBe("pull");
    expect(links![1].issue).toBe(9);
  });

  it("rejects a non-positive number (fail loud)", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    await expect(
      callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 0, kind: "issue", source: "agent" }),
    ).rejects.toThrow();
  });

  it("rejects an unknown source (fail loud)", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    await expect(
      callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "ghost" }),
    ).rejects.toThrow();
  });

  it("links are per-thread: another thread stays unlinked", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a", "thr_b"] });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "agent" });
    expect(linksOf(meta, "thr_b")).toBeUndefined();
  });
});

describe("link_clear over plugin metadata", () => {
  it("clears one number and publishes link-changed", async () => {
    const { callRpc, meta, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "agent" });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 9, kind: "pull", source: "agent" });
    await callRpc("link_clear", { threadId: "thr_a", number: 12 });
    expect(linksOf(meta, "thr_a")!.map((l) => l.issue)).toEqual([9]);
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "link-changed",
      payload: { threadIds: ["thr_a"] },
    });
  });

  it("clears everything when no number is given (remove: key)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "agent" });
    await callRpc("link_clear", { threadId: "thr_a" });
    const namespace = meta.get("thr_a") as Record<string, JsonValue> | undefined;
    expect(namespace).toEqual({});
  });

  it("clearing an unlinked thread is idempotent, still publishes", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    await expect(callRpc("link_clear", { threadId: "thr_a" })).resolves.toMatchObject({
      threadId: "thr_a",
      cleared: true,
    });
  });
});

describe("link_list over plugin metadata", () => {
  it("returns the link arrays for live threads", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a", "thr_b"] });
    await callRpc("link_set", { threadId: "thr_a", repo: "a/b", number: 12, kind: "issue", source: "agent" });
    expect(await callRpc("link_list", null)).toEqual({
      links: { thr_a: linksOf(meta, "thr_a") },
    });
  });

  it("drops links on threads that left the live list (archived)", async () => {
    const { callRpc, meta } = await setup({ threads: [] });
    meta.set("thr_archived", {
      linkedIssues: [
        { repo: "a/b", issue: 12, kind: "issue", href: "https://github.com/a/b/issues/12", createdAt: "2026-10-05T22:00:00.000Z", source: "auto" },
      ],
    });
    expect(await callRpc("link_list", null)).toEqual({ links: {} });
  });

  it("fails loud on a malformed link record (never coerces)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_bad"] });
    meta.set("thr_bad", { linkedIssues: "nope" });
    await expect(callRpc("link_list", null)).rejects.toThrow(/linked issues/);
  });

  it("returns empty when nothing is linked", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    expect(await callRpc("link_list", null)).toEqual({ links: {} });
  });
});