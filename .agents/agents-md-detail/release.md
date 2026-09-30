# Release Spoke — bb-plugin-focus-board

How to ship a new Focus Board version. The pipeline has a fixed shape: user
work appends bullets to the changelog's `[Unreleased]` group when it merges
into `dev`; releasing is a finalize commit on the dev lineage (name the
version, strip `-dev`), a fast-forward of `main`, a signed tag on that
commit, and a dev-only prep commit that re-arms the next cycle. Release-time
changelog writing is gone — read this spoke whenever a turn involves
merging into `dev`, releasing, changelog writing, or tagging.

## 0. Branch model and coordination

- This repo is public, so it runs a two-branch model:
  - `main` is the stable public branch. It moves **only by fast-forwarding
    to a commit on the `dev` lineage**. A main-side commit (a merge commit,
    a docs landing) makes the next fast-forward impossible and reintroduces
    the release-merge conflicts this model exists to kill — if something
    must land, it lands on `dev` first and main follows. Git-tag
    distribution means main's tip being slightly stale between releases is
    harmless; divergent history is not.
  - `dev` is the integration branch: thread branches base on it and merge
    into it. While unreleased, `dev` carries a provisional prerelease
    version — the next release candidate + `-dev` (e.g. `0.6.0-dev`) — in
    `package.json` and `APP_VERSION`. The `-dev` suffix marks the number as
    a guess; the finalize commit makes it real.
- The **main checkout**
  (`/Users/cristos/Documents/code/bb-plugin-focus-board`) is checked out on
  `dev` — that registered path is what the running bb serves, so dev is
  what bb points at. `main` has no permanent local checkout; releases
  create a temporary one (section 4).
- Only one thread should be finalizing at a time. Read the current version
  from **`origin/dev`** (or the main checkout on `dev`), not from your
  working branch, before finalizing — concurrent finals have double-bumped
  before (two "Release 0.5.3" commits exist in history).

## 1. Merging work into `dev` — the changelog happens here

- Every merge into `dev` that lands user-facing behavior appends bullets to
  the `[Unreleased]` group at the top of `CHANGELOG.md`, under the matching
  Keep-a-Changelog subsection: **Added** = new capability, **Changed** =
  behavior change to an existing surface, **Fixed** = bug fix.
- One bullet per *behavior*, not per merge or branch. Bold the lead
  sentence, then elaborate — 0.5.19 and 0.5.21's entries are the reference
  voice.
