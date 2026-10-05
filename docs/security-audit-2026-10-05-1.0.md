---
title: Security audit — focus-board 1.0 (re-audit of the 0.6.0–0.9.0 surfaces)
date: 2026-10-05
scope: Scoped re-audit: every surface added after the 2026-09-28 audit of 0.5.6 — ✨ auto-rename (bridge + hidden probe), workspace-open daemon client, snooze records and wake timers, CLI additions (autotitle, snooze, sweep --json). Unchanged surfaces carry over from the previous audit by reference.
result: No critical or high findings. Three low, four informational. Nothing blocks the 1.0.0 release gate.
verification: 1015 vitest tests pass across 68 files (full suite), `tsc --noEmit` clean, `npm audit` reports 0 vulnerabilities in the production and dev dependency trees, and the sink greps over shipped code (server.ts, app.tsx, lib/, components/, excluding tests/ and scripts/) came back negative for dangerous HTML, execution, process, and navigation sinks.
---

# Security audit — 2026-10-05 (focus-board 1.0 re-audit)

[!NOTE] Same trust boundaries as the 2026-09-28 audit: this covers the plugin's own code, not the bb host or the SDK. The plugin still leaves the host's markdown sanitization, RPC transport auth, and link routing to the host. This audit is read-only — no code was changed and no tests were added; verdicts pin observations at the checked-out tree.

## Attack surface inventory

| Surface | Entry point | Untrusted input | Verdict |
| --- | --- | --- | --- |
| Plugin RPC (existing methods) | `bb.rpc.register` in `server.ts` | Board frontend inputs | Safe — carry-over from 2026-09-28; every method zod-contracted with caps |
| Plugin CLI (existing commands) | `bb focus-board done *`, `config *` | Operator argv | Safe — carry-over from 2026-09-28; validated, fail-loud |
| GitHub cache read | `lib/tracker-status.ts` | Thread titles / refs | Safe — carry-over; readonly SQLite, parameterized |
| File-existence check | `workspace_files_exist` RPC | Message-derived paths | Safe — carry-over; `resolveWithinRoot` containment unchanged |
| Message DOM decoration | `components/decorate-inline-code.ts` | Assistant/user message text | Safe — carry-over; constant-only HTML sink |
| Pane link capture | `components/thread-pane.tsx` | Rendered anchor hrefs | Safe — carry-over; scheme classification + server-verified paths |
| Ticket chips | `lib/tickets.ts`, `components/thread-card.tsx` | Thread titles, branch names | Safe — carry-over; hrefs restricted to `https://github.com/…` |
| Rank store | `rank_move`, `lib/rank.ts` | `columnKey` | Safe — the 0.5.6 finding's charset guard is present at `server.ts:100-104` (`COLUMN_KEY_SCHEMA` rejects `__proto__` and control chars); remediation verified this audit |
| ✨ auto-rename RPC | `thread_autotitle`, `thread_autotitle_services` (`server.ts:1350-1403`) | Thread-derived prompt text, service override pair | Safe with notes — fail-loud target resolution, title clamped to 120 chars; probe-tool residual is Low finding 3 |
| Hidden probe thread | `bb.sdk.threads.spawn` at `server.ts:1163` | Untrusted originating thread prompt | Low — "No tools" guardrail is promptual only (finding 3); deletion ordered-but-best-effort (finding 4) |
| Cross-plugin bridge | `plugins.callRpc` method `complete` (`server.ts:1383`, `923-948`) | AI-service reply | Safe — reply text type-checked before use; the capability probe deliberately sends a non-string prompt that cannot reach a model |
| Workspace-open daemon client | `lib/workspace-open.ts` via `workspace_open_*` RPCs | Daemon HTTP responses | Safe — hardcoded `127.0.0.1`, target-id membership check, server-authoritative directory; port range is Info finding 6 |
| Workspace-open menu | `components/workspace-open-menu.tsx` | RPC state | Safe — icons from a fixed registry, errors rendered as text, `noopener` present |
| Snooze | `lib/snooze.ts`, `snooze_set/list/clear`, wake timers | `wakeAt` timestamps | Safe with notes — fail-loud record parsing, past times rejected; timer rejection paths are Low findings 1–2 |
| CLI additions | `autotitle *`, `snooze *`, `sweep --json` | Operator argv | Safe — fail-loud, no shell interpolation; one numeric-overflow edge is Info finding 7 |

