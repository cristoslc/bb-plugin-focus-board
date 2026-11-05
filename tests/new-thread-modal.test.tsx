// @vitest-environment jsdom
// The board's in-board new-thread composer modal: renders bb's host
// NewThreadComposer inside the responsive dialog, spawns through the SDK on
// submit, closes and hands the new thread to the board on success, and keeps
// the modal (and the composer's draft) on failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewThreadModal } from "../components/new-thread-modal";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

const spawn = vi.fn();
const onOpenChange = vi.fn();
const onSpawned = vi.fn();
const onMaximize = vi.fn();
const rememberProjectId = vi.fn();
const rememberEnvironment = vi.fn();
const createProject = vi.fn();

// The submit request is opaque to the modal (it forwards verbatim to
// spawn), so the test builds a minimal one and casts. The environment field
// rides along: the remember-environment test asserts the modally-resolved
// environment itself is handed over, not a lib derivation.
const REQUEST = {
  projectId: "proj_1",
  environment: { type: "project-default" },
  input: [],
} as unknown as NewThreadRequest;

// The spawn result fields the modal and the board's provisional pane row
// read; extra ThreadResponse fields are irrelevant here.
const SPAWNED = {
  id: "thr_new",
  title: null,
  titleFallback: "Fresh thread",
  status: "pending" as const,
  projectId: "proj_1",
};

let lastComposerProps: Record<string, unknown> | null = null;
let lastSubmitPromise: Promise<void> | null = null;

// The measured-placement tests push a fake footer-row geometry in here; the
// stub composer then renders bb's own pickers-row hook
// (`data-new-thread-footer`, the element lib/composer-row-anchor anchors to)
// carrying those offsets. Null (the default) keeps the row out — the shape
// every other test exercises, which is also the stacked-fallback contract.
const stubRow = vi.hoisted(() => ({
  geometry: null as
    | { offsetTop: number; offsetLeft: number; offsetHeight: number; paddingLeft: number }
    | null,
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // A stub composer: records the props it was seeded with and offers a
  // button that fires onSubmit, the way the host composer would on submit.
  // When a footer-row geometry is armed, it also renders bb's pickers-row
  // hook element the way the real host does, with the offsets predefined
  // (jsdom has no layout); the ref writes them before the modal's layout
  // measurement runs, so the modal's anchor sees a measurable row.
  experimental_NewThreadComposer: (props: Record<string, unknown>): ReactNode => {
    lastComposerProps = props;
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            lastSubmitPromise = Promise.resolve(
              (props.onSubmit as (request: NewThreadRequest) => Promise<void>)(REQUEST),
            );
          },
        },
        "Stub composer submit",
      ),
      stubRow.geometry === null ? null : createElement("div", {
        "data-new-thread-footer": "",
        className: "mt-1 flex select-none items-center justify-between gap-2 px-3.5",
        style: { paddingLeft: stubRow.geometry.paddingLeft },
        ref: (el: HTMLDivElement | null) => {
          if (el === null || stubRow.geometry === null) return;
          Object.defineProperty(el, "offsetParent", {
            configurable: true,
            // The modal's own wrapper is the row's real offset parent
            // (`relative`); the stub resolves it the same way the probe
            // does in the browser harness.
            value: el.closest('[data-composer-wrap=""]'),
          });
          Object.defineProperty(el, "offsetTop", {
            configurable: true,
            value: stubRow.geometry.offsetTop,
          });
          Object.defineProperty(el, "offsetLeft", {
            configurable: true,
            value: stubRow.geometry.offsetLeft,
          });
          Object.defineProperty(el, "offsetHeight", {
            configurable: true,
            value: stubRow.geometry.offsetHeight,
          });
        },
      }),
    );
  },
  useSdk: () => ({ threads: { spawn } }),
}));