- Tests-only, refactor, and docs-only landings add nothing.
- Published sections are never back-edited. If a later merge revises
  behavior a published version already described, it gets fresh
  `[Unreleased]` bullets saying what the behavior is *now* (the parked-pin
  model revising 0.5.21's lane-exit unpin is the example to remember).
- `lib/whats-new.ts`'s WHATS_NEW array is NOT maintained on dev — no
  entries, no churn; the prerelease branch in the whats-new entry test
  keeps the suite green without a placeholder. On dev the modal leads with
  CHANGELOG.md's `[Unreleased]` group itself:
  `scripts/generate-unreleased.mjs` (wired into `test` and `build`)
  embeds the current group into the bundle, so CHANGLEOG.md is the single
  source of truth and no bullet is written twice. That gives the group a
  parse contract — bullets open with `- ` at column zero and wrap with
  two-space continuation lines — exercised in its tests; a bullet that
  violates it simply stops appearing in the dev What's-new modal.
- The gift button's pulse on dev keys to the group's CONTENT, not the
  version: the fingerprint is written only when the modal opens, so an
  unopened dev build pulses its standing group (if it has bullets) and
  pulses again every time a merge lands new ones. Empty groups never
  pulse. Stable builds keep the classic version-based pulse; a prerelease
  running version pulses only on changelog change, so it never advertises
  already-published entries to the person who wrote them.
- The modal stays reachable from the quiet gift button.

## 2. Verify, always

- `npm test` — the full suite, including the version-lockstep and
  whats-new tests.
- `npm run build` — the plugin must build into `dist/`. `dist/` is
  gitignored; it is never committed.

## 3. Finalize commit (on the dev lineage)

If your branch doesn't contain `origin/dev` yet, merge `dev` in first. One
commit, subject `Release X.Y.Z: <user-facing summary>` (the summary
condenses the changelog's lead item — same wording rules as the What's-new
entry below):

1. **Decide the number**: strip the `-dev` suffix and that is the version —
   correct it first if the unreleased work warrants a different bump than
   the suffix guessed (per semver: user-visible additions may take a minor;
   the historic cadence is per-release judgment).
2. `CHANGELOG.md`: rename `[Unreleased]` → `[X.Y.Z] - <date>`, and add a
   fresh empty `[Unreleased]` group above it in the same commit.
3. `package.json` (and the root `version` in `package-lock.json`): strip
   the suffix.
4. `APP_VERSION` in `lib/whats-new.ts`: strip the suffix.
5. `WHATS_NEW` in `lib/whats-new.ts`: insert the `X.Y.Z` entry (newest
   first), condensed per section 5.

This commit is what gets tagged and fast-forwarded onto main — nothing
else should ride in it.

## 4. Promote `main`, tag, push

- From a temp worktree: `git worktree add /tmp/release-main main`, then
  `git merge --ff-only dev`. `--ff-only` must succeed: if it refuses, main
  and dev have diverged — stop and reconcile instead of papering over it
  with a merge commit.
- Tag the finalize commit (which is now main's tip):
  `git tag -a vX.Y.Z -m "Release X.Y.Z: <summary>"`. Never move a tag: bb
  records the tag plus the commit it pointed at and refuses the plugin if a
  tag is ever retargeted. A fix after tagging is a new version, not a
  retag. Tag signing is automatic (section 7a).
- Push `dev`, `main`, and the tag to `origin` — a pushed tag is the
  distribution surface (users install semver ranges like `git:...@^X.Y`).
- Remove the temp worktree.

## 5. What's-new entry standards (`WHATS_NEW` in `lib/whats-new.ts`)

- One entry per release, inserted at the top of the array. The array holds
  condensed highlights, not a full changelog; older entries are never
  back-edited.
- Each item is one user-facing sentence (at most two), written in the style
  "surface first, then the behavior": name the board surface the change is
  on, then state what the user can now do or see.
- Describe behavior, never implementation. "Child threads now nest as one
  family" is right; "childNests now consults familyColumnOverrides" is not.
- No jargon, no internal ticket numbers, no code identifiers in items unless
  the identifier is itself the user-visible surface (a command name, a key).
- One to three items per release. A release with nothing user-visible still
  gets an entry — an update whose modal cannot describe itself is a silent
  update (the prerelease relaxation in `tests/whats-new.test.ts` covers
  `-dev` builds only).

## 6. Post-release prep commit (dev-only)

Immediately after promoting, one commit on the dev lineage, subject like
`Prepare 0.7.0-dev: re-arm the cycle`:

- `package.json`, root `package-lock.json`, and `APP_VERSION` bumped to the
  next release candidate + `-dev`. The guess defaults to one patch bump
  past the release unless the direction of current work suggests a minor.
- Nothing else: the primed `[Unreleased]` group from the finalize commit is
  already there, and no `WHATS_NEW` entry exists for a `-dev` version —
  that is by design.

## 7. Reload the running plugin

bb runs focus-board from the main checkout (its registered plugin path),
and that checkout sits on `dev`, so the running plugin serves dev:

1. `npm run build` in the main checkout (on `dev`).
2. `bb plugin reload focus-board`.
3. Confirm with `bb plugin list` (version reads `X.Y.Z` right after a
   release, or the `-dev` candidate once §6 lands) and open the board; the
   What's-new gift button should pulse for the new version after a release
   and stay quiet once the prep commit lands.

`bb plugin dev` is the watch-mode alternative for iterating, not for
releases.

## 7a. Tag signing (plain key file)

Tag signing uses a plain, dedicated key file: no 1Password, no wrapper.

- Private key: `~/.ssh/focus_board_release` (0600, never in 1Password)
- Public key: committed at `scripts/release-signing.pub`
- Trust: committed at `scripts/release-signing.allowed` (one line per
  signing key, oldest releases' keys kept so old tags still `git tag -v`)

Repo wiring (absolute paths into the main checkout; already configured):

- `gpg.format=ssh`, `gpg.ssh.program=/usr/bin/ssh-keygen`, `tag.gpgSign=true`
- `user.signingkey=$HOME/.ssh/focus_board_release.pub`
- `gpg.ssh.allowedSignersFile=<repo>/scripts/release-signing.allowed`

Releasing a signed tag is then just
`git tag -a vX.Y.Z <commit> -m "Release X.Y.Z: <summary>"` — `git tag -v`
verifies against the allowed-signers file. Rotate by generating a new
`~/.ssh/focus_board_release`, replacing the `.pub` line and adding the old
one to the allowed file with its era noted (tags never re-sign; a tag's
fingerprint says which key era produced it).

## 8. Release ledger

- `CHANGELOG.md` is the full Keep-a-Changelog record. The `[Unreleased]`
  group is written during merges into dev; the finalize commit renames it
  to its version. Public sections, newest first, never back-edited. The
  group also embeds into dev builds (scripts/generate-unreleased.mjs) as
  the What's-new modal's headline entry — keep its bullets modal-readable.
- `lib/whats-new.ts` is the user-facing What's-new modal feed: one
  condensed, behavior-first entry per release, newest first. Both surfaces
  must name the same version at the top after a finalize commit.
- Git tags (`git tag -v vX.Y.Z`) plus finalize commits serve as the
  distribution history; release notes for a version are recoverable from
  `git log vX.Y-prev..vX.Y`, the `WHATS_NEW` entry, and the CHANGELOG
  section.