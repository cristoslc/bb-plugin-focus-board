---
title: Certification — archive safety of thread thr_6rdcgjnfpi (pinned family's Needs-you member calls attention from Pinned)
date: 2026-09-30
certifiedVersion: 0.6.0-dev (unreleased, on dev)
result: full-pass
---

# Certification — archive safety of this thread

Scope: this thread's work — the UX bug report ("when a pinned family has a
child thread that needs to ask a question, it doesn't call attention
because it can't move from Pinned to Needs You") through the shipped fix:
the pinned card's pulsing amber border + question icon, the Pinned lane's
attention-first lift, both reading the same states so they end together —
plus the screenshot harness fidelity fixes found live (layered mock
preflight, 0.5.21 SDK stubs). "Safe to archive" means: everything of value
the thread produced is persisted outside the thread, and nothing automatic
can archive it while it still matters. Evidence gathered 2026-09-30.

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Work merged through the two-branch model | PASS | Branch `bb/fix-question-flow-for-pinned-family-child-thr_6rdcgjnfpi` is an ancestor of `dev` (`git branch --merged dev`); feature commit `d52e982`, dev reconciliation `3009ad5`, merge into dev `a717551`; main untouched (fast-forward model: no release this thread) |
| 2 | Changelog + generated embed committed on dev | PASS | `[Unreleased]` **Fixed** bullet under the release-spoke convention (dev reconciliation resolved the group with the concurrent threads' bullets kept); post-merge `node scripts/generate-unreleased.mjs` produced no diff — the committed `lib/unreleased-changelog.generated.ts` already embeds the pulse bullet in the same lineage |
| 3 | Work is live | PARTIAL (non-blocking) | `bb plugin list` shows `focus-board@0.6.0-dev running` from the main checkout; rebuilt (`npm run build`) and `bb plugin reload focus-board` after the merge — the running `-dev` build serves the fix and the embedded unreleased group per the release spoke; the `main`/tag step belongs to the next finalize cycle, not this thread |
| 4 | No uncommitted work in the thread's environment | PASS | `git status` clean in the env worktree and in the main checkout (the only dirty file pre-merge — a stale regeneration of the unreleased embed — dissolved into the merge, stash dropped as a no-op); `origin/dev` == `dev` == `a717551`, branch pushed |
| 5 | Thread knowledge persisted outside the thread | PASS | Decision record at `docs/chronicles/2026-09-30-pinned-family-pinned-lane-attention-thr_6rdcgjnfpi.md` (why pinned families can't relocate: `buildColumns` splits pinned before R4 overrides; the two-signal contract; deliberately-not-done boundaries; harness-layer findings); contract row updated in `docs/test-coverage-matrix.md`; tests carry the behavioral contract (`tests/nesting.test.ts` +6 incl. the manual-rank / answered-question pair, `tests/pinned-attention-board.test.tsx` DOM contract) |
| 6 | No automatic archive path can claim the thread | PASS | Dry-run (`bb focus-board sweep`, 93 rows) contains no `thr_6rdcgjnfpi` (`grep` count 0); the thread is `active` (never idle-eligible), not Done-marked (`done_list` count 0) — the sweep's own guards exclude it by state |
| 7 | Archive is reversible | PASS | `bb thread archive` is operator-explicit; `bb thread unarchive` restores; no eligibility claim hangs on the thread by design |

## Residuals (do not block archiving)

- No pending follow-ups are owed by this thread. Fresh-thread candidates
  named in the decision record when wanted: pinned-family relocation into
  Needs you (deliberately not done — Pinned is operator choice); the
  parent-lane board's attention surfacing (deliberately out of scope — no
  Pinned lane there); cross-axis flat children under axis groupings keep
  their own standalone attention instead of lifting the pinned parent.
- The screenshot-harness preflight fix changes harness-only CSS layering;
  README screenshots were not regenerated this thread, and regenerating
  them would now be *more* faithful (borders resolve) — a fresh-thread
  concern for whoever re-captures, not an open defect of the fix.

## Verdict

**Full pass — safe to archive.** After archive, recovery surfaces are: repo
history (branch on disk, `dev`/`origin/dev` at `a717551`), the decision
record and this certification, CHANGELOG `[Unreleased]` + the embedded
group in the running `-dev` build, the coverage matrix, and the 603-test
suite on dev.