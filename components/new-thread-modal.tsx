import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFooterRowAnchor } from "@/components/use-footer-row-anchor";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  NEW_PROJECT_BUTTON_HEIGHT,
  NEW_PROJECT_BUTTON_WIDTH,
  composeFooterRowPlacement,
  measureFooterRowAnchor,
  type FooterRowPlacement,
} from "@/lib/composer-row-anchor";
import type { ThreadPaneThread } from "@/components/thread-pane";

/**
 * The fields of `threads.spawn`'s thread record that the board consumes for
 * the provisional pane row while the sidebar cache has not caught up yet.
 */
export interface SpawnedThread {
  id: string;
  title: string | null;
  titleFallback: string | null;
  status: ThreadPaneThread["status"];
  projectId: string;
}

/**
 * The board's own new-thread composer: bb's host compose surface in a
 * responsive dialog over the board and pane, so starting a thread never
 * leaves the board (and never opens bb's new-thread window). On submit the
 * request forwards verbatim to `threads.spawn`, which attributes the thread
 * to this plugin; the board opens the spawned thread in the pane.
 *
 * A parent preset (`parentThreadId`, from the card/pane "New child thread…"
 * actions) changes nothing about the compose surface — the child's prompt,
 * project and provider are the operator's choice as ever — except that the
 * spawned thread gains `parentThreadId`, making it a child of that thread
 * (the board nests it under its parent card). The dialog titles itself and
 * names the parent so the operator can see what will nest where.
 */

/**
 * The picker flow's refusal words: the picker's own case, stated so the
 * dialog's inline line reads why the folder picker did not open and what
 * to do instead — the name field the flow fell back to.
 */
function pickerUnavailableMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Folder picker unavailable: ${reason}. Name the project instead.`;
}

export function NewThreadModal({
  open,
  onOpenChange,
  defaultProjectId,
  defaultEnvironment,
  defaultProviderId,
  defaultModel,
  focusRequest,
  parentThreadId,
  parentThreadTitle,
  spawnParentTitle,
  parentGroupName,
  groupName,
  onMaximize,
  rememberProjectId,
  rememberEnvironment,
  onCreateProject,
  onCreateProjectFromPicker,
  onSpawned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Seeds the composer's project picker (lib/new-thread-seed's ladder: the
   * preset parent's project, else the single filter-selected project, else
   * the board's unanimous project, else the remembered last-spawn project;
   * absent seeds nothing and the host resolves its own pick).
   */
  defaultProjectId?: string;
  /**
   * Seeds the composer's environment picker (from the preset parent's
   * worktree checkout, so the child lands where the parent runs); absent
   * seeds nothing and the composer resolves its own default.
   */
  defaultEnvironment?: NewThreadRequest["environment"];
  /**
   * Seeds the composer's provider picker — a group preset carries the
   * majority provider of the group's members. Same seed semantics as
   * defaultProjectId: a seed the user can change.
   */
  defaultProviderId?: string;
  /** Seeds the composer's model picker; the group preset's majority model. */
  defaultModel?: string;
  focusRequest?: number;
  /** The thread the new thread will spawn under; absent spawns at the root. */
  parentThreadId?: string;
  /** Where the spawned card will display (see the app's nest-target walk). */
  parentThreadTitle?: string;
  /**
   * The literal spawn parent when the display target differs from it (the
   * preset parent's own row is a sub-row: the display caps at two levels, so
   * the card lands under the family root). The hint names both truths in
   * that case; absent when display and spawn agree.
   */
  spawnParentTitle?: string;
  /**
   * The preset parent's feature group ("New child thread…" from a grouped
   * parent): the dialog's hint names it, the same transparency the group
   * preset gets. The inheritance itself happens app-side after the spawn —
   * the modal only announces it.
   */
  parentGroupName?: string;
  /**
   * The group the composer will tag the spawned thread into ("New thread in
   * group…" preset): the dialog's hint names it. The tagging itself happens
   * app-side after the spawn — the modal only announces it.
   */
  groupName?: string;
  /**
   * Maximize: expand this composer into bb's main new-thread view. The app
   * supplies the hand-off (seeds and the stored prompt text ride along; the
   * board's own draft is kept — a maximize is a close, not a spawn;
   * lib/compose-maximize) and omits it while a child preset is armed, since
   * the main view cannot spawn a nested thread; the button renders only
   * when the hand-off exists.
   */
  onMaximize?: () => void;
  /**
   * Feed for the board's remembered-project seed rung: called with the
   * spawned thread's project on submit success (the spawn result carries
   * `projectId`), never on failure. Absent (the tests' stub flows) skips
   * the remember — the composer works exactly as before.
   */
  rememberProjectId?: (projectId: string) => void;
  /**
   * Feed for the board's remembered-ENVIRONMENT seed rung: called with the
   * submitted project id and the environment the composer RESOLVED (the
   * spawn result carries no environment — the request does) on submit
   * success, never on failure. Absent (the tests' stub flows) skips the
   * remember — the composer works exactly as before.
   */
  rememberEnvironment?: (
    projectId: string,
    environment: NewThreadRequest["environment"],
  ) => void;
  /**
   * The dialog's New project option (issue #355): creates a project by name
   * through the board's one create path (the same helper the toolbar's
   * Project filter uses), then selects the created project in the
   * composer's project picker. Absent (the host cannot create, the tests'
   * stub flows) renders no option — the composer works exactly as before.
   * The picker's dropdown itself is host-owned and the plugin-facing
   * composer drops bb's `createProject` capability (get-bb/bb#7015), so the
   * option lives as a small icon-only button ON the composer's pickers
   * row's line — at the row's left edge, beside the project picker —
   * swapped for an inline name field when armed.
   */
  onCreateProject?: (name: string) => Promise<{ id: string }>;
  /**
   * The SAME button's typical-flow hand-off (the operator's ruling: the
   * button follows bb's typical new-project flow): the app runs bb's
   * native folder picker on the board's single connected persistent host
   * and creates from the picked folder (lib/project-create-flow) — absent
   * (untestable host topologies, the tests' stub flows) the button's click
   * arms the inline name field directly, the shipped fallback flow.
   * `{ id: null }` means the operator cancelled the native pick: nothing
   * is created and the dialog rests, bb's own answer to a null pick.
   */
  onCreateProjectFromPicker?: () => Promise<{ id: string | null }>;
  onSpawned: (thread: SpawnedThread) => void;
}) {
  const sdk = useSdk();
  const [spawnFailed, setSpawnFailed] = useState(false);
  // The New project option's inline field state (issue #355). The created
  // project's id rides the composer's `defaultProjectId` seed — the host
  // composer re-seeds its pickers when that prop changes value, so the
  // spawn lands in the new project. A stale field, error, or seed must not
  // greet the next open.
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  // The typical flow's pick: while the native folder picker is on screen
  // (the app side runs bb's hosts.pickFolder) the affordance disables —
  // bb's isCreating slot does the same for its own pick.
  const [pickingPending, setPickingPending] = useState(false);
  // The host composer's pickers row, measured for the floating New project
  // button (components/use-footer-row-anchor): desktop viewports place the
  // button on the row's line, out of flow; compact viewports and any
  // unmeasurable row keep the stacked shape. The anchor follows the dialog
  // being open — closed mounts no composer, so the anchor rests at null.
  const { setWrapperElement, placement: footerRowPlacement } =
    useFooterRowAnchor(open && onCreateProject !== undefined);
  // The resting button floats only when the row is anchored to. While the
  // name field is armed the button is swapped for the field either way.
  const floatingOption =
    onCreateProject !== undefined && !creatingProject && footerRowPlacement !== null;
  useEffect(() => {
    if (!open) {
      setSpawnFailed(false);
      setCreatingProject(false);
      setNewProjectName("");
      setCreatePending(false);
      setCreateError(null);
      setCreatedProjectId(null);
      setPickingPending(false);
    }
  }, [open]);

  // The button's click: the typical flow (the native folder picker, the
  // project named after the picked folder) when the app hands the picker
  // off; otherwise the inline name field. A refused pick — the picker
  // unavailable on this client, or the picked path naming no project
  // directory — arms the name field with the reason shown (each error's
  // own words: the field flow's failures read "Create failed: …", the
  // picker's read the picker's case). A cancelled pick (null) rests the
  // dialog untouched, bb's own answer to a null pick.
  const startCreateProject = useCallback(() => {
    if (onCreateProjectFromPicker === undefined || pickingPending) {
      if (!pickingPending) setCreatingProject(true);
      return;
    }
    setPickingPending(true);
    setCreateError(null);
    let pending: Promise<{ id: string | null }>;
    try {
      pending = onCreateProjectFromPicker();
    } catch (error) {
      setPickingPending(false);
      setCreatingProject(true);
      setCreateError(pickerUnavailableMessage(error));
      return;
    }
    void Promise.resolve(pending).then(
      (result) => {
        setPickingPending(false);
        if (result.id === null) return;
        setCreatedProjectId(result.id);
        setCreateError(null);
      },
      (error: unknown) => {
        setPickingPending(false);
        setCreatingProject(true);
        setCreateError(pickerUnavailableMessage(error));
      },
    );
  }, [onCreateProjectFromPicker, pickingPending]);

  // The create write mirrors the group dialog's rename handling: the write
  // starts in the tick it fires, a success closes the field and selects the
  // created project, a refusal keeps the field open on the typed name with
  // the failing write's own words inline.
  const submitCreateProject = useCallback(() => {
    const name = newProjectName.trim();
    if (name === "" || createPending || onCreateProject === undefined) return;
    setCreatePending(true);
    setCreateError(null);
    let pending: Promise<{ id: string }>;
    try {
      pending = onCreateProject(name);
    } catch (error) {
      setCreatePending(false);
      setCreateError(`Create failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    void Promise.resolve(pending).then(
      (created) => {
        setCreatedProjectId(created.id);
        setCreatingProject(false);
        setNewProjectName("");
        setCreatePending(false);
      },
      (error: unknown) => {
        setCreatePending(false);
        setCreateError(`Create failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }, [newProjectName, createPending, onCreateProject]);

  // SDK contract: the composer clears its draft when onSubmit resolves and
  // KEEPS it when it throws. A failed create must therefore surface the
  // error AND rethrow — swallowing it would silently wipe what the user
  // typed.
  const handleSubmit = useCallback(
    async (request: NewThreadRequest) => {
      // The compose surface does not know about parentage, so the child
      // parameter rides here: a parent preset adds `parentThreadId` to the
      // verbatim request — the one field `CreateThreadRequest` takes that
      // makes the spawned thread a child. No parent preset: the request
      // forwards verbatim, byte-for-byte the plain new-thread flow.
      const spawnArgs = parentThreadId !== undefined
        ? { ...request, parentThreadId }
        : request;
      try {
        const thread = await sdk.threads.spawn(spawnArgs);
        rememberProjectId?.(thread.projectId);
        rememberEnvironment?.(thread.projectId, request.environment);
        onOpenChange(false);
        onSpawned(thread);
      } catch (error) {
        setSpawnFailed(true);
        throw error;
      }
    },
    [sdk, onOpenChange, onSpawned, rememberProjectId, rememberEnvironment, parentThreadId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The composer's control row needs real width — bb's guidance is that
      it does not fit a ~420px column, so the dialog runs wider than the
      pane's default. */}
      <DialogContent className="max-w-3xl">
        {onMaximize ? (
          // A further 16px inset from the dialog's own close (right-4), so the
          // two header buttons leave a clear gap instead of abutting and
          // reading as one control. Maximize expands this composer into bb's
          // main new-thread view, seeds and prompt text riding along, without
          // spending the draft on a spawn.
          <button
            type="button"
            onClick={onMaximize}
            aria-label="Maximize new thread"
            title="Open in the main new-thread view"
            className="absolute right-16 top-4 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="Maximize2" className="size-4" aria-hidden />
          </button>
        ) : null}
        <DialogHeader>
          <DialogTitle>{parentThreadId !== undefined ? "New child thread" : "New thread"}</DialogTitle>
          <DialogDescription>
            {parentThreadId !== undefined
              ? "Spawns under the named thread. Your draft is saved as you type, even if you close and come back later."
              : "Your draft is saved as you type, even if you close and come back later."}
          </DialogDescription>
          {parentThreadId !== undefined ? (
            // The nesting the submit will produce, named up front: the
            // operator sees where the child will land before spending the
            // prompt. When the display target and the literal spawn parent
            // differ (the preset parent's row is a sub-row), the hint names
            // both: the card lands under the family root, the data under
            // the acted-on thread.
            <p
              data-new-child-hint=""
              className="text-xs font-medium text-muted-foreground"
            >
              <Icon name="Fork" className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              Will nest under{" "}
              <span className="text-foreground">{parentThreadTitle ?? parentThreadId}</span>
              {spawnParentTitle !== undefined ? (
                <>
                  {" "}
                  · spawns under{" "}
                  <span className="text-foreground">{spawnParentTitle}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {parentThreadId !== undefined && parentGroupName !== undefined ? (
            // Same transparency for a grouped parent: the child inherits the
            // parent's feature-group membership at spawn — named before the
            // prompt is spent.
            <p
              data-new-child-group-hint=""
              className="text-xs font-medium text-muted-foreground"
            >
              <Icon name="Tag" className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              Will join the group{" "}
              <span className="text-foreground">{parentGroupName}</span>
            </p>
          ) : null}
          {groupName !== undefined ? (
            // Same transparency for the group preset: the spawn will be
            // tagged into the named group — before the prompt is spent.
            <p
              data-new-group-hint=""
              className="text-xs font-medium text-muted-foreground"
            >
              <Icon name="Tag" className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              Will be tagged into{" "}
              <span className="text-foreground">{groupName}</span>
            </p>
          ) : null}
        </DialogHeader>
        {spawnFailed ? (
          <p role="alert" className="text-sm text-destructive">
            bb could not start the thread. Your draft is kept — try again.
          </p>
        ) : null}
        {/* No scroll wrapper around the composer: the host promptbox's
        typeahead menus (@-mentions and "/" commands) render position:absolute
        against the prompt form and reach ABOVE it; any overflow-scroll/hidden
        ancestor of that form erases them (found live: with the wrapper, the
        @-menu was in the DOM but invisible). The composer is short — the
        overflow risk the old max-h-[70vh] guard chased does not warrant
        resurrecting the clipper; the host keeps its own internal editor
        scroll. */}
        {/* The composer wrapper is the plugin's own (bb's DOM is only read,
        never written): it carries `relative` so the floating New project
        button (below, when the pickers row is anchored) absolute-positions
        against it, and so lib/composer-row-anchor's offsets and the row's
        ResizeObserver have a stable containing element. The
        data-composer-wrap attribute is the wrapper's stable handle — the
        tests' stub rows resolve their mock offsetParent by it and the
        browser probe locates the measured geometry on it. */}
        <div ref={setWrapperElement} className="relative" data-composer-wrap="">
          <NewThreadComposer
            defaultProjectId={createdProjectId ?? defaultProjectId}
            {...(defaultEnvironment !== undefined ? { defaultEnvironment } : {})}
            {...(defaultProviderId !== undefined ? { defaultProviderId } : {})}
            {...(defaultModel !== undefined ? { defaultModel } : {})}
            focusRequest={focusRequest}
            onSubmit={handleSubmit}
          />
          {floatingOption ? (
            // On the pickers row's line (lib/composer-row-anchor): the
            // measured placement puts this button's right edge at the row's
            // content start — exactly where the project picker's click area
            // begins — and centers it on the row's line. Out of flow, so
            // the dialog below the composer holds nothing (the dead band's
            // source): the dialog ends at the composer plus its own padding.
            <button
              type="button"
              data-new-project-option=""
              aria-label="New project"
              title="New project"
              onClick={startCreateProject}
              disabled={pickingPending}
              className="absolute inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              style={{
                top: footerRowPlacement!.top,
                left: footerRowPlacement!.left,
              }}
            >
              <Icon name="FolderPlus" className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {onCreateProject !== undefined && !floatingOption ? (
          <div data-new-project-footer="" className="mt-1 flex flex-col items-start gap-0.5">
            {creatingProject ? (
              <div className="flex items-center gap-1 px-1 py-1">
                <Input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCreateProject();
                    } else if (event.key === "Escape") {
                      // Radix's document-level Escape would also close the
                      // whole dialog; default-preventing here keeps it for
                      // the field alone (the host checks defaultPrevented).
                      event.preventDefault();
                      setCreatingProject(false);
                      setNewProjectName("");
                      setCreateError(null);
                    }
                  }}
                  placeholder="Project name"
                  aria-label="New project name"
                  autoFocus
                  disabled={createPending}
                  className="h-7 text-xs"
                />
                <button
                  type="button"
                  aria-label="Create project"
                  disabled={createPending || newProjectName.trim() === ""}
                  onClick={submitCreateProject}
                  className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                >
                  <Icon name="Check" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Cancel new project"
                  onClick={() => {
                    setCreatingProject(false);
                    setNewProjectName("");
                    setCreateError(null);
                  }}
                  className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon name="X" className="size-3.5" aria-hidden />
                </button>
              </div>
            ) : (
              // The stacked fallback (compact viewports, unmeasurable rows,
              // the tests' stub composers): the same icon-only button in
              // flow under the composer's bottom-left where the project
              // picker's row sits, the shape the option shipped in before
              // the row anchor existed. Same click: the picker flow where
              // the app hands it off, the name field otherwise.
              <button
                type="button"
                data-new-project-option=""
                aria-label="New project"
                title="New project"
                onClick={startCreateProject}
                disabled={pickingPending}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Icon name="FolderPlus" className="size-4" aria-hidden />
              </button>
            )}
            {createError === null ? null : (
              <p
                role="alert"
                data-new-project-error=""
                className="px-1 text-xs text-destructive"
              >
                {createError}
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
