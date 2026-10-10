import { describe, expect, it } from "vitest";
import {
  doneBranchName,
  originalBranchName,
  parseWorktreeBranchRecord,
  WORKTREE_BRANCH_METADATA_KEY,
} from "../lib/worktree-branch";

describe("doneBranchName", () => {
  it("puts a managed branch under bb/done/", () => {
    expect(doneBranchName("bb/mark-done-thr_abc")).toBe(
      "bb/done/mark-done-thr_abc",
    );
  });

  it("keeps a bare managed prefix branch valid", () => {
    expect(doneBranchName("bb/thr_abc")).toBe("bb/done/thr_abc");
  });

  it("refuses a branch already under bb/done/ (idempotent skip)", () => {
    expect(doneBranchName("bb/done/mark-done-thr_abc")).toBe(null);
  });

  it("refuses a branch outside the managed bb/ prefix", () => {
    expect(doneBranchName("feature/foo")).toBe(null);
    expect(doneBranchName("archived/bb/foo")).toBe(null);
    expect(doneBranchName("bbfoo")).toBe(null);
  });
});

describe("originalBranchName", () => {
  it("restores the managed name from the bb/done/ form", () => {
    expect(originalBranchName("bb/done/mark-done-thr_abc")).toBe(
      "bb/mark-done-thr_abc",
    );
  });

  it("refuses a branch not under bb/done/", () => {
    expect(originalBranchName("bb/mark-done-thr_abc")).toBe(null);
    expect(originalBranchName("feature/foo")).toBe(null);
    expect(originalBranchName("done/foo")).toBe(null);
  });
});

describe("parseWorktreeBranchRecord", () => {
  const valid = {
    originalBranch: "bb/mark-done-thr_abc",
    doneBranch: "bb/done/mark-done-thr_abc",
    at: "2026-10-10T09:00:00.000Z",
  };

  it("accepts a well-formed record", () => {
    expect(parseWorktreeBranchRecord(valid)).toEqual(valid);
  });

  it("absent and null mean no rename was recorded", () => {
    expect(parseWorktreeBranchRecord(undefined)).toBe(null);
    expect(parseWorktreeBranchRecord(null)).toBe(null);
  });

  it("fails loud on a non-object value", () => {
    expect(() => parseWorktreeBranchRecord(4)).toThrow(
      /worktree-branch metadata/,
    );
  });

  it("fails loud on a missing or non-string branch field", () => {
    expect(() =>
      parseWorktreeBranchRecord({ ...valid, originalBranch: 123 }),
    ).toThrow(/originalBranch/);
    expect(() =>
      parseWorktreeBranchRecord({ doneBranch: valid.doneBranch, at: valid.at }),
    ).toThrow(/originalBranch/);
    expect(() =>
      parseWorktreeBranchRecord({ ...valid, doneBranch: null }),
    ).toThrow(/doneBranch/);
  });

  it("fails loud on an invalid at stamp", () => {
    expect(() => parseWorktreeBranchRecord({ ...valid, at: 123 })).toThrow(
      /at/,
    );
    expect(() =>
      parseWorktreeBranchRecord({ ...valid, at: "not-a-date" }),
    ).toThrow(/^worktree-branch metadata: invalid at/);
  });

  it("exposes the same key the board's namespace uses", () => {
    expect(WORKTREE_BRANCH_METADATA_KEY).toBe("worktree-branch-rename");
  });
});