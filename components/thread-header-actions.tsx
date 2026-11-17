// The Focus Board control in bb's own thread-page header
// (`app.slots.experimental_threadHeaderAction`, one instance per visible
// thread pane): the native-page home of the three board actions the
// native-pane study keeps — Done, Snooze, New child thread.
//
// Scope by design (docs/plans/2026-11-17-native-thread-pane.md §4.1): the
// host places this slot in "a 48px chrome row with 28px controls: render
// one inline control that fits, and put anything taller in a portalled
// popover". So the slot is ONE icon trigger opening the board's own
// MenuPopover — not a second toolbar. Everything rename/read/pin/archive
// lives on the native page already; this control carries only what the
// board owns as plugin metadata (lib/done-metadata, lib/snooze) or as its
// own spawn flow.
//
// State truth is the same RPC the board writes through, and the same
// realtime channels fan changes back out: a done or snooze flipped here
// lands on the board's own rows through `done-changed`/`snooze-changed`,
// and one flipped there reaches this control the same way. The control
// reads its thread's metadata once per mount and per signal — never the
// board's lists, so it costs nothing on a board that is not open.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  experimental_usePluginId,
} from "@get-bb/plugin-sdk/app";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MenuPopover, MenuPopoverEntry } from "@/components/menu-popover";
import { SnoozeDialog } from "@/components/snooze-dialog";
import { NewThreadModal, type SpawnedThread } from "@/components/new-thread-modal";
import { HEADER_ICON_BUTTON_CLASS } from "@/lib/pane-chrome";
import { DONE_METADATA_KEY, parseDoneRecord } from "@/lib/done-metadata";
import {
  SNOOZE_METADATA_KEY,
  parseSnoozeRecord,
  snoozeWakeAtMs,
} from "@/lib/snooze";
import { spawnInheritedGroupId } from "@/lib/group-inheritance";
import {
  rememberedProjectStorageKey,
  rememberedProjectStoredValue,
} from "@/lib/new-thread-seed";
import type { rpcContract } from "../server";

/** The control's live view of the one thread this pane shows. */
interface ThreadBoardState {
  done: boolean;
  /** Epoch-ms wake time while snoozed, null otherwise. */
  snoozeWakeAt: number | null;
  title: string | null;
}

/** The sdk surface this control reads, structural so tests stub it whole. */
interface ThreadReaderSdk {
  threads: {
    /** The plugin-bound area: reads THIS plugin's metadata namespace only. */
    getPluginMetadata(args: { threadId: string }): Promise<JsonValue>;
    get(args: { threadId: string }): Promise<unknown>;
  };
}

/** Read the board's metadata namespace for one thread, fail-loud on a
 *  malformed record (the same contract the board's own readers hold). */
async function readThreadBoardState(
  sdk: ThreadReaderSdk,
  threadId: string,
): Promise<ThreadBoardState> {
  const [rawMetadata, thread] = await Promise.all([
    sdk.threads.getPluginMetadata({ threadId }),
    sdk.threads.get({ threadId }),
  ]);
  if (rawMetadata === null || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    throw new Error(`thread metadata: expected an object, got ${typeof rawMetadata}`);
  }
  const metadata = rawMetadata as Record<string, JsonValue | undefined>;
  const snooze = parseSnoozeRecord(metadata[SNOOZE_METADATA_KEY]);
  const threadRecord = thread as Record<string, unknown>;
  return {
    done: parseDoneRecord(metadata[DONE_METADATA_KEY]) !== null,
    snoozeWakeAt: snooze === null ? null : snoozeWakeAtMs(snooze),
    title:
      typeof threadRecord["displayTitle"] === "string" ? threadRecord["displayTitle"] : null,
  };
}

