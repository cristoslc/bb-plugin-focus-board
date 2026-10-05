# Release Spoke — bb-plugin-focus-board

How to ship a new Focus Board version. The pipeline has a fixed shape: user
work appends bullets to the changelog's `[Unreleased]` group when it merges
into `dev`; releasing is a finalize commit on the dev lineage (name the
version, strip `-dev`), a fast-forward of `main`, a signed tag on that
commit, a GitHub Release page on that tag, and a dev-only prep commit that
re-arms the next cycle. Release-time
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
- Every changelog write audits the whole `[Unreleased]` group in the same edit and never defers the fixes to release: only user-facing behavior earns bullets (tests-only, refactor, docs-only, build-plumbing, and internal-identifier landings are commit-message material; a mixed landing bullets only its user-facing part); every bullet lands under the matching subsection, and stray or bare bullets regroup right there — bare ones inherit into a published section at the finalize rename, and touching a published section is the forbidden back-edit.
- One bullet per *behavior*, not per merge or branch. Bullets are Slack-style
  release notes — slack.com/release-notes is the model: the behavior in one
  short sentence, at most a second one for texture. A bullet's OPENING
  SENTENCE is its What's-new item (section 5), so the bold lead carries the
  whole behavior and reads standalone; a bare noun phrase ("Parent thread
  lanes.") is the failure to avoid. Beyond the lead, at most two short
  sentences; a third, or a state-list chain (the sweep pill's one-time
  four-label "N → …" string, 2026-10), gets cut or moved to `docs/*.md`
  (linked). The 2026-10 lane-sweep paragraph ran 11 wrapped lines before
  this cap — the concrete failure. Bullets covering the same behavior fold
  into one with facet sub-bullets (0.6.0's projection card is the shape);
  sibling top-level bullets for one surface are the failure to avoid.
- Published sections are never back-edited. If a later merge revises
  behavior a published version already described, it gets fresh
  `[Unreleased]` bullets saying what the behavior is *now* (the parked-pin
  model revising 0.5.21's lane-exit unpin is the example to remember).
- A finalize rename sets a changelog trap for the next merge into `dev`: the branch's bullets sit under the heading dev renamed to `[X.Y.Z]`, and git's auto-merge happily files the new bullets into the published section (observed with the 0.6.0 re-arm, 2026-10-03 — "New threads compose inside the board" landed inside `[0.6.0]` until hand-moved). After any dev merge that carries `[Unreleased]` bullets across a finalize boundary, check where they landed and move them into the fresh `[Unreleased]`; resolving the conflict by keeping both sides is exactly the back-edit the bullet above forbids.
- `lib/whats-new.ts`'s WHATS_NEW array is not maintained by hand anywhere —
  no entries, no churn; the prerelease branch in the whats-new entry test
  keeps the suite green without a placeholder. On dev the modal leads with
  CHANGELOG.md's `[Unreleased]` group's lead sentences:
  `scripts/generate-unreleased.mjs` (wired into `test` and `build`)
  embeds the current group into the bundle, so CHANGELOG.md is the single
  source of truth and no sentence is written twice. Published entries
  derive the same way at finalize time (section 5). The group also carries
  a parse contract — bullets open with `- ` at column zero and wrap with
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
   fresh empty `[Unreleased]` group above it in the same commit. The
   renamed section may be elaborated to full record prose freely — its
   bullets' opening sentences become the version's What's-new items
   automatically at the next test/build (section 5).
3. `package.json` (and the root `version` in `package-lock.json`): strip
   the suffix.
4. `APP_VERSION` in `lib/whats-new.ts`: strip the suffix.
5. Nothing more: the version's What's-new entry already exists, derived
   from the section renamed in step 2 (section 5).

This commit is what gets tagged and fast-forwarded onto main — nothing
else should ride in it.

## 4. Promote `main`, tag, push, publish

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
- Publish the matching GitHub Release for the tag:
  `gh release create vX.Y.Z --title "Focus Board X.Y.Z" --notes-file <file>`.
  The notes file is the release's changelog section verbatim — retitle its
  heading to `## Focus Board X.Y.Z (date)` — closed by a
  `**Full changelog**: .../compare/v<PREVIOUS>...vX.Y.Z` compare link
  against the previous tag (v0.5.21's release is the pattern). No binary
  assets: the tag itself is the package, since bb installs it by semver
  range. Confirm with `gh release view vX.Y.Z`.
- Remove the temp worktree.

## 4a. Marketplace entry check

Focus Board is listed on the bb community marketplace
(https://getbb.app/marketplace/focus-board). The listing is an entry file,
`entries/focus-board.json` in https://github.com/get-bb/marketplace, and
marketplace installs resolve through its `source.git.range` — every cut
therefore includes a marketplace check before the cut is reported done:

- Verify the release reaches marketplace installs: fetch
  `https://raw.githubusercontent.com/get-bb/marketplace/main/entries/focus-board.json`
  and confirm `source.git.range` covers the version being tagged (`^0.3.1`
  covers everything below 1.0.0 — a 1.0.0 release would silently stop
  shipping to marketplace users).
- Verify the listing still describes the release: the entry's short
  `description` and the `overview/<plugin-id>.md` it references, checked
  against the section being renamed in §3. When they drift, open the
  marketplace PR in the same cut: copy this repo's `PLUGIN_OVERVIEW.md`
  (kept beside `package.json` for exactly this — it is the author-owned
  long-form description) verbatim to `overview/focus-board.md`, and refresh
  the short `description` to match. Only those two fields ever move for a
  feature refresh; source/brand/tag changes are a fresh review.
- Marketplace-repo mechanics (learned on the 2026-10-05 refresh, PR #481):
  a changed entry is validated with `npm ci --ignore-scripts && npm run
  build && npm test && npm run check` (`gate:v1` is informational for a
  declared change); a `description` edit is a frozen-v1 field change, so
  the PR needs the `v1-change` label — the submitter has no label rights
  on `get-bb/marketplace`, so request the label in the PR body, which must
  state what the plugin does, the release source and range, the checks
  that passed, permissions/security facts, and the overview's source commit.
  Push the submission under a fresh branch name per cut
  (`submit-focus-board-<date>`), never force-push the original
  submission branch.

## 5. What's-new derivation (`WHATS_NEW` in `lib/whats-new.ts`)

- The published feed is scraped from CHANGELOG.md by
  `scripts/generate-whats-new.mjs` (wired into `test` and `build`): every
  `## [version]` heading yields one entry and every bullet one item — the
  bullet's opening sentence (`lib/changelog-markdown.ts`,
  `leadFromBullet`: the bold lead when it closes a sentence, else the
  first full sentence running through it; "(#N)" references stripped,
  terminal punctuation ensured). Nothing about a new release is
  hand-written: the finalize commit's changelog section IS the entry.
- The item rules are therefore just the rules for writing a section's
  first sentences: one user-facing sentence (at most two), "surface first,
  then the behavior"; behavior, never implementation — "Child threads now
  nest as one family" is right, "childNests now consults
  familyColumnOverrides" is not; no jargon or code identifiers unless the
  identifier is the user-visible surface; don't rely on the mechanical
  "(#N)" strip as permission to write ticket numbers in.
- One to three bullets per release. A release with nothing user-visible
  still gets a section (0.5.16's restatement is the standing example) —
  an update whose modal cannot describe itself is a silent update.
- `LEGACY_WHATS_NEW` in `lib/whats-new.ts` holds the hand-written entries
  for 0.5.6–0.5.12, versions the published record predates; frozen — it
  only shrinks if those versions ever gain real changelog sections.
- Old entries are never back-edited — the published-sections rule in
  section 1 covers them, since the feed derives from those sections.

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

This is part of every merge into `dev`, not a release-only step. bb does
not watch the plugin's `dist/` — a rebuilt bundle keeps serving the
previously loaded code until the reload runs, so a merged-but-unreloaded
board looks unshipped: new behavior absent and the gift silent even though
`[Unreleased]` has bullets. Exactly that happened on 2026-10-03 (the
new-thread modal merged, the operator saw no pulsing gift, and the fix was
only the reload). Run steps 1–2 before reporting a dev merge as done, and
treat a missing pulse after a changelog-carrying merge as the symptom of a
stale bundle first, a code bug second.

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
  the What's-new modal's headline entry — keep its bullets' opening
  sentences modal-readable.
- `lib/whats-new.ts` is the user-facing What's-new modal feed, derived
  from CHANGELOG.md at build time (each version's items are its bullets'
  opening sentences), newest first. Both surfaces must name the same
  version at the top after a finalize commit — the feed's entry exists
  the moment the section does.
- Git tags (`git tag -v vX.Y.Z`) plus finalize commits serve as the
  distribution history; release notes for a version are recoverable from
  `git log vX.Y-prev..vX.Y`, the `WHATS_NEW` entry, and the CHANGELOG
  section.
- GitHub Releases are the announcement surface: one public release per
  version, created in section 4, notes identical to the version's
  changelog section. A pushed tag without its release page is a
  half-finished release.