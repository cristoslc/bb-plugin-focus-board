// @vitest-environment jsdom
// The family card's nested child list grows with the family; past a handful
// of rows it must cap its height and scroll instead of stretching the card
// (and the whole lane) toward the sky. jsdom does no layout, so the tests
// pin the contract through the classes the cap is written with.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NESTED_ROWS_SCROLL_THRESHOLD, ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

const parent = thread({ id: "p", displayTitle: "Parent" });

function children(count: number) {
  return Array.from({ length: count }, (_, index) =>
    thread({ id: `c${index}`, parentThreadId: "p", displayTitle: `Child ${index}` }),
  );
}

function renderCard(rowCount: number) {
  render(
    <ThreadCard
      thread={parent}
      stateDot={null}
      isActive={false}
      isDone={false}
      childThreads={children(rowCount)}
      childCount={rowCount}
      onOpen={() => {}}
      onOpenThread={() => {}}
    />,
  );
}

function rowsContainer(): HTMLElement {
  const el = document.querySelector("[data-nested-rows]");
  if (!(el instanceof HTMLElement)) throw new Error("missing nested rows container");
  return el;
}

describe("the family card's nested child list", () => {
  afterEach(cleanup);

  it(`renders at natural height with ${NESTED_ROWS_SCROLL_THRESHOLD} rows or fewer`, () => {
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD);
    const container = rowsContainer();
    expect(container.className).not.toContain("overflow-y-auto");
    expect(container.className).not.toContain("max-h-");
  });

  it("caps and scrolls the list when the family has more rows than the threshold", () => {
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD + 1);
    const container = rowsContainer();
    expect(container.className).toContain("overflow-y-auto");
    expect(container.className).toContain("max-h-");
  });
});
