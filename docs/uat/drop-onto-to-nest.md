# UAT report

_Generated 2026-10-05T17:31:36.647Z by `npm run uat`._

## drop-onto-to-nest

Source: `tests/manual/uat-reparent.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Hovering a card's middle third rings it and permits the drop | pass | ✓ nest ring visible on the hovered card; ✓ drop permitted during nest hover |
| Dropping onto a card's middle nests the dropped card under the target | pass | ✓ drop permitted during drag; ✓ called thread_reparent; ✓ unread has 2 reorder slots; ✓ nested row under the family card (thr_rpc_auth) |
| Dropping on a card's top third still reorders, not nests | pass | ✓ drop permitted during drag; ✓ no thread_reparent call; ✓ unread hand-ordered=true; ✓ unread has 3 reorder slots; ✓ no nested row (thr_review_pr) |
| Dropping onto a Pinned card's middle nests it; it does not pin | pass | ✓ drop permitted during drag; ✓ called thread_reparent; ✓ nested row under the family card (thr_rpc_auth) |
| The card menu's Make Top-Level detaches the nested child again | pass | ✓ drop permitted during drag; ✓ no nested row (thr_rpc_auth); ✓ unread has 3 reorder slots |
