---
title: Security audit — focus-board 1.1 (re-audit of the post-1.0 tracker-link surfaces)
date: 2026-10-09
scope: Scoped re-audit: every surface added after the 2026-10-05 audit of 1.0 — the linked-issues store (RPC `link_list/set/clear`, CLI `link *`, agent tool `focus_board_link_issue`), ticket-chip rendering (provider marks, issue-vs-PR glyphs, favicon), the `tracker_validate` text-ref existence probe, reveal-browser-tab, and the pane's question-form drafts. Unchanged surfaces carry over from the 2026-10-05 and 2026-09-28 audits by reference.
result: No critical or high findings. Two low findings, both in the `tracker_validate` HTTP probe, remediated the same day (red tests first): loopback/private hosts are now refused outright and the probe follows no redirects, confirming on 2xx only. Two informational residuals accepted and documented.
verification: 1238 vitest tests pass across 84 files (full suite, including the 5 new probe-boundary tests), `npm run gates` passes — npm audit clean in the production and dev trees, sink greps over 70 shipped files clean with the documented allowlists — and the gates script's `fetch(` allowlist now names this audit for the approved `tracker_validate` seam.
---

# Security audit — 2026-10-09 (focus-board 1.1 re-audit)

[!NOTE] Same trust boundaries as the prior audits: this covers the plugin's own code, not the bb host or the SDK. Markdown sanitization, RPC transport auth, and browser/daemon control ride bb. This audit was read-only at finding time; the two Low findings were remediated in the same session, red tests first, and the remediation is pinned by the tests at the bottom.

## Attack surface inventory

| Surface | Entry point | Untrusted input | Verdict |
| --- | --- | --- | --- |
| Linked-issues store | `lib/link-metadata.ts` via `link_set/list/clear` RPCs, CLI `link *`, agent tool | Thread metadata reads/writes | Safe — fail-loud parse (`parseLink` throws on any malformed entry, `lib/link-metadata.ts:121-195`); external URLs must be https (`:98-100`); `hostname` always derives from `new URL(url)` at write and again at read, never trusted from storage (`:101-106`, `:138-144`); GitHub records' `href` restricted to `https://github.com/…` (`server.ts:128`) |
| Ticket chips | `components/thread-card.tsx:170-245`, `lib/tickets.ts`, `lib/link-metadata.ts:245-280` | Thread titles, branch names, stored links | Safe with notes — chips render as React children (no markup sink); anchors carry `target="_blank" rel="noreferrer"` (`thread-card.tsx:235-245`); favicon `<img src>` is an accepted Info residual (finding 3) |
| `tracker_status` RPC | `lib/tracker-status.ts` via `server.ts:1697-1702` | `owner/repo#N` keys | Safe — carry-over from 2026-10-05; readonly SQLite, parameterized, batch capped at 500 (`server.ts:284`) |
| `tracker_validate` RPC | `lib/tracker-validate.ts` via `server.ts:1703-1734` | https text-ref URLs from visible card text | Low ×2 remediated — the HTTP existence probe pointed at caller-supplied hosts with no screening (finding 1) and followed redirects (finding 2); both fixed red-first this audit |
| `focus_board_link_issue` agent tool | `server.ts:2735-2833` | Agent-supplied url/number/label | Safe — schema mirrors `link_set` (https-only url, exactly-one-of number/url, label 1..80); a bare-number link resolves the repo only from the calling project's own git remote (`server.ts:2802-2808`); writes bind to `ctx.threadId`; store links skip `tracker_validate` entirely ("trusted by construction") |
| Reveal browser tab | `lib/browser-reveal.ts:101-150`, card menu `app.tsx:1838-1847` | bb desktop-browser tab records | Safe — discovered tab URLs are used only for the blank-tab filter (`isBlankTabUrl`, `:148-150`) and never render; the reveal goes through bb's own SDK gesture (`experimental_desktopBrowsers.revealTab`); the board banner renders plain `{ message }` strings as React text (`components/board.tsx:818`) |
| Question-form drafts | `components/pending-interaction-card.tsx:264-318` | The operator's own draft state | Safe — same-origin `localStorage` mirror, versioned `{ v: 1 }`; `readQuestionDraft` fails safe (unreadable/invalid → null, unknown questions and stale selections dropped, `:270-305`); writes are best-effort, values rehydrate into React-controlled inputs only |
| Pane actions reorder · viewport lane wrap · word-key refusal | `components/thread-pane.tsx`, `components/parent-lane-*.ts` | — | Safe — layout/UI restructure and a validation tightening (only GitHub-confirmable refs chip), no new sinks |

## XSS review

- **Negative on all HTML, execution, and unexpected navigation sinks** — re-verified by the standing gates run at audit time: no `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`; the only `innerHTML` is the audit-approved constant SVG; both `window.open` sites carry `noopener`.
- **Chip anchors are inert.** The chip `<a>` gets the stored URL as `href`, `target="_blank"`, `rel="noreferrer"` (implies `noopener`), and renders its text via React children; external chips render `label ? label : hostname` as text. No chip field reaches `style`, `background-image`, or markup.
- **The favicon `<img>` requests an external subresource** (`thread-card.tsx:177-191`): `src={`https://${ticket.hostname}/favicon.ico`}`, hostname scheme-prefixed and URL-derived. This is deliberate feature surface (finding 3).
- **Banner and notice strings render as text.** The reveal banner's message (which interpolates `thread.displayTitle`) and all failure strings are React text children; no href or image sinks exist on the banner path.

