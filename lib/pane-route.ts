/**
 * The open thread pane's place in the panel's own URL.
 *
 * bb gives every nav panel a `subPath` route remainder
 * (`/plugins/<pluginId>/board/*` → `subPath`) and a navigate API whose
 * pushes participate in browser history: `useBbNavigate().toPluginPanel(
 * path, { subPath })`. Keeping the open pane's thread there means bb's own
 * back arrow (and a plain reload or shared link) restores the exact pane the
 * user left — the pane state is the URL, not component state that dies on the
 * first link-out to main bb.
 *
 * Shape: `t/<threadId>`, e.g. `t/thr_abc123`. A short segment prefix keeps the
 * scheme open for future sub-locations without colliding with them.
 */

const PANE_PREFIX = "t/";

/** A thread id: bb ids are `thr_…`; allow the same charset generically. */
const THREAD_ID_PATTERN = /^[\w-]+$/;

/** The subPath that routes the panel to an open pane for `threadId`. */
export function paneSubPathFor(threadId: string): string {
  return `${PANE_PREFIX}${threadId}`;
}

/**
 * The thread id a panel `subPath` routes to, or null when the subPath is the
 * panel root or anything that is not a single-segment thread route. A null
 * here means "no pane", so malformed deep links degrade to the plain board
 * instead of opening a pane for a garbage id.
 */
export function paneThreadIdFromSubPath(subPath: string): string | null {
  if (!subPath.startsWith(PANE_PREFIX)) return null;
  const id = subPath.slice(PANE_PREFIX.length);
  if (id === "" || !THREAD_ID_PATTERN.test(id)) return null;
  return id;
}