## XSS review

Three differently framed searches were run over shipped code (dangerous HTML sinks, navigation sinks, dynamic execution):

- **Negative on all HTML and execution sinks.** No `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` in `server.ts`, `app.tsx`, `lib/`, or `components/`. The only raw sink remains the compile-time constant SVG in `decorate-inline-code.ts:28`.
- **Both `window.open` sites carry `noopener`.** `app.tsx:1676-1680` (card menu, href rebuilt from the same-origin thread URL) and `components/workspace-open-menu.tsx:227` (pane header). The 0.5.6 finding 1 remediation is verified in shipped code.
- **The generated title is model text, not markup.** Autotitle output is whitespace-collapsed, quote-stripped, and capped at 120 characters server-side (`lib/autotitle.ts:235-261`), committed as a thread title through bb's own `thread.rename` gesture (the host owns the write), and rendered everywhere as React text. It cannot contain working markup. A crafted thread could still steer the title content itself (an off-topic or `#123`-style title that the carry-over ticket-chip matcher turns into a GitHub issue chip) — chip hrefs remain restricted to `https://github.com/…`, same as 0.5.6.
- **Prompt injection into the AI-service bridge has bounded effect.** Thread content flows into `buildAutotitlePrompt` (clamped to 4000 chars, `lib/autotitle.ts:167,204-210`) and the reply is type-checked (`reply.text` must be a string, `server.ts:1390-1394`) and clamped before commit. The model reply can only become a title string; it reaches no sink but React text.
- **The workspace-open icon payload is never rendered.** The daemon's icon object (valid with `.passthrough()`, so `dataUrl` fields ride through the contract) is carried in RPC output but the menu maps each target's `kind` to a fixed registry icon and never reads `target.icon` (`components/workspace-open-menu.tsx:94-107`). No image or URL sink exists for it.
- **Error strings render as text.** Daemon error messages and `bridgeReason` strings are rendered as React text children (`workspace-open-menu.tsx:333-342`, `autotitle-fallback-modal.tsx`), never as markup.

## Injection and traversal

- **SQL**: unchanged from 0.5.6 (carry-over; `readGitHubStatuses` parameterized, readonly).
- **SSRF boundary for the daemon client is loopback-only.** Every URL is a template literal over a hardcoded `http://127.0.0.1:${port}` host (`lib/workspace-open.ts:146,171,205`); ports come solely from bb's own `system.config` (`server.ts:488-496,516-519`), filtered to positive integers (`daemonPortsFromSystemConfig`, `lib/workspace-open.ts:90-100`). No caller-supplied host, scheme, path prefix, or query value enters the URL: the one interpolated query value is `encodeURIComponent(root)`, and root is the thread's environment path resolved by bb (`server.ts:512-514`), not client input.
- **The directory handed to the daemon is server-authoritative.** `workspace_open_in_target` re-resolves the state fresh, requires the requested `targetId` to match one of the daemon-discovered targets (`server.ts:1450-1459`), and only then POSTs `{ context: { kind: "local" }, path: root, targetId }` (`lib/workspace-open.ts:198-222`). A client can never name a path — only a threadId, and only the workspace bb assigned to it is ever sent.
- **Responses are schema-gated.** `/status` must parse to `{ hostId }`, targets parse through `daemonTargetsResponseSchema`, errors parse through `daemonErrorSchema` with an HTTP-status fallback (`lib/workspace-open.ts:61-87,124-131`); malformed bodies fail loud rather than flowing into the menu. The host cross-check (`probe.hostId !== environmentHostId`, `lib/workspace-open.ts:283-290`) prevents opening workspaces that live on another machine.
- **Command injection: none in the plugin runtime.** No `child_process` in the plugin's shipped code; the only two occurrences are dev-only UAT/screenshot scripts spawning fixed argv (`scripts/uat/run.mjs:44`, `scripts/uat/probe-reachability.mjs:17`, no `shell: true`).
- **Prompt injection (autotitle) itself is inherent and bounded** — it is the same shape bb's own titling uses; the residual the probe adds is finding 3 below.

