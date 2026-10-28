/**
 * Release-gate failure notifications: the implementation of the release
 * notification contract in `.agents/agents-md-detail/release.md` section 2b.
 * A failed release gate (the `release-safety` chain, `npm run gates`, the UAT
 * runner, the release screenshots) publishes one message that names the gate
 * to the operator's ntfy topic, following the channel contract in
 * `~/.agents/agents-md-detail/ntfy.md`: POST the JSON body to the ntfy BASE
 * URL with `topic` inside the body, never to the topic URL.
 *
 * Channel: `NTFY_TOPIC` (required), `NTFY_TOKEN` and `NTFY_SERVER`
 * (optional), read from the process environment or a gitignored env file
 * (default `~/.config/focus-board/ntfy.env`; override with `NTFY_ENV_FILE`).
 *
 * Failure semantics (the contract's, not this module's invention):
 * - No `NTFY_TOPIC` is the offline-first default and the CI-without-secrets
 *   case, so it is a silent no-op, never an error.
 * - A transport failure is caught and logged as `[WARN]`; it can neither
 *   turn a passing run red nor replace a failing gate's own exit code.
 * - `notifyGateFailure` never throws for any reason.
 */
import { readFileSync as fsReadFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SERVER = "https://ntfy.sh";
export const CONFIG_ENV = "NTFY_ENV_FILE";
// Set by the release-safety runner on the gates it spawns so a nested gate
// stays quiet and the run sends exactly one message, from the runner.
export const DELEGATE_ENV = "FOCUS_BOARD_NOTIFY_DELEGATED";

/** The gitignored env file a checkout reads when the environment is bare. */
export function defaultConfigPath(env = process.env) {
  return env[CONFIG_ENV] ?? join(homedir(), ".config", "focus-board", "ntfy.env");
}

/**
 * Parse a `KEY=value` env file. Comments and blank lines are skipped, and a
 * value may be wrapped in matching single or double quotes. A line without a
 * `KEY=` shape is ignored rather than guessed at.
 */
export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function readConfigText(configPath, readFileSync) {
  try {
    return readFileSync(configPath, "utf8");
  } catch (error) {
    // An absent config file is the offline-first default, not an error.
    // Any other read failure is real and surfaces to the caller.
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Resolve the ntfy channel config. Values already in the environment win over
 * the env file, so an operator can override one field without editing the
 * file. Returns `topic` undefined when nothing is configured.
 */
export function loadNtfyConfig({
  env = process.env,
  configPath = defaultConfigPath(env),
  readFileSync = fsReadFileSync,
} = {}) {
  const text = readConfigText(configPath, readFileSync);
  const fileValues = text === null ? {} : parseEnvFile(text);
  const pick = (key) => {
    const fromEnv = env[key];
    if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
    const fromFile = fileValues[key];
    if (typeof fromFile === "string" && fromFile.trim() !== "") return fromFile.trim();
    return undefined;
  };
  return {
    topic: pick("NTFY_TOPIC"),
    server: (pick("NTFY_SERVER") ?? DEFAULT_SERVER).replace(/\/+$/, ""),
    token: pick("NTFY_TOKEN"),
  };
}

/**
 * Build the notification descriptor for a failed gate. Returns null when no
 * topic is configured — there is nothing to name a channel for, and the
 * caller treats that as the silent no-op.
 *
 * The title and the message both name the gate, so the message is readable on
 * a phone lock screen whether or not the client shows a title.
 */
export function buildGatePayload({ gate, detail, topic, verdict = "failed", server, token } = {}) {
  if (typeof topic !== "string" || topic.trim() === "") return null;
  const named = typeof gate === "string" && gate.trim() !== "" ? gate.trim() : "release gate";
  const said = typeof detail === "string" ? detail.trim() : "";
  return {
    topic: topic.trim(),
    server: typeof server === "string" && server.trim() !== "" ? server.trim() : DEFAULT_SERVER,
    token: typeof token === "string" && token.trim() !== "" ? token.trim() : undefined,
    title: `Focus Board gate ${verdict}: ${named}`,
    message: `${named} gate ${verdict}${said === "" ? "" : `: ${said}`}`,
    tags: ["rotating_light"],
    priority: 5,
  };
}

/**
 * Publish one notification. Never throws: a transport failure becomes a
 * logged `[WARN]` and a `{ sent: false }` result, so a call site can ignore
 * it without endangering its own exit code.
 */
export async function publishNotification(
  payload,
  { fetchImpl = fetch, log = console.warn, timeoutMs = 10_000 } = {},
) {
  if (payload === null || payload === undefined) {
    return { sent: false, reason: "no topic configured" };
  }
  const headers = { "content-type": "application/json" };
  if (payload.token !== undefined) headers.authorization = `Bearer ${payload.token}`;
  try {
    const response = await fetchImpl(`${payload.server ?? DEFAULT_SERVER}/`, {
      method: "POST",
      headers,
      // The body carries `topic`: this is the base-URL JSON form the ntfy
      // channel contract requires (ntfy.md) so clients render fields, not raw
      // JSON.
      body: JSON.stringify({
        topic: payload.topic,
        title: payload.title,
        message: payload.message,
        tags: payload.tags,
        priority: payload.priority,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response !== undefined && response !== null && response.ok === false) {
      log(`[WARN] release notification rejected by ${payload.server} (HTTP ${response.status})`);
      return { sent: false, reason: `HTTP ${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    log(`[WARN] release notification failed: ${error?.message ?? error}`);
    return { sent: false, reason: error?.message ?? String(error) };
  }
}

/**
 * Notify that a named gate failed. The one entry point every gate calls.
 *
 * Order of the two early exits matters: a delegated call is a nested gate
 * inside a runner that owns the notification, and an unset topic is the
 * offline-first no-op. Both return without publishing and without output.
 */
export async function notifyGateFailure({
  gate,
  detail,
  verdict = "failed",
  env = process.env,
  configPath,
  readFileSync = fsReadFileSync,
  fetchImpl = fetch,
  log = console.warn,
} = {}) {
  if (env[DELEGATE_ENV] === "1") {
    return { sent: false, reason: `delegated to the parent runner (${DELEGATE_ENV})` };
  }
  let config;
  try {
    config = loadNtfyConfig({ env, configPath, readFileSync });
  } catch (error) {
    // A config file that exists but cannot be read is worth a warning, and
    // still must not fail the gate.
    log(`[WARN] release notification config unreadable: ${error?.message ?? error}`);
    return { sent: false, reason: error?.message ?? String(error) };
  }
  if (config.topic === undefined) {
    return { sent: false, reason: "NTFY_TOPIC is unset; skipping the release notification" };
  }
  const payload = buildGatePayload({
    gate,
    detail,
    verdict,
    topic: config.topic,
    server: config.server,
    token: config.token,
  });
  return publishNotification(payload, { fetchImpl, log });
}
