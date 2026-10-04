import { describe, expect, it } from "vitest";
import { z } from "zod";
import { rpcContract } from "../server";
import { setup } from "./helpers/autotitle-fake-host";

describe("thread_autotitle contract", () => {
  it("takes a thread id and returns a title string", () => {
    expect(
      rpcContract.thread_autotitle.input.parse({ threadId: "thr_x" }),
    ).toEqual({ threadId: "thr_x" });
    expect(
      rpcContract.thread_autotitle.output.parse({ title: "Login redirect loop fix" }),
    ).toEqual({ title: "Login redirect loop fix" });
  });

  it("rejects an empty thread id and a non-string title", () => {
    expect(() => rpcContract.thread_autotitle.input.parse({ threadId: "" })).toThrow();
    expect(() => rpcContract.thread_autotitle.output.parse({ title: 3 })).toThrow(
      z.ZodError,
    );
  });
});

describe("thread_autotitle against the selected AI service", () => {
  it("routes the thread's first prompt through bb's thread-title service", async () => {
    const { callRpc, lastServiceCall } = await setup({});
    const out = (await callRpc("thread_autotitle", { threadId: "thr_x" })) as {
      title: string;
    };
    expect(out).toEqual({ title: "Login redirect loop fix" });
    const call = lastServiceCall();
    // The follow-bb contract: serve whatever service bb's thread-title task
    // is set to, through the generic cross-plugin RPC bridge.
    expect(call).not.toBeNull();
    expect(call!.pluginId).toBe("openrouter-inference");
    expect(call!.method).toBe("complete");
    expect(call!.input).toMatchObject({ prompt: expect.stringContaining("login redirect loop") });
  });

  it("cleans the model's reply before renaming", async () => {
    const { callRpc } = await setup({
      serviceReply: { text: '  "Fix\nthe   login  loop "\n  ' },
    });
    expect(await callRpc("thread_autotitle", { threadId: "thr_x" })).toEqual({
      title: "Fix the login loop",
    });
  });

  it("fails loud on an automatic selection (bb resolves it internally; plugins cannot invoke it)", async () => {
    const { callRpc } = await setup({ selection: { mode: "automatic" } });
    await expect(callRpc("thread_autotitle", { threadId: "thr_x" })).rejects.toThrow(
      /ai services/i,
    );
  });

  it("fails loud when the title task is off", async () => {
    const { callRpc } = await setup({ selection: { mode: "off" } });
    await expect(callRpc("thread_autotitle", { threadId: "thr_x" })).rejects.toThrow();
  });

  it("fails loud when the thread has no prompt text to title from", async () => {
    const { callRpc } = await setup({ history: [] });
    await expect(callRpc("thread_autotitle", { threadId: "thr_x" })).rejects.toThrow(
      /no prompt/i,
    );
  });

  it("fails loud when the selected service returns no usable title", async () => {
    const { callRpc } = await setup({ serviceReply: { text: "   " } });
    await expect(callRpc("thread_autotitle", { threadId: "thr_x" })).rejects.toThrow();
  });

  it("propagates the selected service's failure instead of degrading", async () => {
    const { callRpc } = await setup({
      serviceReply: () => {
        throw new Error("OpenRouter: 401 invalid key");
      },
    });
    await expect(callRpc("thread_autotitle", { threadId: "thr_x" })).rejects.toThrow(
      /401 invalid key/,
    );
  });
});
describe("thread_autotitle_services contract", () => {
  it("takes an empty input and returns selected plus service descriptors", () => {
    expect(rpcContract.thread_autotitle_services.input.parse({})).toEqual({});
    expect(
      rpcContract.thread_autotitle_services.output.parse({
        selected: { pluginId: "p", serviceId: "s" },
        services: [
          { pluginId: "p", serviceId: "s", displayName: "D", ready: true, message: null },
        ],
      }),
    ).toEqual({
      selected: { pluginId: "p", serviceId: "s" },
      services: [
        { pluginId: "p", serviceId: "s", displayName: "D", ready: true, message: null },
      ],
    });
    // No selection configured: the modal must still render.
    expect(
      rpcContract.thread_autotitle_services.output.parse({
        selected: null,
        services: [],
      }),
    ).toEqual({ selected: null, services: [] });
  });
});

