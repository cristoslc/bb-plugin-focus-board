# UAT report

_Generated 2026-10-05T18:20:33.429Z by `npm run uat`._

## whats-new

Source: `tests/manual/uat-whats-new.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| An upgrade (stored 0.4.4 → running 0.5.0) shows the gift, pulsing | pass | ✓ what's-new button present; ✓ what's-new unseen (pulsing); ✓ what's-new modal closed |
| Opening the modal lists the entries since the stored version | pass | ✓ what's-new modal open; ✓ text visible: "Version 0.5.0"; ✓ text visible: "Version 0.4.4"; ✓ text visible: "The open pane now lives in the panel's URL" |
| Having opened it, the pulse clears — but the button stays | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
| The quiet (seen) button still opens the full recent changelog | pass | ✓ what's-new modal open; ✓ text visible: "Version 0.5.0" |
| Escape closes the modal; the button remains | pass | ✓ what's-new button present; ✓ what's-new modal closed |
| A fresh install (nothing stored) is stamped seen — no pulse | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
| Revisiting at the same version stays quiet | pass | ✓ what's-new button present; ✓ what's-new seen (quiet); ✓ what's-new modal closed |
