# UAT report

_Generated 2026-11-17T20:52:40.672Z by `npm run uat`._

## views-mobile

Source: `tests/manual/uat-views-mobile.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The Attention board renders its lanes at 390×844 | pass | ✓ lane direction: vertical; ✓ text visible: "Unread"; ✓ unread order |
| Clicking a card opens its thread in bb's native pane at phone width | pass | ✓ native open thr_rpc_auth with split; ✓ pane closed |
| Escape closes the pane back onto the board | pass | ✓ pane closed |
| The Last activity board renders its age buckets at phone width | pass | ✓ text visible: "Today"; ✓ text visible: "A while ago" |
| The horizontal lane read lays its rows out at phone width | pass | ✓ lane direction: horizontal; ✓ text visible: "Unread"; ✓ unread order |
| The Group view renders its buckets at phone width | pass | ✓ text visible: "No group"; ✓ text visible: "chat-imagegent" |
