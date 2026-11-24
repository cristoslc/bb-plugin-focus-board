# UAT report

_Generated 2026-11-24T08:38:25.685Z by `npm run uat`._

## views-mobile

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-views-mobile.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The Attention board renders its lanes at 390×844 | pass | ✓ lane direction: vertical; ✓ text visible: "Unread"; ✓ unread order |
| Clicking a card opens its thread in the board's own pane at phone width | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth |
| Escape closes the pane back onto the board | pass | ✓ pane closed |
| Tapping an unread card leaves the board looking at it, in its idle lane | pass | ✓ unread order; ✓ card thr_rpc_auth outside the columns board's view; ✓ pane shows thr_rpc_auth; ✓ thr_rpc_auth in idle-recent; ✓ thr_rpc_auth in unread; ✓ card thr_rpc_auth in the columns board's view; ✓ board x offset 1≤960≤ |
| The Last activity board renders its age buckets at phone width | pass | ✓ text visible: "Today"; ✓ text visible: "A while ago" |
| The horizontal lane read lays its rows out at phone width | pass | ✓ lane direction: horizontal; ✓ text visible: "Unread"; ✓ unread order; ✓ the unread row gives its width to the cards |
| A phone-width horizontal lane stacks its label above the row, never beside it | pass | ✓ the working row gives its width to the cards; ✓ the done row gives its width to the cards |
| Pinning a card from a row scrolls the row it lands in, at phone width | pass | ✓ lane pinned x offset = 0; ✓ pinned order; ✓ lane pinned x offset 1≤126≤ |
| The Group view renders its buckets at phone width | pass | ✓ text visible: "No group"; ✓ text visible: "chat-imagegent" |
