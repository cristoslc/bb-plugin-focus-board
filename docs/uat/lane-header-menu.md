# UAT report

_Generated 2026-11-05T17:35:00.049Z by `npm run uat`._

## lane-header-menu

Source: `tests/manual/uat-lane-menu.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A slide that starts on a lane header is a pan, not a menu | pass | ✓ the finger landed on {"column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ lane pinned header label is "Pinned lane actions"; ✓ lane pinned menu closed; ✓ no rank_clear call |
| Tapping the lane's 3-dot trigger opens the menu naming recency, newest first | pass | ✓ lane unread menu open; ✓ lane unread menu offers Sweep this lane; ✓ lane unread menu hides Remove custom order; ✓ lane unread menu sort state is recency |
| A ranked lane's menu names the hand order and offers Remove custom order | pass | ✓ lane unread menu open; ✓ lane unread menu offers Remove custom order; ✓ lane unread menu sort state is yours |
| Remove custom order erases the stored order over rank_clear | pass | ✓ called rank_clear; ✓ unread hand-ordered=false; ✓ lane unread menu closed; ✓ stored order {} |
| The Done lane (done 9-13 days ago, past the 2-day arm) keeps its pill and count | pass | ✓ lane done sweep pill present; ✓ lane done pill reads 2 |
| The Unread lane (a manual arm with nothing eligible) carries no broom pill | pass | ✓ lane unread sweep pill absent |
| Sweep this lane arms the zero-eligible lane the way the old pill did | pass | ✓ lane unread sweep pill present; ✓ lane unread pill matches 0 → Read; ✓ lane unread armed; ✓ lane unread offers the sweep exit |
| The menu's sort pair shows the standing direction checked, and the pick writes it | pass | ✓ lane unread menu open; ✓ lane unread menu reads oldest first as the checked direction |
