// Standing security gates for release cuts and merges into dev (the
// 1.0.0 hardening pass, certification item 10). Runs the two checks the
// security audits performed by hand:
//   1. npm audit for the production tree and the dev tree (0 vulnerabilities).
//   2. Dangerous-sink greps over SHIPPED code, with the allowlists the
//      audits documented (the constant SVG sink, the loopback daemon
//      client). A new hit fails the script and must be either removed or
//      added to an allowlist with a comment naming the audit that approved it.
// Fail loud, exit non-zero. Wired as `npm run gates`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { seamForFetch } from "./security-seams.mjs";
import { notifyGateFailure } from "./release-notify.mjs";

let failed = false;
let violations = 0;
const report = (line) => console.log(line);
const violation = (line) => {
  failed = true;
  violations += 1;
  console.error(`GATE VIOLATION: ${line}`);
};

// ---- 1. npm audit, production and dev trees ----
//
// A named advisory may be excepted for a bounded time when all four hold:
// nothing that SHIPS is affected, upstream has published no patched version,
// the reach is a named toolchain path, and the exception carries an expiry so
// the gate fails again by itself. An exception is a recorded decision, not a
// silenced check: the gate names it on every run, and the moment the expiry
// passes the finding is a violation again. Nothing else may be excepted —
// an unlisted advisory, or a listed one past its date, fails the gate.
// VACATED 2026-11-20: GHSA-fc5q-39xc-vjpf (picomatch ReDoS through repeated
// extglobs) held the only entry here, until 2026-12-08, on the grounds that no
// patched version existed and nothing that ships imported it. GitHub WITHDREW
// that advisory on 2026-11-18 — "it is not a security issue", see
// https://github.com/micromatch/picomatch/pull/235#issuecomment-6315749381 —
// and `npm audit` now reports nothing across both trees, so the entry had
// stopped describing anything. The mechanism stays: a real advisory with no
// upgrade path belongs here, with an expiry and a note naming its reach.
const ADVISORY_EXCEPTIONS = [];

const exceptionsInForce = (today = new Date()) =>
  ADVISORY_EXCEPTIONS.filter((exception) => new Date(exception.until) >= today);

/** Every GHSA id the audit reported, from `npm audit --json`. */
function reportedAdvisoryIds() {
  let raw = "";
  try {
    raw = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    // A non-zero exit is the normal case when there is something to report;
    // the JSON body is still on stdout.
    raw = error.stdout ?? "";
  }
  const ids = new Set();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  for (const entry of Object.values(parsed.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const match = /GHSA-[0-9a-z-]+/i.exec(via.url ?? "");
      if (match !== null) ids.add(match[0]);
    }
  }
  return ids;
}

const exceptionsFor = (ids) => {
  const inForce = exceptionsInForce();
  const covered = [];
  const uncovered = [];
  for (const id of ids) {
    const exception = inForce.find((candidate) => candidate.id === id);
    if (exception === undefined) uncovered.push(id);
    else covered.push(exception);
  }
  return { covered, uncovered };
};

for (const args of [["--omit=dev"], []]) {
  const label = args.join(" ") || "(all trees)";
  try {
    execFileSync("npm", ["audit", "--audit-level=low", ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    report(`npm audit ${label}: clean`);
  } catch (error) {
    const stdout = error.stdout ?? "";
    const summary =
      stdout.split("\n").find((line) => /vulnerabilit/i.test(line)) ?? "";
    // The all-trees pass may be carried by a live exception; the production
    // pass never is, because a shipped advisory has no exception to stand on.
    const ids = args.length === 0 ? reportedAdvisoryIds() : null;
    const { covered, uncovered } = ids === null
      ? { covered: [], uncovered: [] }
      : exceptionsFor(ids);
    if (ids !== null && uncovered.length === 0 && covered.length > 0) {
      for (const exception of covered) {
        report(
          `npm audit ${label}: ${exception.id} excepted until ${exception.until} — ${exception.note}`,
        );
      }
      continue;
    }
    const names =
      ids === null ? "" : ` Uncovered advisories: ${uncovered.join(", ") || "(none named)"}.`;
    violation(`npm audit ${label} reported vulnerabilities. ${summary.trim()}${names}`);
  }
}

// ---- 2. Dangerous-sink greps over shipped code ----
function shippedFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      shippedFiles(path, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".generated.ts")) {
      acc.push(path);
    }
  }
  return acc;
}

const files = ["server.ts", "app.tsx", ...shippedFiles("lib"), ...shippedFiles("components")];
const sources = files.map((file) => ({ file, source: readFileSync(file, "utf8") }));

const findLines = (pattern) => {
  const hits = [];
  for (const { file, source } of sources) {
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      if (new RegExp(pattern).test(text)) hits.push(`${file}:${index + 1}: ${text.trim()}`);
    });
  }
  return hits;
};