beforeEach(() => {
  spawn.mockReset();
  spawn.mockResolvedValue(SPAWNED);
  onOpenChange.mockReset();
  onSpawned.mockReset();
  onMaximize.mockReset();
  rememberProjectId.mockReset();
  rememberEnvironment.mockReset();
  createProject.mockReset();
  createProject.mockResolvedValue({ id: "proj_new", name: "Fresh project" });
  lastComposerProps = null;
  lastSubmitPromise = null;
  stubRow.geometry = null;
});

afterEach(cleanup);

function renderModal(
  {
    open = true,
    defaultProjectId,
    defaultEnvironment,
    defaultProviderId,
    defaultModel,
    focusRequest,
    parentThreadId,
    parentThreadTitle,
    parentGroupName,
    groupName,
    withMaximize = false,
    rememberProjectId,
    rememberEnvironment,
    onCreateProject,
    onCreateProjectFromPicker,
  }: {
    open?: boolean;
    defaultProjectId?: string;
    defaultEnvironment?: Record<string, unknown>;
    defaultProviderId?: string;
    defaultModel?: string;
    focusRequest?: number;
    parentThreadId?: string;
    parentThreadTitle?: string;
    parentGroupName?: string;
    groupName?: string;
    withMaximize?: boolean;
    rememberProjectId?: ReturnType<typeof vi.fn>;
    rememberEnvironment?: ReturnType<typeof vi.fn>;
    onCreateProject?: ReturnType<typeof vi.fn>;
    onCreateProjectFromPicker?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return render(
    createElement(NewThreadModal, {
      open,
      onOpenChange,
      defaultProjectId,
      defaultEnvironment,
      defaultProviderId,
      defaultModel,
      focusRequest,
      parentThreadId,
      parentThreadTitle,
      ...(parentGroupName !== undefined ? { parentGroupName } : {}),
      ...(groupName !== undefined ? { groupName } : {}),
      onSpawned,
      ...(rememberProjectId !== undefined ? { rememberProjectId } : {}),
      ...(rememberEnvironment !== undefined ? { rememberEnvironment } : {}),
      ...(onCreateProject !== undefined ? { onCreateProject } : {}),
      ...(onCreateProjectFromPicker !== undefined
        ? { onCreateProjectFromPicker }
        : {}),
      // A child preset cannot follow to the main view; the app passes the
      // handler only for root threads, mirrored here by the flag.
      onMaximize: withMaximize ? onMaximize : undefined,
    }),
  );
}

const submitButton = () => {
  const button = document.querySelector<HTMLButtonElement>(
    'button[type="button"]:not([aria-label="Close"]):not([aria-label="Maximize new thread"])',
  );
  if (button === null) throw new Error("stub composer submit button not rendered");
  return button;
};

describe("NewThreadModal", () => {
  it("renders the composer only while open", () => {
    const view = renderModal({ open: true });
    expect(view.getByText("Stub composer submit")).toBeTruthy();
    view.rerender(
      createElement(NewThreadModal, {
        open: false,
        onOpenChange,
        onSpawned,
      }),
    );
    expect(view.queryByText("Stub composer submit")).toBeNull();
  });

  it("leaves the composer's popup menus unclipped: no scroll/hidden overflow ancestor between the composer and the dialog", () => {
    // Why a DOM-structure test and not a rendered check: jsdom cannot measure
    // clipping (no layout), so this asserts the invariant the modal controls:
    // any ancestor of the composer form with overflow other than visible
    // clips the host composer's typeahead menu. Proof from the real browser
    // (desktop tab, 1280x720): the host menu renders position:absolute
    // `bottom-full` against the promptbox form — for "Ask anything." at
    // y=306, the @-menu rect was y=265..299 (above the form; the menu
    // escapes static siblings like the host's own data-promptbox-main
    // because its containing block is the form) — but the modal's
    // max-h-[70vh] overflow-y-auto wrapper sat at y=306..470 and IS an
    // ancestor of that containing block, so it erased the menu entirely
    // (menu in the DOM, invisible; bb's main view and the board's chat-pane
    // composer, which have no clipping ancestor above the prompt form, show
    // the same menu fine). The same clipping path also erased the composer's
    // "/" command menu. No wrapper — the menu escapes to overlap the dialog
    // freely.
    renderModal({ open: true });
    const composer = document.querySelector('button[type="button"]:not([aria-label="Close"]):not([aria-label="Maximize new thread"])');
    expect(composer).not.toBeNull();
    const dialog = composer!.closest('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const clipping = /overflow-(y-auto|auto|y-clip|clip|y-hidden|hidden)\b/;
    const offenders: string[] = [];
    for (
      let node: Element | null = composer!.parentElement;
      node && node !== dialog;
      node = node.parentElement
    ) {
      const className = typeof node.className === "string" ? node.className : "";
      if (clipping.test(className)) offenders.push(className);
    }
    expect(offenders).toEqual([]);
  });

  it("seeds the composer with the project from the board filter", () => {
    renderModal({ defaultProjectId: "proj_a", focusRequest: 3 });
    expect(lastComposerProps).not.toBeNull();
    expect(lastComposerProps?.defaultProjectId).toBe("proj_a");
    expect(lastComposerProps?.focusRequest).toBe(3);
  });

  it("spawns on submit, closes the modal, and hands the thread to the board", async () => {
    renderModal();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
    expect(spawn).toHaveBeenCalledWith(REQUEST);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("with a parent preset, spawns the submitted request as that thread's child", async () => {
    renderModal({ parentThreadId: "thr_root", parentThreadTitle: "Root epic" });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
    // The parent rides on the verbatim request — the child fields (prompt,
    // project, environment, provider) stay whatever the operator composed.
    expect(spawn).toHaveBeenCalledWith({
      projectId: "proj_1",
      environment: REQUEST.environment,
      input: [],
      parentThreadId: "thr_root",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("with a parent preset, titles the dialog and names the nesting target", () => {
    renderModal({ parentThreadId: "thr_root", parentThreadTitle: "Root epic" });
    expect(screen.getByText("New child thread")).toBeTruthy();
    const hint = document.querySelector('[data-new-child-hint=""]');
    if (hint === null) throw new Error("parent hint not rendered");
    expect(hint.textContent).toContain("Will nest under");
    expect(hint.textContent).toContain("Root epic");
  });

  it("with a parent preset, the composer still receives the project seed", () => {
    // The seed itself is app-level (lib/new-thread-seed: the parent's
    // project wins over the filter); the modal's contract is that both the
    // parent preset and the seed reach the composer at once.
    renderModal({
      parentThreadId: "thr_root",
      parentThreadTitle: "Root epic",
      defaultProjectId: "proj_home",
    });
    expect(lastComposerProps?.defaultProjectId).toBe("proj_home");
    expect(screen.getByText("New child thread")).toBeTruthy();
  });

  it("forwards an environment seed to the composer", () => {
    // The parent's worktree checkout, as a `reuse` environment: the composer
    // seeds its environment picker so the child starts in the parent's
    // checkout rather than the project-default one.
    renderModal({
      parentThreadId: "thr_root",
      defaultEnvironment: { type: "reuse", environmentId: "env_1" },
    });
    expect(lastComposerProps?.defaultEnvironment).toEqual({
      type: "reuse",
      environmentId: "env_1",
    });
  });

  it("maximizes into the main new-thread view when the app provides the hand-off", () => {
    renderModal({ withMaximize: true });
    const maximize = screen.getByLabelText("Maximize new thread");
    expect(maximize.getAttribute("title")).toBe("Open in the main new-thread view");
    fireEvent.click(maximize);
    expect(onMaximize).toHaveBeenCalledTimes(1);
    // The hand-off does not submit: nothing spawns.
    expect(spawn).not.toHaveBeenCalled();
    expect(onSpawned).not.toHaveBeenCalled();
  });

  it("insets the maximize button clear of the dialog's own close", () => {
    // The 2026-10-23 release screenshot caught the maximize button abutting
    // the dialog's close: both boxes render 32px wide, maximize at right-12
    // and the close at right-4, so their edges met at exactly 0px and the pair
    // read as one control. jsdom has no layout, so the guard is the offset
    // contract, and the harness measured a 16px gap once the inset moved to
    // right-16.
    renderModal({ withMaximize: true });
    const maximize = screen.getByLabelText("Maximize new thread");
    expect(maximize.className).toContain("right-16");
    expect(maximize.className).not.toContain("right-12");
  });

  it("without a hand-off handler, carries no maximize button (inverse)", () => {
    renderModal();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
  });

  it("without an environment seed, passes nothing to the composer (inverse)", () => {
    renderModal({ parentThreadId: "thr_root" });
    expect("defaultEnvironment" in (lastComposerProps ?? {})).toBe(false);
  });

  it("without a parent, keeps the plain title and no nesting hint (inverse)", () => {
    renderModal();
    expect(screen.getByText("New thread")).toBeTruthy();
    expect(document.querySelector('[data-new-child-hint=""]')).toBeNull();
    expect(screen.queryByText("New child thread")).toBeNull();
  });

  it("hands the spawned thread's project to the board's remember-memory on success", async () => {
    // The spawn success path is where the board's remembered-project rung
    // is fed: the spawn result carries the project the thread landed in.
    renderModal({ rememberProjectId });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
    expect(rememberProjectId).toHaveBeenCalledTimes(1);
    expect(rememberProjectId).toHaveBeenCalledWith("proj_1");
  });

  it("hands the submitted environment to the board's remember-memory on success", async () => {
    // The environment the composer RESOLVED (a "(new) worktree" pick or a
    // reuse) reaches the board only through the submit request; the spawn
    // result carries no environment. The success path feeds it to the
    // per-project remembered-environment rung alongside the project.
    renderModal({ rememberEnvironment });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
    expect(rememberEnvironment).toHaveBeenCalledTimes(1);
    expect(rememberEnvironment).toHaveBeenCalledWith("proj_1", REQUEST.environment);
  });

  it("a failed spawn remembers the environment never (inverse)", async () => {
    spawn.mockRejectedValue(new Error("spawn failed"));
    renderModal({ rememberEnvironment });
    fireEvent.click(submitButton());
    await expect(lastSubmitPromise).rejects.toThrow("spawn failed");
    expect(rememberEnvironment).not.toHaveBeenCalled();
  });

  it("a failed spawn remembers nothing (inverse)", async () => {
    spawn.mockRejectedValue(new Error("spawn failed"));
    renderModal({ rememberProjectId });
    fireEvent.click(submitButton());
    await expect(lastSubmitPromise).rejects.toThrow("spawn failed");
    expect(rememberProjectId).not.toHaveBeenCalled();
  });

  it("without a remember-memory callback, submits fine (inverse)", async () => {
    renderModal();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
  });

  it("on failure keeps the modal open, reports the error, and keeps the draft", async () => {
    spawn.mockRejectedValue(new Error("spawn failed"));
    renderModal();
    fireEvent.click(submitButton());
    // The SDK keeps the composer draft only when onSubmit throws, so the
    // rejection must propagate out of the modal's handler.
    await expect(lastSubmitPromise).rejects.toThrow("spawn failed");
    await waitFor(() => {
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSpawned).not.toHaveBeenCalled();
    // The composer must still be mounted so the kept draft stays editable.
    expect(document.querySelector('button[type="button"]')).not.toBeNull();
  });
});

describe("the group preset (New thread in group…)", () => {
  it("names the group the spawn will be tagged into", () => {
    renderModal({ groupName: "Auth rework" });
    const hint = document.querySelector('[data-new-group-hint=""]');
    if (hint === null) throw new Error("group hint not rendered");
    expect(hint.textContent).toContain("Will be tagged into");
    expect(hint.textContent).toContain("Auth rework");
  });

  it("without a group, carries no group hint (inverse)", () => {
    renderModal();
    expect(document.querySelector('[data-new-group-hint=""]')).toBeNull();
  });

  it("seeds the composer's provider and model from the group's majority seed", () => {
    renderModal({ defaultProviderId: "pi_a", defaultModel: "m_a" });
    expect(lastComposerProps?.defaultProviderId).toBe("pi_a");
    expect(lastComposerProps?.defaultModel).toBe("m_a");
  });

  it("without majority seeds, passes nothing to the composer (inverse)", () => {
    renderModal({ groupName: "Auth rework" });
    expect("defaultProviderId" in (lastComposerProps ?? {})).toBe(false);
    expect("defaultModel" in (lastComposerProps ?? {})).toBe(false);
  });
});

describe("the child preset's group inheritance (New child thread… from a grouped parent)", () => {
  it("names the parent's group the child will join", () => {
    renderModal({ parentThreadId: "thr_p", parentThreadTitle: "Auth rework", parentGroupName: "Auth rework" });
    const hint = document.querySelector('[data-new-child-group-hint=""]');
    if (hint === null) throw new Error("child group hint not rendered");
    expect(hint.textContent).toContain("Will join the group");
    expect(hint.textContent).toContain("Auth rework");
  });

  it("without the parent being grouped, carries no group hint (inverse)", () => {
    renderModal({ parentThreadId: "thr_p", parentThreadTitle: "Auth rework" });
    expect(document.querySelector('[data-new-child-group-hint=""]')).toBeNull();
  });

  it("a parent-preset thread without a parentGroupName never renders the grouping hint (inverse, root-shaped data)", () => {
    renderModal({ parentThreadId: "thr_p" });
    expect(document.querySelector('[data-new-child-group-hint=""]')).toBeNull();
  });

  it("a grouped child spawn still keeps the nesting hint", () => {
    renderModal({ parentThreadId: "thr_p", parentThreadTitle: "Auth rework", parentGroupName: "Auth rework" });
    expect(document.querySelector('[data-new-child-hint=""]')).not.toBeNull();
  });
});

describe("the New project option (issue #355)", () => {
  const newProjectOption = () => document.querySelector('[data-new-project-option=""]');
  const newProjectError = () => document.querySelector('[data-new-project-error=""]');

  it("renders the New project option stacked below the composer when the host's pickers row is not measurable (the stub shape and the fallback)", () => {
    renderModal({ onCreateProject: createProject });
    const option = newProjectOption()! as HTMLButtonElement;
    expect(option).not.toBeNull();
    // Icon-only: the classic entry's folder-plus glyph carries the meaning,
    // the accessible name carries the words.
    expect(option.getAttribute("aria-label")).toBe("New project");
    expect(option.textContent).toBe("");
    // Placement: after the composer in the dialog's reading order, in the
    // in-flow footer the stacked shape renders. With a measurable host row
    // the button floats ON the row's line instead (the row-placement block
    // below); jsdom's stub composer has no measurable row, so the fallback
    // is what this shape sees.
    const composer = document.querySelector(
      'button[type="button"]:not([aria-label="Close"]):not([aria-label="Maximize new thread"]):not([aria-label="New project"])',
    );
    expect(composer).not.toBeNull();
    expect(option.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("without the create hand-off, renders no New project option (inverse)", () => {
    renderModal();
    expect(newProjectOption()).toBeNull();
  });

  it("activating the option swaps it for an inline name field with create and cancel controls, not a second modal", () => {
    renderModal({ onCreateProject: createProject });
    fireEvent.click(newProjectOption()!);
    expect(screen.getByLabelText("New project name")).toBeTruthy();
    expect(screen.getByLabelText("Create project")).toBeTruthy();
    expect(screen.getByLabelText("Cancel new project")).toBeTruthy();
    expect(newProjectOption()).toBeNull();
    // Still the one dialog: the field lives inside it.
    expect(screen.getByLabelText("New project name").closest('[role="dialog"]')).not.toBeNull();
  });

  it("cancel returns to the resting option and leaves the composer's project seed untouched", () => {
    renderModal({ onCreateProject: createProject, defaultProjectId: "proj_seed" });
    fireEvent.click(newProjectOption()!);
    fireEvent.click(screen.getByLabelText("Cancel new project"));
    expect(newProjectOption()).not.toBeNull();
    expect(screen.queryByLabelText("New project name")).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
    expect(lastComposerProps?.defaultProjectId).toBe("proj_seed");
  });

  it("Escape in the name field cancels back to the resting option without closing the dialog", () => {
    renderModal({ onCreateProject: createProject });
    fireEvent.click(newProjectOption()!);
    fireEvent.keyDown(screen.getByLabelText("New project name"), { key: "Escape" });
    expect(newProjectOption()).not.toBeNull();
    expect(screen.queryByLabelText("New project name")).toBeNull();
    // The dialog itself stays open: the composer is still mounted.
    expect(document.querySelector('button[type="button"]:not([aria-label="Close"]):not([aria-label="Maximize new thread"])')).not.toBeNull();
  });

  it("a blank name keeps create disabled", () => {
    renderModal({ onCreateProject: createProject });
    fireEvent.click(newProjectOption()!);
    const confirm = screen.getByLabelText("Create project") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "   " } });
    expect(confirm.disabled).toBe(true);
  });

  it("on success, creates with the trimmed name, seeds the composer's picker with the new project, and returns to the resting option", async () => {
    renderModal({ onCreateProject: createProject, defaultProjectId: "proj_seed" });
    fireEvent.click(newProjectOption()!);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "  Fresh project  " } });
    fireEvent.click(screen.getByLabelText("Create project"));
    await waitFor(() => {
      expect(newProjectOption()).not.toBeNull();
    });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith("Fresh project");
    // The spawn's project comes from the host composer's picker, which the
    // defaultProjectId seed drives — the created project's id is that seed.
    expect(lastComposerProps?.defaultProjectId).toBe("proj_new");
    expect(screen.queryByLabelText("New project name")).toBeNull();
    expect(newProjectError()).toBeNull();
  });

  it("the created project's id overrides the app's seed for the composer (the spawn lands in the new project)", async () => {
    renderModal({ onCreateProject: createProject, defaultProjectId: "proj_seed" });
    fireEvent.click(newProjectOption()!);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "Fresh project" } });
    fireEvent.click(screen.getByLabelText("Create project"));
    await waitFor(() => {
      expect(lastComposerProps?.defaultProjectId).toBe("proj_new");
    });
  });

  it("on failure, shows the reason inline, keeps the typed name, and stays on the field", async () => {
    createProject.mockRejectedValue(
      new Error("No connected host to create the project checkout on."),
    );
    renderModal({ onCreateProject: createProject });
    fireEvent.click(newProjectOption()!);
    const typed = "Fresh project";
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: typed } });
    fireEvent.click(screen.getByLabelText("Create project"));
    await waitFor(() => {
      expect(newProjectError()).not.toBeNull();
    });
    expect(newProjectError()!.textContent).toContain("No connected host");
    expect((screen.getByLabelText("New project name") as HTMLInputElement).value).toBe(typed);
    expect(newProjectOption()).toBeNull();
    // The composer's seed never moved: the failed create selected nothing.
    expect(lastComposerProps?.defaultProjectId).toBeUndefined();
  });

  it("reopening the dialog clears the created-project seed (the ladder seeds again)", async () => {
    const view = renderModal({ onCreateProject: createProject, defaultProjectId: "proj_seed" });
    fireEvent.click(newProjectOption()!);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "Fresh project" } });
    fireEvent.click(screen.getByLabelText("Create project"));
    await waitFor(() => {
      expect(lastComposerProps?.defaultProjectId).toBe("proj_new");
    });
    view.rerender(
      createElement(NewThreadModal, {
        open: false,
        onOpenChange,
        defaultProjectId: "proj_seed",
        onCreateProject: createProject,
        onSpawned,
      }),
    );
    view.rerender(
      createElement(NewThreadModal, {
        open: true,
        onOpenChange,
        defaultProjectId: "proj_seed",
        onCreateProject: createProject,
        onSpawned,
      }),
    );
    expect(lastComposerProps?.defaultProjectId).toBe("proj_seed");
    // And the option is resting again, not the name field.
    expect(newProjectOption()).not.toBeNull();
  });
});

