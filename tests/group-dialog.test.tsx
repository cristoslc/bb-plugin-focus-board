// @vitest-environment jsdom
// The group picker gains per-group management rows: every group carries a
// rename edit and a two-step delete right beside the one-click pick. The
// picker was read-only-over-the-registry before (create/remove only); these
// suites pin the new affordances before the dialog grows them. The later
// suites pin the picker's scale answers: names sort alphabetically for
// display only, a filter field narrows the list, and the list scrolls inside
// a bounded pane instead of growing the dialog past the viewport.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GroupDialog } from "../components/group-dialog";

afterEach(cleanup);

const GROUPS = [
  { id: "grp_1", name: "Auth rework" },
  { id: "grp_2", name: "Search v2" },
];

/** Registry order (creation order) that is not alphabetical in any case. */
const UNSORTED = [
  { id: "grp_s", name: "search v2" },
  { id: "grp_z", name: "Zebra" },
  { id: "grp_a", name: "Auth rework" },
  { id: "grp_b", name: "beta" },
  { id: "grp_A", name: "auth rework" },
];

function renderDialog(overrides: Partial<Parameters<typeof GroupDialog>[0]> = {}) {
  const handlers = {
    onPick: vi.fn(),
    onCreate: vi.fn(),
    onRemove: vi.fn(),
    onCancel: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <GroupDialog
      threadTitle="Test thread"
      groups={GROUPS}
      currentGroupId="grp_1"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

/** The rendered row ids, top to bottom — the display order the operator sees. */
function renderedRowIds(): string[] {
  return [...document.querySelectorAll("[data-group-list] [data-group-row]")].map(
    (row) => row.getAttribute("data-group-row") ?? "",
  );
}

function filterField(): HTMLInputElement {
  return document.querySelector("[data-group-filter-input]") as HTMLInputElement;
}


describe("group picker: rename affordance", () => {
  it("every group row hosts a rename control", () => {
    renderDialog();
    for (const group of GROUPS) {
      expect(document.querySelector(`[data-group-rename="${group.id}"]`)).not.toBeNull();
    }
  });

  it("clicking rename swaps the row into a prefilled inline edit", () => {
    renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_2"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_2"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Search v2");
  });

  it("Enter (or the confirm control) commits the trimmed name", () => {
    const { onRename } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Auth v2  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("grp_1", "Auth v2");
  });

  it("a blank name cannot commit and Escape cancels", () => {
    const { onRename } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
  });
});

describe("group picker: delete affordance", () => {
  it("every group row hosts a delete control; the first click only arms a confirm", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_1"]') as HTMLButtonElement);
    expect(onDelete).not.toHaveBeenCalled();
    // Armed state is visible: a confirm control for THIS group exists.
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
  });

  it("Keep backs out without deleting", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_2"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Keep group" }));
    expect(onDelete).not.toHaveBeenCalled();
    // Back to the plain row.
    expect(document.querySelector('[data-group-delete="grp_2"]')).not.toBeNull();
  });

  it("Confirm delete reports the groupId", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_1"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("grp_1");
  });
});

describe("group picker: display order", () => {
  it("renders the rows alphabetically whatever order the registry sent", () => {
    renderDialog({ groups: UNSORTED });
    // Case-insensitive: "Auth rework" leads and "Zebra" trails although the
    // registry holds them third-last and second. Equal names fall to the id
    // tiebreak, so the display order never depends on creation order.
    expect(renderedRowIds()).toEqual(["grp_A", "grp_a", "grp_b", "grp_s", "grp_z"]);
  });

  it("takes the row order from the names, not from the ids", () => {
    renderDialog({
      groups: [
        { id: "grp_1", name: "Zulu" },
        { id: "grp_2", name: "alpha" },
      ],
    });
    expect(renderedRowIds()).toEqual(["grp_2", "grp_1"]);
  });
});

