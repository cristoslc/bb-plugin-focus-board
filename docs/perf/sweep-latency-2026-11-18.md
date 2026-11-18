# Why a lane sweep to Done was slow, and what fixed it (2026-11-18)

The operator reported, while sweeping the **Idle · A while ago** lane to Done:
"sweeping 'Idle - A while ago' to 'Done' is incredibly slow. why? how can we speed it up?"
This document is the measurement, the attribution, the fix, and the same measurement after
the fix. Every number here comes from `scripts/perf/sweep-latency.mjs`, a committed probe
that changes no behavior in the app, the harness, or the server.

## The probe, in one paragraph

The probe drives the real app in the screenshot harness at a chosen board size and bridge
latency, waits for a genuinely quiet board (card count stable and no mutation for a second, so
a mounting board is never mistaken for a gesture), arms the lane's broom, confirms it, and
reads three clocks: the harness's own `fb-rpc-start`/`fb-rpc-end` marks per `done_set` call, a
React commit census through the DevTools hook contract (one record per commit), and a lane
sampler that timestamps each swept card the moment it appears in the Done lane. A long-task
observer and the harness's rpc log (for the coalesced refetch passes) ride along. Per card it
reports queue → rpc sent → rpc settled → card painted; over a run it reports the run's wall,
the last card's wall, the lane's visual clear, RPC busy time, long tasks, and refetch passes.

**The profile is the production build**, not the dev harness: `npx vite build --config
scripts/screenshot/vite.probe.config.ts`, `npx vite preview` on 5174, and
`HARNESS_URL=http://localhost:5174/`. The dev harness serves React's development build, which
the screenshot README warns overstates cost; a section at the end carries that run as a
cross-check.

**The board shape matters more than the lane size.** `?scale=N` appends live threads, but a
long-lived workspace accumulates **Done** cards — the operator's own board carries 1,363 live
Done cards beside 390 live threads — and the Done column is rebuilt by every board assembly.
The probe therefore also uses a `?done=N` fixture (added in this branch) so the board under
measurement has the Done density a real workspace reaches.

**Bridge latency** is `?rpcLatency=15`: this machine's focus-board server averages 12.0ms per
handler over 549,363 recorded calls (`bb plugin list`), plus the IPC hop.

**The operator's lane** is 9 cards (Idle · A while ago over `bb thread list --json` and
`bb focus-board done list --json`: 396 live threads, 1,363 live Done cards). The probe sweeps
11-card and 62-card lanes, which bracket that and give the trend its points.

## What the gesture did before the fix

`confirmSweepFor` awaited one `done_set` RPC per card and applied a fresh `doneIds` Set after
each one, and `runSweep` was strictly sequential. That sequentiality was correct for the
host-action arms (the host's sidebar writes are single-slot; the original 2026-10-01 bug was an
unawaited loop applying only the last candidate), and the idle→Done arm inherited it even
though its gesture is the board's own RPC.

Each `doneIds` identity invalidates the board's assembly memo, so the whole board recomputes
and reconciles once per card. That is the cost that grows with the board:

| Board | Lane | Run wall | Last card | Per card | Long tasks | Refetch passes |
|---|---|---|---|---|---|---|
| 1,394 cards (1,305 Done) | 11 | **1,224ms** | 1,235ms | 112ms | 619ms | 12 |
| 1,674 cards (1,305 Done) | 62 | **8,292ms** | 8,228ms | 133ms | 4,936ms | 93 |
| 94 cards (5 Done) | 11 | 238ms | 211ms | 19ms | none | 3 |
| 374 cards (5 Done) | 62 | 2,847ms | 2,806ms | 45ms | none | 39 |

Medians of three runs after a discarded warm-up, same machine. The two dense rows are
committed as raw output: `sweep-latency-before-prod-2026-11-18T04-05-24-986Z.json`, which holds
both lane sizes (`--scales 40,250`).

### The attribution

The commission named three costs. Measured, the split is not even close:

1. **Serial round trips — minor.** A `done_set` is a 15ms modeled bridge wait; eleven of them
   serially is ~165ms of a 1,224ms run. The probe's per-call wall reads 90-101ms on the dense
   board only because the main thread is busy when the timer would fire — the wait is real but
   small, and removing it alone would not have made the gesture feel fixed.
2. **N assembly recomputes plus a full-board reconciliation and paint — dominant.** One per
   card. The same eleven-card gesture costs 19ms per card on a 94-card board and 112ms per card
   on a 1,394-card one: the cost tracks the Done column's density, not the lane's length. 619ms
   of the 1,224ms is main-thread long-task time, and the twelve coalesced refetch passes each
   re-render the board too (each `done-changed` echo schedules a pass whose `done_list` answer
   replaces the `doneIds` set, which is another assembly pass).
