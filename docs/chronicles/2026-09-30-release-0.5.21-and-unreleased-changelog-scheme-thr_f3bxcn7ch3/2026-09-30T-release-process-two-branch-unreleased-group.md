# Decision — release process: [Unreleased]-group changelog, provisional -dev versions, fast-forward-only main

Thread: thr_f3bxcn7ch3 · Context: release 0.5.21 (tag `v0.5.21`) and the
process overhaul it motivated.

## Trigger

Release 0.5.21 was cut the old way — changelog entries, the What's-new
entry, and version files all authored post-hoc at release time. Three pain
signals arrived at once:

1. The merge dev → main hit content conflicts in every release-adjacent
   file: main-side merge commits (the 0.5.20 release merge) and dev-side
   release edits formed a criss-cross; version files conflicted in all four
   surfaces. Conflict-free by luck, resolved by hand.
2. The changelog quality itself: entries reverse-engineered from commit
   subjects, sections mislabeled (0.5.20's cross-lane drop is an Added,
   shipped as Changed).
3. Minutes after 0.5.21 shipped its "lane-exit unpin" behavior, the
   parked-pin model landed on dev and changed the behavior — the published
   entry was already stale, while anything unreleased had no home at all.

## Contract as built

Work merges into `dev` with bullets appended to `CHANGELOG.md`'s
`[Unreleased]` group (Added / Changed / Fixed, one bullet per behavior).
Two mechanisms make that group the board's live surface on dev:

- `scripts/generate-unreleased.mjs` (wired into `test` and `build`) parses
  the group out of CHANGELOG.md and embeds it
  (`lib/unreleased-changelog.generated.ts`); `lib/unreleased-changelog.ts`
  holds the parser and its format contract. CHANGELOG.md is the single
  source of truth; no bullet is written twice.
- On prerelease builds (`APP_VERSION` like `0.6.0-dev`), the What's-new
  gift button's "seen" state is the group's content fingerprint
  (FNV-1a over the bullets, stored at `focus-board:lastSeenUnreleased`),
  not the version: the button pulses whenever the standing group is
  non-empty and differs from the last-open snapshot — a null snapshot is
  "never opened", so the group advertises itself. Empty groups never
  pulse. Stable builds keep version-based pulsing.

`dev` carries a provisional prerelease version (next release candidate +
`-dev`); releasing is a finalize commit on the dev lineage (name the
version, strip `-dev`, rename `[Unreleased]` to `[X.Y.Z]`, add the
condensed WHATS_NEW entry), then **fast-forward-only** main, signed tag on
that commit, push; a dev-only prep commit re-arms the next `-dev`. main
may never be committed to main-side — that is what caused the criss-cross.

## Out of scope / residual risks

- Numbering stays per-release judgment (patch vs minor); the `-dev` suffix
  is a guess the finalize commit can correct.
- Threads contending for the shared main checkout is unsolved: three
  threads used it as a dev merge target inside ten minutes on 09-29/30;
  landings should merge dev into the thread's own worktree and ff dev from
  there. If contention recurs, that rule goes formal in the release spoke.
- `bb thread archive` on a thread that served as release coordinator loses
  nothing — all artifacts live in the repo (this decision record, the
  certification, the release spoke).

Codified at `.agents/agents-md-detail/release.md` (rewritten) and
`AGENTS.md` (release section).