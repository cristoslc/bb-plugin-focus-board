# Finding: clicking in the chat pane yanks the transcript to the bottom

*2026-09-29 · reported as "sometimes clicking in the chat near the bottom of
the chat pane (but above the user input box) causes the chat to jump up a
half-page or so" · investigated against bb 0.44.0*

"Jump up a half-page" is the transcript content moving up the screen — the
view is being yanked back to the newest message by an amount equal to
whatever the reader had scrolled up. The jump is a programmatic scrollTop
write by bb's host scroll shell, not a click handler of ours.

## TL;DR

This is a bug in bb's host-side `bottom-anchor` scroll manager (the scroll
shell that backs `ThreadChat`), not in focus-board code. The pane's chat is
an embedded host component and the SDK exposes no way to reach into that
manager's state, so the clean fix is upstream; the write-up below is ready
to hand over to the bb app side as-is. Meanwhile the pane ships a defensive
revert for the click path: `components/chat-jump-guard.ts` (snapshots the
scroll position on transcript clicks and undoes a clamp-to-bottom landing
within ~200ms — see "Plugin-side options" below for the boundaries).

## Reproduction

`node scripts/probe-chat-click-jump.mjs` (against the running bb app; needs a
board card with a multi-page-long transcript — "Hattrick: scaffolding…" and
"Humanize AI-generated text" both surfaced it). Steps: open the pane, wheel
the transcript up ~500px, click near the bottom of the transcript.

Observed in the pane, scrolled up ~500px, click on the transcript:

```
scrollTop 9971 -> 19387 written on the click  (real content max was 10457)
→ clamps to the bottom (10473)
```

with the calling stack naming the host scroll shell:

```
at <restoreLayoutEffect> (page-shell-B24TvAJg.js)
at commitLayoutEffects (react-dom)
```

The same click in bb's **main** thread view did *not* jump (short
transcript) — the mechanism depends on transcript length and a pending
capture (see below), which is why the bug reads as "sometimes".

## The mechanism (verified in the runtime bundle)

bb's page shell keeps a chat transcript pinned to the bottom with a custom
scroll manager (the element with the `scroll-bottom-anchor` /
`scroll-bottom-anchor-content` classes; `overflow-anchor: none` disables
native scroll anchoring while pinned, and the JS takes over). Reading the
minified build (`app/dist/assets/page-shell-B24TvAJg.js`, component `k`):

1. `captureScrollAnchor()` — exposed on the scroll context, called by the
   timeline's **older-rows preload** (an IntersectionObserver sentinel at the
   top of the timeline; also behind the "load older rows" button). It records
   `{ scrollHeight, scrollTop }` into a pending-capture ref (`N`).

2. The capture is consumed by a **layout effect with no dependency array**
   (`useLayoutEffect(restore)`), i.e. it runs after *every* React commit
   while a capture is pending. It applies:
   `scrollTop = capture.scrollTop + (scrollHeight − capture.scrollHeight)` —
   "content grew by Δ since capture; shift by Δ". When the capture is
   current and the growth is the preload's own row append, this is correct,
   and it clears the capture only when Δ > 0. **A capture under Δ = 0 is
   never cleared.**

3. The scroll listener has a *gesture-active* window (pointer pressed, or
   within 1s of wheel/touch). While it is active, if a capture is pending it
   **overwrites `capture.scrollTop` with the live position — and only the
   scrollTop**; `capture.scrollHeight` stays frozen at whatever the content
   was when the capture was taken.

4. The capture is taken when the user is scrolled near the *top* of the
   timeline. A preload that adds nothing (nothing older — the fetch returns
   empty, or the load fetch fails and its retry latch turns off) leaves the
   capture pending with a **stale, far-out-of-date scrollHeight** and a
   live-updated scrollTop — indefinitely.

So: pending stale capture exists → user wheels up (gesture window updates
the capture's scrollTop to the live reading) → **any React commit** (the
focus/selection churn a click causes in a transcript row is enough; so are
streaming updates) → the restore effect computes
`live + (currentContentHeight − staleCapturedHeight)`, which overshoots the
real maximum massively (9971 + 9416 vs a real max of 10457), the browser
clamps it to the bottom, and the reader is yanked to the newest message.

The direction and magnitude both match the report: exactly "up by whatever
you had scrolled", most of the time roughly half a pane.

Related, same manager: rapid wheel-up in the pane partially cancels itself —
scroll drifts fight persisted row-anchor restores (`data-timeline-row-id`
snap-back) and the chat ends pinned at the bottom even though the reader
wheeled several hundred px up. Users will experience this as "my scroll
input doesn't take near the bottom". We observed this consistently in the
headless probe (six 800px wheel-up ticks produced no net scroll).

## Why the plugin pane sees it

