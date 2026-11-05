import { useEffect, useState, type RefObject } from "react";
import { Icon } from "@/components/ui/icon";
import type { PaneContextInfo } from "@/lib/pane-context";
import { cn } from "@/lib/utils";

// Why this exists: bb's own thread page passes both an `environmentSummary`
// and a `compactEnvironmentSummary` to its promptbox, and on a narrow
// container the promptbox renders only the compact one. The embedded
// `ThreadChat` the SDK hands plugin panels receives no
// `compactEnvironmentSummary`, and bb 0.48.1 (re-verified 2026-11-04 live,
// pane-parity audit Gap 10; scripts/screenshot/repro-context-row-0-48-1.mjs)
// still paints none of the context at rest in a pane, in a changed shape:
// the desktop footer is mounted but collapsed to height 0 (the chips stay
// mounted and their rects keep measuring, exactly the 0.46.1 trap), and a
// touch pane's footer is unmounted outright. Presence proves nothing; the
// probe therefore follows the paint: a matched chip counts only when no
// ancestor displays it away or clips its box out of view. The 0.46.x
// details live in docs/composer-context-collapse-2026-10-16.md.

function rectOf(el: Element): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

const ANCESTOR_WALK_CAP = 6;

/**
 * Does the paint reach the eye? An element is paintable when no ancestor
 * (up to six hops — the footer/composer/chat wrappers are all within that)
 * hides it by display, visibility, full opacity fade, or overflow clipping:
 * the collapsed composer footer keeps its chips mounted with measurable
 * rects at height 0, so the rects alone mislead and the clip boxes decide.
 */
function paintable(element: Element): boolean {
  const rect = rectOf(element);
  let current: HTMLElement | null =
    element.parentElement instanceof HTMLElement
      ? (element.parentElement as HTMLElement)
      : null;
  for (let i = 0; i < ANCESTOR_WALK_CAP && current !== null; i += 1) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity !== "" && Number(style.opacity) === 0) return false;
    const clipsY = style.overflowY !== "" && style.overflowY !== "visible";
    const clipsX = style.overflowX !== "" && style.overflowX !== "visible";
    if (clipsY || clipsX) {
      const clip = rectOf(current);
      const escapesVertically =
        rect.y < clip.y - 0.5 || rect.y + rect.height > clip.y + clip.height + 0.5;
      const escapesHorizontally =
        rect.x < clip.x - 0.5 || rect.x + rect.width > clip.x + clip.width + 0.5;
      if ((clipsY && escapesVertically) || (clipsX && escapesHorizontally)) {
        return false;
      }
    }
    current =
      current.parentElement instanceof HTMLElement
        ? (current.parentElement as HTMLElement)
        : null;
  }
  return true;
}

/**
 * Does the host's `ThreadChat` actually PAINT a composer-context element
 * (project chip, environment chip, checkout chip, or the compact
 * "Thread details …" button) inside this DOM root? Probes the exact
 * signatures bb 0.46.1's promptbox bundle emits: `[data-option-display]`
 * chips whose sr-only label reads "Project: " / "Environment: " (the same
 * markup the model and provider pickers use, so foreign chips must not
 * match), the full row's `[data-promptbox-hide-branch-compact]` checkout
 * chip, and the compact `Thread details: …` button — then requires the
 * paint to reach the eye, because the collapsed footer keeps everything
 * mounted at height 0 while nothing is visible.
 *
 * Signatures drift silently on bb upgrades — if this ever reads stale, the
 * pane falls back to a duplicate-free guess: the row shows a second context
 * line under the host's own, cheap to notice, never a missing-context
 * regression.
 */
export function composerContextVisible(root: HTMLElement | null): boolean {
  if (root === null) return false;
  const candidates: Element[] = [];
  const details = root.querySelector(`button[aria-label^="Thread details:"]`);
  if (details !== null) candidates.push(details);
  for (const chip of Array.from(root.querySelectorAll("[data-promptbox-hide-branch-compact]"))) {
    candidates.push(chip);
  }
  for (const chip of Array.from(root.querySelectorAll("[data-option-display]"))) {
    const text = (chip.textContent ?? "").trim();
    if (text.startsWith("Project:") || text.startsWith("Environment:")) {
      candidates.push(chip);
    }
  }
  return candidates.some((candidate) => paintable(candidate));
}

/** How long the chat DOM must stay quiet before a probe counts. ThreadChat
 *  resolves its environment and project queries asynchronously, so an
 *  immediate probe after mount would see nothing and flash the fallback
 *  before the host row lands; and bb's footer collapse/expand is a 180ms
 *  CSS transition, so the settle must outlast it before the paint walk
 *  reads the settled geometry. */
const PROBE_SETTLE_MS = 300;

/**
 * True when the given chat root has settled without the host's composer
 * context showing. The root is observed for mutations AND attribute flips
 * (bb's collapse is an attribute toggle plus a transition — no node mounts
 * or unmounts — so a childList-only observer would miss it forever), and
 * each burst of activity schedules one probe after the settle window.
 */
export function usePaneContextRowMissing(
  chatRootRef: RefObject<HTMLElement | null>,
  threadId: string,
): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const root = chatRootRef.current;
    setMissing(false);
    if (root === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probe = () => {
      timer = null;
      setMissing(!composerContextVisible(root));
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(probe, PROBE_SETTLE_MS);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    // The mount itself may paint the composer once and go quiet; the
    // settle probe still runs even with zero later mutations.
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [chatRootRef, threadId]);
  return missing;
}

/**
 * The pane's fallback composer-context line: project, then the checkout's
 * branch, else the environment's plain name — the same order of importance
 * bb's compact chip uses.
 */
export function PaneContextRow({ info }: { info: PaneContextInfo }) {
  const describe = info.branchLabel ?? info.environmentLabel;
  return (
    <div
      data-testid="pane-context-row"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5 border-t border-border/50",
        "px-3 py-1.5 text-xs text-muted-foreground",
      )}
      title={`${info.projectLabel}${describe === null ? "" : ` · ${describe}`}`}
    >
      <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{info.projectLabel}</span>
      {describe !== null ? (
        <>
          {info.branchLabel !== null ? (
            <Icon name="GitBranch" className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <span aria-hidden>·</span>
          )}
          <span className="min-w-0 truncate">{describe}</span>
        </>
      ) : null}
    </div>
  );
}