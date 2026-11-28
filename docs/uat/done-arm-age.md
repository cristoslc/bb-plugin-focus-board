# The Done sweep selects cards younger than the sweep age

The operator's report, 2026-11-28: the Done → archive sweep still selects
cards younger than the configured 2 days. This run answers it with the live
board's own numbers, on both boards, and separates what the sweep *arms* from
what the board *paints*.

> [!IMPORTANT]
> The eligibility law held. Every armed card on both boards was past the
> 2-day threshold. What the operator saw was the paint: an armed card
> labelled its last activity ("33m ago") instead of its Done age, and every
> joinable card in the armed lane wore the sweep's amber ring at rest,
> younger ones included.

## What was measured

Probe: `scripts/screenshot/probe-done-arm-age.mjs`. It opens the installed
board in a browser context of its own, reads the Done lane's pill, arms it,
reads every card's paint state and age label, disarms with Escape, and
repeats on the Parent view's Done row. It never confirms and writes nothing.
Raw record and frames: `docs/screenshots/done-arm-age-20261128T134120/`
(`evidence.json` plus the before/armed/disarmed shots); the generated table is
`docs/uat/done-arm-age-20261128T134120.md`. The frame after the fix, from the
screenshot harness (real app, mocked host):
`docs/screenshots/done-arm-age-after-fix/harness-done-armed.png`.

| Fact | Live value |
| --- | --- |
| Done threshold (`bb plugin config`) | 2 days = 172800000 ms |
| Live threads carrying a Done record | 341 |
| Of those, past the threshold and unkept | 231 |
| Minus live-child parents (the arm's ceiling) | 230 |
| Marked Done inside the threshold (one 21:48 ET batch) | 110 |
| Focus Done lane, armed | 15 |
| Focus armed cards younger than the threshold | 0 |
| Parent Done row, armed | 177 |
| Parent armed cards younger than the threshold | 0 |

## The two paint defects

The arm's membership was right on both boards: no card inside the 110-thread
batch was armed, and every armed card's Done stamp was 60 to 104 hours old.
The card faces disagreed with that, in two ways.

1. **The age chip used the wrong clock.** A Done card painted its last
   activity, and Done threads keep receiving agent activity after being
   marked Done. Three armed Focus cards read `33m`/`35m ago` while their Done
   stamps were 60.4h and 95.5h old (`thr_by4i6v9n6b`, `thr_6kcadz3nq9`,
   `thr_e8rfjse49w`); on the Parent row 165 of 177 armed cards were labelled
   inside a day. Read off the card, the sweep looks like it selected fresh
   work.
2. **The join affordance painted as selection.** Sweep mode gave every card
   that *may* join the arm `ring-1 ring-amber-500/40` at rest. In the armed
   Focus lane seven such cards were all inside the threshold, including
   `thr_mjddmf62qi`, marked Done 0.6 hours earlier; the Parent row carried 103
   of them. Amber at rest could not be told apart from "in the sweep".

## What changed

- Done cards and Done nested rows label themselves with the Done stamp, the
  clock `sweepCandidatesForDoneColumn` filters on (`data-age-source="done"`,
  text `Done 2d ago`), with last activity kept in the tooltip. A family's Done
  projection and a live child in the Done lane carry no Done stamp and keep
  activity text.
- The join affordance is a hover/focus reveal. Amber at rest now means armed.

Both changes are in `components/thread-card.tsx`; the stamp lookup travels
app → Board / ParentLaneBoard / CardGrid as `doneMarkedAtFor`.

## The CLI mirror was broken too

`bb focus-board sweep` failed with `bb focus-board failed: fetch failed` on
every run (dry run, `--json`, and `--ids` alike) while `bb focus-board done
list` succeeded in the same second. Cause, measured from the board's own page:
the sweep built its facts with one unbounded `Promise.all` over every
candidate row, 2,291 rows × (Done record + snooze record) = 4,582 concurrent
bridge reads. Replaying that burst from the page failed 2,218 of 4,582 reads
in 563 ms. The fix runs the same reads through `readBounded`, the 16-at-a-time
law every list walk already uses (`tests/sweep-cli.test.ts` pins the cap at
95 threads). Replayed bounded against the same daemon: 4,582 reads, **0
failures**, 936 ms.

## Proof

- Red first: `tests/app-sweep-done-age.test.tsx` (label reads `23m ago`, no
  `data-age-source`), `tests/board-sweep-select.test.tsx` (unarmed card
  carries the amber ring at rest), `tests/sweep-cli.test.ts` (96 reads in
  flight).
- `npm test` 278 files / 3591 tests pass, `npm run typecheck` clean,
  `npm run build` clean (only the pre-existing `experimental_threadHeaderAction`
  retirement warning), `npm run gates` passes.
- `npm run uat -- tests/manual/uat-parent-lanes.yaml`: all 26 steps pass,
  including the Done row's arm/confirm steps.