// HTML/execution sinks: NONE are allowed in shipped code. The one historic
// hit (the constant SVG icon) is allowlisted by its exact assignment.
for (const pattern of [
  "dangerouslySetInnerHTML",
  "insertAdjacentHTML",
  "document\\.write",
  "\\beval\\(",
  "new Function",
]) {
  for (const hit of findLines(pattern)) violation(`${pattern} → ${hit}`);
}
const iconSink = findLines("\\.innerHTML\\s*=");
for (const hit of iconSink) {
  // Only constant-SVG sinks are allowed: the assignment's right side must
  // be exactly one ALL-CAPS *_ICON constant (no concatenation, no
  // interpolation, no call), and each such constant is approved in a
  // security review note. The historic one is EXTERNAL_LINK_ICON in
  // decorate-inline-code.ts (docs/security-audit-2026-09-28.md);
  // THREAD_ICON and PROJECT_ICON in decorate-reference-mentions.ts are the
  // same shape (docs/ai-code-reviews/code-review-2026-10-14T2315.md).
  const assignment = hit.replace(/^[^:]*:\d+:\s*/, "");
  if (/^[A-Za-z0-9_.$]+\.innerHTML\s*=\s*[A-Z][A-Z0-9_]*_ICON\s*;$/u.test(assignment)) {
    report(`innerHTML sink allowlisted (constant SVG): ${hit}`);
  } else {
    violation(`unexpected innerHTML sink (only the audit-approved constant SVG is allowed) → ${hit}`);
  }
}

// Process execution: none in the plugin runtime (dev-only scripts excluded
// from the scan set by construction).
for (const hit of findLines("child_process")) {
  violation(`child_process in shipped code → ${hit}`);
}
for (const hit of findLines("shell:\\s*true")) {
  violation(`shell:true in shipped code → ${hit}`);
}

// Navigation sinks: every window.open must carry noopener in its statement
// (which may span lines — the check scans forward through the call).
const openLines = findLines("window\\.open\\(");
if (openLines.length === 0) {
  violation("no window.open sites found — the scan may be broken");
}
for (const hit of openLines) {
  const [file, lineText] = hit.split(":");
  const start = Number(lineText) - 1;
  const statement = (sources.find(({ file: f }) => f === file) ?? { source: "" })
    .source.split("\n")
    .slice(start, start + 6)
    .join("\n");
  if (!/noopener/.test(statement)) violation(`window.open without noopener → ${hit}`);
  else report(`window.open with noopener: ${file}:${lineText}`);
}

// Network: fetch( is allowed ONLY in the audit-approved seams below —
// never as a general fetch() allowance. The seam table lives ONCE, in
// scripts/security-seams.mjs (APPROVED_FETCH_SEAMS + seamForFetch);
// it is the single source of truth consumed here AND by the suite-level
// backstop tests/security-fetch-seams.test.ts, so the gate and the suite
// can never drift apart on a rename, a deletion, or a re-landed fetch
// (which happened twice on 2026-10-10 — see
// docs/incidents/2026-10-10-red-security-gate-on-dev.md).
//
// The seam pattern an entry must satisfy: the request url comes from a
// FIXED host constant (no operator-controlled base or path; the Openverse
// client additionally refuses any non-pinned origin at call time), untrusted
// input reaches the request only through safe encoding into bounded
// params, redirects are followed nowhere, the request is timeout-bounded,
// and the response body is read only through a schema-filtered parser.
// A new seam must be added to the table WITH a comment naming the audit
// that approved it; a seam's `text` pin (exact allowed forwarding line)
// is used when the file may legitimately contain other fetch-shaped text.
for (const hit of findLines("\\bfetch\\(")) {
  const [file, lineNo, ...rest] = hit.split(":");
  const lineText = rest.join(":").trim();
  if (seamForFetch(file ?? "", lineText) === null) {
    violation(`fetch( outside the audit-approved loopback daemon client → ${hit}`);
  } else {
    report(`fetch( allowlisted (audited seam): ${file}:${lineNo}`);
  }
}

report(
  failed
    ? "security gates FAILED"
    : `security gates passed: audit clean (both trees)${
        exceptionsInForce().length === 0
          ? ""
          : ` with ${exceptionsInForce().length} dated advisory exception(s): ${exceptionsInForce()
              .map((exception) => `${exception.id} until ${exception.until}`)
              .join(", ")}`
      }, sink scan over ${files.length} shipped files with the documented allowlists`,
);
if (failed) {
  // The release notification contract (release.md §2b): name the failed gate
  // on the operator's channel. Best effort by design; never changes the exit
  // code below.
  await notifyGateFailure({ gate: "gates", detail: `${violations} gate violation(s)` });
}
process.exit(failed ? 1 : 0);
