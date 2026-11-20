// The split's ratio belongs to bb, and this suite is the canary for the day
// that stops being true.
//
// The ask (2026-11-20): a card click that puts a thread in bb's own pane
// beside the board should split the window 2:1, board wide, thread narrow,
// instead of the halves every fresh split starts with. Measured on the
// installed host (bb 0.50.1, scripts/screenshot/probe-split-ratio.mjs, record
// in docs/screenshots/probe-split-ratio/evidence.json):
//
//   - the insert is HALVES by construction, not by any inherited preference:
//     the host's own add-pane writes `sizes: [0.5, 0.5]` for a new split of a
//     single pane, and an even spread when a pane joins an existing split;
//   - an operator's drag writes real fractions (0.6665 / 0.3335 at the 2:1
//     target) and survives a reload while both panes stay open;
//   - closing the thread pane collapses the layout back to one pane, and the
//     next card click splits at halves again, so one drag does not become the
//     default for the next split.
//
// Nothing in the plugin's reach asks for a ratio: `open(threadId, { split })`
// is placement only in this SDK (0.6.19) and still placement only in 0.6.150
// and 0.6.169, `useSidebarSplitLayout()` reports rects read-only, the CLI's
// `thread open --split` takes right/down/left/top/replace with no size, and
// `bb settings ui`/`keyboard` carry no pane-size or resize preference or
// command. So the board asks for the pane and the host picks the width.
//
// This suite reads the installed typings because the property IS the host's
// API shape, and it fails the moment a release grows a size lever. When it
// does: pass the ratio at app.tsx's one-pane ask (`openThreadForInteraction`),
// re-measure with the probe, and update the comment there and this file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_DIR = join(ROOT, "node_modules", "@get-bb", "plugin-sdk");

/** The SDK's app-surface typings: the package's own types entry when it
 *  declares one, else the bundled declarations the package ships. */
function appTypingsPath(): string {
  const pkg = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8")) as {
    types?: string;
    exports?: Record<string, string | { types?: string }>;
  };
  const candidates: string[] = [];
  const entry = pkg.exports?.["./app"] ?? pkg.exports?.["./app/index"];
  if (typeof entry === "string") candidates.push(entry);
  else if (entry?.types !== undefined) candidates.push(entry.types);
  for (const name of ["bundled-types/bb-plugin-sdk-app.d.ts", "dist/bb-plugin-sdk-app.d.ts"]) {
    candidates.push(name);
  }
  for (const name of candidates) {
    const path = join(SDK_DIR, name);
    if (existsSync(path)) return path;
  }
  throw new Error(
    `No app typings under ${SDK_DIR}. This suite needs the installed SDK's declarations; ` +
      `run npm ci, then check where @get-bb/plugin-sdk ships bb-plugin-sdk-app.d.ts.`,
  );
}

const TYPINGS = readFileSync(appTypingsPath(), "utf8");

/** One interface's body, by brace matching from its declaration. */
function interfaceBody(source: string, name: string): string {
  const marker = `interface ${name} {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`interface not found in the SDK typings: ${name}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + marker.length, i);
    }
  }
  throw new Error(`unbalanced interface body: ${name}`);
}

/** The board's split requests, comments excluded. */
const app = readFileSync(join(ROOT, "app.tsx"), "utf8");
const handler = app.slice(
  app.indexOf("const openThreadForInteraction = useCallback("),
  app.indexOf("// The one-pane request's two continuations"),
);
const splitRequests = handler
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
  .filter((line) => line.includes("actions.open("));

describe("the host's split-ratio surface", () => {
  it("takes placement only on the sidebar opener", () => {
    const actions = interfaceBody(TYPINGS, "PluginSidebarThreadActions");
    const start = actions.indexOf("open(");
    const end = actions.indexOf("): void;", start);
    const signature = actions
      .slice(start, end === -1 ? undefined : end + "): void;".length)
      .replace(/\s+/g, " ")
      .trim();
    expect(
      signature,
      "bb's open() grew or changed its options. If it now takes a size or a " +
        "ratio, the one-pane ask in app.tsx should pass it; if it only moved, " +
        "update this pin.",
    ).toBe("open(threadId: string, options?: { split?: boolean; }): void;");
  });

  it("offers no size vocabulary on the split objects the board can reach", () => {
    const reachable = [
      interfaceBody(TYPINGS, "PluginSidebarThreadActions"),
      interfaceBody(TYPINGS, "PluginSidebarThreadSplit"),
      interfaceBody(TYPINGS, "PluginSidebarSplitLayout"),
    ].join("\n");
    expect(
      reachable,
      "a size/ratio lever appeared on a split type the board can reach. Use it at " +
        "app.tsx's one-pane ask, then re-measure with scripts/screenshot/probe-split-ratio.mjs.",
    ).not.toMatch(/\b(ratio|setRatio|sizes|setSizes|proportion|fraction|fractionOf)\b/);
  });

  it("writes nothing that would resize a pane", () => {
    expect(
      TYPINGS,
      "the SDK now names a split write (a setter, a resize, a size prop). Find the " +
        "lever, wire it into the one-pane ask, and record the measurement.",
    ).not.toMatch(/\b(setSidebarSplit\w*|setSplitSizes|splitRatio|sidebarSplitSizes|resizePane)\b/);
  });

  it("asks the opener for the pane, never for its width", () => {
    expect(splitRequests.length).toBeGreaterThan(0);
    for (const line of splitRequests) {
      expect(line, "a split request grew a second argument; the host takes none.").toMatch(
        /^actions\.open\(\s*[\w.\[\]"']+\s*,\s*\{ split: true \}\s*\);$/,
      );
    }
  });
});
