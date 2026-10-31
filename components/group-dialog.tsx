import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { useIsCompactViewport } from "./ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { normalizeGroupName } from "../lib/group-metadata";

interface GroupDialogProps {
  /** The thread being grouped; names it in the copy. */
  threadTitle: string;
  /**
   * Every registry group (id + name). Arrives in registry order (creation
   * order) and is re-sorted by name for display here: the picker is the one
   * surface an operator scans by name, while storage order stays the
   * registry's own business.
   */
  groups: readonly { id: string; name: string }[];
  /** The thread's current group id, null when unassigned. */
  currentGroupId: string | null;
  /** Confirm an existing group pick — one click, picker closes. */
  onPick: (groupId: string) => void;
  /**
   * Confirm the name field with a NEW group, then assign to it. A rejection
   * keeps the picker open with the typed name and shows the reason inline;
   * an existing exact name is not a rejection (create resolves it to that
   * group's record, so the pick settles onto it).
   */
  onCreate: (name: string) => Promise<void>;
  /** Clears the thread's assignment (picker only, when assigned). */
  onRemove?: () => void;
  /**
   * Rename a registry group in place; every member card re-labels. Names are
   * unique across the registry, so a rename onto a name another group holds
   * rejects (the server owns that rule) and the editor stays open with the
   * refusal inline.
   */
  onRename: (groupId: string, name: string) => Promise<void>;
  /**
   * Delete a registry group outright (a two-step confirm): the record and
   * every member's assignment go together, server-side.
   */
  onDelete: (groupId: string) => void;
  onCancel: () => void;
}

/**
 * The refusal's own words. The failing write owns the reason (the registry
 * refuses a taken name, and only it sees the whole store), so the picker
 * renders that message instead of inventing a local verdict.
 */
function refusalMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The group picker: every existing group as a one-click pick, a name field
 * for a new group (assigned to the thread on confirm, so creation is never
 * a registry write the board never surfaces), a remove action when the
 * thread already carries a group, and per-group rename/delete rows — the
 * picker is the registry's one management surface (rename propagates to
 * every member card through the shared name; delete clears the members'
 * assignments server-side, so archived holders never orphan). Names are
 * unique across the registry, so a rename onto a name another group holds
 * is refused inline and the editor stays open on the typed value.
 */
