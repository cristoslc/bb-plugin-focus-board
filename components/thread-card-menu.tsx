import { type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface CardMenuAction {
  id: string;
  label: string;
  icon: string;
  run: () => void;
  /** Destructive or state-changing entries draw in the danger tone. */
  danger?: boolean;
  dividerAbove?: boolean;
}

interface ThreadCardMenuProps {
  anchor: ReactNode;
  actions: readonly CardMenuAction[];
  onOpen: () => void;
  href: string;
  /** The thread the menu acts on, shown as the menu's header. */
  title: string;
}

/**
 * Right-click menu for a board card, mirroring the sidebar thread menu's
 * relevant actions. Left-click still opens the pane; modified clicks fall
 * through to the anchor's native href behavior. The anchor stops the
 * context-menu event's propagation so a nested card's menu cannot also open
 * its ancestor card's menu.
 */
export function ThreadCardMenu({ anchor, actions, onOpen, href, title }: ThreadCardMenuProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen({ x: event.clientX, y: event.clientY });
        }}
      >
        {anchor}
      </div>
      {open !== null ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setOpen(null);
            }}
            aria-hidden
          />
          <div
            role="menu"
            aria-label="Thread actions"
            className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 shadow-md"
            style={{
              left: open.x,
              top: open.y,
              maxHeight: 320,
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
            <div
              aria-hidden
              className="max-w-64 truncate px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground"
            >
              {title}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                onOpen();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <Icon name="MessageSquare" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              Open thread
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                const url = new URL(href, window.location.origin).toString();
                void navigator.clipboard.writeText(url).catch(() => {});
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <Icon name="Copy" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              Copy link to thread
            </button>
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  action.run();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent",
                  action.dividerAbove && "mt-1 border-t border-border pt-2",
                  action.danger && "text-destructive",
                )}
              >
                <Icon
                  name={action.icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                {action.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}