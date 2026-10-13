# UAT report

_Generated 2026-10-13T17:26:18.950Z by `npm run uat`._

## whats-new

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_ypbvuj7fz8-1/bb-plugin-focus-board/tests/manual/uat-whats-new.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| An update since the stored version shows the gift, pulsing | pass | ✓ what's-new button present; ✓ what's-new unseen (pulsing gift) |
| The pulse click opens the modal straight on What's new | pass | ✓ what's-new button present; ✓ what's-new seen (quiet gear); ✓ settings modal selected tab "What's new"; ✓ what's-new modal open; ✓ text visible: "Recent changes since you last looked." |
| Having opened the feed once, the pulse clears — the icon is now a gear | pass | ✓ what's-new button present; ✓ what's-new seen (quiet gear); ✓ what's-new modal closed |
| The caught-up gear opens the modal on Behavior | pass | ✓ what's-new button present; ✓ what's-new seen (quiet gear); ✓ settings modal selected tab "Behavior"; ✓ what's-new modal open; ✓ text visible: "Thread pane: Escape stops a running thread first" |
| The What's-new tab stays reachable from the rail, not just the pulse | pass | ✓ settings modal selected tab "What's new"; ✓ what's-new modal open; ✓ text visible: "Recent changes since you last looked." |
| The About tab names the running version and where the source lives | pass | ✓ settings modal selected tab "About"; ✓ what's-new modal open; ✓ text visible: "github.com/cristoslc/bb-plugin-focus-board" |
| Escape closes the modal; the settings icon remains | pass | ✓ what's-new button present; ✓ what's-new modal closed |
| After everything is read, the icon stays — the changelog reaches back | pass | ✓ what's-new button present; ✓ settings modal selected tab "Behavior"; ✓ what's-new modal open |
