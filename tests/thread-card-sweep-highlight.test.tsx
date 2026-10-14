// @vitest-environment jsdom
// Sweep-selection highlight legibility. The highlight once applied its amber
// wash as a card-level background (`bg-amber-500/10`), which tailwind-merge
// resolved against the card's own `bg-card` — the translucent amber WON, the
// opaque surface was dropped, and every selected card faded toward
// transparent while it sat selected (the lane/wallpaper bled through). A
// selected card is the most-read card on the board: it keeps the opaque
// surface and takes its amber wash from an overlay, the same pattern the
// wallpaper under-scrim and the attention pulse already use.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ThreadCard } from "../components/thread-card";
import { WallpaperActiveProvider } from "../components/wallpaper-contrast";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_sel", displayTitle: "Selected card", updatedAt: 1 });

type Props = Partial<ComponentProps<typeof ThreadCard>>;

function renderCard(props: Props = {}, wallpaperActive = false) {
  const ui = (
    <ThreadCard
      thread={base}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      {...props}
    />
  );
  return render(
    wallpaperActive ? (
      <WallpaperActiveProvider active={true}>{ui}</WallpaperActiveProvider>
    ) : (
      ui
    ),
  );
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_sel"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

function tokens(): string[] {
  return cardRoot().className.split(" ");
}

function tint(): Element | null {
  return cardRoot().querySelector("[data-sweep-tint]");
}

afterEach(cleanup);

describe("the sweep-selection highlight keeps the card opaque", () => {
  it("a highlighted card keeps its opaque card surface (no translucent card bg)", () => {
    renderCard({ isSweepHighlighted: true });
    expect(tokens()).toContain("bg-card");
    expect(tokens()).not.toContain("bg-amber-500/10");
    expect(tint()).not.toBeNull();
  });

  it("an un-highlighted card has no tint overlay", () => {
    renderCard({});
    expect(tint()).toBeNull();
  });

  it("a DONE highlighted card skips its under-scrim; the tint carries the wash", () => {
    renderCard({ isDone: true, isSweepHighlighted: true }, true);
    // Highlighted means read, so the wallpaper fade never runs (existing rule).
    const scrim = cardRoot().querySelector("[data-card-dim-scrim]");
    expect(scrim).toBeNull();
    expect(tokens()).not.toContain("opacity-50");
    expect(tint()).not.toBeNull();
  });
});