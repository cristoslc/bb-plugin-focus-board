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

## 7a. Signing a tag without unlocking 1Password (Vault-cached key)

Releases must never block on a locked 1Password. The git signing key
(`Personal | CLC-202508 | SSH Key`, the key behind this repo's
`user.signingkey`) is cached in cove's Vault in two fields:

- `op://Private/k4nzpxfor4bok2ganvsf2wjyfa/private key` (PKCS#8 PEM)
- `op://Private/k4nzpxfor4bok2ganvsf2wjyfa/public key`

From the first cache-in, both read offline forever. 1Password exports the
private half as PKCS#8, a format `ssh-keygen` can neither hand to git nor
import (`-m PKCS8` rejects Ed25519), so `scripts/sign-key-from-vault.py`
derives the OpenSSH-format file the signer needs:

1. Materialize (all three files `chmod 600`, no world-readable keys):
   - `cove creds vault-get '<private-key-ref>' > key.pem`
   - `cove creds vault-get '<public-key-ref>' > key.pub`
   - `python3 scripts/sign-key-from-vault.py key.pem key.pub > key_openssh`
2. Sign with stock `ssh-keygen`, not the 1Password wrapper program —
   otherwise git fails with "1Password: invalid ssh public key":
   `git -c gpg.format=ssh -c gpg.ssh.program="$(which ssh-keygen)" -c user.signingkey="<abs key_openssh path>" -c tag.gpgSign=true tag -a vX.Y.Z <release-commit> -m "Release X.Y.Z: <summary>"`
3. Delete the materialized key files after tagging; re-derive next release.

The signature's key blob matches the workstation key (`…3cSa`), so these
tags sit in the same trust chain as 1Password-signed ones. Cached-key
tradeoff: anything able to read cove's Vault can sign as this key — scope
it to git tag signing, and rotate from 1Password if the Vault is ever
compromised.

## 8. Release ledger

- The in-plugin changelog (`lib/whats-new.ts`) is the only changelog; there
  is no CHANGELOG.md. Git tags plus release commits serve as the history.
- Release notes for what shipped in each version are recoverable from
  `git log --oneline vX.Y-1..vX.Y` plus the `WHATS_NEW` entry.