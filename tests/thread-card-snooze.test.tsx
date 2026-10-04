// @vitest-environment jsdom
// Snoozed cards: dim in place, chip the wake time, refuse drag. The snooze
// contract lives in lib/snooze.ts and the wiring in app.tsx; this file pins
// the card behavior the operator actually sees — a sleeping card stays where
// it is, says when it wakes, and cannot be dragged into a lane move its
// sleep is meant to skip.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const base = thread({ id: "thr_snoozed", displayTitle: "Sleeping thread", updatedAt: 1 });

function card(snoozeFor: ((id: string) => number | null) | undefined) {
  return render(
    <ThreadCard
      thread={base}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      snoozeFor={snoozeFor}
    />,
  );
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_snoozed"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

describe("a non-snoozed card", () => {
  it("renders nothing snooze-related and stays draggable", () => {
    card(() => null);
    const root = cardRoot();
    expect(root.hasAttribute("data-snoozed")).toBe(false);
    expect(document.querySelector("[data-snooze-chip]")).toBeNull();
    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("draggable")).toBe("true");
  });
});

describe("a snoozed card", () => {
  it("marks itself snoozed, dims, and shows the wake chip", () => {
    const now = new Date();
    now.setHours(14, 15, 0, 0); // today 2:15 PM local
    card(() => now.getTime());
    const root = cardRoot();
    expect(root.getAttribute("data-snoozed")).toBe("");
    const chip = document.querySelector("[data-snooze-chip]");
    expect(chip?.textContent).toContain("Snoozed · wakes");
    expect(chip?.textContent).toContain("today at 2:15 PM");
    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("draggable")).toBe("false");
  });

  it("refuses drag: a synthetic dragstart is prevented and writes no payload", () => {
    card(() => Date.now() + 60_000);
    const anchor = cardRoot().querySelector("a");
    if (!(anchor instanceof HTMLElement)) throw new Error("missing anchor");
    const dataTransfer = {
      types: [] as string[],
      setData(type: string) {
        this.types.push(type);
      },
      effectAllowed: "",
    };
    const event = createEvent.dragStart(anchor, { dataTransfer });
    fireEvent(anchor, event);
    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.types).toHaveLength(0);
  });
});

describe("a nested child row", () => {
  function renderWithChild(snoozeFor: (id: string) => number | null) {
    const child = thread({
      id: "thr_child",
      parentThreadId: "thr_snoozed",
      displayTitle: "Child task",
    });
    return render(
      <ThreadCard
        thread={thread({ id: "thr_snoozed" })}
        stateDot={null}
        isActive={false}
        isDone={false}
        projectName="Proj"
        menuActions={[]}
        onOpen={() => {}}
        onOpenThread={() => {}}
        childThreads={[child]}
        childMenuActions={() => []}
        snoozeFor={snoozeFor}
      />,
    );
  }

  it("shows the child's snooze marker only for the snoozed child", () => {
    renderWithChild((id) => (id === "thr_child" ? Date.now() + 60_000 : null));
    const row = document.querySelector('[data-thread-card="thr_child"]');
    if (!(row instanceof HTMLElement)) throw new Error("missing child row");
    expect(row.getAttribute("data-snoozed")).toBe("");
    expect(row.querySelector("[data-snooze-chip]")).not.toBeNull();
  });

  it("leaves a non-snoozed child alone", () => {
    renderWithChild(() => null);
    const row = document.querySelector('[data-thread-card="thr_child"]');
    if (!(row instanceof HTMLElement)) throw new Error("missing child row");
    expect(row.hasAttribute("data-snoozed")).toBe(false);
  });
});