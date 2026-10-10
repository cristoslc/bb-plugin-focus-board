// Branch-rename helpers for the done gesture's side channel.
//
// Marking a thread done renames its managed worktree branch from the
// managed prefix (`bb/<slug>` — bb's `managedBranchPrefix` default) under
// a `bb/done/<slug>` group in the same namespace; un-marking restores it.
// The original name is persisted as per-thread plugin metadata so the
// restore never guesses. Pure name math and record parsing — no host, no
// SDK — so the RPC layer and tests drive them without a bb host.
import type { JsonValue } from "@get-bb/plugin-sdk";

/**
 * The managed-worktree branch prefix bb provisions worktree branches
 * under (core's `managedBranchPrefix` default). Branches outside it are
 * names the operator chose; the board never renames those.
 */
export const MANAGED_BRANCH_PREFIX = "bb/";

/** The done group inside the managed namespace: `bb/done/<rest>`. */
const DONE_GROUP = "done/";

/** The board's worktree-branch-rename key in its metadata namespace. */
export const WORKTREE_BRANCH_METADATA_KEY = "worktree-branch-rename";

/** The settled record shape: key → { originalBranch, doneBranch, at }. */
export type WorktreeBranchRecord = {
  originalBranch: string;
  doneBranch: string;
  at: string;
};

/**
 * The `bb/done/<rest>` form of a managed branch, or null when the branch
 * is not in the managed `bb/` namespace already — an operator branch is
 * never renamed — or is already under the done group (idempotent skip on
 * a re-marked thread).
 */
export function doneBranchName(branch: string): string | null {
  const rest = managedRest(branch);
  if (rest === null || rest.startsWith(`${DONE_GROUP}`)) return null;
  return `${MANAGED_BRANCH_PREFIX}${DONE_GROUP}${rest}`;
}

/**
 * The original managed form behind a `bb/done/<rest>` branch, or null when
 * the branch is not in the done group.
 */
export function originalBranchName(doneBranch: string): string | null {
  const rest = managedRest(doneBranch);
  if (rest === null || !rest.startsWith(`${DONE_GROUP}`)) return null;
  const tail = rest.slice(DONE_GROUP.length);
  if (tail === "") return null;
  return `${MANAGED_BRANCH_PREFIX}${tail}`;
}

/** The text after `bb/`, or null when the branch is not managed. */
function managedRest(branch: string): string | null {
  if (!branch.startsWith(MANAGED_BRANCH_PREFIX)) return null;
  const rest = branch.slice(MANAGED_BRANCH_PREFIX.length);
  return rest === "" ? null : rest;
}

/**
 * Parse a metadata value into a WorktreeBranchRecord.
 *
 * Absent (undefined) and null mean "no rename recorded" → null. A
 * malformed present value throws (fail loud, never coerce): the restore
 * arm of the rename channel acts on this record's exact names, so a wrong
 * shape is a bug to surface, not data to paper over.
 */
export function parseWorktreeBranchRecord(
  value: JsonValue | undefined,
): WorktreeBranchRecord | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`worktree-branch metadata: expected object, got ${got}`);
  }
  const obj = value as { [key: string]: JsonValue };
  const originalBranch = parseName(obj["originalBranch"], "originalBranch");
  const doneBranch = parseName(obj["doneBranch"], "doneBranch");
  const at = obj["at"];
  if (at === undefined || typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    throw new Error(
      `worktree-branch metadata: invalid at ${JSON.stringify(at)}`,
    );
  }
  return { originalBranch, doneBranch, at };
}

function parseName(value: JsonValue, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `worktree-branch metadata: invalid ${field} ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Stamp a fresh rename record: at = now, names straight from the git op. */
export function stampWorktreeBranchRecord(
  originalBranch: string,
  doneBranch: string,
  now: Date,
): WorktreeBranchRecord {
  return { originalBranch, doneBranch, at: now.toISOString() };
}