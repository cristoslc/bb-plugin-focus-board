---
title: Certification — archive safety of thread thr_x2yua7rwx5 (cross-lane drop placement)
date: 2026-09-30
certifiedVersion: 0.5.20
result: full-pass
---

# Certification — archive safety of this thread

Scope: the thread that shipped release 0.5.20 (cross-lane drop placement).
"Safe to archive" means: everything of value the thread produced is persisted
outside the thread (committed, tagged, pushed, and live), nothing automatic
can archive it while it still matters, and archiving buries no unrecoverable
state. Evidence gathered 2026-09-30.

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Feature merged through the two-branch model | PASS | Branch `bb/update-card-column-during-drag-and-drop-thr_x2yua7rwx5` merged into `dev` (c34625f), dev merged into `main` (d59999e); release commit `331a05a` on dev |
| 2 | Distributed release surface intact | PASS | Signed annotated tag `v0.5.20` on release commit `331a05a`; `git tag -v v0.5.20` verifies (`Good "git" signature`, ED25519 `SHA256:3KUyU3oB…`); pushed to origin with `dev`, `main`, and the branch |
| 3 | Release is live | PASS | `bb plugin list` shows `focus-board@0.5.20 running` from the main checkout; built from dev per the release spoke's step 7 |
| 4 | No uncommitted work in the thread's environment | PASS | `git status` clean in the env worktree |
| 5 | Thread knowledge persisted outside the thread | PASS | Decision record committed at `docs/chronicles/2026-09-30-cross-lane-drop-placement-thr_x2yua7rwx5/`; user-facing contract in `README.md` + `CHANGELOG.md` 0.5.20; test suite carries the behavioral contract (`tests/board-drop.test.tsx`) |
| 6 | No automatic archive path can claim the thread | PASS | Dry-run (`bb focus-board sweep`) lists 88 eligible threads; `grep thr_x2yua7rwx5` over it returns 0. The thread is `active` (never idle-eligible), not Done-marked, not pinned-aged-out; the 2026-09-28 archive-safety certification's guards (live-children and status guards) further exclude it |
| 7 | Archive is reversible | PASS | `bb thread archive` is operator-explicit and user-initiated; `bb thread unarchive` restores it; no eligibility claim hangs on this thread by design |

## Residuals (do not block archiving)

- No pending follow-ups are owed by this thread. If the user later wants
  cross-column reassignment under Project grouping (drag card onto another
  project's lane; needs a column-override/project-change RPC), that is a
  fresh thread: the decision record names the approach and the out-of-scope
  boundary explicitly, so the conversation is not load-bearing.
- The What's-new 0.5.19 entry belongs to the chat-click-guard thread
  (`thr_6fzk5sjz79`), shipped concurrently in the same batch; its release
  artifacts are that thread's responsibility and are committed on dev.

## Verdict

**Full pass — safe to archive.** After archive, recovery surfaces are:
repo history (branch, dev, main, tag `v0.5.20`), the decision-record and
certification docs, CHANGELOG/README, and the 550-test suite on `main`.