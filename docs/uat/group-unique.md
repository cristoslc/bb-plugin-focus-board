# UAT report

_Generated 2026-10-31T04:37:35.574Z by `npm run uat`._

## group-unique

Source: `tests/manual/uat-group-unique.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A fresh name in the picker creates the group and boxes the card | pass | ✓ text visible: "Alpha"; ✓ control absent: "New group name" |
| Typing the same name again settles onto the existing group, so the board carries ONE Alpha box | pass | ✓ control absent: "New group name"; ✓ group_create last called with {"name":"Alpha"}; ✓ text "Alpha" appears exactly 1 time(s); ✓ text visible: "Research: bb plugin RPC auth tokens"; ✓ text visible: "Review PR #14" |
| The rename editor refuses another group's name, stays open, and shows the reason | pass | ✓ text visible: "already taken by group grp_chat_imagegent"; ✓ text visible: "Rename failed:"; ✓ control present: "Rename group, was Alpha"; ✓ group_rename last called with {"name":"chat-imagegent"}; ✓ text "Alpha" appears exactly 1 time(s) |
| A free name commits, closes the editor, and re-labels the box everywhere | pass | ✓ control absent: "Rename group, was Alpha"; ✓ text visible: "Beta"; ✓ text hidden: "Alpha"; ✓ text hidden: "Rename failed:" |
