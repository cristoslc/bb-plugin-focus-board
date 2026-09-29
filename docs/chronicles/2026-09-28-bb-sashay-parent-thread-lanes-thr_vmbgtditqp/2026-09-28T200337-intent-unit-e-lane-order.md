---
type: intent
timestamp: 2026-09-28T200337
responding-to: implementing the steering decision above (D5 revision + D5a optional project grouping)
---

## Unit E: recency lane order + optional project grouping

**Responding to:** per operator request — vertical lanes optionally grouped by project, default recency (most recently touched-or-responded at left).

Scope of this unit:

1. TDD red first in `tests/parent-lanes.test.ts`: family recency (max `updatedAt` across parent + non-archived members, done included), most-recent lane leftmost, untouched-family tie → representative's derived order, pinned parent tiebreak, project sections (D5a), Standalone trailing section.
2. Green: revise lane ordering in `components/parent-lanes.ts` (attention walk leaves the default path; keep `buildParentLanes` returning lanes in recency order; add project sectioning as a separate exported grouping over lanes, or an options parameter — implementer's call, single source).
3. Renderer + wiring: a lane-order toggle ("Recency" default / "By project") surfaced in the lane board when the parent grouping is active, persisted in `components/preferences.ts` alongside the existing group key; app.tsx passes it through (D15 pane routing unchanged).
4. Housekeeping: test-coverage-matrix row for lane order, README Group-by bullet mention of the lane-order toggle, CHANGELOG [Unreleased], and one or two added steps in `tests/manual/uat-parent-lanes.yaml` exercising the toggle.

Verification before reporting: `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm run uat -- tests/manual/uat-parent-lanes.yaml`.

**Commits in this unit:** none yet