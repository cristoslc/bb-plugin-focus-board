# AGENTS.md — bb-plugin-focus-board

## Test command

npm test

## Test command — operator-assisted E2E (UAT)

npm run uat

Drives the YAML suites in `tests/manual/` against the real app mounted in the
screenshot harness (`scripts/screenshot`). Requires `npm run build` first (the
harness loads `dist/app.css`) and uses the system Chrome, so set `CHROME_PATH`
if it is not in the default place. Run a single suite with
`npm run uat -- tests/manual/uat-rank.yaml`. Reports land in `docs/uat/`.

## Release

Releasing a new plugin version: coordinate with main before bumping (concurrent
threads release independently), bump `package.json` + `APP_VERSION` +
`WHATS_NEW` in one release commit, verify with `npm test` and `npm run build`,
merge to main, tag annotated `vX.Y.Z` on the release commit, push, then
rebuild in the main checkout and `bb plugin reload focus-board`. Includes
changelog formatting standards and the never-retag rule.
Full reference: `.agents/agents-md-detail/release.md`

## Test coverage matrix

Master coverage matrix: `docs/test-coverage-matrix.md`