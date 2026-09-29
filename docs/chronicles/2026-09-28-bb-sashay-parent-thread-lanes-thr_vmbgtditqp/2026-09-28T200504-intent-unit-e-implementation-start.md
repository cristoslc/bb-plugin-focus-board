---
type: intent
timestamp: 2026-09-28T200504
responding-to: operator steering while PR #9 sits at the merge gate
---

## Unit E: implementation start

**Responding to:** per operator request, lane order in the parent-thread board becomes recency (most recently touched-or-responded family at left) with optional project grouping, and the view's purpose is swarm management — one orchestration task with many subthreads at once.

This unit turns the revised D5 and new D5a into code: a recency comparator over the whole family, a persisted "By project" toggle that sections family lanes by the parent's `projectId`, and the Standalone lane trailing as an ungrouped section. The attention-derived lane walk (`walkLiveFamilyRank`/`standaloneLaneRank`) leaves the default ordering and will be removed or narrowed if nothing else needs it.

**Commits in this unit:**
