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

## node_modules — never a symlink in any checkout

Never create or retarget a `node_modules` symlink inside this repo's checkouts. The worktrees' shared-deps shortcut (`ln -s <main>/node_modules node_modules`) is exactly what made the plugin board vanish three times: when that command runs with its cwd set to the main checkout, `node_modules` points at itself, every import in the frontend bundle fails to resolve, and bb serves a board that silently disappears. If a worktree needs dependencies, run `npm ci` there. If the board vanishes, check `ls -la <main>/node_modules` for a symlink (especially one pointing at itself), then `rm node_modules && npm ci && bb plugin reload focus-board`. The guard test `tests/node-modules-guard.test.ts` fails loudly whenever repo-root `node_modules` is a symlink. The `pretest`/`prebuild`/`preuat` hooks also run `scripts/check-node-modules.mjs`, so any `npm test`, `npm run build`, or `npm run uat` in a corrupted checkout aborts before doing real work. The bb script automation `focus-board node_modules watchdog` (id `auto_xwmnn7ilkd8`, every 5 minutes, silent when healthy) additionally self-heals both main checkouts (`/Users/cristos/Documents/code/bb-plugin-focus-board`, which bb loads the plugin from, and `/Users/cristos/code/bb-plugin-focus-board`, the dev project source): it removes a symlinked or missing node_modules, runs `npm ci` + `npm run build`, and reloads the plugin, skipping any checkout mid-install (npm `.staging` marker). Repairs are visible in `bb automation runs`; do not help it by recreating node_modules symlinks. Source lives at `scripts/node-modules-watchdog.sh`; after editing it, refresh the stored copy with `bb automation update auto_xwmnn7ilkd8 --project proj_p4562js7v2 --script-file scripts/node-modules-watchdog.sh --host host_yat733yf8z --interpreter bash --working-directory project --timeout 600000`.

## Release

Releasing a new plugin version: work merges into `dev` (the integration
branch; the main checkout sits on it and that is what bb serves) and
each such merge appends bullets to `CHANGELOG.md`'s `[Unreleased]` group,
then rebuilds in the main checkout and runs `bb plugin reload focus-board` —
bb keeps serving the previously loaded bundle otherwise, so an unreloaded
merge looks unshipped (no new behavior, silent What's-new gift); also check
the merge did not misfile new bullets into a renamed published section.
On every changelog write, audit the whole `[Unreleased]` group in the same edit, never deferred to release: user-facing bullets only (tests, refactors, docs, plumbing earn none), each filed under the matching Added/Changed/Fixed subsection, same-behavior duplicates folded into one bullet with facet sub-bullets, each bullet Slack-punchy — a bold lead plus at most two short sentences, no state-list enumerations; longer detail moves to linked docs or gets cut.
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