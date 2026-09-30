---
type: intent
timestamp: 2026-09-29T2302
thread: thr_6fzk5sjz79
---

# Certification of intent: implement and merge the click-jump recommendations

The operator asked me to certify my intent to implement and merge the
recommendations from the click-jump fix session. This file is the
commitment record, per recommendation, with the verifiable done-state for
each. Work happens on the fix branch
`bb/fix-chat-clicks-near-the-bottom-of-the-pane-thr_6fzk5sjz79` (guard
commit `02e8e23` on top of `83d8b68`, release 0.5.17); dev has since moved
to the 0.5.18 release plus the glyph-fusion work, so the branch takes dev
in before anything else, and one unit does the whole walk:

## Recommendation ledger

1. **Upstream issue for the page-shell click-jump** — DELEGATED, already in
   flight on child `thr_p5vcxx7cmv`, parked at a draft awaiting the
   operator's review before anything is posted. Not in this unit's scope;
   this unit does not post to the upstream tracker.
2. **Merge and release the fix** — COMMITTED HERE. Merge `origin/dev` into
   the fix branch, resolve, verify (`npm test`, `npm run typecheck`,
   `npm run build`), merge the branch into `dev` (done in the main
   checkout, `~/code/bb-plugin-focus-board`, which is what bb serves), then
   the release walk for the next version (0.5.19 — 0.5.18 went out on
   another thread): one release commit bumping `package.json`,
   `APP_VERSION`, and `WHATS_NEW` with the changelog entry naming the guard
   and pointing at `docs/chat-click-jump-2026-09-29.md`; release-merge
   `dev` to `main` through a temporary worktree, annotated tag `v0.5.19`
   (never retag), push, rebuild in the main checkout, `bb plugin reload
   focus-board`.
3. **Wheel tug-of-war (second symptom)** — DEFERRED, deliberately: one bug
   per report, so it gets its own upstream report after the first issue is
   reviewed/filed. Nothing to implement plugin-side; the guard already
   disarms on reader gestures.
4. **Commit-driven variant stays unguarded** — STANDS AS A GAP by design,
   recorded in `docs/chat-click-jump-2026-09-29.md`. No scroll-event
   heuristic ships from me: it cannot tell the bogus clamp from a
   legitimate re-pin, and shipping one would fight the host UI.
5. **Guard brittleness insurance** — COMMITTED HERE. The guard currently
   looks up the scroller by the upstream marker class `.thread-scrollbar`
   only; an upstream class rename before the host fix lands would make the
   guard silently inert. Add a fallback discovery: walk the click target's
   ancestors inside the chat body and take the first real scroll container
   (computed `overflowY` auto/scroll with scrollable content), so the guard
   keeps working through renames. The marker-class lookup stays preferred;
   the fallback never picks the composer (exempt) because discovery is
   ancestor-gated and the composer clicks are already exempted upstream of
   discovery. Red test first: a scroller without the marker class, found
   from a click inside it.

## Done-state

- Red test for the fallback confirmed failing, then implementation, then
  the full suite green, `tsc --noEmit` clean, `npm run build` successful.
- Fix branch merged with `origin/dev`, suite re-verified, branch merged
  into `dev` in the main checkout, release commit, `dev`→`main` release
  merge, annotated tag, push, rebuild, plugin reload, live board reopens
  with the pane working and the guard active.
- Upstream: draft from the child thread reviewed by the operator; filing
  happens only on explicit approval.

**Commits in this unit:** the fallback-hardening commit and the release
commit, landing on the fix branch and then `dev`/`main` via the recorded
merge walk.