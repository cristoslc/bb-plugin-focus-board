---
title: Certification — intent to make Focus Board 1.0.0 release-ready
date: 2026-10-05
certifiedVersion: 0.9.0
result: intent-certified
holdPoints: 4
---

# Certification — 1.0.0 release-readiness intent

Operator request of record (thread `thr_sk2wjstqb6`, branch
`bb/gap-analysis-for-1-0-0-release-readiness-thr_sk2wjstqb6`): *"certify your intent to make 1.0.0-ready"*, following the gap analysis delivered in the same thread.

**The intent:** I intend to drive the 0.9.0 codebase to a state where cutting 1.0.0 is a routine execution of the release spoke (§3–§7), with every 1.0.0-specific blocker closed first. I do not intend to cut 1.0.0 in this thread; the tag, the marketplace rename PR, and the upstream bb disclosure each stay behind a hold point.

**Baseline evidence (verified 2026-10-05, on the 0.9.0 release lineage):** 1012 tests across 68 files pass (`npm test`, exit 0); `tsc --noEmit` clean; all seven UAT suites pass with reports regenerated for 0.9.0; the 0.5.6 security audit found nothing above low with both lows remediated; release mechanics (signed tags, GitHub Releases, What's-new derivation) are documented and exercised; no GitHub issues open; no TODO/FIXME debris in shipped code. The gaps for 1.0.0 are commitments, not mechanics.

## Work items (from the gap analysis)

| # | Gap | Work | Rung |
|---|-----|------|------|
| 1 | Marketplace range `^0.3.1` pins the minor; fix PR #481 is open and unmerged | Merge PR #481; then a fresh per-cut marketplace submission bumping `source.git.range` to `^1.0.0` alongside the 1.0.0 listing refresh | intent-and-wait (external PR, merge, and label request) |
| 2 | No written stability promise for 1.0 | Write the compatibility note: frozen surfaces (CLI verbs and `--json` shapes, stored-state formats, realtime payload shapes) vs volatile ones; state whether 1.x may ever reset stored preferences | act-and-report (docs commit on `dev`) |
| 3 | Host/SDK dependency is pre-1.0 (`bb >= 0.43`, SDK 0.5.29, `experimental_` APIs) | Add the supported-bb-range policy and a re-verify-the-pane habit per bb release to the compatibility note | act-and-report |
| 4 | Security audit pinned 0.5.6 | Scoped re-audit of the surfaces 0.5.6 never saw: autotitle hidden-probe spawn + AI bridge calls, workspace-open daemon HTTP, snooze wake timers; same attack-surface-inventory method | act-and-report |
| 5 | Manual coverage tail (archive/unarchive, phone full-screen, live click-jump guard, symlink caveat, CLI live-host smoke) | Run one full live-bb pass of every `manual` cell in the matrix on the release branch, recorded; convert high-value cells to `uat-*.yaml` where reasonable | announce-and-proceed |
| 6 | Shipped host-bug workaround (chat-click-jump guard) | File the ready-to-hand write-up upstream with bb; record in 1.0 docs that the guard is deliberate | intent-and-wait for the upstream filing (external) |
| 7 | README/entry polish | Fix the `@v0.8.0` install example; confirm the marketplace short description in the 1.0.0 cut names drag-to-act, sweep, snooze, nesting | act-and-report |
| 8 | Scale sanity | Optional: one UAT step against a large fixture (hundreds of threads) to evidence rendering holds | act-and-report |

## Hold points (intent-and-wait — irreversible or cross-project)

1. Cutting the 1.0.0 finalize commit, tag, and GitHub Release (semver promise goes live; never mov).
2. Merging/filing the marketplace entry change for 1.0.0 (external repo `get-bb/marketplace`, `v1-change` label mechanics per spoke §4a).
3. Filing the upstream bb disclosure of the host scroll-shell bug.
4. Any preferences-reset or stored-state migration decision post-1.0 (covered by item 2's note, executed only with operator sign-off).

## Definition of 1.0.0-ready

The finalize commit may be cut the moment: items 1–3 and 5–7 land on `dev` (item 1's range bump rides the 1.0.0 cut per spoke §4a), item 4's audit reports nothing above low with any finding remediated red-tests-first, and the full suite plus typecheck are green on the release branch. Item 8 is optional and does not gate.