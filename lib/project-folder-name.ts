/**
 * The project name bb derives from a picked folder in its typical
 * new-project flow — verified against bb 0.48.1's bundle (its `go`, `mo`,
 * `no` and `Fee` path utilities): the name is the folder's last path
 * segment after trailing separators are stripped. bb's parser splits each
 * flavor's ROOT off first — the POSIX leading "/" and the Windows drive
 * (or UNC machine) are the root, never a segment — so a filesystem root
 * yields no name at all. Both flavors of separator are handled so a
 * Windows-picked folder names itself the way bb's own parser does.
 *
 * bb's own refusal words are kept verbatim (its root check's message) so a
 * refused root reads the same at this plugin as it does in bb's main view.
 * bb's fuller validation (absolute-path and Windows-network-path checks)
 * guards its typed-path entry dialog; the plugin's picker flow has no
 * typed path — the picked path comes from the OS's own folder dialog — so
 * the root refusal is the only check the picked path can still trip.
 */

/** bb's words for a picked path that names no project directory. */
export const PROJECT_PATH_ROOT_REFUSAL =
  "Project path must point to a project directory, not the filesystem root.";

/**
 * The project name for a picked folder path: the last path segment after
 * trailing separators are stripped, or "" when nothing remains (the caller
 * refuses the create with PROJECT_PATH_ROOT_REFUSAL). Empty segments (a
 * POSIX root's leading slash) and flavor roots (the Windows drive) never
 * name.
 */
export function projectFolderName(folderPath: string): string {
  const stripped = folderPath.trim().replace(/[\\/]+$/u, "");
  if (stripped === "") return "";
  // A bare Windows drive ("C:") is the filesystem root of its own volume;
  // a UNC machine ("\\\\server") is the network root. bb's parser reads
  // each as root-only, no segments, so neither names a project.
  const windowsDrive = /^[A-Za-z]:$/u.test(stripped);
  const uncMachine = /^\\\\[^\\/]+$/u.test(stripped);
  const windowsFlavor = windowsDrive || uncMachine || /^[A-Za-z]:[\\/]/u.test(stripped);
  const segments = windowsFlavor
    ? windowPathSegments(stripped)
    : stripped.split(/[\\/]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? "";
}

/** The path's segments past a Windows flavor's root (the drive or the UNC
 *  machine); a root-only path yields none. */
function windowPathSegments(stripped: string): string[] {
  if (/^[A-Za-z]:$|^\\\\[^\\/]+$/u.test(stripped)) return [];
  return stripped.split(/[\\/]/u).slice(1).filter((segment) => segment !== "");
}
