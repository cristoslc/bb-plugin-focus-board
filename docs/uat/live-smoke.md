# UAT report

_Generated 2026-11-24T08:38:40.496Z by `npm run live-smoke`._

## live-smoke

Host: bb 0.50.1 · Focus Board 1.8.3-dev · `http://127.0.0.1:38886/plugins/focus-board/board`
Frames: `docs/screenshots/live-smoke/20261124T083825`

| Step | Result | Detail |
| --- | --- | --- |
| Preflight: the installed host, its version, and a fresh browser context | pass | ✓ the host version is readable (bb --version); ✓ the Focus Board plugin is installed (bb plugin list); ✓ Chrome is where CHROME_PATH says; ✓ the host answers the board's route; ✓ the board mounts at that route; ✓ nothing is covering the board; ✓ the board lists at least three threads to click; ✓ three distinct threads are picked for the checks |
| A one-pane card click splits | pass | ✓ the window starts as one pane; ✓ no in-panel thread pane is open; ✓ the click leaves two panes; ✓ the board is still mounted; ✓ the board kept its own pane; ✓ the clicked thread (thr_29gxjg77x4) is in the new pane; ✓ the host focused the new pane; ✓ the board's own in-panel pane stayed closed |
| A second card click replaces the pane's thread | pass | ✓ the board recorded the pane it opened; ✓ no third pane appears; ✓ the board is still mounted; ✓ the clicked thread is in the pane the board opened; ✓ the pane the board opened is the one the host focused; ✓ the board's own in-panel pane stayed closed |
| A card click after the pane was navigated away keeps the native surface (ruling: replace) | pass | ✓ a sidebar row exists to rethread the pane with; ✓ the pane the board opened holds host focus before the rethread; ✓ the sidebar row put that thread in the board's pane; ✓ the board's record still names the pane it opened (the stale shape); ✓ the click leaves the pane count flat; ✓ the clicked thread replaced the pane's thread in place; ✓ the board is still mounted; ✓ the board's own in-panel pane stayed closed |
| The board's pane header matches the native row | pass | ✓ the board's own pane opened at its pane route; ✓ a native split pane is in the window to compare against; ✓ the board's pane header is a 48px row; ✓ the native row is the same 48px; ✓ the two rows are the same height; ✓ the board's pane header carries exactly one Focus Board control; ✓ the native header carries the same control; ✓ the control carries the Focus Board mark and a caret; ✓ the control is the native 28px ghost box; ✓ no checkbox took the control's place; ✓ the control sits where the native one sits: before the maximize control; ✓ the native header orders it the same way |
| Slash focuses search with a second pane open, and the New Thread letter opens the composer | pass | ✓ the window still holds a second pane beside the board; ✓ clicking the board gives its pane host focus; ✓ slash focuses the board's search field; ✓ the New Thread letter opens the composer |
| A thread page's Focus Board menu opens on screen | pass | ✓ bb's thread page carries the Focus Board control; ✓ the control's click opens the menu; ✓ the menu has a real box; ✓ the menu is inside the viewport's left and top edges; ✓ the menu is inside the viewport's right and bottom edges; ✓ the menu carries the board's three actions |

### What this run touched

- A browser context of the run's own (`browser.createBrowserContext`): the split layout and
  the board's pane record live only in that context's storage, and the run discards them.
  Nothing here read or wrote the operator's window, profile, or any plugin setting.
- Opening a thread marks it read on the host, so the cards the run used are the first ones
  the host already marked read where it could. The read state it saw is below.
- `opened thr_29gxjg77x4 in a native pane`: read at the run's start was read.
- `replaced the pane's thread with thr_8nbzpbmm3c`: read at the run's start was read.
- `rethreaded the board's pane to thr_bkg7afa7nv from bb's sidebar`: read at the run's start was read.
- `opened thr_bcymmhtpms after the rethread`: read at the run's start was read.
- No file, tag, branch, version, or plugin setting was written. The report and the frames are
  the run's only output.

### Why these six

The harness proves the board against a simulated host. It cannot see bb's real thread page,
the real opener, route reconciliation across panes, or a transformed ancestor, and every pane
defect of the last week lived in that gap. These six are the smallest live set that notices it
(operator ruling 2026-11-24, `dec_b4wiwx3of87q`).
