---
type: review-response
timestamp: 2026-09-28T183834
responding-to: Orchestrator code review of the full PR diff against plan D10/D11
---

## Review response: family keep-and-dim in lane mode no longer depends on the nesting toggle

**Responding to:** the closure code review found one wiring gap — `familyFiltered` in `app.tsx` chose `filterFamilies` only when `nestChildren` was on, so lane mode with nesting toggled OFF dropped non-matching families instead of dimming them, contradicting D10 (keep-and-dim applies unchanged) and D11 (the nesting toggle is inert under the "parent" grouping).

Fix: the family-first path now fires when `nestChildren || groupBy === "parent"`, so lane mode always keeps families on a single-member match and dims the rest, regardless of the persisted toggle. Toggle semantics for every other grouping are unchanged. Also added the missing trailing newline to `components/preferences.ts`.

Verification after the fix: `npm test` 459 passed / 29 files, `npx tsc --noEmit` clean, `npm run build` clean.

**Commits in this unit:** see the commit that carries this entry (amended into the push below).