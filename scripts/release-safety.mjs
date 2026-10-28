/**
 * The release-safety gate runner: the four stages of `npm run
 * release-safety` — the node_modules guard, the build, the UAT sweep, and the
 * release screenshots — with the release notification contract wired in
 * (`.agents/agents-md-detail/release.md` section 2b).
 *
 * The runner exists so a failure names its gate. The old package.json chain
 * (`a && b && c && d`) exits with the first failing stage's code but leaves no
 * hook to say which stage it was; here each stage runs on its own and the
 * first non-zero exit publishes one notification naming that stage before the
 * runner exits with the stage's own code.
 *
 * The stages it spawns carry the delegation marker (release-notify.mjs's
 * DELEGATE_ENV), so a nested gate keeps quiet and the run sends exactly one
 * message.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DELEGATE_ENV, notifyGateFailure } from "./release-notify.mjs";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export const RELEASE_SAFETY_STAGES = [
  { name: "check-node-modules", command: process.execPath, args: ["scripts/check-node-modules.mjs"] },
  { name: "build", command: NPM, args: ["run", "build"] },
  { name: "uat", command: NPM, args: ["run", "uat"] },
  { name: "release-shots", command: NPM, args: ["run", "release-shots"] },
];

function spawnStage(stage) {
  const result = spawnSync(stage.command, stage.args, {
    stdio: "inherit",
    env: { ...process.env, [DELEGATE_ENV]: "1" },
  });
  // A spawn-level failure (command missing, signal kill) has a null status;
  // treat anything that is not a clean 0 as a failure.
  return { status: result.status === 0 ? 0 : (result.status ?? 1) };
}

/**
 * Run the stages in order and return the exit code for the whole gate.
 *
 * The notification is best effort by construction: `notify` is awaited inside
 * a try/catch, so a throwing or hanging implementation can never change the
 * code this returns. The code is always a failing stage's own, or 0 on a
 * clean pass.
 */
export async function runReleaseSafety({
  stages = RELEASE_SAFETY_STAGES,
  run = spawnStage,
  notify = notifyGateFailure,
  log = console.log,
  warn = console.warn,
} = {}) {
  for (const stage of stages) {
    log(`\n==> release-safety: ${stage.name}`);
    const { status } = run(stage);
    if (status !== 0) {
      try {
        await notify({
          gate: `release-safety:${stage.name}`,
          detail: `stage exited with code ${status}`,
        });
      } catch (error) {
        warn(`[WARN] release notification failed: ${error?.message ?? error}`);
      }
      return status === 0 ? 1 : status;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(await runReleaseSafety());
}
