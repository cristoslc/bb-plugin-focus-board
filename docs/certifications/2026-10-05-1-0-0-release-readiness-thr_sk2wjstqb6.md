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

## Update 2026-10-05 — items 9 and 10 closed (hardening suite and standing gates)

All committed in one landing on `bb/1-0-0-release-readiness-thr_sk2wjstqb6`:

- Item 9: `tests/rpc-contract-hardening.test.ts` (per-key wrong-type refusal law over every `rpcContract` method, cap boundaries 500/501 and 200/201 at the contract and end-to-end, the `__proto__` guard proven live); `tests/property-parsers.test.ts` + `tests/property-rank.test.ts` (fast-check, the documented-shape-or-documented-throw law, round-trip identities, rank non-clobber over arbitrary moves); `tests/preferences.test.ts` gained the simultaneous-corruption case; `tests/rank-concurrent.test.ts` pins the rank-write serialization. `fast-check` added as an approved dev dependency.
- **The hardening suite caught a real bug, red first:** `rank_move`'s read-merge-write cycle had an interleaving window, and a gated interleave reverted a concurrent writer's column entirely (writer B's pinned write came back undone). Fixed with `withRankWriteLock` — every rank write serializes on an in-process queue (all rank writers are board RPCs in this one server process; the CLI never writes ranks) — and the contract comment now states the serialization. Changelog carries the Fixed bullet.
- Item 10: `tests/no-fire-and-forget.test.ts` (gate over `server.ts` + `lib/`; frontend `void` idiom deliberately out of scope, documented in the test header) and `scripts/security-gates.mjs` wired as `npm run gates` and added to the release spoke's §2 verify step.

Verification at close: 1062 tests across 73 files green, `tsc --noEmit` clean, `npm run gates` passing (audit 0/0, sink scan over 67 shipped files with the documented allowlists).

## Update 2026-10-05 — work progressed on `bb/1-0-0-release-readiness-thr_sk2wjstqb6`

- Item 2 + 3 closed in commit `616b790`: `docs/compatibility-1.0.md` (frozen CLI shapes, stored-state tables for `focus-board:rank-orders` / `sweep-keep-flags` / `done-index` and the per-thread metadata keys `done` / `snooze` / `pin`, the nine localStorage keys, the three realtime payloads, the full `rpcContract` method list, the host-range policy, the no-preference-reset rule with the 0.3.1 lesson named), plus the README's install example de-pinned from `@v0.8.0` and a Compatibility pointer.
- Item 4 closed 2026-10-05: the re-audit (`docs/security-audit-2026-10-05-1.0.md`, commit `4e41338`; the dispatch used background session `ses_ef28f98feffeo6xsR5u7KhqGSo` over the post-0.5.6 surfaces: autotitle probe lifecycle and prompt-injection path, workspace-open daemon HTTP boundary, snooze wake timers, CLI additions) reports no critical or high findings. The three lows (uncaught `fireWake` rejections, the load scan aborting on one corrupt record, the promptual-only probe tool guardrail) and the two actionable infos (daemon-port range, snooze `<when>` overflow marking read before refusing) were remediated or resolved red-tests-first in `b12bf4b`; the two accepted residuals (title prompt injection bounded to a 120-char React string, best-effort probe deletion) are recorded in the audit. The probe-tool residual is confirmed a platform limit: `CreateThreadRequest.permissionMode` offers no `readonly`/tools-off option, so it is documented at the spawn site and accepted for 1.0. Full suite green at 1020 tests across 68 files, `tsc --noEmit` clean, `npm audit` 0/0. Item 4's gate is met: nothing above low.
- Item 5, live-host CLI smoke cells (matrix rows 103–107 + snooze smoke), executed 2026-10-05 against the running bb, read-only: `done list --json` returns id/title/doneAt rows (exit 0); `done list` human rows render the same set; `sweep` dry-run prints five idle-eligible threads and exits 1 exactly as contracted; `config show` reads all four thresholds at their defaults; `snooze list` reads "No threads are snoozed." Exit codes measured with the pipe stripped.

Still open on this certification: item 1 (marketplace PR #481 merge, then the 1.0.0 range bump — hold point), item 5's operator/UI manual cells (phone full-screen, pane archive/unarchive, click-jump guard in live bb, parent-board touch momentum), item 6's upstream bb filing (hold point — the write-up is ready), item 7's marketplace-description check riding the 1.0.0 cut, and item 8 (optional scale fixture).