---
type: intent
timestamp: 2026-10-05T152747
responding-to: plan task 1 — collapse the duplicated source-row fetch in the title-probe path
---

## Refactor: probeSpawnPlan fetches the source row once

**Responding to:** plan task 1: `probeSpawnPlan(threadId)` fetches the source thread row via `bb.sdk.threads.get` to gate the inherit tier, then both consumers (`threadModelAvailability`, `probeThreadModelTitle`) run a second identical `bb.sdk.threads.get` for the same row — two round-trips per probe invocation where one suffices.

The shape I intend: `probeSpawnPlan` returns `{ plan, source }` instead of a bare plan. The fetched source row (typed with both `projectId` and `environmentId`) rides along on every return, and both consumers drop their own `threads.get` and validate from the carried source. Refusal reasons, spawn args, the `execution` logging shape, and the fallback-modal copy all stay byte-identical; the reasoning for picking `{ plan, source }` over carrying fields on the plan variants lands in a separate decision entry. Plan task 2 (the dead `environmentId` field in `probeSpawnPlan`'s local cast) resolves as a side effect of the same edit and gets its own decision entry.

**Commits in this unit:** none yet