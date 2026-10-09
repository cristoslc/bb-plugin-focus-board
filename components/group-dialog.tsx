import { useState } from "react";
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
import { cn } from "@/lib/utils";
import { normalizeGroupName } from "../lib/group-metadata";

interface GroupDialogProps {
  /** The thread being grouped; names it in the copy. */
  threadTitle: string;
  /** Every registry group (id + name), in registry order. */
  groups: readonly { id: string; name: string }[];
  /** The thread's current group id, null when unassigned. */
  currentGroupId: string | null;
  /** Confirm an existing group pick — one click, picker closes. */
  onPick: (groupId: string) => void;
  /** Confirm the name field with a NEW group, then assign to it. */
  onCreate: (name: string) => void;
  /** Clears the thread's assignment (picker only, when assigned). */
  onRemove?: () => void;
  onCancel: () => void;
}

/**
 * The group picker: every existing group as a one-click pick, a name field
 * for a new group (assigned to the thread on confirm, so creation is never
 * a registry write the board never surfaces), and a remove action when the
 * thread already carries a group. One surface per the decided design — the
 * box itself never hosts editing controls; empty groups evaporate server-
 * side on the next write, so there is no "delete group" affordance here.
 */
export function GroupDialog({
  threadTitle,
  groups,
  currentGroupId,
  onPick,
  onCreate,
  onRemove,
  onCancel,
}: GroupDialogProps) {
  const [name, setName] = useState("");
  const validName = normalizeGroupName(name);
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
            box on the board — no parent thread involved.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          “{threadTitle}” {currentGroupId === null ? "joins" : "stays with"}{" "}
          the picked group:
        </p>
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <Button
              key={group.id}
              variant="outline"
              size="sm"
              className={cn(
                "justify-start",
                group.id === currentGroupId && "border-ring ring-2 ring-ring",
              )}
              data-group-choice={group.id}
              onClick={() => onPick(group.id)}
            >
              <Icon name="Tag" className="size-3.5 text-muted-foreground" aria-hidden />
              {group.name}
              {group.id === currentGroupId ? (
                <span className="ml-auto text-[10px] text-muted-foreground/70">current</span>
              ) : null}
            </Button>
          ))}
          {groups.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/60">No groups yet.</p>
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
            disabled={validName === null}
            onClick={() => {
              if (validName === null) return;
              onCreate(validName);
            }}
            data-group-create=""
          >
            Create & assign
          </Button>
        </div>
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