## Resource and state handling

- **Snooze timestamp validation is tight.** `snooze_set` requires an epoch-parseable `wakeAt` in the zod contract and rejects past times in the handler (`server.ts:153-162,1332-1345`); the CLI's `parseWhenArg` accepts only a strict `+<N><mhdw>` form or a strictly future epoch-parseable timestamp (`lib/snooze.ts:94-109`). Past-due records fire immediately on load (`armAllSnoozes`, `server.ts:887-896`) and every wake re-checks the fresh record, so a stale or replaced timer slot is a guaranteed no-op.
- **Timer growth is bounded.** `wakeTimers` is keyed one slot per thread, replaced on re-snooze, cleared on clear (`server.ts:757-762`), dropped on dispose (`server.ts:2263-2267`), and re-armed from the live thread list after a restart, so no timer outlives its record. Records themselves ride per-thread host metadata, so a thread that leaves the live list leaves no unbounded plugin-side state; unparseable stamps never wake (`server.ts:893`).
- **Probe resources are bounded**: 120 s deadline with 1 s polling, a 40-page timeline walk cap (`server.ts:1024`), 4000-char prompt, 120-char title, and the 5 s bridge probe reuses a 60 s TTL cache (`server.ts:920-960`). The workspace-open targets cache is TTL-bounded (5 min, `server.ts:485`) with lazy eviction, sized by distinct roots actually opened.
- **Fail-loud state parsing holds.** `parseSnoozeRecord` throws on a malformed present value (`lib/snooze.ts:41-57`) — a snooze record is never coerced into silence. The wake scan and the timer path wrap this fail-loudness differently, and the aggregate behavior has two low findings (1 and 2 below).
- **npm audit: 0 vulnerabilities** in the production tree and 0 in the dev tree at the audited lockfile.

## Findings and recommendations

