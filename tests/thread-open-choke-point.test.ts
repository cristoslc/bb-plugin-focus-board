// The choke point: ONE routing entry opens a thread for interaction, and the
// in-panel primitive has only audited callers (reported 2026-11-20).
//
// The bug this pins: the board grew a second way to open a thread — the New
// Thread modal's spawn called the in-panel primitive directly — so a created
// thread ignored the operator's "where should threads open" answer. The fix
// funnels every gesture through app.tsx `openThreadForInteraction`; the tests
// in tests/app-spawn-open-target.test.tsx prove the behavior for the two
// spawn paths, and this suite proves the structure: no other code reaches the
// primitive, no other prop wiring opens a thread, and the paths that
// deliberately bypass the handler are the audited ones.
//
// It reads the source because the property IS the call graph, and a runtime
// test can only sample the gestures it knows about. A future path that opens
// a thread on its own fails here with the rule named, which is the review
// question: does that path belong in the handler, or does the audit table in
// the pull request (and docs/test-coverage-matrix.md) need a new row?
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = join(ROOT, "app.tsx");
const app = readFileSync(APP_PATH, "utf8");

/** The source between two markers, or a loud failure when a marker moved. */
function span(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

/** Every line that mentions `needle`, ignoring comment lines. */
function codeLinesMentioning(source: string, needle: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .filter((line) => line.includes(needle));
}

const handler = span(
  app,
  "const openThreadForInteraction = useCallback(",
  "// The one-pane request's two continuations",
);
const beforeHandler = app.slice(0, app.indexOf("const openThreadForInteraction = useCallback("));
const afterHandler = app.slice(app.indexOf("// The one-pane request's two continuations"));

/**
 * The audits' deliberate exceptions, each with the reason it stays: the three
 * continuations of a request the handler already made, the reference chip that
 * names a thread the board does not list, and the pane's own maximize.
 */
describe("the routing entry owns the in-panel primitive", () => {
  it("is the only place a thread request is planned", () => {
    // The handler really is the decision point: the preference read, the host
    // fallbacks, and the pane-ownership rule all live inside it.
    expect(handler).toContain("openTargetRef.current === \"panel\"");
    expect(handler).toContain("nativeOpenWouldEvictBoard(layout)");
    // Ownership is the pane id, and the board's own pane is refused: the click
    // resolves the record against the live layout AND the pane the board sits
    // in (operator ruling dec_okjt7e62rg2x, lib/native-pane-ownership.ts).
    expect(handler).toContain("resolveBoardNativePane(");
    expect(handler).toContain("boardNativePaneRef.current,");
    expect(handler).toContain("boardPaneId(panelRef.current),");
    expect(handler).toContain("pendingStateClaimsRef.current.set(threadId");
    expect(handler).toContain("capturePaneAttention(threadId)");
  });

  it("is the only caller of the in-panel primitive", () => {
    // The definition exists once, and nothing before the handler calls it.
    expect(app.split("const openThreadCard = useCallback(").length - 1).toBe(1);
    expect(codeLinesMentioning(beforeHandler, "openThreadCard(")).toEqual([]);
    // The two in-panel continuations are the handler's fallback half: the host
    // has already answered, so re-planning would ask it again. The one-pane
    // dance's (a window that will not split) and the fresh pane ask's
    // (lib/native-fresh-pane.ts: the host gave the asked thread no pane, so the
    // board's own is the one surface left).
    expect(codeLinesMentioning(afterHandler, "openThreadCard(")).toEqual([
      "onePaneDanceHost.openBoardPane = (threadId) => openThreadCard(threadId);",
      "openThreadCard(ask.threadId);",
    ]);
    // Inside the handler: every in-panel outcome is a call on the primitive.
    expect(codeLinesMentioning(handler, "openThreadCard(threadId)").length).toBeGreaterThan(0);
    // And the old name is gone, so nothing kept a second door under it.
    expect(app).not.toContain("openThreadCardNative");
  });

  it("is the callback every thread-opening prop is wired to", () => {
    const wirings = [...app.matchAll(/onOpenThread=\{(\w+)\}/g)].map((match) => match[1]);
    expect(wirings.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(wirings)]).toEqual(["openThreadForInteraction"]);
  });

  it("is the callback the board's own spawn path uses", () => {
    const spawnPath = span(
      app,
      "const handleSpawnedThread = useCallback(",
      "// The group tag every successful composer spawn carries",
    );
    expect(spawnPath).toContain("openThreadForInteraction(thread.id)");
    expect(spawnPath).not.toContain("openThreadCard(");
    expect(spawnPath).not.toContain("navigate.toThread(");
  });

  it("is the callback the pane's reference chips use for a listed thread", () => {
    expect(app).toContain("if (listed) openThreadForInteraction(reference.id);");
  });
});

/**
 * The paths that open a thread WITHOUT the handler, and why. Every entry is a
 * row of the audit table in the pull request: a new one is a decision to make
 * out loud, not a quiet second door.
 */
const DIRECT_OPEN_EXCEPTIONS: Record<string, string> = {
  "app.tsx":
    "the handler's own replacement landing (navigate.toThread), an unlisted reference chip (the board has no card or pane for it), and the pane's maximize",
  "components/thread-header-actions.tsx":
    "bb's own thread-page header: the control is mounted by the host outside the board panel, and a child spawned there replaces the page the operator is reading",
  "lib/browser-reveal.ts":
    "focusing a browser-hosted thread so its tab can be revealed: the host checks focus, so the navigation is the gesture's precondition, not a surface choice",
};

describe("the paths that bypass the routing entry", () => {
  it("are the audited ones, each named with its reason", () => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        const source = readFileSync(path, "utf8");
        if (/\.toThread\(/.test(source) || /actions\.open\(/.test(source)) {
          found.push(relative(ROOT, path));
        }
      }
    };
    for (const directory of ["components", "lib", "hooks"]) walk(join(ROOT, directory));
    found.push("app.tsx");

    const audited = found.filter((path) => DIRECT_OPEN_EXCEPTIONS[path] !== undefined);
    expect(
      found.sort(),
      `A file opened a thread without the board's routing entry and is not in the audit table.\n` +
        `Route it through app.tsx's openThreadForInteraction, or add it to DIRECT_OPEN_EXCEPTIONS ` +
        `(this test) and to the audit table in the pull request with the reason it stays.\n` +
        `Unaudited: ${found.filter((path) => DIRECT_OPEN_EXCEPTIONS[path] === undefined).join(", ")}`,
    ).toEqual(audited.sort());
  });

  it("app.tsx's own host navigations are the three audited ones", () => {
    // Line-shaped on purpose: the audit table in the pull request names these
    // three, and a fourth means a path opened a thread on its own. A reformat
    // that re-wraps one of them is a change to this list, not a behavior change.
    expect(codeLinesMentioning(app, "navigate.toThread(")).toEqual([
      "navigate.toThread(nativeReplace.threadId);",
      "else navigate.toThread(reference.id);",
      "onMaximize={() => navigate.toThread(openThread.id)}",
    ]);
  });
});
