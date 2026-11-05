import { describe, expect, it } from "vitest";
import {
  PROJECT_PATH_ROOT_REFUSAL,
  projectFolderName,
} from "../lib/project-folder-name";

describe("projectFolderName (the name bb derives from a picked folder)", () => {
  it("the last path segment is the name, like bb's typical flow", () => {
    expect(projectFolderName("/Users/me/code/auth-rework")).toBe("auth-rework");
    expect(projectFolderName("/Users/me/code/bb-plugin-focus-board/")).toBe("bb-plugin-focus-board");
  });

  it("Windows-picked folders name themselves the way bb's parser does", () => {
    expect(projectFolderName("C:\\Users\\me\\code\\auth-rework")).toBe("auth-rework");
    expect(projectFolderName("C:\\Users\\me\\code\\auth-rework\\")).toBe("auth-rework");
  });

  it("whitespace and trailing separators are stripped before the segment is read", () => {
    expect(projectFolderName("  /Users/me/code/auth-rework/ ")).toBe("auth-rework");
  });

  it("the filesystem root or an empty path names nothing (the create is refused)", () => {
    expect(projectFolderName("/")).toBe("");
    expect(projectFolderName("\\\\")).toBe("");
    expect(projectFolderName("   ")).toBe("");
    expect(projectFolderName("")).toBe("");
  });

  it("bb's refusal words are kept verbatim", () => {
    expect(PROJECT_PATH_ROOT_REFUSAL).toBe(
      "Project path must point to a project directory, not the filesystem root.",
    );
  });

  it("a bare Windows drive is the filesystem root — bb's parser reads it root-only, so it names nothing", () => {
    expect(projectFolderName("C:\\")).toBe("");
    expect(projectFolderName("C:")).toBe("");
  });
});
