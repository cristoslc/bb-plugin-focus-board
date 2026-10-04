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
  it("takes a thread id and returns selected, services, and thread-model availability", () => {
    expect(
      rpcContract.thread_autotitle_services.input.parse({ threadId: "thr_x" }),
    ).toEqual({ threadId: "thr_x" });
    expect(
      rpcContract.thread_autotitle_services.output.parse({
        selected: { pluginId: "p", serviceId: "s" },
        services: [
          { pluginId: "p", serviceId: "s", displayName: "D", ready: true, message: null, bridge: true, bridgeReason: null },
        ],
        threadModel: { available: true, reason: null },
      }),
    ).toEqual({
      selected: { pluginId: "p", serviceId: "s" },
      services: [
        { pluginId: "p", serviceId: "s", displayName: "D", ready: true, message: null, bridge: true, bridgeReason: null },
      ],
      threadModel: { available: true, reason: null },
    });
    // No selection configured: the modal must still render.
    expect(
      rpcContract.thread_autotitle_services.output.parse({
        selected: null,
        services: [],
        threadModel: { available: false, reason: "no model" },
      }),
    ).toEqual({
      selected: null,
      services: [],
      threadModel: { available: false, reason: "no model" },
    });
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
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as {
      selected: unknown;
      services: Array<{
        pluginId: string;
        serviceId: string;
        displayName: string;
        ready: boolean;
        message: string | null;
        bridge: boolean;
        bridgeReason: string | null;
      }>;
    };
    expect(out.selected).toEqual({
      pluginId: "openrouter-inference",
      serviceId: "default",
    });
    expect(out.services).toEqual([
      // The ready OpenRouter row gets bridge-verified via the invalid-input
      // probe (fake host answers → true); the not-ready bb cloud row skips
      // the probe and reports bridge:false with its own message carrying.
      { pluginId: "openrouter-inference", serviceId: "default", displayName: "OpenRouter", ready: true, message: null, bridge: true, bridgeReason: null },
      { pluginId: "bb-ai", serviceId: "cloud", displayName: "bb cloud", ready: false, message: "Sign in to your bb account", bridge: false, bridgeReason: null },
    ]);
  });

  it("reports no selection when the task is not set to a plugin service", async () => {
    const { callRpc } = await setup({ selection: { mode: "automatic" } });
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as {
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

describe("thread_autotitle useThreadModel contract", () => {
  it("accepts a useThreadModel flag beside the thread id", () => {
    expect(
      rpcContract.thread_autotitle.input.parse({
        threadId: "thr_x",
        useThreadModel: true,
      }),
    ).toEqual({ threadId: "thr_x", useThreadModel: true });
    // Overriding a service stays available: providers remain the first option.
    expect(
      rpcContract.thread_autotitle.input.parse({
        threadId: "thr_x",
        pluginId: "p",
        serviceId: "s",
      }),
    ).toEqual({ threadId: "thr_x", pluginId: "p", serviceId: "s" });
  });
});

describe("thread_autotitle via the thread's own model (hidden probe thread)", () => {
  it("spawns a hidden probe on the source thread's model, reads the reply, deletes the probe", async () => {
    const { callRpc, lastSpawn, lastServiceCall, deletedProbes, stoppedProbes } =
      await setup({ history: undefined });
    const out = (await callRpc("thread_autotitle", {
      threadId: "thr_x",
      useThreadModel: true,
    })) as { title: string };
    expect(out).toEqual({ title: "Login redirect loop fix" });
    const spawn = lastSpawn();
    expect(spawn).not.toBeNull();
    expect(spawn!["projectId"]).toBe("proj_1");
    // Reuse the source thread's environment: the probe never runs elsewhere.
    expect(spawn!["environment"]).toEqual({ type: "reuse", environmentId: "env_1" });
    // Hidden, explicitly titled (so bb's own title task never runs), and the
    // model/pair pinned explicit — bb drops requested models without provenance.
    expect(spawn!["visibility"]).toBe("hidden");
    expect(spawn!["title"]).toMatch(/probe/i);
    expect(spawn!["providerId"]).toBe("claude-code");
    expect(spawn!["model"]).toBe("claude-sonnet-4-6");
    expect(spawn!["executionInputSources"]).toEqual({
      providerId: "explicit",
      model: "explicit",
    });
    // The prompt is the thread's text plus the no-tools guardrail.
    expect(String(spawn!["prompt"])).toContain("login redirect loop");
    expect(String(spawn!["prompt"])).toMatch(/no tools/i);
    // The bridge to plugin services is untouched on this path.
    expect(lastServiceCall()).toBeNull();
    // Cleanup: the probe is deleted; nothing needed stopping on success.
    expect(deletedProbes()).toHaveLength(1);
    expect(stoppedProbes()).toEqual([]);
  });

  it("falls back to spawning without a provider/model when bb does not resolve a pair", async () => {
    // bb's defaultExecutionOptions can return null live (empty-input
    // capability validation) even for threads that run fine; a hidden child
    // without a provider/model override inherits bb's own spawn default
    // chain (project remembered default → global), exactly what a new
    // thread in the project would get.
    const { callRpc, lastSpawn, lastServiceCall, deletedProbes } = await setup({
      executionOptions: null,
    });
    const out = (await callRpc("thread_autotitle", {
      threadId: "thr_x",
      useThreadModel: true,
    })) as { title: string };
    expect(out).toEqual({ title: "Login redirect loop fix" });
    const spawn = lastSpawn() as Record<string, unknown> | null;
    expect(spawn).not.toBeNull();
    expect(spawn && "providerId" in spawn).toBe(false);
    expect(spawn && "model" in spawn).toBe(false);
    expect(lastServiceCall()).toBeNull();
    expect(deletedProbes()).toHaveLength(1);
  });

  it("refuses with the named reason when the probe turn errors", async () => {
    const { callRpc, deletedProbes, stoppedProbes } = await setup({
      probeStatuses: ["pending", "error"],
    });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", useThreadModel: true }),
    ).rejects.toThrow(/failed|error/i);
    expect(deletedProbes()).toHaveLength(1);
    expect(stoppedProbes()).toHaveLength(1);
  });

  it("refuses when the probe never writes an assistant reply", async () => {
    const { callRpc, deletedProbes } = await setup({
      probeTimeline: { rows: [{ kind: "conversation", role: "user", text: "hm", id: "r1" }], maxSeq: 1 },
    });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", useThreadModel: true }),
    ).rejects.toThrow(/no .*reply|no .*title/i);
    expect(deletedProbes()).toHaveLength(1);
  });
});

describe("thread-model spawn fallback chain", () => {
  it("spawns with the source thread's provider and no model when bb cannot resolve a pair", async () => {
    // bb resolves missing-model spawns against the provider's own catalog
    // default, so cloning just the provider keeps the probe on the same
    // agent stack without guessing a model.
    const { callRpc, lastSpawn, deletedProbes } = await setup({
      executionOptions: null,
      threadRow: {
        id: "thr_x",
        projectId: "proj_1",
        environmentId: "env_1",
        providerId: "acp-opencode",
        status: "idle",
        visibility: "visible",
      },
      probeTimeline: { rows: [{ kind: "conversation", role: "assistant", text: "Provider default title", id: "r2" }], maxSeq: 3 },
    });
    const out = (await callRpc("thread_autotitle", {
      threadId: "thr_x",
      useThreadModel: true,
    })) as { title: string };
    expect(out).toEqual({ title: "Provider default title" });
    const spawn = lastSpawn() as Record<string, unknown> | null;
    expect(spawn).toMatchObject({ providerId: "acp-opencode" });
    expect("model" in spawn!).toBe(false);
    expect(spawn?.executionInputSources).toEqual({ providerId: "explicit" });
    expect(deletedProbes()).toHaveLength(1);
  });

  it("the services menu reports the provider chain as available", async () => {
    const { callRpc } = await setup({
      executionOptions: null,
      threadRow: {
        id: "thr_x",
        projectId: "proj_1",
        environmentId: "env_1",
        providerId: "acp-opencode",
        status: "idle",
        visibility: "visible",
      },
    });
    const out = (await callRpc("thread_autotitle_services", { threadId: "thr_x" })) as {
      threadModel: { available: boolean; reason: string | null };
    };
    expect(out.threadModel.available).toBe(true);
  });

  it("refuses only when there is no resolved pair, no provider, and no project", async () => {
    const { callRpc, lastSpawn } = await setup({
      executionOptions: null,
      threadRow: { id: "thr_x", status: "idle" },
    });
    await expect(
      callRpc("thread_autotitle", { threadId: "thr_x", useThreadModel: true }),
    ).rejects.toThrow(/no resolved provider\/model/i);
    expect(lastSpawn()).toBeNull();
  });
});

describe("thread_autotitle_services thread-model availability", () => {
  it("is part of the services menu shape", () => {
    const parsed = rpcContract.thread_autotitle_services.output.parse({
      selected: null,
      services: [],
      threadModel: { available: true, reason: null },
    });
    expect(parsed.threadModel).toEqual({ available: true, reason: null });
  });

  it("reports available when the source thread carries a model and project", async () => {
    const { callRpc } = await setup({});
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as { threadModel: { available: boolean; reason: string | null } };
    expect(out.threadModel.available).toBe(true);
    expect(out.threadModel.reason).toBeNull();
  });

  it("reports the inherit chain as available even when no pair resolves", async () => {
    // The old behavior refused here; a hidden child without a provider/
    // model override legitimately inherits bb's spawn default chain, and a
    // failing spawn names itself in the probe error.
    const { callRpc } = await setup({ executionOptions: null });
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as { threadModel: { available: boolean; reason: string | null } };
    expect(out.threadModel.available).toBe(true);
    expect(out.threadModel.reason).toBeNull();
  });

  it("reports unavailable when there is no pair, provider, or project", async () => {
    const { callRpc } = await setup({
      executionOptions: null,
      threadRow: { id: "thr_x", status: "idle" },
    });
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as { threadModel: { available: boolean; reason: string | null } };
    expect(out.threadModel.available).toBe(false);
    expect(out.threadModel.reason).not.toBeNull();
  });

  it("reports unavailable when the thread has no project to spawn the probe into", async () => {
    const { callRpc } = await setup({
      threadRow: { id: "thr_x", projectId: null, environmentId: null, status: "idle" },
    });
    const out = (await callRpc("thread_autotitle_services", {
      threadId: "thr_x",
    })) as { threadModel: { available: boolean; reason: string | null } };
    expect(out.threadModel.available).toBe(false);
    expect(out.threadModel.reason).not.toBeNull();
  });
});

describe("thread_autotitle_services bridge classification", () => {
  // Distinct plugin ids per test: the bridge-status cache is process-wide
  // and keying by plugin id means one test's classification must never
  // leak into another's.
  const SERVICES = (ids: string[]) =>
    ids.map((id) => ({
      pluginId: id,
      id: "default",
      displayName: `${id} service`,
      automaticRank: null,
      status: { ready: true },
      tasks: ["thread-title", "commit-message"],
    }));

  it("reports bridge:true for a service whose plugin takes the complete call", async () => {
    const { callRpc } = await setup({
      selection: { mode: "off" },
      services: SERVICES(["svc-ok"]),
    });
    const out = (await callRpc("thread_autotitle_services", { threadId: "thr_x" })) as {
      services: Array<{ bridge: boolean; bridgeReason: string | null }>;
    };
    expect(out.services[0]).toMatchObject({ bridge: true, bridgeReason: null });
  });

  it("reports bridge:false for a plugin without the complete method, the 404 shape", async () => {
    const { callRpc } = await setup({
      selection: { mode: "off" },
      services: SERVICES(["svc-404"]),
      rpcErrorByPluginId: {
        "svc-404": 'HTTP 404: plugin "svc-404" has no rpc method "complete"',
      },
    });
    const out = (await callRpc("thread_autotitle_services", { threadId: "thr_x" })) as {
      services: Array<{ bridge: boolean; bridgeReason: string | null }>;
    };
    expect(out.services[0].bridge).toBe(false);
    expect(out.services[0].bridgeReason).toMatch(/bridge|complete/i);
  });

  it("the capability probe can never trigger a model call: the prompt is not a string", async () => {
    const { callRpc, lastServiceCall } = await setup({
      selection: { mode: "off" },
      services: SERVICES(["svc-probe"]),
    });
    await callRpc("thread_autotitle_services", { threadId: "thr_x" });
    const call = lastServiceCall();
    expect(call?.method).toBe("complete");
    // A non-string prompt fails the target contract's own validation in
    // the plugin that HAS the bridge, and a 404 in one that has not —
    // either way no model is ever billed.
    expect(call?.input).toMatchObject({ prompt: 1 });
  });

  it("caches the classification: repeated menus probe a plugin only once", async () => {
    const { callRpc, allServiceCalls } = await setup({
      selection: { mode: "off" },
      services: SERVICES(["svc-cached"]),
    });
    await callRpc("thread_autotitle_services", { threadId: "thr_x" });
    await callRpc("thread_autotitle_services", { threadId: "thr_x" });
    expect(
      allServiceCalls().filter((call) => call.pluginId === "svc-cached"),
    ).toHaveLength(1);
  });

  it("the contract requires the bridge fields on every service entry", () => {
    const entry = {
      pluginId: "p",
      serviceId: "s",
      displayName: "D",
      ready: true,
      message: null,
      bridge: true,
      bridgeReason: null,
    };
    expect(rpcContract.thread_autotitle_services.output.parse({
      selected: null,
      services: [entry],
      threadModel: { available: true, reason: null },
    })).toEqual({ selected: null, services: [entry], threadModel: { available: true, reason: null } });
    expect(() =>
      rpcContract.thread_autotitle_services.output.parse({
        selected: null,
        // Missing bridge fields: the modal cannot classify without them.
        services: [{ ...entry, bridge: undefined, bridgeReason: undefined }],
        threadModel: { available: true, reason: null },
      }),
    ).toThrow(z.ZodError);
  });
});

describe("promptHistory paging", () => {
  it("requests a large limit so the thread's oldest rows survive page truncation", async () => {
    const { callRpc, lastPromptHistoryArgs } = await setup({});
    await callRpc("thread_autotitle", { threadId: "thr_x" });
    // bb pages prompt history newest-first; a default-sized page drops the
    // originating prompt on long threads (found live: the oldest visible
    // row was mid-thread). Ask big, sort oldest-first locally.
    expect(lastPromptHistoryArgs()).toMatchObject({ threadId: "thr_x", limit: "200" });
  });
});

describe("the probe titles from the thread's originating prompt", () => {
  // bb's prompt history misses spawn inputs entirely (composer turns only,
  // found live via `bb thread history`), so the originating prompt is read
  // from the source thread's timeline first; history is the fallback.
  it("reads the source thread's first user timeline row", async () => {
    const { callRpc, lastSpawn } = await setup({
      sourceTimeline: {
        rows: [
          { kind: "conversation", role: "user", sourceSeqStart: 30, text: "so why is it still refused?" },
          { kind: "conversation", role: "user", sourceSeqStart: 1, text: "When renaming a thread, I'd like an emoji button" },
        ],
      },
    });
    await callRpc("thread_autotitle", { threadId: "thr_x", useThreadModel: true });
    const prompt = (lastSpawn() as { prompt: string }).prompt;
    expect(prompt).toContain("emoji button");
    expect(prompt).not.toContain("still refused");
  });

  it("falls back to prompt history when the source timeline has no user text", async () => {
    const { callRpc, lastServiceCall } = await setup({ sourceTimeline: [] });
    await callRpc("thread_autotitle", { threadId: "thr_x" });
    expect((lastServiceCall()!.input as { prompt: string }).prompt).toContain(
      "login redirect loop",
    );
  });

  it("the selected-service path titles from the timeline too", async () => {
    const { callRpc, lastServiceCall } = await setup({
      sourceTimeline: {
        rows: [
          { kind: "conversation", role: "user", sourceSeqStart: 30, text: "a later follow-up" },
          { kind: "conversation", role: "user", sourceSeqStart: 1, text: "The original task text" },
        ],
      },
    });
    await callRpc("thread_autotitle", { threadId: "thr_x" });
    const prompt = (lastServiceCall()!.input as { prompt: string }).prompt;
    expect(prompt).toContain("original task text");
    expect(prompt).not.toContain("later follow-up");
  });
});
