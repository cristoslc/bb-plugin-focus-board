# UAT report

_Generated 2026-10-31T13:33:17.741Z by `npm run uat`._

## board-touch

Source: `tests/manual/uat-board-touch.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a phone no card of the column board is a native drag source and no card text is selectable | pass | ✓ lane direction: vertical; ✓ the viewport presents a coarse pointer and no hover; ✓ no card is a native drag source, so a finger's pan cannot lift one; ✓ the card's anchor is not draggable; ✓ the card's text is not touch-selectable, so a long press pans; ✓ the board allows both pan axes; ✓ the lane list allows both pan axes; ✓ card thr_ship_release is not a native drag source; ✓ card thr_rpc_auth is not a native drag source |
| The rows board carries the same touch contract | pass | ✓ lane direction: horizontal; ✓ the viewport presents a coarse pointer and no hover; ✓ no card is a native drag source, so a finger's pan cannot lift one; ✓ the card's anchor is not draggable; ✓ the card's text is not touch-selectable, so a long press pans; ✓ the board allows both pan axes; ✓ the lane list allows both pan axes; ✓ card thr_ship_release is not a native drag source |
| A horizontal pan starting ON a card scrolls the board and moves no card | pass | ✓ the finger landed on {"card":"thr_ship_release","column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A pan that starts in the gap between two cards scrolls the board, never drags one | pass | ✓ the finger landed on {"card":null,"column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A pan on the lane's empty space below its last card scrolls the board | pass | ✓ the finger landed on {"column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call |
| A pan on the board's own padding still scrolls it | pass | ✓ the board x scrolled positive 40px; ✓ the browser started no native drag |
| A long-press hold before the pan does not hand the gesture to a selection or a drag | pass | ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call |
| On the horizontal read a vertical pan on a card scrolls the board's rows | pass | ✓ the finger landed on {"card":"thr_ship_release","column":"pinned"}; ✓ the board y scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A horizontal pan on a row's card scrolls that row along its flow | pass | ✓ the lane x scrolled positive 30px; ✓ the browser started no native drag; ✓ no rank_move call |
