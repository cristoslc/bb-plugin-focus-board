---
title: Certification — archive safety of thread thr_3fbg657pbk (unread droppable target → parked-pin state truth)
date: 2026-09-30
certifiedVersion: 0.6.0-dev (unreleased, on dev)
result: full-pass
---

# Certification — archive safety of this thread

Scope: this thread's work — from the original request ("'Unread' column
should also be a droppable target") through dropping a Pinned card on
Unread/Done (unpin + park), the nesting-drained empty-column hide, and the
final state-truth model (any surfaced mark-unread, native thread menu
included, restores the parked pin and un-dones done). "Safe to archive"
means: everything of value the thread produced is persisted outside the
thread, and nothing automatic can archive it while it still matters.
Evidence gathered 2026-09-30.

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Work merged through the two-branch model | PASS | Branch `bb/make-the-unread-column-a-droppable-target-thr_3fbg657pbk` is an ancestor of `dev` (`git branch --merged dev`); the state-truth merge is `5304bab` (preceded by `6f249e9`, `fca80aa`, `7d4bf96` for the unpin-composition and empty-column-hide increments); dev reconciled with the concurrent scrolls/whats-new threads mid-merge, CHANGELOG conflict resolved with both threads' `[Unreleased]` bullets kept |
| 2 | Changelog + generated embed committed on dev | PASS | `[Unreleased]` Changed bullet under the new release-spoke convention; `lib/unreleased-changelog.generated.ts` regenerated and committed in the same lineage (`dfb9e07`) |
| 3 | Work is live | PARTIAL (non-blocking) | `bb plugin list` shows `focus-board@0.6.0-dev running` from the main checkout (dev is what bb serves) — the provisional `-dev` build embeds the unreleased group; the `main`/tag step belongs to the next release cycle per the release spoke, not to this thread |
| 4 | No uncommitted work in the thread's environment | PASS | `git status` clean in the env worktree; everything pushed: `origin/dev` == `dfb9e07` |
| 5 | Thread knowledge persisted outside the thread | PASS | Spike/decision record at `docs/musings/2026-09-30-parked-pin-state-truth.md` (the `lastReadAt = null` single-writer theorem with the bundle-table evidence, loop analysis, residual races); contract rows in `docs/test-coverage-matrix.md`; tests carry the behavioral contract (`tests/pin-park.test.ts` 13 tests: parser + both feed extractors, `tests/pin-park-rpc.test.ts` 6: park store round-trip, `tests/board-drop.test.tsx` + `tests/nesting.test.ts` additions) |
| 6 | No automatic archive path can claim the thread | PASS | Dry-run (`bb focus-board sweep`, 95 rows) contains no `thr_3fbg657pbk` (`grep` count 0); the thread is `active` with `pinnedAt = null`, not Done-marked (`done list` count 0), and not 30-day-idle — the sweep's own guards exclude it by state |
| 7 | Archive is reversible | PASS | `bb thread archive` is operator-explicit; `bb thread unarchive` restores; no eligibility claim hangs on the thread by design |

## Residuals (do not block archiving)

- No follow-ups are owed by this thread. Fresh-thread candidates named in
  the records when wanted: board-level "New Task" relocation (the button
  lives inside the Working column and hides when the column hides); a
  "show empty columns" config setting; foreign mark-unread restores are
  done (state-truth), but foreign-surface pin *writes* from bb sidebar
  remain reconcile-only — supersede is correct; parking foreign un-pins is
  deliberately not done (documented in the musing's "Deliberately not
  done" section).
- The one semantic extrapolation stands open to veto: unread un-dones done
  even for a card that was never pinned (the state-truth reading of the
  ladder). It is documented in the musing; a veto is a two-line change.

## Verdict

**Full pass — safe to archive.** After archive, recovery surfaces are: repo
history (branch on disk, dev at `origin`, the merge commits), the spike
musing and this certification, CHANGELOG `[Unreleased]` + the embedded
group in the running `-dev` build, the coverage matrix, and the 579-test
suite (583 with the concurrent thread's additions) on dev.