// The row-anchor placement (the row fix): with the host's pickers row
// measurable, the New project button floats ON the row's line instead of
// stacking below the composer. The numbers mirror the real dialog's
// wrapper-relative geometry: the row sits 350px down the wrapper, its
// content starts at the row's 14px padding (`px-3.5`), so the button's
// right edge lands at 350/14 and its left at −14 — protruding into the
// dialog's padding band exactly as the operator's arrow pointed.
describe("the New project option's row placement", () => {
  const newProjectOption = () => document.querySelector('[data-new-project-option=""]');

  function stubCompactViewport(compact: boolean): void {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: compact && query.includes("max-width: 767px"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  }

  it("floats onto the pickers row's line: right edge at the row's content start, centered on the row, no in-flow footer left behind", () => {
    stubRow.geometry = { offsetTop: 350, offsetLeft: 0, offsetHeight: 28, paddingLeft: 14 };
    renderModal({ onCreateProject: createProject });
    const option = newProjectOption()! as HTMLButtonElement;
    expect(option.getAttribute("aria-label")).toBe("New project");
    // The measured placement: centered on the row's line...
    expect(option.style.top).toBe("350px");
    // ...and the RIGHT edge exactly at the row's content start — the
    // boundary the first picker's click area begins at (the jsdom half of
    // the pointer-events audit; the browser probe walks the same boundary
    // with elementFromPoint).
    expect(option.style.left).toBe("-14px");
    expect(parseFloat(option.style.left) + 28).toBe(
      (stubRow.geometry.offsetLeft) + stubRow.geometry.paddingLeft,
    );
    // The button lives INSIDE the composer wrapper (the stub composer's
    // parent), not in a flow footer after it.
    expect(option.parentElement!.querySelector('[data-new-thread-footer=""]')).not.toBeNull();
    // No in-flow footer at rest: the dead band's extra content is gone —
    // the dialog ends at the composer plus its own padding.
    expect(document.querySelector('[data-new-project-footer=""]')).toBeNull();
  });

  it("activating the floating option swaps it for the inline field below the composer, and escaping returns it to the row", () => {
    stubRow.geometry = { offsetTop: 350, offsetLeft: 0, offsetHeight: 28, paddingLeft: 14 };
    renderModal({ onCreateProject: createProject });
    const option = newProjectOption()! as HTMLButtonElement;
    expect(option.style.left).toBe("-14px");
    fireEvent.click(option);
    // The resting floating button is gone; the field takes the flow slot.
    expect(newProjectOption()).toBeNull();
    expect(document.querySelector('[data-new-project-footer=""]')).not.toBeNull();
    expect(screen.getByLabelText("New project name")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("New project name"), { key: "Escape" });
    // Back onto the row with the same measured placement.
    const restored = newProjectOption()! as HTMLButtonElement;
    expect(restored.style.top).toBe("350px");
    expect(restored.style.left).toBe("-14px");
    expect(document.querySelector('[data-new-project-footer=""]')).toBeNull();
  });

  it("at a compact viewport (the drawer shell) the option keeps the stacked shape even with a measurable row", async () => {
    stubRow.geometry = { offsetTop: 350, offsetLeft: 0, offsetHeight: 28, paddingLeft: 14 };
    stubCompactViewport(true);
    renderModal({ onCreateProject: createProject });
    // The compact drawer realizes its content two frames after opening
    // (components/ui/responsive-overlay's mount-motion optimization), so
    // the row of interest exists a beat late.
    await waitFor(() => {
      expect(newProjectOption()).not.toBeNull();
    });
    const option = newProjectOption()! as HTMLButtonElement;
    // In flow, inside the footer block — the picker row's left edge leaves
    // no room for a 28px button in the drawer's 16px padding, so nothing
    // floats there.
    expect(option.style.left).toBe("");
    expect(option.style.top).toBe("");
    const footer = document.querySelector('[data-new-project-footer=""]');
    expect(footer).not.toBeNull();
    expect(footer!.contains(option)).toBe(true);
    vi.unstubAllGlobals();
  });
});

// The button's click follows bb's typical new-project flow when the app
// hands the folder picker off (lib/project-create-flow): the native pick,
// the create carried by it, the seed selecting the created project. A
// cancelled pick rests; a refused pick arms the inline name field with the
// reason. The blocks above (no picker prop at all) pin the fallback flow's
// shape; this block pins the picker hand-off.
describe("the New project option's typical flow (the folder picker hand-off)", () => {
  const newProjectOption = () => document.querySelector('[data-new-project-option=""]');
  const newProjectError = () => document.querySelector('[data-new-project-error=""]');

  it("clicking the option runs the picker flow: the create happens in the app's hand-off, the seed selects the created project, and the name field never opens", async () => {
    const fromPicker = vi.fn().mockResolvedValue({ id: "proj_from_folder" });
    renderModal({ onCreateProject: createProject, onCreateProjectFromPicker: fromPicker });
    fireEvent.click(newProjectOption()!);
    await waitFor(() => {
      expect(fromPicker).toHaveBeenCalledTimes(1);
    });
    // The field flow never opened (no inline name field, no field write).
    expect(createProject).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New project name")).toBeNull();
    // The created project is the composer's seed, like the field flow's
    // success — the picker's spawn lands there.
    await waitFor(() => {
      expect(lastComposerProps?.defaultProjectId).toBe("proj_from_folder");
    });
    // And the dialog rests on the option.
    expect(newProjectOption()).not.toBeNull();
    expect(newProjectError()).toBeNull();
  });

  it("a cancelled pick (null id) rests the dialog: no field, the seed untouched", async () => {
    const fromPicker = vi.fn().mockResolvedValue({ id: null });
    renderModal({
      onCreateProject: createProject,
      onCreateProjectFromPicker: fromPicker,
      defaultProjectId: "proj_seed",
    });
    fireEvent.click(newProjectOption()!);
    await waitFor(() => {
      expect(fromPicker).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(newProjectOption()).not.toBeNull();
    });
    expect(screen.queryByLabelText("New project name")).toBeNull();
    // The seed the app handed in still stands.
    expect(lastComposerProps?.defaultProjectId).toBe("proj_seed");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("a refused pick arms the name field with the picker's reason stated for the picker's case", async () => {
    const fromPicker = vi
      .fn()
      .mockRejectedValue(new Error("No connected host to pick a project folder on."));
    renderModal({ onCreateProject: createProject, onCreateProjectFromPicker: fromPicker });
    fireEvent.click(newProjectOption()!);
    await waitFor(() => {
      expect(newProjectError()).not.toBeNull();
    });
    // The inline line names the picker's case, not a create write's.
    expect(newProjectError()!.textContent).toContain("Folder picker unavailable");
    expect(newProjectError()!.textContent).toContain("No connected host to pick a project folder on.");
    // The field is armed for the operator to name instead.
    expect(screen.getByLabelText("New project name")).toBeTruthy();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("while a pick pends, the affordance disables (the native dialog owns the screen)", async () => {
    let release: (value: { id: string | null }) => void = () => {};
    const fromPicker = vi.fn().mockImplementation(
      () => new Promise<{ id: string | null }>((resolve) => { release = resolve; }),
    );
    renderModal({ onCreateProject: createProject, onCreateProjectFromPicker: fromPicker });
    fireEvent.click(newProjectOption()!);
    expect(fromPicker).toHaveBeenCalledTimes(1);
    expect((newProjectOption() as HTMLButtonElement).disabled).toBe(true);
    release({ id: "proj_from_folder" });
    await waitFor(() => {
      expect((newProjectOption() as HTMLButtonElement).disabled).toBe(false);
    });
    await waitFor(() => {
      expect(lastComposerProps?.defaultProjectId).toBe("proj_from_folder");
    });
  });
});
