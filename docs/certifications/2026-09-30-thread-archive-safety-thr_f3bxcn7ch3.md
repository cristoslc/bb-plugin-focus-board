---
title: Certification — archive safety of thread thr_f3bxcn7ch3 (release coordinator: 0.5.21 + the release-process overhaul)
date: 2026-09-30
certifiedVersion: 0.6.0-dev
result: full-pass
---

# Certification — archive safety of this thread

Scope: the thread that ran repo status, cut release 0.5.21 (tag `v0.5.21`),
and overhauled the release process into the `[Unreleased]`-group /
`-dev`-version / fast-forward-only-main model. "Safe to archive" means:
everything of value the thread produced is persisted outside the thread
(committed, tagged, pushed, and live), nothing automatic can archive it
while it still matters, and archiving buries no unrecoverable state.
Evidence gathered 2026-09-30.

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Release merged through the two-branch model | PASS | 0.5.21 finalize `b4630b1` on dev; main fast-forwarded/merged at `7dded93`; both pushed with the process commits that followed (`f2e269b`, `955f9d3`, `589122b`, `dfb9e07`, `881a8aa`) |
| 2 | Distributed release surface intact | PASS | Signed annotated tag `v0.5.21` on `7dded93`; `git tag -v v0.5.21` verifies (`Good "git" signature`, ED25519 `SHA256:3KUyU3oB…`); pushed to origin with `dev` and `main` |
| 3 | Board process artifacts committed | PASS | `.agents/agents-md-detail/release.md` rewritten to the new pipeline; `AGENTS.md` release section matches; `[Unreleased]` group, generator script, parser, and pulse wiring all on dev (`881a8aa`) and pushed to origin |
| 4 | Release is live (and the dev cycle is live) | PASS | `bb plugin list` shows `focus-board@0.6.0-dev running` from the main checkout; dist rebuilt and reloaded after the scheme landed; 0.5.21 served until dev overtook it, as the two-branch model intends |
| 5 | No uncommitted work in the thread's environment | PASS | `git status` clean in the thread's env worktree; the branch holds no commits unique to this thread (its tip is main-side history that landed long before) |
| 6 | Thread knowledge persisted outside the thread | PASS | Decision record committed at `docs/chronicles/2026-09-30-release-0.5.21-and-unreleased-changelog-scheme-thr_f3bxcn7ch3/`; user-facing contracts in `CHANGELOG.md` 0.5.21 + README; behavioral suites (`tests/whats-new.test.ts` 590-test era) carry the pulse/parser contracts |
| 7 | No automatic archive path can claim the thread | PASS | Sweep dry-run lists eligible threads; `grep thr_f3bxcn7ch3` over it returns 0 — the thread is active, not Done-marked, not idle-eligible |
| 8 | Archive is reversible | PASS | `bb thread archive` is operator-explicit and user-initiated; `bb thread unarchive` restores it; sweep eligibility claims nothing on this thread |

## Residuals (do not block archiving)

- The `[Unreleased]` group currently holds two bullets (dev-only
  instrumentation toggle, parked-pin model) owned by other threads; those
  threads' archive-safety is their own concern, not this one.
- Open process risk, named in the decision record: shared-checkout
  contention between threads landing to dev. If it recurs before the
  worktree-based landing rule is formalized, a fresh thread should pick it
  up — the decision record carries the full context.
- The pulse "fires on next bullet landing" behavior was reasoned and
  unit-tested, not yet observed live end-to-end at the moment of this
  certification; the next landing on any thread will be its first
  demonstration. Mechanism risk only, no data loss possible.

## Verdict

**Full pass — safe to archive.** Recovery surfaces after archive: repo
history (dev, main, tags `v0.5.20`/`v0.5.21`), the decision record and this
certification, the rewritten release spoke, CHANGELOG/README, and the
test suite on dev.