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

The chain can outlive one turn, and a backgrounded run dies with the turn: run it in the foreground, a suite at a time when one turn cannot hold it, and commit before the turn ends; the rule covers the whole `npm run uat` chain and `npm run release-safety`, its longest superset (`build` + `uat` + `release-shots`). Two threads in one session ended their turns with a backgrounded chain and were left with uncommitted work and no evidence of how the suites finished.

## Fresh worktrees and the install-script gate

This machine's npm wrapper blocks install scripts that `package.json`'s `allowScripts` field has not approved. `better-sqlite3` is the one dependency that must compile natively (`tests/tracker-status.test.ts` opens a real SQLite database), so its approval lives in that field — keep it, and add each future native-build dependency there at the moment it is introduced. Symptom of a checkout whose field was lost or a worktree against the wrong base: `tracker-status` tests fail with a `bindings`/`better_sqlite3.node` not-found read. Remedy: `npm install-scripts approve better-sqlite3` (it writes the same field), then `npm rebuild better-sqlite3`. Do not commit a `package.json` that only an approval step changed; the field belongs in the tree once, deliberately.

## node_modules — never a symlink in any checkout

Never create or retarget a `node_modules` symlink inside this repo's checkouts. The worktrees' shared-deps shortcut (`ln -s <main>/node_modules node_modules`) is exactly what made the plugin board vanish three times: when that command runs with its cwd set to the main checkout, `node_modules` points at itself, every import in the frontend bundle fails to resolve, and bb serves a board that silently disappears. If a worktree needs dependencies, run `npm ci` there. If the board vanishes, check `ls -la <main>/node_modules` for a symlink (especially one pointing at itself), then `rm node_modules && npm ci && bb plugin reload focus-board`. The guard test `tests/node-modules-guard.test.ts` fails loudly whenever repo-root `node_modules` is a symlink. The `pretest`/`prebuild`/`preuat` hooks also run `scripts/check-node-modules.mjs`, so any `npm test`, `npm run build`, or `npm run uat` in a corrupted checkout aborts before doing real work. The bb script automation `focus-board node_modules watchdog` (id `auto_xwmnn7ilkd8`, every 5 minutes, silent when healthy) additionally self-heals the one main checkout — `/Users/cristos/Documents/code/bb-plugin-focus-board`, which bb loads the plugin from; `/Users/cristos/code/bb-plugin-focus-board` is the same directory via a symlink alias, not a second checkout: it removes a symlinked or missing node_modules, runs `npm ci` + `npm run build`, and reloads the plugin, skipping any checkout mid-install (npm `.staging` marker). Repairs are visible in `bb automation runs`; do not help it by recreating node_modules symlinks. Source lives at `scripts/node-modules-watchdog.sh`; after editing it, refresh the stored copy with `bb automation update auto_xwmnn7ilkd8 --project proj_p4562js7v2 --script-file scripts/node-modules-watchdog.sh --host host_yat733yf8z --interpreter bash --working-directory project --timeout 600000`.

## Release

Landing work on `dev`: **every thread rebases its worktree onto `dev`, then
ships through a pull request on the remote — no thread merges into `dev`
directly anymore.** The flow: `git fetch origin && git rebase origin/dev`
on the thread branch — rebase before the PR is opened, never after
(resolve conflicts with dev's side, keeping your new bullets),
run `npm test` (and `npm run build` where the bundle matters), push the
branch, `gh pr create --base dev` (title carries the one-line behavior
summary the old merge-commit subjects held), link the PR to the focus board
(`focus_board_link_issue`), merge the PR on the remote (`gh pr merge
--merge` — a merge commit, never squash/rebase, so the dev lineage's
bullet-carrying commits stay real), delete the merged head branch, then in
the main checkout `git fetch && git merge --ff-only origin/dev` and rebuild
+ `bb plugin reload focus-board` — bb keeps serving the previously loaded
bundle otherwise, so an unreloaded PR looks unshipped (no new behavior,
silent What's-new gift). Before touching the main checkout, check no other
thread's merge is in flight in it (`.git/MERGE_HEAD` present) and the tree
is clean; wait for an in-flight one rather than barging over it.
The changelog bullets ride the PR's own commits, so the PR carries them;
audit the whole `[Unreleased]` group in the same edit, never deferred to
release: user-facing bullets only (tests, refactors, docs, plumbing earn
none), each filed under the matching Added/Changed/Fixed subsection,
same-behavior duplicates folded into one bullet with facet sub-bullets, each
bullet Slack-punchy — a bold lead plus at most two short sentences, no
state-list enumerations; longer detail moves to linked docs or gets cut.
The bold lead is also the What's-new line: the modal (dev and released
alike) shows only each bullet's lead plus its sub-bullets' first sentences,
so the lead must name the bullet's feature surface and read standalone for
a first-time reader ("Re-searching an Openverse query…" named nothing its
reader could place). The modal groups by feature surface: optional
`#### <surface>` level-4 headings inside the `[Unreleased]` group, placed
between bullets never inside them, tag the bullets that follow and persist
across the Added/Changed/Fixed lines, and the modal merges same-surface
items so one feature's additions, changes, and fixes read together; the
finalize rename carries the tags into the published entry. New group text
is humanizer-clean: the ai-output-humanizer scan exits 0 over it (zero em
dashes in new bullets), every noun is resolvable with no thread memory, one
trailing denial tops out a passage, and the whole group stays short enough
for the gift button's one-screen read.
The finalize rename sets a bullet-misfile trap for merges that cross it:
after a rebase or PR conflict resolution, check the bullets did not land
inside a renamed published section.
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
dev-only prep commit bumps to the next `-dev`. The finalize and prep
commits ride PRs like everything else that writes `dev`; main itself moves
only by fast-forward. Never commit to main
main-side; never push `dev` outside a PR; never back-edit published
changelog sections; never move a
tag. Full reference:
`.agents/agents-md-detail/release.md`

## Contributing

Filing issues, opening pull requests, branch and commit conventions, the
issue and PR templates, and what an agent does differently all live in
`CONTRIBUTING.md` (the source of truth, linked from here rather than copied)
and `.agents/agents-md-detail/contribution.md` (the agent-specific spoke).
Read both before the first issue, comment, or PR of a session. Security
findings go through `SECURITY.md`, never a public issue.

## Test coverage matrix

Master coverage matrix: `docs/test-coverage-matrix.md`