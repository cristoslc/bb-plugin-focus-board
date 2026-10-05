---
type: intent
timestamp: 2026-10-05T152520
responding-to: per operator request ("sashay away to fix it") — the minor findings from the issue #10 review
---

## Sashay start: title-probe single-fetch cleanup

**Responding to:** per operator request: "sashay away to fix it", following the issue #10 review (the issue's own bug is already fixed in 1261e8c on dev; this sashay fixes the two minor leftovers the review named).

1. **What:** collapse the duplicated `bb.sdk.threads.get` source-row fetch in the title-probe path (`probeSpawnPlan` fetches it, then `threadModelAvailability` and `probeThreadModelTitle` each fetch the same row again) into exactly one fetch per probe invocation, and drop the dead `environmentId` field from `probeSpawnPlan`'s local cast type.
2. **Why:** review of issue #10 found both redundancies in `server.ts` during verification of the metered-catalog-default fix; no behavior change is intended.
3. **What success looks like:** one `threads.get` per probe invocation path, refusal reasons / spawn args / modal copy unchanged, `tests/autotitle-rpc.test.ts`, `tests/autotitle-thread-model.test.ts`, `tests/autotitle-cli.test.ts` green, full `npm test` green (baseline 68 files / 1017 tests). No CHANGELOG entry (internal plumbing, not user-facing).

Plan: [docs/plans/bb-autotitle-probe-fetch-once-thr_puzvmb77q7.md](https://github.com/cristoslc/bb-plugin-focus-board/blob/bb/autotitle-probe-fetch-once-thr_puzvmb77q7/docs/plans/bb-autotitle-probe-fetch-once-thr_puzvmb77q7.md)

**Commits in this unit:** none yet (plan landed on dev at 81be035 before branching)