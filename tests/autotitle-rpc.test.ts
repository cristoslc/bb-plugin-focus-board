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