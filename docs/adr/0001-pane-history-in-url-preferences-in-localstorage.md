# ADR 0001 — Pane state lives in URL history; view preferences live in localStorage

- Status: accepted
- Date: 2026-09-28
- Decided in: the pane-history thread (shipped in 0.5.0)

## Context

The Focus Board panel holds two kinds of state that both used to die on the
first link-out:

- **Which thread's pane is open** (and its frozen column) — plain React
  state on `BoardPage`.
- **How the board is arranged** — group-by, filters, search, nesting toggle —
  already persisted to `localStorage` (keys `focus-board:*`).

bb's back arrow walks browser history. A nav panel participates in that
history only through its `subPath` route remainder
(`/plugins/<pluginId>/board/*`), pushed via
`useBbNavigate().toPluginPanel(path, { subPath })`.

## Decision

The two kinds of state get different homes, deliberately:

| State | Home | Why |
| --- | --- | --- |
| Open pane (`t/<threadId>`) | Panel subPath → browser history | Opening a pane is a *navigation act* ("go look at this thread"). Back/forward, reload, deep links, and link-outs to main bb must land on the pane the user left. Each opened pane is one history entry, so back walks the trail of cards the user opened — including ones they lost track of. |
| Group-by, filters, search, nesting | `localStorage` (`focus-board:*`) | These are *view adjustments* — the board equivalent of zoom. Replaying them through back/forward would make the back arrow unreliable for its main job (undoing pane navigation), and every keystroke in the search box would spam history entries. |

Consequences of the split, accepted:

- **Back cannot restore a filter/group combination.** If the user changes
  the grouping and hits back, the pane state (if any) is restored but the
  grouping stays as-changed. A filter change can also hide the open pane's
  card entirely; the pane stays open regardless.
- **Every pane transition is a history step, including close.** Opening or
  switching panes pushes `t/<threadId>`; closing (× / Escape / phone
  back-chevron) pushes the panel root — so back after a close reopens the
  pane (close is never lost work) and forward re-closes it. Nothing in the
  pane's history is unreachable.
- **Frozen column is not in the URL.** It is re-captured from the live board
  data when a pane is restored (deep link, back/forward) — the card may
  re-freeze at the column it occupies *now*, not the one it occupied when
  first opened.
- **Degradation is graceful.** If the host's `toPluginPanel` cannot push
  (returns false or throws), the pane falls back to plain component state:
  it opens, but without URL restoration.

## Alternatives considered

- **Everything in the URL (subPath encodes group/filter/search too).** Most
  faithful "back restores everything" model, but search-as-you-type would
  push an entry per keystroke (or need debounced replaces that break
  forward), and the subPath grammar grows to a query-string-shaped blob the
  panel must parse forever. Rejected: complexity and history noise for a
  gain back arrow users do not expect from a view adjustment.
- **Everything in localStorage/sessionStorage ("restore on return").** One
  hop only: back leaves main bb the normal way and the pane is restored from
  storage. Simpler, but it loses the trail — the user specifically wanted
  back to reopen cards they lost track of — and it cannot express "closed on
  purpose" vs "left open when I navigated away" without extra machinery.
  Rejected.
- **History state objects (`history.pushState(state)`)** instead of the
  subPath. Would work for back/forward but bypasses the host router — deep
  links and bb's own route-to-panel navigation would not carry the state.
  Rejected in favor of the documented `toPluginPanel` contract.

## Verification

- `tests/pane-route.test.ts` — subPath codec.
- `tests/manual/uat-pane-history.yaml` — real `history.pushState`/`back`
  against the harness's mock router: click pushes, back reopens the trail,
  foreign-surface push-and-back restores the pane, Escape-close replaces,
  deep links open (malformed ones degrade).
- Live-host cell (manual): bb's back arrow after a real link-out.