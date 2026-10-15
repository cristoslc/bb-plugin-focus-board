# UAT report

_Generated 2026-10-15T16:55:29.091Z by `npm run uat`._

## hover-prominence

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_3jfspvnikn-1/bb-plugin-focus-board/tests/manual/uat-hover-prominence.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The dark theme's hovered card darkens, stays opaque, and the other cards recede | pass | ✓ hover probe landed on thr_rpc_auth; ✓ hovered surface opaque — the lane/wallpaper never bleeds through; ✓ dark theme: the hovered surface DARKENS (the emphasis direction, 19.5% → ~15.6%); ✓ spotlight recedes another card while a card is under the pointer |
| The light theme's hover keeps the card surface — darkening there reads as muting | pass | ✓ hover probe landed on thr_rpc_auth; ✓ hovered surface opaque — the lane/wallpaper never bleeds through; ✓ light theme: the hovered surface NEVER darkens (#195 — darkening there reads as muting); ✓ spotlight recedes another card while a card is under the pointer |
| Moving the pointer off the card hands the surface back with nothing stuck | pass | ✓ the pointer left thr_rpc_auth; ✓ the card surface is the resting token again; ✓ the recede dim let go |
