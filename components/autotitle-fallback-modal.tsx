import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AutotitleFallbackState } from "@/lib/autotitle";
import type { AutotitleTarget } from "@/lib/autotitle";

/**
 * The ✨ auto-rename fallback modal: when a generated rename fails, this
 * modal names the failure reason and offers the paths out of it — generate
 * with a different registered AI service (the ready ones clickable, the
 * not-ready ones disabled with their blocker named), the thread's active
 * chat model as an explicitly disabled row (bb exposes no plugin path to
 * it; refusing to fake it is the honest surface), or a plain typed rename.
 */
export function AutotitleFallbackModal({
  open,
  onOpenChange,
  message,
  load,
  onPick,
  onManualTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The failure reason the ✨ call rejected with. */
  message: string;
  /** The server's service menu (thread_autotitle_services); optional so the modal still names the failure when the menu itself is unreachable. */
  load?: () => Promise<AutotitleFallbackState>;
  /** Take an alternative service; the owner closes the modal and runs the generation. */
  onPick: (target: AutotitleTarget) => void;
  /** Commit the manually typed title. */
  onManualTitle: (title: string) => void;
}) {
  const [state, setState] = React.useState<
    { phase: "loading" } | { phase: "ready"; data: AutotitleFallbackState } | { phase: "failed"; message: string }
  >({ phase: "loading" });
  const [manual, setManual] = React.useState("");

  // Reload the service menu each time the modal opens: readiness and the
  // selection both move while the board is up, so a cached list would lie.
  React.useEffect(() => {
    if (!open) return;
    setState({ phase: "loading" });
    setManual("");
    if (load === undefined) {
      // No loader wired: the service menu is unreachable data, so the
      // thread-model row renders disabled with that named, and the manual
      // rename stays available.
      setState({
        phase: "ready",
        data: {
          selected: null,
          services: [],
          threadModel: {
            available: false,
            reason: "the services menu did not load (no loader wired)",
          },
        },
      });
      return;
    }
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  const alternatives =
    state.phase === "ready"
      ? state.data.services.filter(
          (service) =>
            state.data.selected === null ||
            service.pluginId !== state.data.selected.pluginId ||
            service.serviceId !== state.data.selected.serviceId,
        )
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Auto-rename failed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        {state.phase === "loading" ? (
          <p className="text-sm text-muted-foreground">
            Loading the registered AI services…
          </p>
        ) : state.phase === "failed" ? (
          <p className="text-sm text-muted-foreground">
            Could not list the registered AI services: {state.message}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                Generate with another AI service
              </p>
              <ul className="mt-1 space-y-1">
                {alternatives.map((service) => (
                  <li key={`${service.pluginId}/${service.serviceId}`}>
                    <button
                      type="button"
                      disabled={!service.ready}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick({
                          pluginId: service.pluginId,
                          serviceId: service.serviceId,
                        });
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>
                        {service.displayName}
                        {!service.ready && service.message !== null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {service.message}
                          </span>
                        ) : null}
                      </span>
                      {service.ready ? (
                        <span aria-hidden>✨</span>
                      ) : (
                        <span aria-hidden>—</span>
                      )}
                    </button>
                  </li>
                ))}
                {alternatives.length === 0 ? (
                  <li className="text-muted-foreground">
                    No other AI services are registered in bb.
                  </li>
                ) : null}
              </ul>
            </div>
            <div>
              <button
                type="button"
                disabled={!state.data.threadModel.available}
                aria-label="Use the thread's active model"
                onClick={(event) => {
                  event.stopPropagation();
                  onPick({ useThreadModel: true });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>The thread&apos;s active model</span>
                <span aria-hidden>{state.data.threadModel.available ? "✨" : "—"}</span>
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.data.threadModel.available
                  ? "Generates in a hidden probe thread using this thread's provider and model; the probe is deleted when done."
                  : `The thread's model is unavailable: ${state.data.threadModel.reason ?? "no reason given"}. bb plugins cannot invoke a thread's chat model directly — the probe path needs a resolved provider/model and a project to spawn in.`}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <input
            type="text"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            aria-label="Manual title"
            placeholder="Type a title…"
            className="min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            type="button"
            size="sm"
            disabled={manual.trim() === ""}
            onClick={(event) => {
              event.stopPropagation();
              onManualTitle(manual.trim());
            }}
          >
            Use this title
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}