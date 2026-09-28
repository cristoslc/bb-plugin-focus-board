// @vitest-environment jsdom
// Right-click menus on board cards: a nested child row must get its OWN menu
// (the right-click must not bubble up to the parent card's menu wrapper), and
// every menu must name the thread it acts on. The wiring lives in
// components/thread-card.tsx and components/thread-card-menu.tsx; this file
// pins the DOM behavior, which is where the parent/child confusion was.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const parent = thread({
  id: "thr_parent",
  displayTitle: "Parent epic title",
  href: "/projects/p/threads/parent",
});
const child = thread({
  id: "thr_child",
  parentThreadId: "thr_parent",
  displayTitle: "Child task title",
  href: "/projects/p/threads/child",
});

function renderCard() {
  return render(
    <ThreadCard
      thread={parent}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[{ id: "parent-act", label: "Parent action", icon: "Pin", run: () => {} }]}
      childThreads={[child]}
      onOpen={() => {}}
      onOpenThread={() => {}}
      childMenuActions={(t) => [
        { id: `child-act-${t.id}`, label: "Child action", icon: "Pin", run: () => {} },
      ]}
    />,
  );
}

const menus = () => screen.queryAllByRole("menu");

describe("right-click on a nested child row", () => {
  it("opens exactly one menu — the child's, not the parent's", () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Child task title"));
    const open = menus();
    expect(open).toHaveLength(1);
    const menuText = open[0].textContent ?? "";
    expect(menuText).toContain("Child action");
    expect(menuText).not.toContain("Parent action");
  });

  it("names the child thread in the menu", () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Child task title"));
    expect(within(menus()[0]).getByText("Child task title")).toBeTruthy();
  });
});

describe("right-click on the parent card", () => {
  it("opens the parent's menu, naming the parent thread", () => {
    renderCard();
    fireEvent.contextMenu(screen.getByText("Parent epic title"));
    const open = menus();
    expect(open).toHaveLength(1);
    const menuText = open[0].textContent ?? "";
    expect(menuText).toContain("Parent action");
    expect(menuText).toContain("Parent epic title");
  });
});