3. **N paints — the same cost as (2).** The commits are the paints; there is no separate term.

A fourth term the commission did not list, smaller but real: each card's `onActive`/`onSettled`
progress update is its own commit (30+ of them in an eleven-card run). Left alone; it is cheap
and it is what makes the pill count.

A single done toggle on the same dense board, measured separately on the dev build where the
React profiler timing is available, costs ~370ms of wall with one 377ms long task and the board
reconciling every card twice (the optimistic write, then the echo). That is the per-write cost
the serial sweep paid eleven times.

## The fix

Batching, at both levels the measurement pointed at:

- `runSweep` takes `concurrency` (default 1, so every other arm is byte-identical to before) and
  a new `onBatchSettled` callback that fires once per batch with the ids that resolved.
  `shouldContinue` is asked between batches, and a cancel still finishes the batch in flight:
  cancel means "no more", not "yank what is running". A rejection inside a batch is collected
  per id, and the other ids in that batch still count as swept.
- The idle→Done arm raises `concurrency` to `SWEEP_BATCH_CONCURRENCY` (6) and applies **one**
  `doneIds` write per batch, plus the batch's unread follow-ups through one serial queue (the
  host's sidebar writes are single-slot, so six read marks must not overlap).
- The other arms (Archive, Unpinned, Read) stay at 1: their gestures are host sidebar actions,
  which the single-slot design forbids overlapping.

Failure reporting is unchanged and tested: a failed card is named in the banner, stays armed for
a one-click retry, and never lands in `swept`, so undo never touches it.

## The same measurement after the fix

| Board | Lane | Run wall | Last card | Lane clear | Per card | Speedup |
|---|---|---|---|---|---|---|
| 1,394 cards (1,305 Done) | 11 | **297ms** | 228ms | 592ms | 21ms | **4.1×** |
| 1,674 cards (1,305 Done) | 62 | **1,722ms** | 1,815ms | 2,248ms | 29ms | **4.8×** |
| 94 cards (5 Done) | 11 | 77ms | 48ms | 372ms | 4ms | 3.1× |
| 374 cards (5 Done) | 62 | 631ms | 674ms | 1,005ms | 11ms | 4.5× |

Medians of three runs after a discarded warm-up, same machine, same tree plus this branch.
The committed counterpart is `sweep-latency-after-prod-2026-11-18T04-07-25-636Z.json`.

The sparse rows and the dev-harness cross-check below are NOT committed: two JSON dumps per
battery is unreadable weight in the tree, and both reproduce in one command each from the probe
on the same machine. Sparse: `HARNESS_URL=http://localhost:5174/ npm run perf:sweep --
--scales 40,250 --repeats 3 --warmup 1 --latency 15 --done 0 --label sparse`. Dev harness: drop
`HARNESS_URL` and rebuild `dist/app.css` first. The probe writes its report under `docs/perf/`;
delete the file after reading it.

"Lane clear" is when the last departing card's dissolve ghost leaves the lane. That tail is a
fixed ~320ms animation (`TRANSPORT_*` in `components/card-transport.ts`) and does not shrink
with the sweep: on the eleven-card dense lane the run itself ends at 297ms and the lane's last
ghost is gone at 592ms, but six cards dissolve at once instead of one every few hundred
milliseconds.

On the operator's shape (9 cards, 1,363 live Done cards) the same per-card cost predicts about
1.0s before and about 0.25s after: the sweep becomes a short, even progress instead of a board
that locks for a second.

## Cross-check on the dev harness

The same four cells on the dev harness (`npm run perf:sweep` with no `HARNESS_URL`), where the
React profiler timing is available: 2,524ms → 508ms at 11 cards on the dense board (5.0×) and
12,237ms → 2,893ms at 62 cards (4.2×). Same ranking, same batching effect, larger absolute
costs because the development build pays several times more per render. The React census in that
run shows the writes themselves are batching as designed: the 62-card sweep's commit count drops
from 165 to 39, and the eleven-card sweep's from 36 to 15.

## What is still on the table

After the fix the ceiling is one board pass per batch. That pass is the reconciliation walk plus
the layout and paint of every card, and ANY state write on a board this size pays it: a single
done toggle on 1,394 cards costs ~370ms. Shrinking it means memoizing whole lanes so an
unchanged Done lane need not be walked at all, or capping what the Done column renders. Both are
board-wide changes with their own design questions, so they are not part of this fix. This
section is where that work starts.

The harness models the bridge as an in-page timer, so the probe's per-call wall on a busy main
thread overstates the bridge and understates nothing else. The before/after ratio on one tree is
the claim; absolute wall-clock on a live bb is not.
