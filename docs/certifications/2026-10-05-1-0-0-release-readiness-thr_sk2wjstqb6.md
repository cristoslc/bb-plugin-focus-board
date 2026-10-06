---
title: Certification — intent to make Focus Board 1.0.0 release-ready
date: 2026-10-05
certifiedVersion: 0.9.0
result: ready-to-finalize; verdict 2026-10-05 rev 2: all certification items closed — upstream filing exists (get-bb/bb#4793), finalize licensed (operator holds: 1.0.0 finalize/tag, marketplace pair)
holdPoints: 2
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

- Item 2 + 3 closed in commit `4e4b158` (pre-rebase `616b790`): `docs/compatibility-1.0.md` (frozen CLI shapes, stored-state tables for `focus-board:rank-orders` / `sweep-keep-flags` / `done-index` and the per-thread metadata keys `done` / `snooze` / `pin`, the nine localStorage keys, the three realtime payloads, the full `rpcContract` method list, the host-range policy, the no-preference-reset rule with the 0.3.1 lesson named), plus the README's install example de-pinned from `@v0.8.0` and a Compatibility pointer.
- Item 4 closed 2026-10-05: the re-audit (`docs/security-audit-2026-10-05-1.0.md`, commit `2c0afb5` (pre-rebase `4e41338`); the dispatch used background session `ses_ef28f98feffeo6xsR5u7KhqGSo` over the post-0.5.6 surfaces: autotitle probe lifecycle and prompt-injection path, workspace-open daemon HTTP boundary, snooze wake timers, CLI additions) reports no critical or high findings. The three lows (uncaught `fireWake` rejections, the load scan aborting on one corrupt record, the promptual-only probe tool guardrail) and the two actionable infos (daemon-port range, snooze `<when>` overflow marking read before refusing) were remediated or resolved red-tests-first in `67d22fb` (pre-rebase `b12bf4b`); the two accepted residuals (title prompt injection bounded to a 120-char React string, best-effort probe deletion) are recorded in the audit. The probe-tool residual is confirmed a platform limit: `CreateThreadRequest.permissionMode` offers no `readonly`/tools-off option, so it is documented at the spawn site and accepted for 1.0. Full suite green at 1020 tests across 68 files at audit time, `tsc --noEmit` clean, `npm audit` 0/0. Item 4's gate is met: nothing above low.
- Item 5, live-host CLI smoke cells (matrix rows 103–107 + snooze smoke), executed 2026-10-05 against the running bb, read-only: `done list --json` returns id/title/doneAt rows (exit 0); `done list` human rows render the same set; `sweep` dry-run prints five idle-eligible threads and exits 1 exactly as contracted; `config show` reads all four thresholds at their defaults; `snooze list` reads "No threads are snoozed." Exit codes measured with the pipe stripped.

Still open on this certification: item 1 (marketplace PR #481 merge, then the 1.0.0 range bump — hold point), item 5's operator/UI manual cells (phone full-screen, pane archive/unarchive, click-jump guard in live bb, parent-board touch momentum), item 6's upstream bb filing (hold point — the write-up is ready), item 7's marketplace-description check riding the 1.0.0 cut, and item 8 (optional scale fixture).

## Update 2026-10-05 — rebased on current `dev`

The branch rebased onto `origin/dev` at `a58d42f` (16 commits landed mid-cycle: toolbar search, the title probe's spawn-default-chain fix, the column-title drop rule, the Working-lane retention). Conflict resolutions: the changelog `[Unreleased]` group merged dev's four bullets with this branch's three Fixed bullets; `lib/unreleased-changelog.generated.ts` regenerated from the merged group; the probe residual comment re-based on dev's fixed execution fallback in `server.ts`. Certification SHA references updated to the rebased lineage (pre-rebase SHAs kept in parentheses). Verification on the rebased tree: 1078 tests across 74 files green (dev's new suites ride along), `tsc --noEmit` clean, `npm run gates` passing, build green.

## Verdict 2026-10-05 — release readiness of the branch as it stands

**Result: conditional. The engineering is done; the 1.0.0 finalize commit is not yet licensed.** Measured against this certification's Definition of 1.0.0-ready, on the rebased branch (`e2364cf` + `906e0aa`, 8 commits ahead of `origin/dev` at `a58d42f`, worktree clean):

| Definition clause | State |
|---|---|
| Items 2–3 land on `dev` | **Blocked on the dev merge** — complete on this branch (`4e4b158`), `dev` does not carry them yet |
| Item 4: audit nothing above low, remediated red-first | **Met** (`2c0afb5` + `67d22fb`) |
| Items 5–7 land on `dev` | **Partially blocked** — item 5's CLI half and item 7's README half are on the branch; item 5's operator/UI manual cells and item 6's upstream bb filing are not done |
| Full suite + typecheck green on the release branch | **Met** — 1078/1078 across 74 files, `tsc --noEmit` clean, `npm run gates` passing, build green |
| Item 8 (scale fixture) | Optional, non-gating, not done |
| Item 1 (marketplace range) | By design rides the 1.0.0 cut; PR #481's merge should precede or accompany it |

**What stands between the branch and a licensed finalize commit — all operator-side, none of it code:**

1. **The dev merge** (agent-executable on the operator's word): lands items 2, 3, 4, 9, 10, the CLI half of 5, and the README half of 7 on `dev`.
2. **The operator/UI manual pass** (item 5's remainder): phone full-screen, pane archive/unarchive, the click-jump guard in a live window, parent-board touch momentum — operator-assisted by nature.
3. **The upstream bb filing** (item 6): a hold point; the write-up in `docs/chat-click-jump-2026-09-29.md` is ready. The definition makes this a gate, so either the operator authorizes the filing, or the operator amends the definition to defer it past 1.0.0 with the write-up linked from the release notes.
4. **Marketplace PR #481's merge** plus the `^1.0.0` range bump riding the cut (item 1's hold point).

Two amendment options would shorten the list honestly: deferring item 6 to a post-1.0 filing (the residual is documented in-plugin either way), or converting the manual cells to a scheduled post-1.0 UAT session. Both are operator calls; neither should be taken silently by the agent.

## Update 2026-10-05 — item 5 closed by automated UAT (operator direction: "execute, but with automated UAT — no operator action")

The operator chose the automation path for item 5's UI cells. Closed as:

- **Archive/unarchive** → `tests/manual/uat-pane-archive.yaml` (3 steps, all pass): the pane opens, Archive in the actions menu removes the card from the board while the pane stays open on the archived thread, and the archived row's menu keeps Unarchive as its only way out. Building this suite caught a real harness gap: the mock SDK's sidebar archive was a no-op and its `subscribe` never published `archived-changed`, so the harness could not have shown an archive at all; the mock now moves threads to an archived set, serves `list({ archived: true })`, and publishes the signal (`30fd04e`).
- **Phone full-screen** → `tests/manual/uat-pane-phone.yaml` at 390×844 (3 steps, all pass): the pane opens as the full-screen sheet, the compact actions menu carries Full Screen, and choosing it runs the maximize path (the mock's navigation is a no-op — the live hand-off to bb's main view remains the one line the harness cannot draw, noted here).
- **Click-jump guard, live cell** → covered by the recorded live evidence (`docs/chat-click-jump-2026-09-29.md`: the 2026-09-30 instrumented ten-run verification, the probe script, and the live-verified revert) plus the unit suite pinning the guard. A fresh live repro needs a running bb host with a multi-page transcript; the recorded evidence stands in lieu of operator action.
- **Parent-board touch momentum** → covered by `uat-parent-lanes`' real wheel-event pan steps and the bounded-glide regression; device-touch physics stays live-only and is recorded as an accepted residual, consistent with the harness having no touch-input pipeline.

Full battery after the changes: 9 suites, 82 steps, all pass; 1078 vitest tests green, `tsc --noEmit` clean, `npm run gates` passing.

**Item 5 is closed.** The certification's remaining gates reduce to: the dev merge (executing now), hold point 3 (upstream bb filing — operator sign-off), and hold point 4 (marketplace PR #481 plus the `^1.0.0` bump riding the cut).

## Update 2026-10-05 — dev merge executed

The branch merged into `dev` in the main checkout (`a4cb09a`, merge commit, per the spoke's branch model) and pushed (`a58d42f..a4cb09a` on `origin/dev`). Verify on the merged tree: 1078 tests across 74 files green (after a `npm install` in the main checkout picked up the fast-check dev dependency the merge carries), `tsc --noEmit` clean, `npm run gates` passing, build green, `bb plugin reload focus-board` ran, and `bb plugin list` reports `focus-board@0.9.1-dev running` from the main checkout path. With this merge, definition clauses "items 2–3 land on dev" and the branch halves of items 5 and 7 are satisfied on `dev` itself; item 4 was already met; items 9 and 10 are on `dev`.

**Remaining to a licensed 1.0.0 finalize (both hold points, both operator-gated):** the upstream bb filing of the scroll-shell bug (item 6 — or an operator amendment deferring it), and the marketplace pair: PR #481's merge plus the `^1.0.0` range bump and listing refresh riding the cut (item 1). The finalize commit itself remains intent-and-wait.

## Update 2026-10-05 — lineage unified and a fresh dev-tree audit finding caught by the gates

After the demo-surface commits (`321db3f`, `bc74547`), the branch merged into `dev` again (`d23e0c0`), and the standing gates caught a **new high** in the dev dependency tree the same day: `npm audit` reported `source-map-js` 1.0.0–1.2.1 (GHSA-68fv-2mgg-jv7q, event-loop DoS) in both checkouts (identical lock state; dev-tree only, via jsdom and the vite/vitest chains). Remediated lockfile-only (`npm audit fix`, 1.2.1 → 1.2.2, commit `406a71b`); no shipped dependency changed, so no changelog bullet. dev could not fast-forward past its own merge commit, so `origin/dev` was merged into the branch (clean), the battery re-verified, and the main checkout fast-forwarded to a shared head. **Since then `dev` and the branch are the same lineage (`ab5b643` on origin) — new branch commits fast-forward into `dev` directly.**

## Verdict 2026-10-05 rev 2 — certification closed; result: ready-to-finalize

The operator challenged item 6's hold ("why is the click-jump host bug gating the release?"), and the investigation it triggered resolved the question: **the upstream filing already exists.** [get-bb/bb#4793](https://github.com/get-bb/bb/issues/4793) ("Chat view gets displaced when a stale 'load older rows' scroll anchor is consumed on a later commit") is live on GitHub in OPEN state with the full review-ready report — mechanism, natural-gesture replications, the staged shape, suggested fixes, and the minified-symbol mapping against the host's `bottom-anchored-scroll-body.tsx`. The definition's item-6 clause ("file the write-up upstream", an intent-and-wait hold) is therefore **satisfied and no longer a finalize dependency**: there is nothing left to tie to an issue number — the issue number exists, and `compatibility-1.0.md` already records the guard as deliberate with its deletion condition.

The operator's three questions, answered in the record:

1. **Why was it gating?** A drafting error in this certification: the clause was written against the gap analysis's "filing ready" state, before the filing's existence was re-verified today. It should never have read as a gate once #4793 was live; this update supersedes it.
2. **Is our code doing anything?** Yes — an active, live-verified mitigation, not a no-op. `components/chat-jump-guard.ts` (wired in `thread-pane.tsx`, pinned by a 17-case unit suite) reverts the host's post-click clamp with a counter-wheel when the reader is scrolled up by ≥96px, and stays silent for legit at-bottom clicks; the 2026-10-03 live verification shows the revert landing correctly in a real bb window.
3. **State the mitigation honestly:** the guard does **not** cover the original upward-displacement shape at a pinned-to-bottom reader — arming requires that ≥96px scrolled-up state, so at-bottom clicks leave it inert. That residual belongs to the same host defect and is unreachable from the plugin (bb's page-shell scroll manager is not exposed through the SDK). The guard ships as a **documented partial mitigation that gets deleted the moment bb ships the fix** — not as a permanent fixture and not as a no-op.

The `scrollDebugInstrumentation` setting is not part of this picture: it is a developer-only tool that ships OFF by default, never a shipped-hot workaround.

**Certification state: every definition item is closed on `dev` (items 1's bump and 7's description text ride the cut itself; item 8 stays optional and non-gating). The full battery on the unified lineage: 1078 tests across 74 files green, `tsc --noEmit` clean, `npm run gates` passing (audit 0/0 → 1.2.2 locked), build green.**

Hold points after this update (renumbered in the front matter: 4 → 2, hold 3 closed by the #4793 filing, old hold 4 standing as a post-1.0 policy rather than a release gate):

1. **The 1.0.0 finalize commit, signed tag, and GitHub Release** — the semver promise goes live; intent-and-wait per the release spoke.
2. **The marketplace pair** — PR #481's merge into `get-bb/marketplace`, then the `^1.0.0` range bump and listing refresh riding the 1.0.0 cut (item 1's hold point, unchanged).