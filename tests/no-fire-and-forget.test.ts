// The no-fire-and-forget gate for the plugin's SERVER process.
//
// The 2026-10-05 security re-audit found the class this test kills: a
// `void someAsync()` inside the bb server process turns any rejection into
// an unhandled rejection in the host (crash-class). The gate enforces, for
// every `void <callee>(...)` site in server.ts and lib/, one of:
//   (a) the statement carries its own `.catch(...)` — the call site owns
//       the failure; or
//   (b) the callee's declaration try-wraps its work BEFORE its first await,
//       so no rejection can escape it (fireWake is the model).
//
// Scope: the server process only. The board frontend (app.tsx, components/)
// uses the `void` idiom inside React event handlers, where rejection
// handling belongs to the SDK's panel error surface, not to this gate.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listFiles(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      listFiles(path, exts, acc);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      if (entry.name.endsWith(".generated.ts")) continue; // build output
      acc.push(path);
    }
  }
  return acc;
}

const files = ["server.ts", ...listFiles("lib", [".ts"])];
const sources = files.map((file) => ({ file, source: readFileSync(file, "utf8") }));
const everything = sources.map(({ source }) => source).join("\n");

type Site = { file: string; line: number; callee: string; statement: string };

const voidSites: Site[] = [];
for (const { file, source } of sources) {
  const lines = source.split("\n");
  const regex = /\bvoid\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    const text = lines[line - 1] ?? "";
    const trimmed = text.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (/void\s+0\b/.test(match[0])) continue;
    const statement = source.slice(match.index, source.indexOf(";", match.index) + 1);
    voidSites.push({ file, line, callee: match[1]!, statement });
  }
}

/** Where a callee is declared, or null. */
function declarationOf(callee: string): { source: string; start: number } | null {
  const patterns = [
    `function ${callee}(`,
    `async function ${callee}(`,
    `const ${callee} =`,
  ];
  for (const pattern of patterns) {
    const at = everything.indexOf(pattern);
    if (at !== -1) return { source: everything, start: at };
  }
  return null;
}

/** The callee's body slice: from its declaration to the next top-level close. */
function bodySlice(callee: string): string | null {
  const found = declarationOf(callee);
  if (found === null) return null;
  const rest = found.source.slice(found.start);
  // A declaration ends at the next line starting with "}" at column zero
  // (this codebase's formatting), or the next top-level declaration.
  const candidates = [
    rest.indexOf("\n}", found.start === 0 ? 0 : 1),
    rest.indexOf("\nfunction ", 1),
    rest.indexOf("\nconst ", 1),
  ].filter((at) => at !== -1);
  const end = candidates.length === 0 ? rest.length : Math.min(...candidates);
  return rest.slice(0, end);
}

function calleeCatchesBeforeFirstAwait(callee: string): boolean {
  const body = bodySlice(callee);
  if (body === null) return false;
  const firstAwait = body.indexOf("await ");
  const firstTry = body.indexOf("try {");
  if (firstTry === -1) return false;
  return firstAwait === -1 || firstTry < firstAwait;
}

describe("no-fire-and-forget gate (server process)", () => {
  it("scanned the expected server files", () => {
    expect(files).toContain("server.ts");
    expect(files.some((file) => file.startsWith("lib/"))).toBe(true);
  });

  it("every void call site is catch-attached or its callee try-wraps before its first await", () => {
    const failures: string[] = [];
    for (const site of voidSites) {
      const catchAttached = /\.catch\s*\(/.test(site.statement);
      const calleeSafe = catchAttached || calleeCatchesBeforeFirstAwait(site.callee);
      if (!calleeSafe) {
        failures.push(
          `${site.file}:${site.line} — void ${site.callee}(...) is neither catch-attached nor a callee that try-wraps before its first await`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("the gate actually sees the known sites (never passes vacuously)", () => {
    const callees = new Set(voidSites.map((site) => site.callee));
    expect(callees.has("fireWake")).toBe(true);
    expect(callees.has("armAllSnoozes")).toBe(true);
  });
});