export function GroupDialog({
  threadTitle,
  groups,
  currentGroupId,
  onPick,
  onCreate,
  onRemove,
  onRename,
  onDelete,
  onCancel,
}: GroupDialogProps) {
  const [name, setName] = useState("");
  const validName = normalizeGroupName(name);
  // Row-local management states: one row edits OR arms a delete at a time;
  // pick buttons stay live in every other row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The list's own filter: a substring match over the group names, so a
  // registry running many pages long stays reachable without scrolling it.
  // Escape keeps the one meaning it has in this dialog, dismissing the
  // picker (the rename editor's Escape dismisses without intercepting it);
  // the Clear control is the no-keyboard way back to the full list.
  const [filter, setFilter] = useState("");
  const isCompactViewport = useIsCompactViewport();
  // A refused write keeps its editor open with the reason inline. The server
  // owns why (one source of truth: two windows can race for a name, so a
  // local check could not be trusted), and the message it sends is the text
  // shown here.
  const [renameError, setRenameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Display order only: the registry keeps creation order for the toolbar,
  // the filter menu, and the RPC. Names sort case-insensitively with the id
  // as tiebreak, so two groups spelled alike never reshuffle by creation
  // order between renders.
  const sortedGroups = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (byName !== 0) return byName;
        // Same name in two cases: the id settles it without the locale's
        // case rules, and without creation order leaking back in.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    [groups],
  );
  const query = filter.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      query === ""
        ? sortedGroups
        : sortedGroups.filter((group) => group.name.toLowerCase().includes(query)),
    [query, sortedGroups],
  );

  const startRename = (groupId: string, currentName: string) => {
    setDeletingId(null);
    setEditingId(groupId);
    setRenameValue(currentName);
    setRenameError(null);
  };
  const closeRowStates = () => {
    setEditingId(null);
    setDeletingId(null);
    setRenameError(null);
  };
  const commitRename = (groupId: string) => {
    const settled = normalizeGroupName(renameValue);
    if (settled === null) return; // a blank name keeps the editor open
    setRenameError(null);
    // The write starts synchronously (a confirm begins its RPC in the tick
    // it fires) and the editor settles from the promise: a refusal keeps it
    // open with the server's reason, a success closes it.
    let pending: Promise<void>;
    try {
      pending = onRename(groupId, settled);
    } catch (error) {
      setRenameError(refusalMessage(error));
      return;
    }
    void Promise.resolve(pending).then(
      () => closeRowStates(),
      (error: unknown) => setRenameError(refusalMessage(error)),
    );
  };
  const submitCreate = () => {
    if (validName === null) return;
    setCreateError(null);
    setCreating(true);
    let pending: Promise<void>;
    try {
      pending = onCreate(validName);
    } catch (error) {
      setCreating(false);
      setCreateError(refusalMessage(error));
      return;
    }
    void Promise.resolve(pending).then(
      () => setCreating(false),
      (error: unknown) => {
        setCreating(false);
        setCreateError(refusalMessage(error));
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" aria-describedby={undefined} data-group-dialog="">
        <DialogHeader>
          <DialogTitle>Group thread</DialogTitle>
          <DialogDescription>
            Sibling threads sharing a group render inside one dashed family
            box on the board — no parent thread involved. A row's pencil
            renames the group everywhere; its trash deletes the group for
            every member.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          “{threadTitle}” {currentGroupId === null ? "joins" : "stays with"}{" "}
          the picked group:
        </p>
        {groups.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                // The row an editor stands on may leave the list under the
                // typed query, and an armed delete the operator can no longer
                // see is a hazard: a filter change closes both row states.
                closeRowStates();
              }}
              placeholder="Filter groups…"
              aria-label="Filter groups"
              aria-controls="group-picker-list"
              data-group-filter-input=""
              className="w-full flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            {filter === "" ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilter("");
                  closeRowStates();
                }}
                data-group-filter-clear=""
              >
                Clear
              </Button>
            )}
          </div>
        ) : null}
        <div
          id="group-picker-list"
          data-group-list=""
          className={cn(
            "flex flex-col gap-1.5",
            // A bounded pane, so the filter field, the new-group field, and
            // the footer stay put while a long registry scrolls. The compact
            // drawer already scrolls its whole body, so the cap lifts there
            // rather than nesting one scroll region inside another.
            isCompactViewport ? "" : "max-h-[min(45dvh,18rem)] overflow-y-auto pr-1",
          )}
        >
          {visibleGroups.map((group) => {
            if (editingId === group.id) {
              return (
                <div key={group.id} className="flex flex-col gap-1" data-group-row={group.id}>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename(group.id);
                        if (event.key === "Escape") closeRowStates();
                      }}
                      autoFocus
                      aria-label={`Rename group, was ${group.name}`}
                      data-group-rename-input={group.id}
                      maxLength={80}
                      className="w-full flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={normalizeGroupName(renameValue) === null}
                      onClick={() => commitRename(group.id)}
                      data-group-rename-confirm={group.id}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={closeRowStates}
                      data-group-rename-cancel={group.id}
                    >
                      Cancel
                    </Button>
                  </div>
                  {renameError === null ? null : (
                    <p
                      role="alert"
                      data-group-rename-error=""
                      className="px-1 text-xs text-destructive"
                    >
                      Rename failed: {renameError}
                    </p>
                  )}
                </div>
              );
            }
            if (deletingId === group.id) {
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-sm"
                  data-group-row={group.id}
                >
                  <span className="flex-1 truncate">Delete “{group.name}” for all members?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      onDelete(group.id);
                      closeRowStates();
                    }}
                    data-group-delete-confirm={group.id}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={closeRowStates}
                    data-group-delete-keep={group.id}
                  >
                    Keep group
                  </Button>
                </div>
              );
            }
            return (
              <div key={group.id} className="group/row flex items-center gap-1" data-group-row={group.id}>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => onPick(group.id)}
                >
                  <Icon name="Tag" className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{group.name}</span>
                  {group.id === currentGroupId ? (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">current</span>
                  ) : null}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity",
                    "group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                  onClick={() => startRename(group.id, group.name)}
                  data-group-rename={group.id}
                >
                  <Icon name="Edit" className="size-3.5" aria-hidden />
                  <span className="sr-only">Rename group {group.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 text-destructive opacity-0 transition-opacity",
                    "group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                  onClick={() => {
                    setEditingId(null);
                    setDeletingId(group.id);
                  }}
                  data-group-delete={group.id}
                >
                  <Icon name="Trash2" className="size-3.5" aria-hidden />
                  <span className="sr-only">Delete group {group.name}</span>
                </Button>
              </div>
            );
          })}
          {groups.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/60" data-group-list-empty="">
              No groups yet.
            </p>
          ) : visibleGroups.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/60" data-group-filter-empty="">
              No group matches “{filter.trim()}”.
            </p>
          ) : null}
        </div>
        <div className="flex items-end gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name…"
            aria-label="New group name"
            data-group-name-input=""
            maxLength={80}
            className="w-full flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
          <Button
            size="sm"
            disabled={validName === null || creating}
            onClick={submitCreate}
            data-group-create=""
          >
            Create & assign
          </Button>
        </div>
        {createError === null ? null : (
          <p role="alert" data-group-create-error="" className="px-1 text-xs text-destructive">
            Create failed: {createError}
          </p>
        )}
        <DialogFooter>
          {currentGroupId !== null && onRemove !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              data-group-remove=""
              className="mr-auto text-destructive"
            >
              Remove from group
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onCancel} data-group-cancel="">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// NOTE: the two-step delete is deliberate — a delete strips EVERY member's
// assignment (archived holders included), too wide to fire on one click.