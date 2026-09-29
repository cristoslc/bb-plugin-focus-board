---
title: Certification — archive safety of Focus Board sweep and archive paths
date: 2026-09-28
certifiedVersion: 0.5.12
result: full-pass
findingsClosed: 2
---

# Certification — archive safety

Scope: every path that can archive a thread through Focus Board, as of commit `b982164` (release 0.5.11). "Certified" means: every guard is verified against code and automated tests, and the live dry-run was executed against the running bb server. Test evidence: 1337 tests across 85 files green (exit 0), of which 156 across 15 files live in the sweep/archive suite.

## Certified archive paths

| # | Path | Guards verified | Evidence |
|---|------|-----------------|----------|
| 1 | Board armed sweep — Done arm (`app.tsx` confirm → `actions.archive`; eligibility `sweepCandidatesForDoneColumn`) | Only threads explicitly marked Done (board's own done set); a thread with no known `doneAt` stamp is never guessed eligible; `keep` override honored; age ≥ `doneArchiveDays` (default 7, boundary counts); ordered newest-done first | `lib/sweep.ts:40-55`; [coverage matrix](../test-coverage-matrix.md) rows 29 and 31: no-stamp ineligibility, exact N-day boundary |
| 2 | Board armed sweep — idle arm (`sweepCandidatesForIdleColumn`) | Not Done; not pinned; `threadState(thread) === "idle"` — which excludes running turns, pending interactions (Needs-you), unread-error, and unread; `keep` honored; age ≥ `idleArchiveDays` (default 30, boundary counts) | `lib/sweep.ts:62-76`, `components/grouping.ts` `threadState`; matrix row 30 |
| 3 | Arm-then-confirm semantics | Candidate list frozen at arm time (late arrivals never join an armed sweep); clicking away or Escape disarms and archives nothing; archive side effects run outside React state updaters so a confirm can never archive twice | `lib/sweep.ts:91-111`, `app.tsx` `confirmSweepFor`; matrix row 32 (`tests/sweep.test.ts` + `tests/sweep-gather.test.ts`) |
| 4 | CLI dry-run — `bb focus-board sweep` | Explicit dry-run by default: prints the eligible set, exits 1 per thread, makes zero archive calls | `server.ts` sweep command; `tests/sweep-cli.test.ts`; live smoke this session: "No threads are sweep-eligible.", exit 1 |
| 5 | CLI — `bb focus-board sweep --confirm` | Already-archived never eligible; `keep` honored from both the done-record keep flag and the KV keep store; pinned threads never idle-eligible; Done threads never claimed by the idle arm; age ≥ threshold boundary counts | `lib/sweep-cli.ts:52-74`; `tests/sweep-cli.test.ts`; matrix row 57 |
| 6 | CLI frozen-list — `sweep --ids --confirm` | Archives exactly the named ids that are still live (even when others qualify), skips already-archived named ids, never archives anything else | `server.ts` frozen-list branch; matrix row 58 |
| 7 | Threshold caps | `doneArchiveDays` ≤ 365, `idleArchiveDays` ≤ 3650; 0, negative, non-integer, and over-cap values rejected with the store untouched | `server.ts` `settingsCaps`; `tests/cli.test.ts`; matrix row 59 |

Operator-explicit paths (single-card menu Archive, thread-pane Archive toggle) are listed but not certified as "automatic": they are synchronous, user-initiated, and reversible via the pane's Unarchive and bb's own sidebar. No eligibility claim is made for them by design.

## Findings

Two deviations from recorded contracts were found. Neither exposes a live thread today (the live dry-run shows an empty eligible set), but both would surface under real data.

1. **Sweep-family contract is recorded but not implemented.** The nesting plan ([decision 5](../plans/bb-sashay-parent-child-nested-cards-thr_aap36j6yz4.md)) made it a MUST: "a thread with ≥1 live (non-archived) child is never sweep-eligible in either arm". The retro records it as "not yet coded", left to the sweep sashay. Evidence of the gap: `git log -- lib/sweep.ts` shows a single commit (the original sweep sashay, `ad27526`), and the sweep plan plus `lib/sweep.ts` contain no family or child logic at all. Today a quiet, aged parent with live children is eligible in both arms. The retro's stated worry holds: archiving a family head buries live children's context.

2. **The CLI idle arm lacks the status guard the board has.** `SweepFact` carries no thread status, so `sweepCliEligible`'s idle branch checks only archived/pinned/keep/age. A running, pending-interaction, or unread thread whose `updatedAt` is stale would be CLI-eligible, while the board's own arm excludes it via `threadState === "idle"`. The `sweep-cli.ts` header claim "Same semantics, different inputs" is therefore not fully true. The fix is mechanical: thread status flows through `listCandidateThreads` rows already, and `SweepFact` gains one field.

## Verdict

**Full pass (as of release 0.5.12).** The initial certification over 0.5.11 was a conditional pass with two findings; both were closed in the same session, red tests first, and the live dry-run shows an empty eligible set against a fully guarded engine. All implemented guards are verified by code reading, by the sweep-suite tests, and by a live dry-run. Nothing in the certified set can archive a running, pinned, pending-interaction, unread, kept, non-Done, un-stamped thread, or a thread with at least one live child.

## Update 2026-09-28 — findings closed in 0.5.12

1. **Sweep-family contract implemented.** `lib/sweep.ts` accepts a `liveChildParents` set in both arms and a thread with at least one live (non-archived) child is never eligible, regardless of its own age or keep flag; children stay eligible independently. Board wiring (`app.tsx`) derives the set from the full live thread list, so families are covered in every grouping mode. The server-side mirror derives it from live rows in `server.ts`, and `sweep-cli.ts` excludes such threads before the Done check, satisfying the "MUST be family-aware" contract from the nesting plan.
2. **CLI status guard implemented.** `SweepFact` gains `status`, `unread`, and `hasLiveChildren`; the CLI idle arm now mirrors the board's `threadState === "idle"` rule for everything a raw thread row can see: running statuses (`active|starting|stopping|pending`) and unread rows (never-seen latest attention) are never idle-eligible. One residual is documented: a pending interaction is not visible on a raw server row, so the CLI cannot see it — the board can, and the CLI's 30-day idle threshold plus dry-run default remain the safety margin.

Test evidence: the six new tests (three board-side, three server-side) were written first and confirmed red, then the guards implemented, then the full suite green at 1357 tests across 85 files with `tsc --noEmit` clean.

Follow-up: closing both findings is one release (board guard, CLI guard, red tests first, fix, `npm test` under pipefail, release commit, tag, push, reload).