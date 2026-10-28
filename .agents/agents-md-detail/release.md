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
  - `dev` is the integration branch: thread branches from it, rebase onto
    it, and land on it only through a pull request on the remote. `dev` is
    also GitHub's default branch, so the code view, fresh clones, a new
    pull request's base, and the default-branch alert scanner all read the
    integration tree; a `Fixes #N` link closes its issue at the `dev` merge,
    one release before the fix ships (the changelog's `[Unreleased]` group
    carries the shipped-but-unreleased mark). While
    unreleased, `dev` carries a provisional prerelease
    version — the next release candidate + `-dev` (e.g. `0.6.0-dev`) — in
    `package.json` and `APP_VERSION`. The `-dev` suffix marks the number as
    a guess; the finalize commit makes it real.
- The **main checkout**
  (`/Users/cristos/Documents/code/bb-plugin-focus-board`) is checked out on
  `dev` — that registered path is what the running bb serves, so dev is
  what bb points at. `main` has no permanent local checkout; releases
  create a temporary one (section 4).
- **`dev` only ever advances through a pull request on the remote.** Thread
  branches base on it, rebase onto it, and ship via PR; a thread merging a
  branch into dev with a local `git merge` (or pushing dev by hand) is the
  forbidden path now — it once happened alongside a replayed copy of the
  same patch (2026-10-10), and the doubled CHANGELOG bullets it produced
  had to be deduplicated before anything went public. The main checkout
  follows the remote: `git fetch && git merge --ff-only origin/dev` — and
  with the PR flow in place, that fast-forward is the steady state, so an
  `--ff-only` refusal means local and remote diverged: stop and reconcile
  instead of papering over it.
- Only one thread should be integrating (rebase → PR → merge → pull down →
  rebuild + reload) at a time. Read the current version from
  **`origin/dev`** (the main checkout on `dev` reflects it after a pull)
  before finalizing — concurrent finals have double-bumped before (two
  "Release 0.5.3" commits exist in history). GitHub serializes the dev
  writes themselves, but the main checkout's tree is single-real-estate:
  before touching it, check it is clean and no merge is mid-flight
  (`.git/MERGE_HEAD` present) — wait for an in-flight foreign merge rather
  than barging over it (observed live 2026-10-10: a sibling thread's merge
  sat unresolved in the main checkout for the minute another merge
  attempted the same tree).

## 1. Landing work on `dev` — the PR flow, and the changelog riding it

- The standard integration flow, one pass per landing:
  1. Commit the work on the thread branch in its worktree.
  2. `git fetch origin && git rebase origin/dev` — the rebase targets the
     fetched remote dev, not a possibly stale local ref, and lands before
     step 4 opens the PR, never after; conflicts resolve with dev's side,
     keeping the branch's new bullets in place.
  3. Verify in the worktree: `npm test` (plus `npm run build` / `npm run
     gates` where the landing ships).
  4. Push the branch and `gh pr create --base dev` — the PR title carries
     the one-line behavior summary the old merge-commit subjects held.
  5. Link the PR to the focus board (`focus_board_link_issue`).
  6. Merge the PR on the remote with a merge commit (`gh pr merge --merge`
     — never squash or rebase: the dev lineage's bullet-carrying commits
     stay real), then delete the merged head branch on both sides.
  7. Pull down in the main checkout (`git fetch && git merge --ff-only
     origin/dev`), then rebuild and reload (section 7) when the landing
     changed anything `dist/` carries.
- Every PR into `dev` that lands user-facing behavior carries its bullets in
  its own commits, appending to
  the `[Unreleased]` group at the top of `CHANGELOG.md`, under the matching
  Keep-a-Changelog subsection: **Added** = new capability, **Changed** =
  behavior change to an existing surface, **Fixed** = bug fix.
