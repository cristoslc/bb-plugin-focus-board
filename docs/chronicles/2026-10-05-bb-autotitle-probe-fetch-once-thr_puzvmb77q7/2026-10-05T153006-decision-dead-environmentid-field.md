---
type: decision
timestamp: 2026-10-05T153006
responding-to: plan task 2 — the dead `environmentId?: unknown` in `probeSpawnPlan`'s local cast type
---

## Decision: the anonymous cast became the named `ProbeSourceRow`; the dead field went with it

**Responding to:** plan task 2 said to remove the dead `environmentId?: unknown` from `probeSpawnPlan`'s local `threads.get` cast type, while the source type the consumers' data comes from keeps the field (the spawn still reads it downstream).

The dead field was dead for one reason: the row was fetched twice, and only `probeSpawnPlan`'s copy (which reads `projectId` alone) declared the field without ever reading it. With the fetch collapsed to a single call, the anonymous inline cast is gone — replaced by the named `ProbeSourceRow` type that documents the row's actual job: `projectId` gates the inherit tier inside `probeSpawnPlan`, and `environmentId` rides along because both consumers validate it and the spawn reuses the source thread's environment. The consumers' duplicated anonymous cast types (which had carried `environmentId`) are deleted outright — their data now comes from `ProbeSourceRow` via the returned `source`.

So strictly: the *dead anonymous field* was removed together with the anonymous type that declared it; the *field itself* survives on the named shared row type, where it is no longer dead (both consumers read it). Both constraints from the task hold — no `threads.get` re-fetch, spawn keeps its environment reuse — and the naming makes the type's dual role explicit instead of leaving a mystery `environmentId` in a cast probeSpawnPlan never reads.

**Commits in this unit:** fbf2975 (the same commit carries this edit to `server.ts`; 87b243e preceded this entry)