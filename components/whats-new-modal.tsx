import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { APP_VERSION, type WhatsNewEntry } from "@/lib/whats-new";

/**
 * The "What's new" modal behind the toolbar's gift button. Lists the
 * condensed changelog entries — either the delta since the stored last-seen
 * version (after an update) or every recent entry (opened unprompted from
 * the quiet button). Each item is a bullet's condensed lead sentence, with a
 * grouped bullet's related sub-bullets nested underneath it. Opening marks
 * the version seen; the button stays.
 */
export function WhatsNewModal({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly WhatsNewEntry[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>What&apos;s new in Focus Board</DialogTitle>
          <DialogDescription>
            {entries.length === 0
              ? `You are on version ${APP_VERSION}.`
              : "Recent changes since you last looked."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] min-h-0 overflow-y-auto">
          {entries.map((entry) => (
            <section key={entry.version} className="mb-3 last:mb-0">
              <h3 className="mb-1 text-xs font-semibold text-foreground">
                {entry.unreleased ? `Unreleased ${entry.version}` : `Version ${entry.version}`}
              </h3>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {entry.items.map((item) => (
                  <li key={item.lead}>
                    {item.lead}
                    {item.children && item.children.length > 0 && (
                      <ul className="list-disc mt-1 space-y-1 pl-4">
                        {item.children.map((child) => (
                          <li key={child}>{child}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}