export function FocusBoardThreadHeaderAction({
  threadId,
  isCompactViewport,
}: {
  threadId: string;
  projectId: string;
  isCompactViewport: boolean;
}) {
  const sdk = useSdk() as unknown as ThreadReaderSdk;
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  // One read on mount and one per realtime signal; an in-flight read is
  // superseded by the next, so a fast flip sequence converges on the
  // newest truth.
  const readEpochRef = useRef(0);
  const [state, setState] = useState<ThreadBoardState>({
    done: false,
    snoozeWakeAt: null,
    title: null,
  });
  const refresh = useCallback(() => {
    const epoch = readEpochRef.current + 1;
    readEpochRef.current = epoch;
    readThreadBoardState(sdk, threadId)
      .then((next) => {
        if (readEpochRef.current === epoch) setState(next);
      })
      .catch(() => {
        // A transient read failure keeps the last painted state; the next
        // realtime signal retries. The write paths below settle their own
        // failures through the same refetch.
      });
  }, [sdk, threadId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("done-changed", refresh);
  useRealtime("snooze-changed", refresh);

  // The popover: open state as an anchor point (the board's one popover
  // base), positioned under the trigger like the toolbar's dropdown chips.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const closePopover = useCallback(() => setAnchor(null), []);
  const [snoozePickerOpen, setSnoozePickerOpen] = useState(false);
  const [newChildOpen, setNewChildOpen] = useState(false);

  // Done: the pane header's own semantics — optimistic flip, the same
  // `done_set` RPC, and any done toggle lifts a snooze first (the pane's
  // "a state change lifts any snooze first" rule).
  const toggleDone = useCallback(() => {
    const done = !state.done;
    setState((current) => ({ ...current, done, snoozeWakeAt: null }));
    if (state.snoozeWakeAt !== null) {
      rpc.call("snooze_clear", { threadId }).catch(() => refresh());
    }
    rpc.call("done_set", { threadId, done }).catch(() => refresh());
  }, [state.done, state.snoozeWakeAt, threadId, rpc, refresh]);

  // Snooze: the SnoozeDialog both set and edit run through (fresh: confirm
  // stamps a new wake; edit: confirm re-stamps, remove clears).
  const snoozeUntil = useCallback(
    (wakeAt: Date) => {
      setState((current) => ({ ...current, snoozeWakeAt: wakeAt.getTime() }));
      rpc.call("snooze_set", { threadId, wakeAt: wakeAt.toISOString() }).catch(() => refresh());
    },
    [threadId, rpc, refresh],
  );
  const clearSnooze = useCallback(() => {
    setState((current) => ({ ...current, snoozeWakeAt: null }));
    rpc.call("snooze_clear", { threadId }).catch(() => refresh());
  }, [threadId, rpc, refresh]);

  // New child: the board's modal with the parent preset, plus the two
  // bookkeeping writes the board's own spawn path makes — the group the
  // parent's membership inherits (lib/group-inheritance) and the remembered
  // project seed — then the pane this control lives in shows the child.
  const handleSpawned = useCallback(
    (thread: SpawnedThread) => {
      window.localStorage.setItem(
        rememberedProjectStorageKey(pluginId),
        rememberedProjectStoredValue(thread.projectId),
      );
      rpc
        .call("groups_list")
        .then((result) => {
          const groupId = spawnInheritedGroupId({
            presetGroupId: null,
            parentThreadId: threadId,
            parentGroupId: result.memberships[threadId],
          });
          if (groupId !== undefined) {
            rpc.call("group_set", { threadId: thread.id, groupId }).catch(() => {});
          }
        })
        .catch(() => {
          // Group inheritance is optional state; a failed lookup never
          // blocks the spawn itself.
        });
      navigate.toThread(thread.id);
    },
    [pluginId, threadId, rpc, navigate],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Focus Board thread actions"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Focus Board thread actions"
        onClick={(event) => {
          event.stopPropagation();
          if (anchor !== null) {
            closePopover();
            return;
          }
          const box = triggerRef.current?.getBoundingClientRect();
          if (box === undefined) return;
          setAnchor({ x: box.left, y: box.bottom + 4 });
        }}
        className={cn(
          // The pane header's own checkbox grammar: the same checked/
          // unchecked pair its done checkbox draws, sized to the host's
          // 28px chrome row through the shared pane-chrome class.
          HEADER_ICON_BUTTON_CLASS,
          isCompactViewport && "max-md:pointer-coarse:size-9",
          state.done
            ? "text-muted-foreground"
            : "text-muted-foreground/60 hover:text-muted-foreground",
        )}
      >
        <Icon
          name={state.done ? "CheckboxChecked" : "Checkbox"}
          className="size-3.5"
          aria-hidden
        />
      </button>
      <MenuPopover
        open={anchor}
        onClose={closePopover}
        label="Focus Board thread actions"
        title={state.title ?? undefined}
      >
        <MenuPopoverEntry
          label={state.done ? "Mark Not Done" : "Mark Done"}
          icon={state.done ? "CircleCheck" : "Check"}
          onRun={toggleDone}
        />
        <MenuPopoverEntry
          label={state.snoozeWakeAt === null ? "Snooze…" : "Edit snooze…"}
          icon={state.snoozeWakeAt === null ? "Clock" : "ClockArrowUp"}
          dividerAbove
          onRun={() => {
            setSnoozePickerOpen(true);
          }}
        />
        <MenuPopoverEntry
          label="New child thread…"
          icon="Fork"
          onRun={() => {
            setNewChildOpen(true);
          }}
        />
      </MenuPopover>
      {snoozePickerOpen ? (
        <SnoozeDialog
          threadTitle={state.title ?? threadId}
          currentWakeAt={state.snoozeWakeAt}
          onConfirm={(wakeAt) => {
            snoozeUntil(wakeAt);
            setSnoozePickerOpen(false);
          }}
          onRemove={
            state.snoozeWakeAt === null
              ? undefined
              : () => {
                  clearSnooze();
                  setSnoozePickerOpen(false);
                }
          }
          onCancel={() => setSnoozePickerOpen(false)}
        />
      ) : null}
      <NewThreadModal
        open={newChildOpen}
        onOpenChange={setNewChildOpen}
        parentThreadId={threadId}
        parentThreadTitle={state.title ?? undefined}
        focusRequest={1}
        onSpawned={handleSpawned}
      />
    </>
  );
}
