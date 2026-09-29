# Release Spoke — bb-plugin-focus-board

How to ship a new Focus Board version: coordinate with main, bump, verify,
commit, merge, tag, push, reload. Read this spoke whenever a turn involves
releasing, version bumping, changelog writing, or tagging.

## 0. Coordinate with main first

- Concurrent threads release independently; main may have advanced past this
  branch's base. Merge `main` into the working branch (or rebase) before
  touching any version, and resolve conflicts before proceeding.
- Read the version from the **main checkout** (`/Users/cristos/Documents/code/bb-plugin-focus-board`),
  not from the branch. Concurrent releases have double-bumped before (two
  "Release 0.5.3" commits exist in history) because branches bumped from a
  stale base. The next version is always main's version + one patch bump
  unless the change warrants a minor or major bump.

## 1. Bump the version in three places

A release bumps exactly these, in one commit:

1. `package.json` → `"version": "X.Y.Z"`.
2. `APP_VERSION` in `lib/whats-new.ts` → `"X.Y.Z"`. A test
   (`tests/whats-new.test.ts`) pins `APP_VERSION` to the package version, so
   a missed bump fails the suite.
3. A new `WHATS_NEW` entry at the top of the array (newest first) for `X.Y.Z`.

## 2. Changelog formatting standards (`WHATS_NEW` entries)

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
  update, and the test suite rejects that.
- The release commit subject repeats the entry's lead item, condensed:
  `Release X.Y.Z: <user-facing summary>`.

## 3. Verify before committing

- `npm test` — the full suite must pass, including the version-lockstep and
  whats-new tests.
- `npm run build` — the plugin must build into `dist/`. `dist/` is
  gitignored; it is never committed.

## 4. Release commit

One commit on the working branch containing the version bump, the
`WHATS_NEW` entry, and any release documentation:

- Subject: `Release X.Y.Z: <user-facing summary>` (matches the changelog lead).
- No "WIP" prefixes; a release commit is final for that version.

## 5. Merge to main and tag

- Merge the branch into main from the main checkout:
  `git -C /Users/cristos/Documents/code/bb-plugin-focus-board merge --no-ff <branch>`,
  subject `Merge branch '<branch>' into main`.
- Tag the **release commit** (the `Release X.Y.Z:` commit), not the merge:
  `git tag -a vX.Y.Z <release-commit> -m "Release X.Y.Z: <summary>"`.
  Tags are annotated. Never move a tag: bb records the tag plus the commit
  it pointed at and refuses the plugin if a tag is ever retargeted. A fix
  after tagging is a new version, not a retag.
- Single-plugin repository, so tags are bare `vX.Y.Z` (no prefix).

## 6. Push

- Push the working branch, main, and tags to `origin` (the public
  repository). Git-tag releases let users install semver ranges
  (`git:...@^X.Y`), so a pushed tag is the actual distribution surface.

## 7. Reload the running plugin

bb runs focus-board from a local path (the main checkout), so it serves the
last build of that checkout, not the tag:

1. `npm run build` in the main checkout.
2. `bb plugin reload focus-board`.
3. Confirm with `bb plugin list` (version reads `X.Y.Z`, status `running`)
   and open the board; the What's-new gift button should pulse for the new
   version.

`bb plugin dev` is the watch-mode alternative for iterating, not for
releases.

## 7a. Signing a tag without unlocking 1Password (Vault-only key)

Tag signing never touches 1Password or the workstation's personal key.
A dedicated Ed25519 key was generated for release signing alone; its
private half lives ONLY in cove's Vault:

- `op://Private/Focus Board Release Signing/private key` (OpenSSH format)
- Public key: `scripts/release-signing.pub` (committed)

Repo wiring (already configured; point the absolute paths at the main
checkout):

- `gpg.format=ssh`, `tag.gpgSign=true` (unchanged)
- `user.signingkey=<repo>/scripts/release-signing.pub`
- `gpg.ssh.program=<repo>/scripts/release-ssh-sign.sh`
- `gpg.ssh.allowedSignersFile=<repo>/scripts/release-signing.allowed`

`scripts/release-ssh-sign.sh` intercepts git's `-Y sign`, materializes the
private key from the Vault into a 0600 temp file for the duration of one
signature, calls stock `ssh-keygen` (NOT the 1Password `op-ssh-sign`
wrapper), and deletes it. Verification passes through with
`check-novalidate`-style reads, so `git tag -v` works against the
allowed-signers file. Release procedure is unchanged otherwise: the signed
tag is just `git tag -a vX.Y.Z <commit> -m "Release X.Y.Z: <summary>"`.

The key is scoped to this job: it signs Focus Board release tags, nothing
more (keep it that way). It was generated fresh — it is not a copy of the
1Password identity key, whose Vault cache was purged when this key was
created. Anyone able to read cove's Vault can sign as this key; recover
by deleting the Vault entry and re-keying (new `.pub` + new
allowed-signers, then a new version's first signed tag re-establishes
trust). Tags do not retroactively re-sign: each is final, and a
compromised-era tag can be identified by its key fingerprint
(`SHA256:Js8QZbfl64XV2rqavEP/XY5qOSOLYkUnU6ldrHXoaEQ`, starting with
v0.5.16's first tag).

## 8. Release ledger

- The in-plugin changelog (`lib/whats-new.ts`) is the only changelog; there
  is no CHANGELOG.md. Git tags plus release commits serve as the history.
- Release notes for what shipped in each version are recoverable from
  `git log --oneline vX.Y-1..vX.Y` plus the `WHATS_NEW` entry.