// Reading a host list resource whole (issue #504).
//
// bb's `GET /threads` and `GET /environments` cap a call that names no
// `limit` at 200 rows, and refuse a `limit` above 500 with a 400. Once
// get-bb/bb#7932 ships, `limit` is required in the SDK types outright. This
// board holds more than 200 threads, so a one-shot read silently dropped
// every row past the cap, and the damage is not cosmetic: a group whose
// members all fell past the row was pruned out of the registry, a snooze
// past it never armed, and done, park, link, ack, snooze, and group state on
// those threads read as absent. The host does not sort the list by recency,
// so the surviving 200 were arbitrary rather than the ones a reader expects.
//
// Every read of either resource goes through `readAllPages`: it asks for the
// host's ceiling (500, the largest limit the host accepts) at offset 0, then
// the next offset, until a page comes back shorter than the ceiling. The
// pages concatenate in order, so the result is exactly the list one unbounded
// call used to return. Filters stay at the call site and ride every page,
// because an archived or project-scoped read drops past the cap the same way
// the live one did.
//
// The offset advances by the rows a page actually served, never by the
// requested limit, so a short page both ends the loop and proves the list
// ended at that offset. Two host behaviours would otherwise hand back a
// silent partial list, and both throw instead, naming the resource and the
// offset: a page longer than the ceiling (the host ignored `limit`), and rows
// served twice (the host is not advancing `offset`).

/** The largest `limit` bb accepts on a paged list call (issue #504). */
export const HOST_PAGE_LIMIT = 500;

/** One page request, the shape both list calls take. */
export interface HostPageRequest {
  limit: number;
  offset: number;
}

/** The two host resources the SDK lists in pages. */
export type HostListResource = "threads" | "environments";

/**
 * Read every page of a host list resource, in order. `fetchPage` owns the
 * filters: spread the request into the call and add them at the call site
 * (`(page) => bb.sdk.threads.list({ ...page, archived: true })`), so a
 * filtered scan keeps the filter on every page it asks for.
 */
export async function readAllPages<T>(
  resource: HostListResource,
  fetchPage: (request: HostPageRequest) => Promise<readonly T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  const served = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await fetchPage({ limit: HOST_PAGE_LIMIT, offset });
    if (page.length > HOST_PAGE_LIMIT) {
      throw new Error(
        `paged ${resource} read: the host served ${page.length} rows for limit ${HOST_PAGE_LIMIT} at offset ${offset}, so the limit is being ignored`,
      );
    }
    if (page.length > 0) {
      // The rows themselves are the page's identity: a host that ignores
      // `offset` hands back the same rows while the request says it
      // advanced, and concatenating them would double the list instead of
      // failing.
      const signature = JSON.stringify(page);
      if (served.has(signature)) {
        throw new Error(
          `paged ${resource} read: the host served the same ${page.length} rows again at offset ${offset}, so it is not advancing the offset`,
        );
      }
      served.add(signature);
    }
    rows.push(...page);
    if (page.length < HOST_PAGE_LIMIT) return rows;
    offset += page.length;
  }
}
