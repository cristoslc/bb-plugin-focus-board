# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## board-touch

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-board-touch.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a phone no card of the column board is a native drag source and no card text is selectable | pass | ✓ lane direction: vertical; ✓ the viewport presents a coarse pointer and no hover; ✓ no card is a native drag source, so a finger's pan cannot lift one; ✓ the card's anchor is not draggable; ✓ the card's text is not touch-selectable, so a long press pans; ✓ the board allows both pan axes; ✓ the lane list allows both pan axes; ✓ card thr_ship_release is not a native drag source; ✓ card thr_rpc_auth is not a native drag source |
| A column lane scrolls its own stack and clips the horizontal axis instead of becoming a second scroll container | pass | ✓ the board's x overflow is auto; ✓ the board's y overflow is hidden; ✓ the lane's x overflow is clip; ✓ the lane's y overflow is auto |
| The rows board carries the same touch contract | pass | ✓ lane direction: horizontal; ✓ the viewport presents a coarse pointer and no hover; ✓ no card is a native drag source, so a finger's pan cannot lift one; ✓ the card's anchor is not draggable; ✓ the card's text is not touch-selectable, so a long press pans; ✓ the board allows both pan axes; ✓ the lane list allows both pan axes; ✓ card thr_ship_release is not a native drag source |
| A row scrolls along its own flow and clips the vertical axis, so a vertical slide reaches the board | pass | ✓ the board's x overflow is hidden; ✓ the board's y overflow is auto; ✓ the lane's x overflow is auto; ✓ the lane's y overflow is clip |
| A horizontal pan starting ON a card scrolls the board and moves no card | pass | ✓ the finger landed on {"card":"thr_ship_release","column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the lane x scrolled exactly 0px; ✓ the page x scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A pan that starts in the gap between two cards scrolls the board, never drags one | pass | ✓ the finger landed on {"card":null,"column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the lane x scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A pan on the lane's empty space below its last card scrolls the board | pass | ✓ the finger landed on {"column":"pinned"}; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call |
| A pan on the board's own padding still scrolls it | pass | ✓ the board x scrolled positive 40px; ✓ the browser started no native drag |
| A hold arms the card, and the slide that follows drags it instead of panning the board | pass | ✓ the hold picked up {"armed":true,"card":"thr_ship_release"}; ✓ the board x scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A hold shorter than the pickup threshold leaves the gesture a pan | pass | ✓ the hold picked nothing up; ✓ the board x scrolled positive 40px; ✓ the browser started no native drag; ✓ no rank_move call |
| A pickup lifted and released without moving puts the card back and writes nothing | pass | ✓ the hold picked up {"armed":true,"card":"thr_ship_release"}; ✓ no rank_move call; ✓ pinned order |
| A horizontal slide on the toolbar above the board scrolls the board, not the page | pass | ✓ the board x scrolled positive 40px; ✓ the page x scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call |
| A vertical slide on the toolbar scrolls nothing on the columns read and leaves the page where it was | pass | ✓ the page y scrolled exactly 0px; ✓ no rank_move call |
| A horizontal slide on a lane's header strip scrolls the board past the lane | pass | ✓ the board x scrolled positive 40px; ✓ the page x scrolled exactly 0px; ✓ no rank_move call |
| A vertical slide anywhere in the columns board leaves the page still | pass | ✓ the page y scrolled exactly 0px; ✓ the board y scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call |
| On the horizontal read a vertical pan on a card scrolls the board's rows | pass | ✓ the finger landed on {"card":"thr_ship_release","column":"pinned"}; ✓ the board y scrolled positive 40px; ✓ the lane y scrolled exactly 0px; ✓ the page y scrolled exactly 0px; ✓ the browser started no native drag; ✓ no rank_move call; ✓ pinned order |
| A horizontal pan on a row's card scrolls that row along its flow | pass | ✓ the lane x scrolled positive 30px; ✓ the browser started no native drag; ✓ no rank_move call |
| A vertical slide on the toolbar scrolls the rows board rather than the page | pass | ✓ the board y scrolled positive 40px; ✓ the page y scrolled exactly 0px; ✓ no rank_move call |
| A horizontal slide on a row's header strip scrolls the row it names | pass | ✓ the lane x scrolled positive 30px; ✓ the page x scrolled exactly 0px; ✓ no rank_move call |
| A horizontal slide on the rows toolbar has nothing to scroll, so nothing moves and the page stays | pass | ✓ the page x scrolled exactly 0px; ✓ the board x scrolled exactly 0px; ✓ no rank_move call |