describe("group picker: filter field", () => {
  it("narrows the list to substring matches, case-insensitively", () => {
    renderDialog({ groups: UNSORTED });
    fireEvent.change(filterField(), { target: { value: "SEARCH" } });
    expect(renderedRowIds()).toEqual(["grp_s"]);
    // A substring, not a prefix: "uth re" sits mid-name.
    fireEvent.change(filterField(), { target: { value: "uth re" } });
    expect(renderedRowIds()).toEqual(["grp_A", "grp_a"]);
  });

  it("ignores surrounding whitespace and restores every row on a blank query", () => {
    renderDialog({ groups: UNSORTED });
    fireEvent.change(filterField(), { target: { value: "   zeb   " } });
    expect(renderedRowIds()).toEqual(["grp_z"]);
    fireEvent.change(filterField(), { target: { value: "" } });
    expect(renderedRowIds()).toHaveLength(UNSORTED.length);
  });

  it("says the filter missed, distinctly from an empty registry", () => {
    renderDialog({ groups: UNSORTED });
    fireEvent.change(filterField(), { target: { value: "no such group" } });
    expect(renderedRowIds()).toEqual([]);
    const empty = document.querySelector("[data-group-filter-empty]");
    expect(empty?.textContent).toContain("No group matches “no such group”");
    expect(document.querySelector("[data-group-list-empty]")).toBeNull();
  });

  it("keeps an empty registry on the no-groups message and hides the field", () => {
    renderDialog({ groups: [] });
    expect(filterField()).toBeNull();
    expect(document.querySelector("[data-group-list-empty]")?.textContent).toBe("No groups yet.");
    expect(document.querySelector("[data-group-filter-empty]")).toBeNull();
  });

  it("keeps the assigned group's current marker reachable through the filter", () => {
    renderDialog({ groups: UNSORTED, currentGroupId: "grp_b" });
    fireEvent.change(filterField(), { target: { value: "beta" } });
    expect(renderedRowIds()).toEqual(["grp_b"]);
    const row = document.querySelector('[data-group-row="grp_b"]');
    expect(row?.textContent).toContain("current");
  });

  it("Clear restores the full list", () => {
    renderDialog({ groups: UNSORTED });
    fireEvent.change(filterField(), { target: { value: "zeb" } });
    fireEvent.click(document.querySelector("[data-group-filter-clear]") as HTMLButtonElement);
    expect(filterField().value).toBe("");
    expect(renderedRowIds()).toHaveLength(UNSORTED.length);
  });

  it("the filter field and the new-group field are two different inputs", () => {
    const { onCreate } = renderDialog();
    fireEvent.change(filterField(), { target: { value: "auth" } });
    // Typing a filter never seeds the create field, so Create & assign stays
    // disabled until the operator types a name of their own.
    const create = document.querySelector("[data-group-create]") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const nameField = document.querySelector("[data-group-name-input]") as HTMLInputElement;
    expect(nameField.value).toBe("");
    expect(screen.getByLabelText("Filter groups")).toBe(filterField());
    expect(screen.getByLabelText("New group name")).toBe(nameField);
    fireEvent.change(nameField, { target: { value: "Fresh group" } });
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith("Fresh group");
  });

  it("a filter change closes the rename editor whose row it hides", () => {
    const { onRename } = renderDialog({ groups: UNSORTED });
    fireEvent.click(document.querySelector('[data-group-rename="grp_z"]') as HTMLButtonElement);
    expect(document.querySelector('[data-group-rename-input="grp_z"]')).not.toBeNull();
    fireEvent.change(filterField(), { target: { value: "auth" } });
    expect(document.querySelector('[data-group-rename-input="grp_z"]')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("a filter change drops an armed delete the operator can no longer see", () => {
    const { onDelete } = renderDialog({ groups: UNSORTED });
    fireEvent.click(document.querySelector('[data-group-delete="grp_z"]') as HTMLButtonElement);
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
    fireEvent.change(filterField(), { target: { value: "auth" } });
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Escape keeps its meaning in this dialog: it dismisses the picker", () => {
    const { onCancel } = renderDialog({ groups: UNSORTED });
    fireEvent.change(filterField(), { target: { value: "zeb" } });
    fireEvent.keyDown(filterField(), { key: "Escape" });
    // The filter is not cleared first, which keeps this field consistent with
    // every other Escape in the picker (the rename editor included).
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("group picker: bounded list pane", () => {
  it("scrolls a capped list inside the dialog instead of growing it", () => {
    renderDialog({ groups: UNSORTED });
    const list = document.querySelector("[data-group-list]") as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toMatch(/max-h-\[/);
    // Every row lives inside the scrolling pane, so the search field, the
    // new-group field, and the footer sit outside it and stay put.
    expect(list.querySelectorAll("[data-group-row]")).toHaveLength(UNSORTED.length);
    expect(list.contains(filterField())).toBe(false);
    expect(list.contains(document.querySelector("[data-group-name-input]"))).toBe(false);
  });
});
describe("group picker: a refused write stays in the picker", () => {
  const TAKEN = 'group name "Auth rework" is already taken by group grp_1';

  it("keeps the rename editor open with the reason and the typed value", async () => {
    renderDialog({ onRename: vi.fn(() => Promise.reject(new Error(TAKEN))) });
    fireEvent.click(document.querySelector('[data-group-rename="grp_2"]') as HTMLButtonElement);
    fireEvent.change(document.querySelector('[data-group-rename-input="grp_2"]') as HTMLInputElement, {
      target: { value: "Auth rework" },
    });
    fireEvent.click(document.querySelector('[data-group-rename-confirm="grp_2"]') as HTMLButtonElement);
    const error = await waitFor(() => {
      const el = document.querySelector("[data-group-rename-error]");
      if (el === null) throw new Error("refusal not rendered yet");
      return el as HTMLElement;
    });
    // The picker renders the registry's own words rather than inventing a
    // verdict: the name it collided with and the group holding it.
    expect(error.textContent).toContain("Rename failed:");
    expect(error.textContent).toContain(TAKEN);
    const input = document.querySelector('[data-group-rename-input="grp_2"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Auth rework");
  });

  it("Escape still cancels a refused editor cleanly", async () => {
    renderDialog({ onRename: vi.fn(() => Promise.reject(new Error(TAKEN))) });
    fireEvent.click(document.querySelector('[data-group-rename="grp_2"]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('[data-group-rename-confirm="grp_2"]') as HTMLButtonElement);
    await screen.findByText(/Rename failed:/);
    fireEvent.keyDown(document.querySelector('[data-group-rename-input="grp_2"]') as HTMLInputElement, {
      key: "Escape",
    });
    expect(document.querySelector('[data-group-rename-input="grp_2"]')).toBeNull();
    expect(document.querySelector("[data-group-rename-error]")).toBeNull();
  });

  it("a successful retry closes the editor and clears the error", async () => {
    const onRename = vi
      .fn()
      .mockRejectedValueOnce(new Error(TAKEN))
      .mockResolvedValueOnce(undefined);
    renderDialog({ onRename });
    fireEvent.click(document.querySelector('[data-group-rename="grp_2"]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('[data-group-rename-confirm="grp_2"]') as HTMLButtonElement);
    await screen.findByText(/Rename failed:/);
    fireEvent.click(document.querySelector('[data-group-rename-confirm="grp_2"]') as HTMLButtonElement);
    await waitFor(() => {
      expect(document.querySelector('[data-group-rename-input="grp_2"]')).toBeNull();
    });
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-group-rename-error]")).toBeNull();
  });

  it("a filter change closes a refused editor and drops its error", async () => {
    renderDialog({
      groups: UNSORTED,
      onRename: vi.fn(() => Promise.reject(new Error(TAKEN))),
    });
    fireEvent.click(document.querySelector('[data-group-rename="grp_z"]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('[data-group-rename-confirm="grp_z"]') as HTMLButtonElement);
    await screen.findByText(/Rename failed:/);
    // Typing a filter moves the operator's attention to the list; an error
    // pinned to a row that query may hide would outlive its subject.
    fireEvent.change(filterField(), { target: { value: "auth" } });
    expect(document.querySelector('[data-group-rename-input="grp_z"]')).toBeNull();
    expect(document.querySelector("[data-group-rename-error]")).toBeNull();
  });

  it("a rejected create keeps the typed name and says why", async () => {
    renderDialog({
      onCreate: vi.fn(() => Promise.reject(new Error("the host rejected the create"))),
    });
    const nameField = document.querySelector("[data-group-name-input]") as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "Fresh group" } });
    fireEvent.click(document.querySelector("[data-group-create]") as HTMLButtonElement);
    const error = await waitFor(() => {
      const el = document.querySelector("[data-group-create-error]");
      if (el === null) throw new Error("create refusal not rendered yet");
      return el as HTMLElement;
    });
    expect(error.textContent).toContain("Create failed:");
    expect(error.textContent).toContain("the host rejected the create");
    expect(nameField.value).toBe("Fresh group");
    // The button is live again, so the operator can retry without retyping.
    expect((document.querySelector("[data-group-create]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a duplicate create is not a rejection: it settles onto the existing group", async () => {
    const onCreate = vi.fn(() => Promise.resolve(undefined));
    renderDialog({ onCreate });
    fireEvent.change(document.querySelector("[data-group-name-input]") as HTMLInputElement, {
      target: { value: "Auth rework" },
    });
    fireEvent.click(document.querySelector("[data-group-create]") as HTMLButtonElement);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Auth rework"));
    expect(document.querySelector("[data-group-create-error]")).toBeNull();
  });
});
