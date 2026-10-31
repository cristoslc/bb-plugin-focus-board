import { type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { MenuPopover, MenuPopoverEntry } from "@/components/menu-popover";
import { touchDragArmed } from "@/components/touch-hold-drag";
import { Icon } from "@/components/ui/icon";
import type { CardMenuAction } from "@/lib/card-menu";

export type { CardMenuAction };

interface ThreadCardMenuProps {
  anchor: ReactNode;
  actions: readonly CardMenuAction[];
  onOpen: () => void;
  href: string;
  /** The thread the menu acts on, shown as the menu's header. */
  title: string;
  /**
   * Open/close reports (the attention freeze): the caller captures the
   * anchor card's placement while the menu holds, and releases on close —
   * whatever path closed it (a run's own close, outside click, Escape).
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * The surface's pointer is coarse (issue #336). A phone has no right-click
   * and its long press belongs to the drag, so the menu renders an explicit
   * trigger on the card and no press gesture opens it. A fine pointer keeps
   * the right-click path exactly as it was, with no extra control on the card.
   */
  coarse?: boolean;
}

/**
 * Right-click menu for a board card, mirroring the sidebar thread menu's
 * relevant actions. Left-click still opens the pane; modified clicks fall
 * through to the anchor's native href behavior. The anchor stops the
 * context-menu event's propagation so a nested card's menu cannot also open
 * its ancestor card's menu — and a boxed card's menu cannot also open its
 * group box's. The popover shell itself is shared (components/menu-popover).
 *
 * On a coarse pointer the menu has a different home (issue #336). The board's
 * pickup arms a card at 180ms and the platform's own long press fires ~300ms
 * later, so a resting finger used to get a context menu over a card it was in
 * the middle of dragging. So: a long press never opens this menu on touch, the
 * drag refuses one outright (`touchDragArmed`), and the touch story becomes
 * the one the operator asked for — tap opens the card, hold drags it, the ⋯
 * opens the menu.
 */
export function ThreadCardMenu({
  anchor,
  actions,
  onOpen,
  href,
  title,
  onOpenChange,
  coarse = false,
}: ThreadCardMenuProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  // The open/close reports ride every path, the dismissal mechanics
  // (outside click, Escape, a run's own close) included.
  const openMenu = ({ x, y }: { x: number; y: number }) => {
    // A pickup owns the gesture outright: nothing opens over a drag, whichever
    // path asked (a stray right-click, the trigger under a second finger).
    if (touchDragArmed()) return;
    setOpen({ x, y });
    onOpenChange?.(true);
  };
  const close = () => {
    if (open !== null) onOpenChange?.(false);
    setOpen(null);
  };
  return (
    <>
      <div
        className={coarse ? "relative" : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // A finger's long press is the drag's (issue #336). The browser's own
          // menu is refused above for every pointer; the board's menu opens
          // from the trigger below on touch, and from the right-click here on
          // a mouse.
          if (coarse) return;
          openMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {anchor}
        {coarse ? (
          <button
            type="button"
            data-card-menu-trigger=""
            aria-haspopup="menu"
            aria-label={`Actions for ${title}`}
            onClick={(event) => {
              // The trigger's tap is its own: it never opens the card, and it
              // never reaches the drag.
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu({ x: rect.right, y: rect.bottom + 4 });
            }}
            className="absolute right-0 top-0 z-10 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="MoreHorizontal" className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>
      <MenuPopover open={open} onClose={close} label="Thread actions" title={title}>
        <MenuPopoverEntry
          label="Open thread"
          icon="MessageSquare"
          onRun={() => {
            close();
            onOpen();
          }}
        />
        <MenuPopoverEntry
          label="Copy link to thread"
          icon="Copy"
          onRun={() => {
            close();
            const url = new URL(href, window.location.origin).toString();
            void navigator.clipboard.writeText(url).catch(() => {});
          }}
        />
        {actions.map((action) => (
          <MenuPopoverEntry
            key={action.id}
            label={action.label}
            icon={action.icon}
            onRun={() => {
              close();
              action.run();
            }}
            danger={action.danger}
            dividerAbove={action.dividerAbove}
          />
        ))}
      </MenuPopover>
    </>
  );
}