| # | Severity | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- |
| 1 | Low | `fireWake` rejections on the timer path are unhandled: both arm sites invoke it bare (`void fireWake(...)`, `server.ts:818` and `server.ts:829`), while inside `fireWake` the record read (`server.ts:775`) and the record deletion (`server.ts:801-804`) can throw — e.g. `parseSnoozeRecord` on a record corrupted between read and wake, or a failed metadata remove. Only the `markUnread` call is caught. An unhandled promise rejection inside the bb server process is a crash-class event, and a snooze timer is a routine trigger for it | Make `fireWake` self-catching end-to-end (wrap the body, log like the `markUnread` catch already does), or attach `.catch` at both arm sites in `armWakeAt` | Open |
| 2 | Low | The load-time wake scan aborts at the first thread whose metadata throws: `armAllSnoozes` (`server.ts:887-896`) has no per-row catch, so one malformed snooze record stops arming every later snoozed thread, and the whole scan is then silenced by the single `.catch` that logs at `server.ts:2258-2262`. Net effect: silent missed wakes after a plugin reload, contradicting the comment's claim of per-thread resilience | Wrap the per-row read in try/catch (log and continue to the next row) so one corrupt record cannot starve the rest of the wake set | Open |
| 3 | Low | The thread-model probe is a real hidden agent turn spawned into the source thread's project/environment (`server.ts:1163-1173`), and its only tool restriction is the promptual "No tools: only write the title." suffix (`lib/autotitle-thread-model.ts:17-19`). The probe prompt's payload is the untrusted originating thread prompt, so prompt injection steering the probe turn is possible, and an instruction-ignoring model retains whatever tool access a spawned thread normally has in that environment | Check whether the SDK spawn accepts a tools-disabled/read-only execution option and pass it for probes; otherwise document the residual (probe inherits environment tool access; payload is thread content) in the fallback modal or the probe's title, so an operator who disables the ✨ probe knows why | Open |
| 4 | Info | Probe deletion is ordered but best-effort: the stop-before-delete + `finally` chain (`server.ts:1240-1247`) guarantees deletion is attempted on every post-spawn path, yet a failed `threads.delete` leaves a hidden "✨ title probe (auto-deleted)" thread behind with only a warn log (`server.ts:1191-1202`), and a spawn reply with no parseable id (`server.ts:1174-1178`) strands a spawned thread with no handle to delete. Pinned by tests: success, error, and no-reply paths all assert one deletion in `tests/autotitle-rpc.test.ts` | Acceptably rare; consider counting leaked probes in the log line (or a sweep-visible marker) if leaked hidden threads ever become operator-visible noise. No in-code action required for 1.0 | Open |
| 5 | Info | Prompt injection of thread content into a generated title is inherent to auto-titling (bb's own titling shares the shape). Impact is bounded to title text: clamped to 120 chars, rendered as React text, chips restricted to `https://github.com/…`. No in-plugin mitigation applies | None in-plugin; the bounded-impact note in the ✨ XSS findings stands as the accepted residual | — |
| 6 | Info | Daemon ports are validated as positive integers without an upper range check (`lib/workspace-open.ts:96`); an out-of-bounds configured port just fails fetch, and the host is hardcoded to `127.0.0.1`, so no exploit path exists | Boundary-check against the usual 1–65535 for tidiness when convenient | Open |
| 7 | Info | A CLI `snooze set` with a relative duration large enough to overflow Date arithmetic (e.g. `+100000000w`) yields an Invalid Date from `parseWhenArg` (`lib/snooze.ts:94-109`); `writeSnooze` has already marked the thread read before `stampSnooze`'s `toISOString` throws, leaving a read-mark side effect without a snooze record and an obscure RangeError instead of the CLI's `invalid_value` wording (`server.ts:845-865`) | Bound the computed duration in `parseWhenArg` (reject values beyond the Date range) so the failure precedes the `markRead` side effect | Open |

## Tests added this audit

None — this audit is read-only by instruction (findings are recommendations only; no code or test files were edited). The surfaces above are already pinned by these existing tests, which this audit reviewed as part of verification:

- `tests/autotitle-rpc.test.ts` — hidden probe spawn shape (`visibility: "hidden"`, explicit provenance, "no tools" prompt), deletion asserted on the success, error, and no-reply paths; refusal when no provider/model is resolvable.
- `tests/autotitle-cli.test.ts`, `tests/autotitle.test.ts`, `tests/autotitle-thread-model.test.ts` — fail-loud selection/target resolution, prompt clamping, title cleaning caps, think-block stripping.
- `tests/workspace-open.test.ts` — hardcoded `127.0.0.1` URLs for `/status`, target discovery, and `open-in-target`; schema-gated response parsing; unavailable verdicts with reasons.
- `tests/thread-pane-workspace-open.test.tsx` — the menu renders nothing when unavailable and surfaces open failures inline.
- `tests/snooze-rpc.test.ts`, `tests/snooze.test.ts`, `tests/snooze-cli.test.ts` — past-wake rejection, immediate fire of past-due records at load, fail-loud record parsing, strict `+<N><mhdw>` CLI parsing.
- `tests/sweep-cli.test.ts`, `tests/cli.test.ts` — argv validation, fail-loud CLI errors (no shell interpolation anywhere).