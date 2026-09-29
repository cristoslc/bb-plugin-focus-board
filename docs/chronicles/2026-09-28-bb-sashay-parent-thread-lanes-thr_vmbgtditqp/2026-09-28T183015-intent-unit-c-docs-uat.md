# Intent: Unit C — docs, coverage matrix, and UAT suite

**Sashay:** bb-plugin-focus-board parent-thread-lanes (bb thread `thr_vmbgtditqp`, PR #9).

**Now:** Ship the non-code deliverables that round out the sashay:

1. Add the parent-lanes workflow paths to `docs/test-coverage-matrix.md`.
2. Update `README.md` so the feature bullet lists "Parent thread" alongside the other groupings.
3. Add a `### Added` entry to `CHANGELOG.md` describing the new grouping.
4. Create `tests/manual/uat-parent-lanes.yaml` covering header click, child-card click, keep-in-view on a deep-linked child, the Standalone lane, and switching back to Attention.
5. Extend the screenshot harness with a small family fixture and a `?q=` search seed so the UAT can exercise families and the Standalone lane without disturbing existing suites.

**Verification before the next checkpoint:** `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm run uat -- tests/manual/uat-parent-lanes.yaml` all green.
