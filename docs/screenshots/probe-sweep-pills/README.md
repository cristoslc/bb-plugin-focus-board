# Where the sweep pill rides, and where the lane menu is the door

Measurement behind the operator's report of 2026-11-24 ("the sweep + count
buttons for items beyond the age threshold are missing from these columns",
with a crop showing `Idle · Earlier ⌄ 221` and `Done ⌄ 12` and an empty slot in
each header). The answer on the shipped rule: the pill is **eligibility plus
count** (ruling `dl-20261105T165850-324f`), and only two arms ever propose
anything. Everything else rests bare by design, and its manual sweep enters
through the lane's own menu.

`scripts/screenshot/probe-sweep-pills.mjs` produced both readings: every
lane's header (label, count, rendered cards, pill and its accessible label)
and the entry list of every lane's menu.

## Live board (the operator's own data), 123 cards over 7 lanes

| Lane | Count | Pill | Lane menu offers "Sweep this lane…" |
|---|---|---|---|
| Pinned | 13 | none | yes |
| Unread | 12 | none | yes |
| Idle · Recent | 2 | none | yes |
| Idle · Today | 9 | none | yes |
| Idle · Earlier | 61 | none | yes |
| Done | 14 | none | yes |
| Working | 3 | none | **no** (cannot sweep) |

Every lane's pill is absent for a reason the rule names:

- **Idle · Earlier** is manual-only. The 2026-10-03 arming decision demoted
  the fresher idle buckets (`idle-earlier`, `idle-today`, `idle-recent`) to
  manual arming, so `sweepArmPreselects` is false for them, the app's dispatch
  returns no candidates, and the pill has nothing to propose. The lane is 1–7
  days idle; of its 61 threads, 5 are past the 2-day threshold, and the rule
  still proposes none of them.
- **Done** preselects, so an empty pill means an empty eligible set. The lane
  held 14 done threads, and not one was eligible: the only thread past the
  2-day threshold (`thr_uyu3s59q3b`, 3.42 days done) carried a `keep` flag,
  the next-oldest (`thr_eqqq6bmzug`, 1.33 days) was under the threshold (and a
  live-child parent besides), and the rest were 1.3 days or fresher.
- **Pinned, Unread** are manual-only for the same arming decision.
- **Working** cannot sweep at all, so it has no pill and no menu entry.

The wiring is alive, not dead: `sweepCandidatesFor` and `onSweepArm` reach the
Board (the menu entries below prove it, since that entry renders only when the
sweep props are wired), and the harness pass below shows the pill rendering
whenever an arm does have candidates.

## Harness board (same served app, seeded done stamps)

| Lane | Count | Pill label |
|---|---|---|
| Idle · A while ago | 5 | `Arm sweep for this column: 1 eligible threads` |
| Done | 3 | `Arm sweep for this column: 2 eligible threads` |
| Idle · Earlier, all other lanes | — | none |

The harness's Done fixtures are stamped 9–13 days back, so the lane proposes
two (the third is a family projection card, which cannot join a sweep). This
is the positive control: when a preselecting arm has eligible threads, the
broom and its count are there.

## Which lanes propose, and which are manual-only

- **Proposing** (pill and count whenever eligible > 0): `done`,
  `idle-awhile`, `awhile`.
- **Manual-only** (no pill at any eligibility; the lane menu's "Sweep this
  lane…" enters sweep mode with an empty selection): `pinned`, `unread`,
  `idle-recent`, `idle-today`, `idle-earlier`.
- **Never sweepable** (no pill, no menu entry): `working`, `attention`.

## Reproduce

```sh
# live board, in a throwaway browser profile
node scripts/screenshot/probe-sweep-pills.mjs

# the harness board (build first, then a vite harness)
npm run build
npx vite --config scripts/screenshot/vite.config.ts --port 5199 --strictPort &
BB_APP=http://localhost:5199/ OUT_DIR=docs/screenshots/probe-sweep-pills/harness \
  node scripts/screenshot/probe-sweep-pills.mjs
```

Each pass writes `evidence.json` (the exact readings above) and one board
screenshot. Honors `BB_APP`, `CHROME_PATH`, `OUT_DIR`, and `WIDTH`.
