// The child-spawn group inheritance rule: which feature group a composer
// spawn tags into, resolved from the armed presets. Metadata at spawn (the
// operator's decided design, 2026-10-12): a child thread spawned from a
// grouped parent carries the parent's group as real membership — the same
// per-thread `group` record the manual picker writes — so it counts in the
// membership map, the group filter, and the box GC everywhere.
//
// Precedence, stated here because app.tsx holds both presets at once:
// - an armed "New thread in group…" preset is EXPLICIT operator intent, so
//   it wins its group outright (the presets are normally mutually exclusive
//   — each opener clears the other — the parent branch only fires on data
//   that somehow arms both);
// - otherwise a parent preset inherits the parent's membership;
// - otherwise nothing (undefined: the caller writes no metadata at all —
//   a plain spawn never clears an assignment).
//
// Input honesty (fail loud, never coerce): an empty-string preset or
// parent id is corrupt shape, not a membership the resolver can act on —
// it resolves to no tag. A null/undefined parent membership is honest
// "parent is unassigned" data and resolves to no tag the same way; the
// difference is the caller's to surface, not a value to guess.
//
// Pure module: no host, no SDK, no React.

/** The group id the spawn should tag, or undefined when nothing applies. */
export function spawnInheritedGroupId(options: {
  /** The armed "New thread in group…" preset; null when not armed. */
  presetGroupId: string | null;
  /** The armed parent preset ("New child thread…"); null for a root spawn. */
  parentThreadId: string | null;
  /** The preset parent's membership, from the board's assignments map. */
  parentGroupId: string | null | undefined;
}): string | undefined {
  if (options.presetGroupId !== null) {
    return options.presetGroupId === "" ? undefined : options.presetGroupId;
  }
  if (options.parentThreadId === null || options.parentThreadId === "") return undefined;
  const parentGroupId = options.parentGroupId;
  if (typeof parentGroupId !== "string" || parentGroupId === "") return undefined;
  return parentGroupId;
}