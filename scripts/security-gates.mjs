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

let failed = false;
const report = (line) => console.log(line);
const violation = (line) => {
  failed = true;
  console.error(`GATE VIOLATION: ${line}`);
};

// ---- 1. npm audit, production and dev trees ----
for (const args of [["--omit=dev"], []]) {
  try {
    const output = execFileSync("npm", ["audit", "--audit-level=low", ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    report(`npm audit ${args.join(" ") || "(all trees)"}: clean`);
  } catch (error) {
    const stdout = error.stdout ?? "";
    const summary =
      stdout.split("\n").find((line) => /vulnerabilit/i.test(line)) ?? "";
    violation(
      `npm audit ${args.join(" ") || "(all trees)"} reported vulnerabilities. ${summary.trim()}`,
    );
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
  if (!hit.includes("EXTERNAL_LINK_ICON")) {
    violation(`unexpected innerHTML sink (only the audit-approved constant SVG is allowed) → ${hit}`);
  } else {
    report(`innerHTML sink allowlisted (constant SVG): ${hit}`);
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

// Network: fetch( is allowed ONLY in the loopback daemon client.
for (const hit of findLines("\\bfetch\\(")) {
  if (!hit.startsWith("lib/workspace-open.ts:")) {
    violation(`fetch( outside the audit-approved loopback daemon client → ${hit}`);
  } else {
    report(`fetch( in the loopback daemon client: ${hit.split(":").slice(0, 2).join(":")}`);
  }
}

report(
  failed
    ? "security gates FAILED"
    : `security gates passed: audit clean (both trees), sink scan over ${files.length} shipped files with the documented allowlists`,
);
process.exit(failed ? 1 : 0);
