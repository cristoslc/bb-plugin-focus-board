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