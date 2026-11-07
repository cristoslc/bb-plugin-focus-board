# UAT report

_Generated 2026-11-07T03:20:54.355Z by `npm run uat`._

## errored-card-menu

Source: `tests/manual/uat-errored-card-menu.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| An errored card's menu offers Retry and Ignore error beside the state toggles | pass | ✓ the card's menu is open; ✓ the open menu is labelled Thread actions; ✓ the open menu names Deploy failed: missing DATABASE_URL secret; ✓ the open menu offers entries; ✓ card thr_deploy_fail renders the touch menu trigger; ✓ text "Retry" appears exactly 1 time(s); ✓ text "Ignore error" appears exactly 1 time(s); ✓ no refusal banner |
| Pick Retry re-submits the failed turn over the SDK retry, and acks nothing | pass | ✓ called threads.retry; ✓ no error_ack_set call; ✓ no menu is open; ✓ no refusal banner |
| A refused retry reports bb's reason on the board's notice banner | pass | ✓ called threads.retry; ✓ text visible: "Retrying the thread failed: thread is stopping"; ✓ no refusal banner |
| Pick Ignore error acks the error, with the old write, and the card leaves Needs you | pass | ✓ called error_ack_set; ✓ thr_deploy_fail in attention; ✓ thr_deploy_fail in idle-recent; ✓ no menu is open; ✓ no refusal banner |
| A healthy card's menu offers neither Retry nor Ignore error | pass | ✓ the card's menu is open; ✓ the open menu is labelled Thread actions; ✓ the open menu offers entries; ✓ card thr_uat_queue renders the touch menu trigger; ✓ text "Retry" appears exactly 0 time(s); ✓ text "Ignore error" appears exactly 0 time(s); ✓ no refusal banner |
