---
type: checkpoint
timestamp: 2026-10-05T153042
responding-to: the sashay's done-when — full suite green with recorded pass counts, both plan tasks landed
---

## Checkpoint: both tasks landed, full suite green

**Responding to:** the sashay's exit criteria: full `npm test` green with pass counts recorded, no behavior change, entries interleaved.

Both plan tasks are done and verified:

1. **Single source-row fetch** — `probeSpawnPlan` now fetches the source thread row exactly once (after `defaultExecutionOptions`, same relative call order) and returns `{ plan, source }`; `threadModelAvailability` and `probeThreadModelTitle` dropped their duplicate `bb.sdk.threads.get` and validate/spawn from the carried row. Refusal strings, spawn `executionArgs`, the `execution` logging shape, and the fallback-modal copy are untouched. The other `bb.sdk.threads.get` uses (probe status polling, timeline reads, prompt history) were not touched.
2. **Dead type field** — the anonymous cast with the never-read `environmentId` is gone; the named `ProbeSourceRow` keeps the field as live, shared consumer contract (see the dead-field decision entry).

Verification: `npx tsc --noEmit` clean; `npm test` on the committed tree → **68 test files / 1019 tests passed** (plan-time baseline 68/1017 — the +2 tests came from the marker-clear work that merged into dev after the plan snapshot; confirmed by running the suite on the pre-refactor tree, which also shows 1019, and by a clean `git diff 81be035..HEAD -- tests/`). Scope confirmation: no new or changed test fixtures, no CHANGELOG entry, no coverage-matrix change — internal plumbing with zero behavior delta.

**Commits in this unit:** 115956e (intent), fbf2975 (refactor), 87b243e (shape decision), 67b5b09 (dead-field decision), this file next