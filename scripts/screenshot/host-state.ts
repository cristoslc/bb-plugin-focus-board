/**
 * The harness host's row: the state a real bb host owns OUTSIDE any one
 * window (the done index, the sweep-keep flags, the family fold row, the
 * feature-group registry and assignments, the per-column rank orders).
 *
 * The screenshot harness keeps that state in module variables, which is
 * invisible to a second window: each page has its own module instance. This
 * module is the one place the row's write semantics live, so both the window
 * that writes and every window that receives the write apply the SAME
 * function — one copy of the semantics instead of a second copy that drifts.
 *
 * Writes travel as `HostOp` records (`./host-log` carries them between pages)
 * and each one yields the realtime signal the real server publishes after that
 * write, so a receiving page refetches exactly the way bb's second window does.
 *
 * Rank moves deliberately run through `applyRankMoveFractions`, the shared op
 * the live server calls, not a re-spelled copy — the list-model copy drifted
 * once already and the suite caught it.
 */
import { applyRankMoveFractions, type FractionRankStore } from "../../lib/rank-fractions";

export interface HostGroups {
  /** groupId → its name stamp. */
  registry: Record<string, { name: string; createdAt: string }>;
  /** threadId → groupId. */
  assignments: Record<string, string>;
}

export interface HostFamilyState {
  collapsedFamilies: string[];
  hideIdleChildren: string[];
}

/** The host-owned row the mock serves and two windows share. */
export interface HostState {
  ranks: FractionRankStore;
  doneIds: string[];
  family: HostFamilyState;
  groups: HostGroups;
}

export type FamilyStateKey = keyof HostFamilyState;

export interface RankMoveArgs {
  columnKey: string;
  threadId: string;
  beforeId: string | null;
  toEnd: boolean;
  visibleIds: string[];
  unitIds?: string[];
}

/** One host write, serialized between windows. */
export type HostOp =
  | { kind: "done_set"; threadId: string; done: boolean }
  | { kind: "family_state_set"; key: FamilyStateKey; id: string; on: boolean }
  | {
      kind: "family_state_merge";
      collapsedFamilies: string[];
      hideIdleChildren: string[];
    }
  | { kind: "group_create"; group: { id: string; name: string; createdAt: string } }
  | { kind: "group_rename"; groupId: string; name: string }
  | { kind: "group_set"; threadId: string; groupId: string | null }
  | { kind: "rank_move"; args: RankMoveArgs };

/** The realtime signal the real server publishes after a host write. */
export interface HostSignal {
  channel: "done-changed" | "family-state-changed" | "group-changed" | "rank-changed";
  payload: unknown;
}

export interface HostOpResult {
  state: HostState;
  /** The signal to fire on every window, or null for a write with no echo. */
  signal: HostSignal | null;
  /** The column order a rank move produced (rank ops only). */
  order?: string[];
}

const FAMILY_KEYS: FamilyStateKey[] = ["collapsedFamilies", "hideIdleChildren"];

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Apply one host write to the row and name the signal it publishes.
 *
 * Pure with respect to its input (the returned state is a new object), so a
 * window can apply a write it received without mutating anything a render is
 * currently reading.
 */
export function applyHostOp(state: HostState, op: HostOp): HostOpResult {
  switch (op.kind) {
    case "done_set": {
      const done = new Set(state.doneIds);
      if (op.done) done.add(op.threadId);
      else done.delete(op.threadId);
      return {
        state: { ...state, doneIds: [...done] },
        signal: { channel: "done-changed", payload: { threadId: op.threadId, done: op.done } },
      };
    }
    case "family_state_set": {
      if (!FAMILY_KEYS.includes(op.key)) {
        throw new Error(`family_state_set: unknown key ${JSON.stringify(op.key)}`);
      }
      const set = new Set(state.family[op.key]);
      if (op.on) set.add(op.id);
      else set.delete(op.id);
      return {
        state: { ...state, family: { ...state.family, [op.key]: sorted(set) } },
        signal: { channel: "family-state-changed", payload: { key: op.key, id: op.id, on: op.on } },
      };
    }
    case "family_state_merge": {
      return {
        state: {
          ...state,
          family: {
            collapsedFamilies: sorted([
              ...state.family.collapsedFamilies,
              ...op.collapsedFamilies,
            ]),
            hideIdleChildren: sorted([
              ...state.family.hideIdleChildren,
              ...op.hideIdleChildren,
            ]),
          },
        },
        signal: { channel: "family-state-changed", payload: { key: null, id: null, on: null } },
      };
    }
    case "group_create": {
      const registry = { ...state.groups.registry };
      const existing = Object.entries(registry).find(([, record]) => record.name === op.group.name);
      if (existing !== undefined) {
        // Server semantics: create is idempotent on an exact name, so two
        // windows creating the same group converge on one record.
        return {
          state,
          signal: { channel: "group-changed", payload: { threadId: null } },
        };
      }
      registry[op.group.id] = { name: op.group.name, createdAt: op.group.createdAt };
      return {
        state: { ...state, groups: { ...state.groups, registry } },
        signal: { channel: "group-changed", payload: { threadId: null } },
      };
    }
    case "group_rename": {
      const record = state.groups.registry[op.groupId];
      if (record === undefined) {
        throw new Error(`group_rename: no group ${op.groupId}`);
      }
      const taken = Object.entries(state.groups.registry).find(
        ([id, candidate]) => id !== op.groupId && candidate.name === op.name,
      );
      if (taken !== undefined) {
        throw new Error(
          `group name ${JSON.stringify(op.name)} is already taken by group ${taken[0]}`,
        );
      }
      return {
        state: {
          ...state,
          groups: {
            ...state.groups,
            registry: { ...state.groups.registry, [op.groupId]: { ...record, name: op.name } },
          },
        },
        signal: { channel: "group-changed", payload: { threadId: null } },
      };
    }
    case "group_set": {
      const assignments = { ...state.groups.assignments };
      if (op.groupId === null) delete assignments[op.threadId];
      else assignments[op.threadId] = op.groupId;
      return {
        state: { ...state, groups: { ...state.groups, assignments } },
        signal: { channel: "group-changed", payload: { threadId: op.threadId } },
      };
    }
    case "rank_move": {
      const result = applyRankMoveFractions(state.ranks, op.args);
      return {
        state: { ...state, ranks: result.next },
        signal: { channel: "rank-changed", payload: { columnKey: op.args.columnKey } },
        order: result.order,
      };
    }
    default: {
      // An unknown op is a protocol break between the two windows, and a
      // silently ignored one would show a board that never updated.
      throw new Error(`unknown host op ${JSON.stringify(op)}`);
    }
  }
}
