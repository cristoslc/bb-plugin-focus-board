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

Releasing a new plugin version: work merges into `dev` (the integration
branch; the main checkout sits on it and that is what bb serves) and
each such merge appends bullets to `CHANGELOG.md`'s `[Unreleased]` group,
then rebuilds in the main checkout and runs `bb plugin reload focus-board` —
bb keeps serving the previously loaded bundle otherwise, so an unreloaded
merge looks unshipped (no new behavior, silent What's-new gift); also check
the merge did not misfile new bullets into a renamed published section.
On every changelog write, not just at release time, check whether items should be grouped: place each new bullet under the matching Keep-a-Changelog subsection (Added/Changed/Fixed) and, when a write leaves `[Unreleased]` flat or mixed, regroup the existing bullets right there instead of deferring the layout to release day. The same write checks whether the change deserves a bullet at all: only user-facing behavior earns one, while maintainers-only landings (tests, refactors, docs, build plumbing, internal renames) add nothing to the changelog.
`dev` carries a provisional prerelease version (`next + "-dev"`, e.g.
`0.6.0-dev`) in package.json/APP_VERSION; `main` is stable and moves only
by fast-forward. Releasing = one finalize commit on the dev lineage (name
the version, strip `-dev`, rename `[Unreleased]` to `[X.Y.Z]`, add the
condensed WHATS_NEW entry), then fast-forward main in a temporary
worktree, tag annotated (SSH-signed) `vX.Y.Z` on that commit, push,
publish the matching GitHub Release page — title `Focus Board X.Y.Z`, notes
are that release's changelog section verbatim plus a Full-changelog compare
link, no binary assets (the tag itself is the package; bb installs it by
semver range) — then a
dev-only prep commit bumps to the next `-dev`. Never commit to main
main-side; never back-edit published changelog sections; never move a
tag. Full reference:
`.agents/agents-md-detail/release.md`

## Test coverage matrix

Master coverage matrix: `docs/test-coverage-matrix.md`