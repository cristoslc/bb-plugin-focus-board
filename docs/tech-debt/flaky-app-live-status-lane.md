# 2026-11-17: `tests/app-live-status-lane.test.tsx` fails under a full-suite run

## What happens

A full `npm test` intermittently fails one test in `tests/app-live-status-lane.test.tsx`, and the failing test is not always the same one. Two observed failures:

- `a live idle → active flip while the card's attention is frozen > with the pane open on it, the card moves from Unread to Working`
- `a live idle → active flip while the card's attention is frozen > re-lanes when the pane closes after the flip (no leaked pin)` — `AssertionError: expected [ 'thr_busy' ] to not include 'thr_busy'` at `tests/app-live-status-lane.test.tsx:120`

## The evidence that it is pre-existing

- The file passes on its own, three runs in a row, on the branch that first noticed it (`fix/mention-claim-before-host-gate`) and on `origin/dev`.
- Unmodified `origin/dev` at `f6c0b52` fails the same file in a full run: `Test Files 1 failed | 239 passed (240)`, the same test.
- The failure survives `vitest run --maxWorkers=8`, so it is not only worker count; it reproduces under the full 240-file suite and not under a single-file run.

So the trigger is load across the suite combined with the test's own timing budget, not a behavioural regression in the pane, the board, or the host-capability gate.

## What a fix would look like

The assertions use `waitFor` with a default 1s timeout over a 2s-scale flip, and the sequence drives real timers through attention freeze and the pane close. The likely fix is to pin the clock (fake timers) or to raise the specific `waitFor` timeouts and say why, rather than to widen the global test timeout.

## Why it is recorded here instead of fixed in the same change

It was found while verifying an unrelated pane fix, it reproduces on `origin/dev` without that fix, and a timing test rewritten under time pressure is a good way to hide a real regression later. It deserves its own change with its own red-first evidence.
