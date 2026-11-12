# UAT report

_Generated 2026-11-12T01:33:10.479Z by `npm run uat`._

## group-done-fence

Source: `tests/manual/uat-group-done-fence.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The board opens with the group's frame in the Working lane and none in Done | pass | ✓ grp_chat_imagegent frame in working; ✓ grp_chat_imagegent frame in working holds [thr_column_sort,thr_drag_done]; ✓ no grp_chat_imagegent frame in done; ✓ text visible: "chat-imagegent" |
| Marking a member done draws the group's frame in the Done lane around that card | pass | ✓ grp_chat_imagegent frame in done; ✓ grp_chat_imagegent frame in done holds [thr_drag_done]; ✓ grp_chat_imagegent frame in working; ✓ grp_chat_imagegent frame in working holds [thr_column_sort]; ✓ grp_chat_imagegent frame in working excludes [thr_drag_done]; ✓ thr_drag_done in done; ✓ thr_column_sort in working |
| A group whose only remaining card is done keeps its frame in the Done lane | pass | ✓ grp_chat_imagegent frame in done; ✓ grp_chat_imagegent frame in done holds [thr_column_sort,thr_drag_done]; ✓ thr_column_sort in working; ✓ thr_drag_done in working; ✓ text visible: "chat-imagegent" |
| A card outside every group settles into Done with no frame around it | pass | ✓ thr_rpc_auth in done; ✓ no grp_chat_imagegent frame in done |
