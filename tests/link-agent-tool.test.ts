// Unit C: the focus_board_link_issue agent tool (the AGENTS.md-style
// nudge surface). Red-first against the unregistered tool, then green.
import { describe, expect, it } from "vitest";
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { setup, linksOf } from "./helpers/link-fake-host";

function registered(host: FakePluginHost) {
  return host.harness.inspection.registrations.agentTools;
}

describe("focus_board_link_issue registration", () => {
  it("registers exactly one agent tool named focus_board_link_issue", async () => {
    const { host } = await setup();
    const tools = registered(host);
    expect(tools.map((tool) => tool.name)).toEqual(["focus_board_link_issue"]);
  });

  it("carries a sub-4096-char instructions nudge (the AGENTS.md-style push)", async () => {
    const { host } = await setup();
    const tool = registered(host)[0];
    expect(typeof tool.instructions).toBe("string");
    expect(tool.instructions!.length).toBeGreaterThan(40);
    expect(tool.instructions!.length).toBeLessThanOrEqual(4096);
    expect(tool.instructions).toMatch(/focus_board_link_issue/);
  });
});

describe("focus_board_link_issue execution (url form)", () => {
  it("links the calling thread from a full GitHub URL", async () => {
    const { host, harness, meta } = await setup({ threads: ["thread-test"] });
    await harness.callAgentTool("focus_board_link_issue", {
      url: "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
    });
    const links = linksOf(meta, "thread-test");
    expect(links).toHaveLength(1);
    expect(links![0]).toMatchObject({
      repo: "cristoslc/bb-plugin-focus-board",
      issue: 12,
      kind: "issue",
      source: "agent",
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "link-changed",
      payload: { threadIds: ["thread-test"] },
    });
  });

  it("parses pull URLs with their kind", async () => {
    const { host, harness, meta } = await setup({ threads: ["thread-test"] });
    await harness.callAgentTool("focus_board_link_issue", {
      url: "https://github.com/a/b/pull/9",
    });
    expect(linksOf(meta, "thread-test")![0].kind).toBe("pull");
  });
});

describe("focus_board_link_issue execution (number form)", () => {
  it("resolves the repo from the calling project's GitHub remote", async () => {
    const { host, harness, meta } = await setup({ threads: ["thread-test"] });
    await harness.callAgentTool("focus_board_link_issue", { number: 12 });
    const links = linksOf(meta, "thread-test");
    expect(links![0]).toMatchObject({
      repo: "a/b",
      issue: 12,
      kind: "issue",
      source: "agent",
    });
  });

  it("fails as an error result when no GitHub remote resolves (agent-retryable)", async () => {
    const { host, harness } = await setup({ threads: ["thread-test"], projectRemote: null });
    const result = await harness.callAgentTool("focus_board_link_issue", {
      number: 12,
    });
    expect(typeof result).toBe("object");
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toMatch(/github/i);
    expect(text).toMatch(/url/i);
  });
});

describe("focus_board_link_issue validation", () => {
  it("rejects input with neither url nor number (parse failure throws)", async () => {
    const { host, harness } = await setup();
    await expect(harness.callAgentTool("focus_board_link_issue", {})).rejects.toThrow();
  });

  it("rejects both url and number together (exactly one)", async () => {
    const { host, harness } = await setup();
    await expect(
      harness.callAgentTool("focus_board_link_issue", {
        url: "https://github.com/a/b/issues/12",
        number: 12,
      }),
    ).rejects.toThrow();
  });

  it("rejects an out-of-range number", async () => {
    const { host, harness } = await setup();
    await expect(
      harness.callAgentTool("focus_board_link_issue", { number: 0 }),
    ).rejects.toThrow();
  });
});