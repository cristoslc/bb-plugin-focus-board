// @vitest-environment jsdom
// The board's "/" shortcut: with the board's own pane focused and no in-board
// pane open, "/" moves focus to the toolbar search field. It stays inert while
// a pane is open, while another pane holds host focus, while the user is
// typing in an editable target (inputs and rich-text editors), in another
// pane's surface, inside a dialog, and under modifier chords that carry their
// own platform meanings. The ownership rules live in
// lib/shortcut-ownership.ts, shared with the New Thread key
// (tests/new-thread-shortcut.test.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { useSearchFocusOnSlash } from "../hooks/use-search-focus";
import { BoardToolbar } from "../components/board-toolbar";

/** Scratch DOM the tests append to document.body; removed per test so one
 *  case's surface never owns the next one's keys. */
const scratch: HTMLElement[] = [];

afterEach(() => {
  cleanup();
  for (const node of scratch.splice(0)) node.remove();
});

function mount(element: HTMLElement): HTMLElement {
  document.body.appendChild(element);
  scratch.push(element);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

/** The layout shape the host reports (threadId is null for a plugin panel). */
type PaneLayout = {
  panes: { paneId: string; threadId: string | null; isFocused: boolean }[];
};

function splitLayout(focusedPaneId: string): PaneLayout {
  return {
    panes: [
      { paneId: "pane-1", threadId: null, isFocused: focusedPaneId === "pane-1" },
      {
        paneId: "pane-2",
        threadId: "thr_other",
        isFocused: focusedPaneId === "pane-2",
      },
    ],
  };
}

/** The board's panel root inside the host's pane container for it. */
function boardPane(paneId = "pane-1"): HTMLElement {
  const container = mount(element("div", { "data-split-pane-id": paneId }));
  return element("div", { "data-focus-board-panel": "" }, container);
}

function Harness({
  enabled,
  searchInputRef,
  panel = null,
  layout = null,
}: {
  enabled: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  panel?: Element | null;
  layout?: PaneLayout | null;
}) {
  const panelRef = useRef<Element | null>(panel);
  panelRef.current = panel;
  const splitLayoutRef = useRef<PaneLayout | null>(layout);
  splitLayoutRef.current = layout;
  useSearchFocusOnSlash({ enabled, searchInputRef, panelRef, splitLayoutRef });
  return <input ref={searchInputRef} aria-label="Search threads" />;
}

function pressSlash(target?: HTMLElement, init?: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "/",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

function searchRef(): RefObject<HTMLInputElement | null> {
  return { current: null } as RefObject<HTMLInputElement | null>;
}

type HarnessRender = ReturnType<typeof render>;

/** The board focused in a split, its panel mounted in pane-1. */
function harnessWithSearch(
  enabled: boolean,
  options: { panel?: Element | null; layout?: PaneLayout | null } = {},
): { utils: HarnessRender; searchInput: HTMLInputElement; panel: HTMLElement } {
  const panel = options.panel === undefined ? boardPane() : options.panel;
  const layout =
    options.layout === undefined ? splitLayout("pane-1") : options.layout;
  const utils = render(
    <Harness
      enabled={enabled}
      searchInputRef={searchRef()}
      panel={panel}
      layout={layout}
    />,
  );
  const searchInput = utils.getByLabelText("Search threads");
  return { utils, searchInput, panel: panel as HTMLElement };
}

describe("useSearchFocusOnSlash", () => {
  it("with the board's pane focused, '/' focuses the search field and claims the event", () => {
    const { searchInput } = harnessWithSearch(true);
    const event = pressSlash();
    expect(document.activeElement).toBe(searchInput);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a single-pane layout (no split reported) is the board's own pane", () => {
    const { searchInput } = harnessWithSearch(true, { layout: null });
    const event = pressSlash();
    expect(document.activeElement).toBe(searchInput);
    expect(event.defaultPrevented).toBe(true);
  });

  it("with the in-board pane open (enabled false), '/' does nothing", () => {
    const { searchInput } = harnessWithSearch(false);
    const event = pressSlash();
    expect(document.activeElement).not.toBe(searchInput);
    expect(event.defaultPrevented).toBe(false);
  });

  it("with a thread pane focused beside the board, '/' does nothing", () => {
    const { searchInput } = harnessWithSearch(true, {
      layout: splitLayout("pane-2"),
    });
    const event = pressSlash();
    expect(document.activeElement).not.toBe(searchInput);
    expect(event.defaultPrevented).toBe(false);
  });

  it("a board panel the host does not name as a pane stays out of a split layout", () => {
    const panelOutsidePanes = mount(
      element("div", { "data-focus-board-panel": "" }),
    );
    const { searchInput } = harnessWithSearch(true, {
      panel: panelOutsidePanes,
      layout: splitLayout("pane-1"),
    });
    const event = pressSlash();
    expect(document.activeElement).not.toBe(searchInput);
    expect(event.defaultPrevented).toBe(false);
  });

  it("a '/' typed inside an editable target stays text input", () => {
    const { searchInput } = harnessWithSearch(true);
    const target = mount(element("input", { placeholder: "type here" }));
    const event = pressSlash(target);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("a '/' typed inside a rich-text editor stays text input", () => {
    const { searchInput, panel } = harnessWithSearch(true);
    const editor = element("div", { contenteditable: "true" }, panel);
    const event = pressSlash(editor);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("a '/' pressed in a pane that is not the board's does not jump to search", () => {
    // The sibling hole the letter had: a document listener hears the other
    // pane's keystrokes, and focusing the board's search field from there
    // yanks the caret out of what the operator is working on.
    const { searchInput } = harnessWithSearch(true);
    const pane = mount(element("div", { "data-testid": "foreign-pane" }));
    const event = pressSlash(element("div", {}, pane));
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("a '/' on the board's own surface still focuses search", () => {
    const { searchInput, panel } = harnessWithSearch(true);
    const event = pressSlash(element("div", {}, panel));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(searchInput);
  });

  it("a '/' pressed inside an open dialog does not jump to search", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    const { searchInput } = harnessWithSearch(true);
    button.focus();
    const event = pressSlash(button);
    expect(document.activeElement).not.toBe(searchInput);
    expect(event.defaultPrevented).toBe(false);
  });

  it("modifier chords leave '/' to its platform meaning", () => {
    for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const { searchInput } = harnessWithSearch(true);
      const event = pressSlash(undefined, extra);
      expect(document.activeElement).not.toBe(searchInput);
      expect(event.defaultPrevented).toBe(false);
      cleanup();
    }
  });

  it("an already-handled '/' (defaultPrevented upstream) is not re-claimed", () => {
    const { searchInput } = harnessWithSearch(true);
    // A capture-phase listener upstream already claimed the gesture; the
    // hook must honor that instead of also jumping to search.
    const capture = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", capture, { capture: true });
    const event = pressSlash();
    document.removeEventListener("keydown", capture, { capture: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("keys other than '/' do nothing", () => {
    const { searchInput } = harnessWithSearch(true);
    const event = new KeyboardEvent("keydown", {
      key: "?",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });
});

describe("BoardToolbar search ref wiring", () => {
  it("the board's search field registers through the provided ref", () => {
    const searchInputRef = searchRef();
    const filter = { projects: new Set(), providers: new Set(), states: new Set() };
    render(
      <BoardToolbar
        groupBy="state"
        onGroupByChange={() => {}}
        laneDirection="vertical"
        onLaneDirectionChange={() => {}}
        nestChildren
        onNestChildrenChange={() => {}}
        filter={filter as never}
        onFilterChange={() => {}}
        search=""
        onSearchChange={() => {}}
        projectIds={new Set()}
        providerIds={new Set()}
        projects={[]}
        providers={[]}
        onCreateProject={async () => {}}
        totalCount={0}
        onClearFilters={() => {}}
        anyFilterActive={false}
        onNewThread={() => {}}
        whatsNewUnseen={false}
        onOpenWhatsNew={() => {}}
        searchInputRef={searchInputRef}
        wallpaper={{ version: 1, global: null }}
        onWallpaperChange={() => {}}
      />,
    );
    const input = document.querySelector(
      'input[aria-label="Search threads"]',
    ) as HTMLInputElement;
    expect(searchInputRef.current).toBe(input);
  });
});
