# Plan: bb/autotitle-probe-fetch-once-thr_puzvmb77q7

Source: review of [issue #10](https://github.com/cristoslc/bb-plugin-focus-board/issues/10) (thread thr_puzvmb77q7). The issue's bug itself is already fixed and merged to dev in 1261e8c; two minor review findings remain from the same code.

## Problem

1. **Double thread-row fetch.** `server.ts`'s `threadModelAvailability` calls `probeSpawnPlan(threadId)` (which does `bb.sdk.threads.get`) and then re-fetches the same row with a second `bb.sdk.threads.get`. `probeThreadModelTitle` repeats the same pattern. Two SDK round-trips per probe invocation where one suffices — the source-of-truth fetch is duplicated.
2. **Dead type field.** `probeSpawnPlan`'s casting type for the `threads.get` result declares `environmentId?: unknown`, but the function never reads it (both consumers read it again from their own redundant fetch). With the double fetch removed this stale field goes away too.

## Goal

Exactly one `bb.sdk.threads.get` per probe invocation path (availability check and title probe). No behavior change; refusal reasons, spawn args, and modal copy stay byte-identical.

## Approach

- `probeSpawnPlan` reads the source row it already needs; the spawnable plan variants carry the resolved `source` (projectId/environmentId) with them, so both consumers drop their own `threads.get` call.
- Remove the unused `environmentId` from the probeSpawnPlan-local `threads.get` cast type (the carried source type keeps the field — consumers still need it).
- The inherited tier and refusal tier keep their current shapes; refusal reasons unchanged.

## Verification

- No behavior change, so no new test fixture is required; the existing contract tests stay as-is: `tests/autotitle-rpc.test.ts` (fallback-chain contract), `tests/autotitle-thread-model.test.ts` (probe spawn path), `tests/autotitle-cli.test.ts` (CLI reason pins).
- Full `npm test` green (baseline at plan time: 68 files / 1017 tests).
- No CHANGELOG entry: internal plumbing is not user-facing per the release rules. Coverage matrix unchanged (no behavior delta).

## Non-goals

- No core-side default-chain work (that is the issue's ADR-0001 recommendation at bb core, out of plugin scope).
- No modal copy or refusal-reason rewording.