- Every changelog write audits the whole `[Unreleased]` group in the same edit and never defers the fixes to release: only user-facing behavior earns bullets (tests-only, refactor, docs-only, build-plumbing, and internal-identifier landings are commit-message material; a mixed landing bullets only its user-facing part); every bullet lands under the matching subsection, and stray or bare bullets regroup right there — bare ones inherit into a published section at the finalize rename, and touching a published section is the forbidden back-edit.
- One bullet per *behavior*, not per merge or branch. Bullets are Slack-style
  release notes — slack.com/release-notes is the model: the behavior in one
  short sentence, at most a second one for texture. A bullet's OPENING
  SENTENCE is its What's-new item (section 5), so the bold lead carries the
  whole behavior and reads standalone; a bare noun phrase ("Parent thread
  lanes.") is the failure to avoid. The lead must also NAME the bullet's
  feature surface — the modal line has no changelog context around it, so
  "Re-searching an Openverse query…" (no wallpaper picker named) is the
  failure: the reader cannot tell what changed or where. New group text is
  humanizer-clean: the ai-output-humanizer scan exits 0 over the group
  (zero em dashes in new bullets), prose resolves with no thread memory, and
  trailing-denial constructions top out at one per bullet. Beyond the lead,
  at most two short sentences; a third, or a state-list chain (the sweep
  pill's one-time four-label "N → …" string, 2026-10), gets cut or moved to
  `docs/*.md` (linked). The 2026-10 lane-sweep paragraph ran 11 wrapped lines before
  this cap — the concrete failure. Bullets covering the same behavior fold
  into one with facet sub-bullets (0.6.0's projection card is the shape);
  sibling top-level bullets for one surface are the failure to avoid.
- Published sections are never back-edited. If a later merge revises
  behavior a published version already described, it gets fresh
  `[Unreleased]` bullets saying what the behavior is *now* (the parked-pin
  model revising 0.5.21's lane-exit unpin is the example to remember).
- A finalize rename sets a changelog trap for the next PR into `dev`: the
  branch's bullets sit under the heading dev renamed to `[X.Y.Z]`, and a
  rebase against it happily files the new bullets into the published
  section (observed with the 0.6.0 re-arm, 2026-10-03 — "New threads
  compose inside the board" landed inside `[0.6.0]` until hand-moved).
  After any rebase or conflict resolution that carries `[Unreleased]`
  bullets across a finalize boundary, check where they landed and move them
  into the fresh `[Unreleased]`; resolving the conflict by keeping both
  sides is exactly the back-edit the bullet above forbids. The same check
  applies at the PR-merge/pull-down seam.
- **A heading line is bullet zero: never let a resolution eat one.** A
  conflict resolution that splices bullet-prose must re-carry every heading
  it sat between; the 2026-10-10 cut's resolution spliced `[Unreleased]`
  content without the `## [Unreleased]` H2 (dev parsed the standing group
  as empty), and the finalize's anchor replace consumed `[1.2.0]`'s opening
  `### Added`, leaving six Added bullets section-less, silently dropped by
  the parser, and missing from the release feed (both fixed same-day by PRs
  #35's follow-up and #38). The check is mechanical: after any changelog
  splice, grep the section for `^## \[` and `^### ` — the fresh group
  carries its H2 with its three H3 subsections, and the renamed section
  opens with Added/Changed/Fixed under its own H2. Green tests cannot catch
  a missing heading (no heading simply parses as nothing), so verify the
  derived entry by item count.
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
- **Surface grouping for the What's-new modal.** Optional `#### <surface>`
  headings inside the `[Unreleased]` group (plain level-4 markdown between
  bullets, never inside one) tag every following bullet with that surface —
  persisting across bullets and across `###` Added/Changed/Fixed lines, so
  one feature's items land together in the modal even when the changelog's
  subsections split them (the wallpaper picker's Openverse re-search riding
  beside the wallpaper feature bullets is the shape). The modal merges
  same-surface items in first-appearance order and renders ungrouped
  entries flat exactly as before; sections that skip the headings lose
  nothing. Every new Unreleased bullet earns a surface heading unless the
  whole group shares one surface.
- **Standing surfaces.** The modal's groups are the headings' literal
  strings, merged across the subsections, so loose names fragment the feed:
  the 1.3.0 draft accumulated twelve groups for thirty bullets with five
  bullets untagged, one-bullet singletons (State filter, Ticket chips), and
  near-duplicate names (`Groups` beside `Groups and family boxes`), which is
  the failure shape. Write Unreleased bullets under the standing surface
  list, name verbatim: **Card animations**, **Settings**, **Groups and
  family boxes**, **Cards and chips**, **Board layout**, **Search and
  filters**, **The New thread composer**, **Context menus**. The list grows
  only by deliberate spoke edit, and only when a feature family no standing
  name covers will carry multiple bullets; until then a bullet takes its
  nearest standing surface.
- **No-singleton rule.** Before a finalize, the section under review must
  hold no one-bullet surface and no untagged bullet (a whole-group-shares-
  one-surface section may skip headings entirely). A bullet whose surface
  would land alone folds into its nearest standing neighbor, even at the
  cost of precision, because a modal with twelve groups for thirty items
  reads worse than a slightly loose one; a release feed whose grouped
  view shows singletons or flat-untagged leads fails the review pass and
  the grouping is fixed in the section before the tag, never after.
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
- `npm run gates` — the standing security gates (certification item 10):
  `npm audit` for the production and dev trees must report 0
  vulnerabilities, and the dangerous-sink greps over shipped code must
  find nothing outside the audits' documented allowlists. A violation is
  either removed or allowlisted with a comment naming the audit that
  approved it — never silenced.

## 2b. Release-safety gate (required before tagging a nightly release)

- `npm run release-safety` — it builds, runs every automated UAT suite in
  `tests/manual` against the real app (reports land in `docs/uat/`), and
  captures nineteen harness screenshots into `docs/release-safety/`: the
  board and the open thread pane at desktop 1920×1080, narrow desktop
  1280×800, tablet 768×1024, and phone 390×844; the parent-lane board and
  the group/family view at desktop; the parent-lane board on phone; the
  compact filter ribbon open on phone (below the 767px breakpoint the
  palette collapses into a header toggle); the empty-workspace board a
  first-run operator sees (`?empty=1`) at desktop and phone; a light-theme
  board; and the settings modal's Behavior and Appearance tabs, the
  What's-new modal, and the new-thread modal at desktop. Any failing UAT
  step stops the release: fix it in a normal landing, never by editing a
  suite green on release day.
- The screenshots get a judgement pass before tagging. A non-vision agent
  asks a vision-capable model per its vision-dispatch spoke
  (`llm -m synthetic/infinite:small:vision -f <prompt-file> -a <shots...>`,
  falling back to `llm -m kimi-k2.7-code:cloud` and then `kimi`,
  synthetic/kimi-k3, as the verified fallbacks when the first dispatch
  errors), demanding a SHOT-OK or SHOT-BROKEN verdict with a reason per
  image. Lanes that
  continue past the right edge under horizontal scrolling are normal for
  the board; SHOT-BROKEN is for unreadable or clipped-mid-word text at a
  real width, overlapping elements, missing board sections, collapsed or
  unrenderable layout, or a pane that fails to open. Any SHOT-BROKEN
  verdict stops the release.
- Each gate run verifies the harness answering its fixed port belongs to
  this run before anything is captured: the shared starter
  (`scripts/uat/harness.mjs`) hands its vite a per-run identity token and
  only accepts the port once that token is echoed back. A port held by
  another tree's gate run, or by a stray harness from an earlier session,
  fails the run loudly instead of producing wrong-tree evidence (issue
  #116).
- On any gate failure, keep the artifacts (`docs/uat/` and `docs/release-safety/`) for the follow-up, leave the tree clean, and notify: the gate publishes one message naming the failed gate and its verdict to the operator's ntfy topic, so the failure reaches the operator even when a thread's own report arrives truncated. The channel is the contract in `~/.agents/agents-md-detail/ntfy.md`; config lives in the gitignored `~/.config/focus-board/ntfy.env` (`NTFY_TOPIC` required, `NTFY_TOKEN` and `NTFY_SERVER` optional, `NTFY_ENV_FILE` relocates it). `scripts/release-safety.mjs` runs the chain stage by stage and names the failed stage (`release-safety:build`, `release-safety:uat`, and so on), `npm run gates`, `npm run uat`, and `npm run release-shots` notify on their own when run directly, and a nested gate stays quiet so a `release-safety` run sends exactly one message. No `NTFY_TOPIC` is a silent no-op, so an offline checkout and CI without secrets are unaffected; a publish failure is logged and never changes the gate's exit code.

## 3. Finalize commit (on the dev lineage)

If your branch doesn't contain `origin/dev` yet, rebase it onto
`origin/dev` first (section 1's flow) — the rebase always lands before that
PR is opened, never after. One finalize commit, subject `Release X.Y.Z: <user-facing summary>` (the summary
condenses the changelog's lead item — same wording rules as the What's-new
entry below), riding its own PR per the standard flow:

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
  and confirm `source.git.range` covers the version being tagged. The range
  is a tracking contract, not a per-release pin: the marketplace README says "Use a new marketplace pull request for a source, name, or brand change", and the bb `submit-a-plugin` skill says "A compatible release within an existing tracking range usually needs no new marketplace pull request" — compatible releases are meant to flow without any marketplace PR. Whether a bump is required follows caret semantics, which differ by major: on 0.x a caret pins the minor (`^0.3.1` means `>=0.3.1 <0.4.0` — the "`^0.3.1` covers everything below 1.0.0" assumption written here first was wrong, caught the same day by this check), so every 0.x minor cut must raise the range; from 1.0 on, a caret pins only the major, so `^1.0.0` already covers 1.1.0 and every later 1.x cut. Bump the range only when the released version falls outside it: every 0.x minor, each major, and any deliberate floor raise. The per-cut bump mandate that stood here until v1.1.0 (2026-10-09) was leftover 0.x rigor — the file-manager and doc-review entries that carried the pattern (`^0.9.1`, `^0.3.0`) were cut while their plugins were 0.x, where the bump was functionally required; PR #481's `^0.3.1` → `^0.9.0` bump rode v0.9.0 before this repo hit 1.0.
- Verify the listing still describes the release: the entry's short `description` and the `overview/<plugin-id>.md` it references, checked against the section being renamed in §3. This is a drift check, not a churn obligation — an in-range release needs no PR when the listing already covers it. The lever that keeps it that way: `PLUGIN_OVERVIEW.md` is written as a fixed set of capability pillars — "What you get" is a handful of bold-led bullets, rewritten only when a release opens a capability the page lacks, never one bullet per feature; each bullet is an invitation, not a specification — a bold lead, at most two short sentences, no parenthetical inventories, no semicolon chains, and per-release detail lives in CHANGELOG.md and the What's-new feed, and the page links the repo README — the free-to-update front door (screenshots, feature list, install) whose own README links the CHANGELOG, so marketplace-frozen copy never points at a page that itself needs a review to change (the page said so itself since the 2026-10-09 rewrite, 3524 → 2841 chars against the marketplace's hard 4000-char overview cap). The Oct 8 link-chip landing drift the marketplace copy ("`link list|set|clear`" missing from its CLI line) is the cautionary example: it required a listing fix one release later. When drift is user-visible wrong (the store page names a command or behavior that shipped or vanished), open the marketplace PR in the same cut: copy this repo's `PLUGIN_OVERVIEW.md` (kept beside `package.json` for exactly this — it is the author-owned long-form description) verbatim to `overview/focus-board.md`, and refresh the short `description` to match. Only those two fields ever move for a feature refresh; source/brand/tag changes are a fresh review.
- Marketplace-repo mechanics (learned on the 2026-10-05 refresh, PR #481):
  a changed entry is validated with `npm ci --ignore-scripts && npm run
  build && npm test && npm run check` (`gate:v1` is informational for a
  declared change); a `description` edit is a frozen-v1 field change (the frozen-v1 document holds only `id`, `displayName`, `description`, `icon`, `tags`, `author`, `source`), so a PR touching one of those needs the `v1-change` label; an `overview/`-only edit is not a v1 field and passes the gate without it — batch a description refresh with the overview copy when both drift, since one PR carrying both costs one review. The submitter has no label rights on `get-bb/marketplace`, so when the `v1-change` label is needed, request it in the PR body, which must state what the plugin does, the release source and range, the checks that passed, permissions/security facts, and the overview's source commit. Push the submission under a fresh branch name per cut (`submit-focus-board-<date>`), never force-push the original submission branch.

## 5. What's-new derivation (`WHATS_NEW` in `lib/whats-new.ts`)

- The published feed is scraped from CHANGELOG.md by
  `scripts/generate-whats-new.mjs` (wired into `test` and `build`): every
  `## [version]` heading yields one entry and every bullet one item — the
  bullet's opening sentence (`lib/changelog-markdown.ts`,
  `leadFromBullet`: the bold lead when it closes a sentence, else the
  first full sentence running through it; "(#N)" references stripped,
  terminal punctuation ensured). Nothing about a new release is
  hand-written: the finalize commit's changelog section IS the entry.
- Entries render grouped the way the section was written: the section's
  `#### <surface>` headings ride through as each item's `group` (section 1's
  surface-grouping bullet), and the modal merges same-surface items across
  the subsections; sections with no headings render flat, past and future
  both. Section 1's standing surface list and no-singleton rule govern the
  group names, so the derived entry's group set is part of the release
  review: the modal should read as the plugin's feature families, and
  singletons or flat-untagged leads in it mean the section needs regrouping
  before the tag.
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

Immediately after promoting, one commit on the dev lineage (riding its own
PR per the standard flow — section 1's step list, `npm test` is enough here
since only version stamps move):

- `package.json`, root `package-lock.json`, and `APP_VERSION` bumped to the
  next release candidate + `-dev`. The guess defaults to one patch bump
  past the release unless the direction of current work suggests a minor.
- Nothing else: the primed `[Unreleased]` group from the finalize commit is
  already there, and no `WHATS_NEW` entry exists for a `-dev` version —
  that is by design.

## 7. Pull down, then reload the running plugin

bb runs focus-board from the main checkout (its registered plugin path),
and that checkout sits on `dev`, so the running plugin serves dev. After a
PR merged on the remote:

0. Pull down in the main checkout: `git fetch && git merge --ff-only
   origin/dev` — after checking the tree is clean and no merge is
   mid-flight in it (section 0's coordination rule).
1. `npm run build` in the main checkout (on `dev`).
2. `bb plugin reload focus-board`.
3. Confirm with `bb plugin list` (version reads `X.Y.Z` right after a
   release, or the `-dev` candidate once §6 lands) and open the board; the
   What's-new gift button should pulse for the new version after a release
   and stay quiet once the prep commit lands.

This is part of every landing, not a release-only step. bb does
not watch the plugin's `dist/` — a rebuilt bundle keeps serving the
previously loaded code until the reload runs, so a merged-but-unreloaded
PR looks unshipped: new behavior absent and the gift silent even though
`[Unreleased]` has bullets. Exactly that happened on 2026-10-03 (the
new-thread modal merged, the operator saw no pulsing gift, and the fix was
only the reload). Run steps 0–2 before reporting a landing as done, and
treat a missing pulse after a changelog-carrying landing as the symptom of a
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
  group is written in the PRs that land work on dev; the finalize commit
  renames it
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