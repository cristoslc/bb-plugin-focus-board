---
title: "Retro: Title probe single-fetch sashay"
period: "2026-10-05 15:25 — 2026-10-05 16:35"
created: 2026-10-05
scope: "Sashay follow-up to the issue-10 review: single bb.sdk.threads.get fetch per title-probe invocation, PR #11, branch bb/autotitle-probe-fetch-once-thr_puzvmb77q7, merged as 94c444f"
parleyed: false
---

# Retro: Title probe single-fetch sashay

## Period

2026-10-05 15:25 — 2026-10-05 16:35

## Scope

The sashay spawned by the issue-10 review ("Title probe on a model-less thread resolved the provider's metered catalog default"): a behavior-neutral cleanup in bb-plugin-focus-board that made `probeSpawnPlan` fetch the source thread row once per probe invocation and return `{ plan, source }` to its two consumers, plus removal of a dead anonymous `environmentId?` field. Branch `bb/autotitle-probe-fetch-once-thr_puzvmb77q7`, PR #11, squash-merged as `94c444f` on `dev`; issue #10 closed as completed.

## What happened

The review of issue #10 verified the metered-catalog-default fix (`1261e8c`) and left two minor findings: a duplicated source-row fetch in both title-probe consumers and a dead cast-type field. The sashay wrote the plan on trunk (`81be035`), branched, and an implementation subagent delivered the `{ plan, source }` shape with a named `ProbeSourceRow`, byte-identical refusal strings, and unchanged spawn args, in five commits. The closure loop rebased, tested (68 files / 1019 at the time), and ran the six-lens review pipeline; a six-agent loop approved with one docs finding that a verification subagent refuted with `git show dev:server.ts` evidence (the retraction is recorded in the review report at `docs/ai-code-reviews/code-review-2026-10-05T1538.md`). After operator approval on the certified chain, the branch rebased onto the moved trunk (`cd789c4`), re-tested at 69 files / 1031, re-reviewed by a final all-lenses pass (passed, three low informational notes), and squash-merged. Cleanup removed the worktree and branches; the generated-changelog regen chore (`616bd03`) patched the trunk blob; issue #10 got its closure comment.

## What worked

- **Byte-identical constraints in the dispatch brief** — refusing to be clever about the refusal strings and spawn args made the review's behavior-preservation check mechanical, and it passed first try on the logic lens.
- **The retraction discipline** — the docs lens finding was refuted with repository evidence rather than negotiated; the record stayed correct and the review report carries the full story, so future readers see both.
- **Intent-mode certification at the handoff** — one "approved" covered title prefix, verification chain, final review, squash merge, branch deletion, and issue closure. Zero round-trips after the approval.
- **Subagent sessions survive context compression** — the implementation agent's decision trail was reconstructible from chronicle entries alone at retro time.

## What didn't

- **First security dispatch skipped its result-file writes** — the lens reran clean; the pipeline's mandatory sidecar writes were easy for the agent to miss under heavy JSON-output instructions.
- **The docs-lens false positive cost a fix subagent round** — the per-function vs per-invocation counting frames were never pinned in the dispatch brief; the next review of a call-collapse refactor should state the counting frame in the prompt.
- **Local trunk was ahead of origin by 5 commits at handoff** (plan commit, working-status merge, lockfile sync, toolbar-search) — the PR briefly carried the plan file in its diff until trunk was pushed. Sashay step 1 should push trunk immediately after the plan commit.
- **The sashay worktree was pruned underneath the session** while waiting for operator approval; nothing was lost (branch was pushed), but recovery cost a worktree rebuild and one extra `npm ci`.

## What surfaced

- **Post-merge trunk drift is a recurring shape** — a generated artifact (`lib/unreleased-changelog.generated.ts`) went stale on trunk because a CHANGELOG edit without a test run doesn't regenerate it. This is the second time a regen blob has needed a reconciliation commit after unrelated merges.
- **Squash-merge + branch deletion makes chronicle SHA citations and branch-perma-links dangle** — resolvable as objects only until garbage collection; the final review classed this "acceptable as-is", but a convention of citing `path@<merge-sha>` for commit-trail lookups would make the links durable (retro bookends already do this: `docs/plans/bb-autotitle-probe-fetch-once-thr_puzvmb77q7.md@81be035` vs `@94c444f`).
- **No plan drift** — the plan at `81be035` and its state at merge time are identical; all four plan tasks shipped, no scope shift, no deferred work in this plugin. The metered-catalog residual risk lives in bb-core's spawn-default chain and is tracked via issue #10's closure thread.
- The decision-point narrative (why `{ plan, source }`, why the dead field died on the shared type) is in the chronicle, not here: `docs/chronicles/2026-10-05-bb-autotitle-probe-fetch-once-thr_puzvmb77q7/` (eight entries, durable on trunk).

## Next actions

- None in this plugin; the sashay is complete and issue #10 is closed.
- Process carryovers for the next sashay in any repo: pin the call-counting frame when reviewing call-collapse refactors; push trunk right after the step-1 plan commit; state "the fetch sits after X, order preserved" in dispatch briefs that reorder SDK calls.