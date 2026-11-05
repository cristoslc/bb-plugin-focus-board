import { useEffect, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The board's one popover base: an anchored, clamped, click-away-and-Escape
 * dismissable shell that the context menus (thread cards, group boxes, lanes)
 * AND the toolbar's dropdown chips render through — one dismissal grammar, one
 * edge look, one hover contract (components/board-toolbar.tsx migrated onto
 * this shell; the operator's "share a common base" pass on the lane-menu
 * ruling). Position is the caller's: a context menu passes the pointer's
 * point, an anchored dropdown passes its trigger's box.
 */
export function MenuPopover({
  open,
  onClose,
  label,
  title,
  children,
  maxHeight,
  className,
  role,
  onEscape,
}: {
  /**
   * The pointer or anchor position the menu opens at, or null (closed). State
   * held by the caller — several surfaces can render at once and the caller
   * decides which (if any) one is open.
   */
  open: { x: number; y: number } | null;
  /** Close on backdrop click, backdrop right-click, Escape, or after any entry ran. */
  onClose: () => void;
  /** The popover's accessible name, e.g. "Thread actions" / "Group actions". */
  label: string;
  children: ReactNode;
  /**
   * The header line naming what the menu acts on (the thread or group).
   * Optional: the option-list dropdowns render rows with no header line.
   */
  title?: ReactNode;
  /**
   * The shell's height cap in px, for callers whose rows must not grow with
   * the window (the dropdown chips' rows cap at 320). Default: whatever
   * height the window leaves, minus its edges.
   */
  maxHeight?: number;
  /** Extra classes on the shell (a wider min-width, for the option lists). */
  className?: string;
  /**
   * The shell's ARIA role, default "menu". The dropdown chips pass none:
   * their option list carries the listbox semantics exactly as it always did.
   */
  role?: string;
  /**
   * Called for Escape BEFORE the shell closes; return false to claim the key
   * (the chips' two-stage semantics: a typed filter wipes first, a create
   * field cancels itself). Unclaimed Escape closes through onClose.
   */
  onEscape?: (event: KeyboardEvent) => boolean;
}) {
  if (open === null) return null;
  return (
    <>
      <ShellEscape onClose={onClose} onEscape={onEscape} />
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
        aria-hidden
      />
      <div
        role={role ?? "menu"}
        aria-label={label}
        // Raised above the card surface: cards draw `bg-card` at half-
        // strength borders, the menu draws the popover surface at full-
        // strength under the elevated shadow, and its header rule bounds
        // the menu as a menu rather than one more card.
        className={cn(
          "fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 shadow-lg",
          className,
        )}
        style={{
          left: open.x,
          top: open.y,
          // Whatever height the window leaves (minus its edges), not a
          // fixed pixel cap: a tall window shows a long menu whole, a
          // short one scrolls (the ref clamp below keeps it on screen).
          maxHeight: maxHeight ?? window.innerHeight - 16,
          overflowY: "auto",
        }}
        ref={(node) => {
          if (node === null) return;
          const rect = node.getBoundingClientRect();
          const clampedX = Math.min(open.x, window.innerWidth - rect.width - 8);
          const clampedY = Math.min(open.y, window.innerHeight - rect.height - 8);
          if (clampedX !== node.offsetLeft) node.style.left = `${Math.max(8, clampedX)}px`;
          if (clampedY !== node.offsetTop) node.style.top = `${Math.max(8, clampedY)}px`;
        }}
      >
        {title === undefined ? null : (
          <div
            aria-hidden
            className="max-w-64 truncate border-b border-border px-2 pb-1.5 pt-1.5 text-[11px] font-medium text-muted-foreground"
          >
            {title}
          </div>
        )}
        {children}
      </div>
    </>
  );
}

/** Escape owns the dismissal at the window: the shell's keys reach the base
 *  wherever focus sits (the chip's search input included), and every caller's
 *  claiming hook runs first. Mounted while open; capture so a keydown an
 *  inner field stops at bubble phase still reaches here first. */
function ShellEscape({
  onClose,
  onEscape,
}: {
  onClose: () => void;
  onEscape?: (event: KeyboardEvent) => boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (onEscape !== undefined && !onEscape(event)) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, onEscape]);
  return null;
}

/**
 * One entry row, matching the menu grammar everywhere in the app: icon,
 * label, and the shared styling (danger tone, divider above). Callers own
 * what clicking it does — this button just closes nothing; the caller
 * closes via its own onClose in the row's onClick.
 */
export function MenuPopoverEntry({
  label,
  icon,
  onRun,
  danger,
  dividerAbove,
  checked,
}: {
  label: string;
  icon: string;
  onRun: () => void;
  /** Destructive or state-arming entries draw in the danger tone. */
  danger?: boolean;
  dividerAbove?: boolean;
  /**
   * The checked-state idiom of the toolbar's option menus (the leading Check
   * on a selected row), as a menu row's own mark: present → the row renders
   * role="menuitemradio" with aria-checked, and the active row carries the
   * Check. Absent → a plain action row, exactly as before.
   */
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked === undefined ? undefined : checked}
      onClick={onRun}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent",
        dividerAbove && "mt-1 border-t border-border pt-2",
        danger && "text-destructive",
      )}
    >
      <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {label}
      {checked === true ? (
        <Icon name="Check" className="ml-auto size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </button>
  );
}
