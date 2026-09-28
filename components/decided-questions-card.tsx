import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  decisionsFromEvents,
  type DecisionRecord,
} from "@/lib/decisions";

/**
 * The host transcript drops every trace of an answered AskUserQuestion: the
 * tool call is suppressed, the delivered tool result is a hidden system
 * message, and the interaction row stores only `plugin_submitted` — no
 * answers. So once a pending question card is submitted, the pane (and the
 * main view) forgets what was decided.
 *
 * This card rebuilds the record from the one place the answers survive: the
 * raw event log. bb delivers each answer to the agent as a
 * `client/turn/requested` system event ("Your earlier AskUserQuestion tool
 * call has finished. Its result: …"); `parseDecisionEvent` extracts the
 * questions and answers from it. The card lists the most recent decisions,
 * collapsed by default, and auto-expands when a fresh answer lands — the
 * just-answered moment, the only trace the pane offers.
 */

/** How many decisions to keep on screen. */
const MAX_DECISIONS = 5;
/** Trailing debounce for thread:changed refetches; coalesces bursts. */
const REFETCH_DEBOUNCE_MS = 300;
/** Change kinds that can accompany a newly delivered answer. */
const REFETCH_CHANGES = new Set([
  "interactions-changed",
  "status-changed",
  "events-appended",
]);

/** The events area is newer than the SDK's bundled types; read it structurally. */
interface EventsArea {
  list?: (args: {
    threadId: string;
    types: string[];
    limit: string;
    order: string;
  }) => Promise<unknown[]>;
}

function formatDecisionTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

export function DecidedQuestionsCard({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const lastSeenRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    // Missing events area (harnesses, older hosts) — no card rather than a
    // broken pane.
    const list = (sdk.threads as unknown as { events?: EventsArea } | undefined)
      ?.events?.list;
    if (typeof list !== "function") {
      setDecisions([]);
      return;
    }
    try {
      const rows = await list({
        threadId,
        types: ["client/turn/requested"],
        limit: "50",
        order: "desc",
      });
      const parsed = decisionsFromEvents(rows, MAX_DECISIONS);
      setDecisions(parsed);
      const newest = parsed[0] ?? null;
      if (newest !== null) {
        // Expand only when a decision newer than the last seen one lands —
        // the just-answered moment. The initial fetch only seeds the marker.
        if (lastSeenRef.current !== null && newest.seq > lastSeenRef.current) {
          setExpanded(true);
        }
        lastSeenRef.current = newest.seq;
      }
    } catch {
      // Unknown/unavailable thread — no card rather than a broken pane.
      setDecisions([]);
    }
  }, [sdk, threadId]);

  useEffect(() => {
    setDecisions([]);
    setExpanded(false);
    lastSeenRef.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const unsubscribe = sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (event.entity !== "thread") return;
          if (event.id !== undefined && event.id !== threadId) return;
          if (!event.changes.some((change) => REFETCH_CHANGES.has(change))) return;
          // events-appended can be high-frequency agent streaming noise; only
          // react when the metadata says a turn was requested (which is what
          // a delivered answer looks like in the log).
          const eventTypes = event.metadata?.eventTypes;
          if (
            event.changes.every((change) => change === "events-appended") &&
            eventTypes !== undefined &&
            !eventTypes.includes("client/turn/requested")
          ) {
            return;
          }
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            void refresh();
          }, REFETCH_DEBOUNCE_MS);
        },
      });
      return unsubscribe;
    } catch {
      // Some embedded contexts (screenshot harness) have no subscribe; the
      // card still works from its initial fetch.
      return undefined;
    }
  }, [sdk, threadId, refresh]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  if (decisions.length === 0) return null;

  return (
    <section
      aria-label="Recent decisions"
      aria-expanded={expanded}
      data-testid="thread-board-decisions"
      onKeyDown={(event) => {
        // Escape collapses the banner first (like the pending card) and
        // keeps the pane open; the pane's own Escape handler honors
        // defaultPrevented.
        if (event.key === "Escape" && expanded && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
        }
      }}
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2 pl-3 pr-1.5">
        <button
          type="button"
          aria-controls="focus-board-decisions-body"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            name="ChevronDown"
            className={expanded ? "size-3.5 transition-transform duration-200 rotate-180" : "size-3.5 transition-transform duration-200"}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-controls="focus-board-decisions-body"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-7 min-w-0 flex-1 items-center rounded-md text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span
            className={
              expanded
                ? "min-w-0 whitespace-normal text-sm font-semibold text-foreground"
                : "min-w-0 truncate text-sm font-medium text-foreground"
            }
          >
            Recent decisions
          </span>
          <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
            {decisions.length}
          </span>
        </button>
      </div>
      {expanded ? (
        <div id="focus-board-decisions-body" className="pb-2">
          {decisions.map((decision) => (
            <div
              key={decision.seq}
              data-testid="thread-board-decision"
              className="space-y-1 border-t border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {decision.questions[0]?.header !== null &&
                decision.questions[0]?.header !== undefined ? (
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {decision.questions[0].header}
                  </span>
                ) : null}
                <time
                  dateTime={new Date(decision.createdAt).toISOString()}
                  className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                >
                  {formatDecisionTime(decision.createdAt)}
                </time>
              </div>
              {decision.questions.map((question) => (
                <div key={question.prompt} className="min-w-0">
                  <p className="text-xs leading-snug text-foreground">{question.prompt}</p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    {question.answer ?? "No answer"}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}