describe("thread_autotitle_services against the fake host", () => {
  it("reports the selected service and every thread-title-capable one", async () => {
    const { callRpc } = await setup({
      services: [
        {
          pluginId: "openrouter-inference",
          id: "default",
          displayName: "OpenRouter",
          automaticRank: 1,
          status: { ready: true },
          tasks: ["thread-title"],
        },
        {
          pluginId: "voice-only",
          id: "stt",
          displayName: "Voice only",
          automaticRank: null,
          status: { ready: true },
          tasks: ["voice"],
        },
        {
          pluginId: "bb-ai",
          id: "cloud",
          displayName: "bb cloud",
          automaticRank: null,
          status: { ready: false, message: "Sign in to your bb account" },
          tasks: ["thread-title"],
        },
      ],
    });
    const out = (await callRpc("thread_autotitle_services", {})) as {
      selected: unknown;
      services: Array<{
        pluginId: string;
        serviceId: string;
        displayName: string;
        ready: boolean;
        message: string | null;
      }>;
    };
    expect(out.selected).toEqual({
      pluginId: "openrouter-inference",
      serviceId: "default",
    });
    expect(out.services).toEqual([
      { pluginId: "openrouter-inference", serviceId: "default", displayName: "OpenRouter", ready: true, message: null },
      { pluginId: "bb-ai", serviceId: "cloud", displayName: "bb cloud", ready: false, message: "Sign in to your bb account" },
    ]);
  });

  it("reports no selection when the task is not set to a plugin service", async () => {
    const { callRpc } = await setup({ selection: { mode: "automatic" } });
    const out = (await callRpc("thread_autotitle_services", {})) as {
      selected: unknown;
    };
    expect(out.selected).toBeNull();
  });
});

describe("thread_autotitle with an override target", () => {
  const SERVICES = [
    {
      pluginId: "openrouter-inference",
      id: "default",
      displayName: "OpenRouter",
      automaticRank: 1,
      status: { ready: true },
      tasks: ["thread-title"],
    },
    {
      pluginId: "other-plugin",
      id: "alt",
      displayName: "Other",
      automaticRank: null,
      status: { ready: true },
      tasks: ["thread-title"],
    },
    {
      pluginId: "third-plugin",
      id: "down",
      displayName: "Down service",
      automaticRank: null,
      status: { ready: false, message: "Sign in first" },
      tasks: ["thread-title"],
    },
    {
      pluginId: "voice-only",
      id: "stt",
      displayName: "Voice only",
      automaticRank: null,
      status: { ready: true },
      tasks: ["voice"],
    },
  ];

  it("routes the call through the requested alternative service", async () => {
    const { callRpc, lastServiceCall } = await setup({ services: SERVICES });
    const out = (await callRpc("thread_autotitle", {
      threadId: "thr_x",
      pluginId: "other-plugin",
      serviceId: "alt",
    })) as { title: string };
    expect(out).toEqual({ title: "Login redirect loop fix" });
    expect(lastServiceCall()?.pluginId).toBe("other-plugin");
  });

  it("rejects an override the host has not registered", async () => {
    const { callRpc } = await setup({ services: SERVICES });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", pluginId: "unknown", serviceId: "alt" }),
    ).rejects.toThrow(/registered/);
  });

  it("rejects an override that does not serve thread titles", async () => {
    const { callRpc } = await setup({ services: SERVICES });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", pluginId: "voice-only", serviceId: "stt" }),
    ).rejects.toThrow(/thread.-.title|thread titles/i);
  });

  it("rejects a not-ready override, naming the blocker", async () => {
    const { callRpc } = await setup({ services: SERVICES });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", pluginId: "third-plugin", serviceId: "down" }),
    ).rejects.toThrow(/Sign in first/);
  });

  it("rejects a half-given override", async () => {
    const { callRpc } = await setup({ services: SERVICES });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", pluginId: "other-plugin" }),
    ).rejects.toThrow(/together/);
  });
});
