/**
 * The release notification contract (issue #294): a failed release gate must
 * publish one message naming the gate, and the publish must never fail the
 * gate or replace its exit code.
 *
 * These tests pin the four guarantees the contract makes:
 *   - the payload names the gate (title and message);
 *   - an unset `NTFY_TOPIC` is a silent no-op that never calls the transport;
 *   - a transport failure is logged and swallowed, never thrown;
 *   - a delegated (nested) gate stays quiet so a run sends exactly one message.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildGatePayload,
  DELEGATE_ENV,
  loadNtfyConfig,
  notifyGateFailure,
  parseEnvFile,
  publishNotification,
} from "../scripts/release-notify.mjs";

/** A reader for `loadNtfyConfig` that serves one in-memory file. */
function fileReader(text: string | null) {
  return (_path: string): string => {
    if (text === null) {
      const error = new Error("no such file") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return text;
  };
}

describe("parseEnvFile", () => {
  it("parses KEY=value lines, skips comments and blank lines, and unquotes", () => {
    const values = parseEnvFile(
      [
        "# comment",
        "",
        "NTFY_TOPIC=blueroost-focus-board",
        'NTFY_SERVER="https://ntfy.example"',
        "NTFY_TOKEN='tok_123'",
        "not a key value line",
      ].join("\n"),
    );
    expect(values).toEqual({
      NTFY_TOPIC: "blueroost-focus-board",
      NTFY_SERVER: "https://ntfy.example",
      NTFY_TOKEN: "tok_123",
    });
  });
});

describe("loadNtfyConfig", () => {
  it("reads topic/server/token from the env file when the environment is bare", () => {
    const config = loadNtfyConfig({
      env: {},
      configPath: "/tmp/ntfy.env",
      readFileSync: fileReader("NTFY_TOPIC=topic-a\nNTFY_TOKEN=tok\n"),
    });
    expect(config.topic).toBe("topic-a");
    expect(config.token).toBe("tok");
    expect(config.server).toBe("https://ntfy.sh");
  });

  it("lets an environment value override the file and strips a trailing slash from the server", () => {
    const config = loadNtfyConfig({
      env: { NTFY_TOPIC: "from-env", NTFY_SERVER: "https://ntfy.example/" },
      configPath: "/tmp/ntfy.env",
      readFileSync: fileReader("NTFY_TOPIC=from-file\n"),
    });
    expect(config.topic).toBe("from-env");
    expect(config.server).toBe("https://ntfy.example");
  });

  it("returns an undefined topic for an absent config file", () => {
    const config = loadNtfyConfig({
      env: {},
      configPath: "/tmp/missing.env",
      readFileSync: fileReader(null),
    });
    expect(config.topic).toBeUndefined();
  });
});

describe("buildGatePayload", () => {
  it("names the gate in both the title and the message", () => {
    const payload = buildGatePayload({
      gate: "release-safety:uat",
      detail: "3 step(s) failed",
      topic: "blueroost-focus-board",
    });
    expect(payload).not.toBeNull();
    expect(payload?.topic).toBe("blueroost-focus-board");
    expect(payload?.title).toContain("release-safety:uat");
    expect(payload?.message).toContain("release-safety:uat");
    expect(payload?.message).toContain("failed");
    expect(payload?.message).toContain("3 step(s) failed");
  });

  it("returns null with no topic, so there is nothing to send", () => {
    expect(buildGatePayload({ gate: "uat", topic: undefined })).toBeNull();
    expect(buildGatePayload({ gate: "uat", topic: "" })).toBeNull();
  });

  it("defaults to the ntfy base URL and omits the token when none is set", () => {
    const payload = buildGatePayload({ gate: "gates", topic: "t" });
    expect(payload?.server).toBe("https://ntfy.sh");
    expect(payload?.token).toBeUndefined();
  });
});

describe("publishNotification", () => {
  it("POSTs the JSON body (with the topic inside it) to the base URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200 } as Response;
    });
    const payload = buildGatePayload({ gate: "uat", detail: "1 failed", topic: "t" });
    const result = await publishNotification(payload, { fetchImpl });

    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ntfy.sh/");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.topic).toBe("t");
    expect(body.message).toContain("uat");
    // The contract's trap: the topic travels in the BODY, never in the URL.
    expect(calls[0].url).not.toContain("t/");
  });

  it("carries a bearer token when one is configured", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, status: 200 } as Response;
    };
    const payload = buildGatePayload({ gate: "uat", topic: "t", token: "tok" });
    await publishNotification(payload, { fetchImpl });
    expect(headers.authorization).toBe("Bearer tok");
  });

  it("logs and swallows a rejected transport instead of throwing", async () => {
    const log = vi.fn();
    const result = await publishNotification(
      buildGatePayload({ gate: "uat", topic: "t" }),
      {
        log,
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    );
    expect(result.sent).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[WARN]"));
  });

  it("logs a non-2xx answer as unsent", async () => {
    const log = vi.fn();
    const result = await publishNotification(
      buildGatePayload({ gate: "uat", topic: "t" }),
      {
        log,
        fetchImpl: async () => ({ ok: false, status: 413 } as Response),
      },
    );
    expect(result.sent).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("413"));
  });
});

describe("notifyGateFailure", () => {
  it("is a silent no-op with no NTFY_TOPIC: no fetch, no output", async () => {
    const fetchImpl = vi.fn();
    const log = vi.fn();
    const result = await notifyGateFailure({
      gate: "uat",
      env: {},
      configPath: "/tmp/missing.env",
      readFileSync: fileReader(null),
      fetchImpl,
      log,
    });
    expect(result.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("publishes a payload naming the gate when a topic is configured", async () => {
    let body: { message?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200 } as Response;
    });
    const result = await notifyGateFailure({
      gate: "release-safety:build",
      detail: "stage exited with code 2",
      env: { NTFY_TOPIC: "blueroost-focus-board" },
      fetchImpl,
    });
    expect(result.sent).toBe(true);
    expect(body.message).toContain("release-safety:build");
  });

  it("stays quiet when delegated to a parent runner", async () => {
    const fetchImpl = vi.fn();
    const result = await notifyGateFailure({
      gate: "uat",
      env: { NTFY_TOPIC: "t", [DELEGATE_ENV]: "1" },
      fetchImpl,
    });
    expect(result.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never rejects even when the transport throws", async () => {
    await expect(
      notifyGateFailure({
        gate: "uat",
        env: { NTFY_TOPIC: "t" },
        fetchImpl: async () => {
          throw new Error("boom");
        },
        log: vi.fn(),
      }),
    ).resolves.toMatchObject({ sent: false });
  });
});
