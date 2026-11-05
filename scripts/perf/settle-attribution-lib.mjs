/**
 * The settle-attribution's pure math (no browser, no DOM): the burst, commit,
 * and driver aggregations that turn the instrument's raw timeline — mutation
 * records, the React commit census, rpc marks — into a per-driver attribution
 * of the post-paint settle tail. Pure and dependency-free so the arithmetic
 * is unit-testable without a browser, like load-stages.mjs.
 *
 * The pieces, in order:
 * - `rpcRunsFromMarks` — the per-method {start,end} runs from `__perfMarks`
 *   (every call the mock's instrumented wrapper pushes, mount fan-in or not).
 * - `settleFence` — the load bench's settle-stage fence: max(first card, last
 *   mount rpc end).
 * - `burstsFromMutationRecords` — mutation records grouped into bursts (one
 *   burst per observer callback: one React commit's mutation phase plus its
 *   microtask flush).
 * - `assignBurstsToCommits` — each burst's React commit: the last census
 *   commit whose hook time is at or before the burst's start plus slack (the
 *   hook fires inside the commit, after its mutation phase; the observer
 *   callback fires after the task). null for bursts no commit matches —
 *   churn that did not come from React (harness glue, content scripts).
 * - `driversFromTimeline` — commits after the fence grouped into drivers:
 *   an rpc method when one of that method's end marks sits inside the
 *   commit's render window (the setStates ran in that resolution), else
 *   `no-rpc-effect` (a timer, a mount-echo effect without an rpc, a stamp).
 *   Each driver carries its commits, its rendered-component census, its
 *   mutation counts and location buckets, and its wall extent in the tail.
 */

export const BURST_ASSIGN_SLACK_MS = 8;
export const DRIVER_RPC_SLACK_MS = 12;
export const BURST_GAP_MS = 8;

/** The load bench's settle fence: the max of first-card and the last mount
 *  fan-in rpc end (mountRpcNames filter; null = every rpc run counts). */
export function settleFence(firstCardAt, rpcRuns, mountRpcNames) {
  let lastMountEnd = null;
  for (const run of rpcRuns) {
    if (mountRpcNames === null || mountRpcNames.includes(run.method)) {
      if (lastMountEnd === null || run.end > lastMountEnd) lastMountEnd = run.end;
    }
  }
  return maxNullable(firstCardAt, lastMountEnd);
}

/** Per-method {method, start, end} runs: `fb-rpc-start:<method>` paired with
 *  the next `fb-rpc-end:<method>` in mark order. The pairing rule the load
 *  bench's stage math uses (first open start, sequential pairs), so the two
 *  can never disagree about which end belongs to which call. */
export function rpcRunsFromMarks(marks) {
  const openStarts = new Map();
  const runs = [];
  for (const { label, t } of marks) {
    if (label.startsWith("fb-rpc-start:")) {
      const method = label.slice("fb-rpc-start:".length);
      if (!openStarts.has(method)) openStarts.set(method, t);
    } else if (label.startsWith("fb-rpc-end:")) {
      const method = label.slice("fb-rpc-end:".length);
      if (openStarts.has(method)) {
        runs.push({ method, start: openStarts.get(method), end: t });
        openStarts.delete(method);
      }
    }
  }
  return runs;
}

/**
 * Mutation records (appended in observation order: {t, kind, where}) →
 * bursts. Records within `gapMs` of the burst so far join it; a bigger gap
 * starts a new burst. Kinds are the instrument's: "add"/"remove" (childList,
 * the load bench's settle clock) and "text" (characterData, which the bench's
 * clock does NOT count — its records are still gathered so the attribution
 * can show the tail's full extent).
 */
export function burstsFromMutationRecords(records, gapMs = BURST_GAP_MS) {
  const bursts = [];
  for (const record of records) {
    const last = bursts[bursts.length - 1];
    if (last !== undefined && record.t - last.t1 <= gapMs) {
      last.t1 = Math.max(last.t1, record.t);
      last.count += 1;
      last.kinds[record.kind] = (last.kinds[record.kind] ?? 0) + 1;
      last.where[record.where] = (last.where[record.where] ?? 0) + 1;
      if (record.what) last.what[record.what] = (last.what[record.what] ?? 0) + 1;
    } else {
      bursts.push({
        t0: record.t,
        t1: record.t,
        count: 1,
        kinds: { [record.kind]: 1 },
        where: { [record.where]: 1 },
        what: record.what ? { [record.what]: 1 } : {},
      });
    }
  }
  for (const burst of bursts) {
    burst.where = trimCountObject(burst.where);
    burst.what = trimCountObject(burst.what, 8);
  }
  return bursts;
}

/**
 * The React commit each burst came from: the last commit with
 * `t <= burst.t0 + slackMs` (mutations happen inside the commit task, before
 * its hook fires; the observer callback lands right after the task). A burst
 * with no committed React work before it maps to null (unattributed —
 * non-React DOM work, e.g. harness glue).
 */
export function assignBurstsToCommits(bursts, commits, slackMs = BURST_ASSIGN_SLACK_MS) {
  const byIndex = new Map();
  let pointer = -1;
  for (let burstIdx = 0; burstIdx < bursts.length; burstIdx += 1) {
    const burst = bursts[burstIdx];
    while (pointer + 1 < commits.length && commits[pointer + 1].t <= burst.t0 + slackMs) {
      pointer += 1;
    }
    byIndex.set(burstIdx, pointer >= 0 ? pointer : null);
  }
  return byIndex;
}

/** One commit's driver key: the rpc method whose END mark sits inside the
 *  commit's render window [prevT - slack, t + slack] (that resolution's
 *  setStates caused the commit), nearest to the window's middle; null when
 *  no rpc resolution is anywhere near — a timer- or effect-driven commit. */
