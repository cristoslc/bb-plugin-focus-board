// Focus Board's control in a thread header — ONE component for both header
// surfaces: bb's own thread page (through the `experimental_threadHeaderAction`
// slot, components/thread-header-actions.tsx) and the board's in-panel thread
// pane (components/thread-pane.tsx). The operator's ask (2026-11-23) is that
// the pane header read as the native one "basically identical", and the two
// controls that drift apart are exactly the defect: a second copy of the mark,
// the caret, or a menu row would diverge the first time either surface
// changed. So the markup lives here once; each surface supplies its own state
// and handlers, because each writes through its own path (the native slot
// through the plugin metadata reader and the `done_set` RPC, the pane through
// the board's props).
//
// The scope is the native slot's own scope (docs/plans/2026-11-17-native-
// thread-pane.md §4.1): the host places the control in "a 48px chrome row
// with 28px controls: render one inline control that fits, and put anything
// taller in a portalled popover". So the trigger is ONE icon opening the
// board's own MenuPopover — not a second toolbar. Rename/read/pin/archive
// belong to the surface's own menu on both sides; this control carries only
// what the board owns as plugin metadata (lib/done-metadata, lib/snooze) or as
// its own spawn flow.
//
// The trigger draws the plugin's own mark with a caret, not a checkbox
// (operator, 2026-11-20). A checkbox says "toggle this thing"; this control
// opens a menu, and the done state was the only thing the glyph carried —
// while the menu's first row names that state too. So the mark and caret read
// as "this opens Focus Board's menu", and done is visible as the check on the
// row where it is acted on. The trigger paints no state at all: a tint or a
// dot would be a second, subtler version of the signal the checkbox got wrong,
// and an unreadable state cannot be named in the label either.
import { useCallback, useRef, useState } from "react";
import { Icon, FocusBoardAppIcon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MenuPopover, MenuPopoverEntry } from "@/components/menu-popover";
import { HEADER_ICON_BUTTON_CLASS } from "@/lib/pane-chrome";

/** The trigger's and the menu's one accessible name: both describe the menu
 *  the click opens. The slot's own registration title stays as bb shows it in
 *  the plugin's settings list ("Focus Board thread actions"). */
export const THREAD_MENU_NAME = "Focus Board thread menu";

/** What the control shows about one thread. */
export interface ThreadMenuState {
  done: boolean;
  /** Epoch-ms wake time while snoozed, null otherwise. */
  snoozeWakeAt: number | null;
  title: string | null;
}

export function FocusBoardThreadMenu({
  state,
  isCompactViewport,
  onToggleDone,
  onOpenSnoozePicker,
  onOpenNewChild,
}: {
  state: ThreadMenuState;
  isCompactViewport: boolean;
  /** Flip the thread's done state. The surface decides what else that lifts
   *  (both surfaces lift a snooze first). */
  onToggleDone: () => void;
  /** Open the surface's snooze picker (set, edit, remove). Absent on a
   *  surface with no picker wired: the row is then not offered at all, rather
   *  than offered dead. */
  onOpenSnoozePicker?: () => void;
  /** Open the surface's new-child flow. Absent on a surface with no spawn
   *  flow: same rule. */
  onOpenNewChild?: () => void;
}) {
  // The popover: open state as an anchor point (the board's one popover
  // base), positioned under the trigger like the toolbar's dropdown chips.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const closePopover = useCallback(() => setAnchor(null), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-thread-menu-trigger=""
        // A menu trigger, so its name describes the menu. Done is not in the
        // name: the trigger paints no state, and the menu's first row states
        // it (the menuitemradio's check).
        aria-label={THREAD_MENU_NAME}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title={THREAD_MENU_NAME}
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
          // The pane chrome's own 28px ghost box (36px on a coarse pointer),
          // holding the plugin's mark and a caret that hitches to it. The
          // chrome class sizes every glyph in the box to 16px (20 on a
          // coarse pointer), so the caret is pinned smaller by the narrower
          // selector: the mark leads, the caret says "menu".
          HEADER_ICON_BUTTON_CLASS,
          "inline-flex items-center justify-center gap-0.5",
          "[&_[data-icon-root][data-icon=ChevronDown]]:size-2.5",
          "max-md:pointer-coarse:[&_[data-icon-root][data-icon=ChevronDown]]:size-3",
          isCompactViewport && "max-md:pointer-coarse:size-9",
        )}
      >
        <FocusBoardAppIcon className="shrink-0" />
        <Icon name="ChevronDown" className="shrink-0" aria-hidden />
      </button>
      <MenuPopover
        open={anchor}
        onClose={closePopover}
        label={THREAD_MENU_NAME}
        title={state.title ?? undefined}
      >
        <MenuPopoverEntry
          label={state.done ? "Mark Not Done" : "Mark Done"}
          icon={state.done ? "CircleCheck" : "Check"}
          // Done is the row's own checked state, in the popover base's
          // checked idiom (role="menuitemradio" with aria-checked): it always
          // carries the attribute, so the row reads as a state, and it draws
          // the check only when the thread is done.
          checked={state.done}
          onRun={() => {
            closePopover();
            onToggleDone();
          }}
        />
        {onOpenSnoozePicker === undefined ? null : (
          <MenuPopoverEntry
            label={state.snoozeWakeAt === null ? "Snooze…" : "Edit snooze…"}
            icon={state.snoozeWakeAt === null ? "Clock" : "ClockArrowUp"}
            dividerAbove
            onRun={() => {
              closePopover();
              onOpenSnoozePicker();
            }}
          />
        )}
        {onOpenNewChild === undefined ? null : (
          <MenuPopoverEntry
            label="New child thread…"
            icon="Fork"
            onRun={() => {
              closePopover();
              onOpenNewChild();
            }}
          />
        )}
      </MenuPopover>
    </>
  );
}
