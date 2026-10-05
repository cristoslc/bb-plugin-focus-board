---
type: decision
timestamp: 2026-10-05T152944
responding-to: plan task 1's either/or — carry project/environmentId on the spawnable plan variants, or return `{ plan, source }`
---

## Decision: `{ plan, source }` return shape instead of plan-carried fields

**Responding to:** plan task 1 told me to pick between threading the resolved source onto the plan variants or returning `{ plan, source }`, and to record why.

I picked `{ plan, source }`, for three reasons:

1. **The plan type stays honest to its job.** `ProbeSpawnPlan` describes how the probe spawns; the source row is what it spawns *into*. Folding `projectId?`/`environmentId?` (typed `unknown` until validated) onto the two `spawnable: true` arms would smear spawn-target data across a spawn-decision type, and every consumer would need `plan.kind`-free narrowing of optional `unknown` fields that the non-spawnable arm doesn't even have.
2. **Validation stays where it lives today.** Both consumers already guard `projectId` then `environmentId` with their own distinct refusal strings ("no project to spawn a title probe into" / "no environment to spawn a title probe into"); carrying the raw row keeps those guards byte-identical instead of pre-validating inside `probeSpawnPlan`, which would risk re-ordering or re-wording the refusal paths the review pinned.
3. **The non-spawnable arm needs no source.** With variants carrying fields, the `spawnable: false` arm would have to explain why it carries none; with `{ plan, source }` it just returns the row untouched and unused.

Call-count audit (all preserved, none increased): pair tier 1 fetch → 1 (moved into `probeSpawnPlan`, which now fetches unconditionally after `defaultExecutionOptions`); inherit tier 2 → 1; non-spawnable 1 → 1. The fetch sits after `defaultExecutionOptions` in the same relative order as before; the two calls remain independent reads.

**Commits in this unit:** fbf2975 (refactor; this file lands next)