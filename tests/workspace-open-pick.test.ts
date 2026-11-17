// @vitest-environment jsdom
// Choosing the app a directory link opens: the operator's own workspace
// target preference wins, then a file manager, then any directory-capable
// target the daemon listed.
import { beforeEach, describe, expect, it } from "vitest";
import { pickDirectoryTarget, pickEditorTarget } from "../lib/workspace-open-pick";
import type { WorkspaceOpenTarget } from "../lib/workspace-open";

function target(
  id: string,
  kind: string | null,
  openDirectory = true,
): WorkspaceOpenTarget {
  return {
    id,
    label: id,
    kind,
    icon: null,
    capabilities: {
      openDirectory,
      openFile: kind === "editor",
      openFileAtLine: false,
      openFileAtColumn: null,
    },
  };
}

const editorA = target("vscode", "editor");
const editorB = target("cursor", "editor");
const finder = target("finder", "file-manager");
const terminal = target("iterm", "terminal");
const fileOnly = target("preview-app", "default-app", false);

beforeEach(() => {
  window.localStorage.clear();
});

describe("pickDirectoryTarget", () => {
  it("prefers the operator's workspace-target preference among editors", () => {
    window.localStorage.setItem("bb.workspaceOpenTarget", JSON.stringify("cursor"));
    expect(pickDirectoryTarget([editorA, editorB, finder])).toBe(editorB);
    expect(pickEditorTarget([editorA, editorB])).toBe(editorB);
  });

  it("falls back to the first editor, then a file manager, then a terminal", () => {
    expect(pickDirectoryTarget([editorA, finder])).toBe(editorA);
    expect(pickDirectoryTarget([finder, terminal])).toBe(finder);
    expect(pickDirectoryTarget([terminal])).toBe(terminal);
  });

  it("uses a directory-capable target when the kind is unknown", () => {
    const mystery = target("mystery", null);
    expect(pickDirectoryTarget([fileOnly, mystery])).toBe(mystery);
    expect(pickDirectoryTarget([fileOnly])).toBeNull();
  });

  it("ignores a preference that names a target it did not receive", () => {
    window.localStorage.setItem("bb.workspaceOpenTarget", JSON.stringify("finder"));
    expect(pickEditorTarget([editorA])).toBe(editorA);
  });
});
