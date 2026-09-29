_Generated 2026-09-28T22:33:58.319Z by `npm run uat`._

# UAT report

## pane-history

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/.subagents/parent-lanes-impl/worktree/tests/manual/uat-pane-history.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Clicking a card opens its pane and pushes a panel route | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Switching cards pushes, so each opened pane is one history entry | pass | ✓ pane shows thr_rpc_auth; ✓ url ends with /board/t/thr_rpc_auth |
| Back reopens the previous card's pane — the card you lost track of | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Back from the first opened card closes the pane at the panel root | pass | ✓ pane closed; ✓ active card is (none); ✓ url ends with ?groupBy=status |
| The bb back-arrow case — out to another surface, back, pane restored | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Escape closes the pane by pushing the root — back after a close reopens | pass | ✓ pane closed; ✓ active card is (none); ✓ url ends with /board |
| Back after a close reopens the last pane — close is not lost work | pass | ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| A deep link to the panel's thread subPath opens the board with that pane | pass | ✓ pane shows thr_rpc_auth; ✓ active card is thr_rpc_auth |
| A restored card below the fold is scrolled into view | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| Relocating the active card (drop to Done) re-scrolls to its new lane | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| A malformed deep link degrades to the plain board | pass | ✓ pane closed; ✓ active card is (none) |

## parent-lanes

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/.subagents/parent-lanes-impl/worktree/tests/manual/uat-parent-lanes.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Parent-thread grouping shows the family lane and the Standalone lane | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Standalone"; ✓ text visible: "Child thread lane fixture" |
| Clicking a lane header opens the parent thread's pane | pass | ✓ pane open; ✓ text visible: "Parent thread lane fixture"; ✓ url ends with /board/t/thr_parent_lane |
| Clicking a child card opens its thread pane | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ url ends with /board/t/thr_child_lane |
| A deep-linked child in the rightmost lane is scrolled into view | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ active card visible |
| A search that matches only standalone threads drops every family | pass | ✓ text visible: "Standalone"; ✓ text visible: "Queue the UAT pass for the rank lane" |
| Switching back to Attention grouping renders normal columns | pass | ✓ unread order |

## rank-ordering

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/.subagents/parent-lanes-impl/worktree/tests/manual/uat-rank.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A first-time user with no stored order can drag, and the drop writes one | pass | ✓ unread has 3 reorder slots; ✓ unread hand-ordered=false; ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_review_pr"]}; ✓ unread hand-ordered=true |
| The first drop BELOW another card re-sorts, instead of leaving the card on top | pass | ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_uat_queue","thr_rpc_auth"]}; ✓ unread hand-ordered=true |
| With every lane draggable, dropping on Done still marks done | pass | ✓ called done_set |
| A lane with no cross-column drop handler still authorises its own reorder | pass | ✓ pinned has 2 reorder slots; ✓ drop permitted during drag; ✓ pinned order; ✓ stored order {"pinned":["thr_roadmap"]} |
| A drop whose payload has no card id falls back to the dragstart ref | pass | ✓ pinned has 2 reorder slots; ✓ pinned order; ✓ stored order {"pinned":["thr_roadmap"]}; ✓ no refusal banner |
| A lane with no stored order reads newest-first | pass | ✓ unread order; ✓ unread hand-ordered=false |
| The Unread lane reads in its stored order instead of recency | pass | ✓ unread order; ✓ unread hand-ordered=true |
| Dropping on a card's top half lands in front of it | pass | ✓ drop permitted during drag; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false}; ✓ stored order {"status:unread":["thr_review_pr","thr_rpc_auth","thr_uat_queue"]} |
| Dropping on a card's bottom half lands past it, not on it | pass | ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_rpc_auth","thr_review_pr","thr_uat_queue"]} |
| Dropping below the last card appends | pass | ✓ drop permitted during drag; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_rpc_auth","beforeId":null,"toEnd":true} |
| Dropping a card on itself writes nothing | pass | ✓ drop permitted during drag; ✓ stored order {"status:unread":["thr_rpc_auth","thr_uat_queue","thr_review_pr"]}; ✓ no rank_move call |
| A rank drag into a different lane's order is refused, not silently swallowed | pass | ✓ cross-lane drop refused; ✓ stored order {"status:unread":["thr_rpc_auth"],"pinned":["thr_roadmap","thr_ship_release"]}; ✓ no rank_move call |
| The Pinned lane is ranked under every grouping | pass | ✓ pinned order; ✓ pinned hand-ordered=true |
| Alt+ArrowDown moves a card down one slot | pass | ✓ unread order; ✓ stored order {"status:unread":["thr_uat_queue","thr_rpc_auth","thr_review_pr"]} |
| Alt+ArrowUp on the second card lands it at the very top | pass | ✓ unread order |
| The insertion line appears on the hovered half | pass | ✓ insertion line visible; ✓ drop permitted during hover; ✓ no insertion line |
| A completed move is announced for screen readers | pass | ✓ move announced |

## whats-new

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/.subagents/parent-lanes-impl/worktree/tests/manual/uat-whats-new.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| An upgrade (stored 0.4.4 → running 0.5.0) shows the gift, pulsing | pass | ✓ what's-new button present; ✓ what's-new unseen (pulsing); ✓ what's-new modal closed |
| Opening the modal lists the entries since the stored version | pass | ✓ what's-new modal open; ✓ text visible: "Version 0.5.0"; ✓ text visible: "Version 0.4.4"; ✓ text visible: "The open pane is part of the panel URL" |
| Having opened it, the pulse clears — but the button stays | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
| The quiet (seen) button still opens the full recent changelog | pass | ✓ what's-new modal open; ✓ text visible: "Version 0.5.0" |
| Escape closes the modal; the button remains | pass | ✓ what's-new button present; ✓ what's-new modal closed |
| A fresh install (nothing stored) is stamped seen — no pulse | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
| Revisiting at the same version stays quiet | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