export function driverKeyForCommit(commit, rpcRuns, slackMs = DRIVER_RPC_SLACK_MS) {
  const windowStart = (commit.prevT ?? 0) - slackMs;
  const windowEnd = commit.t + slackMs;
  const inside = rpcRuns.filter((run) => run.end >= windowStart && run.end <= windowEnd);
  if (inside.length === 0) return null;
  const windowMid = ((commit.prevT ?? commit.t) + commit.t) / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const run of inside) {
    const distance = Math.abs(run.end - windowMid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = run;
    }
  }
  return best.method;
}

/**
 * The tail's per-driver table. `commits` are census records ({idx, t, prevT,
 * names, ...}); bursts come pre-assigned via `burstCommits` (Map burst index
 * → commit index, or null). Bursts ending at or before `fence` are not part
 * of the settle tail and are reported once, aggregated, under `beforeFence`.
 * Each driver entry carries:
 *
 * - `key`: "rpc:<method>" (rpc-resolution commits; mount-list landings share
 *   the key, separated later by method when needed), "no-rpc-effect"
 *   (timer/effect-driven commits), or "no-commit" (DOM work outside React).
 * - `commits`: the census indices.
 * - `firstMutationT`/`lastMutationT`: the driver's wall extent in the tail.
 * - `childMutations`/`textMutations`: counts by kind.
 * - `where`: aggregated location buckets.
 * - `renderedByName`: the commits' rendered-component census, aggregated.
 */
export function driversFromTimeline({ commits, bursts, burstCommits, rpcRuns, fence }) {
  if (typeof fence !== "number" || !Number.isFinite(fence)) {
    throw new Error("driversFromTimeline: fence must be a finite number (first card or mount rpc end)");
  }
  const byKey = new Map();
  const ensure = (key) => {
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = {
        key,
        commits: [],
        firstMutationT: null,
        lastMutationT: null,
        childMutations: 0,
        textMutations: 0,
        whereCounts: new Map(),
        whatCounts: new Map(),
        renderedByName: new Map(),
      };
      byKey.set(key, entry);
    }
    return entry;
  };
  let orphanChild = 0;
  let orphanText = 0;
  let orphanBursts = 0;
  let beforeFenceChild = 0;
  let beforeFenceText = 0;
  for (let burstIdx = 0; burstIdx < bursts.length; burstIdx += 1) {
    const burst = bursts[burstIdx];
    const commitIdx = burstCommits.get(burstIdx) ?? null;
    const burstChild = (burst.kinds.add ?? 0) + (burst.kinds.remove ?? 0);
    const burstText = burst.kinds.text ?? 0;
    if (burst.t1 <= fence) {
      beforeFenceChild += burstChild;
      beforeFenceText += burstText;
      continue;
    }
    if (commitIdx === null) {
      orphanChild += burstChild;
      orphanText += burstText;
      orphanBursts += 1;
      continue;
    }
    const commit = commits[commitIdx];
    const method = driverKeyForCommit(commit, rpcRuns);
    const key = method === null ? "no-rpc-effect" : `rpc:${method}`;
    const entry = ensure(key);
    entry.commits.push(commitIdx);
    entry.firstMutationT = entry.firstMutationT === null ? burst.t0 : Math.min(entry.firstMutationT, burst.t0);
    entry.lastMutationT = entry.lastMutationT === null ? burst.t1 : Math.max(entry.lastMutationT, burst.t1);
    entry.childMutations += burstChild;
    entry.textMutations += burstText;
    for (const [where, count] of Object.entries(burst.where)) {
      entry.whereCounts.set(where, (entry.whereCounts.get(where) ?? 0) + count);
    }
    for (const [shape, count] of Object.entries(burst.what ?? {})) {
      entry.whatCounts.set(shape, (entry.whatCounts.get(shape) ?? 0) + count);
    }
    for (const named of commit.names ?? []) {
      const [name, count] = splitNamedCount(named);
      entry.renderedByName.set(name, (entry.renderedByName.get(name) ?? 0) + count);
    }
  }
  const drivers = [...byKey.values()].sort(
    (a, b) => (a.firstMutationT ?? Infinity) - (b.firstMutationT ?? Infinity),
  );
  return {
    drivers: drivers.map((entry) => ({
      ...entry,
      where: sortedCounts(entry.whereCounts),
      what: sortedCounts(entry.whatCounts),
      renderedByName: sortedCounts(entry.renderedByName),
    })),
    orphans: { childMutations: orphanChild, textMutations: orphanText, bursts: orphanBursts },
    beforeFence: { childMutations: beforeFenceChild, textMutations: beforeFenceText },
  };
}

/** Sorted [{name, count}, ...] descending — the census string shape per key. */
function sortedCounts(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

/** "Name×12" → ["Name", 12] (the census's per-commit shape). */
function splitNamedCount(named) {
  const at = named.lastIndexOf("×");
  if (at < 0) return [named, 1];
  const count = Number(named.slice(at + 1));
  if (!Number.isFinite(count)) return [named, 1];
  return [named.slice(0, at), count];
}

/** Keep at most `keep` buckets; the rest folds into one "__rest" bucket. */
export function trimCountObject(counts, keep = 6) {
  const entries = Object.entries(counts);
  if (entries.length <= keep) return counts;
  entries.sort((a, b) => b[1] - a[1]);
  const kept = Object.fromEntries(entries.slice(0, keep));
  const rest = entries.slice(keep).reduce((sum, [, count]) => sum + count, 0);
  kept.__rest = rest;
  return kept;
}

function maxNullable(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
