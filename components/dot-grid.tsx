import type { ThreadState } from "./grouping";
import { attentionPulseRef } from "./attention-pulse-gate";
import { dotPulseStyle } from "./dot-pulse";
import { cn } from "../lib/utils";

// The dot-grid vocabulary the two "several threads behind one control"
// surfaces share (issue #321): a thread card's collapsed child strip
// (components/thread-card.tsx) and the folded feature-group card
// (components/board.tsx's `renderCollapsedBoxRun`). Sharing the state colours
// and the generation sizes is what makes the two surfaces read as one system
// instead of two strips that happen to look alike; each surface keeps its own
// controls around the glyph, because the parent strip's dot owns a hover
// preview portal and a drag lifecycle while the folded box's dot is a plain
// open-the-thread button.

/** One colour per state, the state language both strips paint. */
export const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

/**
 * The generation ladder: a leading member dot, its children one size step
 * down, its children's children at the smallest tier.
 *
 * CLIP RULE (a fourth generation never happens, and must not invent a fifth
 * size): the walk reads the board's display map, and `buildFamilyIndex`
 * (components/nesting.ts) caps every display chain at two row tiers, so a
 * member deeper than that has already been re-attached to its family root and
 * arrives in the middle tier. Anything that raises that cap has to extend
 * this ladder in the same change, or descendants will pile onto the smallest
 * tier.
 */
export const DOT_GENERATION_CLASS = ["size-1.5", "size-1", "size-0.5"] as const;

/** The generation names, in ladder order, for a surface's own data markers. */
export const DOT_GENERATION_NAMES = ["member", "child", "grandchild"] as const;

export type DotGeneration = 0 | 1 | 2;

/**
 * The cluster capsule (issue #282, option D of the 2026-10-16 musing): the
 * faint surface that binds a leading dot to the dots under it, so a family's
 * boundary is visible without hover. Both dot surfaces paint it from this one
 * string — the parent card's collapsed strip and the folded group card's grid
 * — so a capsule means the same thing wherever it appears.
 *
 * It carries the surface only (tint, radius, padding): each surface keeps its
 * own inside gap, one tier tighter on the folded card. A cluster of one dot
 * gets no capsule at all, because there is no boundary to draw; the strip's
 * lone dots stay exactly what they were. The tint is deliberately near the
 * floor (`bg-muted/50`) and the capsule's only hover state is a slightly
 * deeper tint: hovering a capsule lights the strip's own wash, which would
 * otherwise wash the boundary away exactly while the pointer is reading it,
 * and deepening the tint keeps the cluster legible under that wash without
 * making the pill read as a button (the dots inside stay the controls).
 */
export const DOT_CLUSTER_CAPSULE_CLASS =
  "rounded-full bg-muted/50 px-1 py-px transition-colors hover:bg-muted/70";

export interface DotGlyphProps {
  state: ThreadState;
  /** A size class from `DOT_GENERATION_CLASS`. */
  size: string;
  /**
   * The measured rate period for a working dot (issue #279): the glyph
   * breathes at that period. Null when the state does not pulse.
   */
  pulsePeriod: number | null;
  /**
   * The calling surface's own marker attributes, spread onto the span — the
   * dot markers its tests and gestures read it by.
   */
  markers: Record<string, string>;
  /** The hover preview line: the thread's title and its state label. */
  title?: string;
  className?: string;
}

/**
 * One dot: a state-coloured, generation-sized span. Both the rate pulse and
 * the attention animation ride the visible-only gate
 * (components/attention-pulse-gate), so an off-screen dot holds still instead
 * of burning the compositor. The glyph is decorative: the control around it
 * carries the accessible name.
 */
export function DotGlyph({
  state,
  size,
  pulsePeriod,
  markers,
  title,
  className,
}: DotGlyphProps) {
  const animated = state === "attention" || pulsePeriod !== null;
  return (
    <span
      ref={animated ? attentionPulseRef : undefined}
      aria-hidden
      {...markers}
      data-dot-pulse={pulsePeriod === null ? undefined : String(pulsePeriod)}
      style={pulsePeriod === null ? undefined : dotPulseStyle(pulsePeriod)}
      title={title}
      className={cn(
        size,
        "rounded-full",
        DOT_CLASS[state] ?? "bg-muted-foreground/30",
        state === "attention" && "motion-safe:animate-pulse",
        className,
      )}
    />
  );
}
