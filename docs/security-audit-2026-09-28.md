---
title: Security audit — focus-board 0.5.6
date: 2026-09-28
scope: Full plugin surface (server RPC + CLI, frontend board/pane, build + UAT tooling)
result: No critical or high findings. Two low, two informational.
verification: 412 vitest tests pass (3 new adversarial XSS tests), `tsc --noEmit` clean, `npm audit` clean for production and dev dependency trees.
---

# Security audit — 2026-09-28 (focus-board 0.5.6)

[!NOTE] This audit covered the plugin's own code, not the bb host or the SDK. Surfaces the host owns (markdown sanitization, RPC transport auth, link routing) are called out as trust boundaries.

## Attack surface inventory

| Surface | Entry point | Untrusted input | Verdict |
| --- | --- | --- | --- |
| Plugin RPC | `bb.rpc.register` in `server.ts` | Board frontend inputs | Safe — every method is zod-contracted with caps |
| Plugin CLI | `bb focus-board *` | Operator argv | Safe — validated, fail-loud |
| GitHub cache read | `lib/tracker-status.ts` | Thread titles / refs | Safe — readonly SQLite, parameterized |
| File-existence check | `workspace_files_exist` RPC | Message-derived paths | Safe — `resolveWithinRoot` containment |
| Message DOM decoration | `components/decorate-inline-code.ts` | Assistant/user message text | Safe — constant-only HTML sink |
| Pane link capture | `components/thread-pane.tsx` | Rendered anchor hrefs | Safe — scheme classification + server-verified paths |
| Ticket chips | `lib/tickets.ts`, `components/thread-card.tsx` | Thread titles, branch names | Safe — hrefs restricted to `https://github.com/…` |
| Dev tooling | `scripts/screenshot`, `scripts/uat` | None (fixed argv, local) | Safe — dev-only |

## XSS review

Three differently framed sink searches (dangerous HTML sinks, navigation sinks, dynamic execution) found:

- **No `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` anywhere in shipped code.** All message content renders through React, which escapes text by default.
- The only raw-HTML sink is `icon.innerHTML = EXTERNAL_LINK_ICON` in `decorate-inline-code.ts:50` — a compile-time constant SVG, not failable.
- **Ticket hrefs cannot be attacker-scripted.** `GITHUB_URL` only captures `https://github.com/…` URLs; `#N` hrefs build from a base that `app.tsx:302` derives exclusively from `resolveRepoSlug`, which accepts only `https://github.com/` and `git@github.com:` remotes. Ticket anchors also carry `rel="noreferrer"`.
- **The pane's click capture is conservative.** External/scheme-qualified hrefs are left to the browser; claimed relative hrefs reduce to workspace paths and open only through `experimental_openFilePreview`; code-span clicks require a server-verified `data-focus-board-path-link` attribute set via `setAttribute` (no markup parsing).
- **Path decoration cannot inject markup.** A code span like `docs/<script>alert(1)</script>.md` is classified from `textContent`, stored via `setAttribute`, and decorated with only the constant icon. Pinned by the new test `decoration adds only a static icon: no scripts, handlers, or parsed markup` in `tests/decorate-inline-code.test.ts`.
- **Script schemes cannot be linkified.** `inlineCodeMarkdownPath` rejects `javascript:`, `data:`, `vbscript:`, and protocol-relative text via `isExternalHref` before any path classification. Pinned by the new test in `tests/chat-link-intercept.test.ts`.

[!IMPORTANT] Informational — the embedded `ThreadChat` renders the host's markdown. The plugin leaves scheme-qualified hrefs (`javascript:…` etc.) to the browser, as it should; XSS in chat markdown would therefore be a host-side sanitization concern, not the plugin's. Verified no plugin code amplifies it.

## Injection and traversal

- **SQL**: the only database access (`readGitHubStatuses`) uses a placeholder-built `IN (...)` list — `repo` and all numbers are bound parameters; the 500-number zod cap keeps the statement inside SQLite's parameter limit. Connection is `readonly: true, fileMustExist: true` against the hardcoded `~/.bb/plugins/github/data.db` cache — no credentials involved.
- **Path traversal**: `resolveWithinRoot` rejects absolute paths, any `~` segment, and `..` escapes at the server boundary before anything is stat-ed (`server.ts:418-433`); the frontend classifier independently rejects climb-past-root hrefs. Covered by tests on both sides. Informational caveat: a symlink inside the workspace that points outside could still stat as existing through `hosts.pathsExist` — same-host disclosure only, no read/write capability.
- **Command injection**: no `child_process` in the plugin runtime at all. UAT/screenshot scripts spawn fixed argv (`npx vite …`, no `shell: true`); YAML suite data is passed as arguments to statically defined page functions, never interpolated into code.
- **Rank store**: `rank_move`'s `columnKey` is a free-form string used as a computed object key in `writeRanks({ ...store, [columnKey]: next })` (`server.ts:483`). A `__proto__` key reassigns the store object's own prototype, not `Object.prototype`, and drops out of JSON serialization — benign. A charset guard on `columnKey` would still be cheap hardening.

## Resource and state handling

- RPC inputs are capped at the contract level (500 ticket numbers, 200 paths per check); DOM verdict caches are capped at 5,000 entries with whole-map reset; failed existence checks cool down 30 s instead of hammering the host.
- Stores validate on read and fail loud on malformed state (`parseRankStore` throws; `keptFromRow` resets with a warning) — no silent coercion of persisted state.
- Settings are schema-clamped (`1–365`, `1–3650` days) at both the settings definition and the CLI setter.
- No secrets, tokens, or credentials in the codebase (grepped source, fixtures, and scripts; `npm audit` reports 0 vulnerabilities in production and dev trees).

## Findings and recommendations

| # | Severity | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- |
| 1 | Low | `window.open(thread.href, "_blank")` at `app.tsx:875` omits `noopener`, leaving `window.opener` reachable from the opened tab (host-supplied href, so low trust impact) | Pass `"noopener"` as the third argument | Remediated 2026-09-28 |
| 2 | Low | `rank_move` `columnKey` accepts any non-empty string; a `__proto__` key is inert today but undocumented | Validate the key shape in the zod contract | Remediated 2026-09-28 |
| 3 | Info | Plugin trusts the host's markdown sanitizer for scheme-qualified hrefs in chat | None in-plugin; verify host-side sanitization covers `javascript:` hrefs |
| 4 | Info | Workspace symlinks could stat as existing beyond the workspace root | None needed for current capability; revisit if the existence check ever gains file access |

## Tests added this audit

- `tests/chat-link-intercept.test.ts` — script-executing schemes (`javascript:`, `data:`, `vbscript:`) with `.md` disguises are never linkified.
- `tests/decorate-inline-code.test.ts` — html-like code text is treated as a literal path; decorated elements gain no script elements, no inline handlers, and no markup interpretation.