The Focus Board pane mounts the host's `ThreadChat` (`variant="compact",
layout="contained"`), which runs this same page-shell scroll manager
(`scrollBehavior: "bottom-anchor"`). The SDK's `ThreadChat` is a runtime
component — a black box internally — so the plugin has no access to the
scroll context (`captureScrollAnchor`, `scrollToBottom`, …); there is no
supported way to clear or validate the stale capture from a plugin.

## Suggested upstream fixes (bb app, page-shell)

Any one of these would kill the mechanism; they compose:

1. **Bracket the capture.** Clear the pending capture in a `finally` (or on
   the next commit after the preload settles), regardless of whether the
   growth was positive. A capture must not survive to an unrelated commit.
2. **Never mix live-applied scrollTop with a stale scrollHeight.** If the
   gesture path updates `capture.scrollTop`, it must also refresh
   `capture.scrollHeight` (and then the restore becomes a no-op for
   unrelated commits because Δ = 0).
3. **Anchor by DOM node, not arithmetic.** The manager already knows how to
   restore by row (`find(rowId)` + `offsetWithinRow`) for its persisted
   anchors. Restoring the preload capture the same way — find the captured
   row, adjust by its measured offset — is immune to content-visibility
   estimate drift and stale arithmetic. (The transcript rows use
   `content-visibility: auto` with estimated box sizes, so absolute
   `scrollHeight` arithmetic is fragile here even without the stale-capture
   bug.)

## Plugin-side options

Decided: ship a **defensive revert guard** (`components/chat-jump-guard.ts`,
wired in `ThreadPane` under `components/thread-pane.tsx`, unit-covered in
`tests/chat-jump-guard.test.ts`) until bb ships the page-shell fix — at
which point this module should be deleted.

Its boundaries, and why each one exists:

- **Only the click path is guarded.** The host bug also fires commit-driven
  (a streaming message while a stale capture is pending); a guard keyed to
  arbitrary commits would need scroll-event heuristics able to tell the
  bogus clamp from every legitimate re-pin — too blunt to ship.
- **Left clicks only**, on the transcript.
- **Clicks on the "Scroll to latest event" pill and inside the composer
  (`[data-app-composer]`, `[data-promptbox-shell]`) are exempt** — those
  legitimately re-pin (jump pill; sending appends a message).
- **The reader must have scrolled meaningfully up (≥96px)** before a click
  arms the guard; smaller offsets make a revert indistinguishable from a
  legitimate caret-bringing scroll of an inline editor.
- **Reader gestures disarm the guard window** (wheel, touchstart, scroll
  keys) — reverting a reader-initiated scroll would fight the reader.
- **The revert walks the host's own disengage path:** the guard dispatches
  an untrusted `WheelEvent` (the browser does not scroll on untrusted
  events, but the manager's wheel listener opens its ~1s gesture window) so
  the immediately-following scrollTop write disengages the pin instead of
  the manager re-clamping on its next layout resize. Verified live: the
  revert sticks across forced viewport resizes, later scrolling still
  re-pins normally, and the pill still works.

Limitations to keep in mind when reviewing complaints against it: a clamp
that lands more than ~200ms after the click misses the window (the
first revert tick is 50ms, so ordinary smooth settles are covered), and a
reader who genuinely reaches the bottom within the window after a click
would be reverted — rare, and the pill one click away.

## Repro script

`scripts/probe-chat-click-jump.mjs` — drives the live bb UI headlessly,
performs the exact gesture (wheel up, click above the composer), and captures
the bogus scrollTop write with its calling stack. Not wired into `npm test`;
it is an operator tool, needs a running bb server and a chrome binary.
## Update 2026-09-30, later — on-demand repro + mechanism discrimination

The investigation child (`thr_a3spka7tq4`) rebuilt the trigger and
instrumented ten runs (scroll-debug on dev, plus probe logs in the child's
thread output):

- **The operator's symptom reproduces on demand**: reader pinned at the
  bottom, click above the composer → the view displaces upward, write and
  stack captured (e.g. `10489 → 16` on a sh≈11523 transcript, and a
  no-interception run where the natural older-page fetch succeeded, loaded
  7 rows, and produced `14160 → 3687 = 0 + (15194 − 11507)`).
- **Every reproduced yank's stack is the pending-capture path** — the
  no-dep layout effect at L433–441, arithmetic verbatim
  (`16 = 0 + (11523 − 11507)`). The row-anchor restore path (candidate 2)
  never appeared, and cannot emit the 2026-09-29 writes (which exceed the
  live scrollHeight; the row-anchor path clamps to max). One defect; the
  direction (clamped down vs displaced up from a "frozen-low" capture) is
  decided by when the shell's gesture refresh last touched
  `capture.scrollTop`.
- **The shipped guard had a cement defect**, seen live in runs d4/d5/d8/d10:
  a click landing at an already-displaced position armed the guard at the
  displaced baseline, and the shell's next automatic re-pin (its own
  self-correction) got reverted as if it were the bogus clamp — the reader
  stayed displaced. Fixed red-test-first: the guard now tracks the
  scroller's position with a passive scroll listener and suppresses arming
  for 3s after any single scroll move ≥300px (a displacement or its
  correction in flight) (`tests/chat-jump-guard.test.ts`, 17 suite cases).

## Update 2026-09-30 — the symptom direction was the agent's error

The operator corrected this finding's scenario: they were **already pinned
at the newest message** when they clicked, and the transcript jumped **up**.
"Yanked back to the newest message by whatever you had scrolled" (the
framing above, the 0.5.19 changelog line, and the v1–v3 upstream drafts)
misreads the event; it fits only the probe runs, where the reader was
driven to the bottom by synthetic wheeling and the bogus write clamped to
the reader's own position, invisibly.

What stands and where the report now goes:

- **Still verified evidence:** three bogus `scrollTop` writes captured live
  on 2026-09-29 (19350 / 19387 / 19388 against a live max of ~10457–10473)
  with stacks resolving to the host asset bundle — not the plugin's.
- **Two candidate write paths in the same module** (`apps/app/src/components/ui/bottom-anchored-scroll-body.tsx`,
  base `adbce963`): the pending-capture restore at L433–441 (the captured
  one), and a row-anchor restore at L540–570 writing an absolute stored
  position (`revealOffset + offsetWithinRow`), re-applied on anchor-store
  commits — which can displace an at-bottom reader upward, matching the
  operator's symptom, and has never been reproduced. Which path the
  operator hit is not established; discriminating them is the open
  investigation (child `thr_a3spka7tq4`, repro-first).
- **The shipped guard (`components/chat-jump-guard.ts`) does not cover the
  operator's scenario**: its arm requires the reader ≥96px scrolled up, an
  at-bottom reader leaves it inert. It remains in place as a defense for
  the captured clamp-down variant until this investigation closes or bb
  ships the fix; this section supersedes the mechanism summary above.

## Update 2026-10-02 — adversarial review round (child `thr_cexdxfbnaj`)

Tried to disprove the report; verdicts:

- **Mechanism survived everything, and is stronger than stated**: natural
  gestures alone reproduce the yank (nat1–nat4, no staging): the pending
  capture arises on EVERY older-rows load, success included — survival is
  the norm. Direction: on natural runs the consume lands as a big
  downward yank (or clamps at the bottom); the operator's upward-from-
  pinned-bottom shape requires a no-intent descent that natural input
  does not produce (wheel/touch/keys/scrollbar/pill all carry scroll
  intent and refresh the pending capture; an ambient repin consumes at
  arrival) — reproduced only under staging (frozen capture), labeled a
  mechanism probe.
- **The shipped guard never fires in any reproduced shape** — including
  its own design band, where its arm-time read is already past the
  pointerdown-commit write (nat4: 187px in-band, guard silent). The
  race-proof build (e58b232, pointerdown-capture settlement gate) is
  verified live (writes nothing; the shell's re-clamp sticks; non-misfire
  verified on pill/composer) — but the guard is not a working mitigation
  for the defect. It stops here.
- **#2427's capture behavior is in-flight-only design**; an outliving
  capture is an unhandled edge (their test covers prepend + continued
  gesture only). The re-scoped report is review-ready; upstream filing
  decision stays with the operator.

## Update 2026-10-03 — guard fix verified live; investigation closed

The interrupted verification was rerun directly (the child's background runs
had crashed with the daemon restart and nobody resumed them):

- **Band mode (the guard's design case) now fires correctly.** Staged
  pending capture; reader parked 200 px above the bottom of the pane
  (staged-guard.mjs run): the click's host clamp lands (6125 → 6305), and
  17 ms later the guard's restore reverts it (6299 → 6125) with its wheel
  dispatch ahead — reader position preserved, final 6125. This is the
  shape the guard existed for; it never fired before this fix.
- **Bottom mode stays silent** (verify-guard-baseline.mjs): reader pinned
  at bottom, click → no guard writes at all; the reader ends pinned
  (13234 of max 13234). No cement, no fighting the shell. Pill
  non-misfire re-verified (host re-pin from 640 px up, guard silent).
- Note for anyone re-verifying: the served host bundle changed identity
  mid-investigation (bb's own app updated; page-shell-B24TvAJg.js is now
  bottom-anchored-scroll-body-BCoAmb30.js with renamed symbols). The
  recorded stacks are valid artifacts of their runs; the SHA-pinned
  source still matches.

Guard commits: `915c85c` (settle-listener suppression, superseded) and
`e58b232` + `ee6fbc9` (pointerdown-capture baseline; the working form;
dev merge `2ec8ef8`, suite 660 green). Issue for the host defect:
get-bb/bb#4793.
