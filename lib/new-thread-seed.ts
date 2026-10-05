/**
 * Which project id the board's new-thread composer is seeded with.
 *
 * A child preset beats the board filter: the operator asked for a child of
 * a specific thread, so the child copies the parent's project — the family
 * keeps landing in one place — even when a single-project filter disagrees.
 * Without a parent preset the single-project filter seeds, behind a
 * staleness guard: a filter id naming a project the picker no longer knows
 * seeds nothing, and the composer falls back to bb's default project pick.
 * An unresolvable parent (its row left the board while the dialog is open)
 * falls back to the filter seed the same way — the spawn still carries
 * `parentThreadId` (the preset is about the parent, not the project).
 */
export function newThreadSeedProjectId({
  parentProjectId,
  filterProjectId,
  knownProjectIds,
}: {
  /** The preset parent's projectId; undefined when absent or unresolvable. */
  parentProjectId?: string;
  /** The single project id a board filter selected; undefined otherwise. */
  filterProjectId?: string;
  /** The project ids the composer's picker knows — the staleness guard. */
  knownProjectIds: readonly string[];
}): string | undefined {
  if (parentProjectId !== undefined) return parentProjectId;
  if (filterProjectId !== undefined && knownProjectIds.includes(filterProjectId)) {
    return filterProjectId;
  }
  return undefined;
}

/**
 * Which environment the board's new-thread composer is seeded with for a
 * child thread.
 *
 * A parent whose environment is a git worktree seeds the composer's
 * round-trippable `reuse` variant — the child starts in the parent's
 * checkout, not the project-default one. Everything else seeds nothing:
 * a plain checkout, a provider machine, or an unknown worktree kind
 * (`isWorktree: null`) cannot be expressed from a sidebar row without
 * guessing a host or provider, and the composer's own default for the
 * already-seeded project is the honest fallback. A stale `environmentId`
 * degrades the same way inside the composer (its documented fallback
 * resolves a default checkout when the reused worktree has no
 * unarchived threads).
 */
export function newThreadSeedEnvironment({
  parentEnvironment,
}: {
  /** The preset parent's environment record; undefined when absent. */
  parentEnvironment?:
    | { id: string | null; isWorktree: boolean | null }
    | null
    | undefined;
}): { type: "reuse"; environmentId: string } | undefined {
  if (
    parentEnvironment?.id != null &&
    parentEnvironment.isWorktree === true
  ) {
    return { type: "reuse", environmentId: parentEnvironment.id };
  }
  return undefined;
}