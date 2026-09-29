---
type: intent
timestamp: 2026-09-28T181507
responding-to: nothing
---

## Intent: implement parent thread lanes

**Responding to:** nothing (intent post for the first work unit)

Per operator request ("sashay away on this musing"), this sashay implements
the parent-thread grouping from the corrected musing
(docs/musings/2026-09-28-parent-thread-grouping.md) as specified in the plan
(docs/plans/bb-sashay-parent-thread-lanes-thr_vmbgtditqp.md). The shape:
vertical lanes are parent threads, horizontal rows are the pivoted Attention
ladder with the most attention-needing state at the top, only children render
as cards, and the parent is a lane header.

Work follows the plan's units A through D. Unit A starts red: failing tests
in tests/parent-lanes.test.ts for the pure lane model, then
components/parent-lanes.ts until green. Success for the sashay: the Group
dropdown offers "Parent thread", the lane board renders per decisions D1
through D15, and npm test, npx tsc --noEmit, npm run build, and the new UAT
suite all pass.

**Commits in this unit:** none yet