## SSRF and outbound boundaries

- **The workspace-open daemon client boundary is unchanged** (carry-over from 2026-10-05): hardcoded `127.0.0.1` template hosts, server-authoritative directories, schema-gated responses.
- **The one new outbound boundary is the `tracker_validate` existence probe**, audited here: it GETs caller-supplied https URLs (zod-capped at 100, `startsWith("https://")`) with a 10s timeout, reads only the response status, and TTL-caches the outcome (6h up / 10min down). Untrusted thread text (a title or branch name carrying an https URL or `#N` ref with a forgejo base) is what can drive it — findings 1 and 2 cover the screening gap; both have been remediated (loopback/private/refused-before-fetch; manual redirects; 2xx-only confirm). Documented residual: a DNS name that resolves to a private address is not screened (the seam does no resolution); impact is bounded to a one-bit existence signal per URL because no response content is read or stored.
- **Store links are excluded from the probe by design**: anything written through `link_set`, the CLI, or the agent tool never triggers an HTTP check — the https-only, hostname-derived write boundary is the control point for those.

## Resource and state handling

- **The probe batch is bounded**: ≤100 URLs per call, per-URL 10s timeout, concurrent-per-batch fan-out only over visible refs, TTL caches prevent re-probing (a refused host stamps the KV as unconfirmed with the short TTL, so refusal is also memoized).
- **Link store growth is bounded by the thread metadata record**: `stampLinkedIssues` upserts and `clearLinkedIssues` collapses to null-with-key-removal; a `link_list` snapshot reads at most one array per live thread.
- **npm audit: 0 vulnerabilities** in the production tree and the dev tree at the audited lockfile.

## Findings and recommendations

| # | Severity | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- |
| 1 | Low | `tracker_validate`'s HTTP probe fetched any caller-supplied `https://` URL with no host screening. Text refs come from untrusted thread text, so a crafted title/branch could make the operator's board probe loopback/private https services (e.g. `https://localhost:9200/…`) and read the result as chip presence | Refuse loopback and mDNS hostnames and private/loopback/link-local IP literals before any fetch (`probeRefused`), and cache the refusal like a failed check | Remediated 2026-10-09 (red tests first: loopback + private-range refs never spend a fetch, refusal caches short-TTL) |
| 2 | Low | The same probe followed redirects (`fetch` default `redirect: "follow"`), so a public URL could redirect the request anywhere, and a login wall's final 200 wrongly confirmed existence (chips lit for items behind auth) | Probe with `redirect: "manual"` (an opaque redirect arrives as status 0) and confirm on 2xx only, so both the redirect carry and the login-wall confirmation fail | Remediated 2026-10-09 (red tests first: the seam sends `redirect: "manual"`; 0 and 302 responses never confirm) |
| 3 | Info | The external chip's favicon loads `<img src={`https://${hostname}/favicon.ico`}>` from the board DOM — one outbound image request per distinct external hostname; bb sets no CSP here. No credentials ride the request and the response is unread, but the fetch is visible to that host as a view signal | Accept for 1.1 (it is the feature's point); if chip hosts are later restricted to a known-tracker registry, switch favicons to that registry's CDN | Accepted residual |
| 4 | Info | `url`/`href` strings in link records have no max length (`startsWith("https://")` is the only server-side constraint, `server.ts:136`); long URLs ride the record and echo as anchor hrefs | Bound if chip URLs ever render visibly beyond truncation; today the chip shows hostname or a ≤80-char label | Accepted residual |

## Remediation (same session, red tests first)

- `lib/tracker-validate.ts` — new `probeRefused` host screen (findings 1); the fetch seam sends `redirect: "manual"` and confirms on 2xx only (finding 2). The refused path stamps the KV with the 10-minute TTL, so a craftable ref cannot re-probe the plugin server into steady outbound behavior either.
- `scripts/security-gates.mjs` — the `fetch(` allowlist now names this audit for the single approved seam: the `server.ts` forwarding line that hands the platform fetch into `validateTrackerUrls`. Any other `server.ts` fetch site remains a gate violation.
- `tests/tracker-validate.test.ts` — five new tests pin the boundary: loopback refs (and `*.localhost`) never spend a fetch; private-range/link-local IPv4 and `[::1]` are refused; refusal caches as unconfirmed with the short TTL; the seam requests manual redirects; a redirect (opaque or 302) never confirms.

## Evidence reviewed this audit

- `tests/tracker-validate.test.ts` — existence-check semantics, TTL caches, network-failure degradation, plus the five new boundary tests.
- `tests/link-metadata.test.ts`, `tests/link-rpc.test.ts`, `tests/link-agent-tool.test.ts` — store round-trip with malformed-record fail-loudness; https-only and label-bound write rules; exactly-one-of contracts; remote-resolution failure surfaced as an error result.
- `tests/thread-card-ticket-chips.test.tsx`, `tests/tickets.test.ts` — glyph/provider rendering, external favicon chip, word-key refs never chipping, forgejo base hostname derivation.
- `tests/browser-reveal.test.ts`, `tests/board-browser-notice.test.tsx` — focus-then-reveal order, blank-tab skipping, banner text-only rendering.
- `scripts/security-gates.mjs` output at audit close: audit clean in both trees; sink scan over 70 shipped files with the documented allowlists; the tracker_validate seam allowlisted naming this document.