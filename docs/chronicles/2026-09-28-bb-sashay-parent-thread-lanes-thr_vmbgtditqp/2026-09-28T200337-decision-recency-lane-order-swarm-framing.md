---
type: decision
timestamp: 2026-09-28T200337
responding-to: operator steering "vertical lanes should also be optionally organized into groups by project but default to recency (most recently-touched-or-responded threads at left)" and "the whole point of this view is to help manage swarms, where one orchestration task has many subthreads at once"
---

## Lane order revised: recency at left, swarm framing made explicit

**Responding to:** operator steering on lane organization while PR #9 waits at the merge gate.

The steering reframes the view's purpose and revises D5. The parent-lane view exists to manage swarms — one orchestration task with many subthreads at once. Lane order therefore defaults to recency: a lane's recency is the most recent touch or response across the family (max `updatedAt` over the parent and its non-archived members, including done children — a just-done child is the family's last touch), most recently touched at the left. Ties keep the representative's derived order so a pinned parent still floats leftmost. The attention-derived walk (`walkLiveFamilyRank`) is no longer the default order.

Two additions:

1. **Optional project grouping (D5a):** a persisted toggle (default off) sections family lanes by the parent's `projectId`; sections order by their most recently touched lane; lanes within a section by the same recency; the Standalone lane renders as a trailing ungrouped section regardless of the toggle.
2. **Swarm framing:** recorded in the plan preamble and D5 so the next reader knows why recency is the honest default — a busy child means an active swarm even when the parent thread is quiet.

The plan file's D5/D5a block and its test-coverage row are amended in the same commit. Implementation follows as unit E.

**Commits in this unit:** none yet