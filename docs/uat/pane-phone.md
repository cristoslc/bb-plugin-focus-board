# UAT report

_Generated 2026-11-24T19:09:28.199Z by `npm run uat`._

## pane-phone

Source: `tests/manual/uat-pane-phone.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a phone viewport the pane opens over the board (the full-screen sheet) | pass | ✓ pane shows thr_uat_queue |
| The compact header's actions menu carries Full Screen (the standalone button is dropped on compact) | pass | ✓ text visible: "Full Screen" |
| Choosing Full Screen runs the maximize path; the mock's navigation is a no-op so the pane stays | pass | ✓ pane shows thr_uat_queue; ✓ no refusal banner |
| Mark Done in the pane header closes the sheet, and the card it moved is in the Done lane | pass | ✓ pane closed; ✓ thr_uat_queue in done; ✓ no refusal banner |
