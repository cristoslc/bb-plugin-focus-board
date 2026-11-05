import { PROJECT_PATH_ROOT_REFUSAL, projectFolderName } from "./project-folder-name";

/**
 * The board's New project flows, through the board's one create path.
 *
 * The dialog's New project button follows bb's TYPICAL new-project flow
 * (decoded from bb 0.48.1's bundles — the main view's New project entry,
 * its project-path dialog hook, and its create mutation): the NATIVE
 * folder picker opens on the bb client's own machine through
 * `hosts.pickFolder`, the project is named after the picked folder's last
 * segment, and `projects.create` receives that local_path source. A
 * cancelled pick creates nothing and the dialog rests, the same answer
 * bb's own flow gives a null pick.
 *
 * The pick runs only when exactly ONE persistent host serves the board.
 * The plugin cannot read bb's own client-host id (the desktop API's
 * localDaemonHostId is not exposed to plugins; BbContext carries only
 * project and thread ids), so the host can be honestly named as the
 * machine to ask only where the board's host list leaves no ambiguity:
 * one connected persistent host IS the bb client's machine. Any other
 * topology throws with the reason; the dialog arms its inline name field
 * with the reason shown — that field creates under the host's
 * bb-projects folder, the pre-picker shape the affordance shipped in and
 * still the closest equivalent of bb's own path-entry fallback.
 */

/** The SDK surface the flow needs; structural, so test stubs satisfy it. */
export interface ProjectCreateSdk {
  hosts: {
    list(
      args?: { includeCreating?: boolean },
    ): Promise<
      Array<{
        id: string;
        name: string;
        status: "connected" | "disconnected" | string;
        type: "persistent" | "ephemeral" | string;
      }>
    >;
    pickFolder(args: {
      hostId: string;
      clientHostId: string;
    }): Promise<{ path: string | null }>;
  };
  projects: {
    create(args: {
      name: string;
      source: { type: "local_path"; hostId: string; path: string };
    }): Promise<{ id: string }>;
  };
}

/** The dialog's folder-picker flow's result: the created project's id, or
 *  null when the operator cancelled the native pick (nothing to create —
 *  the dialog rests). */
export interface CreatedFromFolderPick {
  id: string | null;
}

/**
 * Run the typical flow: the native folder picker on the board's single
 * connected persistent host, then the create with the folder's own name.
 * Throws (with the operator-facing reason) when no host can honestly be
 * asked, when the create write refuses, or when the picked path names no
 * project directory; those land in the dialog's inline name field with the
 * reason shown.
 */
export async function createProjectFromPickedFolder(
  sdk: ProjectCreateSdk,
): Promise<CreatedFromFolderPick> {
  const hosts = await sdk.hosts.list();
  const persistent = hosts.filter(
    (host) => host.status === "connected" && host.type === "persistent",
  );
  if (persistent.length === 0) {
    throw new Error("No connected host to pick a project folder on.");
  }
  if (persistent.length > 1) {
    throw new Error(
      "Several hosts make this board, so the folder picker cannot know which machine to ask. Name the project instead.",
    );
  }
  const host = persistent[0];
  const pick = await sdk.hosts.pickFolder({ hostId: host.id, clientHostId: host.id });
  const folderPath = pick.path;
  if (folderPath === null) return { id: null };
  const name = projectFolderName(folderPath);
  if (name === "") {
    throw new Error(PROJECT_PATH_ROOT_REFUSAL);
  }
  const created = await sdk.projects.create({
    name,
    source: { type: "local_path", hostId: host.id, path: folderPath },
  });
  return { id: created.id };
}
